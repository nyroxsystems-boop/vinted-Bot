// ──────────────────────────────────────────────────────────────────────────────
// Vestiaire Collective — send message in conversation.
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

const log = createLogger('vc-chats-send');
const BASE_URL = 'https://www.vestiairecollective.com';

export interface SendResult {
  ok: boolean;
  error?: string;
  blockedBy?: 'captcha' | 'login' | 'rate-limit' | 'selector-drift';
}

function conversationUrl(convId: string): string {
  if (convId.startsWith('http')) return convId;
  return `${BASE_URL}/conversation/${encodeURIComponent(convId)}`;
}

export async function sendVestiaireMessage(
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

    await SEL_REPLY_TEXTAREA.fill(page, body.trim());
    await page.waitForTimeout(500);
    await SEL_REPLY_SUBMIT.click(page);
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
