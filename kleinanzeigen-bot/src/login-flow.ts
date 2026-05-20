// ──────────────────────────────────────────────────────────────────────────────
// Kleinanzeigen Login Flow
//
// Headful — der User logged sich einmalig manuell ein. Cookies werden im
// persistent context gespeichert und automatisch wiederverwendet.
// ──────────────────────────────────────────────────────────────────────────────

import type { Page } from 'playwright';
import { createLogger } from '@vinted-system/shared';
import { launchKaBrowser, type KaBrowser } from './browser.js';
import { SEL_LOGGED_IN_AVATAR, SEL_CAPTCHA, SEL_BLOCKED } from './selectors.js';

const log = createLogger('ka-login');

const HOME_URL = 'https://www.kleinanzeigen.de/';
const LOGIN_URL = 'https://www.kleinanzeigen.de/m-einloggen.html';

export async function isLoggedIn(page: Page): Promise<boolean> {
  try {
    // Navigate to a page that requires authentication ("my listings").
    // Logged-in: URL stays on /m-meine-anzeigen.html. Logged-out: redirects
    // to login. This is a stronger signal than chasing avatar selectors
    // that change with KA's UI revisions.
    await page.goto('https://www.kleinanzeigen.de/m-meine-anzeigen.html', {
      waitUntil: 'domcontentloaded',
      timeout: 20_000,
    });
    await page.waitForTimeout(800); // let any final client-side redirect settle
    const url = page.url();
    if (url.includes('einloggen') || url.includes('login')) {
      return false;
    }
    // Fallback: also accept avatar selector as positive signal.
    if (await SEL_LOGGED_IN_AVATAR.exists(page)) return true;
    // If we're on /m-meine-anzeigen.html WITHOUT redirect, we're logged in.
    return url.includes('m-meine-anzeigen');
  } catch (err) {
    log.warn('isLoggedIn check failed', { err: String(err) });
    return false;
  }
}

export async function performInteractiveLogin(opts: {
  accountId: number;
  storageDir: string;
  proxyUrl?: string;
  /** Sekunden den User auf manuellen Login warten lassen. Default 600 (10min). */
  waitSec?: number;
}): Promise<{ ok: boolean; error?: string; browser: KaBrowser }> {
  const browser = await launchKaBrowser({
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

    // Hard-Block check
    if (await SEL_BLOCKED.exists(page)) {
      return { ok: false, error: 'kleinanzeigen blocked page (rate-limit/IP)', browser };
    }

    log.info('Waiting for manual login...', {
      accountId: opts.accountId,
      hint: 'Im Browser einloggen. Bot wartet bis Avatar/Konto sichtbar.',
    });

    // Captcha hinweis — wir lösen nicht automatisch, nur protokolliert
    if (await SEL_CAPTCHA.exists(page)) {
      log.warn('Captcha sichtbar — manuell lösen');
    }

    const deadline = Date.now() + (opts.waitSec ?? 600) * 1000;
    while (Date.now() < deadline) {
      if (await SEL_LOGGED_IN_AVATAR.exists(page)) {
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
