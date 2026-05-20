#!/usr/bin/env node
// For each auto_listings row that has more than 1 color variant,
// clone the row into one row per color variant so each color becomes its
// own Vinted listing.
//
//   parent row: title "Kleider #1 — ..." → keeps first color, suffix "(cream)"
//   new rows:   title "Kleider #1 — ... (light blue)" etc.
//
// All clones share cj_product_id but get color in the title + color field.
// Existing photo_paths_json / color_variants_json on the parent are kept so
// the data is preserved if we want to re-explode later.

import fs from 'node:fs/promises';
import Database from 'better-sqlite3';

const DB_PATH = '/Users/home/Vinted/system/orchestrator/data/vinted-system.db';

function titleCase(s) {
  return s.replace(/\b\w/g, c => c.toUpperCase());
}

async function main() {
  const db = new Database(DB_PATH);

  // Pull every auto_listing with >1 variant
  const rows = db.prepare(`
    SELECT * FROM auto_listings
    WHERE json_array_length(color_variants_json) > 1
    ORDER BY id
  `).all();

  console.log(`Found ${rows.length} multi-color parents to explode.\n`);

  // Make sure we don't double-explode: check for existing child rows (parent_folder_num set)
  const existingChildren = db.prepare(`
    SELECT parent_folder_num FROM auto_listings WHERE parent_folder_num IS NOT NULL
  `).all().map(r => r.parent_folder_num);
  const childrenByParent = new Set(existingChildren);

  // Get all column names so the INSERT mirrors the parent row
  const cols = db.prepare(`PRAGMA table_info(auto_listings)`).all()
    .map(c => c.name)
    .filter(n => n !== 'id' && n !== 'created_at' && n !== 'updated_at');

  const placeholders = cols.map(() => '?').join(', ');
  const insertSql = `INSERT INTO auto_listings (${cols.join(', ')}) VALUES (${placeholders})`;
  const insertStmt = db.prepare(insertSql);

  const updateParentStmt = db.prepare(`
    UPDATE auto_listings
    SET title = ?, color = ?, photo_paths_json = ?, updated_at = datetime('now')
    WHERE id = ?
  `);

  let totalCreated = 0;

  for (const parent of rows) {
    const variants = JSON.parse(parent.color_variants_json);
    if (childrenByParent.has(parent.folder_num)) {
      console.log(`  ⏭  folder_num=${parent.folder_num} already exploded, skipping`);
      continue;
    }

    // Base title without [Import] prefix or color suffix, used for clean clones
    const baseTitle = parent.title;

    // First variant stays on the parent row
    const first = variants[0];
    const firstTitle = `${baseTitle} (${titleCase(first.color_name)})`;
    updateParentStmt.run(
      firstTitle,
      first.color_name,
      JSON.stringify(first.photo_paths),
      parent.id
    );
    console.log(`  ✓ parent updated: folder=${parent.folder_num}  "${firstTitle.slice(0, 60)}"`);

    // Clone remaining variants
    for (let i = 1; i < variants.length; i++) {
      const v = variants[i];
      const childTitle = `${baseTitle} (${titleCase(v.color_name)})`;
      const values = cols.map(c => {
        if (c === 'title') return childTitle;
        if (c === 'color') return v.color_name;
        if (c === 'photo_paths_json') return JSON.stringify(v.photo_paths);
        if (c === 'parent_folder_num') return parent.folder_num;
        if (c === 'status') return 'draft';
        if (c === 'vinted_url') return null;
        if (c === 'vinted_item_id') return null;
        if (c === 'sold_at') return null;
        if (c === 'last_sold_at') return null;
        if (c === 'relist_count') return 0;
        if (c === 'retry_count') return 0;
        if (c === 'last_retry_at') return null;
        return parent[c];
      });
      const res = insertStmt.run(...values);
      console.log(`    + clone id=${res.lastInsertRowid}  color=${v.color_name}`);
      totalCreated++;
    }
  }

  db.close();
  console.log(`\n=== DONE ===  ${totalCreated} new color-variant rows created`);
}

main().catch(err => { console.error('FATAL:', err.message); process.exit(1); });
