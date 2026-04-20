// ──────────────────────────────────────────────────────────────────────────────
// In-process login flow for Temu. Same shape as vinted-bot's.
// User must ALSO click through to PayPal/Klarna/card sub-flow during the
// login so all relevant session cookies are persisted.
// ──────────────────────────────────────────────────────────────────────────────

import { createLogger, SessionTracker, dismissOneTrust } from '@vinted-system/shared';
import { getTemuBrowser, closeTemuBrowser } from './browser.js';
import { isLoggedIn } from './auth.js';

const log = createLogger('temu-login-flow');

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
  const prevHeadless = process.env.HEADLESS;
  try {
    await closeTemuBrowser();
    process.env.HEADLESS = 'false';

    const mb = await getTemuBrowser();
    const page = await mb.context.newPage();

    // User explicitly wants to start on the Temu homepage — NOT /login.html.
    // We land on the German home and let them click "Anmelden" themselves.
    const HOME = `${BASE_URL.replace(/\/$/, '')}/de`;
    await page.goto(HOME, { waitUntil: 'domcontentloaded', timeout: 45_000 });

    // Temu sometimes auto-redirects logged-out users to /login.html. If
    // that happened, bounce back to the home page.
    if (/\/login\.html/.test(page.url())) {
      log.info('Temu auto-redirected to /login.html — bouncing back to home');
      await page.goto(HOME, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    }

    // Kill any cookie banner so the page is usable.
    await dismissOneTrust(page).catch(() => null);

    flowStatus.message =
      'Du bist auf temu.com. Klick oben rechts auf "Anmelden" und log dich ein. Wenn du willst, navigiere danach einmal zu einem Produkt und klick "Jetzt kaufen", damit die PayPal/Klarna-Session auch gespeichert wird.';

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
    if (prevHeadless === undefined) delete process.env.HEADLESS;
    else process.env.HEADLESS = prevHeadless;
    inProgress = false;
  }
}
