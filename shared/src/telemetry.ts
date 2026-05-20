// ──────────────────────────────────────────────────────────────────────────────
// Backend telemetry — surfaces silent failures so the dashboard can show them.
//
// Workers used to swallow non-fatal exceptions into log.warn(). The user
// never saw those, so a misconfigured key or transient API error could go
// unnoticed for weeks. This module records the last N events into a small
// `worker_events` table that the dashboard polls via /api/status/events.
//
// Keep it lightweight: no external SDK, no Sentry require, no PII scrubbing
// beyond truncation. The frontend telemetry wrapper (dashboard/lib/telemetry)
// handles user-facing crash reporting.
// ──────────────────────────────────────────────────────────────────────────────

import { getDb } from './db.js';

let initialized = false;
function ensureTable(): void {
  if (initialized) return;
  getDb().exec(`
    CREATE TABLE IF NOT EXISTS worker_events (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      worker     TEXT NOT NULL,
      level      TEXT NOT NULL CHECK (level IN ('info', 'warn', 'error')),
      message    TEXT NOT NULL,
      context    TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_worker_events_created ON worker_events(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_worker_events_level   ON worker_events(level, created_at DESC);
  `);
  initialized = true;
}

const MAX_MSG = 500;
const MAX_CTX = 2_000;
const RETENTION_ROWS = 5_000;

export function recordWorkerEvent(
  worker: string,
  level: 'info' | 'warn' | 'error',
  message: string,
  context?: Record<string, unknown>,
): void {
  try {
    ensureTable();
    const msg = String(message).slice(0, MAX_MSG);
    const ctx = context ? JSON.stringify(context).slice(0, MAX_CTX) : null;
    getDb()
      .prepare(`INSERT INTO worker_events (worker, level, message, context) VALUES (?, ?, ?, ?)`)
      .run(worker, level, msg, ctx);
    // Cheap trim — keep the table bounded so this never grows to GB.
    if (Math.random() < 0.05) {
      getDb()
        .prepare(`DELETE FROM worker_events WHERE id NOT IN (SELECT id FROM worker_events ORDER BY id DESC LIMIT ?)`)
        .run(RETENTION_ROWS);
    }
  } catch {
    // Telemetry must never crash a worker. If we can't write, we lose the event.
  }
}

export interface WorkerEventRow {
  id: number;
  worker: string;
  level: 'info' | 'warn' | 'error';
  message: string;
  context: string | null;
  created_at: string;
}

export function recentWorkerEvents(opts: { limit?: number; minLevel?: 'info' | 'warn' | 'error' } = {}): WorkerEventRow[] {
  ensureTable();
  const limit = Math.max(1, Math.min(500, opts.limit ?? 50));
  const levelFilter = opts.minLevel === 'error'
    ? `WHERE level = 'error'`
    : opts.minLevel === 'warn'
      ? `WHERE level IN ('warn', 'error')`
      : '';
  return getDb()
    .prepare(`SELECT id, worker, level, message, context, created_at FROM worker_events ${levelFilter} ORDER BY id DESC LIMIT ?`)
    .all(limit) as WorkerEventRow[];
}
