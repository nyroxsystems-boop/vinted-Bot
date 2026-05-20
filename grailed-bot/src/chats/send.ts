// ──────────────────────────────────────────────────────────────────────────────
// Grailed Chat — send a free-text reply to a buyer.
// ──────────────────────────────────────────────────────────────────────────────

import { createLogger, getDb, cloudflareSafeNavigate } from '@vinted-system/shared';
import { launchGrailed, isGrailedLoggedIn, GRAILED_BASE_URL } from '../browser.js';

const log = createLogger('grailed-chat-send');

// TODO: validate selectors against live site.
const REPLY_BOX = [
  'textarea[name="message"]',
  'textarea[placeholder*="message" i]',
  'textarea[placeholder*="reply" i]',
  'div[contenteditable="true"][role="textbox"]',
  '[data-testid="message-input"]',
].join(', ');

const SEND_BUTTON = [
  'button[data-testid="send-message"]',
  'button[type="submit"]:has-text("Send")',
  'button:has-text("Send")',
  'button[aria-label*="send" i]',
].join(', ');

export async function sendGrailedMessage(
  chatId: number,
  body: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!body.trim()) return { ok: false, error: 'empty body' };

  const db = getDb();
  const chat = db
    .prepare('SELECT vinted_conversation_id, account_id FROM chats WHERE id = ?')
    .get(chatId) as { vinted_conversation_id: string; account_id: number } | undefined;
  if (!chat) return { ok: false, error: 'chat not found' };

  const conversationId = chat.vinted_conversation_id.startsWith('grailed:')
    ? chat.vinted_conversation_id.slice('grailed:'.length)
    : chat.vinted_conversation_id;
  const accountId = chat.account_id;

  const ctx = await launchGrailed(accountId, false);
  const page = await ctx.newPage();
  try {
    const home = await cloudflareSafeNavigate(page, GRAILED_BASE_URL, { timeoutMs: 25_000 });
    if (!home.ok) return { ok: false, error: home.error };
    if (!(await isGrailedLoggedIn(page))) {
      return { ok: false, error: 'not authenticated' };
    }

    const nav = await cloudflareSafeNavigate(
      page,
      `${GRAILED_BASE_URL}/messages/${conversationId}`,
      { timeoutMs: 25_000 },
    );
    if (!nav.ok) return { ok: false, error: nav.error };
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
      await page.keyboard.press('Enter');
    }
    await page.waitForTimeout(1_500);

    db.prepare(
      `INSERT INTO messages (chat_id, direction, body, is_offer, offer_amount_eur)
       VALUES (?, 'out', ?, 0, NULL)`,
    ).run(chatId, body);

    log.info('Grailed reply sent', { chatId, chars: body.length });
    return { ok: true };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    log.warn('Grailed reply failed', { chatId, error });
    return { ok: false, error };
  } finally {
    await page.close().catch(() => null);
    await ctx.close().catch(() => null);
  }
}
