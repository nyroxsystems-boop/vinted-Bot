#!/usr/bin/env node
// Test variant-generator pure logic (without LLM call) + start-batch + readVariant fallback.

import Database from 'better-sqlite3';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.resolve(__dirname, '../orchestrator/data/vinted-system.db');
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

let pass = 0, fail = 0;
const ok = (cond, label) => { (cond ? pass++ : fail++); console.log(`  ${cond ? '✓' : '✗'} ${label}`); };

function cleanup() {
  db.prepare(`DELETE FROM auto_listing_variants WHERE auto_listing_id IN (SELECT id FROM auto_listings WHERE folder_num >= 66000 AND folder_num < 67000)`).run();
  db.prepare(`DELETE FROM auto_listings WHERE folder_num >= 66000 AND folder_num < 67000`).run();
  db.prepare(`DELETE FROM cj_products WHERE folder_num >= 66000 AND folder_num < 67000`).run();
}
cleanup();

console.log('▶ Variant + Start-Batch tests\n');

// ──────────────────────────────────────────────────────────────────────────────
console.log('── Test 1: UNIQUE(auto_listing_id, marketplace) ──────────');
const al = db.prepare(`
  INSERT INTO auto_listings (account_id, folder_num, title, description, category, brand, size, condition, color, price_eur, temu_price_eur, profit_margin_eur, photo_paths_json, cj_product_id, cj_variant_id, status)
  VALUES (1, 66001, 'Test Dress', 'desc', 'Kleider', 'Ohne Marke', 'S', 'Neu', 'Black', 30, 5, 22, '["a","b","c"]', 'p', 'v', 'draft')
  RETURNING id
`).get().id;

db.prepare(`
  INSERT INTO auto_listing_variants (auto_listing_id, marketplace, title, description, generated_by)
  VALUES (?, 'vinted', 'Vinted Title', 'Vinted desc with #tags', 'llm')
`).run(al);

let conflict = false;
try {
  db.prepare(`
    INSERT INTO auto_listing_variants (auto_listing_id, marketplace, title, description, generated_by)
    VALUES (?, 'vinted', 'Dup', 'Dup', 'llm')
  `).run(al);
} catch (e) { conflict = /UNIQUE/i.test(e.message); }
ok(conflict, 'duplicate (listing, marketplace) is rejected');

// Different marketplace for same listing — OK
db.prepare(`
  INSERT INTO auto_listing_variants (auto_listing_id, marketplace, title, description, generated_by)
  VALUES (?, 'kleinanzeigen', 'KA Title', 'KA bullet desc', 'llm')
`).run(al);

const variants = db.prepare(`SELECT marketplace, title FROM auto_listing_variants WHERE auto_listing_id = ? ORDER BY marketplace`).all(al);
ok(variants.length === 2, 'two variants stored for same listing');
ok(variants[0].marketplace === 'kleinanzeigen' && variants[1].marketplace === 'vinted', 'both marketplaces present');

// ──────────────────────────────────────────────────────────────────────────────
console.log('\n── Test 2: readVariant logic (without LLM) ────────────');
// Simulate readVariant by mirroring its SQL:
const fetchVariant = (id, mp) => db.prepare(`
  SELECT title, description, category, brand, size, condition, color, material, tags_json
    FROM auto_listing_variants WHERE auto_listing_id = ? AND marketplace = ?
`).get(id, mp);
const vinted = fetchVariant(al, 'vinted');
ok(vinted?.title === 'Vinted Title', 'reads Vinted variant');
const ka = fetchVariant(al, 'kleinanzeigen');
ok(ka?.title === 'KA Title', 'reads KA variant');

// Fallback: no variant for ebay
const missing = fetchVariant(al, 'ebay_de');
ok(!missing, 'unknown marketplace returns nothing (fallback to master)');

// ──────────────────────────────────────────────────────────────────────────────
console.log('\n── Test 3: Start-Batch filter logic ────────────────────');
// Move al out of draft so it doesn't interfere with the filter test
db.prepare(`UPDATE auto_listings SET status = 'published' WHERE id = ?`).run(al);
// Insert 3 listings: 1 missing cj_variant_id, 1 fewer-than-3 photos, 1 OK
const a1 = db.prepare(`
  INSERT INTO auto_listings (account_id, folder_num, title, description, category, brand, size, condition, color, price_eur, temu_price_eur, profit_margin_eur, photo_paths_json, status)
  VALUES (1, 66002, 'Missing CJ', 'd', 'C', 'B', 'S', 'N', 'X', 30, 5, 22, '["a","b","c"]', 'draft')
  RETURNING id
`).get().id;

const a2 = db.prepare(`
  INSERT INTO auto_listings (account_id, folder_num, title, description, category, brand, size, condition, color, price_eur, temu_price_eur, profit_margin_eur, photo_paths_json, cj_variant_id, status)
  VALUES (1, 66003, 'Few Photos', 'd', 'C', 'B', 'S', 'N', 'X', 30, 5, 22, '["a","b"]', 'v', 'draft')
  RETURNING id
`).get().id;

const a3 = db.prepare(`
  INSERT INTO auto_listings (account_id, folder_num, title, description, category, brand, size, condition, color, price_eur, temu_price_eur, profit_margin_eur, photo_paths_json, cj_variant_id, status)
  VALUES (1, 66004, 'OK', 'd', 'C', 'B', 'S', 'N', 'X', 30, 5, 22, '["a","b","c","d"]', 'v', 'draft')
  RETURNING id
`).get().id;

// Start-batch query (mirrors routes/listings.ts)
const candidates = db.prepare(`
  SELECT id, folder_num, title FROM auto_listings
   WHERE status = 'draft'
     AND cj_variant_id IS NOT NULL
     AND profit_margin_eur >= 5
     AND json_array_length(COALESCE(photo_paths_json, '[]')) >= 3
     AND folder_num IN (66002, 66003, 66004)
`).all();
ok(candidates.length === 1, `only 1 of 3 listings eligible (got ${candidates.length})`);
ok(candidates[0].folder_num === 66004, 'eligible listing is the OK one (66004)');

cleanup();
console.log('\n────────────────────────────────────────────────────────');
console.log(`${fail === 0 ? '✅' : '❌'} ${pass} passed, ${fail} failed`);
db.close();
process.exit(fail === 0 ? 0 : 1);
