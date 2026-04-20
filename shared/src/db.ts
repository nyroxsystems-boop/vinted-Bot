import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let dbInstance: Database.Database | null = null;

function resolveDbPath(): string {
  const envPath = process.env.DB_PATH;
  if (envPath) return path.resolve(envPath);
  // Default: orchestrator/data/vinted-system.db, relative to repo root.
  return path.resolve(__dirname, '..', '..', 'orchestrator', 'data', 'vinted-system.db');
}

export function getDb(): Database.Database {
  if (dbInstance) return dbInstance;

  const dbPath = resolveDbPath();
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  dbInstance = db;
  return db;
}

export function runMigrations(): void {
  const db = getDb();
  const schemaPath = path.join(__dirname, 'schema.sql');
  const sql = fs.readFileSync(schemaPath, 'utf-8');
  db.exec(sql);

  // Soft column adds — schema.sql uses CREATE TABLE IF NOT EXISTS, so
  // existing DBs don't pick up new columns. These ALTERs are idempotent
  // in practice because SQLite raises if the column already exists;
  // we swallow that one error and rethrow anything else.
  const ensureColumn = (table: string, column: string, defSQL: string) => {
    try {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${defSQL}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!/duplicate column name/i.test(msg)) throw err;
    }
  };
  ensureColumn('crawled_products', 'description', 'TEXT');
  ensureColumn('crawled_products', 'attributes_json', 'TEXT');

  // The original CHECK constraint on crawled_products.status doesn't
  // allow 'failed'. SQLite can't ALTER a CHECK, so if the existing
  // constraint is the old one we rebuild the table in a single tx.
  const check = db
    .prepare(
      `SELECT sql FROM sqlite_master WHERE type='table' AND name='crawled_products'`,
    )
    .get() as { sql: string } | undefined;
  if (check?.sql && !check.sql.includes("'failed'")) {
    db.exec(`
      BEGIN;
      ALTER TABLE crawled_products RENAME TO crawled_products_old;
      CREATE TABLE crawled_products (
        id               INTEGER PRIMARY KEY AUTOINCREMENT,
        temu_goods_id    TEXT NOT NULL UNIQUE,
        temu_url         TEXT NOT NULL,
        title            TEXT,
        price_eur        REAL,
        rating           REAL,
        review_count     INTEGER,
        search_query     TEXT,
        description      TEXT,
        attributes_json  TEXT,
        folder_num       INTEGER,
        folder_path      TEXT,
        queue_file_path  TEXT,
        status           TEXT NOT NULL DEFAULT 'crawled'
                         CHECK(status IN (
                           'crawled', 'generating', 'ready', 'failed',
                           'listed', 'sold', 'archived'
                         )),
        last_error       TEXT,
        crawled_at       TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
      );
      INSERT INTO crawled_products
        SELECT id, temu_goods_id, temu_url, title, price_eur, rating,
               review_count, search_query, description, attributes_json,
               folder_num, folder_path, queue_file_path, status,
               last_error, crawled_at, updated_at
          FROM crawled_products_old;
      DROP TABLE crawled_products_old;
      CREATE INDEX IF NOT EXISTS idx_crawled_status ON crawled_products(status);
      CREATE INDEX IF NOT EXISTS idx_crawled_goods  ON crawled_products(temu_goods_id);
      COMMIT;
    `);
  }
}

export function closeDb(): void {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }
}

// ── Settings helpers ─────────────────────────────────────────────────────────

export function getSetting(key: string): string | null {
  const row = getDb()
    .prepare('SELECT value FROM settings WHERE key = ?')
    .get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function setSetting(key: string, value: string): void {
  getDb()
    .prepare('INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, value);
}

export function isPaused(): boolean {
  return getSetting('paused') === 'true';
}

// ── Bot run audit helpers ─────────────────────────────────────────────────────

export function startBotRun(bot: 'vinted' | 'temu', action: string): number {
  const res = getDb()
    .prepare('INSERT INTO bot_runs(bot, action) VALUES (?, ?)')
    .run(bot, action);
  return res.lastInsertRowid as number;
}

export function finishBotRun(
  id: number,
  outcome: 'success' | 'failure' | 'skipped',
  error?: string,
): void {
  getDb()
    .prepare(
      `UPDATE bot_runs
         SET ended_at = datetime('now'), outcome = ?, error = ?
       WHERE id = ?`,
    )
    .run(outcome, error ?? null, id);
}
