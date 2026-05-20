// ──────────────────────────────────────────────────────────────────────────────
// Reply-Autopilot
//
// Beantwortet Käuferfragen auf Vinted automatisch via Claude (Anthropic API).
// Architektur:
//
//   1. Worker scannt alle X Minuten die `messages` Tabelle nach
//      unbeantworteten direction='in' Messages, die noch nicht im
//      reply_autopilot_log mit status=pending|sent stehen.
//   2. Lädt Listing-Kontext aus marketplace_listings/auto_listings (Title,
//      Beschreibung, Preis, Größe, Material, Farben).
//   3. LLM-Call mit System-Prompt + Käufer-Message + Listing-Kontext.
//      LLM klassifiziert intent + generiert Antwort.
//   4. Verhandlung: berechnet erlaubten Counter-Preis (Floor-aware).
//   5. Mode 'auto' → sofort POST /chats/:id/send über vinted-bot.
//      Mode 'draft' → nur in DB, Dashboard zeigt Review-Queue.
//
// Ohne ANTHROPIC_API_KEY → fallback auf Template-Antworten pro Intent.
// ──────────────────────────────────────────────────────────────────────────────

import {
  createLogger,
  getDb,
  getSetting,
  callLLM,
  parseLLMJson,
} from '@vinted-system/shared';
import { BOT_ENDPOINTS } from './marketplaces.js';

const log = createLogger('reply-autopilot');
const VINTED_BOT_URL = process.env.VINTED_BOT_URL ?? 'http://localhost:4701';
const KA_BOT_URL = process.env.KLEINANZEIGEN_BOT_URL ?? 'http://localhost:4703';
const DEPOP_BOT_URL = process.env.DEPOP_BOT_URL ?? 'http://localhost:4705';

export type Intent = 'size' | 'shipping' | 'negotiation' | 'smalltalk' | 'other';

interface InMessageRow {
  id: number;
  chat_id: number;
  body: string;
  account_id: number;
  conversation_id: string;
  buyer_username: string;
  created_at: string;
}

interface ListingContext {
  folder_num: number | null;
  title: string;
  description: string;
  category: string;
  size: string;
  brand: string;
  condition: string;
  color: string;
  material: string;
  list_price_eur: number;
  min_accept_price_eur: number;  // aus listings
  temu_price_eur: number;
}

export interface AutopilotResult {
  intent: Intent;
  draft: string;
  counterPriceEur?: number;
  confidence?: number; // 0..1
  source: 'llm' | 'template';
}

// ── Settings snapshot ────────────────────────────────────────────────────────

function settings() {
  return {
    enabled: (getSetting('auto_reply_enabled') ?? 'true') === 'true',
    sendMode: (getSetting('auto_reply_send_mode') ?? 'draft') as 'draft' | 'auto',
    lookbackMin: parseInt(getSetting('auto_reply_lookback_min') ?? '60', 10),
    maxDropPct: parseFloat(getSetting('auto_reply_max_negotiation_drop_pct') ?? '15'),
    intervalMin: parseInt(getSetting('auto_reply_interval_min') ?? '5', 10),
    delayMinS: parseInt(getSetting('auto_reply_delay_min_s') ?? '600', 10),
    delayMaxS: parseInt(getSetting('auto_reply_delay_max_s') ?? '900', 10),
  };
}

/** Random delay in ms within [delayMinS..delayMaxS] seconds. */
function pickReplyDelayMs(cfg: ReturnType<typeof settings>): number {
  const lo = Math.max(0, cfg.delayMinS);
  const hi = Math.max(lo, cfg.delayMaxS);
  const sec = lo + Math.random() * (hi - lo);
  return Math.round(sec * 1000);
}

/**
 * SQLite-compatible timestamp for now+delay, used as scheduled_send_at.
 * Format: 'YYYY-MM-DD HH:MM:SS' (UTC) — matches `datetime('now')` exactly
 * so lexicographic comparison in SQL works correctly.
 */
