// ──────────────────────────────────────────────────────────────────────────────
// Performance-Collector
//
// Tagesjob: für jedes aktive marketplace_listings öffnen wir die Plattform-
// Detail-Seite und scrapen Performance-KPIs (views, likes, messages).
// → Schreiben in listing_metrics als YYYY-MM-DD Snapshot.
// → Auch in marketplace_listings (current totals) aktualisieren.
//
// Adapter sind plattform-spezifisch in scraper-pro-Plattform definiert.
// Werden parallel pro Plattform ausgeführt (eigene Browser-Profile).
//
// Erkenntnis-Use-Case: schwache Listings finden → Auto-Repricing,
// A/B-Title-Vergleich, Best-Performer-Templates.
// ──────────────────────────────────────────────────────────────────────────────

import { chromium } from 'playwright';
import path from 'node:path';
import fs from 'node:fs';
import {
  createLogger,
  getDb,
  fingerprintFor,
  stealthInitScript,
  type MarketplaceId,
} from '@vinted-system/shared';

const log = createLogger('perf-collector');

export interface ListingKPI {
  views: number;
  likes: number;
  messages: number;
}

interface ListingRow {
  id: number;
  marketplace: MarketplaceId;
  account_id: number;
  external_url: string | null;
  external_id: string | null;
}

// ── Per-Platform Scrapers ────────────────────────────────────────────────────

const SCRAPERS: Partial<Record<MarketplaceId, (url: string, accountId: number) => Promise<ListingKPI | null>>> = {
  vinted:        scrapeVinted,
  kleinanzeigen: scrapeKleinanzeigen,
  mercari:       scrapeMercari,
  depop:         scrapeDepop,
  wallapop:      scrapeWallapop,
};

const DATA_ROOT = process.env.PERF_DATA_ROOT
  ?? path.join(process.cwd(), 'data', 'perf-collector');

async function withPage<T>(
  marketplace: MarketplaceId,
  accountId: number,
  fn: (page: import('playwright').Page) => Promise<T>,
): Promise<T> {
  const fp = fingerprintFor(accountId, marketplace);
  const dir = path.join(DATA_ROOT, `${marketplace}-${accountId}`, 'chromium-profile');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const ctx = await chromium.launchPersistentContext(dir, {
    headless: true,
    userAgent: fp.userAgent,
    viewport: fp.viewport,
    locale: fp.locale,
    timezoneId: fp.timezoneId,
    args: ['--disable-blink-features=AutomationControlled'],
  });
  await ctx.addInitScript(stealthInitScript(fp));
  try {
    const page = await ctx.newPage();
    return await fn(page);
  } finally {
    await ctx.close();
  }
}

function parseInt0(s: string | null): number {
  if (!s) return 0;
  const m = s.replace(/[^\d]/g, '');
  return m ? parseInt(m, 10) : 0;
}

async function scrapeVinted(url: string, accountId: number): Promise<ListingKPI | null> {
  return withPage('vinted', accountId, async (page) => {
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 25_000 });
      // Vinted zeigt views als "X Aufrufe" / favorites mit Heart-Icon
      const html = await page.content();
      const views = parseInt0(html.match(/(\d+)\s*(Aufruf|view)/i)?.[1] ?? null);
      const likes = parseInt0(
        await page.locator('[data-testid="item-page__favorites-count"]').first().textContent().catch(() => null)
          ?? html.match(/"favourite_count"\s*:\s*(\d+)/)?.[1]
          ?? null,
      );
      return { views, likes, messages: 0 };
    } catch (err) {
      log.warn('vinted scrape failed', { url, err: String(err) });
      return null;
    }
  });
}

async function scrapeKleinanzeigen(url: string, accountId: number): Promise<ListingKPI | null> {
  return withPage('kleinanzeigen', accountId, async (page) => {
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 25_000 });
      const viewsText = await page.locator('#viewad-cntr-num').first().textContent().catch(() => null);
      // KA hat keinen Likes-Counter, aber "vorgemerkt"-Count manchmal
      const watchText = await page.locator('text=/vorgemerkt/i').first().textContent().catch(() => null);
      return {
        views: parseInt0(viewsText),
        likes: parseInt0(watchText?.match(/(\d+)/)?.[1] ?? null),
        messages: 0,
      };
    } catch (err) {
      log.warn('kleinanzeigen scrape failed', { url, err: String(err) });
      return null;
    }
  });
}

async function scrapeMercari(url: string, accountId: number): Promise<ListingKPI | null> {
  return withPage('mercari', accountId, async (page) => {
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 25_000 });
      const likesText = await page.locator('[data-testid="LikeCount"]').first().textContent().catch(() => null);
      // Mercari-Views sind oft im NEXT_DATA JSON
      const html = await page.content();
      const viewsMatch = html.match(/"viewCount"\s*:\s*(\d+)/);
      return {
        views: parseInt0(viewsMatch?.[1] ?? null),
        likes: parseInt0(likesText),
        messages: 0,
      };
    } catch (err) {
      log.warn('mercari scrape failed', { url, err: String(err) });
      return null;
    }
  });
}

async function scrapeWallapop(url: string, accountId: number): Promise<ListingKPI | null> {
  return withPage('wallapop', accountId, async (page) => {
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 25_000 });
      const html = await page.content();
      const viewsMatch = html.match(/"viewsCount"\s*:\s*(\d+)/);
      const favsMatch = html.match(/"favoritesCount"\s*:\s*(\d+)/);
      const favsLoc = await page.locator('[data-testid="favorites-counter"]').first().textContent().catch(() => null);
      return {
        views: parseInt0(viewsMatch?.[1] ?? null),
        likes: parseInt0(favsMatch?.[1] ?? null) || parseInt0(favsLoc),
        messages: 0,
      };
    } catch (err) {
      log.warn('wallapop scrape failed', { url, err: String(err) });
      return null;
    }
  });
}

