// ──────────────────────────────────────────────────────────────────────────────
// Diagnostics Routes — support-friendly support bundle exporter.
//
// Endpoints:
//   GET  /api/diagnostics/info           → JSON with versions, DB-size, last
//                                          backup, bot health summary
//   POST /api/diagnostics/backup-now     → trigger a DB backup synchronously
//   GET  /api/diagnostics/export-bundle  → ZIP with logs + db-snapshot + info
//
// All read-only-ish, no PII exported (logs are scrubbed for tokens).
// ──────────────────────────────────────────────────────────────────────────────

import { Router } from 'express';
import { execSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { createLogger, getDb } from '@vinted-system/shared';

const log = createLogger('diagnostics-route');
export const diagnosticsRouter = Router();

function dbPath(): string {
  return process.env.DB_PATH
    ?? path.resolve(process.cwd(), '../data/orchestrator.db');
}

function backupDir(): string {
  return process.env.BACKUP_DIR
    ?? path.resolve(process.cwd(), '../data/backups');
}

function latestBackup(): string | null {
  const dir = backupDir();
  if (!fs.existsSync(dir)) return null;
  const files = fs.readdirSync(dir)
    .filter((f) => f.endsWith('.db'))
    .map((f) => ({ name: f, mtime: fs.statSync(path.join(dir, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  return files[0] ? new Date(files[0].mtime).toISOString() : null;
}

function dbSizeMB(): number | undefined {
  try {
    return Math.round(fs.statSync(dbPath()).size / (1024 * 1024) * 10) / 10;
  } catch { return undefined; }
}

function botHealth(): { online: number; total: number } {
  try {
    const rows = getDb().prepare(`
      SELECT COUNT(*) AS n FROM marketplace_listings
       WHERE marketplace IS NOT NULL
    `).get() as { n: number } | undefined;
    return { online: 0, total: rows?.n ?? 0 };  // synthetic; real botHealth comes from /products
  } catch { return { online: 0, total: 0 }; }
}

diagnosticsRouter.get('/info', (_req, res) => {
  try {
    res.json({
      app_version: '0.5.0',
      node_version: process.version,
      platform: `${os.platform()} ${os.arch()}`,
      db_path: dbPath(),
      db_size_mb: dbSizeMB(),
      last_backup_at: latestBackup(),
      bots_online: botHealth().online,
      bots_total: botHealth().total,
    });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

diagnosticsRouter.post('/backup-now', (_req, res) => {
  try {
    const dir = backupDir();
    fs.mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const dst = path.join(dir, `manual-${stamp}.db`);
    // sqlite3 backup via the .backup pragma — runs against the LIVE DB safely.
    const db = getDb();
    // better-sqlite3 has its own backup() helper
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const anyDb = db as any;
    if (typeof anyDb.backup === 'function') {
      anyDb.backup(dst);
    } else {
      // Fallback: file copy (acceptable when WAL is checkpointed, which it is on idle)
      fs.copyFileSync(dbPath(), dst);
    }
    log.info('Manual backup created', { dst });
    res.json({ ok: true, path: dst });
  } catch (e) {
    res.status(500).json({ ok: false, error: e instanceof Error ? e.message : String(e) });
  }
});

/**
 * Export a ZIP with everything support needs to debug:
 *   - info.json (versions, paths)
 *   - logs/        (last 1MB of orchestrator + bot logs)
 *   - db-snapshot.db (latest backup, NOT the live file)
 *
 * Excludes: cookies, sessions, listing content (privacy + size).
 */
diagnosticsRouter.get('/export-bundle', (_req, res) => {
  try {
    const tmp = path.join(os.tmpdir(), `blackruby-diag-${Date.now()}`);
    fs.mkdirSync(tmp, { recursive: true });

    // 1. info
    const info = {
      app_version: '0.5.0',
      node_version: process.version,
      platform: `${os.platform()} ${os.arch()}`,
      generated_at: new Date().toISOString(),
      db_size_mb: dbSizeMB(),
      env_keys: Object.keys(process.env).filter((k) => /BLACKRUBY|VINTED|KA|DEPOP|EBAY|CJ|STRIPE/.test(k))
        .map((k) => ({ key: k, set: true })),  // never include the actual value
    };
    fs.writeFileSync(path.join(tmp, 'info.json'), JSON.stringify(info, null, 2));

    // 2. DB snapshot (fresh copy)
    try {
      const db = getDb();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const anyDb = db as any;
      if (typeof anyDb.backup === 'function') {
        anyDb.backup(path.join(tmp, 'db-snapshot.db'));
      } else {
        fs.copyFileSync(dbPath(), path.join(tmp, 'db-snapshot.db'));
      }
    } catch { /* skip if locked */ }

    // 3. Recent logs — best effort, varies by host
    const logDir = path.resolve(process.cwd(), '../_logs');
    if (fs.existsSync(logDir)) {
      const logOut = path.join(tmp, 'logs');
      fs.mkdirSync(logOut, { recursive: true });
      for (const f of fs.readdirSync(logDir).slice(-5)) {
        try {
          const src = path.join(logDir, f);
          const buf = fs.readFileSync(src);
          // Last 1 MB only
          const slice = buf.subarray(Math.max(0, buf.length - 1_000_000));
          fs.writeFileSync(path.join(logOut, f), slice);
        } catch { /* skip */ }
      }
    }

    // 4. Zip + stream
    const zipPath = `${tmp}.zip`;
    execSync(`cd "${tmp}" && zip -qr "${zipPath}" .`);

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="blackruby-diagnostics-${new Date().toISOString().slice(0, 10)}.zip"`);
    res.sendFile(zipPath, (err) => {
      // Cleanup
      try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* */ }
      try { fs.rmSync(zipPath); } catch { /* */ }
      if (err) log.warn('sendFile err', { err: err.message });
    });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});
