// ──────────────────────────────────────────────────────────────────────────────
// DB-Backup Worker
//
// SQLite file is the single source of truth. Loses sales, listings, CJ-orders,
// session metadata, telegram-config — everything. We copy it every 6 hours
// to data/backups/, gzip the snapshot, and keep the last 8 (= 2 days history).
//
// Uses SQLite's online backup API (better-sqlite3 .backup()) so we don't
// race with WAL writes.
// ──────────────────────────────────────────────────────────────────────────────

import { createLogger, getDb, getSetting, withLock } from '@vinted-system/shared';
import { eventBus } from './events.js';
import fs from 'node:fs';
import path from 'node:path';
import { createGzip } from 'node:zlib';
import { pipeline } from 'node:stream/promises';

const log = createLogger('db-backup');

let timer: ReturnType<typeof setInterval> | null = null;
const INTERVAL_MS = 6 * 60 * 60 * 1000;  // 6h
// Retention: 8 snapshots × 6h = 2 days of history. Backups are gzip-compressed
// (typically 70–85 % smaller than the raw .db), so disk overhead is small.
const KEEP_N = 8;

function backupDir(): string {
  // Use the same DB-path resolution as shared/src/db.ts so backups always
  // land next to the real DB file, regardless of which cwd the orchestrator
  // was started from.
  let dbFile = process.env.DB_PATH ?? '';
  if (!dbFile || !fs.existsSync(dbFile)) {
    // Find the open DB by walking the file system from this file up to repo root
    const here = path.dirname(new URL(import.meta.url).pathname);
    const candidates = [
      path.resolve(here, '..', '..', 'orchestrator', 'data', 'vinted-system.db'),  // from orchestrator/src/
      path.resolve(here, '..', 'orchestrator', 'data', 'vinted-system.db'),         // edge case
    ];
    dbFile = candidates.find(p => fs.existsSync(p)) ?? candidates[0]!;
  }
  return path.join(path.dirname(dbFile), 'backups');
}

async function runBackup(): Promise<{ path: string; sizeKb: number } | null> {
  if (getSetting('db_backup_enabled') === 'false') return null;
  const dir = backupDir();
  fs.mkdirSync(dir, { recursive: true });

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dest = path.join(dir, `vinted-system.${stamp}.db`);

  const db = getDb();
  // better-sqlite3 supports .backup() — copies under shared lock, WAL-safe.
  try {
    await db.backup(dest);
  } catch (err) {
    // Fallback: simple file copy. Not ideal under heavy write load, but works.
    const src = (process.env.DB_PATH ?? '').toString();
    if (src && fs.existsSync(src)) fs.copyFileSync(src, dest);
    else throw err;
  }

  // Gzip-compress the snapshot (typically 5–10 % of the raw size for SQLite).
  // We keep the original only if compression fails so we never silently lose a
  // backup window.
  const gzPath = dest + '.gz';
  try {
    await pipeline(
      fs.createReadStream(dest),
      createGzip({ level: 6 }),
      fs.createWriteStream(gzPath),
    );
    fs.unlinkSync(dest);
    const stat = fs.statSync(gzPath);
    return { path: gzPath, sizeKb: Math.round(stat.size / 1024) };
  } catch (gzErr) {
    log.warn('Gzip compression failed, keeping raw .db', { error: gzErr instanceof Error ? gzErr.message : String(gzErr) });
    try { if (fs.existsSync(gzPath)) fs.unlinkSync(gzPath); } catch { /* ignore */ }
    const stat = fs.statSync(dest);
    return { path: dest, sizeKb: Math.round(stat.size / 1024) };
  }
}

function rotate(): { removed: number; kept: number } {
  const dir = backupDir();
  if (!fs.existsSync(dir)) return { removed: 0, kept: 0 };
  // Pick up both compressed (.db.gz, current format) and uncompressed (.db,
  // fallback from a failed gzip step) snapshots so retention is enforced
  // across both shapes.
  const files = fs.readdirSync(dir)
    .filter(f => f.startsWith('vinted-system.') && (f.endsWith('.db.gz') || f.endsWith('.db')))
    .map(f => ({ f, m: fs.statSync(path.join(dir, f)).mtimeMs }))
    .sort((a, b) => b.m - a.m);
  const toRemove = files.slice(KEEP_N);
  for (const { f } of toRemove) {
    try { fs.unlinkSync(path.join(dir, f)); } catch { /* ignore */ }
  }
  return { removed: toRemove.length, kept: Math.min(KEEP_N, files.length) };
}

async function tick(): Promise<void> {
  await withLock('db-backup', 600, async () => {
    try {
      const res = await runBackup();
      if (!res) return;
      const rot = rotate();
      log.info('DB backup written', { path: res.path, sizeKb: res.sizeKb, ...rot });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error('DB backup failed', { error: msg });
      eventBus.publish({
        type: 'alert',
        level: 'error',
        message: `❌ DB-Backup fehlgeschlagen: ${msg}`,
      });
    }
  });
}

export function startDbBackup(): void {
  if (timer) return;
  log.info('DB-backup worker started', { intervalMs: INTERVAL_MS, keepN: KEEP_N, dir: backupDir() });
  // Run once 60s after boot so we always have a fresh backup on startup.
  setTimeout(() => void tick(), 60_000);
  timer = setInterval(() => void tick(), INTERVAL_MS);
}

export function stopDbBackup(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
    log.info('DB-backup worker stopped');
  }
}

export const _internal = { runBackup, rotate, backupDir };
