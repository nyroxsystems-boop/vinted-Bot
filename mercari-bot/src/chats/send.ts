// ──────────────────────────────────────────────────────────────────────────────
// Mercari Chat — send reply
// ──────────────────────────────────────────────────────────────────────────────

import type { BrowserContext } from 'playwright';
import { createLogger } from '@vinted-system/shared';
import {
  SEL_LOGGED_IN,
  SEL_CHAT_REPLY_BOX,
  SEL_CHAT_SEND_BTN,
} from '../selectors.js';

const log = createLogger('mercari-chats-send');
const BASE_URL = process.env.MERCARI_BASE_URL ?? 'https://www.mercari.com';

function convUrl(conversationId: string): string {
  // TODO: validate against live URL pattern. Could also be /inbox/<id>.
  return `${BASE_URL}/messages/${conversationId}`;
}

export interface SendResult {
  ok: boolean;
  error?: string;
}

/** Send a free-text reply into a Mercari conversation. */
export async function sendMercariMessage(
  ctx: BrowserContext,
  conversationId: string,
  body: string,
): Promise<SendResult> {
  if (!conversationId) return { ok: false, error: 'conversationId required' };
  if (!body.trim()) return { ok: false, error: 'empty body' };

  const page = await ctx.newPage();
  try {
    await page.goto(convUrl(conversationId), {
      waitUntil: 'domcontentloaded',
      timeout: 25_000,
    });
    if (!(await SEL_LOGGED_IN.exists(page))) {
      return { ok: false, error: 'not authenticated' };
    }

    await SEL_CHAT_REPLY_BOX.waitFor(page, { timeout: 10_000 });
    const box = await SEL_CHAT_REPLY_BOX.resolve(page);
    await box.click();
    await box.fill(body);
    await page.waitForTimeout(300);

    try {
      await SEL_CHAT_SEND_BTN.click(page);
    } catch {
      // Many chat UIs ship with Enter-to-send as a fallback
      await page.keyboard.press('Enter');
    }
    await page.waitForTimeout(1_200);

    log.info('Mercari reply sent', { conversationId, chars: body.length });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  } finally {
    await page.close().catch(() => null);
  }
}
