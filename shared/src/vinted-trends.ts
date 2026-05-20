// ──────────────────────────────────────────────────────────────────────────────
// Vinted Trends helpers
//
// Per-snapshot rows of what Vinted-buyers are actually looking at right now,
// scraped from Vinted's own top-brands / top-searches / hot-hashtags pages.
// The CJ-Discovery worker consumes the LLM-translated `cj_query` to target
// imports at demand signals that originate on the destination marketplace
// (instead of CJ's generic "popularity" score, which is supplier-side noise).
//
// Schema (see shared/src/schema.sql):
//   UNIQUE(keyword, locale, date(scraped_at))  → max 1 row per keyword per day
//   We therefore use INSERT … ON CONFLICT(keyword, locale, date(scraped_at))
//   DO UPDATE to keep re-scrapes within the same day idempotent.
//
// Callers:
//   • vinted-bot/src/trend-scraper.ts → writes new rows via upsertVintedTrend()
//   • orchestrator/src/vinted-trend-worker.ts → reads via listLatestTrends()
//     and marks rows used via markTrendUsed() once they've fed CJ-Discovery
//   • orchestrator/src/trend-to-cj-mapper.ts → fills `cj_query` via
//     setTrendCjQuery() (cached LLM translation)
//   • orchestrator/src/cj-discovery.ts (future) → reads listUnusedTrends()
//     to pick high-rank fresh keywords for the next CJ-Search batch
// ──────────────────────────────────────────────────────────────────────────────

import { getDb } from './db.js';

export type TrendType = 'search' | 'brand' | 'category' | 'hashtag';

export interface VintedTrend {
  id?: number;
  trend_type: TrendType;
  keyword: string;
  locale?: string;             // default 'de'
  rank?: number;               // 1 = top
  popularity?: number;         // 0..1 normalized within snapshot
  category_path?: string;      // "Women > Dresses > Mini"
  source_url?: string;
  cj_query?: string;           // LLM-translated EN keyword for CJ-Search
  cj_filter_json?: string;     // optional JSON-string for CJ filter hints
  last_used_at?: string | null;
  imported_count?: number;
  metadata_json?: string;
  scraped_at?: string;
}

interface VintedTrendRow {
  id: number;
  trend_type: TrendType;
  keyword: string;
  locale: string;
  rank: number | null;
  popularity: number | null;
  category_path: string | null;
  source_url: string | null;
  cj_query: string | null;
  cj_filter_json: string | null;
  last_used_at: string | null;
  imported_count: number;
  metadata_json: string | null;
  scraped_at: string;
}

function rowToTrend(row: VintedTrendRow): VintedTrend {
  return {
    id: row.id,
    trend_type: row.trend_type,
    keyword: row.keyword,
    locale: row.locale,
    rank: row.rank ?? undefined,
    popularity: row.popularity ?? undefined,
    category_path: row.category_path ?? undefined,
    source_url: row.source_url ?? undefined,
    cj_query: row.cj_query ?? undefined,
    cj_filter_json: row.cj_filter_json ?? undefined,
    last_used_at: row.last_used_at,
    imported_count: row.imported_count ?? 0,
    metadata_json: row.metadata_json ?? undefined,
    scraped_at: row.scraped_at,
  };
}

/**
 * Upsert one trend row. The (keyword, locale, date(scraped_at)) UNIQUE
 * constraint means we keep at most one snapshot per keyword per day —
 * re-scrapes on the same day refresh rank/popularity but don't duplicate.
 *
 * NULL-safe: leaving cj_query / cj_filter_json undefined preserves whatever
 * the LLM-translator wrote earlier. The upsert only overwrites fields the
 * scraper actually provides.
 */
