import type { Page, Locator } from 'playwright';
import { createLogger, getDb, isBotBlocked, dismissOneTrust } from '@vinted-system/shared';
import { VINTED } from '../selectors.js';
import { getVintedBrowser } from '../browser.js';
import { requireLogin } from '../auth.js';
import { parseMessageText } from './parse.js';

const log = createLogger('vinted-poll');
const BASE_URL = process.env.VINTED_BASE_URL ?? 'https://www.vinted.de';

interface ConversationInfo {
  conversationId: string;
  buyerUsername: string;
  lastSnippet: string;
  lastDateLabel: string;
}

interface RawMessage {
  vintedMessageId: string | null;
  direction: 'in' | 'out';
  body: string;
}

/**
 * Poll the Vinted inbox.
 *
 * Strategy (April 2026):
 *   1. Navigate to /inbox.
 *   2. Dismiss consent-cookie dialog if present.
 *   3. Read sidebar conversation-list buttons. Each button is NOT an <a>, so
 *      we extract { username, snippet, dateLabel } from its inner structure.
 *      To learn the conversation id we click the button, then observe the
 *      new URL /inbox/{id}.
 *   4. For each conversation we fetch message bubbles + detect offers using
 *      the verified Vinted-template regex.
 *   5. Persist chats + messages + pending offers.
 */
export async function pollVintedInbox(): Promise<{ newMessages: number; newOffers: number }> {
  const mb = await getVintedBrowser();
  const page = await mb.context.newPage();
  let newMessages = 0;
  let newOffers = 0;

  try {
    await requireLogin(page);
    await page.goto(`${BASE_URL}${VINTED.inboxUrl}`, {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });
    await dismissConsentIfPresent(page);

    const block = await isBotBlocked(page);
    if (block.blocked) {
      log.warn('Bot block detected — skipping poll', { reason: block.reason });
      return { newMessages: 0, newOffers: 0 };
    }

    // Wait for React to hydrate the conversation list. Vinted is Next.js
    // App Router + RSC — domcontentloaded fires BEFORE any React content
    // is in the DOM. Without this wait, headless poll would always scrape
    // 0 conversations (false negatives). Use `networkidle` + an explicit
    // selector wait so we don't scrape too early.
    await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {
      log.warn('networkidle not reached within 20s — trying anyway');
    });
    const firstButton = page.locator('main button:has(img)').first();
    await firstButton.waitFor({ state: 'visible', timeout: 15_000 }).catch(() => {
      log.warn('No conversation-list buttons appeared within 15s');
    });

    const conversations = await discoverConversations(page);
    log.info(`Found ${conversations.length} conversations in sidebar`);

    if (conversations.length === 0) {
      // Diagnostics: dump page state so we can see what went wrong.
      const url = page.url();
      const title = await page.title().catch(() => '');
      const mainHtmlLen = await page
        .locator('main')
        .first()
        .innerHTML()
        .then((h) => h.length)
        .catch(() => 0);
      const buttonCount = await page.locator('main button').count().catch(() => 0);
      log.warn('Diagnostic — empty inbox scrape', {
        url,
        title,
        mainHtmlLen,
        buttonCount,
      });
    }

    for (const conv of conversations) {
      const chatId = upsertChat(conv);
      const messages = await scrapeConversationMessages(page, conv.conversationId);
      for (const msg of messages) {
        const parsed = parseMessageText(msg.body);
        const inserted = insertMessageIfNew(chatId, msg, parsed);
        if (inserted) {
          newMessages++;
          if (parsed.isOffer && parsed.offerAmountEur !== null) {
            createPendingOffer(chatId, parsed.offerAmountEur);
            newOffers++;
            log.info('New offer detected', {
              chatId,
              amount: parsed.offerAmountEur,
              source: parsed.source,
              buyer: conv.buyerUsername,
            });
          }
        }
      }
    }
  } finally {
    await page.close();
  }

  return { newMessages, newOffers };
}

/**
 * Vinted shows a OneTrust consent dialog on first visit. Handled uniformly
 * via the shared helper — same approach as Temu (both use OneTrust).
 */
async function dismissConsentIfPresent(page: Page): Promise<void> {
  await dismissOneTrust(page).catch(() => null);
}

/**
 * Walk the conversation-list buttons. For each, click-and-observe to learn
 * the conversation id. This is sequential because Playwright can only click
 * one thing at a time, but it's limited to the visible sidebar count
 * (typically ≤ 20 at a time).
 */
