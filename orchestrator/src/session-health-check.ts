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

import { createLogger, getDb, getSetting, isPaused, withLock, listActiveAccountsFor } from '@vinted-system/shared';
import { eventBus } from './events.js';

const log = createLogger('session-health');

let timer: ReturnType<typeof setInterval> | null = null;
const INTERVAL_MS = 10 * 60 * 1000;
const VINTED = `http://localhost:${process.env.VINTED_BOT_PORT ?? '4701'}`;

async function probeAccount(accountId: number): Promise<{ healthy: boolean; status: string }> {
  try {
    const res = await fetch(`${VINTED}/login/status?account=${accountId}`, {
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return { healthy: false, status: `HTTP ${res.status}` };
    const body = await res.json() as { session?: { state?: string }; login?: { state?: string } };
    const sessionState = body.session?.state ?? 'unknown';
    const healthy = sessionState === 'valid' || sessionState === 'logged_in';
    return { healthy, status: sessionState };
  } catch (err) {
    return { healthy: false, status: err instanceof Error ? err.message : 'fetch failed' };
  }
}

async function tickInner(): Promise<void> {
  // Probe EACH Vinted account separately. The previous version probed only
  // the current-active account and then flipped `logged_in=0` on ALL Vinted
  // accounts when ONE was unhealthy — multi-account users woke up to "all
  // accounts logged out" the moment a single session expired.
  const accounts = listActiveAccountsFor('vinted');
  if (accounts.length === 0) return;
  const db = getDb();
  const unhealthyAccounts: Array<{ id: number; label: string; status: string }> = [];

  for (const acc of accounts) {
    const result = await probeAccount(acc.id);
    if (result.healthy) {
      db.prepare(`
        INSERT INTO settings(key, value) VALUES ('vinted_session_last_ok_' || ?, datetime('now'))
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
      `).run(String(acc.id));
    } else {
      log.warn('Vinted session unhealthy', { accountId: acc.id, label: acc.label, status: result.status });
      // ONLY flip this specific account, not the whole table.
      db.prepare(`UPDATE vinted_accounts SET logged_in = 0 WHERE id = ?`).run(acc.id);
      unhealthyAccounts.push({ id: acc.id, label: acc.label, status: result.status });
    }
  }

  if (unhealthyAccounts.length === 0) {
    // All-healthy heartbeat for the dashboard.
    db.prepare(`
      INSERT INTO settings(key, value) VALUES ('vinted_session_last_ok', datetime('now'))
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run();
    return;
  }

  // Throttle alerts so the user isn't spammed every 10 min for the same
  // account. Alert-key is per-account so each account has its own cooldown.
  const stamp = db.prepare(`
    INSERT INTO settings(key, value) VALUES (?, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `);
  for (const a of unhealthyAccounts) {
    const alertKey = `vinted_session_last_alert_${a.id}`;
    const lastAlert = getSetting(alertKey);
    if (lastAlert) {
      const ageH = (Date.now() - new Date(lastAlert).getTime()) / 3_600_000;
      if (ageH < 6) continue;
    }
    stamp.run(alertKey);
    eventBus.publish({
      type: 'alert',
      level: 'error',
      message: `🔒 Vinted-Session ungültig: ${a.label} (#${a.id}, ${a.status}). Im Dashboard erneut einloggen.`,
    });
  }
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
