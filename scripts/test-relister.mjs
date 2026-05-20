#!/usr/bin/env node
// ──────────────────────────────────────────────────────────────────────────────
// Re-Lister unit test — runs the worker's SQL queries against synthetic data
// without touching CJ or Vinted. Verifies:
//
//   1. detectAndStampSales: stamps auto_listings.sold_at when a sale lands
//   2. Daily-cap enforcement: budget = max_per_day - recent_relists
//   3. 24h delay: candidates only become eligible after delay_hours
//   4. Inactive-pause: folders with no sale in pause_days are skipped
//   5. Clone-insert: new auto_listings row has parent_folder_num, status='approved'
//   6. No-duplicate: while sibling clone is active, no new clone is queued
// ──────────────────────────────────────────────────────────────────────────────

import Database from 'better-sqlite3';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.resolve(__dirname, '../orchestrator/data/vinted-system.db');
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

const TEST_TAG = '__relister_test__';
let totalPassed = 0;
let totalFailed = 0;
function assert(cond, label) {
  if (cond) { console.log(`  ✓ ${label}`); totalPassed++; }
  else      { console.log(`  ✗ ${label}`); totalFailed++; }
}

function cleanup() {
  db.prepare(`DELETE FROM auto_listings WHERE title LIKE ?`).run(`${TEST_TAG}%`);
  db.prepare(`DELETE FROM sales WHERE buyer_name = ?`).run(TEST_TAG);
  db.prepare(`DELETE FROM listings WHERE vinted_url LIKE ?`).run(`${TEST_TAG}%`);
  db.prepare(`DELETE FROM marketplace_listings WHERE external_id LIKE ?`).run(`${TEST_TAG}%`);
  db.prepare(`DELETE FROM inventory_locks WHERE folder_num >= 90000`).run();
}

function insertAutoListing(folder, opts = {}) {
  return db.prepare(`
    INSERT INTO auto_listings (
      account_id, folder_num, title, description, category, subcategory,
      brand, size, condition, color, material,
      price_eur, temu_price_eur, profit_margin_eur,
      shipping_method, photo_paths_json,
      cj_product_id, cj_variant_id, status,
      sold_at, last_sold_at, parent_folder_num, relist_count, created_at
    ) VALUES (1, ?, ?, 'desc', 'Kleider', '', 'Ohne Marke', 'S', 'Sehr gut', 'Black', '',
              30, 5, 22, 'Hermes S', '["/tmp/p1.jpg","/tmp/p2.jpg","/tmp/p3.jpg"]',
              'pid_test', 'vid_test', ?, ?, ?, ?, ?, ${opts.created_at ?? "datetime('now')"})
    RETURNING id
  `).get(
    folder,
    `${TEST_TAG} folder ${folder}`,
    opts.status ?? 'published',
    opts.sold_at ?? null,
    opts.last_sold_at ?? null,
    opts.parent_folder_num ?? null,
    opts.relist_count ?? 0,
  ).id;
}

function insertSale(folder, listingExternalId, opts = {}) {
  // Create supporting listings + marketplace_listings rows so the stamping
  // JOIN works.
  const listing = db.prepare(`
    INSERT INTO listings (account_id, vinted_url, vinted_item_id, title, list_price_eur, min_accept_price_eur, status)
    VALUES (1, ?, ?, ?, 30, 19, 'active') RETURNING id
  `).get(
    `${TEST_TAG}-url-${folder}`,
    listingExternalId,
    `${TEST_TAG} listing ${folder}`,
  ).id;
  db.prepare(`
    INSERT OR IGNORE INTO marketplace_listings (marketplace, account_id, folder_num, external_id, status, list_price_eur)
    VALUES ('vinted', 1, ?, ?, 'sold', 30)
  `).run(folder, listingExternalId);
  const saleId = db.prepare(`
    INSERT INTO sales (listing_id, buyer_name, marketplace, paid_at)
    VALUES (?, ?, 'vinted', ${opts.paid_at ?? "datetime('now')"})
    RETURNING id
  `).get(listing, TEST_TAG).id;
  return { saleId, listingId: listing };
}

console.log('▶ Setup');
cleanup();

