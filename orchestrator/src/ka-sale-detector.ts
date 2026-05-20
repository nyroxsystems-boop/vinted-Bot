// ──────────────────────────────────────────────────────────────────────────────
// Kleinanzeigen Sale-Detector
//
// KA has no formal "sold" API like Vinted. Buyers commit verbally in chat:
//   "Ich nehme es", "Hier meine Adresse: ...", "Habe überwiesen", etc.
// We use Claude to scan recent KA conversations and classify whether the
// listing has been sold, with what confidence, and extract the shipping
// address if the buyer has shared it.
//
// On high confidence (>= ka_sale_confidence_min, default 0.75):
//   • INSERT INTO listings (so other workers can link to it)
//   • INSERT INTO sales with marketplace='kleinanzeigen', paid_at=now,
//     buyer_address=<LLM-extracted>
//   • This triggers Cross-Sync (deactivate Vinted listing) + Re-Lister
//     (stamps auto_listings.sold_at) + CJ-Fulfillment (places CJ order)
//
// On medium confidence (0.5–0.75): emit alert, user confirms in dashboard.
// ──────────────────────────────────────────────────────────────────────────────

import { createLogger, getDb, getSetting, isPaused, withLock, validateBuyerAddress, lockSold, callLLM, parseLLMJson } from '@vinted-system/shared';
import { eventBus } from './events.js';

const log = createLogger('ka-sale-detector');

// C2 — Always stamp the marketplace explicitly. If the column drifts back to
// NULL (older code path / migration regression), cross-sync would treat the
// sale as Vinted-origin and skip deactivating the actual Vinted twin → DOUBLE
// SELL. Centralising the constant + asserting it post-insert makes that
// regression loud instead of silent.
const KA_MARKETPLACE = 'kleinanzeigen' as const;

let timer: ReturnType<typeof setInterval> | null = null;
const INTERVAL_MS = 60 * 60 * 1000;  // hourly
const MAX_PER_CYCLE = 8;             // ~8 LLM calls / hour → ~200/day, fine

interface SaleClassification {
  is_sold: boolean;
  confidence: number;
  signal: string;
  address?: {
    name?: string;
    street?: string;
    zip?: string;
    city?: string;
    country?: string;
    phone?: string;
  };
}

async function classifyChat(chatId: number, transcript: string, adTitle: string): Promise<SaleClassification | null> {
  const sys = [
    'You analyze German-language Kleinanzeigen chat transcripts to determine whether a sale has been finalized.',
    'Output ONLY JSON. No markdown.',
    'Schema:',
    '{"is_sold": boolean, "confidence": 0.0-1.0, "signal": "<short german reason>", "address": {"name":"...","street":"...","zip":"...","city":"...","country":"DE","phone":"..."}|null}',
    '',
    'Sale-Signale (verstärken Konfidenz):',
    '- Käufer sagt klar: "Ich nehme es" / "Ich kaufe es" / "Bestätige Kauf"',
    '- Käufer hat Adresse mitgeteilt (Straße + PLZ + Ort)',
    '- Käufer sagt "habe überwiesen" / "Zahlung gesendet" / "PayPal gesendet"',
    '- Verkäufer hat Versandbestätigung gegeben',
    '',
    'Anti-Signale (senken Konfidenz):',
    '- Käufer fragt nur nach Verfügbarkeit / Details',
    '- Reine Verhandlung, kein Commit',
    '- Käufer hat abgesagt / kein Interesse mehr',
    '',
    'Adresse: nur ausfüllen wenn ALLE Felder klar aus Chat ablesbar sind (Name + Straße + PLZ + Ort). Sonst address=null.',
    'country defaultet auf "DE" wenn nicht anders genannt.',
  ].join('\n');

  const user = [
    `Inserat: "${adTitle}"`,
    '',
    'Chat-Transcript (alphabetisch chronologisch):',
    transcript,
  ].join('\n');

  const text = await callLLM({ system: sys, user, maxTokens: 500 });
  const parsed = parseLLMJson<SaleClassification>(text);
  if (!parsed) {
    log.warn('llm classify failed or json parse fail', { chatId, snippet: text?.slice(0, 200) });
    return null;
  }
  return parsed;
}

function buildTranscript(chatId: number, maxMsgs = 20): { transcript: string; adTitle: string; adUrl: string; buyerUsername: string } | null {
  const db = getDb();
  const chat = db.prepare(`
    SELECT ad_title, ad_url, buyer_username FROM kleinanzeigen_chats WHERE id = ?
  `).get(chatId) as { ad_title: string | null; ad_url: string | null; buyer_username: string } | undefined;
  if (!chat) return null;
  const msgs = db.prepare(`
    SELECT direction, body, created_at FROM kleinanzeigen_messages
     WHERE chat_id = ? ORDER BY created_at ASC LIMIT ?
  `).all(chatId, maxMsgs) as Array<{ direction: string; body: string; created_at: string }>;
  const lines = msgs.map(m => `${m.direction === 'in' ? 'Käufer' : 'Verkäufer'}: ${m.body}`);
  return {
    transcript: lines.join('\n'),
    adTitle: chat.ad_title ?? '(unbekannt)',
    adUrl: chat.ad_url ?? '',
    buyerUsername: chat.buyer_username,
  };
}

