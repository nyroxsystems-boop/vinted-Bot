// ──────────────────────────────────────────────────────────────────────────────
// Depop Inbox Poller
//
// Depop has no public messaging API, so we drive the web inbox via Playwright:
//   1. Navigate to /messages/ (CF-safe)
//   2. Scrape each conversation card → conversation_id + buyer_username + ad
//   3. Open each chat (only when unread or new) → scrape messages
//   4. Persist into depop_chats / depop_messages
//
// Returns a PollStats summary so the orchestrator can log per-tick numbers.
// ──────────────────────────────────────────────────────────────────────────────

import type { Page, BrowserContext } from 'playwright';
import {
  createLogger,
  getDb,
  cloudflareSafeNavigate,
} from '@vinted-system/shared';
import {
  SEL_INBOX_ITEM,
  SEL_CHAT_HEADER_BUYER,
  SEL_CHAT_LISTING_LINK,
  SEL_CHAT_MESSAGE_ITEM,
  SEL_OFFER_BUBBLE,
} from '../selectors.js';

const log = createLogger('depop-chats-poll');
const INBOX_URL = 'https://www.depop.com/messages/';
const BASE = 'https://www.depop.com';

const GBP_TO_EUR = Number(process.env.GBP_EUR_RATE ?? 1.16);

export interface PollStats {
  conversations: number;
  newMessages: number;
  errors: number;
}

interface ScrapedMessage {
  body: string;
  direction: 'in' | 'out';
  depop_message_id: string | null;
  is_offer: boolean;
  offer_amount_gbp: number | null;
  offer_state: 'pending' | 'accepted' | 'declined' | 'expired' | null;
  // ISO timestamp of the original send-time when Depop's DOM exposes it
  // (<time datetime> or [datetime]). null → INSERT falls back to datetime('now').
  ts: string | null;
}

interface ScrapedConversation {
  depop_conversation_id: string;
  url: string;
  buyer_username: string;
  ad_title: string | null;
  ad_url: string | null;
  ad_product_id: string | null;
  unread: boolean;
  messages: ScrapedMessage[];
}

