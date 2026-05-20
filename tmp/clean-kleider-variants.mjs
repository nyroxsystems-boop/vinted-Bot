#!/usr/bin/env node
// One-shot: clean Kleider variant titles + set brand=Kleid, condition=Sehr gut.
//   - strip all emojis / pictographs / dingbats
//   - remove pipes, asterisks, ampersands, multi-exclamations
//   - collapse whitespace, trim
//
// Usage: node tmp/clean-kleider-variants.mjs [--dry]
import Database from 'better-sqlite3';

const DRY = process.argv.includes('--dry');
const db = new Database('/Users/home/Vinted/system/orchestrator/data/vinted-system.db');
db.pragma('journal_mode = WAL');

// Unicode property regex: any emoji / extended pictograph
const EMOJI_RE = /\p{Extended_Pictographic}|️/gu;
const STRIP_CHARS_RE = /[|*&✨#@]/g;

function clean(title) {
  let t = title.replace(EMOJI_RE, '');           // drop emojis
  t = t.replace(STRIP_CHARS_RE, ' ');             // drop bad punctuation
  t = t.replace(/!{2,}/g, '!');                   // !!! → !
  t = t.replace(/\s+/g, ' ').trim();              // collapse whitespace
  t = t.replace(/\s+-\s+/g, ' - ');               // normalize " - "
  return t;
}

const rows = db.prepare(`
  SELECT alv.id, alv.auto_listing_id, alv.title, alv.brand, alv.condition
    FROM auto_listing_variants alv
    JOIN auto_listings al ON al.id = alv.auto_listing_id
   WHERE alv.marketplace = 'vinted'
     AND al.title LIKE '[Import] Kleider %'
`).all();

const upd = db.prepare(`
  UPDATE auto_listing_variants
     SET title = ?, brand = ?, condition = ?, material = NULL, updated_at = datetime('now')
   WHERE id = ?
`);

let changed = 0;
for (const r of rows) {
  const newTitle = clean(r.title);
  const newBrand = 'Keine Marke';
  const newCondition = 'Sehr gut';
  const titleChanged = newTitle !== r.title;
  const brandChanged = newBrand !== r.brand;
  const condChanged = newCondition !== r.condition;
  if (!titleChanged && !brandChanged && !condChanged) continue;
  console.log(`#${r.auto_listing_id}`);
  if (titleChanged)  console.log(`  T: ${r.title}\n  →  ${newTitle}`);
  if (brandChanged)  console.log(`  B: ${r.brand} → ${newBrand}`);
  if (condChanged)   console.log(`  C: ${r.condition} → ${newCondition}`);
  if (!DRY) upd.run(newTitle, newBrand, newCondition, r.id);
  changed++;
}
console.log(`\n${DRY ? '[dry]' : '[applied]'} ${changed}/${rows.length} variants updated`);
db.close();