async function tickInner(): Promise<void> {
  if (getSetting('ka_sale_detect_enabled') !== 'true') return;
  const provider = getSetting('llm_provider') ?? 'gemini';
  const keyMissing = provider === 'gemini' ? !process.env.GEMINI_API_KEY : !process.env.ANTHROPIC_API_KEY;
  if (keyMissing) {
    log.warn(`KA sale detection skipped — ${provider} API key missing`);
    // Record once per hour so the dashboard config-banner has a tail to show
    // without flooding the events table.
    if (Math.random() < 0.01) {
      const { recordWorkerEvent } = await import('@vinted-system/shared');
      recordWorkerEvent('ka-sale-detector', 'warn',
        `KA sale detection skipped — ${provider} API key missing`,
        { provider });
    }
    return;
  }
  const minConfidence = Number(getSetting('ka_sale_confidence_min') ?? '0.75');

  const db = getDb();
  // Candidate chats: have ≥1 incoming message in the last 14 days, have NOT
  // been recently classified, and no sales row exists yet for the ad.
  const candidates = db.prepare(`
    SELECT c.id, c.ad_url, c.ad_title
      FROM kleinanzeigen_chats c
     WHERE c.last_message_at > datetime('now', '-14 days')
       AND EXISTS (
         SELECT 1 FROM kleinanzeigen_messages m
          WHERE m.chat_id = c.id AND m.direction = 'in'
       )
       AND NOT EXISTS (
         SELECT 1 FROM sales s
           JOIN listings l ON l.id = s.listing_id
          WHERE s.marketplace = 'kleinanzeigen'
            AND l.vinted_url = c.ad_url
       )
       AND NOT EXISTS (
         SELECT 1 FROM settings st
          WHERE st.key = 'ka_chat_last_scan_' || c.id
            AND st.value > datetime('now', '-6 hours')
       )
     ORDER BY c.last_message_at DESC
     LIMIT ?
  `).all(MAX_PER_CYCLE) as Array<{ id: number; ad_url: string | null; ad_title: string | null }>;

  if (candidates.length === 0) return;
  log.info(`KA sale-detector scanning ${candidates.length} chats`);

  const setSetting = db.prepare(`
    INSERT INTO settings(key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `);

  for (const c of candidates) {
    setSetting.run(`ka_chat_last_scan_${c.id}`, new Date().toISOString());

    const ctx = buildTranscript(c.id);
    if (!ctx) continue;
    const cls = await classifyChat(c.id, ctx.transcript, ctx.adTitle);
    if (!cls) continue;

    log.info('KA sale-classification', {
      chat: c.id,
      sold: cls.is_sold,
      conf: cls.confidence,
      sig: cls.signal,
      hasAddress: !!cls.address,
    });

    if (!cls.is_sold || cls.confidence < 0.5) continue;

    // Address present? Validate before auto-creating.
    const addrFromLlm = cls.address ?? null;
    if (addrFromLlm) {
      const addrErr = validateBuyerAddress(addrFromLlm);
      if (addrErr) {
        log.info('KA sale detected but address invalid', { chat: c.id, addrErr });
        // Still alert — user can fix the address manually
        eventBus.publish({
          type: 'alert',
          level: 'warn',
          message: `📨 Mögl. KA-Sale (${Math.round(cls.confidence*100)}%): Folder "${c.ad_title ?? '?'}" — Adresse fehlt/falsch (${addrErr}). Bitte in Dashboard prüfen.`,
        });
        continue;
      }
    }

    if (cls.confidence >= minConfidence && addrFromLlm) {
      // Auto-create sales row: high confidence + clean address.
      try {
        await materializeKaSale(c, ctx.buyerUsername, addrFromLlm, cls);
      } catch (err) {
        log.error('materializeKaSale failed', { chat: c.id, error: err instanceof Error ? err.message : String(err) });
      }
    } else {
      eventBus.publish({
        type: 'alert',
        level: 'warn',
        message: `📨 Mögl. KA-Sale (${Math.round(cls.confidence*100)}%): "${c.ad_title ?? '?'}" — ${cls.signal}. Im Dashboard bestätigen.`,
      });
    }
  }
}

interface AddressLike {
  name?: string;
  street?: string;
  zip?: string;
  city?: string;
  country?: string;
  phone?: string;
}

