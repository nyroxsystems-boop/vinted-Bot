#!/usr/bin/env node
import Database from 'better-sqlite3';

const db = new Database('/Users/home/Vinted/system/orchestrator/data/vinted-system.db');
const rows = db.prepare(`
  SELECT id, price_eur FROM auto_listings
   WHERE title LIKE '[Import] Kleider %'
     AND status NOT IN ('published','publishing')
`).all();

const upd = db.prepare(`UPDATE auto_listings SET price_eur=?, updated_at=datetime('now') WHERE id=?`);
const updVariant = db.prepare(`UPDATE auto_listing_variants SET price_eur=?, updated_at=datetime('now') WHERE auto_listing_id=? AND marketplace='vinted'`);

let changed = 0;
for (const r of rows) {
  // 30% chance to be in 20-28€ range, else 25-32€
  const inBudget = Math.random() < 0.3;
  const lo = inBudget ? 20 : 25;
  const hi = inBudget ? 28 : 32;
  // Half-Euro precision
  const p = Math.round((lo + Math.random() * (hi - lo)) * 2) / 2;
  if (Math.abs(p - r.price_eur) >= 0.5) {
    upd.run(p, r.id);
    updVariant.run(p, r.id);
    console.log(`  #${r.id}: ${r.price_eur.toFixed(2)} → ${p.toFixed(2)}${inBudget ? ' (budget)' : ''}`);
    changed++;
  }
}
console.log(`Changed: ${changed}/${rows.length}`);
db.close();
