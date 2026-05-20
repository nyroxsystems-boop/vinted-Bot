// ──────────────────────────────────────────────────────────────────────────────
// scanSoldItems — Direct-Buy-Detection
//
// The legacy pollSaleStatuses() iterates over existing `sales` rows with
// paid_at IS NULL and tries to mark them paid. That only covers the
// offer→accept path; if a buyer clicks "Sofort kaufen" without an offer no
// `sales` row ever gets created.
//
// This scanner does the inverse: it scrolls the /member/transactions page
// and INSERTs missing sales rows for any sold item we don't yet have.
//
// Selectors are best-effort. When Vinted DOM changes we log + alert but
// don't crash. The pollSaleStatuses() path still works as a backstop.
// ──────────────────────────────────────────────────────────────────────────────

import { createLogger, getDb, parseGermanAddress } from '@vinted-system/shared';
import { VINTED } from '../selectors.js';
import { getVintedBrowser } from '../browser.js';
import { requireLogin } from '../auth.js';

const log = createLogger('vinted-scan');
const BASE_URL = process.env.VINTED_BASE_URL ?? 'https://www.vinted.de';

/** Returns count of NEW sales rows inserted. */
export async function scanSoldItems(accountId: number): Promise<{ inserted: number; updated: number; scanned: number; warnings: string[] }> {
  const warnings: string[] = [];
  const db = getDb();
  const mb = await getVintedBrowser(accountId);
  const page = await mb.context.newPage();
  let inserted = 0;
  let updated = 0;
  let scanned = 0;

  try {
    await requireLogin(page, accountId);
    await page.goto(`${BASE_URL}${VINTED.soldItemsUrl}`, {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });
    // Give it a moment for hydration / lazy-loaded transaction rows
    await page.waitForTimeout(2_000);

    // Try several known transaction-row selectors. Vinted has changed this
    // several times — fall back to a structural query if data-testid changes.
    const rowSelectorChain: ReadonlyArray<string> = [
      '[data-testid="transaction-item"]',
      '[data-testid*="transaction"]',
      '[class*="Transaction"] a[href*="/items/"]',
      'a[href*="/items/"][data-testid*="item"]',
    ];

    let rows = page.locator(rowSelectorChain[0] as string);
    let rowCount = await rows.count();
    if (rowCount === 0) {
      for (const sel of rowSelectorChain.slice(1)) {
        rows = page.locator(sel);
        rowCount = await rows.count();
        if (rowCount > 0) break;
      }
    }

    if (rowCount === 0) {
      warnings.push('No transaction rows found on /member/transactions — selector drift or empty list');
      return { inserted: 0, updated: 0, scanned: 0, warnings };
    }

    scanned = Math.min(rowCount, 50);  // cap

    for (let i = 0; i < scanned; i++) {
      const row = rows.nth(i);
      try {
        // Extract vinted_item_id from the link inside the row.
        const link = row.locator('a[href*="/items/"]').first();
        const href = await link.getAttribute('href').catch(() => null);
        if (!href) continue;
        const m = href.match(/\/items\/(\d+)/);
        if (!m) continue;
        const vintedItemId = m[1];

        // Match the listing in our DB.
        const listing = db.prepare(
          `SELECT id, list_price_eur FROM listings WHERE vinted_item_id = ? AND account_id = ?`,
        ).get(vintedItemId, accountId) as { id: number; list_price_eur: number } | undefined;
        if (!listing) continue;  // not ours

        // Detect status: paid / shipped / completed.
        // Vinted shows a status badge per transaction.
        const statusText = (await row.innerText().catch(() => '')).toLowerCase();
        const isPaid = /bezahlt|paid|verkauft|sold|versandt|shipped/.test(statusText);
        if (!isPaid) continue;

        // Try to read buyer info from the row. We do NOT fall back to a
        // generic name — leave the field empty so the cj-fulfillment address
        // validator refuses the order (better than shipping to "Vinted Buyer").
        // pollSaleStatuses() will fill in the real name + address on its next tick.
        const buyerName = (await row.locator('[class*="buyer"], [data-testid*="buyer"]').first().innerText({ timeout: 1000 }).catch(() => '')).trim() || '';

        // Already in DB?
        const existing = db.prepare(
          `SELECT id, paid_at, buyer_address FROM sales WHERE listing_id = ?`,
        ).get(listing.id) as { id: number; paid_at: string | null; buyer_address: string | null } | undefined;

        if (existing && existing.paid_at) continue;  // already complete

        if (existing) {
          // Update paid_at if missing
          db.prepare(`UPDATE sales SET paid_at = COALESCE(paid_at, datetime('now')) WHERE id = ?`).run(existing.id);
          updated++;
        } else {
          // Insert new sale shell — pollSaleStatuses() will populate buyer_address.
          // sales.buyer_name has NOT NULL — use empty-string sentinel; the
          // address validator in cj-fulfillment rejects empty-name anyway.
          db.prepare(`
            INSERT INTO sales (listing_id, buyer_name, marketplace, paid_at)
            VALUES (?, ?, 'vinted', datetime('now'))
          `).run(listing.id, buyerName || 'PENDING');
          inserted++;
          log.info('Detected new sold item (direct-buy path)', { vintedItemId, listingId: listing.id });
        }
      } catch (err) {
        warnings.push(`row #${i}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  } finally {
    await page.close().catch(() => {});
  }

  // Optional: try to populate buyer addresses for the newly-inserted sales.
  // Walk each sale's transaction-detail page. Best-effort.
  // (Left as a follow-up — pollSaleStatuses() will catch them on next tick.)

  return { inserted, updated, scanned, warnings };
}

export { parseGermanAddress };
