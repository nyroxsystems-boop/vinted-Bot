// ──────────────────────────────────────────────────────────────────────────────
// Vinted Trend Worker
//
// Periodically asks the vinted-bot to scrape Vinted's own demand signals
// (top-brands / top-searches / hot-hashtags) on behalf of the primary Vinted
// account, runs each result through the LLM-translator, and persists the
// snapshot into the `vinted_trends` table. CJ-Discovery later reads from
// listUnusedTrends() to seed its next search batch.
//
// Cadence:
//   • Default 12h between scrapes — configurable via
//     setting `vinted_trend_scrape_interval_h` (1..168 sanity range).
//   • First run 5 min after boot so we don't fight the boot-storm.
//   • Wrapped in withLock('vinted-trend-scraper', 600, …) so dev-double-boot
//     doesn't fire two scrapes in parallel against the same account.
//
// Inputs:
//   • Primary Vinted account = listActiveAccountsFor('vinted')[0]
//   • If no active account, log warn + skip the tick (the worker stays alive
//     so a later activation picks up automatically).
// ──────────────────────────────────────────────────────────────────────────────

import {
  createLogger,
  getSetting,
  isPaused,
  withLock,
  markWorkerAlive,
  listActiveAccountsFor,
  upsertVintedTrend,
  recordWorkerEvent,
  type VintedTrend,
} from '@vinted-system/shared';
import { translateTrendBatch } from './trend-to-cj-mapper.js';

const log = createLogger('vinted-trend-worker');
const VINTED_BOT_URL = `http://localhost:${process.env.VINTED_BOT_PORT ?? '4701'}`;

let timer: ReturnType<typeof setInterval> | null = null;
let bootTimeout: ReturnType<typeof setTimeout> | null = null;
let isRunning = false;

const DEFAULT_INTERVAL_H = 12;
const FIRST_RUN_DELAY_MS = 5 * 60 * 1000;

function readIntervalMs(): number {
  const raw = getSetting('vinted_trend_scrape_interval_h');
  const n = raw ? Number(raw) : NaN;
  const hours = Number.isFinite(n) && n >= 1 && n <= 168 ? n : DEFAULT_INTERVAL_H;
  return hours * 60 * 60 * 1000;
}

async function fetchTrendsFromBot(accountId: number): Promise<VintedTrend[]> {
  const res = await fetch(`${VINTED_BOT_URL}/api/trends/scrape`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ account_id: accountId }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`vinted-bot /api/trends/scrape ${res.status}: ${body.slice(0, 200)}`);
  }
  const data = (await res.json()) as { ok?: boolean; trends?: VintedTrend[]; error?: string };
  if (!data.ok || !Array.isArray(data.trends)) {
    throw new Error(data.error ?? 'vinted-bot returned no trends array');
  }
  return data.trends;
}

async function tickInner(): Promise<void> {
  const accounts = listActiveAccountsFor('vinted');
  const primary = accounts[0];
  if (!primary) {
    log.warn('No active Vinted account — skipping trend scrape tick');
    recordWorkerEvent('vinted-trend-scraper', 'warn', 'no active vinted account');
    return;
  }

  log.info('Vinted-trend scrape starting', { accountId: primary.id });

  let trends: VintedTrend[] = [];
  try {
    trends = await fetchTrendsFromBot(primary.id);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.warn('vinted-bot trend scrape failed', { err: msg });
    recordWorkerEvent('vinted-trend-scraper', 'error', `bot scrape failed: ${msg}`);
    return;
  }

  if (trends.length === 0) {
    log.info('vinted-bot returned 0 trends — DOM may have changed or session is blocked');
    recordWorkerEvent('vinted-trend-scraper', 'warn', 'bot returned 0 trends');
    return;
  }

  // First persist the raw trends so the DB row gets an id — translateTrendBatch
  // writes the cj_query back into the same row, which requires `id`.
  for (const t of trends) {
    try {
      upsertVintedTrend(t);
    } catch (err) {
      log.warn('upsertVintedTrend failed', {
        keyword: t.keyword,
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // We need the persisted rows back with their ids before we can cache the
  // LLM translation. Re-load by (keyword, locale, today) which is the UNIQUE
  // constraint. Keeping this simple — read via listLatestTrends since we
  // just inserted them.
  const { listLatestTrends } = await import('@vinted-system/shared');
  const fresh = listLatestTrends({ limit: 500, sinceHours: 1 });

  // Match scraped trends → DB rows by (type, keyword.toLowerCase()).
  const byKey = new Map<string, VintedTrend>();
  for (const t of fresh) byKey.set(`${t.trend_type}::${t.keyword.toLowerCase()}`, t);
  const toTranslate: VintedTrend[] = [];
  for (const t of trends) {
    const dbRow = byKey.get(`${t.trend_type}::${t.keyword.toLowerCase()}`);
    if (dbRow && (!dbRow.cj_query || dbRow.cj_query.trim().length === 0)) {
      toTranslate.push(dbRow);
    }
  }

  if (toTranslate.length === 0) {
    log.info('All scraped trends already translated — skipping LLM batch', {
      scraped: trends.length,
    });
  } else {
    log.info('Translating trends via Gemini', { count: toTranslate.length });
    try {
      await translateTrendBatch(toTranslate, 3);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn('translateTrendBatch failed', { err: msg });
      recordWorkerEvent('vinted-trend-scraper', 'warn', `translate batch failed: ${msg}`);
    }
  }

  log.info('Vinted-trend scrape complete', {
    scraped: trends.length,
    translated: toTranslate.length,
  });
}

async function tick(): Promise<void> {
  if (isRunning) return;
  if (isPaused()) return;
  isRunning = true;
  try {
    await withLock('vinted-trend-scraper', 600, tickInner);
    // withLock writes the heartbeat — but if we early-returned via lock
    // contention we still want the worker to count as alive.
    markWorkerAlive('vinted-trend-scraper');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.warn('Vinted-trend tick failed', { err: msg });
    recordWorkerEvent('vinted-trend-scraper', 'error', `tick failed: ${msg}`);
  } finally {
    isRunning = false;
  }
}

export function startVintedTrendWorker(): void {
  if (timer || bootTimeout) return;
  const intervalMs = readIntervalMs();
  log.info('Vinted-trend worker started', {
    intervalH: intervalMs / 3_600_000,
    firstRunInMin: FIRST_RUN_DELAY_MS / 60_000,
  });
  bootTimeout = setTimeout(() => {
    bootTimeout = null;
    void tick();
  }, FIRST_RUN_DELAY_MS);
  timer = setInterval(() => void tick(), intervalMs);
}

export function stopVintedTrendWorker(): void {
  if (bootTimeout) {
    clearTimeout(bootTimeout);
    bootTimeout = null;
  }
  if (timer) {
    clearInterval(timer);
    timer = null;
    log.info('Vinted-trend worker stopped');
  }
}

/** Manual one-shot trigger for the dashboard / debug routes. */
export async function runVintedTrendOnce(): Promise<{ ok: boolean; error?: string }> {
  if (isRunning) return { ok: false, error: 'already running' };
  try {
    await tick();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
