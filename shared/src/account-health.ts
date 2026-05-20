// ──────────────────────────────────────────────────────────────────────────────
// Account-Health helpers
//
// Every per-account bot (Vinted, KA, Depop, …) emits health events when it
// notices something off — a CAPTCHA, a rate-limit, a session-lost, a
// shadowban-signal. Events accumulate in `account_health_events`.
//
// A periodic watcher (orchestrator/account-health-watcher) reads recent
// events per account, decides whether the pattern is bad enough to
// auto-pause, and updates `vinted_accounts.health_status` so the dashboard
// can show a coloured pill without scanning the event log live.
//
// Schema is already in place — see shared/src/schema.sql (table) +
// shared/src/db.ts (4 ensureColumn calls on vinted_accounts).
// ──────────────────────────────────────────────────────────────────────────────

import { getDb } from './db.js';

/** Discrete event types — matches the CHECK constraint in schema.sql. */
export type HealthEventType =
  | 'captcha'
  | 'rate_limit'
  | 'session_lost'
  | 'proxy_down'
  | 'shadowban_signal'
  | 'login_blocked'
  | 'quota_exhausted'
  | 'ok';

export type HealthSeverity = 'info' | 'warn' | 'error' | 'critical';

/** Coarse cached state on `vinted_accounts.health_status`. */
export type HealthStatus = 'ok' | 'warn' | 'degraded' | 'paused' | 'unknown';

export interface HealthEventRow {
  type: HealthEventType;
  severity: HealthSeverity;
  message: string | null;
  created_at: string;
}

/** Append a health-event row + bump the cached `health_last_event_at` on
 *  the account so the watcher knows there's something new to look at. */
export function recordHealthEvent(
  accountId: number,
  type: HealthEventType,
  severity: HealthSeverity,
  message?: string,
  context?: object,
): void {
  const db = getDb();
  const ctxJson = context ? JSON.stringify(context) : null;
  // Wrap in a transaction so the event-insert and the account-update can't
  // observe a partial state if the process is killed mid-write.
  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO account_health_events (account_id, event_type, severity, message, context_json)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(accountId, type, severity, message ?? null, ctxJson);
    db.prepare(
      `UPDATE vinted_accounts SET health_last_event_at = datetime('now') WHERE id = ?`,
    ).run(accountId);
  });
  try {
    tx();
  } catch {
    /* Silent — we never want telemetry to crash a worker tick. */
  }
}

/** Snapshot of recent events + cached status. The dashboard renders this
 *  for the account-health page. `events` is bounded to the most-recent 50
 *  so the response stays small even after a noisy day. */
export function getAccountHealth(accountId: number): {
  status: HealthStatus;
  lastEventAt: string | null;
  events: HealthEventRow[];
} {
  const db = getDb();
  const account = db
    .prepare(
      `SELECT health_status, health_last_event_at FROM vinted_accounts WHERE id = ?`,
    )
    .get(accountId) as { health_status: string; health_last_event_at: string | null } | undefined;

  const events = db
    .prepare(
      `SELECT event_type AS type, severity, message, created_at
         FROM account_health_events
        WHERE account_id = ?
        ORDER BY created_at DESC
        LIMIT 50`,
    )
    .all(accountId) as HealthEventRow[];

  const rawStatus = (account?.health_status ?? 'unknown') as HealthStatus;
  const status: HealthStatus = isHealthStatus(rawStatus) ? rawStatus : 'unknown';

  return {
    status,
    lastEventAt: account?.health_last_event_at ?? null,
    events,
  };
}

function isHealthStatus(value: string): value is HealthStatus {
  return value === 'ok' || value === 'warn' || value === 'degraded' || value === 'paused' || value === 'unknown';
}

/** Count events of a given type within the last `hours` for an account. */
function countRecent(accountId: number, type: HealthEventType, hours: number): number {
  const row = getDb()
    .prepare(
      `SELECT COUNT(*) AS cnt FROM account_health_events
        WHERE account_id = ?
          AND event_type = ?
          AND created_at > datetime('now', '-' || ? || ' hours')`,
    )
    .get(accountId, type, String(hours)) as { cnt: number } | undefined;
  return row?.cnt ?? 0;
}

/** Heuristic decision: is the recent event-pattern bad enough to pause?
 *  Conservative — we'd rather miss a marginal case than pause spuriously.
 *  Rules (each independent; first hit wins):
 *    - 3+ 'captcha' events in 6h   → "Wiederholte CAPTCHAs"
 *    - 1 'shadowban_signal'        → "Shadowban-Signal erkannt"
 *    - 2+ 'rate_limit' in 2h       → "Rate-Limit-Hits"
 *    - 1 'proxy_down'              → "Proxy offline"
 *    - 5+ 'session_lost' in 24h    → "Session immer wieder ungültig"
 *    - 1 'login_blocked'           → "Login blockiert"
 *    - 1 'quota_exhausted'         → "Tageskontingent verbraucht" */