async function scrapeDepop(url: string, accountId: number): Promise<ListingKPI | null> {
  return withPage('depop', accountId, async (page) => {
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 25_000 });
      const html = await page.content();
      // Depop NEXT_DATA hat likes/views
      const likesMatch = html.match(/"likeCount"\s*:\s*(\d+)/);
      const viewsMatch = html.match(/"viewsCount"\s*:\s*(\d+)/);
      return {
        views: parseInt0(viewsMatch?.[1] ?? null),
        likes: parseInt0(likesMatch?.[1] ?? null),
        messages: 0,
      };
    } catch (err) {
      log.warn('depop scrape failed', { url, err: String(err) });
      return null;
    }
  });
}

// ── Run ──────────────────────────────────────────────────────────────────────

export async function collectPerformance(opts: { limit?: number } = {}): Promise<{
  scanned: number;
  updated: number;
  errors: number;
}> {
  const stats = { scanned: 0, updated: 0, errors: 0 };
  const limit = opts.limit ?? 200;

  const rows = getDb()
    .prepare(
      `SELECT id, marketplace, account_id, external_url, external_id
         FROM marketplace_listings
        WHERE status = 'active'
          AND external_url IS NOT NULL
        ORDER BY updated_at ASC
        LIMIT ?`,
    )
    .all(limit) as ListingRow[];

  log.info('Performance-Collector starting', { count: rows.length });

  // Group by marketplace and run sequentially per marketplace (not parallel —
  // we don't want N pages on the same site at once and trip rate limits).
  const grouped = new Map<MarketplaceId, ListingRow[]>();
  for (const r of rows) {
    if (!grouped.has(r.marketplace)) grouped.set(r.marketplace, []);
    grouped.get(r.marketplace)!.push(r);
  }

  // But across marketplaces we go in parallel (separate browser ctx per platform anyway).
  await Promise.all(Array.from(grouped.entries()).map(async ([mp, list]) => {
    const scraper = SCRAPERS[mp];
    if (!scraper) {
      log.warn('No scraper for marketplace', { marketplace: mp });
      return;
    }
    for (const row of list) {
      stats.scanned++;
      try {
        const kpi = await scraper(row.external_url!, row.account_id);
        if (!kpi) {
          stats.errors++;
          continue;
        }
        recordKpi(row.id, kpi);
        stats.updated++;
      } catch (err) {
        stats.errors++;
        log.error('scrape failed', {
          listingId: row.id,
          marketplace: row.marketplace,
          err: err instanceof Error ? err.message : String(err),
        });
      }
      // Politeness delay between calls auf gleicher Plattform
      await new Promise((r) => setTimeout(r, 1500));
    }
  }));

  log.info('Performance-Collector done', stats);
  return stats;
}

function recordKpi(marketplaceListingId: number, kpi: ListingKPI): void {
  const date = new Date().toISOString().slice(0, 10);
  const db = getDb();
  // Upsert Tagesschnappschuss
  db.prepare(
    `INSERT INTO listing_metrics (marketplace_listing_id, date, views, likes, messages)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(marketplaceListingId, date, kpi.views, kpi.likes, kpi.messages);
  // Update current totals
  db.prepare(
    `UPDATE marketplace_listings
        SET views = ?, likes = ?, messages = ?, updated_at = datetime('now')
      WHERE id = ?`,
  ).run(kpi.views, kpi.likes, kpi.messages, marketplaceListingId);
}

// ── Scheduler-Hook ──────────────────────────────────────────────────────────

let timer: NodeJS.Timeout | null = null;

export function startPerformanceCollector(intervalHours = 24): void {
  if (timer) return;
  const ms = intervalHours * 60 * 60 * 1000;
  log.info(`Performance-Collector scheduled every ${intervalHours}h`);
  // Erster Run nach 60s (damit Bots erst booten)
  setTimeout(() => { void collectPerformance().catch((e) => log.error('first run', { err: String(e) })); }, 60_000);
  timer = setInterval(() => {
    void collectPerformance().catch((e) => log.error('scheduled run', { err: String(e) }));
  }, ms);
}

export function stopPerformanceCollector(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
    log.info('Performance-Collector stopped');
  }
}

/** Top-Performer / Worst-Performer Helper für Dashboard. */
export function topListings(opts: { limit?: number; by?: 'views' | 'likes' } = {}): unknown[] {
  const by = opts.by ?? 'views';
  const limit = opts.limit ?? 20;
  return getDb()
    .prepare(
      `SELECT ml.*, COALESCE(lm_today.views, ml.views) AS views_today,
              COALESCE(lm_today.likes, ml.likes) AS likes_today
         FROM marketplace_listings ml
         LEFT JOIN listing_metrics lm_today
           ON lm_today.marketplace_listing_id = ml.id
          AND lm_today.date = date('now')
        WHERE ml.status = 'active'
        ORDER BY ${by} DESC
        LIMIT ?`,
    )
    .all(limit);
}

export function staleListings(olderThanDays = 7): unknown[] {
  return getDb()
    .prepare(
      `SELECT ml.*,
              (SELECT MAX(date) FROM listing_metrics WHERE marketplace_listing_id = ml.id) AS last_metric_date
         FROM marketplace_listings ml
        WHERE ml.status = 'active'
          AND ml.created_at <= datetime('now', '-' || ? || ' days')
          AND COALESCE(ml.likes, 0) = 0
          AND COALESCE(ml.messages, 0) = 0
        ORDER BY ml.created_at ASC`,
    )
    .all(olderThanDays);
}
