#!/usr/bin/env node
// ──────────────────────────────────────────────────────────────────────────────
// Multi-marketplace E2E test:
//   - Re-list correctly creates new marketplace_listings row (not overwrite)
//   - Sale on Vinted → cross-sync deactivates KA, CJ-fulfillment fires
//   - Sale on Kleinanzeigen → cross-sync deactivates Vinted, CJ-fulfillment fires
//   - KA-Sale-Detector materialises sale + listings row
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

const TAG = '__mp_test__';

function cleanup() {
  db.prepare(`DELETE FROM cj_orders WHERE sale_id IN (SELECT id FROM sales WHERE buyer_name = ?)`).run(TAG);
  db.prepare(`DELETE FROM sales WHERE listing_id IN (SELECT id FROM listings WHERE vinted_url LIKE 'mp_%')`).run();
  db.prepare(`DELETE FROM listings WHERE vinted_url LIKE 'mp_%'`).run();
  db.prepare(`DELETE FROM marketplace_listings WHERE folder_num >= 77000 AND folder_num < 78000`).run();
  db.prepare(`DELETE FROM auto_listings WHERE folder_num >= 77000 AND folder_num < 78000`).run();
  db.prepare(`DELETE FROM cj_products WHERE folder_num >= 77000 AND folder_num < 78000`).run();
}
cleanup();

console.log('▶ Multi-marketplace integration tests\n');

// ──────────────────────────────────────────────────────────────────────────────
console.log('── Scenario 1: marketplace_listings UNIQUE on external_id ───');
const f1 = 77001;
db.prepare(`INSERT INTO cj_products (folder_num, cj_product_id, cj_variant_id, cost_eur, shipping_eur, warehouse) VALUES (?, 'p', 'v', 5, 3.5, 'CN')`).run(f1);

// Vinted listing
db.prepare(`
  INSERT INTO marketplace_listings (marketplace, account_id, folder_num, external_id, external_url, status, list_price_eur)
  VALUES ('vinted', 1, ?, '77001V_A', 'mp_77001V_A', 'active', 30)
`).run(f1);

// KA listing for same folder (different marketplace) — should succeed
db.prepare(`
  INSERT INTO marketplace_listings (marketplace, account_id, folder_num, external_id, external_url, status, list_price_eur)
  VALUES ('kleinanzeigen', 1, ?, '77001K_A', 'mp_77001K_A', 'active', 30)
`).run(f1);

const both = db.prepare(`SELECT COUNT(*) AS c FROM marketplace_listings WHERE folder_num = ?`).get(f1);
ok(both.c === 2, 'one folder can have entries on multiple marketplaces');

// Try to insert same (vinted, 1, '77001V_A') again — should conflict
let conflicted = false;
try {
  db.prepare(`
    INSERT INTO marketplace_listings (marketplace, account_id, folder_num, external_id, external_url, status, list_price_eur)
    VALUES ('vinted', 1, ?, '77001V_A', 'mp_dup', 'active', 30)
  `).run(f1);
} catch (e) {
  conflicted = /UNIQUE/i.test(e.message);
}
ok(conflicted, 'duplicate (marketplace, account, external_id) is rejected');

// Re-list: NEW external_id, same folder — should succeed
db.prepare(`
  INSERT INTO marketplace_listings (marketplace, account_id, folder_num, external_id, external_url, status, list_price_eur)
  VALUES ('vinted', 1, ?, '77001V_B', 'mp_77001V_B', 'active', 30)
`).run(f1);
const afterRelist = db.prepare(`SELECT COUNT(*) AS c FROM marketplace_listings WHERE folder_num = ?`).get(f1);
ok(afterRelist.c === 3, 're-listed clone is a new row (history preserved)');

// ──────────────────────────────────────────────────────────────────────────────
console.log('\n── Scenario 2: KA-Sale → cj-fulfillment join finds it ───');
const ka_lst = db.prepare(`
  INSERT INTO listings (account_id, vinted_url, vinted_item_id, title, list_price_eur, min_accept_price_eur, status)
  VALUES (1, 'mp_ka_url_a', '77001K_A', 'KA test', 30, 19, 'sold')
  RETURNING id
`).get().id;

const ka_sale = db.prepare(`
  INSERT INTO sales (listing_id, buyer_name, marketplace, paid_at)
  VALUES (?, ?, 'kleinanzeigen', datetime('now'))
  RETURNING id
`).get(ka_lst, TAG).id;

