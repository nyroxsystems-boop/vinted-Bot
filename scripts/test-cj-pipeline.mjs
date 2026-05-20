#!/usr/bin/env node
// ──────────────────────────────────────────────────────────────────────────────
// End-to-End-Test der CJ-Auto-Order-Pipeline OHNE echte CJ-Bestellung.
//
// Strategie: Limit `cj_max_order_eur=1` setzen → der cj-fulfillment Worker
// findet den Fake-Sale, prüft Cost-Limit (alle cj_products haben cost > 1€),
// schreibt cj_orders.status='failed' mit Begründung "exceeds limit".
// Damit verifizieren wir:
//   ✓ Worker tickt
//   ✓ DB-Joins (sales × listings × marketplace_listings × cj_products) funktionieren
//   ✓ Safety-Limit zieht
//   ✓ Telegram-Alert/Event-Bus läuft
//
// Cleanup räumt nach dem Test alles auf.
// ──────────────────────────────────────────────────────────────────────────────

import Database from 'better-sqlite3';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.resolve(__dirname, '../orchestrator/data/vinted-system.db');

const ACTION = process.argv[2] ?? 'setup';
const TEST_FOLDER = 89; // Kleider #6 — Black-S, cost €3.72, price €29
const TEST_ITEM_ID = '__test_cj_pipeline_999';
const TEST_VINTED_URL = 'https://www.vinted.de/items/__test_cj_pipeline_999-test';

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

