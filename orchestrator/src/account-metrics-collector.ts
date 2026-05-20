// ──────────────────────────────────────────────────────────────────────────────
// Account-Metrics Collector
//
// Daily worker that snapshots per-account KPIs into the `account_metrics`
// table. For each active Vinted-account it:
//
//   1. Calls vinted-bot GET /api/profile/stats?account_id=<id> to scrape
//      Vinted's logged-in profile + wallet pages (followers, rating, wallet,
//      verified, bot-side warnings).
//   2. Aggregates listing-level KPIs from `listing_metrics` (today's views +
//      likes joined via marketplace_listings.account_id).
//   3. Aggregates today's sales from `sales` + `listings` (count + revenue).
//   4. Aggregates today's incoming messages from `messages` joined via
//      `chats.account_id`.
//   5. Writes one row via upsertAccountMetric() — idempotent on (account_id,
//      date) so re-runs within the same day overwrite cleanly.
//
// If the profile scrape fails (timeout, captcha, offline) the worker still
// writes the aggregate row with profile fields = NULL. The warnings[] array
// in the result captures whatever the bot saw (captcha_hit, rate_limit,
// not_authenticated, …) so the dashboard can surface a red badge.
//
// Concurrency: protected by `withLock('account-metrics-collector', 300s)`
// to prevent overlapping runs across processes.
// ──────────────────────────────────────────────────────────────────────────────

import {
  createLogger,
  getDb,
  withLock,
  markWorkerAlive,
  listActiveAccountsFor,
  upsertAccountMetric,
  recordWorkerEvent,
  isPaused,
} from '@vinted-system/shared';
import type { AccountMetric } from '@vinted-system/shared';

const log = createLogger('account-metrics-collector');

let timer: ReturnType<typeof setInterval> | null = null;
const INTERVAL_MS = 24 * 60 * 60 * 1000;   // 24h
const VINTED_BOT_URL = `http://localhost:${process.env.VINTED_BOT_PORT ?? '4701'}`;
const PROFILE_SCRAPE_TIMEOUT_MS = 60_000;

interface ProfileStatsResponse {
  ok: boolean;
  accountId: number;
  stats: {
    followers: number | null;
    following: number | null;
    rating_avg: number | null;
    rating_count: number | null;
    verified: boolean;
    wallet_eur: number | null;
    warnings: string[];
  };
}

async function fetchProfileStats(accountId: number): Promise<ProfileStatsResponse['stats'] | null> {
  try {
    const res = await fetch(
      `${VINTED_BOT_URL}/api/profile/stats?account_id=${accountId}`,
      { signal: AbortSignal.timeout(PROFILE_SCRAPE_TIMEOUT_MS) },
    );
    if (!res.ok) {
      const body = await res.json().catch(() => ({})) as { error?: string };
      recordWorkerEvent(
        'account-metrics-collector',
        'warn',
        `profile scrape returned ${res.status}`,
        { accountId, error: body.error ?? 'unknown' },
      );
      return null;
    }
    const body = (await res.json()) as ProfileStatsResponse;
    return body.stats ?? null;
  } catch (err) {
    recordWorkerEvent(
      'account-metrics-collector',
      'warn',
      'profile scrape network error',
      { accountId, error: err instanceof Error ? err.message : String(err) },
    );
    return null;
  }
}

interface AggregateRow {
  views: number;
  likes: number;
  messages: number;
  sales: number;
  revenue: number;
}

/**
 * Aggregate today's KPIs from the relational tables.
 * Today = local-server YYYY-MM-DD (matches the format used in listing_metrics
 * and the upsert key in account_metrics).
 */
