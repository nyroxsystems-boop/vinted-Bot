// ──────────────────────────────────────────────────────────────────────────────
// In-process login flow for Vinted — PER-ACCOUNT.
//
// Opens a HEADFUL browser window for the chosen account, polls for login
// completion, persists the session under data/accounts/<id>/, updates the
// vinted_accounts row (logged_in=1, last_login_at), then closes. Can be
// triggered from the dashboard via POST /login/start?account=<id>.
//
// Concurrency: at most ONE login at a time across all accounts — the
// headful browser would otherwise race with itself.
// ──────────────────────────────────────────────────────────────────────────────

import {
  createLogger,
  SessionTracker,
  markAccountLoggedIn,
  markAccountLoggedOut,
  getCurrentAccountId,
  requireAccount,
  setSetting,
} from '@vinted-system/shared';
import { getVintedBrowser, closeVintedBrowser } from './browser.js';
import { isLoggedIn } from './auth.js';

const log = createLogger('vinted-login-flow');

// FIX 8: 2FA-Detection. Wenn Vinted nach Submit eine 2FA-Verify-Seite zeigt
// (per URL oder per code-Input), markieren wir das Setting + werfen einen
// typisierten Error den der Caller (Dashboard) sauber als Banner rendern kann.
export class TwoFactorRequiredError extends Error {
  constructor(message = 'Vinted requires 2FA verification — manual intervention needed') {
    super(message);
    this.name = 'TwoFactorRequiredError';
  }
}

async function detectTwoFactor(page: import('playwright').Page): Promise<boolean> {
  try {
    const url = page.url();
    if (/\/(verify|two[-_]?factor|2fa|mfa|otp|verification)/i.test(url)) return true;
    // Look for typical 2FA inputs without changing network/listen state.
    const hasCodeInput = await page.evaluate(() => {
      const sels = [
        'input[type="tel"]',
        'input[autocomplete="one-time-code"]',
        'input[name*="code" i]',
        'input[name*="otp" i]',
        'input[id*="code" i]',
        'input[id*="otp" i]',
      ];
      for (const s of sels) {
        const el = document.querySelector(s) as HTMLInputElement | null;
        if (el && (el.offsetParent !== null || el.getClientRects().length > 0)) return true;
      }
      // Text-heuristic as final fallback.
      const txt = (document.body?.innerText ?? '').slice(0, 4000).toLowerCase();
      return /two[- ]factor|verification code|bestätigungscode|sicherheitscode|2fa/.test(txt);
    }).catch(() => false);
    return Boolean(hasCodeInput);
  } catch {
    return false;
  }
}
const BASE_URL = process.env.VINTED_BASE_URL ?? 'https://www.vinted.de';
// 15 minutes — Vinted often shows a CAPTCHA + cookie consent before the login
// form is even visible. The user needs time to click through all of it.
const LOGIN_TIMEOUT_MS = 15 * 60 * 1000;
// Wait this long before the first isLoggedIn check so we don't yank the
// browser window away while the user is still reading the cookie banner.
// 30s gives time for the session-refresh redirect chain + cookie banner
// without the loggedInIndicator selectors having a chance to false-positive
// on transient header elements.
const INITIAL_GRACE_MS = 30_000;

export interface LoginFlowStatus {
  state: 'idle' | 'waiting' | 'success' | 'failed';
  account_id: number | null;
  message: string;
  started_at: string | null;
  finished_at: string | null;
}

// Session tracker is per-account (the pipeline checks it before polling).
const sessionTrackers = new Map<number, SessionTracker>();
export function getSessionTracker(accountId: number): SessionTracker {
  let t = sessionTrackers.get(accountId);
  if (!t) {
    t = new SessionTracker();
    sessionTrackers.set(accountId, t);
  }
  return t;
}
// Backwards-compatibility export — defaults to current account.
export const vintedSession = new Proxy({} as SessionTracker, {
  get: (_t, prop) => (getSessionTracker(getCurrentAccountId()) as unknown as Record<string, unknown>)[prop as string],
});

let flowStatus: LoginFlowStatus = {
  state: 'idle',
  account_id: null,
  message: 'Noch nicht gestartet',
  started_at: null,
  finished_at: null,
};
let inProgress = false;

export function getLoginFlowStatus(): LoginFlowStatus {
  return flowStatus;
}

export function isLoginInProgress(): boolean {
  return inProgress;
}

/**
 * Fire-and-forget login for a specific account. If `accountId` is omitted,
 * uses the current-active account. Returns immediately; poll /login/status
 * to observe progress.
 */
export async function startLogin(accountId?: number): Promise<void> {
  if (inProgress) throw new Error('Login läuft bereits');
  const id = accountId ?? getCurrentAccountId();
  requireAccount(id); // throws if unknown

  inProgress = true;
  const tracker = getSessionTracker(id);
  tracker.markChecking();
  flowStatus = {
    state: 'waiting',
    account_id: id,
    message: `Browser wird geöffnet für Account #${id}…`,
    started_at: new Date().toISOString(),
    finished_at: null,
  };

  void runLoginFlow(id).catch((err) => {
    const msg = err instanceof Error ? err.message : String(err);
    log.error('Login flow crashed', { accountId: id, error: msg });
    flowStatus = {
      state: 'failed',
      account_id: id,
      message: msg,
      started_at: flowStatus.started_at,
      finished_at: new Date().toISOString(),
    };
    tracker.markInvalid(msg);
    markAccountLoggedOut(id);
    inProgress = false;
  });
}

