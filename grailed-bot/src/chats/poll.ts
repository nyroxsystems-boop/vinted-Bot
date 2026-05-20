// ──────────────────────────────────────────────────────────────────────────────
// Grailed Inbox Poller
//
// Grailed messages live under /messages. We scrape the conversation list
// (left rail), then walk each thread to extract messages + buyer offers.
//
// Offers are a Grailed core feature: buyers send a numeric offer in USD and
// the seller accepts/declines. Detection heuristic:
//   - bubble text contains "made an offer" or "offered $X"
//   - or [data-testid="offer-message"] / class*=offer
//
// All navigations go through cloudflareSafeNavigate.
// ──────────────────────────────────────────────────────────────────────────────

import type { Page, Locator } from 'playwright';
import {
  createLogger,
  getDb,
  cloudflareSafeNavigate,
} from '@vinted-system/shared';
import { launchGrailed, isGrailedLoggedIn, GRAILED_BASE_URL } from '../browser.js';

const log = createLogger('grailed-poll');

const INBOX_URL = '/messages';

const USD_TO_EUR = Number(process.env.USD_EUR_RATE ?? 0.92);

// TODO: validate selectors against live site.
const CONVERSATION_ROW = [
  '[data-testid^="conversation-"]',
  '[data-testid*="conversation"]',
  'a[href*="/messages/"]',
  '[class*="conversation-row" i]',
  '[class*="ConversationListItem" i]',
].join(', ');

const MESSAGE_BUBBLE = [
  '[data-testid^="message-"]',
  '[data-testid*="message-bubble"]',
  '[class*="MessageBubble" i]',
  '[class*="ChatMessage" i]',
].join(', ');

const CHAT_LISTING_LINK = 'a[href^="/listings/"], a[href*="/listings/"]';

interface ConversationInfo {
  conversationId: string;
  buyerUsername: string;
  lastSnippet: string;
  lastDateLabel: string;
}

interface ScrapedMessage {
  externalMessageId: string | null;
  direction: 'in' | 'out';
  body: string;
  isOffer: boolean;
  offerAmountUsd: number | null;
}

export async function pollGrailedInbox(
  accountId: number,
): Promise<{ newMessages: number; newOffers: number }> {
  const ctx = await launchGrailed(accountId, true);
  const page = await ctx.newPage();
  let newMessages = 0;
  let newOffers = 0;

  try {
    const home = await cloudflareSafeNavigate(page, GRAILED_BASE_URL, { timeoutMs: 25_000 });
    if (!home.ok) {
      log.warn('Home navigation blocked', { error: home.error });
      return { newMessages: 0, newOffers: 0 };
    }
    if (!(await isGrailedLoggedIn(page))) {
      log.warn('Not authenticated — skipping poll');
      return { newMessages: 0, newOffers: 0 };
    }

    const nav = await cloudflareSafeNavigate(page, `${GRAILED_BASE_URL}${INBOX_URL}`, { timeoutMs: 25_000 });
    if (!nav.ok) {
      log.warn('Inbox navigation blocked', { error: nav.error });
      return { newMessages: 0, newOffers: 0 };
    }
    await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => null);

    const conversations = await discoverConversations(page);
    log.info(`Found ${conversations.length} conversations`);

    for (const conv of conversations) {
      const { chatId, listingId } = upsertChat(conv, accountId);
      const messages = await scrapeConversationMessages(page, conv.conversationId);
      for (const msg of messages) {
        const inserted = insertMessageIfNew(chatId, msg);
        if (inserted) {
          newMessages++;
          if (msg.isOffer && msg.offerAmountUsd != null && msg.direction === 'in') {
            const amountEur = Math.round(msg.offerAmountUsd * USD_TO_EUR * 100) / 100;
            createPendingOffer(chatId, listingId, amountEur);
            newOffers++;
            log.info('New offer detected', {
              chatId,
              amountEur,
              usd: msg.offerAmountUsd,
            });
          }
        }
      }
    }
    return { newMessages, newOffers };
  } catch (err) {
    log.warn('pollGrailedInbox failed', {
      err: err instanceof Error ? err.message : String(err),
    });
    return { newMessages: 0, newOffers: 0 };
  } finally {
    await page.close().catch(() => null);
    await ctx.close().catch(() => null);
  }
}