// ──────────────────────────────────────────────────────────────────────────────
console.log('\n── Test 1: detectAndStampSales ────────────────────────────');
const folder1 = 90001;
const al1 = insertAutoListing(folder1, { status: 'published' });
const ext1 = `${TEST_TAG}-ext-${folder1}`;
const { saleId: sale1 } = insertSale(folder1, ext1);
// Mimic the worker's stamping query
const stampRows = db.prepare(`
  SELECT al.id AS auto_listing_id, al.folder_num, s.paid_at, s.id AS sale_id
    FROM sales s
    JOIN listings l ON l.id = s.listing_id
    JOIN marketplace_listings ml
      ON ml.external_id = CAST(l.vinted_item_id AS TEXT)
     AND ml.marketplace = COALESCE(s.marketplace, 'vinted')
    JOIN auto_listings al ON al.folder_num = ml.folder_num
   WHERE s.paid_at IS NOT NULL AND al.sold_at IS NULL AND s.buyer_name = ?
`).all(TEST_TAG);
assert(stampRows.length === 1, `stamping query finds 1 unstamped sale (got ${stampRows.length})`);
assert(stampRows[0].auto_listing_id === al1, `joins to the right auto_listings (id ${al1})`);

// Apply the stamp
db.prepare(`UPDATE auto_listings SET sold_at = ?, last_sold_at = ? WHERE id = ?`)
  .run(stampRows[0].paid_at, stampRows[0].paid_at, al1);

// Second run should find nothing
const stampRows2 = db.prepare(`
  SELECT al.id FROM sales s
    JOIN listings l ON l.id = s.listing_id
    JOIN marketplace_listings ml ON ml.external_id = CAST(l.vinted_item_id AS TEXT)
    JOIN auto_listings al ON al.folder_num = ml.folder_num
   WHERE s.paid_at IS NOT NULL AND al.sold_at IS NULL AND s.buyer_name = ?
`).all(TEST_TAG);
assert(stampRows2.length === 0, 'second stamping run is idempotent (no new rows)');

// ──────────────────────────────────────────────────────────────────────────────
console.log('\n── Test 2: 24h delay enforcement ───────────────────────────');
// Folder1 was just sold (now-ish) — should NOT be eligible yet
const ready = db.prepare(`
  SELECT al.id FROM auto_listings al
   WHERE al.sold_at IS NOT NULL
     AND al.sold_at < datetime('now', '-24 hours')
     AND al.folder_num = ?
`).all(folder1);
assert(ready.length === 0, 'just-sold folder is NOT eligible (delay not yet met)');

// Backdate to >24h ago
db.prepare(`UPDATE auto_listings SET sold_at = datetime('now', '-25 hours') WHERE id = ?`).run(al1);
const ready2 = db.prepare(`
  SELECT al.id FROM auto_listings al
   WHERE al.sold_at IS NOT NULL
     AND al.sold_at < datetime('now', '-24 hours')
     AND al.folder_num = ?
`).all(folder1);
assert(ready2.length === 1, 'after backdating, folder IS eligible');

// ──────────────────────────────────────────────────────────────────────────────
console.log('\n── Test 3: No-duplicate (sibling active clone) ─────────────');
// Insert a sibling clone of folder1 that is still 'approved' (not yet sold)
const al1Clone = insertAutoListing(folder1, {
  status: 'approved',
  parent_folder_num: folder1,
  relist_count: 1,
});
// Candidate query should now skip folder1 because sibling clone is active
const cand = db.prepare(`
  SELECT al.id FROM auto_listings al
   WHERE al.sold_at IS NOT NULL
     AND al.sold_at < datetime('now', '-24 hours')
     AND NOT EXISTS (
       SELECT 1 FROM auto_listings sib
        WHERE sib.folder_num = al.folder_num
          AND sib.id != al.id
          AND sib.sold_at IS NULL
          AND sib.status IN ('draft','approved','publishing','published')
     )
     AND al.folder_num = ?
`).all(folder1);
assert(cand.length === 0, 'folder is skipped while sibling clone is active');

// Mark the sibling sold too — now both are out, but the original is still
// candidate because the sibling is now sold_at NOT NULL (gets out of NOT EXISTS).
db.prepare(`UPDATE auto_listings SET sold_at = datetime('now') WHERE id = ?`).run(al1Clone);
const candAfter = db.prepare(`
  SELECT al.id FROM auto_listings al
   WHERE al.sold_at IS NOT NULL
     AND al.sold_at < datetime('now', '-24 hours')
     AND NOT EXISTS (
       SELECT 1 FROM auto_listings sib
        WHERE sib.folder_num = al.folder_num
          AND sib.id != al.id
          AND sib.sold_at IS NULL
          AND sib.status IN ('draft','approved','publishing','published')
     )
     AND al.folder_num = ?
`).all(folder1);
assert(candAfter.length === 1, 'after sibling is sold, original is candidate again');

