// ──────────────────────────────────────────────────────────────────────────────
// Advisory DB locks — prevent the same worker tick from running concurrently
// across multiple orchestrator processes (e.g. dev + pm2 by accident, or two
// pm2 instances after a half-finished restart).
//
// In-process `let isRunning` does NOT protect against this — only a DB write
// does. We use INSERT OR IGNORE on a (name) UNIQUE constraint as a cheap CAS.
// ──────────────────────────────────────────────────────────────────────────────

import { getDb } from './db.js';

const HOLDER_ID = `${process.pid}@${Date.now()}`;

/** Try to acquire a named lock. Returns true if acquired, false if held by someone else. */
export function acquireLock(name: string, ttlSeconds = 300): boolean {
  const db = getDb();
  const ttlSec = Math.max(1, ttlSeconds);
  // DELETE-stale + INSERT-OR-IGNORE must be atomic — otherwise two callers can
  // both observe "stale", both delete, and both insert (since INSERT OR IGNORE
  // only blocks if the row currently exists at the moment of that statement).
  const tx = db.transaction((n: string, ttl: number) => {
    db.prepare(`DELETE FROM worker_locks WHERE name = ? AND expires_at < datetime('now')`).run(n);
    const r = db.prepare(`
      INSERT OR IGNORE INTO worker_locks (name, holder, acquired_at, expires_at)
      VALUES (?, ?, datetime('now'), datetime('now', '+' || ? || ' seconds'))
    `).run(n, HOLDER_ID, ttl);
    return r.changes > 0;
  });
  return tx(name, ttlSec) as boolean;
}

/** Release a lock. Only releases if held by THIS process. Idempotent. */
export function releaseLock(name: string): void {
  getDb().prepare(`DELETE FROM worker_locks WHERE name = ? AND holder = ?`).run(name, HOLDER_ID);
}

/** Run fn() iff we can acquire the lock. Returns whatever fn returns, or null if locked. */
export async function withLock<T>(name: string, ttlSeconds: number, fn: () => Promise<T>): Promise<T | null> {
  if (!acquireLock(name, ttlSeconds)) return null;
  const workerName = name.replace(/-tick$/, '');
  try {
    return await fn();
  } finally {
    // Heartbeat in finally so /health/deep can see the worker is alive
    // even if individual ticks fail (e.g. transient network errors).
    try {
      getDb()
        .prepare(`INSERT INTO settings(key, value) VALUES (?, datetime('now')) ON CONFLICT(key) DO UPDATE SET value = excluded.value`)
        .run(`_worker_${workerName}_last_ok`);
    } catch { /* ignore */ }
    releaseLock(name);
  }
}

/** Manually mark a worker as alive (for workers that don't use withLock). */
export function markWorkerAlive(workerName: string): void {
  getDb()
    .prepare(`INSERT INTO settings(key, value) VALUES (?, datetime('now')) ON CONFLICT(key) DO UPDATE SET value = excluded.value`)
    .run(`_worker_${workerName}_last_ok`);
}
