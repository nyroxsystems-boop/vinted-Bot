// ──────────────────────────────────────────────────────────────────────────────
// CJ Dropshipping daily API-call quota tracker.
//
// CJ's V2 API gates accounts at ~1000 calls/day. Once exhausted, every
// subsequent request 429s for 24h — which would brick the order pipeline.
// We track per-day usage in `cj_api_calls(date, count)` and surface helpers
// so call-sites can:
//   • bumpCjApiCall()         after EVERY outbound CJ request
//   • shouldThrottleCj(scope) before discovery / tracking / inventory cycles
//     to reserve budget for actual orders (which are critical).
//
// Order placement is treated as MUST-RUN — we'd rather hit the 1000-cap than
// skip a paying customer. Discovery / tracking / inventory throttle earlier
// (80% / 70% / 70%) to leave headroom.
// ──────────────────────────────────────────────────────────────────────────────

import { getDb, getSetting } from './db.js';

const DEFAULT_LIMIT = 1000;

function todayKey(): string {
  // YYYY-MM-DD in UTC — matches SQLite's date('now') so a /health/deep dashboard
  // reading and a worker bump agree on which row to touch.
  return new Date().toISOString().slice(0, 10);
}

function readLimit(): number {
  const v = Number(getSetting('cj_daily_api_quota') ?? String(DEFAULT_LIMIT));
  return Number.isFinite(v) && v > 0 ? v : DEFAULT_LIMIT;
}

/** Increment today's call-count by `amount` (default 1). */
export function bumpCjApiCall(amount = 1): void {
  if (amount <= 0) return;
  try {
    getDb()
      .prepare(
        `INSERT INTO cj_api_calls (date, count, last_call_at)
              VALUES (?, ?, datetime('now'))
         ON CONFLICT(date) DO UPDATE SET
              count = count + excluded.count,
              last_call_at = excluded.last_call_at`,
      )
      .run(todayKey(), amount);
  } catch {
    // Never crash the actual API call because of telemetry.
  }
}

/** Snapshot of today's CJ-quota use. */
export function getCjQuotaUsage(): {
  used_today: number;
  limit: number;
  percent: number;
  remaining: number;
} {
  const limit = readLimit();
  const row = getDb()
    .prepare(`SELECT count FROM cj_api_calls WHERE date = ?`)
    .get(todayKey()) as { count: number } | undefined;
  const used = row?.count ?? 0;
  const remaining = Math.max(0, limit - used);
  const percent = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 100;
  return { used_today: used, limit, percent, remaining };
}

export type CjQuotaReservation = 'order' | 'discovery' | 'tracking' | 'inventory';

/** Throttle decision per call-site:
 *
 *   order      → never throttle until limit is fully exhausted (critical)
 *   discovery  → stop at 80% of limit (preserve budget for orders)
 *   tracking   → stop at 70%
 *   inventory  → stop at 70%
 *   (undefined → conservative 70%)
 */
export function shouldThrottleCj(reservedFor?: CjQuotaReservation): boolean {
  const { used_today, limit } = getCjQuotaUsage();
  if (limit <= 0) return false;

  let threshold: number;
  switch (reservedFor) {
    case 'order':     threshold = limit; break;          // only throttle at 100%
    case 'discovery': threshold = limit * 0.8; break;
    case 'tracking':
    case 'inventory': threshold = limit * 0.7; break;
    default:          threshold = limit * 0.7; break;
  }
  return used_today >= threshold;
}