function scheduledSendIso(cfg: ReturnType<typeof settings>): string {
  const d = new Date(Date.now() + pickReplyDelayMs(cfg));
  // toISOString() → '2026-05-12T15:50:26.786Z'
  // SQLite datetime() → '2026-05-12 15:50:26'
  // We need the latter.
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

/** Seller info + payment methods injected into LLM prompts and template replies. */
export interface SellerContext {
  name: string;
  displayName: string;
  zip: string;
  city: string;
  shippingProvider: string;
  paymentMethods: Array<{ type: string; handle?: string; name?: string; holder?: string; note?: string }>;
}
export function loadSellerContext(): SellerContext {
  let payment: SellerContext['paymentMethods'] = [];
  try { payment = JSON.parse(getSetting('payment_methods_json') ?? '[]') as SellerContext['paymentMethods']; } catch { /* */ }
  return {
    name: getSetting('seller_name') ?? '',
    displayName: getSetting('seller_display_name') ?? '',
    zip: getSetting('seller_zip') ?? '',
    city: getSetting('seller_city') ?? '',
    shippingProvider: getSetting('shipping_default_provider') ?? 'Hermes',
    paymentMethods: Array.isArray(payment) ? payment : [],
  };
}

/** Render seller context as a system-prompt snippet. */
export function renderSellerSystemSnippet(s: SellerContext): string {
  const parts: string[] = [];
  if (s.displayName) parts.push(`Du heißt ${s.displayName}.`);
  if (s.zip || s.city) parts.push(`Versand aus ${[s.zip, s.city].filter(Boolean).join(' ')}.`);
  if (s.shippingProvider) parts.push(`Standard-Versender: ${s.shippingProvider}.`);
  if (s.paymentMethods.length > 0) {
    const ms = s.paymentMethods.map(m => {
      if (m.type === 'paypal') return `PayPal an ${m.handle ?? '<unset>'}${m.name ? ` (${m.name})` : ''}`;
      if (m.type === 'iban')   return `Überweisung IBAN ${m.handle ?? '<unset>'}${m.holder ? ` (${m.holder})` : ''}`;
      if (m.type === 'ebay')   return `eBay-Kleinanzeigen Direktkauf / Vinted-Käuferschutz`;
      return `${m.type}${m.handle ? `: ${m.handle}` : ''}${m.note ? ` (${m.note})` : ''}`;
    }).join(', ');
    parts.push(`Akzeptierte Zahlungsmethoden: ${ms}.`);
  }
  return parts.length > 0 ? `Seller-Kontext: ${parts.join(' ')}` : '';
}

// ── DB Helpers ───────────────────────────────────────────────────────────────

function findUnansweredIncoming(lookbackMin: number): InMessageRow[] {
  // Eingehende Messages, jünger als lookback, und für die KEINE spätere
  // out-Message im selben Chat existiert UND keine pending/sent reply_autopilot_log.
  return getDb()
    .prepare(
      `SELECT m.id, m.chat_id, m.body, m.created_at,
              c.account_id, c.vinted_conversation_id AS conversation_id, c.buyer_username
         FROM messages m
         JOIN chats c ON c.id = m.chat_id
        WHERE m.direction = 'in'
          AND m.created_at >= datetime('now', '-' || ? || ' minutes')
          AND NOT EXISTS (
            SELECT 1 FROM messages m2
             WHERE m2.chat_id = m.chat_id
               AND m2.direction = 'out'
               AND m2.created_at > m.created_at
          )
          AND NOT EXISTS (
            SELECT 1 FROM reply_autopilot_log r
             WHERE r.message_id = m.id
               AND r.status IN ('pending','sent','edited')
          )
        ORDER BY m.created_at ASC
        LIMIT 50`,
    )
    .all(lookbackMin) as InMessageRow[];
}

function loadListingContext(chatId: number): ListingContext | null {
  const db = getDb();

  // ── Strategie 0: chat.vinted_item_id → direct listing match ───────────
  // The most reliable match — uses the item ID scraped from the conversation header.
  const chatItemBased = db
    .prepare(
      `SELECT al.folder_num, al.title, al.description, al.category, al.size,
              al.brand, al.condition, al.color, al.material,
              al.price_eur AS list_price_eur, al.temu_price_eur,
              l.min_accept_price_eur
         FROM chats c
         JOIN listings l ON l.vinted_item_id = c.vinted_item_id
         LEFT JOIN auto_listings al ON al.vinted_item_id = c.vinted_item_id
        WHERE c.id = ? AND c.vinted_item_id IS NOT NULL
        LIMIT 1`,
    )
    .get(chatId) as Record<string, unknown> | undefined;
  if (chatItemBased?.title) {
    return {
      folder_num: (chatItemBased.folder_num as number | null) ?? null,
      title: chatItemBased.title as string,
      description: (chatItemBased.description as string | null) ?? '',
      category: (chatItemBased.category as string | null) ?? '',
      size: (chatItemBased.size as string | null) ?? '',
      brand: (chatItemBased.brand as string | null) ?? 'Ohne Marke',
      condition: (chatItemBased.condition as string | null) ?? 'Sehr gut',
      color: (chatItemBased.color as string | null) ?? '',
      material: (chatItemBased.material as string | null) ?? '',
      list_price_eur: (chatItemBased.list_price_eur as number | null) ?? 0,
      min_accept_price_eur: (chatItemBased.min_accept_price_eur as number | null)
        ?? ((chatItemBased.list_price_eur as number | null) ?? 0) * 0.7,
      temu_price_eur: (chatItemBased.temu_price_eur as number | null) ?? 0,
    };
  }

  // ── Strategie 1: Offer-basiert — das genaueste Match ──────────────────
  // Wenn der Chat ein Angebot enthält, zeigt das Offer direkt auf das Listing.
  const offerBased = db
    .prepare(
      `SELECT al.folder_num, al.title, al.description, al.category, al.size,
              al.brand, al.condition, al.color, al.material,
              al.price_eur AS list_price_eur, al.temu_price_eur
         FROM offers o
         JOIN listings l ON l.id = o.listing_id
         JOIN auto_listings al ON al.vinted_item_id = l.vinted_item_id
        WHERE o.chat_id = ?
        ORDER BY o.created_at DESC LIMIT 1`,
    )
    .get(chatId) as Record<string, unknown> | undefined;
  if (offerBased?.title) {
    return {
      folder_num: (offerBased.folder_num as number | null) ?? null,
      title: offerBased.title as string,
      description: (offerBased.description as string | null) ?? '',
      category: (offerBased.category as string | null) ?? '',
      size: (offerBased.size as string | null) ?? '',
      brand: (offerBased.brand as string | null) ?? 'Ohne Marke',
      condition: (offerBased.condition as string | null) ?? 'Sehr gut',
      color: (offerBased.color as string | null) ?? '',
      material: (offerBased.material as string | null) ?? '',
      list_price_eur: (offerBased.list_price_eur as number | null) ?? 0,
      min_accept_price_eur: ((offerBased.list_price_eur as number | null) ?? 0) * 0.7,
      temu_price_eur: (offerBased.temu_price_eur as number | null) ?? 0,
    };
  }

  // ── Strategie 2: Offer → listings direkt (ohne auto_listings) ─────────
  const offerListing = db
    .prepare(
      `SELECT l.title, l.list_price_eur, l.min_accept_price_eur
         FROM offers o
         JOIN listings l ON l.id = o.listing_id
        WHERE o.chat_id = ?
        ORDER BY o.created_at DESC LIMIT 1`,
    )
    .get(chatId) as Record<string, unknown> | undefined;
  if (offerListing?.title) {
    return {
      folder_num: null,
      title: offerListing.title as string,
      description: '',
      category: '',
      size: '',
      brand: 'Ohne Marke',
      condition: 'Sehr gut',
      color: '',
      material: '',
      list_price_eur: (offerListing.list_price_eur as number | null) ?? 0,
      min_accept_price_eur: (offerListing.min_accept_price_eur as number | null) ?? 0,
      temu_price_eur: 0,
    };
  }

  // ── Strategie 3: Fallback — neuestes auto_listing des Accounts ────────
  // Nur wenn kein Offer-Match existiert. Besser als nichts, aber nicht ideal.
  const auto = db
    .prepare(
      `SELECT al.folder_num, al.title, al.description, al.category, al.size,
              al.brand, al.condition, al.color, al.material,
              al.price_eur AS list_price_eur, al.temu_price_eur
         FROM chats c
         JOIN auto_listings al ON al.account_id = c.account_id
        WHERE c.id = ?
        ORDER BY al.id DESC LIMIT 1`,
    )
    .get(chatId) as Record<string, unknown> | undefined;
  if (auto?.title) {
    return {
      folder_num: (auto.folder_num as number | null) ?? null,
      title: auto.title as string,
      description: (auto.description as string | null) ?? '',
      category: (auto.category as string | null) ?? '',
      size: (auto.size as string | null) ?? '',
      brand: (auto.brand as string | null) ?? 'Ohne Marke',
      condition: (auto.condition as string | null) ?? 'Sehr gut',
      color: (auto.color as string | null) ?? '',
      material: (auto.material as string | null) ?? '',
      list_price_eur: (auto.list_price_eur as number | null) ?? 0,
      min_accept_price_eur: ((auto.list_price_eur as number | null) ?? 0) * 0.7,
      temu_price_eur: (auto.temu_price_eur as number | null) ?? 0,
    };
  }

  // ── Strategie 4: manuell erstellte Listings ───────────────────────────
  const manual = db
    .prepare(
      `SELECT l.title, l.list_price_eur, l.min_accept_price_eur
         FROM chats c
         JOIN listings l ON l.account_id = c.account_id AND l.status = 'active'
        WHERE c.id = ?
        ORDER BY l.id DESC LIMIT 1`,
    )
    .get(chatId) as Record<string, unknown> | undefined;
  if (manual?.title) {
    return {
      folder_num: null,
      title: manual.title as string,
      description: '',
      category: '',
      size: '',
      brand: 'Ohne Marke',
      condition: 'Sehr gut',
      color: '',
      material: '',
      list_price_eur: (manual.list_price_eur as number | null) ?? 0,
      min_accept_price_eur: (manual.min_accept_price_eur as number | null) ?? 0,
      temu_price_eur: 0,
    };
  }

  // Strategie 3: Fallback aus chat-description (Vinted hängt oft "Hi! Würdest du
  // mir diese(n) Artikel für X€ verkaufen?" + Listing-Title in chats.description)
  const chatRow = db
    .prepare(`SELECT vinted_conversation_id FROM chats WHERE id = ?`)
    .get(chatId) as Record<string, unknown> | undefined;
  if (chatRow) {
    return {
      folder_num: null,
      title: 'Vinted Artikel',
      description: '',
      category: '',
      size: '',
      brand: 'Ohne Marke',
      condition: 'Sehr gut',
      color: '',
      material: '',
      list_price_eur: 0,
      min_accept_price_eur: 0,
      temu_price_eur: 0,
    };
  }

  return null;
}

// ── Heuristic Intent (für Fallback und schnelle Vorklassifikation) ───────────

function heuristicIntent(text: string): Intent {
  const t = text.toLowerCase();
  if (/(€|eur|euro|preis|price)\s*\d|\d\s*(€|eur)|\d+\s*(off|aus|weniger|geben|für)/i.test(t)) return 'negotiation';
  if (/größe|gr\.|size|maß|cm|länge|breite|fits|fall/i.test(t)) return 'size';
  if (/versand|shipping|porto|ship|liefer/i.test(t)) return 'shipping';
  if (/danke|thank|hi|hallo|hey|moin/i.test(t)) return 'smalltalk';
  return 'other';
}

function extractRequestedPriceEur(text: string): number | null {
  const m = text.match(/(\d{1,4}(?:[\.,]\d{1,2})?)\s*(€|eur|euro)?/i);
  if (!m) return null;
  const v = parseFloat(m[1]!.replace(',', '.'));
  return Number.isFinite(v) && v > 0 && v < 10_000 ? v : null;
}

// ── Negotiation Floor ────────────────────────────────────────────────────────

function computeCounterPrice(
  ctx: ListingContext,
  requestedEur: number | null,
  maxDropPct: number,
): { accept: boolean; counter?: number; floor: number } {
  const floor = Math.max(
    ctx.min_accept_price_eur || 0,
    ctx.temu_price_eur ? ctx.temu_price_eur * 1.5 : 0,
    ctx.list_price_eur * (1 - maxDropPct / 100),
  );
  if (requestedEur === null) return { accept: false, floor };
  if (requestedEur >= floor) return { accept: true, counter: requestedEur, floor };
  // Counter zwischen Wunsch und Floor — wir nehmen mid + .99-Endung
  const mid = Math.max(requestedEur, floor);
  const counter = Math.floor(mid) + 0.99;
  return { accept: false, counter, floor };
}

// ── Template Replies (Fallback ohne LLM) ─────────────────────────────────────

function templateReply(intent: Intent, ctx: ListingContext, opts: { counter?: number; floor?: number; accept?: boolean }): string {
  switch (intent) {
    case 'size':
      return `Hey! Die Größe ist ${ctx.size}${ctx.material ? ` (Material: ${ctx.material})` : ''}. Bei Fragen einfach melden 💕`;
    case 'shipping':
      return `Hi! Versand geht morgen früh raus 📦 Du bekommst dann auch die Tracking-Nr.`;
    case 'negotiation':
      if (opts.accept && opts.counter) return `Klar, geht klar für ${opts.counter.toFixed(2)}€! Schick mir gerne ein Angebot 🌸`;
      if (opts.counter) return `Hey! ${opts.counter.toFixed(2)}€ wäre noch okay für mich, drunter geht leider nicht :)`;
      return 'Hey! Beim Preis kann ich leider nicht weiter runter, sorry 🙏';
    case 'smalltalk':
      return 'Hi! 💕 Wenn du Fragen hast, schreib mir gerne!';
    default:
      return 'Hi! Danke für die Nachricht — ich melde mich gleich nochmal!';
  }
}

// ── LLM Call ─────────────────────────────────────────────────────────────────

interface LlmReply {
  intent: Intent;
  reply: string;
  confidence?: number;
}

async function generateWithLlm(
  inText: string,
  ctx: ListingContext,
  negotiation: { accept: boolean; counter?: number; floor: number },
  marketplace: 'vinted' | 'kleinanzeigen' = 'vinted',
): Promise<LlmReply | null> {
  const seller = loadSellerContext();
  const sellerSnip = renderSellerSystemSnippet(seller);
  const personaLines = marketplace === 'kleinanzeigen'
    ? [
        'Du verkaufst auf eBay Kleinanzeigen. Schreibstil: freundlich, locker, deutsch.',
        'Antworten KURZ (1-2 Sätze), höflich, ohne Verkäufer-Floskeln. Emojis sparsam.',
        'Bei Versand: erwähne Anbieter wenn relevant. Bei Zahlung: nenne genau die Methoden, die in "Seller-Kontext" stehen.',
      ]
    : [
        'Du bist eine junge Frau auf Vinted, die ihre Klamotten verkauft.',
        'Antworte AUTHENTISCH, KURZ (max 2 Sätze), persönlich, mit Emojis sparsam.',
        'KEINE Werbe-Phrasen, KEINE Floskeln, kein Verkäufer-Stil.',
      ];
  const sys = [
    ...personaLines,
    'Sprache: Deutsch (außer Käufer schreibt englisch → englisch antworten).',
    'Wenn nach Bezahlung/Zahlungsweise gefragt wird, nenne EXAKT die Methoden aus "Seller-Kontext" — keine erfundenen Daten.',
    sellerSnip ? '' : '',
    sellerSnip,
    '',
    'KONTEXT zum Listing:',
    `- Titel: ${ctx.title}`,
    `- Größe: ${ctx.size}, Marke: ${ctx.brand}, Zustand: ${ctx.condition}`,
    `- Farbe: ${ctx.color}, Material: ${ctx.material}`,
    `- Preis: ${ctx.list_price_eur.toFixed(2)}€`,
    '',
    'VERHANDLUNGS-RICHTLINIEN:',
    `- Floor (kein Verkauf darunter): ${negotiation.floor.toFixed(2)}€`,
    negotiation.accept && negotiation.counter
      ? `- Käufer hat ${negotiation.counter.toFixed(2)}€ angeboten — das ist okay, akzeptiere höflich.`
      : negotiation.counter
        ? `- Käufer hat zu wenig geboten. Counter: ${negotiation.counter.toFixed(2)}€.`
        : '- Keine konkrete Verhandlung.',
    '',
    'OUTPUT als JSON, nur das Objekt, kein Markdown-Block:',
    '{"intent":"size|shipping|negotiation|smalltalk|other","reply":"<deine antwort>","confidence":0.0-1.0}',
  ].filter(Boolean).join('\n');

  const text = await callLLM({ system: sys, user: `Käufer schreibt: "${inText}"`, maxTokens: 400 });
  const parsed = parseLLMJson<Record<string, unknown>>(text);
  if (!parsed || typeof parsed.reply !== 'string') return null;
  const intent = (['size','shipping','negotiation','smalltalk','other'].includes(parsed.intent as string)
    ? parsed.intent : 'other') as Intent;
  return {
    intent,
    reply: (parsed.reply as string).slice(0, 600),
    confidence: typeof parsed.confidence === 'number' ? parsed.confidence : undefined,
  };
}

// ── Main: Generate Reply Draft ───────────────────────────────────────────────

export async function generateReplyForMessage(
  msg: InMessageRow,
): Promise<AutopilotResult | null> {
  const ctx = loadListingContext(msg.chat_id);
  if (!ctx) {
    log.warn('no listing context', { chat_id: msg.chat_id });
    return null;
  }

  const cfg = settings();
  const heuristic = heuristicIntent(msg.body);
  const requestedEur = extractRequestedPriceEur(msg.body);
  const negotiation = computeCounterPrice(ctx, requestedEur, cfg.maxDropPct);

  // 1. Versuche LLM
  const llm = await generateWithLlm(msg.body, ctx, negotiation);
  if (llm) {
    return {
      intent: llm.intent,
      draft: llm.reply,
      counterPriceEur: llm.intent === 'negotiation' ? negotiation.counter : undefined,
      confidence: llm.confidence,
      source: 'llm',
    };
  }

  // 2. Fallback Templates
  const draft = templateReply(heuristic, ctx, negotiation);
  return {
    intent: heuristic,
    draft,
    counterPriceEur: heuristic === 'negotiation' ? negotiation.counter : undefined,
    source: 'template',
  };
}

// ── Send via Vinted-Bot ──────────────────────────────────────────────────────

async function sendViaVintedBot(
  conversationId: string,
  body: string,
  accountId: number,
): Promise<{ ok: boolean; error?: string }> {
  try {
    // Existing endpoint: POST /chats/:chatId/send (in vinted-bot/api.ts)
    const url = `${VINTED_BOT_URL}/chats/${conversationId}/send?account=${accountId}`;
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ body }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!r.ok) {
      const txt = await r.text();
      return { ok: false, error: `HTTP ${r.status}: ${txt.slice(0, 200)}` };
    }
    const j = (await r.json()) as { ok?: boolean; error?: string };
    return { ok: !!j.ok, error: j.error };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ── KA: Unanswered Messages + Send + Context ────────────────────────────────

interface KaMessageRow {
  id: number;
  chat_id: number;
  body: string;
  account_id: number;
  ka_conversation_id: string;
  buyer_username: string;
  ad_title: string | null;
}

function findUnansweredKaIncoming(lookbackMin: number): KaMessageRow[] {
  return getDb()
    .prepare(
      `SELECT m.id, m.chat_id, m.body,
              c.account_id, c.ka_conversation_id, c.buyer_username, c.ad_title
         FROM kleinanzeigen_messages m
         JOIN kleinanzeigen_chats c ON c.id = m.chat_id
        WHERE m.direction = 'in'
          AND m.created_at >= datetime('now', '-' || ? || ' minutes')
          AND NOT EXISTS (
            SELECT 1 FROM kleinanzeigen_messages m2
             WHERE m2.chat_id = m.chat_id
               AND m2.direction = 'out'
               AND m2.created_at > m.created_at
          )
          AND NOT EXISTS (
            SELECT 1 FROM reply_autopilot_log r
             WHERE r.message_id = m.id
               AND r.marketplace = 'kleinanzeigen'
               AND r.status IN ('pending','sent','edited')
          )
        ORDER BY m.created_at ASC
        LIMIT 50`,
    )
    .all(lookbackMin) as KaMessageRow[];
}

function loadKaListingContext(chatId: number): ListingContext | null {
  // KA-Chats haben ad_title direkt im chats-Record. Listing-Preis können
  // wir aus marketplace_listings ziehen wenn das Listing über unsere Pipeline lief.
  const chat = getDb()
    .prepare(
      `SELECT c.ad_title, c.ad_url, ml.list_price_eur, ml.folder_num,
              al.size, al.brand, al.condition, al.color, al.material,
              al.description, al.category, al.temu_price_eur
         FROM kleinanzeigen_chats c
         LEFT JOIN marketplace_listings ml
           ON ml.marketplace = 'kleinanzeigen' AND ml.account_id = c.account_id AND ml.external_url = c.ad_url
         LEFT JOIN auto_listings al ON al.folder_num = ml.folder_num
        WHERE c.id = ?`,
    )
    .get(chatId) as Record<string, unknown> | undefined;
  if (!chat) return null;
  return {
    folder_num: (chat.folder_num as number | null) ?? null,
    title: (chat.ad_title as string | null) ?? 'Kleinanzeigen Artikel',
    description: (chat.description as string | null) ?? '',
    category: (chat.category as string | null) ?? '',
    size: (chat.size as string | null) ?? '',
    brand: (chat.brand as string | null) ?? 'Ohne Marke',
    condition: (chat.condition as string | null) ?? 'Sehr gut',
    color: (chat.color as string | null) ?? '',
    material: (chat.material as string | null) ?? '',
    list_price_eur: (chat.list_price_eur as number | null) ?? 0,
    min_accept_price_eur: ((chat.list_price_eur as number | null) ?? 0) * 0.7,
    temu_price_eur: (chat.temu_price_eur as number | null) ?? 0,
  };
}

async function sendViaKaBot(kaConvId: string, body: string, accountId: number): Promise<{ ok: boolean; error?: string }> {
  try {
    const r = await fetch(`${KA_BOT_URL}/api/chats/send`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ account_id: accountId, conversation_id: kaConvId, body }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!r.ok) return { ok: false, error: `HTTP ${r.status}` };
    const j = (await r.json()) as { ok: boolean; error?: string };
    return j;
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

async function sendViaDepopBot(depopConvId: string, body: string, accountId: number): Promise<{ ok: boolean; error?: string }> {
  try {
    const r = await fetch(`${DEPOP_BOT_URL}/api/chats/${encodeURIComponent(depopConvId)}/send`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ account_id: accountId, body }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!r.ok) return { ok: false, error: `HTTP ${r.status}` };
    const j = (await r.json()) as { ok: boolean; error?: string };
    return j;
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Generic dispatch — sends `body` to `marketplace`'s `/api/chats/:id/send`
 * endpoint via `BOT_ENDPOINTS[marketplace]`. Used for all marketplaces that
 * follow the standard route convention (mercari, wallapop, etsy, grailed,
 * vestiaire, whatnot, fb_marketplace, ebay_de, ebay_uk).
 *
 * Conversation IDs follow the per-bot scheme — Etsy uses `etsy:<n>`, Grailed
 * `grailed:<id>`, etc. The bot's send-route strips the prefix. We pass the
 * id verbatim — no prefix stripping at this layer.
 */
async function sendViaBot(
  marketplace: string,
  conversationId: string,
  body: string,
  accountId: number,
): Promise<{ ok: boolean; error?: string }> {
  const base = BOT_ENDPOINTS[marketplace as keyof typeof BOT_ENDPOINTS];
  if (!base || base === 'API') {
    return { ok: false, error: `no bot endpoint configured for ${marketplace}` };
  }
  try {
    const url = `${base}/api/chats/${encodeURIComponent(conversationId)}/send`;
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ account_id: accountId, body }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!r.ok) return { ok: false, error: `HTTP ${r.status}` };
    return (await r.json()) as { ok: boolean; error?: string };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ── Worker Cycle ─────────────────────────────────────────────────────────────

export interface CycleStats {
  scanned: number;
  drafted: number;
  sent: number;
  failed: number;
  skipped: number;
}

/**
 * Send any drafts whose scheduled_send_at has passed. This is the
 * "human-like 10-15min delay" mechanism: drafts are inserted with a future
 * scheduled_send_at, and a later cycle picks them up to actually deliver.
 */
async function flushDueDrafts(stats: CycleStats): Promise<void> {
  const due = getDb().prepare(
    `SELECT id, marketplace, chat_id, draft_text
       FROM reply_autopilot_log
      WHERE status = 'pending'
        AND mode = 'auto'
        AND scheduled_send_at IS NOT NULL
        AND scheduled_send_at <= datetime('now')
      ORDER BY scheduled_send_at ASC
      LIMIT 20`,
  ).all() as Array<{ id: number; marketplace: string; chat_id: number; draft_text: string }>;
  if (due.length === 0) return;
  log.info('Flushing due drafts', { count: due.length });

  for (const d of due) {
    try {
      let send: { ok: boolean; error?: string };
      if (d.marketplace === 'kleinanzeigen') {
        const chat = getDb().prepare(
          'SELECT ka_conversation_id, account_id FROM kleinanzeigen_chats WHERE id = ?',
        ).get(d.chat_id) as { ka_conversation_id: string; account_id: number } | undefined;
        if (!chat) { stats.skipped++; continue; }
        send = await sendViaKaBot(chat.ka_conversation_id, d.draft_text, chat.account_id);
      } else if (d.marketplace === 'depop') {
        const chat = getDb().prepare(
          'SELECT depop_conversation_id, account_id FROM depop_chats WHERE id = ?',
        ).get(d.chat_id) as { depop_conversation_id: string; account_id: number } | undefined;
        if (!chat) { stats.skipped++; continue; }
        send = await sendViaDepopBot(chat.depop_conversation_id, d.draft_text, chat.account_id);
      } else if (d.marketplace === 'vinted' || !d.marketplace) {
        const chat = getDb().prepare(
          'SELECT vinted_conversation_id, account_id FROM chats WHERE id = ?',
        ).get(d.chat_id) as { vinted_conversation_id: string; account_id: number } | undefined;
        if (!chat) { stats.skipped++; continue; }
        send = await sendViaVintedBot(chat.vinted_conversation_id, d.draft_text, chat.account_id);
      } else {
        // Generic path for mercari, wallapop, etsy, grailed, vestiaire,
        // whatnot, fb_marketplace, ebay_de, ebay_uk — they all store
        // conversation IDs in the `chats` table (prefixed where needed,
        // e.g. `etsy:<n>`, `grailed:<id>`). The bot's send-route strips
        // the prefix.
        const chat = getDb().prepare(
          'SELECT vinted_conversation_id, account_id FROM chats WHERE id = ?',
        ).get(d.chat_id) as { vinted_conversation_id: string; account_id: number } | undefined;
        if (!chat) { stats.skipped++; continue; }
        const convId = chat.vinted_conversation_id.includes(':')
          ? chat.vinted_conversation_id.split(':').slice(1).join(':')
          : chat.vinted_conversation_id;
        send = await sendViaBot(d.marketplace, convId, d.draft_text, chat.account_id);
      }
      if (send.ok) {
        getDb().prepare(
          `UPDATE reply_autopilot_log
              SET status='sent', sent_at=datetime('now'), send_attempted_at=datetime('now')
            WHERE id=?`,
        ).run(d.id);
        stats.sent++;
      } else {
        getDb().prepare(
          `UPDATE reply_autopilot_log
              SET status='failed', error=?, send_attempted_at=datetime('now')
            WHERE id=?`,
        ).run(send.error ?? 'unknown', d.id);
        stats.failed++;
      }
    } catch (err) {
      stats.failed++;
      log.error('flushDueDrafts entry failed', { id: d.id, err: String(err) });
    }
  }
}

export async function runReplyAutopilotCycle(): Promise<CycleStats> {
  const stats: CycleStats = { scanned: 0, drafted: 0, sent: 0, failed: 0, skipped: 0 };
  const cfg = settings();
  if (!cfg.enabled) {
    log.info('Auto-Reply disabled');
    return stats;
  }

  // Schritt 1: Sende fällige Drafts (10-15min später, menschlich)
  await flushDueDrafts(stats);

  // ── Vinted ──
  const vintedMessages = findUnansweredIncoming(cfg.lookbackMin);
  log.info('Auto-Reply scanning Vinted', { count: vintedMessages.length, mode: cfg.sendMode });

  for (const msg of vintedMessages) {
    stats.scanned++;
    try {
      const result = await generateReplyForMessage(msg);
      if (!result) { stats.skipped++; continue; }
      const meta = { source: result.source, confidence: result.confidence, counterPriceEur: result.counterPriceEur };
      const scheduledAt = cfg.sendMode === 'auto' ? scheduledSendIso(cfg) : null;
      const row = getDb().prepare(
        `INSERT INTO reply_autopilot_log
           (marketplace, chat_id, message_id, intent, in_text, draft_text, mode, status, meta_json, scheduled_send_at)
         VALUES ('vinted', ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
         RETURNING id`,
      ).get(
        msg.chat_id, msg.id, result.intent, msg.body, result.draft, cfg.sendMode, JSON.stringify(meta), scheduledAt,
      ) as { id: number };
      stats.drafted++;

      // In 'auto' Modus wird NICHT sofort gesendet, sondern auf
      // scheduled_send_at gewartet → flushDueDrafts erledigt das später.
      if (cfg.sendMode === 'auto') {
        log.info('Vinted reply scheduled', { id: row.id, scheduled_send_at: scheduledAt });
      }
    } catch (err) {
      stats.failed++;
      log.error('vinted reply gen failed', { msg_id: msg.id, err: String(err) });
    }
  }

  // ── Kleinanzeigen ──
  const kaMessages = findUnansweredKaIncoming(cfg.lookbackMin);
  log.info('Auto-Reply scanning KA', { count: kaMessages.length, mode: cfg.sendMode });

  for (const msg of kaMessages) {
    stats.scanned++;
    try {
      const ctx = loadKaListingContext(msg.chat_id);
      if (!ctx) { stats.skipped++; continue; }
      const heuristic = heuristicIntent(msg.body);
      const requested = extractRequestedPriceEur(msg.body);
      const negotiation = computeCounterPrice(ctx, requested, cfg.maxDropPct);
      const llm = await generateWithLlm(msg.body, ctx, negotiation, 'kleinanzeigen');
      const result: AutopilotResult = llm
        ? { intent: llm.intent, draft: llm.reply, counterPriceEur: llm.intent === 'negotiation' ? negotiation.counter : undefined, confidence: llm.confidence, source: 'llm' }
        : { intent: heuristic, draft: templateReply(heuristic, ctx, negotiation), counterPriceEur: heuristic === 'negotiation' ? negotiation.counter : undefined, source: 'template' };
      const meta = { source: result.source, confidence: result.confidence, counterPriceEur: result.counterPriceEur };
      const scheduledAt = cfg.sendMode === 'auto' ? scheduledSendIso(cfg) : null;
      const row = getDb().prepare(
        `INSERT INTO reply_autopilot_log
           (marketplace, chat_id, message_id, intent, in_text, draft_text, mode, status, meta_json, scheduled_send_at)
         VALUES ('kleinanzeigen', ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
         RETURNING id`,
      ).get(
        msg.chat_id, msg.id, result.intent, msg.body, result.draft, cfg.sendMode, JSON.stringify(meta), scheduledAt,
      ) as { id: number };
      stats.drafted++;

      if (cfg.sendMode === 'auto') {
        log.info('KA reply scheduled', { id: row.id, scheduled_send_at: scheduledAt });
      }
    } catch (err) {
      stats.failed++;
      log.error('ka reply gen failed', { msg_id: msg.id, err: String(err) });
    }
  }

  log.info('Auto-Reply cycle done', stats);
  return stats;
}

// ── Manual Send / Edit / Reject (Routes nutzen das) ──────────────────────────

export async function sendDraftReply(logId: number, editedBody?: string): Promise<{ ok: boolean; error?: string }> {
  const meta = getDb()
    .prepare('SELECT id, marketplace, chat_id, draft_text FROM reply_autopilot_log WHERE id = ?')
    .get(logId) as { id: number; marketplace: string; chat_id: number; draft_text: string } | undefined;
  if (!meta) return { ok: false, error: 'log entry not found' };
  const body = editedBody ?? meta.draft_text;

  let send: { ok: boolean; error?: string };
  if (meta.marketplace === 'kleinanzeigen') {
    const chat = getDb()
      .prepare('SELECT ka_conversation_id, account_id FROM kleinanzeigen_chats WHERE id = ?')
      .get(meta.chat_id) as { ka_conversation_id: string; account_id: number } | undefined;
    if (!chat) return { ok: false, error: 'ka chat not found' };
    send = await sendViaKaBot(chat.ka_conversation_id, body, chat.account_id);
  } else if (meta.marketplace === 'depop') {
    const chat = getDb()
      .prepare('SELECT depop_conversation_id, account_id FROM depop_chats WHERE id = ?')
      .get(meta.chat_id) as { depop_conversation_id: string; account_id: number } | undefined;
    if (!chat) return { ok: false, error: 'depop chat not found' };
    send = await sendViaDepopBot(chat.depop_conversation_id, body, chat.account_id);
  } else {
    const chat = getDb()
      .prepare('SELECT vinted_conversation_id, account_id FROM chats WHERE id = ?')
      .get(meta.chat_id) as { vinted_conversation_id: string; account_id: number } | undefined;
    if (!chat) return { ok: false, error: 'vinted chat not found' };
    send = await sendViaVintedBot(chat.vinted_conversation_id, body, chat.account_id);
  }
  if (send.ok) {
    getDb().prepare(
      `UPDATE reply_autopilot_log
          SET status = ?, draft_text = ?, sent_at = datetime('now'), send_attempted_at = datetime('now')
        WHERE id = ?`,
    ).run(editedBody ? 'edited' : 'sent', body, logId);
  } else {
    getDb().prepare(
      `UPDATE reply_autopilot_log
          SET status = 'failed', error = ?, send_attempted_at = datetime('now')
        WHERE id = ?`,
    ).run(send.error ?? 'unknown', logId);
  }
  return send;
}

export function rejectDraftReply(logId: number): void {
  getDb()
    .prepare(`UPDATE reply_autopilot_log SET status = 'rejected' WHERE id = ?`)
    .run(logId);
}

export function pendingReplies(limit = 50): unknown[] {
  // Vinted-Drafts mit buyer_username aus chats
  const v = getDb()
    .prepare(
      `SELECT r.*, c.buyer_username, c.vinted_conversation_id AS conversation_id
         FROM reply_autopilot_log r
         JOIN chats c ON c.id = r.chat_id
        WHERE r.status = 'pending' AND r.marketplace = 'vinted'`,
    )
    .all() as Array<Record<string, unknown>>;
  // KA-Drafts mit buyer_username aus kleinanzeigen_chats
  const ka = getDb()
    .prepare(
      `SELECT r.*, c.buyer_username, c.ka_conversation_id AS conversation_id
         FROM reply_autopilot_log r
         JOIN kleinanzeigen_chats c ON c.id = r.chat_id
        WHERE r.status = 'pending' AND r.marketplace = 'kleinanzeigen'`,
    )
    .all() as Array<Record<string, unknown>>;
  return [...v, ...ka]
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
    .slice(0, limit);
}

export function recentReplyLog(limit = 100): unknown[] {
  const v = getDb()
    .prepare(
      `SELECT r.*, c.buyer_username
         FROM reply_autopilot_log r
         JOIN chats c ON c.id = r.chat_id
        WHERE r.marketplace = 'vinted'`,
    )
    .all() as Array<Record<string, unknown>>;
  const ka = getDb()
    .prepare(
      `SELECT r.*, c.buyer_username
         FROM reply_autopilot_log r
         JOIN kleinanzeigen_chats c ON c.id = r.chat_id
        WHERE r.marketplace = 'kleinanzeigen'`,
    )
    .all() as Array<Record<string, unknown>>;
  return [...v, ...ka]
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
    .slice(0, limit);
}

// ── Scheduler-Hook ──────────────────────────────────────────────────────────

let timer: NodeJS.Timeout | null = null;

export function startReplyAutopilot(): void {
  if (timer) return;
  const cfg = settings();
  const ms = Math.max(60, cfg.intervalMin * 60) * 1000;
  log.info(`Reply-Autopilot scheduled every ${cfg.intervalMin}m, mode=${cfg.sendMode}`);
  setTimeout(() => { void runReplyAutopilotCycle().catch((e) => log.error('first run', { err: String(e) })); }, 30_000);
  timer = setInterval(() => {
    void runReplyAutopilotCycle().catch((e) => log.error('scheduled run', { err: String(e) }));
  }, ms);
}

export function stopReplyAutopilot(): void {
  if (timer) { clearInterval(timer); timer = null; log.info('Reply-Autopilot stopped'); }
}
