import type { Page } from 'playwright';
import {
  createLogger,
  isBotBlocked,
  getSetting,
  recordHealthEvent,
} from '@vinted-system/shared';
import { VINTED } from './selectors.js';

const log = createLogger('vinted-auth');
const BASE_URL = process.env.VINTED_BASE_URL ?? 'https://www.vinted.de';

/**
 * Logged-in detection — **two-track**:
 *
 * 1. Cookie check (primary, most reliable). Vinted issues `access_token_web`
 *    and `refresh_token_web` only after a successful session. These are
 *    present regardless of which page the bot is currently sitting on,
 *    so URL state during session-refresh redirects doesn't matter.
 *
 * 2. DOM check (fallback). The header profile-button only renders once
 *    the React tree mounts the logged-in state. Used as a secondary
 *    signal so we don't depend on cookie-name stability alone.
 *
 * Either-or — both have false-negative cases (cookie may not have been
 * written yet right after submit; DOM may not have rendered yet right
 * after a redirect). Together they're robust.
 */
export async function isLoggedIn(page: Page): Promise<boolean> {
  const block = await isBotBlocked(page);
  if (block.blocked) {
    log.warn('Blocked during login check', { reason: block.reason });
    return false;
  }

  // Track 1: session-cookies. ONLY `access_token_web` proves a verified
  // login — Vinted sets that cookie after the OAuth/credential handshake
  // completes successfully.
  //
  // DO NOT also accept `_vinted_fr_session` here: that cookie is a
  // Rails-style anonymous session token Vinted sets on every visit, even
  // before the user has accepted cookies or clicked "Login". Treating it
  // as "logged in" causes the headful login flow to declare success ~30s
  // after the page loads and close the window before the user can finish.
  try {
    const cookies = await page.context().cookies();
    const hasSessionCookie = cookies.some(
      (c) => /vinted/i.test(c.domain) && c.name === 'access_token_web',
    );
    if (hasSessionCookie) return true;
  } catch {
    /* fall through to DOM check */
  }

  // Track 2: DOM probe — the header profile button only appears once the
  // app shell knows the user is authenticated.
  const indicator = page.locator(VINTED.loggedInIndicator).first();
  return (await indicator.count()) > 0;
}

export async function ensureOnVinted(page: Page): Promise<void> {
  if (!page.url().startsWith(BASE_URL)) {
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  }
}

/**
 * Ensure a usable session on `page`. If the stored session is still valid,
 * returns immediately. Otherwise:
 *   1. records a `session_lost` health event,
 *   2. tries `tryAutoRelogin()` from stored per-account credentials —
 *      succeeds silently if both email+password are configured and the
 *      submit doesn't trip a CAPTCHA,
 *   3. otherwise throws so the caller still sees a hard error.
 *
 * CAPTCHA / interstitial detection during auto-relogin emits a `captcha`
 * health event that the watcher can use to auto-pause the account.
 */
export async function requireLogin(page: Page, accountId?: number): Promise<void> {
  await ensureOnVinted(page);
  if (await isLoggedIn(page)) return;

  if (accountId !== undefined) {
    // First mark the session as lost so the watcher sees a pattern build up.
    recordHealthEvent(accountId, 'session_lost', 'warn', 'Vinted-Session abgelaufen — versuche Auto-Relogin');

    const ok = await tryAutoRelogin(page, accountId).catch((err) => {
      log.warn('Auto-Relogin crashed', { accountId, error: err instanceof Error ? err.message : String(err) });
      return false;
    });
    if (ok) {
      log.info('Auto-Relogin successful', { accountId });
      return;
    }
    // Auto-relogin failed (or no credentials stored) — escalate the event
    // to 'error' severity so the watcher can react after enough hits.
    recordHealthEvent(
      accountId,
      'session_lost',
      'error',
      'Auto-Relogin fehlgeschlagen — manuelles Eingreifen nötig',
    );
  }

  const accountMsg = accountId !== undefined ? ` (account #${accountId})` : '';
  throw new Error(
    `Vinted session not authenticated${accountMsg}. Bitte im Dashboard auf "Accounts" → "Einloggen" klicken.`,
  );
}

/**
 * Best-effort headless re-login from stored credentials.
 *
 * Stored under settings keys:
 *   `vinted_account_<id>_email`     — full login email
 *   `vinted_account_<id>_password`  — password (cleartext — local SQLite only)
 *
 * If either is missing → return false (caller emits the user-facing error).
 *
 * If submit triggers a CAPTCHA / interstitial / 2FA we record the matching
 * health event and return false — silent re-login is impossible, the user
 * has to complete it via the headful flow in the dashboard.
 */
async function tryAutoRelogin(page: Page, accountId: number): Promise<boolean> {
  const email = getSetting(`vinted_account_${accountId}_email`);
  const password = getSetting(`vinted_account_${accountId}_password`);
  if (!email || !password) {
    log.debug('Auto-Relogin skipped — no credentials stored', { accountId });
    return false;
  }

  log.info('Attempting auto-relogin', { accountId, email: maskEmail(email) });

  try {
    await page.goto(`${BASE_URL}/member/general/login`, {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });
  } catch (err) {
    log.warn('Login-page navigation failed', { accountId, error: err instanceof Error ? err.message : String(err) });
    return false;
  }

  // CAPTCHA pre-check — if the navigation already lands on a challenge,
  // don't even try to type credentials. Record + bail.
  const blockBefore = await isBotBlocked(page);
  if (blockBefore.blocked) {
    recordHealthEvent(accountId, 'captcha', 'error', `Pre-Submit Block: ${blockBefore.reason ?? 'unknown'}`);
    return false;
  }

  // Locate inputs. Vinted's login form has fielded id="username"/id="password"
  // (the email goes into the "username" input) and a primary submit button.
  // We try a chain of selectors so a small UI refresh doesn't break us.
  const emailField = page.locator(
    'input[name="username"], input[type="email"], input#username, input[autocomplete="email"]',
  ).first();
  const passwordField = page.locator(
    'input[name="password"], input[type="password"], input#password',
  ).first();

  try {
    await emailField.waitFor({ timeout: 8_000 });
    await emailField.fill(email);
    await passwordField.fill(password);
  } catch (err) {
    log.warn('Login-form fields not reachable', { accountId, error: err instanceof Error ? err.message : String(err) });
    return false;
  }

  // Submit. We prefer keyboard-Enter on the password field because the
  // submit-button selector can drift; Enter always submits the active form.
  await passwordField.press('Enter').catch(() => { /* fall through */ });

  // Wait for either the loggedInIndicator OR a CAPTCHA challenge. Don't
  // wait too long — auto-relogin is supposed to be quick; if it takes >20s
  // there's almost certainly an interstitial in the way.
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    // CAPTCHA / block detection — the most important early exit.
    const block = await isBotBlocked(page);
    if (block.blocked) {
      recordHealthEvent(accountId, 'captcha', 'error', `Post-Submit Block: ${block.reason ?? 'unknown'}`);
      return false;
    }
    if (await isLoggedIn(page)) {
      // Success — mirror an 'ok' event so the watcher knows the account
      // recovered (lifts a warn-state back to ok on the next recompute).
      recordHealthEvent(accountId, 'ok', 'info', 'Auto-Relogin erfolgreich');
      return true;
    }
    await page.waitForTimeout(750);
  }

  log.warn('Auto-Relogin timed out without success-indicator', { accountId });
  return false;
}

function maskEmail(email: string): string {
  const at = email.indexOf('@');
  if (at <= 1) return '***';
  return `${email[0]}***${email.slice(at)}`;
}
