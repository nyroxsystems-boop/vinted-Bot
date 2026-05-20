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
  db.pragma('synchronous = FULL');
  db.pragma('foreign_keys = ON');

  dbInstance = db;
  return db;
}

export function runMigrations(): void {
  const db = getDb();

  // ── Migration ledger ────────────────────────────────────────────────────────
  // Tracks which one-shot data migrations have already run so we don't re-run
  // them on every boot. Schema-shape migrations (CREATE TABLE IF NOT EXISTS,
  // ensureColumn) are idempotent and don't need to be recorded here.
  db.exec(`
    CREATE TABLE IF NOT EXISTS _db_migrations (
      version    TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now')),
      notes      TEXT
    );
  `);

  const recordMigration = (version: string, notes?: string): void => {
    db.prepare(`INSERT OR IGNORE INTO _db_migrations(version, notes) VALUES(?, ?)`).run(version, notes ?? null);
  };
  const migrationApplied = (version: string): boolean =>
    !!db.prepare(`SELECT 1 FROM _db_migrations WHERE version = ?`).get(version);

  // ORDER MATTERS:
  // Older DBs have listings/chats tables WITHOUT account_id. schema.sql
  // now references account_id in its CREATE INDEX statements, so running
  // schema.sql against an old DB would crash with "no such column". We
  // therefore pre-ensure the column on pre-existing tables BEFORE running
  // the bundled schema.

  const tableExists = (table: string): boolean =>
    !!db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).get(table);

  const preEnsure = (table: string, column: string, defSQL: string): void => {
    if (!tableExists(table)) return; // schema.sql will create it fresh with the column
    try {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${defSQL}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!/duplicate column name/i.test(msg)) throw err;
    }
  };
  preEnsure('listings', 'account_id', 'INTEGER NOT NULL DEFAULT 1');
  preEnsure('chats', 'account_id', 'INTEGER NOT NULL DEFAULT 1');
  preEnsure('auto_listings', 'account_id', 'INTEGER NOT NULL DEFAULT 1');

  const schemaPath = path.join(__dirname, 'schema.sql');
  const sql = fs.readFileSync(schemaPath, 'utf-8');
  db.exec(sql);

  // Indexes that depend on columns added by migration — now it's safe.
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_listings_account      ON listings(account_id);
    CREATE INDEX IF NOT EXISTS idx_chats_account         ON chats(account_id);
    CREATE INDEX IF NOT EXISTS idx_auto_listings_account ON auto_listings(account_id);
  `);

  // Soft column adds for older tables.
  const ensureColumn = (table: string, column: string, defSQL: string): void => {
    try {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${defSQL}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!/duplicate column name/i.test(msg)) throw err;
    }
  };
  ensureColumn('crawled_products', 'description', 'TEXT');
  ensureColumn('crawled_products', 'attributes_json', 'TEXT');
  // Reply-autopilot human-like delay
  ensureColumn('reply_autopilot_log', 'scheduled_send_at', 'TEXT');

  // Point the default account's filesystem layout at the actual repo's
  // data/ folder, not the hard-coded path in the seed SQL. This runs on
  // every boot so moving the repo just works.
  try {
    // schema.ts sits at shared/src/db.ts — repo root is two parents up.
    const here = new URL('.', import.meta.url).pathname;
    const repoRoot = path.resolve(here, '..', '..');
    const defaultDir = path.join(repoRoot, 'data', 'accounts', '1');
    const defaultState = path.join(defaultDir, 'state.json');
    db.prepare(
      `UPDATE vinted_accounts
          SET data_dir = ?, state_path = ?
        WHERE id = 1 AND (data_dir = '' OR data_dir LIKE '/Users/home/Vinted/system/%' OR data_dir LIKE '/Users/home/Desktop/Partsunion/%')`,
    ).run(defaultDir, defaultState);
  } catch {
    // non-fatal; user can override via UI or env var
  }

  // Sales — fulfillment automation columns (added 2026-04).
  ensureColumn('sales', 'shipping_label_path', 'TEXT');
  ensureColumn('sales', 'shipping_label_fetched_at', 'TEXT');
  ensureColumn('sales', 'tracking_number', 'TEXT');
  ensureColumn('sales', 'tracking_sent_at', 'TEXT');
  ensureColumn('sales', 'feedback_left_at', 'TEXT');

  // CJ orders — smart EU-handover tracking. We keep both numbers separately
  // so the UI can show "China-Leg → EU-Übergabe → an Vinted gepuscht" history.
  ensureColumn('cj_orders', 'cn_tracking_number', 'TEXT');
  ensureColumn('cj_orders', 'cn_logistic_name',   'TEXT');
  ensureColumn('cj_orders', 'cn_first_seen_at',   'TEXT');
  ensureColumn('cj_orders', 'eu_tracking_number', 'TEXT');
  ensureColumn('cj_orders', 'eu_logistic_name',   'TEXT');
  ensureColumn('cj_orders', 'eu_handover_at',     'TEXT');
  ensureColumn('cj_orders', 'tracking_push_state',
    "TEXT NOT NULL DEFAULT 'awaiting' CHECK(tracking_push_state IN ('awaiting','eu_ready','pushed','fallback'))");
  ensureColumn('cj_orders', 'last_tracking_poll_at', 'TEXT');

  // Auto-listings — carry temu_url so the purchase queue can show the user
  // the exact product to buy without a join through crawled_products.
  ensureColumn('auto_listings', 'temu_url', 'TEXT');

  // Multi-Marketplace: per-account Proxy + welcher Marktplatz
  ensureColumn('vinted_accounts', 'proxy_url', 'TEXT');
  ensureColumn('vinted_accounts', 'marketplace', "TEXT NOT NULL DEFAULT 'vinted'");

  // Reply-Autopilot: marketplace column zur Trennung Vinted/KA-Chats
  ensureColumn('reply_autopilot_log', 'marketplace', "TEXT NOT NULL DEFAULT 'vinted'");

  // Sales — CJ fulfillment needs to know which platform the sale came from
  // and the buyer's phone for CJ's shipping API.
  ensureColumn('sales', 'marketplace', "TEXT DEFAULT 'vinted'");
  ensureColumn('sales', 'buyer_phone', 'TEXT');
  ensureColumn('sales', 'buyer_country', "TEXT DEFAULT 'DE'");

  // Auto-listings — CJ product link (in addition to temu_url for legacy)
  ensureColumn('auto_listings', 'cj_product_id', 'TEXT');
  ensureColumn('auto_listings', 'cj_variant_id', 'TEXT');

  // Chats — vinted_item_id from conversation header for Offer→Listing matching
  ensureColumn('chats', 'vinted_item_id', 'TEXT');

  // CJ-Orders — per-order poll cooldown timestamps to cut down on API quota
  // burn. Without these we'd hit /getTrackInfo every tick (3 min) for every
  // 'ordered' order, eating thousands of calls/day.
  ensureColumn('cj_orders', 'last_tracking_poll_at', 'TEXT');
  ensureColumn('cj_orders', 'last_delivery_poll_at', 'TEXT');
  ensureColumn('cj_orders', 'stuck_alerted_at', 'TEXT');

  // Auto-Listings — re-list lifecycle tracking
  ensureColumn('auto_listings', 'sold_at', 'TEXT');
  ensureColumn('auto_listings', 'parent_folder_num', 'INTEGER');
  ensureColumn('auto_listings', 'relist_count', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn('auto_listings', 'last_sold_at', 'TEXT');

  // Crawled-Products — folder-assignment to a specific Vinted account so
  // multi-account setups don't list the same folder 3× across accounts
  // (which Vinted flags as duplicate-listings → ban). NULL = unassigned,
  // any account can pick it up. Discovery worker assigns round-robin on
  // import; once assigned, only the matching account's listing-watcher
  // will turn it into an auto_listing.
  ensureColumn('crawled_products', 'assigned_account_id', 'INTEGER');
  db.exec(`CREATE INDEX IF NOT EXISTS idx_crawled_assigned
             ON crawled_products(assigned_account_id, status)`);

  // Multi-model rotation — see model_profiles. `weight` balances how often
  // each ACTIVE model is picked; default 1 = equal probability.
  ensureColumn('model_profiles', 'weight', 'INTEGER NOT NULL DEFAULT 1');

  // Account health snapshot — current state derived from
  // `account_health_events`. Cached on the account row for fast lookup.
  ensureColumn('vinted_accounts', 'health_status', "TEXT NOT NULL DEFAULT 'unknown' CHECK(health_status IN ('ok','warn','degraded','paused','unknown'))");
  ensureColumn('vinted_accounts', 'health_last_event_at', 'TEXT');
  ensureColumn('vinted_accounts', 'auto_paused_at', 'TEXT');
  ensureColumn('vinted_accounts', 'auto_paused_reason', 'TEXT');

  // Sales — track how long a sale chat sat unread before first reply.
  // Vinted boosts fast-responder accounts.
  ensureColumn('chats', 'first_response_at', 'TEXT');
  ensureColumn('chats', 'first_response_delay_s', 'INTEGER');

  // listings.sold_at — used by telegram-alerts daily summary
  ensureColumn('listings', 'sold_at', 'TEXT');

  // ── marketplace_listings constraint refactor ─────────────────────────────
  // Original constraint (mp, acc, folder_num) prevents storing the history of
  // re-listed items. After re-listing, the old marketplace_listings row gets
  // overwritten, breaking the cross-sync + cj-fulfillment joins for the
  // already-sold listing. New constraint pins on external_id instead — a
  // folder can now have multiple rows (one per re-list) and each sale matches
  // the exact one. Old marketplace_listings UPSERT users were `UPDATE` —
  // they become `INSERT` on re-list, which is what we want.
  // ALWAYS ensure the old folder-num-based unique index is gone, even if the
  // new external-id-based one already exists. This handles partially-migrated
  // DBs from earlier runs.
  db.exec(`DROP INDEX IF EXISTS uniq_mp_listings_marketplace_account_folder`);
  // Index must be partial — multiple rows can legitimately have external_id=NULL
  // (e.g. draft/publishing rows before the marketplace assigns an ID). A
  // non-partial UNIQUE on three columns including NULL still treats each NULL
  // as distinct in SQLite, but explicit `WHERE external_id IS NOT NULL` makes
  // the intent obvious and prevents accidental NULL-collisions on engines that
  // handle NULLs differently.
  const mlIdx = db.prepare(`SELECT sql FROM sqlite_master WHERE type='index' AND name='uniq_mp_listings_external'`).get() as { sql: string } | undefined;
  if (!mlIdx || !/WHERE\s+external_id\s+IS\s+NOT\s+NULL/i.test(mlIdx.sql ?? '')) {
    db.exec(`DROP INDEX IF EXISTS uniq_mp_listings_external`);
    db.exec(`CREATE UNIQUE INDEX uniq_mp_listings_external ON marketplace_listings(marketplace, account_id, external_id) WHERE external_id IS NOT NULL`);
  }

  // auto_listings retry-with-backoff
  ensureColumn('auto_listings', 'retry_count', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn('auto_listings', 'last_retry_at', 'TEXT');

  // Worker advisory locks — prevents two orchestrator processes from running
  // the same tick concurrently and double-writing.
  db.exec(`
    CREATE TABLE IF NOT EXISTS worker_locks (
      name        TEXT PRIMARY KEY,
      holder      TEXT NOT NULL,
      acquired_at TEXT NOT NULL,
      expires_at  TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_worker_locks_expires ON worker_locks(expires_at);
  `);

  // Per-marketplace listing variants — Vinted wants short emoji-friendly
  // titles and tag-heavy descriptions; Kleinanzeigen wants longer, formal
  // descriptions with bullet points and Hermes-Versand notes. We store one
  // row per (auto_listing, marketplace) and the auto-publisher reads the
  // right variant before pushing. Fallback to auto_listings.* columns when
  // no variant exists yet.
  db.exec(`
    CREATE TABLE IF NOT EXISTS auto_listing_variants (
      id                    INTEGER PRIMARY KEY AUTOINCREMENT,
      auto_listing_id       INTEGER NOT NULL REFERENCES auto_listings(id) ON DELETE CASCADE,
      marketplace           TEXT NOT NULL,
      title                 TEXT NOT NULL,
      description           TEXT NOT NULL,
      category              TEXT,
      subcategory           TEXT,
      brand                 TEXT,
      size                  TEXT,
      condition             TEXT,
      color                 TEXT,
      material              TEXT,
      price_eur             REAL,
      tags_json             TEXT,
      extra_json            TEXT,
      generated_by          TEXT NOT NULL DEFAULT 'llm',
      created_at            TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at            TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(auto_listing_id, marketplace)
    );
    CREATE INDEX IF NOT EXISTS idx_alv_listing ON auto_listing_variants(auto_listing_id);
    CREATE INDEX IF NOT EXISTS idx_alv_marketplace ON auto_listing_variants(marketplace);
  `);

  // CJ-named twins of the legacy temu_* columns. We keep both for now and
  // double-write via triggers below so old code paths still read the values.
  ensureColumn('auto_listings', 'cj_product_url', 'TEXT');
  ensureColumn('auto_listings', 'cj_cost_eur', 'REAL');

  // Per-row publish targets — JSON array of marketplace IDs (e.g.
  // ["vinted","kleinanzeigen","depop"]). NULL = legacy fallback to the
  // global auto_crosslist_targets + *_enabled settings. Set by the
  // "Publish auswählen…" picker in the dashboard.
  ensureColumn('auto_listings', 'target_marketplaces', 'TEXT');

  // Backfill: copy temu_* into cj_* for rows that have temu but not cj.
  // One-shot data migration — gated on the migration ledger so we don't
  // re-run the UPDATE on every boot.
  if (!migrationApplied('0.5.0-temu-to-cj')) {
    db.exec(`
      UPDATE auto_listings
         SET cj_product_url = COALESCE(cj_product_url, temu_url),
             cj_cost_eur    = COALESCE(cj_cost_eur, temu_price_eur)
       WHERE (cj_product_url IS NULL AND temu_url IS NOT NULL)
          OR (cj_cost_eur    IS NULL AND temu_price_eur IS NOT NULL);
    `);
    recordMigration('0.5.0-temu-to-cj', 'backfill cj_product_url/cj_cost_eur from temu_*');
  }

  // Triggers keep both columns in sync going forward (until rename).
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS auto_listings_sync_cj_url_ins
    AFTER INSERT ON auto_listings
    WHEN NEW.temu_url IS NOT NULL AND NEW.cj_product_url IS NULL
    BEGIN
      UPDATE auto_listings SET cj_product_url = NEW.temu_url WHERE id = NEW.id;
    END;
    CREATE TRIGGER IF NOT EXISTS auto_listings_sync_cj_cost_ins
    AFTER INSERT ON auto_listings
    WHEN NEW.temu_price_eur IS NOT NULL AND NEW.cj_cost_eur IS NULL
    BEGIN
      UPDATE auto_listings SET cj_cost_eur = NEW.temu_price_eur WHERE id = NEW.id;
    END;
  `);

  // Seed new settings (idempotent — INSERT OR IGNORE).
  const seedSetting = db.prepare(
    'INSERT OR IGNORE INTO settings(key, value) VALUES (?, ?)',
  );
  const defaults: Array<[string, string]> = [
    ['auto_fetch_shipping_label', 'true'],
    ['auto_send_tracking_to_buyer', 'true'],
    ['auto_leave_feedback', 'true'],
    ['auto_feedback_template', 'Super Käufer:in, alles reibungslos! Gerne wieder 💕'],
    ['auto_repricing_enabled', 'true'],
    // Wenn ein Listing X Tage ohne Message + 0 Likes ist → Preis senken
    ['repricing_idle_days', '7'],
    ['repricing_drop_pct', '10'],
    ['repricing_floor_markup', '1.5'],   // Floor = temu_price × markup
    ['repricing_min_price_eur', '20'],   // absoluter Mindestpreis
    ['repricing_max_drops', '3'],        // pro Listing höchstens N Drops
    ['repricing_interval_hours', '24'],  // Worker-Cadence
    // Reply-Autopilot (LLM)
    ['auto_reply_enabled', 'true'],
    ['auto_reply_send_mode', 'draft'],          // 'draft' | 'auto'
    ['auto_reply_lookback_min', '60'],          // wie weit zurück nach unbeantworteten Messages suchen
    ['auto_reply_max_negotiation_drop_pct', '15'], // Verhandlung max -15% off list_price
    ['auto_reply_interval_min', '5'],           // Worker-Cadence
    // Vinted API-Modus (10× schneller als Playwright-UI, kein Bot-Block)
    ['vinted_use_api', 'true'],                 // primärer Pfad: API statt UI
    ['vinted_api_fallback_to_ui', 'true'],      // bei API-Fail UI versuchen
    ['image_gen_mode', 'copy_source'],
    ['image_gen_max_per_cycle', '3'],
    // ── CJ Dropshipping ──
    ['cj_auto_order', 'false'],                 // false until user configures CJ account
    ['cj_max_order_eur', '30'],                 // safety limit per single order
    ['cj_max_daily_orders', '50'],              // daily cap
    ['cj_preferred_warehouse', 'CN'],           // CN, DE, US
    ['cj_preferred_logistic', ''],              // empty = let CJ choose cheapest
    ['cj_auto_tracking_sync', 'true'],          // auto-pull tracking from CJ
    ['cj_webhook_enabled', 'false'],            // enable webhook receiver
    // ── Fulfillment mode ──
    ['fulfillment_provider', 'cj'],             // 'cj' | 'manual'
    // ── Auto-Crosslist ──
    ['auto_crosslist_targets', '[]'],            // JSON array of MarketplaceIds to auto-push
    // ── Listing Pipeline ──
    ['auto_listing_auto_approve', 'false'],      // auto-skip review for generated listings
    ['vinted_poll_interval_s', '60'],            // scheduler base poll interval
    ['vinted_daily_publish_cap', '30'],          // max NEW listings per Vinted account per day (base cap, post-warming)
    // ── Account Warming ──
    // Fresh accounts get banned if they suddenly post 30/day. Linear ramp
    // from `_cap_min` (day 0) to `vinted_daily_publish_cap` (day 30+).
    // Skipped entirely for account id=1 (legacy single-account) so existing
    // setups don't suddenly throttle.
    ['vinted_warming_enabled', 'true'],
    ['vinted_daily_publish_cap_min', '3'],       // floor on day 0 for new accounts
    // Per-marketplace caps (multi-marketplace account separation). Each
    // platform has its own policy: eBay tolerates 100/day per account,
    // KA/Depop/Mercari/Wallapop/Etsy ~50/day. Warming ramp uses the same
    // 30-day formula as Vinted. accountDailyCap() reads these by prefix.
    ['ebay_daily_publish_cap', '100'],
    ['ebay_daily_publish_cap_min', '10'],
    ['ebay_warming_enabled', 'true'],
    ['kleinanzeigen_daily_publish_cap', '50'],
    ['kleinanzeigen_daily_publish_cap_min', '5'],
    ['kleinanzeigen_warming_enabled', 'true'],
    ['depop_daily_publish_cap', '50'],
    ['depop_daily_publish_cap_min', '5'],
    ['depop_warming_enabled', 'true'],
    ['mercari_daily_publish_cap', '50'],
    ['mercari_daily_publish_cap_min', '5'],
    ['mercari_warming_enabled', 'true'],
    ['wallapop_daily_publish_cap', '50'],
    ['wallapop_daily_publish_cap_min', '5'],
    ['wallapop_warming_enabled', 'true'],
    ['etsy_daily_publish_cap', '50'],
    ['etsy_daily_publish_cap_min', '5'],
    ['etsy_warming_enabled', 'true'],
    // ── Re-Lister ──
    ['relist_enabled', 'true'],                  // auto-relist a folder after it sells
    ['relist_delay_hours', '24'],                // wait N hours after sale before re-listing
    ['relist_max_per_day', '30'],                // global cap on re-lists per day (queue stretches)
    ['relist_inactive_pause_days', '21'],        // if a folder gets no sale in N days → pause it
    // Auto-archive listings that get no engagement for N days → fresh clone re-queued
    ['listing_inactive_archive_days', '30'],
    // Auto DB-backup every 6h (kept in data/backups/), keep last 14 snapshots
    ['db_backup_enabled', 'true'],
    // ── LLM-Provider ──
    // 'claude_cli' = local Claude Code CLI (free with subscription, ~5-15s/call)
    // 'gemini'     = Google Gemini API (free 1500 req/day, ~1-3s/call)
    // 'anthropic'  = Anthropic API (paid, fastest)
    ['llm_provider', 'claude_cli'],
    ['llm_model_gemini', 'gemini-2.5-flash'],
    ['llm_model_anthropic', 'claude-sonnet-4-6'],
    // ── Reply-Autopilot human-like cadence ──
    // Claude waits 10-15 min after a buyer message before replying so we don't
    // look like a bot. Jitter range in seconds — random between min..max.
    ['auto_reply_send_mode', 'draft'],           // 'draft' = review queue, 'auto' = auto-send w/ delay
    ['auto_reply_delay_min_s', '600'],           // 10 min minimum
    ['auto_reply_delay_max_s', '900'],           // 15 min maximum
    // ── Seller info — injected into Claude prompts when buyer asks for payment/contact ──
    ['seller_name', ''],                          // e.g. "Lina Müller" (legal name for invoices)
    ['seller_display_name', ''],                  // e.g. "Lina" (used in greetings)
    ['seller_zip', ''],                           // e.g. "53577"
    ['seller_city', ''],                          // e.g. "Neustadt (Wied)"
    // Payment methods as JSON array:
    // [{"type":"paypal","handle":"max@example.com","name":"Max M"},
    //  {"type":"iban","handle":"DE89...","holder":"Max Mustermann"},
    //  {"type":"ebay","note":"eBay-Bezahlsystem (Vinted-Käuferschutz / KA-Direktkauf)"}]
    ['payment_methods_json', '[]'],
    ['shipping_default_provider', 'Hermes'],     // Hermes | DHL | DPD — used in chat replies
    // ── Multi-Marketplace ──
    ['kleinanzeigen_enabled', 'true'],           // poll KA inbox + cross-list to KA
    ['kleinanzeigen_poll_interval_s', '180'],    // 3 min between KA inbox polls
    ['ka_sale_detect_enabled', 'true'],          // LLM-scan KA chats for sale signals
    ['ka_sale_confidence_min', '0.75'],          // min LLM confidence to auto-mark sold
    ['ebay_de_enabled', 'false'],                // crosslist to eBay-DE (off by default — needs OAuth token)
    // ── CAPTCHA ──
    // Default 'manual' — kostet nichts. System pausiert + Telegram-Alert; User
    // löst manuell + drückt "Resume" im Dashboard. Wenn du auf '2captcha' switchst
    // (mit CAPTCHA_API_KEY in .env) wird automatisch gelöst, ~$0.003/Solve.
    ['captcha_provider', 'manual'],
    ['captcha_auto_pause_on_detect', 'true'],
    // ── Profit ──
    ['default_shipping_eur', '4.99'],            // Hermes S standard shipping cost
    // ── Telegram ──
    ['telegram_enabled', 'true'],                // master switch (alerts only fire if BOT_TOKEN+CHAT_ID are set in .env)
  ];
  for (const [k, v] of defaults) seedSetting.run(k, v);

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
    recordMigration('0.5.0-crawled-products-failed-status', 'rebuilt CHECK constraint to allow "failed"');
  }

  // ── auto_listings: add 'raw' status for listings without generated photos ──
  // Old DBs have CHECK(status IN ('draft','approved','publishing','published','failed'))
  // without 'raw'. The new lifecycle is: raw → draft (photos ready) → approved
  // (user-confirmed) → publishing → published. 'raw' guards against publishing
  // listings that only have source CJ stock photos (no Model+Scene+Product).
  if (!migrationApplied('0.5.1-auto-listings-raw-status')) {
    const cur = db
      .prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='auto_listings'`)
      .get() as { sql: string } | undefined;
    if (cur?.sql && !cur.sql.includes("'raw'")) {
      // Rebuild table with new CHECK constraint. SQLite can't ALTER a CHECK,
      // so we rename-copy-drop. Indexes are dropped with the table and we
      // re-create them after.
      db.exec(`
        BEGIN;
        ALTER TABLE auto_listings RENAME TO auto_listings_old;
        CREATE TABLE auto_listings (
          id                    INTEGER PRIMARY KEY AUTOINCREMENT,
          account_id            INTEGER NOT NULL DEFAULT 1 REFERENCES vinted_accounts(id) ON DELETE CASCADE,
          folder_num            INTEGER NOT NULL,
          crawled_product_id    INTEGER REFERENCES crawled_products(id) ON DELETE SET NULL,
          title                 TEXT NOT NULL,
          description           TEXT NOT NULL,
          category              TEXT NOT NULL,
          subcategory           TEXT NOT NULL DEFAULT '',
          brand                 TEXT NOT NULL DEFAULT 'Ohne Marke',
          size                  TEXT NOT NULL DEFAULT 'S',
          condition             TEXT NOT NULL DEFAULT 'Sehr gut',
          color                 TEXT NOT NULL DEFAULT '',
          material              TEXT NOT NULL DEFAULT '',
          price_eur             REAL NOT NULL,
          temu_price_eur        REAL NOT NULL DEFAULT 0,
          profit_margin_eur     REAL NOT NULL DEFAULT 0,
          shipping_method       TEXT NOT NULL DEFAULT 'Hermes S',
          photo_paths_json      TEXT NOT NULL DEFAULT '[]',
          temu_url              TEXT,
          vinted_url            TEXT,
          vinted_item_id        TEXT,
          status                TEXT NOT NULL DEFAULT 'raw'
                                CHECK(status IN ('raw','draft','approved','publishing','published','failed')),
          last_error            TEXT,
          created_at            TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at            TEXT NOT NULL DEFAULT (datetime('now'))
        );
        INSERT INTO auto_listings
          SELECT id, account_id, folder_num, crawled_product_id, title, description,
                 category, subcategory, brand, size, condition, color, material,
                 price_eur, temu_price_eur, profit_margin_eur, shipping_method,
                 photo_paths_json, temu_url, vinted_url, vinted_item_id, status,
                 last_error, created_at, updated_at
            FROM auto_listings_old;
        DROP TABLE auto_listings_old;
        CREATE INDEX IF NOT EXISTS idx_auto_listings_status  ON auto_listings(status);
        CREATE INDEX IF NOT EXISTS idx_auto_listings_folder  ON auto_listings(folder_num);
        CREATE INDEX IF NOT EXISTS idx_auto_listings_account ON auto_listings(account_id);
        COMMIT;
      `);
    }
    // Data migration: any listing whose photos still point at the legacy raw
    // CJ-source folder (no /scene/ or /final/ in any path) moves to 'raw'.
    // 'published' rows stay published — those went live before this rule
    // existed, the user can manually deactivate them.
    db.exec(`
      UPDATE auto_listings
         SET status = 'raw',
             last_error = COALESCE(last_error, 'Raw CJ photos — needs model+scene+product generation')
       WHERE status IN ('draft','approved')
         AND photo_paths_json NOT LIKE '%/scene/%'
         AND photo_paths_json NOT LIKE '%/final/%'
         AND photo_paths_json NOT LIKE '%/generated/%';
    `);
    recordMigration('0.5.1-auto-listings-raw-status', 'add raw status + move legacy raw-photo rows to raw');
  }

  // Record the bootstrap once — proves the migration runner has touched this DB.
  recordMigration('0.5.0-bootstrap', 'initial schema + ensureColumn loop');
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

export function startBotRun(bot: 'vinted' | 'temu' | 'cj', action: string): number {
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