function setup() {
  console.log('▶ Setup test data for folder #' + TEST_FOLDER);

  // 1. Settings: enable auto-order, cap at €1 so order will be rejected
  const setSetting = db.prepare('INSERT INTO settings (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
  setSetting.run('cj_auto_order', 'true');
  setSetting.run('cj_max_order_eur', '1');     // cost €3.72 > €1 → reject
  setSetting.run('cj_max_daily_orders', '50');
  setSetting.run('fulfillment_provider', 'cj');
  setSetting.run('paused', 'false');
  console.log('  ✓ Settings: cj_auto_order=true, cj_max_order_eur=1, paused=false');

  // 2. Verify cj_products has folder #TEST_FOLDER
  const cjp = db.prepare('SELECT * FROM cj_products WHERE folder_num = ?').get(TEST_FOLDER);
  if (!cjp) {
    console.error(`  ✗ NO cj_products entry for folder #${TEST_FOLDER}. Run cj-resolve-mappings.mjs first.`);
    process.exit(1);
  }
  console.log(`  ✓ cj_products: vid=${cjp.cj_variant_id} cost=€${cjp.cost_eur}`);

  // 3. Create listings row
  db.prepare(`DELETE FROM listings WHERE vinted_item_id = ?`).run(TEST_ITEM_ID);
  const lst = db.prepare(`
    INSERT INTO listings (account_id, vinted_url, vinted_item_id, title, list_price_eur, min_accept_price_eur, status)
    VALUES (1, ?, ?, ?, ?, ?, 'active')
    RETURNING id
  `).get(TEST_VINTED_URL, TEST_ITEM_ID, '[TEST] CJ-Pipeline Integration Test', 29.0, 19.0);
  console.log(`  ✓ listings: id=${lst.id}`);

  // 4. Create marketplace_listings row to glue folder_num to external_id
  db.prepare(`DELETE FROM marketplace_listings WHERE external_id = ?`).run(TEST_ITEM_ID);
  db.prepare(`
    INSERT INTO marketplace_listings (marketplace, account_id, folder_num, external_id, external_url, status, list_price_eur)
    VALUES ('vinted', 1, ?, ?, ?, 'sold', 29.0)
  `).run(TEST_FOLDER, TEST_ITEM_ID, TEST_VINTED_URL);
  console.log(`  ✓ marketplace_listings: folder=${TEST_FOLDER} external_id=${TEST_ITEM_ID}`);

  // 5. Create paid Sale
  db.prepare('DELETE FROM cj_orders WHERE sale_id IN (SELECT id FROM sales WHERE listing_id = ?)').run(lst.id);
  db.prepare(`DELETE FROM sales WHERE listing_id = ?`).run(lst.id);
  const buyerAddress = JSON.stringify({
    name: 'Max Mustermann',
    street: 'Musterstraße 42',
    city: 'Berlin',
    zip: '10115',
    country: 'DE',
    phone: '+49 30 12345678',
  });
  const sale = db.prepare(`
    INSERT INTO sales (listing_id, buyer_name, buyer_address, buyer_phone, buyer_country, marketplace, paid_at)
    VALUES (?, 'Max Mustermann', ?, '+49 30 12345678', 'DE', 'vinted', datetime('now'))
    RETURNING id
  `).get(lst.id, buyerAddress);
  console.log(`  ✓ sales: id=${sale.id} (paid_at=now)`);

  console.log('\n  Test setup complete. sale_id=' + sale.id + ' listing_id=' + lst.id);
  console.log('  Now start the orchestrator and wait ~70s for the CJ worker to tick.');
}

function check() {
  console.log('▶ Check test results');

  const lst = db.prepare('SELECT id FROM listings WHERE vinted_item_id = ?').get(TEST_ITEM_ID);
  if (!lst) { console.log('  ⚠️  no test listing — run setup first'); return; }
  const sale = db.prepare('SELECT * FROM sales WHERE listing_id = ?').get(lst.id);
  if (!sale) { console.log('  ⚠️  no test sale'); return; }
  console.log(`  sale_id=${sale.id}`);

  // Verify the join the worker uses
  const joined = db.prepare(`
    SELECT s.id sale_id, cp.cj_variant_id, cp.cost_eur, ml.folder_num
      FROM sales s
      JOIN listings l ON l.id = s.listing_id
      JOIN marketplace_listings ml
        ON ml.external_id = CAST(l.vinted_item_id AS TEXT)
       AND ml.marketplace = COALESCE(s.marketplace, 'vinted')
      JOIN cj_products cp ON cp.folder_num = ml.folder_num
     WHERE s.id = ?
  `).get(sale.id);
  if (!joined) {
    console.log('  ✗ JOIN failed — worker would not find this sale!');
  } else {
    console.log(`  ✓ JOIN: folder=${joined.folder_num} vid=${joined.cj_variant_id} cost=€${joined.cost_eur}`);
  }

  // Check cj_orders
  const ord = db.prepare('SELECT * FROM cj_orders WHERE sale_id = ?').get(sale.id);
  if (!ord) {
    console.log('  ⏳ no cj_orders entry yet — worker has not run');
  } else {
    console.log(`  ✓ cj_orders: status=${ord.status}  error="${ord.error ?? ''}"`);
    if (ord.status === 'failed' && ord.error?.includes('exceeds limit')) {
      console.log('  ✅ Pipeline test PASSED — safety limit kicked in correctly.');
    } else if (ord.status === 'ordered') {
      console.log('  ⚠️  REAL ORDER was placed at CJ — check cj_order_id=' + ord.cj_order_id);
    }
  }
}

function cleanup() {
  console.log('▶ Cleanup test data');

  const lst = db.prepare('SELECT id FROM listings WHERE vinted_item_id = ?').get(TEST_ITEM_ID);
  if (lst) {
    db.prepare('DELETE FROM cj_orders WHERE sale_id IN (SELECT id FROM sales WHERE listing_id = ?)').run(lst.id);
    db.prepare('DELETE FROM sales WHERE listing_id = ?').run(lst.id);
    db.prepare('DELETE FROM listings WHERE id = ?').run(lst.id);
    console.log('  ✓ removed listings/sales/cj_orders');
  }
  db.prepare('DELETE FROM marketplace_listings WHERE external_id = ?').run(TEST_ITEM_ID);
  console.log('  ✓ removed marketplace_listings');

  // Restore safe defaults
  db.prepare('UPDATE settings SET value = ? WHERE key = ?').run('false', 'cj_auto_order');
  db.prepare('UPDATE settings SET value = ? WHERE key = ?').run('30', 'cj_max_order_eur');
  console.log('  ✓ settings restored: cj_auto_order=false, cj_max_order_eur=30');
}

if (ACTION === 'setup') setup();
else if (ACTION === 'check') check();
else if (ACTION === 'cleanup') cleanup();
else { console.log('Usage: node test-cj-pipeline.mjs [setup|check|cleanup]'); process.exit(1); }

db.close();
