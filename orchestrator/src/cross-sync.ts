// ──────────────────────────────────────────────────────────────────────────────
// Cross-Sync Worker
//
// After a sale on marketplace A, this worker automatically deactivates
// the same product on all other marketplaces (B, C, D, ...).
//
// This prevents double-sells — the #1 risk in multi-platform dropshipping.
//
// Flow:
//   1. New sale detected (status = 'sold')
//   2. Look up all marketplace_listings for that folder_num
//   3. For each listing on a DIFFERENT marketplace: call /api/listings/deactivate
//   4. Mark the listing as 'deactivated' in the DB
//
// Multi-marketplace account separation: this worker is account-correct by
// construction — `marketplace_listings.account_id` is already filtered on
// every WHERE clause below, so a sale on Account A's Vinted-identity never
// deactivates Account B's eBay-identity listing on the same folder. The
// per-platform account identities introduced by `vinted_accounts.marketplace`
// don't need any extra filtering here because we never iterate accounts;
// we iterate marketplace_listings rows directly.
// ──────────────────────────────────────────────────────────────────────────────

import { createLogger, getDb, isPaused } from '@vinted-system/shared';
import { BOT_ENDPOINTS } from './marketplaces.js';
import type { MarketplaceId } from '@vinted-system/shared';

const log = createLogger('cross-sync');

let timer: ReturnType<typeof setInterval> | null = null;
let isRunning = false;

const POLL_INTERVAL_MS = 30_000; // 30 seconds — speed matters here
const MAX_PER_CYCLE = 20;

async function tick(): Promise<void> {
  if (isRunning || isPaused()) return;
  isRunning = true;
  try {
    await deactivateSoldListings();
  } catch (err) {
    log.error('Cross-sync worker crashed', {
      error: err instanceof Error ? err.message : String(err),
    });
  } finally {
    isRunning = false;
  }
}

async function deactivateSoldListings(): Promise<void> {
  const db = getDb();

  // C1 — Account-scoped: pull `l.account_id` so the deactivation only
  // touches listings owned by the SAME account. Without this, Account A's
  // sale on Vinted could deactivate Account B's KA listing on the same
  // folder (legitimate scenario: 2 accounts share a CJ-folder).
  const soldItems = db.prepare(`
    SELECT DISTINCT ml.folder_num,
           s.id AS sale_id,
           COALESCE(s.marketplace, 'vinted') AS sold_on,
           l.account_id AS account_id
      FROM sales s
      JOIN listings l ON l.id = s.listing_id
      JOIN marketplace_listings ml
        ON ml.external_id = CAST(l.vinted_item_id AS TEXT)
       AND ml.marketplace = COALESCE(s.marketplace, 'vinted')
     WHERE s.paid_at IS NOT NULL
       AND ml.folder_num > 0
       AND s.id NOT IN (
         SELECT DISTINCT sale_id FROM cross_sync_log WHERE sale_id = s.id
       )
     ORDER BY s.paid_at DESC
     LIMIT ?
  `).all(MAX_PER_CYCLE) as Array<{
    folder_num: number;
    sale_id: number;
    sold_on: string;
    account_id: number;
  }>;

  if (soldItems.length === 0) return;

  // Ensure cross_sync_log table exists (idempotent)
  db.exec(`
    CREATE TABLE IF NOT EXISTS cross_sync_log (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      sale_id     INTEGER NOT NULL,
      folder_num  INTEGER NOT NULL,
      marketplace TEXT NOT NULL,
      external_id TEXT,
      status      TEXT NOT NULL DEFAULT 'pending',
      error       TEXT,
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_cross_sync_sale ON cross_sync_log(sale_id);
  `);

  for (const item of soldItems) {
    // C1 — Find all ACTIVE listings for this product on OTHER marketplaces,
    // BUT only for the same account_id that produced the sale. Without the
    // account-id constraint, a sale on Account A could deactivate Account
    // B's listings on the same folder (data corruption / double-sell).
    const otherListings = db.prepare(`
      SELECT id, marketplace, external_id, account_id
        FROM marketplace_listings
       WHERE folder_num = ?
         AND marketplace != ?
         AND account_id = ?
         AND status = 'active'
    `).all(item.folder_num, item.sold_on, item.account_id) as Array<{
      id: number;
      marketplace: MarketplaceId;
      external_id: string;
      account_id: number;
    }>;

    if (otherListings.length === 0) {
      // No cross-listings to deactivate — mark as done
      db.prepare(`
        INSERT INTO cross_sync_log (sale_id, folder_num, marketplace, status)
        VALUES (?, ?, ?, 'no_others')
      `).run(item.sale_id, item.folder_num, item.sold_on);
      continue;
    }

    log.info(`Cross-sync: Sold #${item.folder_num} on ${item.sold_on} — deactivating ${otherListings.length} other listings`);

    for (const listing of otherListings) {
      try {
        const botUrl = BOT_ENDPOINTS[listing.marketplace];
        if (!botUrl) {
          log.warn(`No bot endpoint for ${listing.marketplace} — skipping`);
          continue;
        }

        const res = await fetch(`${botUrl}/api/listings/deactivate`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            account_id: listing.account_id,
            external_id: listing.external_id,
          }),
          signal: AbortSignal.timeout(30_000),
        });

        const json = await res.json() as { ok: boolean; error?: string };

        if (json.ok) {
          // C1 — Defense-in-depth: also constrain the UPDATE on account_id
          // so even if `listing.id` somehow points at a wrong-account row,
          // we don't deactivate it.
          db.prepare(`
            UPDATE marketplace_listings SET status = 'deactivated', updated_at = datetime('now')
            WHERE id = ? AND account_id = ?
          `).run(listing.id, item.account_id);

          db.prepare(`
            INSERT INTO cross_sync_log (sale_id, folder_num, marketplace, external_id, status)
            VALUES (?, ?, ?, ?, 'deactivated')
          `).run(item.sale_id, item.folder_num, listing.marketplace, listing.external_id);

          log.info(`✓ Deactivated ${listing.marketplace} listing for folder #${item.folder_num}`);
        } else {
          db.prepare(`
            INSERT INTO cross_sync_log (sale_id, folder_num, marketplace, external_id, status, error)
            VALUES (?, ?, ?, ?, 'failed', ?)
          `).run(item.sale_id, item.folder_num, listing.marketplace, listing.external_id, json.error ?? 'unknown');

          log.warn(`✗ Failed to deactivate ${listing.marketplace} listing for folder #${item.folder_num}: ${json.error}`);
        }
      } catch (err) {
        log.error(`Cross-sync deactivation crashed for ${listing.marketplace}`, {
          folderNum: item.folder_num,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }
}

export function startCrossSync(): void {
  if (timer) return;
  log.info('Cross-sync worker started', { intervalMs: POLL_INTERVAL_MS });
  setTimeout(() => void tick(), 10_000); // 10s initial delay
  timer = setInterval(() => void tick(), POLL_INTERVAL_MS);
}

export function stopCrossSync(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
    log.info('Cross-sync worker stopped');
  }
}
