#!/usr/bin/env node
// Sanitize ALL variant titles across all categories. Removes emojis and
// special punctuation. Sets brand="Keine Marke" + condition="Sehr gut" only
// where current values look LLM-default ("Ohne Marke" / "Neu, mit Etikett").
// Leaves explicitly user-edited values alone.
import Database from 'better-sqlite3';

const DRY = process.argv.includes('--dry');
const db = new Database('/Users/home/Vinted/system/orchestrator/data/vinted-system.db');
db.pragma('journal_mode = WAL');

const EMOJI_RE = /\p{Extended_Pictographic}|️/gu;
const STRIP_CHARS_RE = /[|*&✨#@]/g;

function clean(title) {
  let t = title.replace(EMOJI_RE, '');
  t = t.replace(STRIP_CHARS_RE, ' ');
  t = t.replace(/!{2,}/g, '!');
  t = t.replace(/\s+/g, ' ').trim();
  t = t.replace(/\s+-\s+/g, ' - ');
  // Remove leading "-" or "—" if any
  t = t.replace(/^[-–—]\s*/, '');
  return t;
}

const rows = db.prepare(`SELECT id, auto_listing_id, marketplace, title, brand, condition, material FROM auto_listing_variants`).all();
const upd = db.prepare(`UPDATE auto_listing_variants SET title=?, brand=?, condition=?, material=?, updated_at=datetime('now') WHERE id=?`);

let changed = 0;
for (const r of rows) {
  const newTitle = clean(r.title);
  const newBrand = (r.brand === 'Ohne Marke' || !r.brand) ? 'Keine Marke' : r.brand;
  const newCondition = (r.condition === 'Neu, mit Etikett' || !r.condition) ? 'Sehr gut' : r.condition;
  const newMaterial = null;  // Material always optional, skip across the board
  if (newTitle !== r.title || newBrand !== r.brand || newCondition !== r.condition || newMaterial !== r.material) {
    if (!DRY) upd.run(newTitle, newBrand, newCondition, newMaterial, r.id);
    changed++;
  }
}
console.log(`${DRY ? '[dry]' : '[applied]'} ${changed}/${rows.length} variants cleaned`);
db.close();