function aggregateToday(accountId: number, date: string): AggregateRow {
  const db = getDb();

  // Views + likes: sum of today's listing_metrics rows for listings owned
  // by this account. marketplace_listings is the join bridge because that's
  // what listing_metrics.marketplace_listing_id references.
  const viewsLikes = db
    .prepare(
      `SELECT
         COALESCE(SUM(lm.views), 0)    AS views,
         COALESCE(SUM(lm.likes), 0)    AS likes,
         COALESCE(SUM(lm.messages), 0) AS messages
         FROM listing_metrics lm
         JOIN marketplace_listings ml ON ml.id = lm.marketplace_listing_id
        WHERE ml.account_id = ? AND lm.date = ?`,
    )
    .get(accountId, date) as { views: number; likes: number; messages: number };

  // Sales: count + revenue for today, joining listings → account.
  // Revenue source priority: accepted offer amount > listing list_price.
  const sales = db
    .prepare(
      `SELECT
         COUNT(*) AS cnt,
         COALESCE(SUM(COALESCE(o.amount_eur, l.list_price_eur)), 0) AS revenue
         FROM sales s
         JOIN listings l ON l.id = s.listing_id
    LEFT JOIN offers   o ON o.id = s.offer_id
        WHERE l.account_id = ?
          AND s.paid_at IS NOT NULL
          AND date(s.paid_at) = ?`,
    )
    .get(accountId, date) as { cnt: number; revenue: number };

  // Today's INBOUND messages — `messages.direction = 'in'` joined via chats.
  // We prefer this over the listing_metrics.messages aggregate because that
  // one counts marketplace-listing-scoped messages (which is a subset for
  // marketplaces that report per-listing) and zero for Vinted.
  const msgs = db
    .prepare(
      `SELECT COUNT(*) AS cnt
         FROM messages m
         JOIN chats c ON c.id = m.chat_id
        WHERE c.account_id = ?
          AND m.direction = 'in'
          AND date(m.created_at) = ?`,
    )
    .get(accountId, date) as { cnt: number };

  return {
    views: viewsLikes.views ?? 0,
    likes: viewsLikes.likes ?? 0,
    // Use the messages-table count over listing_metrics' messages — more reliable.
    messages: msgs.cnt ?? 0,
    sales: sales.cnt ?? 0,
    revenue: sales.revenue ?? 0,
  };
}

async function collectForAccount(accountId: number, date: string): Promise<void> {
  const aggregate = aggregateToday(accountId, date);
  const profile = await fetchProfileStats(accountId);

  const metric: AccountMetric = {
    account_id: accountId,
    date,
    followers: profile?.followers ?? null,
    following: profile?.following ?? null,
    rating_avg: profile?.rating_avg ?? null,
    rating_count: profile?.rating_count ?? null,
    wallet_eur: profile?.wallet_eur ?? null,
    verified: profile?.verified ?? false,
    warnings: profile?.warnings ?? [],
    views_today: aggregate.views,
    likes_today: aggregate.likes,
    messages_today: aggregate.messages,
    sales_today: aggregate.sales,
    revenue_today_eur: aggregate.revenue,
  };

  upsertAccountMetric(metric);
  log.info('Wrote account metric', {
    accountId,
    date,
    sales: aggregate.sales,
    revenue: aggregate.revenue,
    followers: profile?.followers ?? 'NULL',
    warnings: profile?.warnings?.length ?? 0,
  });
}

async function tickInner(): Promise<void> {
  const date = new Date().toISOString().slice(0, 10);
  // Vinted-only: the profile-scraper at /api/profile/stats is bound to
  // Vinted's logged-in DOM. eBay/KA/etc. need their own collectors and
  // are filtered out here so we don't run a Vinted-scrape against a
  // non-Vinted browser session.
  const accounts = listActiveAccountsFor('vinted');
  log.info('Collector tick starting', { accounts: accounts.length, date });

  for (const acc of accounts) {
    try {
      await collectForAccount(acc.id, date);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error('collectForAccount failed', { accountId: acc.id, error: msg });
      recordWorkerEvent(
        'account-metrics-collector',
        'error',
        'collectForAccount failed',
        { accountId: acc.id, error: msg },
      );
    }
  }

  markWorkerAlive('account-metrics-collector');
}

async function tick(): Promise<void> {
  if (isPaused()) return;
  await withLock('account-metrics-collector', 300, tickInner);
}

export function startAccountMetricsCollector(): void {
  if (timer) return;
  log.info('Account-metrics-collector started', { intervalMs: INTERVAL_MS });
  // First run 60s after boot so the bot is up + DB migrated.
  setTimeout(() => void tick(), 60_000);
  timer = setInterval(() => void tick(), INTERVAL_MS);
}

export function stopAccountMetricsCollector(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
    log.info('Account-metrics-collector stopped');
  }
}

/** Internal exports for ad-hoc tests / API endpoints. */
export const _internal = { tickInner, collectForAccount, aggregateToday };