async function discoverConversations(page: Page): Promise<ConversationInfo[]> {
  const items = page.locator(VINTED.conversationListItem);
  const count = await items.count();
  const results: ConversationInfo[] = [];

  for (let i = 0; i < count; i++) {
    const item = items.nth(i);
    // Read visible text BEFORE clicking so we can pair username+snippet
    // with the conversation id we discover after click.
    const fullText = (await item.innerText({ timeout: 2_000 }).catch(() => '')).trim();
    if (!fullText) continue;
    const { username, snippet, dateLabel } = parseConversationRow(fullText);

    // Click → URL changes to /inbox/{id}.
    await item.click({ timeout: 5_000 }).catch(() => {
      /* skip broken entry */
    });
    await page.waitForURL(/\/inbox\/\d+/, { timeout: 5_000 }).catch(() => null);
    const m = page.url().match(/\/inbox\/(\d+)/);
    if (!m?.[1]) continue;

    results.push({
      conversationId: m[1],
      buyerUsername: username,
      lastSnippet: snippet,
      lastDateLabel: dateLabel,
    });
  }

  return results;
}

/**
 * Parse the innerText block of a conversation-list button.
 * The button contains, in DOM order: username, date, snippet, (optional unread
 * indicator). innerText preserves the order with newlines.
 */
function parseConversationRow(raw: string): {
  username: string;
  dateLabel: string;
  snippet: string;
} {
  const lines = raw.split('\n').map((l) => l.trim()).filter(Boolean);
  const [username = 'unknown', dateLabel = '', snippet = ''] = lines;
  return { username, dateLabel, snippet };
}

async function scrapeConversationMessages(page: Page, conversationId: string): Promise<RawMessage[]> {
  // Ensure we're on the right URL (in case the click discovery landed us elsewhere).
  if (!page.url().includes(`/inbox/${conversationId}`)) {
    await page.goto(`${BASE_URL}/inbox/${conversationId}`, {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });
  }
  // Let the message list hydrate.
  await page.waitForTimeout(1_500);

  const items = page.locator(VINTED.messageItem);
  const count = await items.count();
  const out: RawMessage[] = [];

  for (let i = 0; i < count; i++) {
    const item = items.nth(i);
    const body = (await item.innerText({ timeout: 1_500 }).catch(() => '')).trim();
    if (!body) continue;

    // Best-effort message id + direction extraction.
    const msgId = await item.getAttribute('data-message-id').catch(() => null);
    const direction = await inferDirection(item);
    out.push({ vintedMessageId: msgId, direction, body });
  }

  return out;
}

/**
 * Heuristic: if the message bubble's bounding box is in the right half of
 * the viewport, it's outbound (from us). Vinted (like most chat UIs) right-
 * aligns the current user's messages.
 */
async function inferDirection(item: Locator): Promise<'in' | 'out'> {
  try {
    const box = await item.boundingBox();
    if (!box) return 'in';
    const page = item.page();
    const viewport = page.viewportSize();
    if (!viewport) return 'in';
    const midX = viewport.width / 2;
    const bubbleCenterX = box.x + box.width / 2;
    return bubbleCenterX > midX ? 'out' : 'in';
  } catch {
    return 'in';
  }
}

function upsertChat(conv: ConversationInfo): number {
  const db = getDb();
  const nowIso = new Date().toISOString();
  const existing = db
    .prepare('SELECT id FROM chats WHERE vinted_conversation_id = ?')
    .get(conv.conversationId) as { id: number } | undefined;
  if (existing) {
    db.prepare('UPDATE chats SET last_message_at = ? WHERE id = ?').run(nowIso, existing.id);
    return existing.id;
  }
  const res = db
    .prepare(
      `INSERT INTO chats (vinted_conversation_id, buyer_username, last_message_at)
       VALUES (?, ?, ?)`,
    )
    .run(conv.conversationId, conv.buyerUsername, nowIso);
  return res.lastInsertRowid as number;
}

function insertMessageIfNew(
  chatId: number,
  msg: RawMessage,
  parsed: ReturnType<typeof parseMessageText>,
): boolean {
  const db = getDb();
  if (msg.vintedMessageId) {
    const existing = db
      .prepare('SELECT id FROM messages WHERE vinted_message_id = ?')
      .get(msg.vintedMessageId);
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
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    chatId,
    msg.direction,
    msg.body,
    parsed.isOffer ? 1 : 0,
    parsed.offerAmountEur,
    msg.vintedMessageId,
  );
  return true;
}

function createPendingOffer(chatId: number, amountEur: number): void {
  const db = getDb();
  // Link attempt: find a listing whose title matches the conversation's item
  // heading. MVP: listing_id stays NULL until the user manually links in the
  // dashboard. A future enhancement can scrape the item link from the
  // conversation header and match by vinted_url.
  db.prepare(
    `INSERT INTO offers (listing_id, chat_id, amount_eur, state)
     VALUES (NULL, ?, ?, 'pending')`,
  ).run(chatId, amountEur);
}
