// ──────────────────────────────────────────────────────────────────────────────
// Refund / Dispute Workflow Worker
//
// Scans buyer chats across all marketplaces every hour for inbound messages
// that mention a refund-trigger keyword. For each match it:
//
//   1. Determines the underlying sale_id (chat → listing → sale).
//   2. Classifies the reason — LLM if available, regex fallback.
//   3. Opens a `refund_disputes` row (skipping duplicates).
//   4. Runs the basic auto-action playbook:
//        not_arrived  + sale >14d old → status='awaiting_cj', reply buyer
//        wrong_size                   → status='open', Telegram-alert
//        damaged      + evidence URL  → 100% auto-refund, status='refunded_buyer'
//        other / unclassified         → status='open' for manual review
//
// The reply-to-buyer step relies on the same bot endpoints reply-autopilot
// already uses. We post via vinted-bot/ka-bot/depop-bot's
// `/chats/<convId>/send` route.
//
// Edge cases not covered yet (TODOs):
//   • Multi-message buyer threads where the refund-trigger appears in the
//     second-to-last message — we only check the LATEST inbound.
//   • Counterfeit-claim / repeat-offender heuristics.
//   • Actual CJ refund-API call — currently we only set `status='awaiting_cj'`
//     and let the CJ-fulfillment worker pick it up in a follow-up cycle.
// ──────────────────────────────────────────────────────────────────────────────

import {
  createLogger,
  getDb,
  getSetting,
  setSetting,
  isPaused,
  withLock,
  markWorkerAlive,
  callLLM,
  parseLLMJson,
  openDispute,
  hasOpenDispute,
  updateDispute,
  type RefundReason,
} from '@vinted-system/shared';
import { eventBus } from './events.js';

const log = createLogger('refund-workflow');

const VINTED_BOT_URL = process.env.VINTED_BOT_URL ?? 'http://localhost:4701';
const KA_BOT_URL = process.env.KLEINANZEIGEN_BOT_URL ?? 'http://localhost:4703';
const DEPOP_BOT_URL = process.env.DEPOP_BOT_URL ?? 'http://localhost:4705';

let timer: ReturnType<typeof setInterval> | null = null;
let isRunning = false;

const POLL_INTERVAL_MS = 60 * 60 * 1000;   // 1 hour
const FIRST_TICK_MS = 4 * 60 * 1000;

function ensureSettings(): void {
  if (getSetting('refund_workflow_enabled') === null) setSetting('refund_workflow_enabled', 'true');
  if (getSetting('refund_not_arrived_max_age_days') === null) setSetting('refund_not_arrived_max_age_days', '14');
  if (getSetting('refund_auto_replies_enabled') === null) setSetting('refund_auto_replies_enabled', 'true');
}

