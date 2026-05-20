// ──────────────────────────────────────────────────────────────────────────────
// eBay-DE sale detector.
//
// Polls eBay's Fulfillment API for PAID orders every hour. For each new order:
//   1. Look up the marketplace_listings row by external_id (= eBay listingId)
//   2. INSERT INTO sales with marketplace='ebay_de', paid_at, buyer_address
//   3. Stamp sold_at on auto_listings (relister picks it up + cross-sync
//      deactivates the listing on other platforms)
//
// Idempotent via the `eu_processed_orders` table — each eBay orderId is
// recorded so we don't re-insert sales on subsequent polls.
//
// Pause-aware. Skips silently if eBay isn't configured (no env keys).
// ──────────────────────────────────────────────────────────────────────────────

import { createLogger, getDb, isPaused, withLock } from '@vinted-system/shared';
import { getRecentOrders, isEbayConfigured } from './ebay-api.js';

const log = createLogger('ebay-sale-detector');

// 1 hour interval. eBay orders take a few minutes to materialize after payment,
// and we want to give buyers some time to update shipping address.
const INTERVAL_MS = 60 * 60 * 1000;
const LOOKBACK_MS = 7 * 24 * 3600 * 1000; // 7 days

let timer: ReturnType<typeof setInterval> | null = null;
let isRunning = false;

// Cache table for processed eBay order IDs (idempotent).
function ensureProcessedTable(): void {
  getDb().exec(`
    CREATE TABLE IF NOT EXISTS ebay_processed_orders (
      order_id   TEXT PRIMARY KEY,
      processed_at TEXT NOT NULL DEFAULT (datetime('now')),
      sale_id    INTEGER
    )
  `);
}

async function tick(): Promise<void> {
  if (isRunning) return;
  if (isPaused()) return;
  if (!isEbayConfigured()) return; // env keys not present — silent skip
  isRunning = true;
  try {
    await withLock('ebay-sale-detector-tick', 300, runTick);
  } catch (err) {
    log.error('eBay sale-detector crashed', { error: err instanceof Error ? err.message : String(err) });
  } finally {
    isRunning = false;
  }
}

async function runTick(): Promise<void> {
  ensureProcessedTable();
  const db = getDb();

  const orders = await getRecentOrders(Date.now() - LOOKBACK_MS);
  if (orders.length === 0) return;

  const alreadyProcessed = db.prepare('SELECT order_id FROM ebay_processed_orders WHERE order_id = ?');
  const markProcessed = db.prepare('INSERT OR IGNORE INTO ebay_processed_orders (order_id, sale_id) VALUES (?, ?)');

  let newSales = 0;
  for (const order of orders) {
    if (order.orderPaymentStatus !== 'PAID') continue;
    if (alreadyProcessed.get(order.orderId)) continue;

    // Sales support 1 listing per row, eBay orders can have multiple items.
    // For combined-shipping orders we create one sales row per item.
    for (const item of order.items) {
      const saleId = materializeSale(order, item);
      if (saleId) {
        newSales++;
        markProcessed.run(order.orderId + ':' + item.listingId, saleId);
      }
    }
    // Mark the whole order processed so we don't re-iterate
    markProcessed.run(order.orderId, null);
  }

  if (newSales > 0) {
    log.info('eBay sales materialized', { newSales, totalOrders: orders.length });
  }
}

function materializeSale(
  order: Awaited<ReturnType<typeof getRecentOrders>>[number],
  item: Awaited<ReturnType<typeof getRecentOrders>>[number]['items'][number],
): number | null {
  const db = getDb();

  // 1. Find the listing in marketplace_listings by external_id
  const ml = db.prepare(`
    SELECT id, account_id, folder_num, external_id, list_price_eur
      FROM marketplace_listings
     WHERE marketplace = 'ebay_de' AND external_id = ?
       AND status = 'active'
     LIMIT 1
  `).get(item.listingId) as { id: number; account_id: number; folder_num: number; external_id: string; list_price_eur: number } | undefined;

  if (!ml) {
    log.warn('No marketplace_listings row for eBay order — skipping', {
      orderId: order.orderId, listingId: item.listingId, title: item.title,
    });
    return null;
  }

  // 2. Find or create the listings table row (relister + cross-sync read this)
  let lst = db.prepare(`
    SELECT id FROM listings WHERE vinted_url LIKE ? OR vinted_item_id = ?
     LIMIT 1
  `).get('%ebay_de%' + item.listingId, item.listingId) as { id: number } | undefined;

  if (!lst) {
    lst = db.prepare(`
      INSERT INTO listings (account_id, vinted_url, vinted_item_id, title, list_price_eur, min_accept_price_eur, status)
      VALUES (?, ?, ?, ?, ?, ?, 'sold')
      RETURNING id
    `).get(
      ml.account_id,
      `ebay_de:${item.listingId}`,
      item.listingId,
      item.title,
      ml.list_price_eur,
      Math.round(ml.list_price_eur * 0.75 * 100) / 100,
    ) as { id: number };
  } else {
    db.prepare(`UPDATE listings SET status='sold', sold_at=datetime('now') WHERE id=?`).run(lst.id);
  }

  // 3. INSERT INTO sales
  const addr = order.shippingAddress;
  const addrJson = JSON.stringify({
    name: addr.fullName,
    line1: addr.line1,
    line2: addr.line2,
    city: addr.city,
    zip: addr.postalCode,
    country: addr.countryCode ?? 'DE',
  });

  const sale = db.prepare(`
    INSERT INTO sales (listing_id, buyer_name, buyer_address, buyer_country, marketplace, paid_at)
    VALUES (?, ?, ?, ?, 'ebay_de', datetime('now'))
    RETURNING id
  `).get(
    lst.id,
    addr.fullName ?? order.buyer.username ?? 'eBay-Käufer',
    addrJson,
    addr.countryCode ?? 'DE',
  ) as { id: number };

  // 4. Deactivate the marketplace_listing row (status → sold).
  // marketplace_listings has no sold_at column; we rely on updated_at.
  db.prepare(`UPDATE marketplace_listings SET status='sold', updated_at=datetime('now') WHERE id=?`).run(ml.id);

  log.info('eBay sale materialized', { order: order.orderId, item: item.title, folder: ml.folder_num, sale: sale.id });
  return sale.id;
}

export function startEbaySaleDetector(): void {
  if (timer) return;
  log.info('eBay sale-detector started', { intervalMs: INTERVAL_MS });
  setTimeout(() => void tick(), 30_000); // initial delay to let services boot
  timer = setInterval(() => void tick(), INTERVAL_MS);
}

export function stopEbaySaleDetector(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
    log.info('eBay sale-detector stopped');
  }
}
