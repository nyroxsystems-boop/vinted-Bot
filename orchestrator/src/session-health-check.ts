// ──────────────────────────────────────────────────────────────────────────────
// Vinted Session-Health-Check
//
// The vinted-bot stores its Playwright session in state.json. Cookies expire
// after a few days, or Vinted invalidates them after suspicious activity.
// When that happens every subsequent listing/inbox-poll fails with "not
// authenticated" until a human runs `npm run vinted:login`.
//
// This worker proactively probes /api/health on the vinted-bot every 10 min
// and asks it for the session status. On `expired`/`invalid` we set the
// account's logged_in flag to 0 and fire a critical Telegram alert.
//
// We don't try to auto-re-login — Vinted requires manual 2FA / CAPTCHA the
// first time, so silent re-login would loop into a Captcha-failure anyway.
// ──────────────────────────────────────────────────────────────────────────────

import { createLogger, getDb, getSetting, isPaused, withLock } from '@vinted-system/shared';
import { eventBus } from './events.js';

const log = createLogger('session-health');

let timer: ReturnType<typeof setInterval> | null = null;
const INTERVAL_MS = 10 * 60 * 1000;
const VINTED = `http://localhost:${process.env.VINTED_BOT_PORT ?? '4701'}`;

async function probe(): Promise<{ healthy: boolean; status: string; account?: number }> {
  try {
    const res = await fetch(`${VINTED}/login/status`, {
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return { healthy: false, status: `HTTP ${res.status}` };
    const body = await res.json() as { session?: { state?: string }; login?: { state?: string }; account_id?: number };
    const sessionState = body.session?.state ?? 'unknown';
    const healthy = sessionState === 'valid' || sessionState === 'logged_in';
    return { healthy, status: sessionState, account: body.account_id };
  } catch (err) {
    return { healthy: false, status: err instanceof Error ? err.message : 'fetch failed' };
  }
}

async function tickInner(): Promise<void> {
  const result = await probe();
  const db = getDb();

  if (result.healthy) {
    // Touch a low-key heartbeat so the dashboard can show "last good check".
    db.prepare(`
      INSERT INTO settings(key, value) VALUES ('vinted_session_last_ok', datetime('now'))
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run();
    return;
  }

  // Has the user already been alerted in the last 6h? If so, stay quiet.
  const lastAlert = getSetting('vinted_session_last_alert');
  if (lastAlert) {
    const ageH = (Date.now() - new Date(lastAlert).getTime()) / 3_600_000;
    if (ageH < 6) {
      log.debug('Session still unhealthy but recent alert exists', { status: result.status });
      return;
    }
  }

  log.warn('Vinted session unhealthy', result);

  // Mark all Vinted accounts as logged out so downstream bots stop trying.
  db.prepare(`UPDATE vinted_accounts SET logged_in = 0 WHERE marketplace IN ('vinted', NULL, '') OR marketplace IS NULL`).run();

  db.prepare(`
    INSERT INTO settings(key, value) VALUES ('vinted_session_last_alert', datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run();

  eventBus.publish({
    type: 'alert',
    level: 'error',
    message: `🔒 Vinted-Session ungültig (${result.status}). Bitte \`npm run vinted:login\` ausführen — sonst published/pollt nichts mehr.`,
  });
}

async function tick(): Promise<void> {
  if (isPaused()) return;
  await withLock('session-health-tick', 300, tickInner);
}

export function startSessionHealthCheck(): void {
  if (timer) return;
  log.info('Session-health-check worker started', { intervalMs: INTERVAL_MS, target: VINTED });
  setTimeout(() => void tick(), 30_000);
  timer = setInterval(() => void tick(), INTERVAL_MS);
}

export function stopSessionHealthCheck(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
    log.info('Session-health-check worker stopped');
  }
}