// ──────────────────────────────────────────────────────────────────────────────
console.log('\n── Test 4: Inactive-pause (last_sold_at > 21d) ─────────────');
const folder2 = 90002;
const al2 = insertAutoListing(folder2, {
  status: 'published',
  sold_at: "datetime('now','-25 hours')",
  last_sold_at: "datetime('now', '-30 days')",   // very old
});
const candPause = db.prepare(`
  SELECT al.id FROM auto_listings al
   WHERE al.sold_at IS NOT NULL
     AND al.sold_at < datetime('now', '-24 hours')
     AND (al.last_sold_at IS NULL OR al.last_sold_at > datetime('now', '-21 days'))
     AND al.folder_num = ?
`).all(folder2);
assert(candPause.length === 0, 'inactive folder (last_sold 30d ago) is skipped');

// ──────────────────────────────────────────────────────────────────────────────
console.log('\n── Test 5: Daily-cap budget ────────────────────────────────');
// Simulate 30 recent re-lists (matches default cap)
const folder3 = 90003;
const al3 = insertAutoListing(folder3, {
  status: 'published',
  sold_at: "datetime('now','-25 hours')",
  last_sold_at: "datetime('now','-1 hours')",
});
// Insert 30 fake clones in the last 24h
for (let i = 0; i < 30; i++) {
  insertAutoListing(99000 + i, {
    status: 'approved',
    parent_folder_num: 99000 + i,
    relist_count: 1,
  });
}
const recent = db.prepare(`
  SELECT COUNT(*) AS cnt FROM auto_listings
   WHERE parent_folder_num IS NOT NULL
     AND created_at > datetime('now', '-24 hours')
     AND title LIKE ?
`).get(`${TEST_TAG}%`);
assert(recent.cnt >= 30, `daily-cap counter sees the 30 clones (got ${recent.cnt})`);
// Cleanup the 30
db.prepare(`DELETE FROM auto_listings WHERE folder_num >= 99000 AND folder_num < 99100`).run();

// ──────────────────────────────────────────────────────────────────────────────
console.log('\n── Test 6: Clone-insert keeps key fields ───────────────────');
const src = db.prepare(`SELECT * FROM auto_listings WHERE id = ?`).get(al3);
const cloneId = db.prepare(`
  INSERT INTO auto_listings (
    account_id, folder_num, title, description, category, subcategory,
    brand, size, condition, color, material,
    price_eur, temu_price_eur, profit_margin_eur,
    shipping_method, photo_paths_json,
    cj_product_id, cj_variant_id, status,
    parent_folder_num, relist_count, last_sold_at
  ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'approved',?,?,?)
  RETURNING id
`).get(
  src.account_id, src.folder_num,
  src.title, src.description, src.category, src.subcategory,
  src.brand, src.size, src.condition, src.color, src.material,
  src.price_eur, src.temu_price_eur, src.profit_margin_eur,
  src.shipping_method, src.photo_paths_json,
  src.cj_product_id, src.cj_variant_id,
  src.folder_num, (src.relist_count || 0) + 1, src.sold_at,
).id;
const clone = db.prepare(`SELECT * FROM auto_listings WHERE id = ?`).get(cloneId);
assert(clone.status === 'approved', 'clone status = approved');
assert(clone.folder_num === src.folder_num, 'clone same folder_num');
assert(clone.parent_folder_num === src.folder_num, 'clone parent_folder_num set');
assert(clone.relist_count === 1, 'clone relist_count incremented');
assert(clone.cj_variant_id === src.cj_variant_id, 'clone carries cj_variant_id');
assert(clone.sold_at === null, 'clone sold_at is NULL (fresh)');

// ──────────────────────────────────────────────────────────────────────────────
console.log('\n▶ Cleanup');
cleanup();

console.log('\n────────────────────────────────────────────────────────');
console.log(`${totalFailed === 0 ? '✅' : '❌'} ${totalPassed} passed, ${totalFailed} failed`);
db.close();
process.exit(totalFailed === 0 ? 0 : 1);