// ── Keyword triggers (regex fallback) ──────────────────────────────────────
// German + English keywords. Used both for the initial inbox-scan filter
// AND as a fallback if the LLM call fails. Each pattern maps directly to a
// RefundReason; the workflow picks the FIRST match if multiple fire.
const REASON_PATTERNS: Array<{ regex: RegExp; reason: RefundReason }> = [
  { regex: /nicht\s+angekommen|ist\s+nicht\s+da|kam\s+nicht|noch\s+nicht\s+erhalten|never\s+arrived|did\s+not\s+arrive|hasn'?t\s+arrived/i, reason: 'not_arrived' },
  { regex: /falsche\s+gr(öß|oess)e|wrong\s+size|zu\s+klein|zu\s+groß|doesn'?t\s+fit/i, reason: 'wrong_size' },
  { regex: /kaputt|defekt|besch(ä|ae)digt|damaged|broken|torn|riss/i, reason: 'damaged' },
  { regex: /anderer\s+artikel|nicht\s+wie\s+beschrieben|not\s+as\s+described|not\s+as\s+pictured|misleading/i, reason: 'not_as_described' },
];

// Broader "any refund-related" filter — used as the SQL inbox scan filter so
// we don't ship the entire message log into Node and run regexes there.
const REFUND_TRIGGER_LIKE_PATTERNS = [
  '%nicht angekommen%',
  '%nicht da%',
  '%kam nicht%',
  '%falsche größe%',
  '%falsche groesse%',
  '%wrong size%',
  '%kaputt%',
  '%defekt%',
  '%beschädigt%',
  '%beschaedigt%',
  '%damaged%',
  '%nicht wie beschrieben%',
  '%not as described%',
  '%rückerstattung%',
  '%rueckerstattung%',
  '%erstattung%',
  '%refund%',
  '%zurückzahlen%',
  '%money back%',
];

function regexClassify(text: string): RefundReason {
  for (const p of REASON_PATTERNS) if (p.regex.test(text)) return p.reason;
  return 'other';
}

async function llmClassify(text: string): Promise<RefundReason> {
  const sys = [
    'Du bist eine Refund-Klassifizierungs-Engine.',
    'Klassifiziere die Nachricht des Käufers in eine von 5 Kategorien:',
    '- not_arrived: Ware ist nicht angekommen / verloren',
    '- wrong_size: Größe passt nicht',
    '- damaged: Artikel kaputt / beschädigt / defekt',
    '- not_as_described: anderer Artikel / nicht wie beschrieben',
    '- other: alles andere oder unklar',
    '',
    'Antwort als JSON, ohne Markdown:',
    '{"reason": "not_arrived|wrong_size|damaged|not_as_described|other"}',
  ].join('\n');
  const result = await callLLM({ system: sys, user: text, maxTokens: 80 });
  const parsed = parseLLMJson<{ reason?: string }>(result);
  const r = parsed?.reason;
  if (r === 'not_arrived' || r === 'wrong_size' || r === 'damaged' || r === 'not_as_described' || r === 'other') return r;
  return regexClassify(text);
}

// ── Bot reply helper ────────────────────────────────────────────────────────
// Sends `body` to a buyer's chat on whichever marketplace owns the chat.

async function sendBuyerReply(marketplace: string, conversationId: string, accountId: number, body: string): Promise<void> {
  if (getSetting('refund_auto_replies_enabled') !== 'true') return;
  try {
    if (marketplace === 'kleinanzeigen') {
      await fetch(`${KA_BOT_URL}/api/chats/send`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ account_id: accountId, conversation_id: conversationId, body }),
        signal: AbortSignal.timeout(60_000),
      });
    } else if (marketplace === 'depop') {
      await fetch(`${DEPOP_BOT_URL}/api/chats/${encodeURIComponent(conversationId)}/send`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ account_id: accountId, body }),
        signal: AbortSignal.timeout(60_000),
      });
    } else {
      // Vinted-default flow. chat_id is the DB id, but vinted-bot's send route
      // expects the DB chat id (it looks up vinted_conversation_id internally).
      await fetch(`${VINTED_BOT_URL}/chats/${conversationId}/send`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message: body }),
        signal: AbortSignal.timeout(60_000),
      });
    }
  } catch (err) {
    log.warn('Buyer reply failed', { marketplace, conversationId, error: err instanceof Error ? err.message : String(err) });
  }
}

// ── Inbox scans ─────────────────────────────────────────────────────────────

interface RefundCandidate {
  message_id: number;
  body: string;
  chat_id: number;
  conversation_id: string;
  buyer_username: string;
  marketplace: 'vinted' | 'kleinanzeigen' | 'depop';
  sale_id: number | null;
  account_id: number;
  sale_age_days: number | null;
  customer_evidence_url: string | null;
}

function buildLikeClause(column: string, alias = ''): { sql: string; args: string[] } {
  const prefix = alias ? `${alias}.` : '';
  const args = REFUND_TRIGGER_LIKE_PATTERNS;
  const sql = REFUND_TRIGGER_LIKE_PATTERNS.map(() => `LOWER(${prefix}${column}) LIKE ?`).join(' OR ');
  return { sql: `(${sql})`, args };
}

/** Find Vinted candidates: latest inbound messages mentioning a refund keyword. */
function findVintedCandidates(): RefundCandidate[] {
  const { sql: likeSql, args } = buildLikeClause('body', 'm');
  const rows = getDb().prepare(`
    SELECT m.id   AS message_id,
           m.body AS body,
           c.id   AS chat_id,
           c.vinted_conversation_id AS conversation_id,
           c.buyer_username,
           c.account_id,
           s.id   AS sale_id,
           CAST((julianday('now') - julianday(s.paid_at)) AS INTEGER) AS sale_age_days
      FROM messages m
      JOIN chats c ON c.id = m.chat_id
 LEFT JOIN listings l ON l.vinted_item_id = c.vinted_item_id
 LEFT JOIN sales s    ON s.listing_id = l.id
     WHERE m.direction = 'in'
       AND m.created_at >= datetime('now', '-30 days')
       AND ${likeSql}
       AND NOT EXISTS (
         SELECT 1 FROM messages m2
          WHERE m2.chat_id = m.chat_id
            AND m2.id > m.id
            AND m2.direction = 'in'
       )
     ORDER BY m.created_at DESC
     LIMIT 100
  `).all(...args) as Array<{
    message_id: number;
    body: string;
    chat_id: number;
    conversation_id: string;
    buyer_username: string;
    account_id: number;
    sale_id: number | null;
    sale_age_days: number | null;
  }>;
  return rows.map((r) => ({
    ...r,
    marketplace: 'vinted' as const,
    customer_evidence_url: null,
  }));
}

