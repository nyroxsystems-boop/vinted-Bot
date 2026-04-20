-- ──────────────────────────────────────────────────────────────────────────────
-- Vinted-System — SQLite schema
-- Idempotent: safe to run multiple times.
-- ──────────────────────────────────────────────────────────────────────────────

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- ── Listings ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS listings (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  vinted_url            TEXT NOT NULL UNIQUE,
  vinted_item_id        TEXT,
  title                 TEXT NOT NULL,
  list_price_eur        REAL NOT NULL,
  min_accept_price_eur  REAL NOT NULL,
  temu_url              TEXT,
  temu_variant          TEXT, -- JSON
  status                TEXT NOT NULL DEFAULT 'active'
                        CHECK(status IN ('active','paused','sold','archived')),
  dry_run               INTEGER NOT NULL DEFAULT 0,
  created_at            TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at            TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_listings_status ON listings(status);
CREATE INDEX IF NOT EXISTS idx_listings_vinted_item_id ON listings(vinted_item_id);

-- ── Chats ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS chats (
  id                      INTEGER PRIMARY KEY AUTOINCREMENT,
  vinted_conversation_id  TEXT NOT NULL UNIQUE,
  buyer_username          TEXT NOT NULL,
  last_message_at         TEXT,
  unread                  INTEGER NOT NULL DEFAULT 0,
  created_at              TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_chats_last_message_at ON chats(last_message_at DESC);

-- ── Messages ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS messages (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id           INTEGER NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  direction         TEXT NOT NULL CHECK(direction IN ('in','out')),
  body              TEXT NOT NULL,
  is_offer          INTEGER NOT NULL DEFAULT 0,
  offer_amount_eur  REAL,
  vinted_message_id TEXT UNIQUE,
  created_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_messages_chat_id ON messages(chat_id, created_at DESC);

-- ── Offers ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS offers (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  listing_id  INTEGER REFERENCES listings(id) ON DELETE SET NULL,
  chat_id     INTEGER NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  amount_eur  REAL NOT NULL,
  state       TEXT NOT NULL DEFAULT 'pending'
              CHECK(state IN ('pending','accepted','declined','expired')),
  decided_by  TEXT CHECK(decided_by IN ('auto','manual') OR decided_by IS NULL),
  decided_at  TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_offers_state ON offers(state);
CREATE INDEX IF NOT EXISTS idx_offers_listing ON offers(listing_id);

-- ── Sales ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sales (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  listing_id          INTEGER NOT NULL REFERENCES listings(id),
  offer_id            INTEGER REFERENCES offers(id),
  buyer_name          TEXT NOT NULL,
  buyer_address       TEXT, -- JSON
  shipping_label_url  TEXT,
  paid_at             TEXT,
  shipped_at          TEXT,
  created_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_sales_listing ON sales(listing_id);

-- ── Temu Batches ──────────────────────────────────────────────────────────────
-- A batch groups multiple sales that are added to the Temu cart together
-- (user ordering mode: one Temu checkout for many Vinted sales).
CREATE TABLE IF NOT EXISTS temu_batches (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  window_hours  INTEGER NOT NULL,       -- e.g. 24 / 48 / 72
  status        TEXT NOT NULL DEFAULT 'open'
                CHECK(status IN (
                  'open',         -- sales are being collected, cart not touched yet
                  'adding',       -- bot is walking the list and adding to cart
                  'cart_ready',   -- all items in cart, waiting for user to checkout
                  'placed',       -- user confirmed Temu checkout manually
                  'failed'        -- bot failed (partial/complete) before cart_ready
                )),
  started_at    TEXT,                   -- when bot started adding
  cart_ready_at TEXT,                   -- when bot finished adding
  placed_at     TEXT,                   -- when user marked as placed
  sale_count    INTEGER NOT NULL DEFAULT 0,
  total_eur     REAL,                   -- sum of item prices after add
  last_error    TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_temu_batches_status ON temu_batches(status);

-- ── Temu Orders ───────────────────────────────────────────────────────────────
-- One row per Vinted sale that needs Temu fulfillment. batch_id links it
-- to the Temu-batch it was fulfilled in (NULL while waiting in queue).
CREATE TABLE IF NOT EXISTS temu_orders (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  sale_id           INTEGER NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  batch_id          INTEGER REFERENCES temu_batches(id) ON DELETE SET NULL,
  temu_order_id     TEXT,       -- Temu's order id once user has paid
  state             TEXT NOT NULL DEFAULT 'queued'
                    CHECK(state IN (
                      'queued',   -- waiting to be added to a cart batch
                      'in_cart',  -- bot added to cart, awaiting user checkout
                      'placed',   -- user paid on Temu (whole batch)
                      'shipped',
                      'delivered',
                      'failed',
                      'cancelled'
                    )),
  amount_eur        REAL,
  tracking_number   TEXT,
  placed_at         TEXT,
  last_checked_at   TEXT,
  last_error        TEXT,
  idempotency_key   TEXT NOT NULL UNIQUE,
  created_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_temu_orders_state ON temu_orders(state);
CREATE INDEX IF NOT EXISTS idx_temu_orders_sale ON temu_orders(sale_id);
CREATE INDEX IF NOT EXISTS idx_temu_orders_batch ON temu_orders(batch_id);

-- ── Temu Crawler (product discovery) ──────────────────────────────────────────
-- Tracks products we've scraped from Temu to avoid duplicates.
-- One row per unique goods_id. The folder_name points to the
-- /Users/home/Desktop/Vinted/Neuer Ordner N/ directory where
-- Antigravity will later drop its generated photos.
CREATE TABLE IF NOT EXISTS crawled_products (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  temu_goods_id    TEXT NOT NULL UNIQUE,
  temu_url         TEXT NOT NULL,
  title            TEXT,
  price_eur        REAL,
  rating           REAL,              -- 0.0 to 5.0
  review_count     INTEGER,
  search_query     TEXT,              -- which preset/query found this
  description      TEXT,              -- long-form description from Temu detail page
  attributes_json  TEXT,               -- JSON dict of structured attributes
  folder_num       INTEGER,           -- N in "Neuer Ordner N"
  folder_path      TEXT,              -- absolute path
  queue_file_path  TEXT,              -- absolute path to _queue/N_input.json
  status           TEXT NOT NULL DEFAULT 'crawled'
                   CHECK(status IN (
                     'crawled',       -- images downloaded, awaiting Antigravity
                     'generating',    -- Antigravity is producing model shots
                     'ready',         -- all 5 generated images present
                     'listed',        -- posted to Vinted
                     'sold',
                     'archived'
                   )),
  last_error       TEXT,
  crawled_at       TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_crawled_status ON crawled_products(status);
CREATE INDEX IF NOT EXISTS idx_crawled_goods  ON crawled_products(temu_goods_id);

-- Crawler runs — audit log per run
CREATE TABLE IF NOT EXISTS crawler_runs (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  preset_name    TEXT,
  queries        TEXT,            -- JSON array of queries used
  filters        TEXT,            -- JSON of filter config at run time
  started_at     TEXT NOT NULL DEFAULT (datetime('now')),
  ended_at       TEXT,
  products_found INTEGER DEFAULT 0,
  products_kept  INTEGER DEFAULT 0,
  status         TEXT NOT NULL DEFAULT 'running'
                 CHECK(status IN ('running','success','partial','failed','cancelled')),
  error          TEXT
);

CREATE INDEX IF NOT EXISTS idx_crawler_runs_started ON crawler_runs(started_at DESC);

-- ── Bot Runs (audit log) ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bot_runs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  bot         TEXT NOT NULL CHECK(bot IN ('vinted','temu')),
  action      TEXT NOT NULL,
  started_at  TEXT NOT NULL DEFAULT (datetime('now')),
  ended_at    TEXT,
  outcome     TEXT CHECK(outcome IN ('success','failure','skipped') OR outcome IS NULL),
  error       TEXT
);

CREATE INDEX IF NOT EXISTS idx_bot_runs_started ON bot_runs(started_at DESC);

-- ── Settings (key-value) ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Seed defaults (INSERT OR IGNORE so migrations stay idempotent).
INSERT OR IGNORE INTO settings(key, value) VALUES
  ('paused', 'false'),
  ('vinted_poll_interval_s', '60'),
  ('temu_max_order_eur', '50'),
  ('temu_max_daily_orders', '10'),
  -- Batch-cart mode: bot collects sales over this window, user triggers
  -- add-to-cart + checkout manually.
  ('temu_batch_window_hours', '24'),
  -- Temu payment method the bot should pick at checkout. Values:
  --   paypal | bnpl30 | rechnung | karte
  -- Methods NOT listed (apple_pay, google_pay, sofort, pay_by_bank) require
  -- biometric / bank-login / 2FA interactions that cannot be automated.
  ('temu_payment_method', 'paypal');
