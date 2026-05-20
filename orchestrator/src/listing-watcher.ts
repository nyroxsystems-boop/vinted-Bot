// ──────────────────────────────────────────────────────────────────────────────
// Listing Watcher — periodic scan for products that are 'ready' and don't
// have a listing draft yet. Creates auto_listing drafts automatically.
//
// The watcher runs on a configurable interval (default 30s) and calls
// generateListingsForReadyProducts() from the listing-generator module.
//
// Multi-account ownership: every crawled_products row carries an
// `assigned_account_id` (round-robin'd by cj-discovery on import, see
// shared/src/folder-assignment.ts). Before delegating to the generator
// this worker
//   1. claims any 'ready' rows that are still NULL (legacy/edge-case),
//   2. propagates the assignment onto the freshly-created auto_listings
//      rows so the auto-publisher posts to the correct Vinted account.
// ──────────────────────────────────────────────────────────────────────────────

import {
  assignFolderToAccount,
  createLogger,
  getDb,
  getSetting,
  isPaused,
} from '@vinted-system/shared';
import { generateListingsForReadyProducts } from './listing-generator.js';
import { eventBus } from './events.js';

const log = createLogger('listing-watcher');

let watcherTimer: ReturnType<typeof setInterval> | null = null;
let isRunning = false;

const POLL_INTERVAL_MS = 30_000; // 30 seconds

/** Backfill: any crawled_products row about to be turned into an
 *  auto_listing must own an account first — otherwise the generator's
 *  INSERT defaults `auto_listings.account_id` to 1 and ALL listings end up
 *  on Haupt-Account regardless of round-robin. Idempotent. */
function ensureReadyRowsAssigned(): void {
  const ready = getDb()
    .prepare(
      `SELECT cp.id FROM crawled_products cp
         LEFT JOIN auto_listings al ON al.folder_num = cp.folder_num
        WHERE cp.status = 'ready'
          AND cp.assigned_account_id IS NULL
          AND al.id IS NULL`,
    )
    .all() as Array<{ id: number }>;
  for (const row of ready) {
    assignFolderToAccount(row.id, 'vinted');
  }
}

/** After the generator creates auto_listings rows, copy the folder's
 *  assigned_account_id over so the auto-publisher routes each draft to
 *  the correct Vinted account. The generator currently leaves
 *  `auto_listings.account_id` at its DEFAULT 1 — this fixes that without
 *  touching the generator. */
function syncAccountIdsToAutoListings(): number {
  const r = getDb()
    .prepare(
      `UPDATE auto_listings
          SET account_id = (
            SELECT cp.assigned_account_id
              FROM crawled_products cp
             WHERE cp.folder_num = auto_listings.folder_num
               AND cp.assigned_account_id IS NOT NULL
             LIMIT 1
          )
        WHERE EXISTS (
          SELECT 1 FROM crawled_products cp
           WHERE cp.folder_num = auto_listings.folder_num
             AND cp.assigned_account_id IS NOT NULL
             AND cp.assigned_account_id <> auto_listings.account_id
        )
          AND status IN ('raw','draft','approved')`,
    )
    .run();
  return r.changes;
}

async function tick(): Promise<void> {
  if (isRunning) return; // guard against overlapping runs
  if (isPaused()) return;
  isRunning = true;
  try {
    // 1) Make sure 'ready' rows have an owner before the generator runs.
    ensureReadyRowsAssigned();

    // 2) Generate drafts (status raw/draft) for ready products.
    const result = await generateListingsForReadyProducts();
    if (result.generated > 0) {
      log.info('Listing watcher cycle done', result);
    }

    // 3) Propagate folder ownership onto the freshly-created listings —
    //    runs unconditionally so legacy auto_listings rows with the
    //    default account_id=1 get corrected as soon as their owning
    //    crawled_product carries an assignment.
    const synced = syncAccountIdsToAutoListings();
    if (synced > 0) {
      log.info('Synced account_id onto auto_listings', { rows: synced });
    }

    // Auto-approve drafts if the user has opted in. Drafts only move to
    // 'approved' if they have ≥3 photos AND a CJ mapping (or non-zero margin).
    if (getSetting('auto_listing_auto_approve') === 'true') {
      const r = getDb().prepare(`
        UPDATE auto_listings
           SET status = 'approved', updated_at = datetime('now')
         WHERE status = 'draft'
           AND cj_variant_id IS NOT NULL
           AND profit_margin_eur > 0
           AND json_array_length(COALESCE(photo_paths_json, '[]')) >= 3
      `).run();
      if (r.changes > 0) {
        log.info(`Auto-approved ${r.changes} drafts`);
        eventBus.publish({
          type: 'alert',
          level: 'warn',
          message: `📋 ${r.changes} Drafts automatisch approved (auto_listing_auto_approve=true).`,
        });
      }
    }
  } catch (err) {
    log.error('Listing watcher error', {
      error: err instanceof Error ? err.message : String(err),
    });
  } finally {
    isRunning = false;
  }
}

export function startListingWatcher(): void {
  if (watcherTimer) return;
  log.info('Listing watcher started', { intervalMs: POLL_INTERVAL_MS });
  // Run immediately once, then on interval
  void tick();
  watcherTimer = setInterval(() => void tick(), POLL_INTERVAL_MS);
}

export function stopListingWatcher(): void {
  if (watcherTimer) {
    clearInterval(watcherTimer);
    watcherTimer = null;
    log.info('Listing watcher stopped');
  }
}
