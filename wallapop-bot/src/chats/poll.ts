// ──────────────────────────────────────────────────────────────────────────────
// Wallapop Inbox Poller
//
// Walks Wallapop's chat inbox and returns a structured list of conversations
// with their recent messages. Stateless — orchestrator decides how to persist
// (no `wallapop_chats` table exists yet).
//
// Selectors are best-effort. Where the live DOM differs from our guess, the
// chain dumps diagnostics to `_diag/`.
// ──────────────────────────────────────────────────────────────────────────────

import type { BrowserContext, Page } from 'playwright';
import { createLogger } from '@vinted-system/shared';
import {
  SEL_LOGGED_IN,
  SEL_INBOX_ITEM,
  SEL_CHAT_HEADER_BUYER,
  SEL_CHAT_LISTING_LINK,
} from '../selectors.js';

const log = createLogger('wp-chats-poll');
const BASE_URL = process.env.WALLAPOP_BASE_URL ?? 'https://es.wallapop.com';

// Wallapop chat inbox URL — TODO: validate (could also be /app/chat).
const INBOX_URL = `${BASE_URL}/app/chat`;

export interface ScrapedMessage {
  body: string;
  direction: 'in' | 'out';
  externalMessageId: string | null;
  isOffer: boolean;
  offerAmountEur: number | null;
}

export interface ScrapedConversation {
  conversationId: string;
  url: string;
  buyerUsername: string;
  itemTitle: string | null;
  itemUrl: string | null;
  itemExternalId: string | null;
  unread: boolean;
  messages: ScrapedMessage[];
}

export interface PollStats {
  conversations: number;
  newMessages: number;
  newOffers: number;
  errors: number;
  items: ScrapedConversation[];
}

