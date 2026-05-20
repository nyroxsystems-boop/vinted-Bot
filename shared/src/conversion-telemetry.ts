// ──────────────────────────────────────────────────────────────────────────────
// Variant Conversion Telemetry
//
// Per LLM-generated variant: aggregate listing-level performance into a single
// row in `variant_conversion_stats`. The variant-generator reads the top-N
// performing variants per marketplace and prepends them as exemplars in the
// LLM prompt → the model learns from past winners instead of generating
// blind every time.
//
// One row per (variant_id) — variant_id is the PRIMARY KEY of
// `auto_listing_variants`. The marketplace column is duplicated here for
// fast filtering without join.
//
// The conversion-tracker worker calls recomputeAllVariantStats() nightly so
// the data is at most ~24h stale. Within-tick reads use the cached row.
//
// Two derived metrics:
//   conversion_rate = total_sales / max(listings_count, 1)
//   message_rate    = total_messages / max(total_views, 1)
//
// Listings are matched to variants via the auto_listing_variants table:
// every listing produced from a given variant shares the same
// (auto_listing_id, marketplace) tuple. We aggregate listing_metrics +
// marketplace_listings + sales over that join.
// ──────────────────────────────────────────────────────────────────────────────

import { getDb } from './db.js';

export interface VariantStats {
  variant_id: number;
  marketplace: string;
  listings_count: number;
  total_views: number;
  total_likes: number;
  total_messages: number;
  total_sales: number;
  total_revenue: number;
  conversion_rate: number | null;  // sales / listings
  message_rate: number | null;     // messages / views
}

interface RawAgg {
  variant_id: number;
  marketplace: string;
  auto_listing_id: number;
  views: number | null;
  likes: number | null;
  messages: number | null;
  list_price_eur: number | null;
  status: string | null;
  has_sale: number;
}

function safeRate(num: number, denom: number): number | null {
  if (!Number.isFinite(num) || !Number.isFinite(denom)) return null;
  if (denom <= 0) return null;
  return Math.round((num / denom) * 10_000) / 10_000;  // 4 decimals
}

/** Run an aggregation over marketplace_listings for one variant. */
function aggregateOne(variantId: number): VariantStats | null {
  const db = getDb();
  // Pull the variant + every listing that was published with it.
  // We assume one listing per (auto_listing_id, marketplace) — which matches
  // the auto_listing_variants UNIQUE constraint.
  const head = db.prepare(`
    SELECT id AS variant_id, auto_listing_id, marketplace
      FROM auto_listing_variants
     WHERE id = ?
  `).get(variantId) as { variant_id: number; auto_listing_id: number; marketplace: string } | undefined;
  if (!head) return null;

  // Marketplace-listing counters are the source-of-truth for views/likes/messages.
  // Sales come from auto_listings.sold_at / last_sold_at (cross-marketplace) or
  // marketplace_listings.status='sold' (per-mp). We count a sale if either fires.
  const rows = db.prepare(`
    SELECT ml.views, ml.likes, ml.messages, ml.list_price_eur, ml.status,
           CASE
             WHEN ml.status = 'sold' THEN 1
             WHEN al.sold_at IS NOT NULL THEN 1
             WHEN al.last_sold_at IS NOT NULL THEN 1
             ELSE 0
           END AS has_sale
      FROM marketplace_listings ml
      JOIN auto_listings al ON al.folder_num = ml.folder_num
     WHERE al.id = ? AND ml.marketplace = ?
  `).all(head.auto_listing_id, head.marketplace) as Array<{
    views: number | null;
    likes: number | null;
    messages: number | null;
    list_price_eur: number | null;
    status: string | null;
    has_sale: number;
  }>;

  let views = 0, likes = 0, messages = 0, sales = 0, revenue = 0;
  for (const r of rows) {
    views    += r.views ?? 0;
    likes    += r.likes ?? 0;
    messages += r.messages ?? 0;
    if (r.has_sale === 1) {
      sales++;
      revenue += r.list_price_eur ?? 0;
    }
  }

  return {
    variant_id: head.variant_id,
    marketplace: head.marketplace,
    listings_count: rows.length,
    total_views: views,
    total_likes: likes,
    total_messages: messages,
    total_sales: sales,
    total_revenue: Math.round(revenue * 100) / 100,
    conversion_rate: safeRate(sales, Math.max(rows.length, 1)),
    message_rate: safeRate(messages, Math.max(views, 1)),
  };
}

