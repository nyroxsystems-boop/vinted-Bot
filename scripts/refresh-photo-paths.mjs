#!/usr/bin/env node
// Re-build auto_listings.photo_paths_json from the actual filesystem.
//   Priority 1: <folder>/<CJ-SKU>/generated/[1-5]_*.jpg  (5 lifestyle shots)
//   Priority 2: <folder>/<CJ-SKU>/[1-9]_*.jpg            (CJ originals)
// Vinted needs ≥3 photos, ≤20. We cap at 8.

import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.resolve(__dirname, '../orchestrator/data/vinted-system.db');
const VINTED_ROOT = '/Users/home/Vinted/Vinted';

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

const args = Object.fromEntries(process.argv.slice(2).map(a => {
  const [k, v] = a.replace(/^--/, '').split('=');
  return [k, v ?? true];
}));
const DRY = !!args.dry;
const MAX_PHOTOS = Number(args.max ?? 8);
const ONLY_CATEGORY = typeof args.category === 'string' ? args.category : null;

function extractCategory(title) {
  // "[Import] Blazers #1 — ..." → ["Blazers", 1]
  // "[Import] Hotpants Shorts #11 — ..." → ["Hotpants Shorts", 11]
  const m = title.match(/^\[Import\]\s+([^#]+)\s+#(\d+)/);
  if (!m) return null;
  return [m[1].trim(), Number(m[2])];
}

// Map folder-name substring → German variant color (for syncing variant.color
// when no matching folder existed). Order matters: more specific first.
const FOLDER_TO_GERMAN = [
  ['light_blue', 'Hellblau'],
  ['sky_blue', 'Hellblau'],
  ['dark_blue', 'Dunkelblau'],
  ['navy', 'Dunkelblau'],
  ['blue', 'Blau'],
  ['light_pink', 'Hellrosa'],
  ['pink', 'Rosa'],
  ['light_olive', 'Oliv'],
  ['olive', 'Oliv'],
  ['sage_green', 'Hellgrün'],
  ['dark_green', 'Dunkelgrün'],
  ['light_green', 'Hellgrün'],
  ['green', 'Grün'],
  ['black', 'Schwarz'],
  ['white', 'Weiß'],
  ['cream', 'Creme'],
  ['beige', 'Beige'],
  ['red', 'Rot'],
  ['yellow', 'Gelb'],
  ['brown', 'Braun'],
  ['grey', 'Grau'],
  ['gray', 'Grau'],
  ['purple', 'Lila'],
  ['lavender', 'Lila'],
  ['orange', 'Orange'],
  ['khaki', 'Khaki'],
];
function folderToGerman(folder) {
  const f = folder.toLowerCase();
  for (const [sub, ger] of FOLDER_TO_GERMAN) if (f.includes(sub)) return ger;
  return null;
}

// Map German variant color → English folder-name substring(s).
const COLOR_MAP = {
  'schwarz': ['black'],
  'weiß': ['white'],
  'weiss': ['white'],
  'creme': ['cream', 'beige'],
  'beige': ['beige', 'cream'],
  'hellblau': ['light_blue', 'sky_blue'],
  'dunkelblau': ['dark_blue', 'navy'],
  'blau': ['blue'],
  'rot': ['red'],
  'rosa': ['pink'],
  'pink': ['pink'],
  'hellrosa': ['light_pink', 'pink'],
  'grün': ['green'],
  'gruen': ['green'],
  'hellgrün': ['sage_green', 'light_green', 'green'],
  'dunkelgrün': ['dark_green', 'green'],
  'gelb': ['yellow'],
  'braun': ['brown'],
  'grau': ['grey', 'gray'],
  'lila': ['purple', 'lavender'],
  'orange': ['orange'],
  'oliv': ['olive'],
  'khaki': ['khaki'],
};

function pickColorFolder(colorDirs, variantColor) {
  if (!variantColor) return colorDirs[0];
  const key = variantColor.toLowerCase().trim();
  const targets = COLOR_MAP[key] ?? [key];
  for (const t of targets) {
    const match = colorDirs.find(d => d.toLowerCase().includes(t));
    if (match) return match;
  }
  return colorDirs[0]; // fallback
}

function findPhotos(category, internalNum, variantColor) {
  const base = path.join(VINTED_ROOT, category, String(internalNum));
  if (!fs.existsSync(base)) return { photos: [], chosenColor: null };

  // Each folder has exactly one CJ-SKU sub-dir like "CJLY1991974_1778078920873"
  const subDirs = fs.readdirSync(base, { withFileTypes: true })
    .filter(d => d.isDirectory() && d.name.startsWith('CJ'))
    .map(d => path.join(base, d.name));
  if (subDirs.length === 0) return { photos: [], chosenColor: null };

  const photos = [];
  let chosenColor = null;

  for (const cjDir of subDirs) {
    const genDir = path.join(cjDir, 'generated');

    // Priority 1 (NEW): generated/{color}/[1-4]_*.jpg — color-variant subfolders.
    // Pick the folder matching variantColor; else first sorted.
    if (fs.existsSync(genDir)) {
      const colorDirs = fs.readdirSync(genDir, { withFileTypes: true })
        .filter(d => d.isDirectory() && !d.name.startsWith('_'))
        .map(d => d.name)
        .sort();
      if (colorDirs.length > 0) {
        chosenColor = pickColorFolder(colorDirs, variantColor);
        const colorPath = path.join(genDir, chosenColor);
        const files = fs.readdirSync(colorPath)
          .filter(f => /^[1-9].*\.(jpg|jpeg|png)$/i.test(f))
          .sort()
          .map(f => path.join(colorPath, f))
          .filter(p => fs.statSync(p).size > 0);
        photos.push(...files);
      }
    }

    // Priority 2 (LEGACY): generated/[1-9]_*.jpg directly — old structure
    if (photos.length === 0 && fs.existsSync(genDir)) {
      const files = fs.readdirSync(genDir)
        .filter(f => /^[1-9].*\.(jpg|jpeg|png)$/i.test(f))
        .filter(f => fs.statSync(path.join(genDir, f)).isFile())
        .sort()
        .map(f => path.join(genDir, f))
        .filter(p => fs.statSync(p).size > 0);
      photos.push(...files);
    }

    // Priority 3: CJ originals at the top of the CJ-SKU dir (last resort)
    if (photos.length < 3) {
      const originals = fs.readdirSync(cjDir)
        .filter(f => /^[0-9].*\.(jpg|jpeg|png)$/i.test(f))
        .filter(f => fs.statSync(path.join(cjDir, f)).isFile())
        .filter(f => fs.statSync(path.join(cjDir, f)).size > 0)
        .sort((a, b) => parseInt(a) - parseInt(b))
        .map(f => path.join(cjDir, f));
      for (const o of originals) {
        if (photos.length >= MAX_PHOTOS) break;
        if (!photos.includes(o)) photos.push(o);
      }
    }
  }

  return { photos: photos.slice(0, MAX_PHOTOS), chosenColor };
}

console.log(`▶ Refresh photo_paths_json (dry=${DRY}, max=${MAX_PHOTOS})\n`);

const rows = db.prepare(`
  SELECT al.id, al.folder_num, al.title, al.photo_paths_json,
         (SELECT color FROM auto_listing_variants v WHERE v.auto_listing_id=al.id AND v.marketplace='vinted') AS variant_color
    FROM auto_listings al
   WHERE al.status IN ('draft', 'approved', 'published', 'failed')
`).all();

let updated = 0;
let unchanged = 0;
let failed = 0;
const stats = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0, 8: 0 };

const upd = db.prepare(`UPDATE auto_listings SET photo_paths_json = ?, updated_at = datetime('now') WHERE id = ?`);
const updVariantColor = db.prepare(`UPDATE auto_listing_variants SET color = ?, updated_at = datetime('now') WHERE auto_listing_id = ? AND marketplace = 'vinted'`);

for (const r of rows) {
  const cat = extractCategory(r.title);
  if (!cat) {
    console.log(`  ⚠️  Folder ${r.folder_num}: title pattern not recognized → "${r.title.slice(0, 50)}"`);
    failed++;
    continue;
  }
  if (ONLY_CATEGORY && cat[0] !== ONLY_CATEGORY) {
    continue;
  }
  const [category, internalNum] = cat;
  const result = findPhotos(category, internalNum, r.variant_color);
  const photos = result.photos;
  const chosenColor = result.chosenColor;
  stats[Math.min(photos.length, 8)] = (stats[Math.min(photos.length, 8)] ?? 0) + 1;

  const oldCount = JSON.parse(r.photo_paths_json || '[]').length;
  const oldJson = r.photo_paths_json || '[]';
  if (photos.length === 0) {
    // Clear stale paths from DB so UI doesn't try to load missing files.
    if (oldJson !== '[]') {
      if (!DRY) upd.run('[]', r.id);
      console.log(`  ⚠️  Folder ${r.folder_num} (${category}/${internalNum}): cleared stale paths (no valid photos on disk)`);
    } else {
      console.log(`  ❌ Folder ${r.folder_num} (${category}/${internalNum}): no photos found`);
    }
    failed++;
    continue;
  }
  const newJson = JSON.stringify(photos);
  const photosChanged = newJson !== oldJson;

  // Sync variant.color to match the chosen folder if they don't match
  let colorSyncNote = '';
  let colorChanged = false;
  if (chosenColor) {
    const germanFromFolder = folderToGerman(chosenColor);
    if (germanFromFolder && germanFromFolder !== r.variant_color) {
      if (!DRY) updVariantColor.run(germanFromFolder, r.id);
      colorSyncNote = ` color=${r.variant_color ?? '?'}→${germanFromFolder}`;
      colorChanged = true;
    }
  }

  if (!photosChanged && !colorChanged) {
    unchanged++;
    continue;
  }
  if (photosChanged && !DRY) upd.run(newJson, r.id);
  const colorTag = chosenColor ? ` [${chosenColor}|variant=${r.variant_color ?? '?'}]` : '';
  const photoNote = photosChanged ? `${oldCount} → ${photos.length} photos` : `${photos.length} photos (unchanged)`;
  console.log(`  ✅ Folder ${r.folder_num} (${category}/${internalNum})${colorTag}: ${photoNote}${colorSyncNote}`);
  updated++;
}

console.log('\n────────────────────────────────────────');
console.log(`SUMMARY: updated=${updated} unchanged=${unchanged} failed=${failed}`);
console.log('Photo count distribution:');
for (const k of Object.keys(stats).sort()) {
  if (stats[k] > 0) console.log(`  ${k} photos: ${stats[k]} listings`);
}
if (DRY) console.log('\n(DRY RUN — no DB writes)');
db.close();
