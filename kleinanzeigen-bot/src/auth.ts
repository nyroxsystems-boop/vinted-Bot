// ──────────────────────────────────────────────────────────────────────────────
// Kleinanzeigen auth helpers — mirror of vinted-bot/src/auth.ts.
//
// Wraps the existing `isLoggedIn` from login-flow.ts and adds:
//   • requireLogin(page, accountId)  → throws on bad session
//   • tryAutoRelogin(page, accountId) → silent re-login from stored creds
//
// Health-event side-effects are recorded via `recordHealthEvent`. KA-specific
// quirks: the login form is at /m-einloggen.html, fields are `loginMail`
// (email) and `password`. There's no separate username — KA accepts email.
// ──────────────────────────────────────────────────────────────────────────────

import type { Page } from 'playwright';
import {
  createLogger,
  getSetting,
  recordHealthEvent,
} from '@vinted-system/shared';
import { isLoggedIn } from './login-flow.js';
import { SEL_CAPTCHA, SEL_BLOCKED } from './selectors.js';

const log = createLogger('ka-auth');

const LOGIN_URL = 'https://www.kleinanzeigen.de/m-einloggen.html';

/** Re-export so callers can `import { isLoggedIn } from './auth.js'`. */
export { isLoggedIn };

/**
 * Ensure a usable session on `page`. If valid, return immediately.
 * Otherwise record a `session_lost` event and attempt auto-relogin.
 */
export async function requireLogin(page: Page, accountId?: number): Promise<void> {
  if (await isLoggedIn(page)) return;

  if (accountId !== undefined) {
    recordHealthEvent(
      accountId,
      'session_lost',
      'warn',
      'Kleinanzeigen-Session abgelaufen — versuche Auto-Relogin',
    );

    const ok = await tryAutoRelogin(page, accountId).catch((err) => {
      log.warn('Auto-Relogin crashed', {
        accountId,
        error: err instanceof Error ? err.message : String(err),
      });
      return false;
    });
    if (ok) {
      log.info('Auto-Relogin successful', { accountId });
      return;
    }
    recordHealthEvent(
      accountId,
      'session_lost',
      'error',
      'Kleinanzeigen Auto-Relogin fehlgeschlagen — manueller Login nötig',
    );
  }

  const accountMsg = accountId !== undefined ? ` (account #${accountId})` : '';
  throw new Error(
    `Kleinanzeigen session not authenticated${accountMsg}. Bitte im Dashboard auf "Accounts" → "Einloggen" klicken.`,
  );
}

/**
 * Try a silent re-login from stored credentials. Credentials must be set
 * via settings keys `ka_account_<id>_email` and `ka_account_<id>_password`.
 *
 * CAPTCHA / hard-block detection short-circuits with a recorded event so
 * the watcher can pause the account if this happens repeatedly.
 */
async function tryAutoRelogin(page: Page, accountId: number): Promise<boolean> {
  const email = getSetting(`ka_account_${accountId}_email`);
  const password = getSetting(`ka_account_${accountId}_password`);
  if (!email || !password) {
    log.debug('Auto-Relogin skipped — no credentials stored', { accountId });
    return false;
  }

  log.info('Attempting auto-relogin', { accountId, email: maskEmail(email) });

  try {
    await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: 25_000 });
  } catch (err) {
    log.warn('Login-page navigation failed', {
      accountId,
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }

  // Hard-block / CAPTCHA gate BEFORE we type anything.
  if (await SEL_BLOCKED.exists(page)) {
    recordHealthEvent(accountId, 'rate_limit', 'error', 'KA Login-Seite zeigt Block-Page');
    return false;
  }
  if (await SEL_CAPTCHA.exists(page)) {
    recordHealthEvent(accountId, 'captcha', 'error', 'KA Login-Seite zeigt CAPTCHA');
    return false;
  }

  // KA's login form uses `loginMail` / `password`. We also try generic
  // selectors so a small UI refresh doesn't break this.
  const emailField = page.locator(
    'input#login-email, input[name="loginMail"], input[type="email"], input[name="email"]',
  ).first();
  const passwordField = page.locator(
    'input#login-password, input[name="password"], input[type="password"]',
  ).first();

  try {
    await emailField.waitFor({ timeout: 8_000 });
    await emailField.fill(email);
    await passwordField.fill(password);
  } catch (err) {
    log.warn('Login-form fields not reachable', {
      accountId,
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }

  await passwordField.press('Enter').catch(() => { /* fall through */ });

  // Give KA a moment to redirect to /m-meine-anzeigen.html or surface
  // a CAPTCHA. We bail early on either signal so we don't spin for 20s.
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (await SEL_CAPTCHA.exists(page)) {
      recordHealthEvent(accountId, 'captcha', 'error', 'KA Post-Submit CAPTCHA');
      return false;
    }
    if (await SEL_BLOCKED.exists(page)) {
      recordHealthEvent(accountId, 'rate_limit', 'error', 'KA Post-Submit Block-Page');
      return false;
    }
    if (await isLoggedIn(page)) {
      recordHealthEvent(accountId, 'ok', 'info', 'KA Auto-Relogin erfolgreich');
      return true;
    }
    await page.waitForTimeout(750);
  }

  log.warn('KA Auto-Relogin timed out without success-indicator', { accountId });
  return false;
}

function maskEmail(email: string): string {
  const at = email.indexOf('@');
  if (at <= 1) return '***';
  return `${email[0]}***${email.slice(at)}`;
}
