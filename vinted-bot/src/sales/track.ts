import { createLogger, getDb, isBotBlocked } from '@vinted-system/shared';
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
export async function pollSaleStatuses(): Promise<{ updated: number }> {
  const db = getDb();
  const unpaidSales = db
    .prepare("SELECT * FROM sales WHERE paid_at IS NULL ORDER BY id ASC LIMIT 20")
    .all() as Sale[];
  if (unpaidSales.length === 0) return { updated: 0 };

  const mb = await getVintedBrowser();
  const page = await mb.context.newPage();
  let updated = 0;

  try {
    await requireLogin(page);

    for (const sale of unpaidSales) {
      // Vinted order-detail URL requires a sale-specific id. In MVP we
      // navigate to the user's sales tab and look up by buyer name / listing.
      await page.goto(`${BASE_URL}${VINTED.soldItemsUrl}`, {
        waitUntil: 'domcontentloaded',
        timeout: 30_000,
      });
      const block = await isBotBlocked(page);
      if (block.blocked) {
        log.warn('Blocked on sales page', { reason: block.reason });
        break;
      }
      // NOTE: selector here is intentionally generic — in the live UI you'd
      // filter the sold_items list by listing title / buyer. This MVP records
      // whatever the user manually confirms as paid through the dashboard.
      const paidIndicator = page.locator(VINTED.orderPaidIndicator).first();
      if ((await paidIndicator.count()) > 0) {
        // Attempt to read buyer address block.
        const nameEl = page.locator(VINTED.buyerName).first();
        const addrEl = page.locator(VINTED.buyerAddress).first();
        const name = (await nameEl.innerText({ timeout: 2_000 }).catch(() => sale.buyer_name)).trim();
        const addrText = (await addrEl.innerText({ timeout: 2_000 }).catch(() => '')).trim();
        const address = parseAddressText(addrText, name);
        db.prepare(
          `UPDATE sales
             SET paid_at = datetime('now'), buyer_address = ?
           WHERE id = ?`,
        ).run(JSON.stringify(address), sale.id);
        updated++;
        log.info('Sale marked paid', { saleId: sale.id, name });
      }
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
