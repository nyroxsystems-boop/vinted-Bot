#!/usr/bin/env node
// Walks the Vinted/<Category>/<num>/CJ.../generated/ tree and updates the
// auto_listings DB rows with the actual generated photo paths.
//
// For single-color products → photo_paths_json = [1_front, 2_side, 3_zoom, 4_flatlay]
// For multi-color products → color_variants_json = [{color, paths:[...]}, ...]
//                              photo_paths_json = first variant's paths
//
// Matches auto_listings to filesystem by (category-slug, folder_num).

import fs from 'node:fs/promises';
import path from 'node:path';
import Database from 'better-sqlite3';

const VINTED_ROOT = '/Users/home/Vinted/Vinted';
const DB_PATH = '/Users/home/Vinted/system/orchestrator/data/vinted-system.db';

// Filesystem-category → DB-category mapping
const CAT_MAP = {
  'Kleider': 'Damen > Kleider > Sommerkleider',
  'Blazers': 'Damen > Jacken & Mäntel > Blazer',
  'Hotpants Shorts': 'Damen > Hosen & Leggings > Shorts',
  'Jackets': 'Damen > Jacken & Mäntel > Jacken',
  'Jeans': 'Damen > Hosen & Leggings > Jeans',
  'Jumpsuits': 'Damen > Jumpsuits',
  'Skirts': 'Damen > Röcke',
};
const SHOTS = ['1_front.jpg', '2_side.jpg', '3_zoom.jpg', '4_flatlay.jpg'];

async function listDoneVariants(productFolder) {
  // Returns [{color_slug, color_name, photo_paths: [...]}, ...]
  const cleanDir = path.join(productFolder, '_clean');
  const variantsFile = path.join(cleanDir, 'variants.json');
  let variantsMeta = [];
  try {
    variantsMeta = JSON.parse(await fs.readFile(variantsFile, 'utf8'));
  } catch { /* no variants.json */ }

  const slugToName = Object.fromEntries(variantsMeta.map(v => [v.color_slug, v.color_name]));
  const genDir = path.join(productFolder, 'generated');
  if (!await fs.stat(genDir).catch(() => null)) return [];

  const entries = await fs.readdir(genDir, { withFileTypes: true });
  const result = [];

  // Single-color: shots live directly in generated/
  if (entries.some(e => e.isFile() && e.name === '4_flatlay.jpg')) {
    const paths = SHOTS.map(s => path.join(genDir, s));
    const allExist = await Promise.all(paths.map(p => fs.stat(p).then(() => true).catch(() => false)));
    if (allExist.every(Boolean)) {
      result.push({ color_slug: 'default', color_name: 'default', photo_paths: paths });
    }
  }

  // Multi-color: shots live in generated/<color_slug>/
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const subDir = path.join(genDir, e.name);
    const paths = SHOTS.map(s => path.join(subDir, s));
    const allExist = await Promise.all(paths.map(p => fs.stat(p).then(() => true).catch(() => false)));
    if (allExist.every(Boolean)) {
      result.push({
        color_slug: e.name,
        color_name: slugToName[e.name] || e.name,
        photo_paths: paths,
      });
    }
  }
  return result;
}

async function main() {
  const db = new Database(DB_PATH);
  const updateStmt = db.prepare(`
    UPDATE auto_listings
    SET photo_paths_json = ?, color_variants_json = ?, updated_at = datetime('now')
    WHERE category = ? AND folder_num = ?
  `);

  let updated = 0, skipped = 0, notInDb = 0;

  for (const [fsCat, dbCat] of Object.entries(CAT_MAP)) {
    const catPath = path.join(VINTED_ROOT, fsCat);
    if (!await fs.stat(catPath).catch(() => null)) continue;

    const numDirs = (await fs.readdir(catPath))
      .filter(d => /^\d+$/.test(d))
      .sort((a, b) => parseInt(a, 10) - parseInt(b, 10));

    for (const num of numDirs) {
      const numPath = path.join(catPath, num);
      const subs = await fs.readdir(numPath, { withFileTypes: true });
      const cj = subs.find(s => s.isDirectory() && s.name.startsWith('CJ'));
      if (!cj) continue;

      const productFolder = path.join(numPath, cj.name);
      const variants = await listDoneVariants(productFolder);
      if (variants.length === 0) { skipped++; continue; }

      // photo_paths_json gets the first variant; color_variants_json holds all
      const photoPathsJson = JSON.stringify(variants[0].photo_paths);
      const colorVariantsJson = JSON.stringify(variants);

      const res = updateStmt.run(photoPathsJson, colorVariantsJson, dbCat, parseInt(num, 10));
      if (res.changes > 0) {
        console.log(`  ✓ ${fsCat}/${num} (${variants.length}v) → DB row updated`);
        updated++;
      } else {
        console.log(`  ⚠ ${fsCat}/${num} (${variants.length}v) → NO matching auto_listings row`);
        notInDb++;
      }
    }
  }

  db.close();
  console.log(`\n=== DONE ===  ${updated} updated, ${notInDb} not in DB, ${skipped} no photos`);
}

main().catch(err => { console.error('FATAL:', err.message); process.exit(1); });
