// ──────────────────────────────────────────────────────────────────────────────
// Etsy Chat — send a free-text reply into a conversation.
// ──────────────────────────────────────────────────────────────────────────────

import { createLogger, getDb } from '@vinted-system/shared';
import { launchEtsy, isEtsyLoggedIn, ETSY_BASE_URL } from '../browser.js';

const log = createLogger('etsy-chat-send');

// TODO: validate selectors against live site.
const REPLY_BOX = [
  'textarea[name="message"]',
  'textarea[placeholder*="message" i]',
  'div[contenteditable="true"][role="textbox"]',
  '[data-test-id="message-input"]',
].join(', ');

const SEND_BUTTON = [
  'button[data-test-id="send-message"]',
  'button[type="submit"]:has-text("Send")',
  'button:has-text("Send")',
  'button[aria-label*="send" i]',
].join(', ');

export async function sendEtsyMessage(
  chatId: number,
  body: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!body.trim()) return { ok: false, error: 'empty body' };

  // Resolve conversation_id from chats. We expect the key to be prefixed with
  // `etsy:` (see poll.ts/upsertChat) — strip the prefix to recover the raw id.
  const db = getDb();
  const chat = db
    .prepare('SELECT vinted_conversation_id, account_id FROM chats WHERE id = ?')
    .get(chatId) as { vinted_conversation_id: string; account_id: number } | undefined;
  if (!chat) return { ok: false, error: 'chat not found' };

  const conversationId = chat.vinted_conversation_id.startsWith('etsy:')
    ? chat.vinted_conversation_id.slice('etsy:'.length)
    : chat.vinted_conversation_id;
  const accountId = chat.account_id;

  const ctx = await launchEtsy(accountId, false);
  const page = await ctx.newPage();
  try {
    await page.goto(`${ETSY_BASE_URL}/your/conversations/${conversationId}`, {
      waitUntil: 'domcontentloaded',
      timeout: 25_000,
    });
    if (!(await isEtsyLoggedIn(page))) {
      return { ok: false, error: 'not authenticated' };
    }
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => null);

    const box = page.locator(REPLY_BOX).first();
    await box.waitFor({ state: 'visible', timeout: 10_000 });
    await box.click();
    await box.fill(body);
    await page.waitForTimeout(400);

    const send = page.locator(SEND_BUTTON).first();
    if ((await send.count()) > 0) {
      await send.click({ timeout: 8_000 });
    } else {
      // Fallback: many message UIs send on Enter.
      await page.keyboard.press('Enter');
    }
    await page.waitForTimeout(1_500);

    // Best-effort: append an outbound message row so dashboards reflect it
    // before the next poll picks it up.
    db.prepare(
      `INSERT INTO messages (chat_id, direction, body, is_offer, offer_amount_eur)
       VALUES (?, 'out', ?, 0, NULL)`,
    ).run(chatId, body);

    log.info('Etsy reply sent', { chatId, chars: body.length });
    return { ok: true };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    log.warn('Etsy reply failed', { chatId, error });
    return { ok: false, error };
  } finally {
    await page.close().catch(() => null);
    await ctx.close().catch(() => null);
  }
}
