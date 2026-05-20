// ──────────────────────────────────────────────────────────────────────────────
// FB Marketplace — send message in conversation.
//
// FB uses a contenteditable div with aria-label for the message composer.
// Submit via Enter key or the explicit send button.
// ──────────────────────────────────────────────────────────────────────────────
import type { Page } from 'playwright';
import { createLogger } from '@vinted-system/shared';
import {
  SEL_REPLY_TEXTAREA,
  SEL_REPLY_SUBMIT,
  SEL_LOGGED_IN,
  SEL_CHECKPOINT,
  SEL_CAPTCHA,
} from '../selectors.js';

const log = createLogger('fb-chats-send');
const BASE_URL = 'https://www.facebook.com';

function jitter(min: number, max: number) {
  return Math.floor(min + Math.random() * (max - min));
}

export interface SendResult {
  ok: boolean;
  error?: string;
  blockedBy?: 'captcha' | 'login' | 'rate-limit' | 'selector-drift';
}

function conversationUrl(idOrUrl: string): string {
  if (idOrUrl.startsWith('http')) return idOrUrl;
  return `${BASE_URL}/marketplace/t/${encodeURIComponent(idOrUrl)}/`;
}

export async function sendFbMessage(
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
    await page.waitForTimeout(jitter(2500, 4000));

    if (await SEL_CHECKPOINT.exists(page)) return { ok: false, error: 'FB checkpoint', blockedBy: 'rate-limit' };
    if (await SEL_CAPTCHA.exists(page)) return { ok: false, error: 'captcha', blockedBy: 'captcha' };

    // FB composer is a contenteditable div — fill() may not work.
    const composer = await SEL_REPLY_TEXTAREA.resolve(page);
    await composer.click();
    await page.waitForTimeout(jitter(400, 800));
    await page.keyboard.type(body.trim(), { delay: jitter(40, 90) });
    await page.waitForTimeout(jitter(500, 900));

    // Submit via send-button OR Enter.
    let submitted = false;
    try {
      await SEL_REPLY_SUBMIT.click(page);
      submitted = true;
    } catch { /* fall back to Enter */ }
    if (!submitted) {
      await page.keyboard.press('Enter');
    }
    await page.waitForTimeout(jitter(1500, 2500));

    log.info('FB reply sent', { conversationId, len: body.length });
    return { ok: true };
  } catch (err) {
    if (err instanceof Error && err.name === 'SelectorDriftError') {
      return { ok: false, error: err.message, blockedBy: 'selector-drift' };
    }
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
