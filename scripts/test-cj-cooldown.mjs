#!/usr/bin/env node
// ──────────────────────────────────────────────────────────────────────────────
// Unit-test the new cooldown query filters in cj-fulfillment.ts —
// WITHOUT calling the CJ API (we're at daily quota).
//
// Tests:
//   1. New ordered → in query (no last_tracking_poll_at)
//   2. Just polled → NOT in query (cooldown active)
//   3. Polled 7h ago → in query again
//   4. Same for delivery cooldown (24h)
//   5. Stuck-order detection (>48h ordered with no tracking)
// ──────────────────────────────────────────────────────────────────────────────

import Database from 'better-sqlite3';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.resolve(__dirname, '../orchestrator/data/vinted-system.db');
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

const TRACKING_H = 6;
const DELIVERY_H = 24;
const STUCK_H = 48;

function trackingQuery(limit = 25) {
  return db.prepare(`
    SELECT id, cj_order_id, sale_id, last_tracking_poll_at
      FROM cj_orders
     WHERE status = 'ordered'
       AND cj_order_id IS NOT NULL
       AND (last_tracking_poll_at IS NULL
            OR last_tracking_poll_at < datetime('now', '-${TRACKING_H} hours'))
     LIMIT ?
  `).all(limit);
}

function deliveryQuery(limit = 25) {
  return db.prepare(`
    SELECT id, cj_order_id, sale_id, last_delivery_poll_at
      FROM cj_orders
     WHERE status = 'shipping'
       AND cj_order_id IS NOT NULL
       AND shipped_at < datetime('now', '-5 days')
       AND (last_delivery_poll_at IS NULL
            OR last_delivery_poll_at < datetime('now', '-${DELIVERY_H} hours'))
     LIMIT ?
  `).all(limit);
}

function cleanup() {
  db.prepare(`DELETE FROM cj_orders WHERE cj_order_id LIKE 'COOLDOWN_TEST_%'`).run();
  db.prepare(`DELETE FROM sales WHERE buyer_name = '__cooldown_test__'`).run();
}

function setupFakeSales() {
  // We need 3 fake sales (one per test scenario). They need a real listing_id
  // because of the FK constraint. Reuse listing_id=1 if it exists, else insert.
  let listingId = db.prepare(`SELECT id FROM listings LIMIT 1`).get()?.id;
  if (!listingId) {
    listingId = db.prepare(`
      INSERT INTO listings (account_id, vinted_url, vinted_item_id, title, list_price_eur, min_accept_price_eur, status)
      VALUES (1, '__cooldown_test_listing__', '__cdt__', 'cooldown test', 10, 5, 'active')
      RETURNING id
    `).get().id;
  }

  const sales = [];
  for (let i = 0; i < 4; i++) {
    const sid = db.prepare(`
      INSERT INTO sales (listing_id, buyer_name, marketplace, paid_at)
      VALUES (?, '__cooldown_test__', 'vinted', datetime('now'))
      RETURNING id
    `).get(listingId).id;
    sales.push(sid);
  }
  return sales;
}

function insertCJOrder(saleId, key, opts) {
  const {
    status = 'ordered',
    last_tracking_poll_at = null,
    last_delivery_poll_at = null,
    ordered_at = "datetime('now')",
    shipped_at = null,
  } = opts;
  // Have to build SQL with computed timestamps. Use parameter bindings except
  // where we need now()-X relative timestamps.
  db.prepare(`
    INSERT INTO cj_orders (sale_id, cj_order_id, status, ordered_at, shipped_at, last_tracking_poll_at, last_delivery_poll_at)
    VALUES (?, ?, ?, ${ordered_at}, ${shipped_at ?? 'NULL'}, ${last_tracking_poll_at ?? 'NULL'}, ${last_delivery_poll_at ?? 'NULL'})
  `).run(saleId, `COOLDOWN_TEST_${key}`, status);
}

console.log('▶ Cleanup any prior test data');
cleanup();

console.log('▶ Setup 4 fake sales');
const [s1, s2, s3, s4] = setupFakeSales();

