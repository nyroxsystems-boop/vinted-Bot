// Send-Message in einer KA-Conversation.
import type { Page } from 'playwright';
import { createLogger, retry, detectAndSolveCaptcha } from '@vinted-system/shared';
import { launchKaBrowser } from '../browser.js';
import { isLoggedIn } from '../login-flow.js';
import { SEL_REPLY_TEXTAREA, SEL_REPLY_SUBMIT, SEL_BLOCKED, SEL_CAPTCHA } from '../selectors.js';

const log = createLogger('ka-send');

export interface SendResult {
  ok: boolean;
  error?: string;
  blockedBy?: 'captcha' | 'login' | 'rate-limit' | 'selector-drift';
}

function conversationUrl(kaConvId: string): string {
  if (kaConvId.startsWith('http')) return kaConvId;
  return `https://www.kleinanzeigen.de/m-postfach-nachrichten.html?conversationId=${encodeURIComponent(kaConvId)}`;
}

export async function sendKleinanzeigenMessage(
  accountId: number,
  dataRoot: string,
  kaConversationId: string,
  body: string,
): Promise<SendResult> {
  if (!body.trim()) return { ok: false, error: 'empty body' };

  const browser = await launchKaBrowser({
    accountId,
    storageDir: `${dataRoot}/${accountId}`,
    headless: true,
  });
  let page: Page | undefined;
  try {
    page = await browser.context.newPage();
    if (!(await isLoggedIn(page))) {
      return { ok: false, error: 'not authenticated', blockedBy: 'login' };
    }

    await page.goto(conversationUrl(kaConversationId), {
      waitUntil: 'domcontentloaded',
      timeout: 25_000,
    });
    if (await SEL_BLOCKED.exists(page)) return { ok: false, error: 'blocked', blockedBy: 'rate-limit' };
    if (await SEL_CAPTCHA.exists(page)) {
      log.warn('Captcha detected on KA send-page — attempting 2captcha solve');
      const cap = await detectAndSolveCaptcha(page);
      if (!cap.solved) {
        return { ok: false, error: `captcha: ${cap.error ?? 'unsolved'}`, blockedBy: 'captcha' };
      }
      log.info('Captcha solved, retrying');
      await page.waitForTimeout(1500);
    }

    await retry(() => SEL_REPLY_TEXTAREA.fill(page!, body.trim()), { attempts: 2, label: 'reply-textarea' });
    await retry(() => SEL_REPLY_SUBMIT.click(page!), { attempts: 2, label: 'reply-submit' });
    await page.waitForTimeout(1500);

    log.info('reply sent', { accountId, kaConversationId, len: body.length });
    return { ok: true };
  } catch (err) {
    if (err instanceof Error && err.name === 'SelectorDriftError') {
      return { ok: false, error: err.message, blockedBy: 'selector-drift' };
    }
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  } finally {
    try { if (page) await page.close(); } catch { /* ignore */ }
    await browser.close();
  }
}
