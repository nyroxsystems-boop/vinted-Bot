// ──────────────────────────────────────────────────────────────────────────────
// Etsy Sold-Items Scan
//
// Visits /your/shops/me/orders and scrapes the list of orders. For each
// matched external_id (Etsy listing id) we update marketplace_listings.status
// to 'sold' so the cross-sync worker can deactivate the same item elsewhere.
//
// Etsy has no offers — every sale is a direct buy.
// ──────────────────────────────────────────────────────────────────────────────

import { createLogger, getDb } from '@vinted-system/shared';
import { launchEtsy, isEtsyLoggedIn, ETSY_BASE_URL } from '../browser.js';

const log = createLogger('etsy-scan');

const ORDERS_URL = '/your/shops/me/orders';

// TODO: validate selectors against live site. Etsy's orders UI uses dynamic
// classnames; we accept several alternatives + a generic listing-link fallback.
const ORDER_ROW_SELECTORS: ReadonlyArray<string> = [
  '[data-test-id="receipt-row"]',
  '[data-testid*="order-row"]',
  '[data-test-id*="receipt"]',
  '[class*="Receipt" i] a[href*="/listing/"]',
  'a[href*="/listing/"][data-test-id*="order"]',
];

export interface ScanResult {
  scanned: number;
  inserted: number;
  updated: number;
  warnings: string[];
}

export async function scanEtsySold(accountId: number): Promise<ScanResult> {
  const warnings: string[] = [];
  const db = getDb();
  const ctx = await launchEtsy(accountId, true);
  const page = await ctx.newPage();
  let inserted = 0;
  let updated = 0;
  let scanned = 0;

  try {
    await page.goto(`${ETSY_BASE_URL}${ORDERS_URL}`, {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });
    if (!(await isEtsyLoggedIn(page))) {
      warnings.push('not authenticated');
      return { scanned: 0, inserted: 0, updated: 0, warnings };
    }
    await page.waitForTimeout(2_000);

    // Walk the selector chain until one yields rows.
    let rows = page.locator(ORDER_ROW_SELECTORS[0] as string);
    let rowCount = await rows.count();
    if (rowCount === 0) {
      for (const sel of ORDER_ROW_SELECTORS.slice(1)) {
        rows = page.locator(sel);
        rowCount = await rows.count();
        if (rowCount > 0) break;
      }
    }
    if (rowCount === 0) {
      warnings.push('No order rows found — selector drift or empty list');
      return { scanned: 0, inserted: 0, updated: 0, warnings };
    }

    scanned = Math.min(rowCount, 50);
    for (let i = 0; i < scanned; i++) {
      const row = rows.nth(i);
      try {
        const link = row.locator('a[href*="/listing/"]').first();
        const href = await link.getAttribute('href').catch(() => null);
        if (!href) continue;
        const m = href.match(/\/listing\/(\d+)/);
        if (!m?.[1]) continue;
        const externalId = m[1];

        // Find the matching marketplace_listings row.
        const listing = db
          .prepare(
            `SELECT id, folder_num, status FROM marketplace_listings
             WHERE marketplace = 'etsy' AND account_id = ?
               AND external_id = ?`,
          )
          .get(accountId, externalId) as
          | { id: number; folder_num: number; status: string }
          | undefined;
        if (!listing) continue;

        // Status: Etsy shows "Paid", "Shipped", "Completed", "Refunded".
        const statusText = (await row.innerText().catch(() => '')).toLowerCase();
        const isPaid = /\bpaid\b|\bshipped\b|\bcompleted\b|\bdelivered\b|\bfulfilled\b/.test(statusText);
        if (!isPaid) continue;

        if (listing.status === 'sold') continue;

        db.prepare(
          `UPDATE marketplace_listings
              SET status = 'sold', updated_at = datetime('now')
            WHERE id = ?`,
        ).run(listing.id);
        updated++;
        log.info('Etsy listing marked sold', { externalId, folder_num: listing.folder_num });

        // Also insert a sales-shell row if we can resolve the legacy
        // `listings` (singular) id from folder_num. Best-effort.
        const legacy = db
          .prepare(
            `SELECT id FROM listings WHERE account_id = ?
              AND vinted_item_id = ? LIMIT 1`,
          )
          .get(accountId, externalId) as { id: number } | undefined;
        if (legacy) {
          const existing = db
            .prepare(`SELECT id FROM sales WHERE listing_id = ?`)
            .get(legacy.id) as { id: number } | undefined;
          if (!existing) {
            db.prepare(
              `INSERT INTO sales (listing_id, buyer_name, paid_at)
               VALUES (?, ?, datetime('now'))`,
            ).run(legacy.id, 'PENDING');
            inserted++;
          }
        }
      } catch (err) {
        warnings.push(`row #${i}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    return { scanned, inserted, updated, warnings };
  } catch (err) {
    warnings.push(err instanceof Error ? err.message : String(err));
    return { scanned, inserted, updated, warnings };
  } finally {
    await page.close().catch(() => null);
    await ctx.close().catch(() => null);
  }
}