async function runLoginFlow(accountId: number): Promise<void> {
  // Login MUST be visible so the user can complete it. Save+restore all
  // three knobs so a concurrent worker doesn't lose visibility config.
  const prevHeadless = process.env.HEADLESS;
  const prevOffscreen = process.env.OFFSCREEN;
  const prevBotVisible = process.env.BOT_VISIBLE;
  const tracker = getSessionTracker(accountId);
  try {
    await closeVintedBrowser(accountId);
    process.env.HEADLESS = 'false';
    process.env.OFFSCREEN = 'false';
    process.env.BOT_VISIBLE = 'true'; // honored by the new visibility decision in browser.ts

    const mb = await getVintedBrowser(accountId);
    const page = await mb.context.newPage();
    // Navigate directly to the signup/login entry point so CAPTCHA + cookie
    // consent are shown immediately — the user doesn't have to hunt for the
    // login button.
    await page.goto(`${BASE_URL}/member/signup/select_type`, {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    }).catch(() => page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 30_000 }));
    // DO NOT auto-dismiss the cookie banner — Vinted's CAPTCHA flow often
    // depends on the user clicking it themselves, and dismissing too early
    // breaks the consent state used by the anti-bot layer.

    flowStatus.message =
      'Browser offen — bitte Cookies akzeptieren, CAPTCHA lösen, einloggen. Das Fenster bleibt 15 Minuten offen.';

    const deadline = Date.now() + LOGIN_TIMEOUT_MS;
    // Give the user a full 15s of initial grace — long enough to read the
    // cookie banner without the bot already polling and closing on us.
    await page.waitForTimeout(INITIAL_GRACE_MS);
    while (Date.now() < deadline) {
      // If the window was closed (user killed the tab), treat as cancellation.
      if (page.isClosed()) {
        log.warn('Login window closed by user before completion');
        flowStatus = {
          state: 'failed',
          account_id: accountId,
          message: 'Fenster wurde geschlossen, bevor der Login abgeschlossen war.',
          started_at: flowStatus.started_at,
          finished_at: new Date().toISOString(),
        };
        tracker.markInvalid(flowStatus.message);
        markAccountLoggedOut(accountId);
        return;
      }
      // FIX 8: 2FA-Detection BEFORE the success check. If Vinted has
      // redirected us to a 2FA verify page or a code-input is visible, flag
      // it so the dashboard can surface a banner. The user still has the
      // 15-minute window to enter the code manually — we just record the
      // state so it isn't silent.
      if (await detectTwoFactor(page)) {
        try { setSetting('vinted_login_needs_2fa', '1'); } catch { /* */ }
        log.warn('2FA detected — manual intervention required', { accountId });
        flowStatus.message =
          '2FA-Schritt erkannt — bitte Code aus E-Mail/SMS/Authenticator im Browser eingeben. Fenster bleibt offen.';
        // Don't throw — we let the user complete 2FA in the open window.
        // Once they're past it, isLoggedIn() flips and we mark success and
        // clear the setting below.
      }
      if (await isLoggedIn(page)) {
        await mb.saveState();
        // Clear 2FA-flag once login succeeded (whether 2FA was needed or not).
        try { setSetting('vinted_login_needs_2fa', '0'); } catch { /* */ }
        // Try to capture username for display in the account switcher.
        const username = await captureUsername(page).catch(() => null);
        markAccountLoggedIn(accountId, username);
        flowStatus = {
          state: 'success',
          account_id: accountId,
          message: `Login für Account #${accountId} erkannt — Session gespeichert. Fenster bleibt 60s offen für Onboarding (oder schließe selbst).`,
          started_at: flowStatus.started_at,
          finished_at: new Date().toISOString(),
        };
        tracker.markValid();
        log.info('Vinted login successful — keeping window open for 60s post-login grace', { accountId, username });

        // POST-LOGIN GRACE: Vinted often shows a multi-step onboarding right
        // after a fresh signup (profile completion, address, photo upload,
        // etc.). The cookie-based isLoggedIn() flips true the moment the
        // OAuth handshake completes — but the user might still be filling
        // out fields. Closing instantly here makes the window "verschwinden"
        // mid-onboarding. Keep the window open another 60s (or until the
        // user closes it themselves), polling sessionState in case the user
        // walks away.
        const graceDeadline = Date.now() + 60_000;
        while (Date.now() < graceDeadline) {
          if (page.isClosed()) {
            log.info('Login window closed by user post-success — clean exit', { accountId });
            return;
          }
          await page.waitForTimeout(2_000);
        }
        log.info('Post-login grace expired — closing window', { accountId });
        return;
      }
      await page.waitForTimeout(4_000);
    }

    flowStatus = {
      state: 'failed',
      account_id: accountId,
      message: 'Timeout nach 15 Minuten — kein Login erkannt.',
      started_at: flowStatus.started_at,
      finished_at: new Date().toISOString(),
    };
    tracker.markInvalid(flowStatus.message);
    markAccountLoggedOut(accountId);
  } finally {
    await closeVintedBrowser(accountId);
    if (prevHeadless === undefined) delete process.env.HEADLESS;
    else process.env.HEADLESS = prevHeadless;
    if (prevOffscreen === undefined) delete process.env.OFFSCREEN;
    else process.env.OFFSCREEN = prevOffscreen;
    if (prevBotVisible === undefined) delete process.env.BOT_VISIBLE;
    else process.env.BOT_VISIBLE = prevBotVisible;
    inProgress = false;
  }
}

async function captureUsername(page: import('playwright').Page): Promise<string | null> {
  try {
    const img = page.locator('header button:has(img[alt])').first();
    if ((await img.count()) === 0) return null;
    const alt = await img.locator('img').first().getAttribute('alt');
    return alt?.trim() || null;
  } catch {
    return null;
  }
}
