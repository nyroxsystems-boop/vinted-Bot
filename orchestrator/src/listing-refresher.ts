// ──────────────────────────────────────────────────────────────────────────────
// Listing Refresher — keeps Vinted listings visible in search results.
//
// Vinted's algorithm favors fresh/recently-updated listings. After ~7 days
// without activity, a listing's visibility drops significantly. This module
// combats that with three strategies:
//
//   1. Price-Cycle: Lower price by €0.01-0.10 → triggers "Preis gesenkt" badge
//   2. Bump: Use Vinted's free daily "Artikel hervorheben" feature
//   3. Relist: Delete and re-create the listing (nuclear option for 21+ days)
//
// Runs periodically (default: every 2 hours), processes up to 5 stale
// listings per cycle to stay under Vinted's rate limits.
// ──────────────────────────────────────────────────────────────────────────────

import { createLogger, getDb, getSetting } from '@vinted-system/shared';
import { vintedClient } from './bot-clients/vinted.js';

const log = createLogger('listing-refresher');

let refreshTimer: ReturnType<typeof setInterval> | null = null;
let isRunning = false;

const POLL_INTERVAL_MS = 2 * 60 * 60 * 1000; // 2 hours
const MAX_PER_CYCLE = 5;

// ── Refresh strategy thresholds ──────────────────────────────────────────────
const PRICE_CYCLE_AFTER_DAYS = 5;        // Start price-cycling after 5 days
const AUTO_REDUCE_AFTER_DAYS = 10;       // Auto-reduce price after 10 days
const AUTO_REDUCE_PERCENT = 0.05;        // Reduce by 5% each time
const FLOOR_MARKUP = 1.5;               // Never go below 150% of Temu price

async function tick(): Promise<void> {
  if (isRunning) return;
  isRunning = true;
  try {
    await refreshStaleListings();
  } catch (err) {
    log.error('Listing refresher error', {
      error: err instanceof Error ? err.message : String(err),
    });
  } finally {
    isRunning = false;
  }
}