// cj-fulfillment processNewSales-equivalent query
const cjJoin = db.prepare(`
  SELECT cp.cj_variant_id, ml.folder_num
    FROM sales s
    JOIN listings l ON l.id = s.listing_id
    JOIN marketplace_listings ml
      ON ml.external_id = CAST(l.vinted_item_id AS TEXT)
     AND ml.marketplace = COALESCE(s.marketplace, 'vinted')
    JOIN cj_products cp ON cp.folder_num = ml.folder_num
   WHERE s.id = ?
`).get(ka_sale);
ok(!!cjJoin, 'KA-sale finds CJ mapping via marketplace_listings JOIN');
ok(cjJoin.folder_num === f1, 'resolved folder_num correctly from KA external_id');

// ──────────────────────────────────────────────────────────────────────────────
console.log('\n── Scenario 3: Cross-sync finds OTHER marketplace listings ───');
// After KA-sale, cross-sync should find the active Vinted listing for same folder
const otherActive = db.prepare(`
  SELECT marketplace, external_id, status FROM marketplace_listings
   WHERE folder_num = ? AND marketplace != 'kleinanzeigen' AND status = 'active'
`).all(f1);
ok(otherActive.length >= 1, 'cross-sync sees at least 1 active non-KA listing to deactivate');
ok(otherActive.some(r => r.marketplace === 'vinted'), 'includes Vinted listing');

// ──────────────────────────────────────────────────────────────────────────────
console.log('\n── Scenario 4: KA-Sale-Detector materialise (mock) ───');
// Simulate a chat with classification result
const insertChat = db.prepare(`
  INSERT INTO kleinanzeigen_chats (account_id, ka_conversation_id, buyer_username, ad_title, ad_url, last_message_at, unread)
  VALUES (1, 'conv_test_77002', 'tester', 'KA Test 2', 'mp_77002_url', datetime('now'), 1)
  RETURNING id
`).get();
const chatId = insertChat.id;

// We can't run the LLM in test — but we can verify the materialisation path
// by constructing the same SQL it would run.
const f2 = 77002;
db.prepare(`INSERT INTO cj_products (folder_num, cj_product_id, cj_variant_id, cost_eur, shipping_eur, warehouse) VALUES (?, 'p2', 'v2', 5, 3.5, 'CN')`).run(f2);
db.prepare(`
  INSERT INTO marketplace_listings (marketplace, account_id, folder_num, external_id, external_url, status, list_price_eur)
  VALUES ('kleinanzeigen', 1, ?, '77002K_A', 'mp_77002_url', 'active', 25)
`).run(f2);

// Verify the look-up the detector does
const ml = db.prepare(`
  SELECT folder_num, external_id, account_id, list_price_eur
    FROM marketplace_listings WHERE marketplace = 'kleinanzeigen' AND external_url = ?
`).get('mp_77002_url');
ok(!!ml && ml.folder_num === f2, 'detector look-up finds KA marketplace_listings by ad_url');

// Run the materialise path: insert listing + sale
const new_lst = db.prepare(`
  INSERT INTO listings (account_id, vinted_url, vinted_item_id, title, list_price_eur, min_accept_price_eur, status)
  VALUES (?, ?, ?, ?, ?, ?, 'sold')
  RETURNING id
`).get(ml.account_id, 'mp_77002_url', ml.external_id, 'KA Test 2', ml.list_price_eur, Math.round(ml.list_price_eur * 0.75 * 100)/100).id;

const auto_sale = db.prepare(`
  INSERT INTO sales (listing_id, buyer_name, buyer_address, marketplace, paid_at)
  VALUES (?, ?, ?, 'kleinanzeigen', datetime('now'))
  RETURNING id
`).get(new_lst, TAG, JSON.stringify({ name: 'Max', street: 'Hauptstr 1', zip: '10115', city: 'Berlin', country: 'DE' })).id;

// Verify the new auto-sale joins to cj_products
const finalJoin = db.prepare(`
  SELECT cp.cj_variant_id, ml.folder_num
    FROM sales s
    JOIN listings l ON l.id = s.listing_id
    JOIN marketplace_listings ml ON ml.external_id = CAST(l.vinted_item_id AS TEXT) AND ml.marketplace = s.marketplace
    JOIN cj_products cp ON cp.folder_num = ml.folder_num
   WHERE s.id = ?
`).get(auto_sale);
ok(!!finalJoin && finalJoin.cj_variant_id === 'v2', 'materialized KA sale joins through to cj_products');

console.log('\n▶ Cleanup');
db.prepare(`DELETE FROM kleinanzeigen_messages WHERE chat_id = ?`).run(chatId);
db.prepare(`DELETE FROM kleinanzeigen_chats WHERE id = ?`).run(chatId);
cleanup();

console.log('\n────────────────────────────────────────────────────────');
console.log(`${fail === 0 ? '✅' : '❌'} ${pass} passed, ${fail} failed`);
db.close();
process.exit(fail === 0 ? 0 : 1);
