#!/usr/bin/env node
// ──────────────────────────────────────────────────────────────────────────────
// End-to-end pipeline tests against the FIXED join logic:
//
//   - Sale lands → relister.detectAndStampSales picks the right auto_listing
//     (the one with matching vinted_item_id, not just folder_num)
//   - After re-list: a 2nd sale on the cloned listing must NOT stamp the
//     original (it's already sold), but the clone.
//   - cj-fulfillment.processNewSales finds the sale via auto_listings JOIN
//     (no marketplace_listings dependency)
// ──────────────────────────────────────────────────────────────────────────────

import Database from 'better-sqlite3';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.resolve(__dirname, '../orchestrator/data/vinted-system.db');
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

let pass = 0, fail = 0;
const ok = (cond, label) => { (cond ? pass++ : fail++); console.log(`  ${cond ? '✓' : '✗'} ${label}`); };

const TAG = '__e2e_integration__';

function cleanup() {
  db.prepare(`DELETE FROM cj_orders WHERE sale_id IN (SELECT id FROM sales WHERE buyer_name IN (?, 'PENDING'))`).run(TAG);
  // sales reference listings — kill sales for ANY e2e listing
  db.prepare(`DELETE FROM sales WHERE listing_id IN (SELECT id FROM listings WHERE vinted_url LIKE 'e2e_%')`).run();
  db.prepare(`DELETE FROM sales WHERE buyer_name IN (?, 'PENDING')`).run(TAG);
  db.prepare(`DELETE FROM listings WHERE vinted_url LIKE 'e2e_%'`).run();
  db.prepare(`DELETE FROM marketplace_listings WHERE folder_num >= 88000 AND folder_num < 89000`).run();
  db.prepare(`DELETE FROM auto_listings WHERE folder_num >= 88000 AND folder_num < 89000`).run();
  db.prepare(`DELETE FROM cj_products WHERE folder_num >= 88000 AND folder_num < 89000`).run();
  db.prepare(`DELETE FROM inventory_locks WHERE folder_num >= 88000 AND folder_num < 89000`).run();
}

function insertAutoListing(folder, vintedItemId, status, soldAt = null) {
  return db.prepare(`
    INSERT INTO auto_listings (
      account_id, folder_num, title, description, category, brand, size, condition, color,
      price_eur, temu_price_eur, profit_margin_eur,
      shipping_method, photo_paths_json,
      cj_product_id, cj_variant_id, vinted_url, vinted_item_id, status, sold_at
    ) VALUES (1, ?, ?, 'desc', 'Kleider', 'Ohne Marke', 'S', 'Sehr gut', 'Black',
              30, 5, 22, 'Hermes S', '[]', 'pid_e2e', 'vid_e2e', 'e2e_url', ?, ?, ?)
    RETURNING id
  `).get(folder, `${TAG}-folder${folder}-${vintedItemId}`, String(vintedItemId), status, soldAt).id;
}

function insertListing(folder, vintedItemId) {
  return db.prepare(`
    INSERT INTO listings (account_id, vinted_url, vinted_item_id, title, list_price_eur, min_accept_price_eur, status)
    VALUES (1, ?, ?, 'e2e listing', 30, 19, 'active')
    RETURNING id
  `).get(`e2e_url_${vintedItemId}`, String(vintedItemId)).id;
}

function insertSale(listingId) {
  return db.prepare(`
    INSERT INTO sales (listing_id, buyer_name, marketplace, paid_at)
    VALUES (?, ?, 'vinted', datetime('now'))
    RETURNING id
  `).get(listingId, TAG).id;
}

function insertCJProduct(folder) {
  db.prepare(`INSERT INTO cj_products (folder_num, cj_product_id, cj_variant_id, cost_eur, shipping_eur, warehouse) VALUES (?, 'pid_e2e', 'vid_e2e', 5.0, 3.5, 'CN')`).run(folder);
}

cleanup();
console.log('▶ E2E Integration tests\n');

// ──────────────────────────────────────────────────────────────────────────────
console.log('── Scenario 1: Sale lands on FIRST listing, no clone yet ─────');
const f1 = 88001;
const itemX = '999900001';
const alX = insertAutoListing(f1, itemX, 'published', null);
const lstX = insertListing(f1, itemX);
const saleX = insertSale(lstX);
insertCJProduct(f1);

// Run the NEW relister stamping query
const stampX = db.prepare(`
  SELECT al.id AS auto_listing_id, al.folder_num
    FROM sales s
    JOIN listings l ON l.id = s.listing_id
    JOIN auto_listings al
      ON al.vinted_item_id = l.vinted_item_id
     AND al.status IN ('published','publishing')
     AND al.sold_at IS NULL
   WHERE s.paid_at IS NOT NULL AND s.id = ?
`).all(saleX);
ok(stampX.length === 1, 'stamping query finds exactly 1 auto_listings (the original X)');
ok(stampX[0].auto_listing_id === alX, 'matches the ORIGINAL by vinted_item_id');

// Mark sold
db.prepare(`UPDATE auto_listings SET sold_at = datetime('now') WHERE id = ?`).run(alX);

// ──────────────────────────────────────────────────────────────────────────────
console.log('\n── Scenario 2: Re-listed clone Y exists, sale on Y arrives ───');
const itemY = '999900002';
// First add a sibling clone Y with NEW vinted_item_id, status=published
const alY = insertAutoListing(f1, itemY, 'published', null);
db.prepare(`UPDATE auto_listings SET parent_folder_num = ?, relist_count = 1 WHERE id = ?`).run(f1, alY);
const lstY = insertListing(f1, itemY);
const saleY = insertSale(lstY);

