import { createLogger, getDb, isBotBlocked, parseGermanAddress, validateBuyerAddress } from '@vinted-system/shared';
import type { Sale, BuyerAddress } from '@vinted-system/shared';
import { VINTED } from '../selectors.js';
import { getVintedBrowser } from '../browser.js';
import { requireLogin } from '../auth.js';

const log = createLogger('vinted-track');
const BASE_URL = process.env.VINTED_BASE_URL ?? 'https://www.vinted.de';

/**
 * For each sale where paid_at is NULL, visit the order page and try to
 * determine if payment has gone through. When it has, capture the buyer's
 * shipping address (needed so the Temu bot can drop-ship).
 */
export async function pollSaleStatuses(accountId: number): Promise<{ updated: number }> {
  const db = getDb();
  // Only poll sales whose listing belongs to this account, so parallel
  // accounts don't see each other's orders.
  const unpaidSales = db
    .prepare(
      `SELECT s.* FROM sales s
         JOIN listings l ON l.id = s.listing_id
        WHERE s.paid_at IS NULL
          AND l.account_id = ?
        ORDER BY s.id ASC LIMIT 20`,
    )
    .all(accountId) as Sale[];
  if (unpaidSales.length === 0) return { updated: 0 };

  const mb = await getVintedBrowser(accountId);
  const page = await mb.context.newPage();
  let updated = 0;

  try {
    await requireLogin(page, accountId);

    // Resolve each sale to its specific vinted_item_id via the listings table,
    // then find the SAME item on the sold-items page (not just the first one).
    await page.goto(`${BASE_URL}${VINTED.soldItemsUrl}`, {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });
    const block = await isBotBlocked(page);
    if (block.blocked) {
      log.warn('Blocked on sales page', { reason: block.reason });
      return { updated };
    }
    await page.waitForTimeout(1500); // hydration

    for (const sale of unpaidSales) {
      const listing = db.prepare(
        `SELECT vinted_item_id FROM listings WHERE id = ?`,
      ).get(sale.listing_id) as { vinted_item_id: string | null } | undefined;
      const vintedItemId = listing?.vinted_item_id ?? null;
      if (!vintedItemId) {
        log.debug('Sale has no vinted_item_id — skipping match', { saleId: sale.id });
        continue;
      }

      // Find the transaction row that links to /items/{vintedItemId}
      const row = page.locator(`[data-testid="transaction-item"]:has(a[href*="/items/${vintedItemId}"]),`
        + `a[href*="/items/${vintedItemId}"]`).first();
      if ((await row.count()) === 0) {
        log.debug('Sale not visible on transactions page yet', { saleId: sale.id, vintedItemId });
        continue;
      }

      // Determine paid status by scanning the row's text
      const rowText = (await row.innerText().catch(() => '')).toLowerCase();
      const isPaid = /bezahlt|paid|versandt|shipped|verkauft|sold/.test(rowText);
      if (!isPaid) continue;

      // Best-effort: try to read buyer info from the row's transaction-detail link.
      const detailHref = await row.locator('a').first().getAttribute('href').catch(() => null);
      let addressJson = '';
      let resolvedName = sale.buyer_name && sale.buyer_name !== 'PENDING' ? sale.buyer_name : '';
      if (detailHref) {
        try {
          const detail = await page.context().newPage();
          await detail.goto(detailHref.startsWith('http') ? detailHref : `${BASE_URL}${detailHref}`, {
            waitUntil: 'domcontentloaded', timeout: 20_000,
          });
          const nameEl = detail.locator(VINTED.buyerName).first();
          const addrEl = detail.locator(VINTED.buyerAddress).first();
          const name = (await nameEl.innerText({ timeout: 3_000 }).catch(() => '')).trim();
          const addrText = (await addrEl.innerText({ timeout: 3_000 }).catch(() => '')).trim();
          if (name) resolvedName = name;
          if (addrText) {
            const parsed = parseGermanAddress(addrText, resolvedName);
            const err = validateBuyerAddress(parsed);
            if (!err) {
              addressJson = JSON.stringify(parsed);
            } else {
              log.warn('Buyer address parsed but invalid', { saleId: sale.id, err });
            }
          }
          await detail.close();
        } catch (err) {
          log.debug('Detail page fetch failed', { saleId: sale.id, err: err instanceof Error ? err.message : String(err) });
        }
      }

      db.prepare(
        `UPDATE sales
           SET paid_at = datetime('now'),
               buyer_name = CASE WHEN buyer_name IS NULL OR buyer_name='' OR buyer_name='PENDING' THEN ? ELSE buyer_name END,
               buyer_address = CASE WHEN ? != '' THEN ? ELSE buyer_address END
         WHERE id = ?`,
      ).run(resolvedName || sale.buyer_name, addressJson, addressJson, sale.id);
      updated++;
      log.info('Sale marked paid', { saleId: sale.id, vintedItemId, name: resolvedName });
    }
  } finally {
    await page.close();
  }
  return { updated };
}

/**
 * Best-effort address parser. Expects German format:
 *   Street 12
 *   12345 City
 *   Country
 */
function parseAddressText(raw: string, fallbackName: string): BuyerAddress {
  const lines = raw.split('\n').map((l) => l.trim()).filter(Boolean);
  const street = lines[0] ?? '';
  const zipCity = lines[1] ?? '';
  const country = lines[2] ?? 'DE';
  const zipMatch = zipCity.match(/^(\d{4,5})\s+(.+)$/);
  return {
    name: fallbackName,
    street,
    zip: zipMatch?.[1] ?? '',
    city: zipMatch?.[2] ?? zipCity,
    country: country.length === 2 ? country.toUpperCase() : 'DE',
  };
}