async function discoverConversations(page: Page): Promise<ConversationInfo[]> {
  const rows = page.locator(CONVERSATION_ROW);
  const count = await rows.count();
  const seen = new Set<string>();
  const out: ConversationInfo[] = [];

  for (let i = 0; i < Math.min(count, 50); i++) {
    const row = rows.nth(i);
    try {
      const href =
        (await row.getAttribute('href').catch(() => null))
        ?? (await row.locator('a[href*="/messages/"]').first().getAttribute('href').catch(() => null));
      let conversationId: string | null = null;
      if (href) {
        const m = href.match(/\/messages\/([^/?#]+)/);
        if (m?.[1] && m[1] !== 'messages') conversationId = m[1];
      }
      if (!conversationId) continue;
      if (seen.has(conversationId)) continue;
      seen.add(conversationId);

      const fullText = (await row.innerText({ timeout: 1_500 }).catch(() => '')).trim();
      const { username, snippet, dateLabel } = parseConversationRow(fullText);

      out.push({
        conversationId,
        buyerUsername: username,
        lastSnippet: snippet,
        lastDateLabel: dateLabel,
      });
    } catch {
      // skip broken row
    }
  }
  return out;
}

function parseConversationRow(raw: string): {
  username: string;
  dateLabel: string;
  snippet: string;
} {
  const lines = raw.split('\n').map((l) => l.trim()).filter(Boolean);
  const [username = 'unknown', dateLabel = '', snippet = ''] = lines;
  return { username, dateLabel, snippet };
}

async function scrapeConversationMessages(
  page: Page,
  conversationId: string,
): Promise<ScrapedMessage[]> {
  const url = `${GRAILED_BASE_URL}/messages/${conversationId}`;
  if (!page.url().includes(`/messages/${conversationId}`)) {
    const nav = await cloudflareSafeNavigate(page, url, { timeoutMs: 25_000 });
    if (!nav.ok) return [];
  }
  await page.waitForTimeout(1_200);

  const items = page.locator(MESSAGE_BUBBLE);
  const count = await items.count();
  const out: ScrapedMessage[] = [];

  for (let i = 0; i < count; i++) {
    const item = items.nth(i);
    const body = (await item.innerText({ timeout: 1_500 }).catch(() => '')).trim();
    if (!body) continue;

    const externalMessageId =
      (await item.getAttribute('data-message-id').catch(() => null))
      ?? (await item.getAttribute('data-testid').catch(() => null));
    const direction = await inferDirection(item);

    const cls = (await item.getAttribute('class').catch(() => '')) ?? '';
    const lc = cls.toLowerCase();
    const isOfferClass = lc.includes('offer');
    const isOfferText = /made an offer|offered \$|offer:/i.test(body);
    const isOffer = isOfferClass || isOfferText;

    let offerAmountUsd: number | null = null;
    if (isOffer) {
      const m = body.match(/\$\s*([0-9]+(?:[.,][0-9]{1,2})?)/);
      if (m?.[1]) offerAmountUsd = Number(m[1].replace(',', '.'));
    }

    out.push({ externalMessageId, direction, body, isOffer, offerAmountUsd });
  }
  return out;
}

async function inferDirection(item: Locator): Promise<'in' | 'out'> {
  try {
    const box = await item.boundingBox();
    if (!box) return 'in';
    const page = item.page();
    const vp = page.viewportSize();
    if (!vp) return 'in';
    const midX = vp.width / 2;
    const center = box.x + box.width / 2;
    return center > midX ? 'out' : 'in';
  } catch {
    return 'in';
  }
}

function upsertChat(conv: ConversationInfo, accountId: number): { chatId: number; listingId: number | null } {
  const db = getDb();
  const key = `grailed:${conv.conversationId}`;
  const lastMsgAt = conv.lastDateLabel || new Date().toISOString();
  const existing = db
    .prepare('SELECT id, vinted_item_id FROM chats WHERE vinted_conversation_id = ?')
    .get(key) as { id: number; vinted_item_id: string | null } | undefined;

  let chatId: number;
  if (existing) {
    db.prepare(
      `UPDATE chats SET last_message_at = ?,
              buyer_username = CASE WHEN ? = 'unknown' THEN buyer_username ELSE ? END
        WHERE id = ?`,
    ).run(lastMsgAt, conv.buyerUsername, conv.buyerUsername, existing.id);
    chatId = existing.id;
  } else {
    const res = db
      .prepare(
        `INSERT INTO chats (account_id, vinted_conversation_id, buyer_username, last_message_at)
         VALUES (?, ?, ?, ?)`,
      )
      .run(accountId, key, conv.buyerUsername, lastMsgAt);
    chatId = res.lastInsertRowid as number;
  }

  // Best-effort: lookup linked listing (newest active marketplace_listings
  // entry for this account is a fair fallback). The chat header normally
  // has a /listings/{id} link too — we don't scrape it here because that
  // would require an extra page click; offer-acceptance will resolve it.
  const ml = db
    .prepare(
      `SELECT folder_num FROM marketplace_listings
         WHERE marketplace = 'grailed' AND account_id = ? AND status = 'active'
         ORDER BY id DESC LIMIT 1`,
    )
    .get(accountId) as { folder_num: number } | undefined;
  let listingId: number | null = null;
  if (ml) {
    const legacy = db
      .prepare(
        `SELECT id FROM listings WHERE account_id = ? AND folder_num = ?
           AND status = 'active' LIMIT 1`,
      )
      .get(accountId, ml.folder_num) as { id: number } | undefined;
    if (legacy) listingId = legacy.id;
  }
  return { chatId, listingId };
}

function insertMessageIfNew(chatId: number, msg: ScrapedMessage): boolean {
  const db = getDb();
  if (msg.externalMessageId) {
    const key = `grailed:${msg.externalMessageId}`;
    const existing = db
      .prepare('SELECT id FROM messages WHERE vinted_message_id = ?')
      .get(key);
    if (existing) return false;
  } else {
    const existing = db
      .prepare(
        `SELECT id FROM messages
           WHERE chat_id = ? AND body = ? AND direction = ?
           ORDER BY id DESC LIMIT 1`,
      )
      .get(chatId, msg.body, msg.direction);
    if (existing) return false;
  }
  const amountEur =
    msg.isOffer && msg.offerAmountUsd != null
      ? Math.round(msg.offerAmountUsd * USD_TO_EUR * 100) / 100
      : null;
  db.prepare(
    `INSERT INTO messages (chat_id, direction, body, is_offer, offer_amount_eur, vinted_message_id)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    chatId,
    msg.direction,
    msg.body,
    msg.isOffer ? 1 : 0,
    amountEur,
    msg.externalMessageId ? `grailed:${msg.externalMessageId}` : null,
  );
  return true;
}

function createPendingOffer(chatId: number, listingId: number | null, amountEur: number): void {
  const db = getDb();
  // Avoid duplicate pending offer for the same chat+amount.
  const existing = db
    .prepare(
      `SELECT id FROM offers
         WHERE chat_id = ? AND amount_eur = ? AND state = 'pending'`,
    )
    .get(chatId, amountEur);
  if (existing) return;
  db.prepare(
    `INSERT INTO offers (listing_id, chat_id, amount_eur, state)
     VALUES (?, ?, ?, 'pending')`,
  ).run(listingId, chatId, amountEur);
}

export { CHAT_LISTING_LINK };
