import type { Page } from 'playwright';
import { createLogger, isBotBlocked } from '@vinted-system/shared';
import { TEMU } from './selectors.js';

const log = createLogger('temu-auth');
const BASE_URL = process.env.TEMU_BASE_URL ?? 'https://www.temu.com';

/**
 * Multi-signal login detection. Any ONE of these positive signals flips
 * the result to true. We need this because Temu's logged-in indicators
 * differ by page (homepage, login page, account page) and a single
 * selector misses real logins.
 */
export async function isLoggedIn(page: Page): Promise<boolean> {
  const block = await isBotBlocked(page);
  if (block.blocked) {
    log.warn('Blocked during login check', { reason: block.reason });
    return false;
  }

  // Signal 1: any account/orders indicator in the DOM
  const domHit =
    (await page.locator(TEMU.loggedInIndicator).first().count()) > 0;
  if (domHit) return true;

  // Signal 2: cookies set after Temu login. Names seen across Temu's
  // regions: user_uin, api_uid, user_id, access_token, session_id, mallkey.
  // ANY of these with a non-empty value → logged in.
  const cookies = await page.context().cookies(BASE_URL);
  const authCookieNames = ['user_uin', 'api_uid', 'user_id', 'access_token', 'x-api-token', 'mallkey', 'session_id'];
  const hasAuthCookie = cookies.some(
    (c) => authCookieNames.includes(c.name) && c.value && c.value !== '0' && c.value.length > 3,
  );
  if (hasAuthCookie) return true;

  // Signal 3: absence of a visible login-email input AND presence of a
  // user-ish glyph. If login form is gone and there's something
  // account-shaped on screen, assume logged in.
  const hasLoginInput =
    (await page.locator('input[type="email"], input[placeholder*="E-Mail" i], input[placeholder*="email" i]').first().count()) > 0;
  const hasUserGlyph =
    (await page.locator('a[href*="account"], a[href*="user"], [class*="user-center" i], [aria-label*="Konto"]').first().count()) > 0;
  if (!hasLoginInput && hasUserGlyph) return true;

  return false;
}

/** Diagnostic: dump what the bot sees on the page. Used when login detection seems stuck. */
export async function debugAuthState(page: Page): Promise<Record<string, unknown>> {
  const cookies = await page.context().cookies(BASE_URL).catch(() => []);
  const cookieSummary = cookies
    .filter((c) => c.value && c.value.length > 2)
    .map((c) => `${c.name}=${c.value.slice(0, 8)}…`)
    .slice(0, 15);
  return {
    url: page.url(),
    title: await page.title().catch(() => ''),
    cookieCount: cookies.length,
    cookieSummary,
    domIndicatorCount: await page.locator(TEMU.loggedInIndicator).count().catch(() => -1),
    hasLoginEmailInput:
      (await page.locator('input[type="email"]').count().catch(() => -1)) > 0,
  };
}

export async function ensureOnTemu(page: Page): Promise<void> {
  if (!page.url().startsWith(BASE_URL)) {
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  }
}

export async function requireLogin(page: Page): Promise<void> {
  await ensureOnTemu(page);
  if (!(await isLoggedIn(page))) {
    throw new Error(
      'Temu session not authenticated. Run `npm run temu:login` first to store a session.',
    );
  }
}