function extractConversationId(href: string): string {
  // Wallapop conversation URLs look like /chat/<id> or /app/chat?id=<id>.
  const path = href.match(/\/chat\/([^/?#]+)/);
  if (path?.[1]) return path[1];
  const query = href.match(/[?&]id=([^&#]+)/);
  return query?.[1] ?? href;
}

function extractItemId(href: string): string | null {
  const m = href.match(/\/item\/([a-zA-Z0-9_-]+)/);
  return m?.[1] ?? null;
}

async function scrapeInboxList(page: Page): Promise<Array<{ id: string; url: string; unread: boolean }>> {
  await page.waitForTimeout(1500);
  if (!(await SEL_INBOX_ITEM.exists(page))) {
    log.warn('No inbox items detected at /app/chat');
    return [];
  }

  const raw = await page.evaluate(() => {
    const anchors = Array.from(
      document.querySelectorAll<HTMLAnchorElement>(
        'a[href*="/chat/"], a[href*="/conversation"]',
      ),
    );
    return anchors.map((a) => {
      const href = a.getAttribute('href') ?? '';
      const card = a.closest('li, article, [role="listitem"]') ?? a;
      const hasUnreadDot = !!card.querySelector(
        '[data-testid*="unread" i], [class*="unread" i], [aria-label*="no leído" i], [aria-label*="unread" i]',
      );
      return { href, unread: hasUnreadDot };
    });
  });

  const seen = new Set<string>();
  const out: Array<{ id: string; url: string; unread: boolean }> = [];
  for (const it of raw) {
    if (!it.href) continue;
    const id = extractConversationId(it.href);
    if (!id || id === 'chat' || id === 'conversation' || seen.has(id)) continue;
    seen.add(id);
    const url = it.href.startsWith('http') ? it.href : `${BASE_URL}${it.href}`;
    out.push({ id, url, unread: it.unread });
  }
  return out;
}

async function scrapeConversation(
  page: Page,
  convUrl: string,
): Promise<ScrapedConversation | null> {
  try {
    await page.goto(convUrl, { waitUntil: 'domcontentloaded', timeout: 25_000 });
  } catch (err) {
    log.warn('Conversation nav failed', { url: convUrl, error: err instanceof Error ? err.message : String(err) });
    return null;
  }
  await page.waitForTimeout(900);

  let buyer = 'unknown';
  try {
    const el = await SEL_CHAT_HEADER_BUYER.resolve(page);
    buyer = ((await el.textContent()) ?? '').trim() || buyer;
  } catch { /* selector drift — non-fatal */ }

  let itemTitle: string | null = null;
  let itemUrl: string | null = null;
  let itemExternalId: string | null = null;
  try {
    const link = await SEL_CHAT_LISTING_LINK.resolve(page);
    itemTitle = ((await link.textContent()) ?? '').trim() || null;
    const href = await link.getAttribute('href');
    if (href) {
      itemUrl = href.startsWith('http') ? href : `${BASE_URL}${href}`;
      itemExternalId = extractItemId(itemUrl);
    }
  } catch { /* */ }

  const messages = await page.evaluate(() => {
    const sels = [
      '[data-testid^="message-"]',
      '[class*="MessageBubble" i]',
      '[class*="message-bubble" i]',
    ];
    let nodes: Element[] = [];
    for (const s of sels) {
      const got = Array.from(document.querySelectorAll(s));
      if (got.length > 0) { nodes = got; break; }
    }

    return nodes.map((n) => {
      const cls = (n.className ?? '').toString().toLowerCase();
      const isOut =
        cls.includes('right') ||
        cls.includes('self') ||
        cls.includes('outgoing') ||
        cls.includes('sent') ||
        cls.includes('propietario') ||
        !!n.querySelector('[data-direction="out"]');
      const text = (n.textContent ?? '').trim();
      const id = n.getAttribute('data-testid') ?? n.getAttribute('id') ?? null;
      const lower = text.toLowerCase();
      // Spanish offer phrasings: "ha hecho una oferta", "te ofrece"
      const isOffer =
        cls.includes('offer') || cls.includes('oferta') ||
        lower.includes('ha hecho una oferta') ||
        lower.includes('te ofrece') ||
        lower.includes('made an offer') ||
        !!n.querySelector('[data-testid*="offer" i], [class*="OfferMessage" i]');
      const m = text.match(/(\d+(?:[.,]\d{1,2})?)\s*€/);
      const offerAmount = isOffer && m && m[1] ? Number(m[1].replace(',', '.')) : null;
      return { body: text, direction: (isOut ? 'out' : 'in') as 'in' | 'out', id, isOffer, offerAmount };
    });
  }).catch(() => [] as Array<{
    body: string; direction: 'in' | 'out'; id: string | null;
    isOffer: boolean; offerAmount: number | null;
  }>);

  const convId = extractConversationId(convUrl);
  return {
    conversationId: convId,
    url: convUrl,
    buyerUsername: buyer,
    itemTitle,
    itemUrl,
    itemExternalId,
    unread: false, // filled in by caller
    messages: messages
      .filter((m) => m.body.length > 0)
      .map((m) => ({
        body: m.body,
        direction: m.direction,
        externalMessageId: m.id,
        isOffer: m.isOffer,
        offerAmountEur: m.offerAmount,
      })),
  };
}

/**
 * Poll Wallapop inbox for `accountId`. Returns a structured payload —
 * persistence is the orchestrator's responsibility.
 */
export async function pollWallapopInbox(
  accountId: number,
  ctx: BrowserContext,
): Promise<PollStats> {
  const stats: PollStats = {
    conversations: 0,
    newMessages: 0,
    newOffers: 0,
    errors: 0,
    items: [],
  };
  const page = await ctx.newPage();
  try {
    await page.goto(INBOX_URL, { waitUntil: 'domcontentloaded', timeout: 25_000 });

    if (!(await SEL_LOGGED_IN.exists(page))) {
      log.warn('Inbox poll: not logged in', { accountId });
      stats.errors++;
      return stats;
    }

    const items = await scrapeInboxList(page);
    log.info('Inbox items found', {
      accountId,
      count: items.length,
      unread: items.filter((i) => i.unread).length,
    });

    for (const item of items) {
      try {
        const conv = await scrapeConversation(page, item.url);
        if (!conv) { stats.errors++; continue; }
        conv.unread = item.unread;
        stats.items.push(conv);
        stats.conversations++;
        stats.newMessages += conv.messages.length;
        stats.newOffers += conv.messages.filter((m) => m.isOffer).length;
        await page.waitForTimeout(400 + Math.floor(Math.random() * 400));
      } catch (err) {
        log.warn('Conversation scrape failed', {
          url: item.url,
          error: err instanceof Error ? err.message : String(err),
        });
        stats.errors++;
      }
    }
    return stats;
  } finally {
    await page.close().catch(() => null);
  }
}