export function shouldAutoPause(accountId: number): { pause: boolean; reason?: string } {
  // Global kill-switch — set `account_health_auto_pause_enabled=false` in
  // settings during initial setup / DataDome-tuning phases so we LOG events
  // without taking accounts offline. Defaults to true.
  const ap = getDb().prepare(
    `SELECT value FROM settings WHERE key = 'account_health_auto_pause_enabled'`,
  ).get() as { value: string } | undefined;
  if (ap?.value === 'false') return { pause: false };

  // Critical signals — pause immediately.
  if (countRecent(accountId, 'shadowban_signal', 24 * 7) >= 1) {
    return { pause: true, reason: 'Shadowban-Signal erkannt' };
  }
  if (countRecent(accountId, 'proxy_down', 1) >= 1) {
    return { pause: true, reason: 'Proxy offline' };
  }
  if (countRecent(accountId, 'login_blocked', 24) >= 1) {
    return { pause: true, reason: 'Login blockiert' };
  }
  if (countRecent(accountId, 'quota_exhausted', 24) >= 1) {
    return { pause: true, reason: 'Tageskontingent verbraucht' };
  }

  // Soft signals — pause only on PERSISTENT failures. The previous thresholds
  // were too aggressive: DataDome-403s look like `session_lost` to auth.ts and
  // a single discovery cycle can produce 5+ events, instantly pausing an
  // otherwise-healthy account. Raised to require persistent failures over
  // a longer window.
  //   - 8+ 'captcha' in 12h           (was 3+ in 6h)
  //   - 5+ 'rate_limit' in 4h         (was 2+ in 2h)
  //   - 15+ 'session_lost' in 12h     (was 5+ in 24h)
  if (countRecent(accountId, 'captcha', 12) >= 8) {
    return { pause: true, reason: 'Wiederholte CAPTCHAs (8+ in 12h)' };
  }
  if (countRecent(accountId, 'rate_limit', 4) >= 5) {
    return { pause: true, reason: 'Anhaltendes Rate-Limit (5+ in 4h)' };
  }
  if (countRecent(accountId, 'session_lost', 12) >= 15) {
    return { pause: true, reason: 'Anhaltender Session-Verlust (15+ in 12h)' };
  }
  return { pause: false };
}

/** Pause an account atomically + record the reason. Idempotent — calling
 *  this on an already-paused account just refreshes the timestamps. */
export function pauseAccount(accountId: number, reason: string): void {
  const db = getDb();
  const tx = db.transaction(() => {
    db.prepare(
      `UPDATE vinted_accounts
          SET active = 0,
              auto_paused_at = datetime('now'),
              auto_paused_reason = ?,
              health_status = 'paused'
        WHERE id = ?`,
    ).run(reason, accountId);
    // Append a 'login_blocked'-flavoured event for traceability; we use
    // 'login_blocked' because it's the closest semantic match in the
    // existing CHECK constraint. The message carries the real reason.
    db.prepare(
      `INSERT INTO account_health_events (account_id, event_type, severity, message)
       VALUES (?, 'login_blocked', 'critical', ?)`,
    ).run(accountId, `Auto-pause: ${reason}`);
  });
  tx();
}

/** Clear the auto-pause flags + re-activate. Records an 'ok' event so the
 *  history shows when the account came back online. */
export function unpauseAccount(accountId: number): void {
  const db = getDb();
  const tx = db.transaction(() => {
    db.prepare(
      `UPDATE vinted_accounts
          SET active = 1,
              auto_paused_at = NULL,
              auto_paused_reason = NULL,
              health_status = 'unknown'
        WHERE id = ?`,
    ).run(accountId);
    db.prepare(
      `INSERT INTO account_health_events (account_id, event_type, severity, message)
       VALUES (?, 'ok', 'info', 'Account manuell oder automatisch wieder aktiviert')`,
    ).run(accountId);
  });
  tx();
}

/** Recompute the cached `health_status` based on recent events. This is
 *  called by the watcher AFTER `shouldAutoPause`; if pause didn't fire we
 *  still want the pill on the dashboard to reflect what's been happening.
 *
 *  Status ladder:
 *    paused    → row has auto_paused_at set (sticky until unpause)
 *    degraded  → 1+ critical or 3+ error events in last 24h
 *    warn      → 1+ error or 3+ warn events in last 24h
 *    ok        → had any 'ok' event in last 24h OR no recent events
 *    unknown   → no events ever and no 'ok' marker */
export function recomputeHealthStatus(accountId: number): HealthStatus {
  const db = getDb();
  const acc = db
    .prepare(`SELECT auto_paused_at FROM vinted_accounts WHERE id = ?`)
    .get(accountId) as { auto_paused_at: string | null } | undefined;
  if (acc?.auto_paused_at) {
    db.prepare(`UPDATE vinted_accounts SET health_status = 'paused' WHERE id = ?`).run(accountId);
    return 'paused';
  }

  const sev = db
    .prepare(
      `SELECT severity, COUNT(*) AS cnt
         FROM account_health_events
        WHERE account_id = ?
          AND created_at > datetime('now', '-24 hours')
          AND event_type != 'ok'
        GROUP BY severity`,
    )
    .all(accountId) as Array<{ severity: HealthSeverity; cnt: number }>;
  const counts = { critical: 0, error: 0, warn: 0, info: 0 } as Record<HealthSeverity, number>;
  for (const row of sev) counts[row.severity] = row.cnt;

  let next: HealthStatus;
  if (counts.critical >= 1 || counts.error >= 3) {
    next = 'degraded';
  } else if (counts.error >= 1 || counts.warn >= 3) {
    next = 'warn';
  } else {
    // No worry-events in the last 24h — check if we have an 'ok' marker
    // or recent activity at all.
    const okRow = db
      .prepare(
        `SELECT 1 FROM account_health_events
          WHERE account_id = ?
            AND event_type = 'ok'
            AND created_at > datetime('now', '-24 hours')
          LIMIT 1`,
      )
      .get(accountId);
    if (okRow) {
      next = 'ok';
    } else {
      // Has the account had ANY event ever?
      const ever = db
        .prepare(`SELECT 1 FROM account_health_events WHERE account_id = ? LIMIT 1`)
        .get(accountId);
      next = ever ? 'ok' : 'unknown';
    }
  }

  db.prepare(`UPDATE vinted_accounts SET health_status = ? WHERE id = ?`).run(next, accountId);
  return next;
}