async function materializeKaSale(
  chat: { id: number; ad_url: string | null; ad_title: string | null },
  buyerUsername: string,
  addr: AddressLike,
  cls: SaleClassification,
): Promise<void> {
  const db = getDb();

  // Find the folder via marketplace_listings (mapped by ad_url)
  const ml = db.prepare(`
    SELECT folder_num, external_id, account_id, list_price_eur
      FROM marketplace_listings
     WHERE marketplace = 'kleinanzeigen' AND (external_url = ? OR external_id IN (
       SELECT REPLACE(REPLACE(external_url, 'https://www.kleinanzeigen.de/s-anzeige/', ''), '/', '') FROM marketplace_listings WHERE external_url = ?
     ))
     LIMIT 1
  `).get(chat.ad_url ?? '', chat.ad_url ?? '') as { folder_num: number; external_id: string; account_id: number; list_price_eur: number } | undefined;
  if (!ml) {
    log.warn('No marketplace_listings row for KA chat — skipping auto-sale', { chat: chat.id, ad_url: chat.ad_url });
    eventBus.publish({
      type: 'alert',
      level: 'warn',
      message: `⚠️ KA-Sale für "${chat.ad_title ?? '?'}" erkannt, aber kein Mapping gefunden. Verlinkung im Dashboard prüfen.`,
    });
    return;
  }

  const tx = db.transaction(() => {
    // Insert listings row so sales has somewhere to point.
    // vinted_url is UNIQUE so use the ka_url. vinted_item_id = ka external_id
    // (this lets cross-sync + cj-fulfillment join via marketplace_listings).
    let lst = db.prepare(`SELECT id FROM listings WHERE vinted_url = ?`).get(chat.ad_url ?? `ka_${ml.external_id}`) as { id: number } | undefined;
    if (!lst) {
      lst = db.prepare(`
        INSERT INTO listings (account_id, vinted_url, vinted_item_id, title, list_price_eur, min_accept_price_eur, status)
        VALUES (?, ?, ?, ?, ?, ?, 'sold')
        RETURNING id
      `).get(
        ml.account_id,
        chat.ad_url ?? `ka_${ml.external_id}`,
        ml.external_id,
        chat.ad_title ?? 'Kleinanzeigen Sale',
        ml.list_price_eur,
        Math.round(ml.list_price_eur * 0.75 * 100) / 100,
      ) as { id: number };
    }

    // Create the sale. C2: marketplace MUST be set — bind via parameter so
    // a literal-string regression can't silently drop the value.
    const sale = db.prepare(`
      INSERT INTO sales (listing_id, buyer_name, buyer_address, buyer_phone, buyer_country, marketplace, paid_at)
      VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
      RETURNING id
    `).get(
      lst!.id,
      addr.name ?? buyerUsername,
      JSON.stringify({ ...addr, country: addr.country ?? 'DE' }),
      addr.phone ?? null,
      addr.country ?? 'DE',
      KA_MARKETPLACE,
    ) as { id: number };

    // Defensive guard: blow up loudly if the marketplace column slipped to
    // NULL (cross-sync depends on this for inventory deactivation).
    const check = db.prepare(`SELECT marketplace FROM sales WHERE id = ?`).get(sale.id) as { marketplace: string | null } | undefined;
    if (!check || check.marketplace !== KA_MARKETPLACE) {
      throw new Error(`C2 invariant violated: sale #${sale.id} marketplace=${check?.marketplace ?? 'NULL'} (expected ${KA_MARKETPLACE})`);
    }

    log.info('KA sale materialized', {
      chat: chat.id,
      folder: ml.folder_num,
      sale: sale.id,
      conf: cls.confidence,
    });

    eventBus.publish({
      type: 'alert',
      level: 'warn',
      message: `🎉 KA-Sale automatisch erkannt: "${chat.ad_title ?? '?'}" → Sale #${sale.id} (${Math.round(cls.confidence*100)}% Konfidenz). CJ-Order folgt.`,
    });
  });
  tx();

  // Trigger cross-sync inventory lock (outside tx to allow other workers to read)
  try {
    lockSold(ml.folder_num, 'kleinanzeigen', ml.list_price_eur, `ka_chat:${chat.id}`);
  } catch (err) {
    log.warn('lockSold failed', { folder: ml.folder_num, error: err instanceof Error ? err.message : String(err) });
  }
}

async function tick(): Promise<void> {
  if (isPaused()) return;
  await withLock('ka-sale-detector-tick', 600, tickInner);
}

export function startKaSaleDetector(): void {
  if (timer) return;
  log.info('KA-Sale-Detector started', { intervalMs: INTERVAL_MS, provider: getSetting('llm_provider') ?? 'gemini' });
  setTimeout(() => void tick(), 4 * 60_000);
  timer = setInterval(() => void tick(), INTERVAL_MS);
}

export function stopKaSaleDetector(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
    log.info('KA-Sale-Detector stopped');
  }
}

export const _internal = { classifyChat, buildTranscript, tickInner };
