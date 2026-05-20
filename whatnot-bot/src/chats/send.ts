// ──────────────────────────────────────────────────────────────────────────────
// Whatnot — send DM in conversation.
// ──────────────────────────────────────────────────────────────────────────────
import type { Page } from 'playwright';
import { createLogger } from '@vinted-system/shared';
import {
  SEL_REPLY_TEXTAREA,
  SEL_REPLY_SUBMIT,
  SEL_LOGGED_IN,
  SEL_BLOCKED,
  SEL_CAPTCHA,
} from '../selectors.js';

const log = createLogger('whatnot-chats-send');
const BASE_URL = 'https://www.whatnot.com';

export interface SendResult {
  ok: boolean;
  error?: string;
  blockedBy?: 'captcha' | 'login' | 'rate-limit' | 'selector-drift';
}

function conversationUrl(idOrUrl: string): string {
  if (idOrUrl.startsWith('http')) return idOrUrl;
  return `${BASE_URL}/messages/${encodeURIComponent(idOrUrl)}`;
}

export async function sendWhatnotMessage(
  page: Page,
  conversationId: string,
  body: string,
): Promise<SendResult> {
  if (!body.trim()) return { ok: false, error: 'empty body' };
  if (!conversationId) return { ok: false, error: 'conversationId required' };

  try {
    if (!(await SEL_LOGGED_IN.exists(page))) {
      return { ok: false, error: 'not authenticated', blockedBy: 'login' };
    }
    await page.goto(conversationUrl(conversationId), {
      waitUntil: 'domcontentloaded',
      timeout: 25_000,
    });
    await page.waitForTimeout(1500);

    if (await SEL_BLOCKED.exists(page)) return { ok: false, error: 'blocked', blockedBy: 'rate-limit' };
    if (await SEL_CAPTCHA.exists(page)) return { ok: false, error: 'captcha', blockedBy: 'captcha' };

    // TODO: validate — Whatnot may use contenteditable instead of textarea.
    try {
      await SEL_REPLY_TEXTAREA.fill(page, body.trim());
    } catch {
      // Fallback: contenteditable approach
      const ce = page.locator('[contenteditable="true"]').first();
      if ((await ce.count()) > 0) {
        await ce.click();
        await page.keyboard.type(body.trim(), { delay: 30 });
      } else {
        return { ok: false, error: 'reply input not found', blockedBy: 'selector-drift' };
      }
    }
    await page.waitForTimeout(500);
    try {
      await SEL_REPLY_SUBMIT.click(page);
    } catch {
      // Fallback: press Enter
      await page.keyboard.press('Enter');
    }
    await page.waitForTimeout(1500);

    log.info('reply sent', { conversationId, len: body.length });
    return { ok: true };
  } catch (err) {
    if (err instanceof Error && err.name === 'SelectorDriftError') {
      return { ok: false, error: err.message, blockedBy: 'selector-drift' };
    }
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
