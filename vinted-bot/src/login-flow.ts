// ──────────────────────────────────────────────────────────────────────────────
// In-process login flow for Vinted.
//
// Opens a HEADFUL browser window, polls for login completion, persists the
// session to playwright-data/state.json, then closes. Can be triggered from
// the dashboard via POST /login/start; progress is queried via GET
// /login/status.
// ──────────────────────────────────────────────────────────────────────────────

import { createLogger, SessionTracker, dismissOneTrust } from '@vinted-system/shared';
import { getVintedBrowser, closeVintedBrowser } from './browser.js';
import { isLoggedIn } from './auth.js';

const log = createLogger('vinted-login-flow');
const BASE_URL = process.env.VINTED_BASE_URL ?? 'https://www.vinted.de';
const LOGIN_TIMEOUT_MS = 5 * 60 * 1000;

export interface LoginFlowStatus {
  state: 'idle' | 'waiting' | 'success' | 'failed';
  message: string;
  started_at: string | null;
  finished_at: string | null;
}

export const vintedSession = new SessionTracker();

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

/**
 * Fire-and-forget login. Call returns immediately; poll /login/status to
 * observe progress. Only ONE login can run at a time per bot.
 */
export async function startLogin(): Promise<void> {
  if (inProgress) {
    throw new Error('Login läuft bereits');
  }
  inProgress = true;
  vintedSession.markChecking();
  flowStatus = {
    state: 'waiting',
    message: 'Browser wird geöffnet…',
    started_at: new Date().toISOString(),
    finished_at: null,
  };

  // Run the flow in the background.
  void runLoginFlow().catch((err) => {
    log.error('Login flow crashed', { error: err instanceof Error ? err.message : String(err) });
    flowStatus = {
      state: 'failed',
      message: err instanceof Error ? err.message : String(err),
      started_at: flowStatus.started_at,
      finished_at: new Date().toISOString(),
    };
    vintedSession.markInvalid(flowStatus.message);
    inProgress = false;
  });
}

async function runLoginFlow(): Promise<void> {
  // Remember previous headless mode so we can restore it after login.
  const prevHeadless = process.env.HEADLESS;
  try {
    // Close any existing (possibly headless) browser first.
    await closeVintedBrowser();

    // Force headful so the user can actually see + interact.
    process.env.HEADLESS = 'false';

    const mb = await getVintedBrowser();
    const page = await mb.context.newPage();
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 30_000 });

    // Kill the OneTrust cookie banner so the login form is clickable.
    await dismissOneTrust(page).catch(() => null);

    flowStatus.message = 'Bitte im Browser-Fenster einloggen (E-Mail, Passwort, ggf. SMS-Code).';

    const deadline = Date.now() + LOGIN_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (await isLoggedIn(page)) {
        await mb.saveState();
        flowStatus = {
          state: 'success',
          message: 'Login erkannt — Session gespeichert.',
          started_at: flowStatus.started_at,
          finished_at: new Date().toISOString(),
        };
        vintedSession.markValid();
        log.info('Vinted login successful, session persisted');
        return;
      }
      await page.waitForTimeout(3000);
    }

    flowStatus = {
      state: 'failed',
      message: 'Timeout nach 5 Minuten — kein Login erkannt.',
      started_at: flowStatus.started_at,
      finished_at: new Date().toISOString(),
    };
    vintedSession.markInvalid(flowStatus.message);
  } finally {
    await closeVintedBrowser();
    // Restore previous HEADLESS setting so future polls run in the background.
    if (prevHeadless === undefined) delete process.env.HEADLESS;
    else process.env.HEADLESS = prevHeadless;
    inProgress = false;
  }
}
