import type { Page } from 'playwright';
import { createLogger } from '@vinted-system/shared';
import { launchWpBrowser, type WpBrowser } from './browser.js';
import { SEL_LOGGED_IN, SEL_CAPTCHA, SEL_BLOCKED } from './selectors.js';

const log = createLogger('wp-login');

const HOME_URL = 'https://es.wallapop.com/';
const LOGIN_URL = 'https://es.wallapop.com/login/?redirect=%2F';

export async function isLoggedIn(page: Page): Promise<boolean> {
  try {
    await page.goto(HOME_URL, { waitUntil: 'domcontentloaded', timeout: 20_000 });
    return await SEL_LOGGED_IN.exists(page);
  } catch (err) {
    log.warn('isLoggedIn check failed', { err: String(err) });
    return false;
  }
}

export async function performInteractiveLogin(opts: {
  accountId: number;
  storageDir: string;
  proxyUrl?: string;
  waitSec?: number;
}): Promise<{ ok: boolean; error?: string; browser: WpBrowser }> {
  const browser = await launchWpBrowser({
    accountId: opts.accountId,
    storageDir: opts.storageDir,
    headless: false,
    proxyUrl: opts.proxyUrl,
  });
  const page = await browser.context.newPage();

  try {
    if (await isLoggedIn(page)) {
      log.info('Already logged in', { accountId: opts.accountId });
      await page.close();
      return { ok: true, browser };
    }

    await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: 30_000 });

    if (await SEL_BLOCKED.exists(page)) {
      return { ok: false, error: 'wallapop blocked page (rate-limit/IP)', browser };
    }
    if (await SEL_CAPTCHA.exists(page)) {
      log.warn('Captcha sichtbar — manuell lösen');
    }

    log.info('Waiting for manual login...', {
      accountId: opts.accountId,
      hint: 'Im Browser einloggen. Bot wartet bis Avatar/Konto sichtbar.',
    });

    const deadline = Date.now() + (opts.waitSec ?? 600) * 1000;
    while (Date.now() < deadline) {
      if (await SEL_LOGGED_IN.exists(page)) {
        log.info('Login detected', { accountId: opts.accountId });
        await page.close();
        return { ok: true, browser };
      }
      await page.waitForTimeout(1500);
    }

    return { ok: false, error: 'login timeout', browser };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err), browser };
  }
}