export function upsertVintedTrend(t: VintedTrend): void {
  const db = getDb();
  const locale = t.locale ?? 'de';
  const cjFilter = t.cj_filter_json ?? null;
  db.prepare(
    `INSERT INTO vinted_trends (
       trend_type, keyword, locale, rank, popularity,
       category_path, source_url, cj_query, cj_filter_json,
       last_used_at, imported_count, metadata_json, scraped_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(keyword, locale, date(scraped_at)) DO UPDATE SET
       trend_type     = excluded.trend_type,
       rank           = COALESCE(excluded.rank, vinted_trends.rank),
       popularity     = COALESCE(excluded.popularity, vinted_trends.popularity),
       category_path  = COALESCE(excluded.category_path, vinted_trends.category_path),
       source_url     = COALESCE(excluded.source_url, vinted_trends.source_url),
       cj_query       = COALESCE(excluded.cj_query, vinted_trends.cj_query),
       cj_filter_json = COALESCE(excluded.cj_filter_json, vinted_trends.cj_filter_json),
       metadata_json  = COALESCE(excluded.metadata_json, vinted_trends.metadata_json),
       scraped_at     = datetime('now')`,
  ).run(
    t.trend_type,
    t.keyword,
    locale,
    t.rank ?? null,
    t.popularity ?? null,
    t.category_path ?? null,
    t.source_url ?? null,
    t.cj_query ?? null,
    cjFilter,
    t.last_used_at ?? null,
    t.imported_count ?? 0,
    t.metadata_json ?? null,
  );
}

/**
 * Return the most-recent trends, optionally filtered by type / minimum rank /
 * recency. Default sort: best rank first (NULLs last), then most-recent.
 */
export function listLatestTrends(opts: {
  limit?: number;
  type?: TrendType;
  minRank?: number;
  sinceHours?: number;
} = {}): VintedTrend[] {
  const limit = Math.max(1, Math.min(500, opts.limit ?? 50));
  const where: string[] = [];
  const params: Array<string | number> = [];
  if (opts.type) {
    where.push('trend_type = ?');
    params.push(opts.type);
  }
  if (opts.minRank !== undefined) {
    where.push('rank IS NOT NULL AND rank <= ?');
    params.push(opts.minRank);
  }
  if (opts.sinceHours !== undefined) {
    where.push("scraped_at >= datetime('now', '-' || ? || ' hours')");
    params.push(opts.sinceHours);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const rows = getDb()
    .prepare(
      `SELECT * FROM vinted_trends
       ${whereSql}
       ORDER BY (rank IS NULL), rank ASC, scraped_at DESC
       LIMIT ?`,
    )
    .all(...params, limit) as VintedTrendRow[];
  return rows.map(rowToTrend);
}

/**
 * Trends that haven't been used yet (last_used_at NULL) OR have been used
 * but the cooldown has expired. CJ-Discovery uses this to avoid re-firing
 * the same keyword every tick. Default cooldown: 24h.
 */
export function listUnusedTrends(opts: {
  limit?: number;
  type?: TrendType;
  cooldownHours?: number;
} = {}): VintedTrend[] {
  const limit = Math.max(1, Math.min(500, opts.limit ?? 20));
  const cooldownH = Math.max(1, opts.cooldownHours ?? 24);
  const where: string[] = [
    "(last_used_at IS NULL OR last_used_at < datetime('now', '-' || ? || ' hours'))",
  ];
  const params: Array<string | number> = [cooldownH];
  if (opts.type) {
    where.push('trend_type = ?');
    params.push(opts.type);
  }
  const rows = getDb()
    .prepare(
      `SELECT * FROM vinted_trends
        WHERE ${where.join(' AND ')}
        ORDER BY (rank IS NULL), rank ASC, scraped_at DESC
        LIMIT ?`,
    )
    .all(...params, limit) as VintedTrendRow[];
  return rows.map(rowToTrend);
}

/**
 * Touch `last_used_at` and bump `imported_count` by `importedDelta`.
 * Called by CJ-Discovery once a trend has been picked for a search-run.
 */
export function markTrendUsed(id: number, importedDelta = 0): void {
  getDb()
    .prepare(
      `UPDATE vinted_trends
          SET last_used_at = datetime('now'),
              imported_count = imported_count + ?
        WHERE id = ?`,
    )
    .run(Math.max(0, Math.floor(importedDelta)), id);
}

/**
 * Persist the LLM-translated CJ-Search query (+ optional filter hints).
 * Called by the trend-to-cj-mapper once per (keyword, locale) — subsequent
 * lookups skip the LLM round-trip via the cached value.
 */
export function setTrendCjQuery(id: number, cjQuery: string, cjFilter?: object): void {
  const filterJson = cjFilter && Object.keys(cjFilter).length > 0
    ? JSON.stringify(cjFilter)
    : null;
  getDb()
    .prepare(
      `UPDATE vinted_trends
          SET cj_query = ?, cj_filter_json = ?
        WHERE id = ?`,
    )
    .run(cjQuery, filterJson, id);
}