function findKaCandidates(): RefundCandidate[] {
  const { sql: likeSql, args } = buildLikeClause('body', 'm');
  const rows = getDb().prepare(`
    SELECT m.id   AS message_id,
           m.body AS body,
           c.id   AS chat_id,
           c.ka_conversation_id AS conversation_id,
           c.buyer_username,
           c.account_id,
           s.id   AS sale_id,
           CAST((julianday('now') - julianday(s.paid_at)) AS INTEGER) AS sale_age_days
      FROM kleinanzeigen_messages m
      JOIN kleinanzeigen_chats c ON c.id = m.chat_id
 LEFT JOIN listings l ON l.vinted_url = c.ad_url
 LEFT JOIN sales s    ON s.listing_id = l.id AND s.marketplace = 'kleinanzeigen'
     WHERE m.direction = 'in'
       AND m.created_at >= datetime('now', '-30 days')
       AND ${likeSql}
       AND NOT EXISTS (
         SELECT 1 FROM kleinanzeigen_messages m2
          WHERE m2.chat_id = m.chat_id
            AND m2.id > m.id
            AND m2.direction = 'in'
       )
     ORDER BY m.created_at DESC
     LIMIT 100
  `).all(...args) as Array<{
    message_id: number;
    body: string;
    chat_id: number;
    conversation_id: string;
    buyer_username: string;
    account_id: number;
    sale_id: number | null;
    sale_age_days: number | null;
  }>;
  return rows.map((r) => ({
    ...r,
    marketplace: 'kleinanzeigen' as const,
    customer_evidence_url: null,
  }));
}

function findDepopCandidates(): RefundCandidate[] {
  // Depop tables exist but the depop_chats / depop_messages layout is similar
  // to KA. Guard with try/catch in case the schema migration hasn't created
  // the tables yet (older DB snapshots).
  try {
    const { sql: likeSql, args } = buildLikeClause('body', 'm');
    const rows = getDb().prepare(`
      SELECT m.id   AS message_id,
             m.body AS body,
             c.id   AS chat_id,
             c.depop_conversation_id AS conversation_id,
             c.buyer_username,
             c.account_id,
             NULL   AS sale_id,
             NULL   AS sale_age_days
        FROM depop_messages m
        JOIN depop_chats c ON c.id = m.chat_id
       WHERE m.direction = 'in'
         AND m.created_at >= datetime('now', '-30 days')
         AND ${likeSql}
         AND NOT EXISTS (
           SELECT 1 FROM depop_messages m2
            WHERE m2.chat_id = m.chat_id
              AND m2.id > m.id
              AND m2.direction = 'in'
         )
       ORDER BY m.created_at DESC
       LIMIT 100
    `).all(...args) as Array<{
      message_id: number;
      body: string;
      chat_id: number;
      conversation_id: string;
      buyer_username: string;
      account_id: number;
      sale_id: number | null;
      sale_age_days: number | null;
    }>;
    return rows.map((r) => ({
      ...r,
      marketplace: 'depop' as const,
      customer_evidence_url: null,
    }));
  } catch (err) {
    log.debug('Depop candidates skipped', { error: err instanceof Error ? err.message : String(err) });
    return [];
  }
}

// ── Auto-action playbook ────────────────────────────────────────────────────

