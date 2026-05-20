// ──────────────────────────────────────────────────────────────────────────────
// Account Metrics helpers
//
// Per-account daily snapshot of profile-level + aggregate KPIs. Used by:
//  • orchestrator/src/account-metrics-collector.ts — writes one row per
//    (account_id, date) every 24h via upsertAccountMetric().
//  • dashboard/src/pages/Accounts.tsx — reads via /api/accounts/:id/metrics
//    to render follower-counts, ratings, wallet, warnings, today's sales.
//
// Idempotent by design: INSERT OR REPLACE on (account_id, date) so the worker
// can be re-run within the same day without duplicating rows. Warnings are
// stored as a JSON array of plain strings ("captcha_hit", "rate_limit_hit",
// ...) so the collector can append without parsing/re-writing the field.
// ──────────────────────────────────────────────────────────────────────────────

import { getDb } from './db.js';

export interface AccountMetric {
  account_id: number;
  date: string;                  // YYYY-MM-DD
  followers?: number | null;
  following?: number | null;
  rating_avg?: number | null;
  rating_count?: number | null;
  wallet_eur?: number | null;
  verified?: boolean;
  warnings?: string[];
  views_today?: number;
  likes_today?: number;
  messages_today?: number;
  sales_today?: number;
  revenue_today_eur?: number;
}

interface AccountMetricRow {
  id: number;
  account_id: number;
  date: string;
  followers: number | null;
  following: number | null;
  rating_avg: number | null;
  rating_count: number | null;
  wallet_eur: number | null;
  verified: number;
  warnings_json: string | null;
  views_today: number;
  likes_today: number;
  messages_today: number;
  sales_today: number;
  revenue_today_eur: number;
  recorded_at: string;
}

function rowToMetric(row: AccountMetricRow): AccountMetric {
  let warnings: string[] = [];
  if (row.warnings_json) {
    try {
      const parsed = JSON.parse(row.warnings_json);
      if (Array.isArray(parsed)) warnings = parsed.filter((x) => typeof x === 'string');
    } catch {
      /* malformed JSON → treat as no warnings */
    }
  }
  return {
    account_id: row.account_id,
    date: row.date,
    followers: row.followers,
    following: row.following,
    rating_avg: row.rating_avg,
    rating_count: row.rating_count,
    wallet_eur: row.wallet_eur,
    verified: !!row.verified,
    warnings,
    views_today: row.views_today ?? 0,
    likes_today: row.likes_today ?? 0,
    messages_today: row.messages_today ?? 0,
    sales_today: row.sales_today ?? 0,
    revenue_today_eur: row.revenue_today_eur ?? 0,
  };
}

/**
 * Upsert a metric snapshot for (account_id, date). INSERT OR REPLACE so the
 * collector can be re-run within the same day. Note: REPLACE keeps the row's
 * id stable only if you reference by id — here we use the UNIQUE(account_id,
 * date) constraint, so the auto-incremented id may change on each replace.
 * Callers should not rely on the row id.
 */
export function upsertAccountMetric(metric: AccountMetric): void {
  const db = getDb();
  const warningsJson = metric.warnings && metric.warnings.length > 0
    ? JSON.stringify(metric.warnings)
    : null;
  db.prepare(
    `INSERT INTO account_metrics (
       account_id, date, followers, following, rating_avg, rating_count,
       wallet_eur, verified, warnings_json,
       views_today, likes_today, messages_today, sales_today, revenue_today_eur,
       recorded_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(account_id, date) DO UPDATE SET
       followers         = excluded.followers,
       following         = excluded.following,
       rating_avg        = excluded.rating_avg,
       rating_count      = excluded.rating_count,
       wallet_eur        = excluded.wallet_eur,
       verified          = excluded.verified,
       warnings_json     = excluded.warnings_json,
       views_today       = excluded.views_today,
       likes_today       = excluded.likes_today,
       messages_today    = excluded.messages_today,
       sales_today       = excluded.sales_today,
       revenue_today_eur = excluded.revenue_today_eur,
       recorded_at       = datetime('now')`,
  ).run(
    metric.account_id,
    metric.date,
    metric.followers ?? null,
    metric.following ?? null,
    metric.rating_avg ?? null,
    metric.rating_count ?? null,
    metric.wallet_eur ?? null,
    metric.verified ? 1 : 0,
    warningsJson,
    metric.views_today ?? 0,
    metric.likes_today ?? 0,
    metric.messages_today ?? 0,
    metric.sales_today ?? 0,
    metric.revenue_today_eur ?? 0,
  );
}

/** Returns the most recent metric for the account, or null if no rows exist. */
export function getLatestAccountMetric(accountId: number): AccountMetric | null {
  const row = getDb()
    .prepare(
      `SELECT * FROM account_metrics
        WHERE account_id = ?
        ORDER BY date DESC
        LIMIT 1`,
    )
    .get(accountId) as AccountMetricRow | undefined;
  return row ? rowToMetric(row) : null;
}

/**
 * Returns up to `days` most-recent metrics (latest first) for the account.
 * Used by the dashboard to render a follower-trend / sales-trend chart.
 */
export function getAccountMetricsRange(accountId: number, days: number): AccountMetric[] {
  const limit = Math.max(1, Math.min(365, days));
  const rows = getDb()
    .prepare(
      `SELECT * FROM account_metrics
        WHERE account_id = ?
          AND date >= date('now', '-' || ? || ' days')
        ORDER BY date DESC`,
    )
    .all(accountId, limit) as AccountMetricRow[];
  return rows.map(rowToMetric);
}

/**
 * Appends a warning string to today's row for the account. Creates the row
 * if it doesn't exist yet (all profile fields NULL, aggregates 0). Used by
 * the bot when it hits a CAPTCHA / rate-limit so the dashboard can surface
 * it without waiting for the next collector tick.
 */
export function addAccountWarning(accountId: number, warning: string): void {
  const date = new Date().toISOString().slice(0, 10);
  const db = getDb();
  const existing = db
    .prepare(`SELECT warnings_json FROM account_metrics WHERE account_id = ? AND date = ?`)
    .get(accountId, date) as { warnings_json: string | null } | undefined;

  let warnings: string[] = [];
  if (existing?.warnings_json) {
    try {
      const parsed = JSON.parse(existing.warnings_json);
      if (Array.isArray(parsed)) warnings = parsed.filter((x) => typeof x === 'string');
    } catch {
      /* discard malformed */
    }
  }
  // Dedupe — same warning on the same day only counts once.
  if (!warnings.includes(warning)) warnings.push(warning);
  const warningsJson = JSON.stringify(warnings);

  if (existing) {
    db.prepare(
      `UPDATE account_metrics SET warnings_json = ?, recorded_at = datetime('now')
        WHERE account_id = ? AND date = ?`,
    ).run(warningsJson, accountId, date);
  } else {
    db.prepare(
      `INSERT INTO account_metrics (account_id, date, warnings_json)
       VALUES (?, ?, ?)`,
    ).run(accountId, date, warningsJson);
  }
}