function extractConversationId(href: string): string {
  // /messages/abc123  or  /messages/abc-123?foo=bar
  const m = href.match(/\/messages\/([^/?#]+)/);
  return m?.[1] ?? href;
}

function extractProductId(href: string): string | null {
  const m = href.match(/\/products\/([a-zA-Z0-9_-]+)/);
  return m?.[1] ?? null;
}

async function scrapeInboxList(page: Page): Promise<Array<{ id: string; url: string; unread: boolean }>> {
  // Wait for at least one item or 'no messages' state.
  await page.waitForTimeout(1500);
  const items = await page.evaluate(() => {
    const anchors = Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href^="/messages/"]'));
    return anchors.map((a) => {
      const href = a.getAttribute('href') ?? '';
      // Heuristic: look for any sibling/descendant element with "unread" hint
      const card = a.closest('li, article, [role="listitem"]') ?? a;
      const hasUnreadDot = !!card.querySelector(
        '[data-testid="unread-indicator"], [class*="UnreadDot" i], [aria-label*="unread" i]',
      );
      const boldText = !!card.querySelector('strong, b, [class*="bold" i]');
      return { href, unread: hasUnreadDot || boldText };
    });
  });
  // Dedupe + normalise
  const seen = new Set<string>();
  const out: Array<{ id: string; url: string; unread: boolean }> = [];
  for (const it of items) {
    if (!it.href || !it.href.startsWith('/messages/')) continue;
    const id = extractConversationId(it.href);
    if (id === 'messages' || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, url: BASE + it.href, unread: it.unread });
  }
  return out;
}

async function scrapeConversation(page: Page, convUrl: string): Promise<ScrapedConversation | null> {
  const nav = await cloudflareSafeNavigate(page, convUrl, { timeoutMs: 25_000 });
  if (!nav.ok) {
    log.warn('Conversation navigation failed', { url: convUrl, error: nav.error });
    return null;
  }
  await page.waitForTimeout(900);

  let buyer = 'unknown';
  try {
    const t = await SEL_CHAT_HEADER_BUYER.resolve(page);
    buyer = ((await t.textContent()) ?? '').trim() || buyer;
  } catch { /* */ }

  let adTitle: string | null = null;
  let adUrl: string | null = null;
  let adProductId: string | null = null;
  try {
    const a = await SEL_CHAT_LISTING_LINK.resolve(page);
    adTitle = ((await a.textContent()) ?? '').trim() || null;
    const href = await a.getAttribute('href');
    if (href) {
      adUrl = href.startsWith('http') ? href : BASE + href;
      adProductId = extractProductId(adUrl);
    }
  } catch { /* */ }

  // Scrape message bubbles
  const messages = await page.evaluate(() => {
    const sels = [
      '[data-testid^="message-"]',
      '[class*="MessageBubble" i]',
    ];
    const nodes: Element[] = [];
    for (const s of sels) {
      const got = Array.from(document.querySelectorAll(s));
      if (got.length > 0) { nodes.push(...got); break; }
    }
    return nodes.map((n) => {
      // direction: 'out' if the bubble is right-aligned ("self") - heuristic
      const cls = (n.className ?? '').toString().toLowerCase();
      const isOut =
        cls.includes('right') ||
        cls.includes('self') ||
        cls.includes('outgoing') ||
        cls.includes('sent') ||
        !!n.querySelector('[data-direction="out"]');
      const text = (n.textContent ?? '').trim();
      const id = n.getAttribute('data-testid') ?? n.getAttribute('id') ?? null;
      // Real send-time: Depop renders timestamps as <time datetime> inside
      // each bubble (or as a [datetime] attribute). Capture so the INSERT
      // can persist the actual message time instead of scrape-time.
      const timeEl = n.querySelector('time[datetime], [datetime]');
      const ts = timeEl?.getAttribute('datetime') ?? null;
      // Offer detection
      const isOffer =
        cls.includes('offer') ||
        text.toLowerCase().includes('made an offer') ||
        text.toLowerCase().includes('offered') ||
        !!n.querySelector('[data-testid="offer-message"], [class*="OfferMessage" i]');
      // Try to parse "£12.50"
      const m = text.match(/£\s*([0-9]+(?:[.,][0-9]{1,2})?)/);
      const offerAmount = isOffer && m && m[1] ? Number(m[1].replace(',', '.')) : null;
      let offerState: 'pending' | 'accepted' | 'declined' | 'expired' | null = null;
      if (isOffer) {
        if (/accepted/i.test(text)) offerState = 'accepted';
        else if (/declined|rejected/i.test(text)) offerState = 'declined';
        else if (/expired/i.test(text)) offerState = 'expired';
        else offerState = 'pending';
      }
      return { body: text, direction: (isOut ? 'out' : 'in') as 'in' | 'out', id, isOffer, offerAmount, offerState, ts };
    });
  }).catch(() => [] as Array<{
    body: string; direction: 'in' | 'out'; id: string | null;
    isOffer: boolean; offerAmount: number | null;
    offerState: 'pending' | 'accepted' | 'declined' | 'expired' | null;
    ts: string | null;
  }>);

  const convId = extractConversationId(convUrl);
  return {
    depop_conversation_id: convId,
    url: convUrl,
    buyer_username: buyer,
    ad_title: adTitle,
    ad_url: adUrl,
    ad_product_id: adProductId,
    unread: false, // caller fills from inbox-list
    messages: messages
      .filter((m) => m.body.length > 0)
      .map((m) => ({
        body: m.body,
        direction: m.direction,
        depop_message_id: m.id,
        is_offer: m.isOffer,
        offer_amount_gbp: m.offerAmount,
        offer_state: m.offerState,
        ts: m.ts,
      })),
  };
}

function persistConversation(accountId: number, conv: ScrapedConversation): { newMessages: number } {
  const db = getDb();
  // Last-message time: use the real timestamp of the most recent bubble if
  // the scraper could read it; otherwise fall back to scrape-time.
  const lastMessageAt =
    [...conv.messages].reverse().find((m) => m.ts)?.ts ?? new Date().toISOString();

  // Upsert chat row
  db.prepare(`
    INSERT INTO depop_chats
      (account_id, depop_conversation_id, buyer_username, ad_title, ad_url, ad_product_id, unread, last_message_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(depop_conversation_id) DO UPDATE SET
      buyer_username = excluded.buyer_username,
      ad_title       = excluded.ad_title,
      ad_url         = excluded.ad_url,
      ad_product_id  = excluded.ad_product_id,
      unread         = excluded.unread,
      last_message_at = excluded.last_message_at,
      updated_at     = datetime('now')
  `).run(
    accountId,
    conv.depop_conversation_id,
    conv.buyer_username,
    conv.ad_title,
    conv.ad_url,
    conv.ad_product_id,
    conv.unread ? 1 : 0,
    lastMessageAt,
  );

  const chat = db.prepare(`SELECT id FROM depop_chats WHERE depop_conversation_id = ?`).get(
    conv.depop_conversation_id,
  ) as { id: number };

  let newMessages = 0;
  const ins = db.prepare(`
    INSERT INTO depop_messages
      (chat_id, direction, body, is_offer, offer_amount_gbp, offer_amount_eur, offer_state, depop_message_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, datetime('now')))
    ON CONFLICT(depop_message_id) DO NOTHING
  `);
  for (const m of conv.messages) {
    const eur = m.offer_amount_gbp != null ? Math.round(m.offer_amount_gbp * GBP_TO_EUR * 100) / 100 : null;
    const result = ins.run(
      chat.id,
      m.direction,
      m.body,
      m.is_offer ? 1 : 0,
      m.offer_amount_gbp,
      eur,
      m.offer_state,
      m.depop_message_id,
      m.ts ?? null,
    );
    if (result.changes > 0) newMessages++;
  }
  return { newMessages };
}

/**
 * Poll the Depop inbox for `accountId`. Returns stats. Idempotent: re-polling
 * does not duplicate messages because `depop_message_id` is unique-indexed.
 */
export async function pollDepopInbox(
  accountId: number,
  ctx: BrowserContext,
): Promise<PollStats> {
  const stats: PollStats = { conversations: 0, newMessages: 0, errors: 0 };
  const page = await ctx.newPage();
  try {
    const nav = await cloudflareSafeNavigate(page, INBOX_URL, { timeoutMs: 30_000 });
    if (!nav.ok) {
      log.warn('Inbox navigation blocked', { error: nav.error });
      stats.errors++;
      return stats;
    }

    const items = await scrapeInboxList(page);
    log.info('Inbox items found', { count: items.length, unread: items.filter((i) => i.unread).length });

    for (const item of items) {
      try {
        const conv = await scrapeConversation(page, item.url);
        if (!conv) { stats.errors++; continue; }
        conv.unread = item.unread;
        const r = persistConversation(accountId, conv);
        stats.conversations++;
        stats.newMessages += r.newMessages;
        // Tiny human-ish pause between conversations
        await page.waitForTimeout(500 + Math.floor(Math.random() * 500));
      } catch (err) {
        log.warn('Conversation scrape failed', { url: item.url, error: err instanceof Error ? err.message : String(err) });
        stats.errors++;
      }
    }
    return stats;
  } finally {
    await page.close();
  }
}