async function runPlaybook(cand: RefundCandidate, reason: RefundReason, disputeId: number): Promise<void> {
  const notArrivedMaxAge = Number(getSetting('refund_not_arrived_max_age_days') ?? '14');

  switch (reason) {
    case 'not_arrived': {
      if (cand.sale_age_days !== null && cand.sale_age_days >= notArrivedMaxAge) {
        updateDispute(disputeId, {
          status: 'awaiting_cj',
          resolution_note: `Auto: Sale ${cand.sale_age_days}d alt — Tracking-Update bei CJ angefordert.`,
        });
        await sendBuyerReply(
          cand.marketplace,
          cand.marketplace === 'vinted' ? String(cand.chat_id) : cand.conversation_id,
          cand.account_id,
          'Hey! Sorry für die Verzögerung — ich habe gerade ein Tracking-Update angefordert und melde mich in 24h zurück bei dir 💕',
        );
        eventBus.publish({
          type: 'alert',
          level: 'warn',
          message: `📦 Refund-Workflow: Sale #${cand.sale_id ?? '?'} (${cand.marketplace}) → "not_arrived" 14d+ → CJ-Tracking angefragt`,
        });
      } else {
        updateDispute(disputeId, {
          status: 'open',
          resolution_note: 'Auto: Sale noch zu jung — Standard 7-14d Versand abwarten.',
        });
      }
      break;
    }
    case 'wrong_size': {
      updateDispute(disputeId, {
        status: 'open',
        resolution_note: 'Auto: wrong_size — manueller Review nötig (Größentabelle prüfen).',
      });
      eventBus.publish({
        type: 'alert',
        level: 'warn',
        message: `📏 Refund-Workflow: Sale #${cand.sale_id ?? '?'} (${cand.marketplace}) → "wrong_size" — manual review`,
      });
      break;
    }
    case 'damaged': {
      if (cand.customer_evidence_url) {
        // TODO: actually trigger Vinted refund-button flow + CJ-claim. For
        // now we just mark refunded_buyer and let the operator confirm.
        updateDispute(disputeId, {
          status: 'refunded_buyer',
          refund_eur: undefined,
          resolution_note: 'Auto: damaged + Foto-Beleg → 100% Erstattung markiert (Operator-Confirm offen)',
        });
        await sendBuyerReply(
          cand.marketplace,
          cand.marketplace === 'vinted' ? String(cand.chat_id) : cand.conversation_id,
          cand.account_id,
          'Oh nein, sorry für den Ärger! Ich erstatte dir den vollen Betrag. Sollte gleich ankommen 💕',
        );
        eventBus.publish({
          type: 'alert',
          level: 'warn',
          message: `💔 Refund-Workflow: Sale #${cand.sale_id ?? '?'} (${cand.marketplace}) → "damaged" → Auto-Refund`,
        });
      } else {
        updateDispute(disputeId, {
          status: 'open',
          resolution_note: 'Auto: damaged, aber kein Foto-Beleg → manueller Review.',
        });
        eventBus.publish({
          type: 'alert',
          level: 'warn',
          message: `🔧 Refund-Workflow: Sale #${cand.sale_id ?? '?'} (${cand.marketplace}) → "damaged" ohne Beleg — manual`,
        });
      }
      break;
    }
    case 'not_as_described':
    case 'other':
    default: {
      updateDispute(disputeId, {
        status: 'open',
        resolution_note: 'Auto: nicht eindeutig klassifiziert — manueller Review.',
      });
      eventBus.publish({
        type: 'alert',
        level: 'warn',
        message: `❓ Refund-Workflow: Sale #${cand.sale_id ?? '?'} (${cand.marketplace}) → "${reason}" — manual`,
      });
    }
  }
}

// ── Tick ────────────────────────────────────────────────────────────────────

async function processCandidate(cand: RefundCandidate): Promise<void> {
  if (cand.sale_id === null) {
    log.debug('Skipping candidate — no resolvable sale', { chat_id: cand.chat_id, marketplace: cand.marketplace });
    return;
  }
  if (hasOpenDispute(cand.sale_id)) {
    log.debug('Dispute already open', { sale_id: cand.sale_id });
    return;
  }
  const reason = await llmClassify(cand.body).catch(() => regexClassify(cand.body));
  const disputeId = openDispute({
    sale_id: cand.sale_id,
    account_id: cand.account_id,
    reason,
    status: 'open',
    buyer_message: cand.body.slice(0, 4000),
    customer_evidence_url: cand.customer_evidence_url,
  });
  log.info('Refund dispute opened', { dispute_id: disputeId, sale_id: cand.sale_id, reason, marketplace: cand.marketplace });
  await runPlaybook(cand, reason, disputeId);
}

async function tick(): Promise<void> {
  if (isRunning) return;
  if (isPaused()) return;
  ensureSettings();
  if (getSetting('refund_workflow_enabled') !== 'true') {
    markWorkerAlive('refund-workflow');
    return;
  }
  isRunning = true;
  try {
    await withLock('refund-workflow-tick', 600, async () => {
      const candidates = [
        ...findVintedCandidates(),
        ...findKaCandidates(),
        ...findDepopCandidates(),
      ];
      if (candidates.length === 0) {
        log.info('Refund workflow — no candidates');
        return;
      }
      log.info(`Refund workflow scanning ${candidates.length} candidates`);
      for (const c of candidates) {
        try {
          await processCandidate(c);
        } catch (err) {
          log.error('Refund candidate processing failed', {
            chat_id: c.chat_id,
            marketplace: c.marketplace,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    });
  } catch (err) {
    log.error('Refund workflow tick crashed', { error: err instanceof Error ? err.message : String(err) });
  } finally {
    isRunning = false;
  }
}

export function startRefundWorkflow(): void {
  if (timer) return;
  ensureSettings();
  log.info('Refund-workflow worker started', {
    intervalMin: POLL_INTERVAL_MS / 60_000,
    enabled: getSetting('refund_workflow_enabled'),
  });
  setTimeout(() => void tick(), FIRST_TICK_MS);
  timer = setInterval(() => void tick(), POLL_INTERVAL_MS);
}

export function stopRefundWorkflow(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
    log.info('Refund-workflow worker stopped');
  }
}

export const _internal = {
  tick,
  regexClassify,
  llmClassify,
  findVintedCandidates,
  findKaCandidates,
  findDepopCandidates,
  processCandidate,
};