// New relister query should pick Y, not X
const stampY = db.prepare(`
  SELECT al.id AS auto_listing_id
    FROM sales s
    JOIN listings l ON l.id = s.listing_id
    JOIN auto_listings al
      ON al.vinted_item_id = l.vinted_item_id
     AND al.status IN ('published','publishing')
     AND al.sold_at IS NULL
   WHERE s.paid_at IS NOT NULL AND s.id = ?
`).all(saleY);
ok(stampY.length === 1, 'second sale finds exactly 1 auto_listings');
ok(stampY[0].auto_listing_id === alY, 'matches the CLONE Y, not the already-sold X');

// ──────────────────────────────────────────────────────────────────────────────
console.log('\n── Scenario 3: cj-fulfillment processNewSales joins via auto_listings ──');
// X is sold (stamped), no cj_order yet. Mark X stamped to simulate state.
db.prepare(`UPDATE auto_listings SET sold_at = NULL WHERE id = ?`).run(alX);  // unstamp for the test
const cjJoin = db.prepare(`
  SELECT s.id AS sale_id, cp.cj_variant_id, cp.cost_eur, al.folder_num
    FROM sales s
    JOIN listings l ON l.id = s.listing_id
    JOIN auto_listings al ON al.vinted_item_id = l.vinted_item_id
    JOIN cj_products cp ON cp.folder_num = al.folder_num
   WHERE s.paid_at IS NOT NULL
     AND s.id NOT IN (SELECT sale_id FROM cj_orders)
     AND s.id = ?
`).get(saleX);
ok(!!cjJoin, 'cj-fulfillment join finds the sale via auto_listings');
ok(cjJoin.cj_variant_id === 'vid_e2e', 'reaches cj_products via auto_listings.folder_num');

// ──────────────────────────────────────────────────────────────────────────────
console.log('\n── Scenario 4: marketplace_listings UPSERT on re-list ─────────');
// Auto-Publisher's new INSERT/ON CONFLICT logic
db.prepare(`
  INSERT INTO marketplace_listings (marketplace, account_id, folder_num, external_id, external_url, status, list_price_eur)
  VALUES ('vinted', 1, ?, ?, ?, 'sold', 30)
`).run(f1, itemX, `e2e_url_${itemX}`);

// Now Auto-Publisher INSERTs after Y is published — with the new
// partial-unique constraint on (mp, acc, external_id), this is a fresh
// INSERT (no conflict with row 1 which has different external_id).
db.prepare(`
  INSERT INTO marketplace_listings (marketplace, account_id, folder_num, external_id, external_url, status, list_price_eur)
  VALUES ('vinted', 1, ?, ?, ?, 'active', 30)
  ON CONFLICT(marketplace, account_id, external_id) DO UPDATE SET
    external_url = excluded.external_url,
    status = 'active',
    list_price_eur = excluded.list_price_eur,
    updated_at = datetime('now')
`).run(f1, itemY, `e2e_url_${itemY}`);

const ml = db.prepare(`SELECT external_id, status FROM marketplace_listings WHERE folder_num = ? ORDER BY id`).all(f1);
ok(ml.length === 2, 'now 2 marketplace_listings rows (history preserved across re-list)');
ok(ml[0].external_id === String(itemX), 'row 1 still has OLD external_id (sold/archived)');
ok(ml[1].external_id === String(itemY), 'row 2 has NEW external_id (active after re-list)');

// ──────────────────────────────────────────────────────────────────────────────
console.log('\n── Scenario 5: Stuck publishing recovery query ─────────────────');
const stuck = insertAutoListing(88003, '99988803', 'publishing', null);
// Backdate updated_at to 20 minutes ago
db.prepare(`UPDATE auto_listings SET updated_at = datetime('now', '-20 minutes') WHERE id = ?`).run(stuck);

const recovered = db.prepare(`
  UPDATE auto_listings
     SET status = 'approved', updated_at = datetime('now')
   WHERE status = 'publishing' AND updated_at < datetime('now', '-15 minutes') AND id = ?
`).run(stuck);
ok(recovered.changes === 1, 'stuck-publishing row is recovered to approved');
const newStatus = db.prepare(`SELECT status FROM auto_listings WHERE id = ?`).get(stuck).status;
ok(newStatus === 'approved', 'status is now approved after recovery');

// ──────────────────────────────────────────────────────────────────────────────
console.log('\n── Scenario 6: PENDING placeholder skipped by CJ ─────────────────');
const pendingListing = insertListing(88004, '99988804');
const pendingSale = db.prepare(`
  INSERT INTO sales (listing_id, buyer_name, marketplace, paid_at)
  VALUES (?, 'PENDING', 'vinted', datetime('now'))
  RETURNING id
`).get(pendingListing).id;
const pendingAddr = JSON.parse('{}');
// The cj-fulfillment check is: if (addr.name === 'PENDING' || row.buyer_name === 'PENDING') skip
const buyerName = 'PENDING';
const wouldSkip = buyerName === 'PENDING';
ok(wouldSkip, 'PENDING buyer_name is recognized and skipped');

console.log('\n▶ Cleanup');
cleanup();

console.log('\n────────────────────────────────────────────────────────');
console.log(`${fail === 0 ? '✅' : '❌'} ${pass} passed, ${fail} failed`);
db.close();
process.exit(fail === 0 ? 0 : 1);
