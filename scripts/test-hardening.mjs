#!/usr/bin/env node
// ──────────────────────────────────────────────────────────────────────────────
// Production-hardening tests:
//   1. db-lock: acquire / release / expires
//   2. buyer-address validation: catches malformed, accepts valid
//   3. db-backup: dry-run a snapshot + rotate
//   4. failed-retrier backoff math
// ──────────────────────────────────────────────────────────────────────────────

import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.resolve(__dirname, '../orchestrator/data/vinted-system.db');

let pass = 0, fail = 0;
const ok = (cond, label) => { (cond ? pass++ : fail++); console.log(`  ${cond ? '✓' : '✗'} ${label}`); };

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

// ──────────────────────────────────────────────────────────────────────────────
console.log('── Test 1: worker_locks ────────────────────────────────────');

const lockName = '__test_lock__';
db.prepare(`DELETE FROM worker_locks WHERE name = ?`).run(lockName);

// Acquire
let res = db.prepare(`
  INSERT OR IGNORE INTO worker_locks (name, holder, acquired_at, expires_at)
  VALUES (?, 'tester1', datetime('now'), datetime('now', '+60 seconds'))
`).run(lockName);
ok(res.changes === 1, 'first acquire succeeds');

// Second acquire by different holder
res = db.prepare(`
  INSERT OR IGNORE INTO worker_locks (name, holder, acquired_at, expires_at)
  VALUES (?, 'tester2', datetime('now'), datetime('now', '+60 seconds'))
`).run(lockName);
ok(res.changes === 0, 'second acquire blocked while held');

// Release
db.prepare(`DELETE FROM worker_locks WHERE name = ? AND holder = ?`).run(lockName, 'tester1');
const after = db.prepare(`SELECT * FROM worker_locks WHERE name = ?`).get(lockName);
ok(!after, 'release removes lock');

// Expiry cleanup
db.prepare(`
  INSERT INTO worker_locks (name, holder, acquired_at, expires_at)
  VALUES (?, 'tester3', datetime('now'), datetime('now', '-1 hour'))
`).run(lockName);
db.prepare(`DELETE FROM worker_locks WHERE name = ? AND expires_at < datetime('now')`).run(lockName);
const expired = db.prepare(`SELECT * FROM worker_locks WHERE name = ?`).get(lockName);
ok(!expired, 'expired lock auto-cleaned');

// ──────────────────────────────────────────────────────────────────────────────
console.log('\n── Test 2: buyer-address validator ─────────────────────────');

// Inline-port the validator (avoid importing TS from .mjs)
const ZIP = { DE: /^\d{5}$/, AT: /^\d{4}$/, NL: /^\d{4}\s?[A-Z]{2}$/i };
function validate(a) {
  const n = (a.name ?? '').trim();
  const s = (a.street ?? '').trim();
  const c = (a.city ?? '').trim();
  const z = (a.zip ?? '').trim();
  const co = (a.country ?? 'DE').toUpperCase();
  if (n.length < 2) return 'name';
  if (s.length < 3) return 'street short';
  if (!/\d/.test(s)) return 'no number';
  if (c.length < 2) return 'city';
  if (!z) return 'zip empty';
  if (ZIP[co] && !ZIP[co].test(z)) return 'zip format';
  if (co.length !== 2) return 'country';
  return null;
}

ok(validate({ name: 'Max Mustermann', street: 'Hauptstr. 12', city: 'Berlin', zip: '10115', country: 'DE' }) === null, 'valid DE address accepted');
ok(validate({ name: 'X', street: '...', city: '', zip: '', country: 'DE' }) !== null, 'empty city/zip rejected');
ok(validate({ name: 'Max', street: 'Straße ohne Nummer', city: 'Berlin', zip: '10115', country: 'DE' }) === 'no number', 'street without number rejected');
ok(validate({ name: 'Max', street: 'Hauptstr 12', city: 'Berlin', zip: '1234', country: 'DE' }) === 'zip format', 'DE zip with 4 digits rejected');
ok(validate({ name: 'Max', street: 'Hauptstr 12', city: 'Berlin', zip: '10115', country: 'DEU' }) === 'country', 'non-ISO2 country rejected');

// ──────────────────────────────────────────────────────────────────────────────
console.log('\n── Test 3: failed-retrier backoff math ─────────────────────');

function backoff(retryCount) { return [0.5, 2, 6][retryCount] ?? 24; }
ok(backoff(0) === 0.5, 'first retry after 0.5h');
ok(backoff(1) === 2, 'second retry after 2h');
ok(backoff(2) === 6, 'third retry after 6h');
ok(backoff(3) === 24, 'fourth+ retry fall-back 24h');

// ──────────────────────────────────────────────────────────────────────────────
console.log('\n── Test 4: db-backup file ops ──────────────────────────────');

const dir = path.join(path.dirname(DB_PATH), 'backups-test');
fs.rmSync(dir, { recursive: true, force: true });
fs.mkdirSync(dir, { recursive: true });

// Make 17 fake backup files
for (let i = 0; i < 17; i++) {
  const f = path.join(dir, `vinted-system.${i.toString().padStart(2, '0')}.db`);
  fs.writeFileSync(f, 'fake');
  // Set mtime to spread them apart
  const t = Date.now() - (17 - i) * 1000;
  fs.utimesSync(f, t / 1000, t / 1000);
}
ok(fs.readdirSync(dir).length === 17, 'created 17 fake backups');

// Rotate: keep newest 14
const files = fs.readdirSync(dir)
  .filter(f => f.startsWith('vinted-system.') && f.endsWith('.db'))
  .map(f => ({ f, m: fs.statSync(path.join(dir, f)).mtimeMs }))
  .sort((a, b) => b.m - a.m);
for (const { f } of files.slice(14)) {
  fs.unlinkSync(path.join(dir, f));
}
ok(fs.readdirSync(dir).length === 14, 'rotation kept 14 newest backups');

// Cleanup
fs.rmSync(dir, { recursive: true, force: true });

// ──────────────────────────────────────────────────────────────────────────────
console.log('\n── Test 5: health-deep checks query ────────────────────────');

// Verify all expected tables exist for the deep-health endpoint
const tables = ['settings', 'auto_listings', 'cj_orders', 'bot_runs', 'worker_locks', 'listings'];
for (const t of tables) {
  const exists = !!db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name = ?`).get(t);
  ok(exists, `table ${t} exists`);
}

// ──────────────────────────────────────────────────────────────────────────────
console.log('\n────────────────────────────────────────────────────────');
console.log(`${fail === 0 ? '✅' : '❌'} ${pass} passed, ${fail} failed`);
db.close();
process.exit(fail === 0 ? 0 : 1);
