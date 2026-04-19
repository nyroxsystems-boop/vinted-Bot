// ──────────────────────────────────────────────────────────────────────────────
// In-process login flow for Temu. Same shape as vinted-bot's.
// User must ALSO click through to PayPal/Klarna/card sub-flow during the
// login so all relevant session cookies are persisted.
// ──────────────────────────────────────────────────────────────────────────────

import { createLogger, SessionTracker } from '@vinted-system/shared';
import type { Page } from 'playwright';
import { getTemuBrowser, closeTemuBrowser } from './browser.js';
import { isLoggedIn } from './auth.js';
import { TEMU } from './selectors.js';

const log = createLogger('temu-login-flow');

/**
 * Dismiss Temu's cookie consent dialog (blocks login form on first visit).
 * Prefers "Alle ablehnen" for privacy; falls back to "Alle akzeptieren"
 * only if reject isn't available.
 */
async function dismissConsent(page: Page): Promise<void> {
  const dialog = page.locator(TEMU.consentDialog).first();
  if ((await dialog.count()) === 0) return;
  log.info('Consent dialog detected — dismissing');
  const reject = page.locator(TEMU.consentRejectAll).first();
  if ((await reject.count()) > 0) {
    await reject.scrollIntoViewIfNeeded({ timeout: 2_000 }).catch(() => {});
    await reject.click({ timeout: 3_000 }).catch(() => {});
  } else {
    const accept = page.locator(TEMU.consentAcceptAll).first();
    if ((await accept.count()) > 0) {
      await accept.scrollIntoViewIfNeeded({ timeout: 2_000 }).catch(() => {});
      await accept.click({ timeout: 3_000 }).catch(() => {});
    }
  }
  await page.waitForTimeout(800);
}
const BASE_URL = process.env.TEMU_BASE_URL ?? 'https://www.temu.com';
const LOGIN_TIMEOUT_MS = 10 * 60 * 1000;

export interface LoginFlowStatus {
  state: 'idle' | 'waiting' | 'success' | 'failed';
  message: string;
  started_at: string | null;
  finished_at: string | null;
}

export const temuSession = new SessionTracker();

let flowStatus: LoginFlowStatus = {
  state: 'idle',
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

export async function startLogin(): Promise<void> {
  if (inProgress) {
    throw new Error('Login läuft bereits');
  }
  inProgress = true;
  temuSession.markChecking();
  flowStatus = {
    state: 'waiting',
    message: 'Browser wird geöffnet…',
    started_at: new Date().toISOString(),
    finished_at: null,
  };
  void runLoginFlow().catch((err) => {
    log.error('Login flow crashed', { error: err instanceof Error ? err.message : String(err) });
    flowStatus = {
      state: 'failed',
      message: err instanceof Error ? err.message : String(err),
      started_at: flowStatus.started_at,
      finished_at: new Date().toISOString(),
    };
    temuSession.markInvalid(flowStatus.message);
    inProgress = false;
  });
}

async function runLoginFlow(): Promise<void> {
  try {
    await closeTemuBrowser();
    process.env.HEADLESS = 'false';

    const mb = await getTemuBrowser();
    const page = await mb.context.newPage();
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 45_000 });

    // Dismiss the cookie dialog so the login form is actually usable.
    await dismissConsent(page).catch(() => {
      /* non-fatal — user can also dismiss it manually */
    });

    flowStatus.message =
      'Im Browser bei Temu einloggen UND einmal die Zahlungsmethode (PayPal/Klarna/Karte) durchklicken, damit deren Session-Cookies gespeichert werden.';

    const deadline = Date.now() + LOGIN_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (await isLoggedIn(page)) {
        // Small extra delay so user has time to complete payment-method sub-flow.
        await page.waitForTimeout(2_000);
        await mb.saveState();
        flowStatus = {
          state: 'success',
          message: 'Login erkannt — Session gespeichert.',
          started_at: flowStatus.started_at,
          finished_at: new Date().toISOString(),
        };
        temuSession.markValid();
        log.info('Temu login successful, session persisted');
        return;
      }
      await page.waitForTimeout(3_000);
    }
    flowStatus = {
      state: 'failed',
      message: 'Timeout nach 10 Minuten — kein Login erkannt.',
      started_at: flowStatus.started_at,
      finished_at: new Date().toISOString(),
    };
    temuSession.markInvalid(flowStatus.message);
  } finally {
    await closeTemuBrowser();
    inProgress = false;
  }
}