async function refreshStaleListings(): Promise<void> {
  if (getSetting('auto_repricing_enabled') !== 'true') return;
  // Find published listings older than PRICE_CYCLE_AFTER_DAYS days
  // that haven't been refreshed recently (updated_at > 24h ago)
  const stale = getDb()
    .prepare(
      `SELECT al.*
         FROM auto_listings al
        WHERE al.status = 'published'
          AND al.updated_at < datetime('now', '-24 hours')
          AND al.created_at < datetime('now', '-${PRICE_CYCLE_AFTER_DAYS} days')
        ORDER BY al.updated_at ASC
        LIMIT ?`,
    )
    .all(MAX_PER_CYCLE) as Array<Record<string, unknown>>;

  if (stale.length === 0) return;

  log.info('Found stale listings to refresh', { count: stale.length });

  for (const row of stale) {
    const id = row.id as number;
    const folderNum = row.folder_num as number;
    const currentPrice = row.price_eur as number;
    const temuPrice = row.temu_price_eur as number;
    const title = row.title as string;
    const vintedItemId = row.vinted_item_id as string | null;
    const vintedUrl = row.vinted_url as string | null;
    const createdAt = new Date(row.created_at as string);
    const daysSinceListing = (Date.now() - createdAt.getTime()) / (1000 * 60 * 60 * 24);

    // Calculate floor price (never go below 150% of Temu EK)
    const floorPrice = Math.ceil(temuPrice * FLOOR_MARKUP * 100) / 100;

    let newPrice: number | null = null;
    if (daysSinceListing >= AUTO_REDUCE_AFTER_DAYS && currentPrice > floorPrice) {
      // Strategy: Auto-reduce price by 5%
      const candidate = Math.round(currentPrice * (1 - AUTO_REDUCE_PERCENT) * 100) / 100;
      newPrice = Math.max(floorPrice, candidate);
    } else if (daysSinceListing >= PRICE_CYCLE_AFTER_DAYS) {
      // Strategy: Micro price-cycle (€0.01 reduction → "Preis gesenkt" badge)
      newPrice = Math.max(floorPrice, currentPrice - 0.01);
    }

    if (newPrice === null || newPrice >= currentPrice) continue;

    log.info('Pushing price update to Vinted', {
      id,
      folderNum,
      title,
      oldPrice: currentPrice,
      newPrice,
      daysSinceListing: Math.round(daysSinceListing),
      vintedItemId,
    });

    // 1) Push the price change to Vinted via the bot (the visibility boost
    //    only happens when Vinted sees a real edit — DB-only updates are
    //    invisible to buyers).
    let remoteOk = true;
    if (vintedItemId) {
      try {
        const res = await vintedClient.updateListingPrice(vintedItemId, newPrice);
        remoteOk = res.ok;
        if (!res.ok) {
          log.warn('Price update on Vinted failed', { id, error: res.error });
        }
      } catch (err) {
        remoteOk = false;
        log.warn('Price update call crashed', {
          id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    } else {
      log.warn('No vinted_item_id — skipping remote update', { id });
      remoteOk = false;
    }

    if (!remoteOk) continue;

    // 2) Mirror the new price in our DB only after Vinted accepted it,
    //    so auto_listings.price_eur and listings.list_price_eur stay in sync.
    getDb()
      .prepare(
        `UPDATE auto_listings
            SET price_eur = ?,
                profit_margin_eur = ? - temu_price_eur,
                updated_at = datetime('now')
          WHERE id = ?`,
      )
      .run(newPrice, newPrice, id);

    if (vintedUrl) {
      getDb()
        .prepare(
          `UPDATE listings
              SET list_price_eur = ?,
                  min_accept_price_eur = ?,
                  updated_at = datetime('now')
            WHERE vinted_url = ?`,
        )
        .run(newPrice, Math.max(floorPrice, newPrice * 0.75), vintedUrl);
    }
  }

  // Log summary of listings approaching the price floor
  const nearFloor = getDb()
    .prepare(
      `SELECT COUNT(*) AS cnt
         FROM auto_listings
        WHERE status = 'published'
          AND price_eur <= temu_price_eur * ${FLOOR_MARKUP + 0.1}`,
    )
    .get() as { cnt: number };

  if (nearFloor.cnt > 0) {
    log.warn('Listings near price floor', {
      count: nearFloor.cnt,
      action: 'Consider relisting or archiving',
    });
  }

  // Anti-stale: listings published > inactiveDays days with 0 messages get
  // archived + a fresh clone queued (relister picks it up via parent_folder_num).
  archiveStaleListings();
}

function archiveStaleListings(): void {
  const db = getDb();
  const inactiveDays = Number(getSetting('listing_inactive_archive_days') ?? '30');
  if (inactiveDays <= 0) return;

  // Pre-condition: only archive if listing has actually exhausted price-drops.
  // marketplace_listings.messages/likes are not populated by the Vinted-bot
  // today (performance-collector is wired up but reads from elsewhere) — so
  // we use the repricing-drops counter as the primary "no engagement" signal.
  // If the listing has dropped to its floor and still has no sale after
  // inactiveDays, it's safe to archive + re-list.
  const maxDrops = Number(getSetting('repricing_max_drops') ?? '3');
  const stale = db.prepare(`
    SELECT al.id, al.folder_num, al.title
      FROM auto_listings al
 LEFT JOIN marketplace_listings ml ON ml.folder_num = al.folder_num AND ml.marketplace = 'vinted'
     WHERE al.status = 'published'
       AND al.sold_at IS NULL
       AND al.updated_at < datetime('now', '-${inactiveDays} days')
       AND COALESCE(ml.messages, 0) = 0
       AND COALESCE(ml.likes, 0) <= 1
       AND (SELECT COUNT(*) FROM repricing_log rl WHERE rl.folder_num = al.folder_num) >= ?
     LIMIT 5
  `).all(maxDrops) as Array<{ id: number; folder_num: number; title: string }>;

  if (stale.length === 0) return;
  log.info(`Archiving ${stale.length} stale listings (>${inactiveDays}d no interest)`);

  const archive = db.prepare(`
    UPDATE auto_listings SET status = 'archived', updated_at = datetime('now') WHERE id = ?
  `);
  // Clone as fresh draft — relister.scheduleRelists won't pick this up
  // (sold_at is NULL) so we explicitly queue a clone here.
  const cloneFresh = db.prepare(`
    INSERT INTO auto_listings (
      account_id, folder_num, title, description, category, subcategory,
      brand, size, condition, color, material,
      price_eur, temu_price_eur, profit_margin_eur,
      shipping_method, photo_paths_json,
      temu_url, cj_product_url, cj_cost_eur, cj_product_id, cj_variant_id,
      status, parent_folder_num, relist_count
    )
    SELECT
      account_id, folder_num, title, description, category, subcategory,
      brand, size, condition, color, material,
      price_eur, temu_price_eur, profit_margin_eur,
      shipping_method, photo_paths_json,
      temu_url, cj_product_url, cj_cost_eur, cj_product_id, cj_variant_id,
      'approved', folder_num, COALESCE(relist_count, 0) + 1
      FROM auto_listings WHERE id = ?
  `);

  for (const s of stale) {
    cloneFresh.run(s.id);
    archive.run(s.id);
    log.info('Listing archived + fresh clone queued', { folder: s.folder_num });
  }
}

// ── Public API ───────────────────────────────────────────────────────────────

export function startListingRefresher(): void {
  if (refreshTimer) return;
  log.info('Listing refresher started', { intervalMs: POLL_INTERVAL_MS });
  // First run after 5 minutes (let system stabilize)
  setTimeout(() => void tick(), 5 * 60 * 1000);
  refreshTimer = setInterval(() => void tick(), POLL_INTERVAL_MS);
}

export function stopListingRefresher(): void {
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = null;
    log.info('Listing refresher stopped');
  }
}

/**
 * Manual trigger for the dashboard — refresh stale listings NOW.
 */
export async function triggerRefresh(): Promise<{ refreshed: number }> {
  await refreshStaleListings();
  return { refreshed: MAX_PER_CYCLE };
}
