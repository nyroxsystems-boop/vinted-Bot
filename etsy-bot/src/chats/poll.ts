// ──────────────────────────────────────────────────────────────────────────────
// Etsy Inbox Poller
//
// Etsy messages live under /your/conversations. There is no public messaging
// API for sellers, so we drive the web inbox via Playwright:
//   1. Navigate to /your/conversations
//   2. Scrape each conversation row → conversation_id + buyer + last snippet
//   3. Open each thread and scrape message bubbles
//   4. Persist into chats + messages tables (re-using Vinted's schema; the
//      `vinted_conversation_id` column doubles as a per-marketplace
//      conversation key, prefixed with `etsy:` to avoid collisions).
//
// Etsy has no buyer offers (fixed-price only) — we skip offer detection.
// ──────────────────────────────────────────────────────────────────────────────

import type { Page, Locator } from 'playwright';
import { createLogger, getDb } from '@vinted-system/shared';
import { launchEtsy, isEtsyLoggedIn, ETSY_BASE_URL } from '../browser.js';

const log = createLogger('etsy-poll');

const INBOX_URL = '/your/conversations';

// TODO: validate selectors against live site. Etsy's conversation list uses
// dynamic class names; we keep a few alternatives.
const CONVERSATION_ROW = [
  '[data-test-id="conversation-row"]',
  '[data-testid*="conversation"]',
  'a[href*="/your/conversations/"]',
  '[class*="conversation-row" i]',
].join(', ');

const MESSAGE_BUBBLE = [
  '[data-test-id^="message-"]',
  '[data-testid^="message-"]',
  '[class*="MessageBubble" i]',
  '[class*="message-item" i]',
].join(', ');

interface ConversationInfo {
  conversationId: string;
  buyerUsername: string;
  lastSnippet: string;
  lastDateLabel: string;
}

interface RawMessage {
  externalMessageId: string | null;
  direction: 'in' | 'out';
  body: string;
}

export async function pollEtsyInbox(
  accountId: number,
): Promise<{ newMessages: number; newOffers: number }> {
  const ctx = await launchEtsy(accountId, true);
  const page = await ctx.newPage();
  let newMessages = 0;
  const newOffers = 0; // Etsy has no offers; always 0.

  try {
    await page.goto(`${ETSY_BASE_URL}${INBOX_URL}`, {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });
    if (!(await isEtsyLoggedIn(page))) {
      log.warn('Not authenticated — skipping poll');
      return { newMessages: 0, newOffers: 0 };
    }
    await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => null);

    const conversations = await discoverConversations(page);
    log.info(`Found ${conversations.length} conversations`);

    for (const conv of conversations) {
      const chatId = upsertChat(conv, accountId);
      const messages = await scrapeConversationMessages(page, conv.conversationId);
      for (const msg of messages) {
        const inserted = insertMessageIfNew(chatId, msg);
        if (inserted) newMessages++;
      }
    }
    return { newMessages, newOffers };
  } catch (err) {
    log.warn('pollEtsyInbox failed', {
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
  const out: ConversationInfo[] = [];

  for (let i = 0; i < Math.min(count, 50); i++) {
    const row = rows.nth(i);
    try {
      // Try to read the conversation id from the href first (most reliable).
      const href = (await row.getAttribute('href').catch(() => null))
        ?? (await row.locator('a[href*="/your/conversations/"]').first().getAttribute('href').catch(() => null));
      let conversationId: string | null = null;
      if (href) {
        const m = href.match(/\/your\/conversations\/(\d+|[A-Za-z0-9_-]+)/);
        if (m?.[1]) conversationId = m[1];
      }
      if (!conversationId) {
        const dataId = await row.getAttribute('data-conversation-id').catch(() => null);
        if (dataId) conversationId = dataId;
      }
      if (!conversationId) continue;

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
): Promise<RawMessage[]> {
  const url = `${ETSY_BASE_URL}/your/conversations/${conversationId}`;
  if (!page.url().includes(`/your/conversations/${conversationId}`)) {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 25_000 }).catch(() => null);
  }
  await page.waitForTimeout(1_200);

  const items = page.locator(MESSAGE_BUBBLE);
  const count = await items.count();
  const out: RawMessage[] = [];

  for (let i = 0; i < count; i++) {
    const item = items.nth(i);
    const body = (await item.innerText({ timeout: 1_500 }).catch(() => '')).trim();
    if (!body) continue;
    const msgId =
      (await item.getAttribute('data-message-id').catch(() => null))
      ?? (await item.getAttribute('data-testid').catch(() => null));
    const direction = await inferDirection(item);
    out.push({ externalMessageId: msgId, direction, body });
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

function upsertChat(conv: ConversationInfo, accountId: number): number {
  const db = getDb();
  // Prefix with `etsy:` so the conversation_id column stays unique even though
  // it's shared with Vinted/other marketplaces.
  const key = `etsy:${conv.conversationId}`;
  const lastMsgAt = conv.lastDateLabel || new Date().toISOString();
  const existing = db
    .prepare('SELECT id FROM chats WHERE vinted_conversation_id = ?')
    .get(key) as { id: number } | undefined;
  if (existing) {
    db.prepare(
      `UPDATE chats
          SET last_message_at = ?,
              buyer_username  = CASE WHEN ? = 'unknown' THEN buyer_username ELSE ? END
        WHERE id = ?`,
    ).run(lastMsgAt, conv.buyerUsername, conv.buyerUsername, existing.id);
    return existing.id;
  }
  const res = db
    .prepare(
      `INSERT INTO chats (account_id, vinted_conversation_id, buyer_username, last_message_at)
       VALUES (?, ?, ?, ?)`,
    )
    .run(accountId, key, conv.buyerUsername, lastMsgAt);
  return res.lastInsertRowid as number;
}

function insertMessageIfNew(chatId: number, msg: RawMessage): boolean {
  const db = getDb();
  if (msg.externalMessageId) {
    const existing = db
      .prepare('SELECT id FROM messages WHERE vinted_message_id = ?')
      .get(`etsy:${msg.externalMessageId}`);
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
  db.prepare(
    `INSERT INTO messages (chat_id, direction, body, is_offer, offer_amount_eur, vinted_message_id)
     VALUES (?, ?, ?, 0, NULL, ?)`,
  ).run(
    chatId,
    msg.direction,
    msg.body,
    msg.externalMessageId ? `etsy:${msg.externalMessageId}` : null,
  );
  return true;
}