function upsertStats(s: VariantStats): void {
  getDb().prepare(`
    INSERT INTO variant_conversion_stats (
      variant_id, marketplace, listings_count,
      total_views, total_likes, total_messages,
      total_sales, total_revenue,
      conversion_rate, message_rate, computed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(variant_id) DO UPDATE SET
      marketplace      = excluded.marketplace,
      listings_count   = excluded.listings_count,
      total_views      = excluded.total_views,
      total_likes      = excluded.total_likes,
      total_messages   = excluded.total_messages,
      total_sales      = excluded.total_sales,
      total_revenue    = excluded.total_revenue,
      conversion_rate  = excluded.conversion_rate,
      message_rate     = excluded.message_rate,
      computed_at      = datetime('now')
  `).run(
    s.variant_id, s.marketplace, s.listings_count,
    s.total_views, s.total_likes, s.total_messages,
    s.total_sales, s.total_revenue,
    s.conversion_rate, s.message_rate,
  );
}

/** Recompute stats for one variant and persist. Returns the new row. */
export function recomputeVariantStats(variantId: number): VariantStats {
  const s = aggregateOne(variantId);
  if (!s) {
    return {
      variant_id: variantId, marketplace: '',
      listings_count: 0, total_views: 0, total_likes: 0,
      total_messages: 0, total_sales: 0, total_revenue: 0,
      conversion_rate: null, message_rate: null,
    };
  }
  upsertStats(s);
  return s;
}

/** Recompute stats for every variant in the DB. Returns how many rows we touched. */
export function recomputeAllVariantStats(): number {
  const db = getDb();
  const ids = db.prepare(`SELECT id FROM auto_listing_variants`).all() as Array<{ id: number }>;
  let count = 0;
  for (const { id } of ids) {
    try {
      const s = aggregateOne(id);
      if (s) {
        upsertStats(s);
        count++;
      }
    } catch {
      // Best-effort: skip rows that error (e.g. orphaned variants).
    }
  }
  return count;
}

/** Top performers for one marketplace, sorted by conversion_rate then message_rate. */
export function getTopVariants(marketplace: string, limit = 5): VariantStats[] {
  const lim = Math.max(1, Math.min(50, limit));
  const rows = getDb().prepare(`
    SELECT variant_id, marketplace, listings_count,
           total_views, total_likes, total_messages,
           total_sales, total_revenue,
           conversion_rate, message_rate
      FROM variant_conversion_stats
     WHERE marketplace = ?
       AND listings_count >= 1
     ORDER BY (CASE WHEN total_sales > 0 THEN 1 ELSE 0 END) DESC,
              COALESCE(conversion_rate, 0) DESC,
              COALESCE(message_rate, 0) DESC
     LIMIT ?
  `).all(marketplace, lim) as VariantStats[];
  return rows;
}

/** Lookup one variant's stats (or null if not computed yet). */
export function getVariantStats(variantId: number): VariantStats | null {
  const row = getDb().prepare(`
    SELECT variant_id, marketplace, listings_count,
           total_views, total_likes, total_messages,
           total_sales, total_revenue,
           conversion_rate, message_rate
      FROM variant_conversion_stats
     WHERE variant_id = ?
  `).get(variantId) as VariantStats | undefined;
  return row ?? null;
}

/** Read the title/description of a variant — used by variant-generator to
 *  show exemplars to the LLM. Returns null if the variant row is gone. */
export function readVariantContent(variantId: number): {
  variant_id: number;
  title: string;
  description: string;
  tags_json: string | null;
} | null {
  const row = getDb().prepare(`
    SELECT id AS variant_id, title, description, tags_json
      FROM auto_listing_variants
     WHERE id = ?
  `).get(variantId) as { variant_id: number; title: string; description: string; tags_json: string | null } | undefined;
  return row ?? null;
}