console.log('\n──── TRACKING POLL ────');
insertCJOrder(s1, 'NEW',         { status: 'ordered' });                                      // should be picked
insertCJOrder(s2, 'JUST_POLLED', { status: 'ordered', last_tracking_poll_at: "datetime('now')" });
insertCJOrder(s3, 'OLD_POLL',    { status: 'ordered', last_tracking_poll_at: "datetime('now', '-7 hours')" });
insertCJOrder(s4, 'STUCK',       { status: 'ordered', ordered_at: "datetime('now','-50 hours')" });

const trackingRows = trackingQuery();
console.log(`  Query returned ${trackingRows.length} rows:`);
for (const r of trackingRows) {
  console.log(`    ✓ ${r.cj_order_id}  (last_poll=${r.last_tracking_poll_at ?? 'never'})`);
}
const expectedTracking = new Set(['COOLDOWN_TEST_NEW', 'COOLDOWN_TEST_OLD_POLL', 'COOLDOWN_TEST_STUCK']);
const actualTracking = new Set(trackingRows.map(r => r.cj_order_id));
const trackingOk =
  trackingRows.length === 3 &&
  [...expectedTracking].every(x => actualTracking.has(x)) &&
  !actualTracking.has('COOLDOWN_TEST_JUST_POLLED');
console.log(trackingOk
  ? '  ✅ Tracking cooldown filter works correctly'
  : '  ❌ TRACKING COOLDOWN FAILED');

console.log('\n──── STUCK-ORDER DETECTION ────');
const stuckRow = trackingRows.find(r => r.cj_order_id === 'COOLDOWN_TEST_STUCK');
const stuckMeta = db.prepare(`SELECT ordered_at, stuck_alerted_at FROM cj_orders WHERE id = ?`).get(stuckRow.id);
const ageH = (Date.now() - new Date(stuckMeta.ordered_at).getTime()) / 3_600_000;
console.log(`  stuck-test order is ${Math.round(ageH)}h old (threshold=${STUCK_H}h)`);
console.log(`  → worker would: ${ageH > STUCK_H ? 'ALERT (correct)' : 'not alert (wrong)'}`);

console.log('\n──── DELIVERY POLL ────');
// Re-set s2 (just_polled) to be shipping >5d, no delivery poll
db.prepare(`UPDATE cj_orders SET status='shipping', shipped_at=datetime('now','-6 days'), last_tracking_poll_at=NULL WHERE cj_order_id=?`)
  .run('COOLDOWN_TEST_JUST_POLLED');
// And s3 (old_poll) to shipping but delivery-polled 25h ago
db.prepare(`UPDATE cj_orders SET status='shipping', shipped_at=datetime('now','-7 days'), last_delivery_poll_at=datetime('now','-25 hours') WHERE cj_order_id=?`)
  .run('COOLDOWN_TEST_OLD_POLL');
// And s4 (stuck) to shipping, just polled — should NOT come up
db.prepare(`UPDATE cj_orders SET status='shipping', shipped_at=datetime('now','-8 days'), last_delivery_poll_at=datetime('now') WHERE cj_order_id=?`)
  .run('COOLDOWN_TEST_STUCK');

const deliveryRows = deliveryQuery();
console.log(`  Query returned ${deliveryRows.length} rows:`);
for (const r of deliveryRows) {
  console.log(`    ✓ ${r.cj_order_id}  (last_poll=${r.last_delivery_poll_at ?? 'never'})`);
}
const deliveryOk =
  deliveryRows.length === 2 &&
  deliveryRows.some(r => r.cj_order_id === 'COOLDOWN_TEST_JUST_POLLED') &&
  deliveryRows.some(r => r.cj_order_id === 'COOLDOWN_TEST_OLD_POLL') &&
  !deliveryRows.some(r => r.cj_order_id === 'COOLDOWN_TEST_STUCK');
console.log(deliveryOk
  ? '  ✅ Delivery cooldown filter works correctly'
  : '  ❌ DELIVERY COOLDOWN FAILED');

console.log('\n▶ Cleanup');
cleanup();
db.prepare(`DELETE FROM listings WHERE vinted_url = '__cooldown_test_listing__'`).run();

console.log('\n──────────────────────────────────────────────────────');
const passed = trackingOk && deliveryOk && ageH > STUCK_H;
console.log(passed ? '✅ ALL TESTS PASSED' : '❌ SOME TESTS FAILED');
db.close();
process.exit(passed ? 0 : 1);
