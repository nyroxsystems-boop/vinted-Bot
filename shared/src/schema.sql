-- ──────────────────────────────────────────────────────────────────────────────
-- Vinted-System — SQLite schema
-- Idempotent: safe to run multiple times.
-- ──────────────────────────────────────────────────────────────────────────────

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- ── Vinted Accounts (multi-account support) ──────────────────────────────────
-- One row per Vinted login the user has added. Each account has its own
-- Playwright browser context (state_path) so sessions don't collide.
-- Every account-scoped table (listings, chats, sales, offers, auto_listings)
-- carries account_id as FK — accounts are isolated.
CREATE TABLE IF NOT EXISTS vinted_accounts (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  label          TEXT NOT NULL UNIQUE,      -- user-facing name ("Haupt-Account")
  username       TEXT,                       -- Vinted username, captured after login
  state_path     TEXT NOT NULL,              -- absolute path to Playwright state JSON
  data_dir       TEXT NOT NULL,              -- per-account data directory
  active         INTEGER NOT NULL DEFAULT 1, -- 0 = paused (pipeline skips it)
  logged_in      INTEGER NOT NULL DEFAULT 0,
  last_login_at  TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_accounts_active ON vinted_accounts(active);

-- Seed a default account (id = 1) so pre-existing data still has a home.
INSERT OR IGNORE INTO vinted_accounts (id, label, state_path, data_dir)
  VALUES (
    1,
    'Haupt-Account',
    '/Users/home/Vinted/system/data/accounts/1/state.json',
    '/Users/home/Vinted/system/data/accounts/1'
  );

-- ── Listings ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS listings (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id            INTEGER NOT NULL DEFAULT 1 REFERENCES vinted_accounts(id) ON DELETE CASCADE,
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
-- idx_listings_account is created in db.ts after the account_id column is
-- ensured via ensureColumn — putting it here blows up on old DBs that
-- predate the account_id column.

-- ── Chats ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS chats (
  id                      INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id              INTEGER NOT NULL DEFAULT 1 REFERENCES vinted_accounts(id) ON DELETE CASCADE,
  vinted_conversation_id  TEXT NOT NULL UNIQUE,
  buyer_username          TEXT NOT NULL,
  vinted_item_id          TEXT,  -- scraped from conversation header → enables Offer→Listing matching
  last_message_at         TEXT,
  unread                  INTEGER NOT NULL DEFAULT 0,
  created_at              TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_chats_last_message_at ON chats(last_message_at DESC);
-- idx_chats_account created in db.ts after ensureColumn (see comment above).

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
              CHECK(state IN ('pending','accepted','declined','countered','expired')),
  decided_by  TEXT CHECK(decided_by IN ('auto','manual') OR decided_by IS NULL),
  decided_at  TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_offers_state ON offers(state);
CREATE INDEX IF NOT EXISTS idx_offers_listing ON offers(listing_id);

-- ── Sales ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sales (
  id                         INTEGER PRIMARY KEY AUTOINCREMENT,
  listing_id                 INTEGER NOT NULL REFERENCES listings(id),
  offer_id                   INTEGER REFERENCES offers(id),
  buyer_name                 TEXT NOT NULL,
  buyer_address              TEXT, -- JSON
  shipping_label_url         TEXT,
  shipping_label_path        TEXT, -- absolute path to downloaded PDF
  shipping_label_fetched_at  TEXT,
  tracking_number            TEXT, -- from Temu order
  tracking_sent_at           TEXT, -- when we messaged it to buyer
  feedback_left_at           TEXT,
  paid_at                    TEXT,
  shipped_at                 TEXT,
  created_at                 TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_sales_listing ON sales(listing_id);
CREATE INDEX IF NOT EXISTS idx_sales_paid_at ON sales(paid_at);

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
-- /Users/home/Vinted/Neuer Ordner N/ directory where
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
                     'failed',        -- generation errored — queue entry kept for retry
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

-- ── CJ Auto-Discovery Queue ─────────────────────────────────────────────────
-- One row per CJ product the discovery worker has surfaced. Workflow:
--   queued     — found by search, not yet imported
--   importing  — image download + crawled_products row creation in progress
--   imported   — crawled_products row exists, hand-off to image-generator
--   skipped    — score too low / already in DB / blacklisted
--   failed     — import errored
CREATE TABLE IF NOT EXISTS cj_discovery_queue (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  cj_product_id    TEXT NOT NULL UNIQUE,
  cj_sku           TEXT,
  title            TEXT,
  category_id      TEXT,
  category_path    TEXT,            -- "Women > Dresses > Mini"
  cost_usd         REAL,
  cost_eur         REAL,
  image_url        TEXT,
  source_query     TEXT,            -- which discovery query found it
  score            REAL,            -- computed quality score (rating + price + margin)
  status           TEXT NOT NULL DEFAULT 'queued'
                   CHECK(status IN ('queued','importing','imported','skipped','failed')),
  skip_reason      TEXT,
  last_error       TEXT,
  crawled_product_id INTEGER REFERENCES crawled_products(id) ON DELETE SET NULL,
  discovered_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_discovery_status ON cj_discovery_queue(status);
CREATE INDEX IF NOT EXISTS idx_discovery_score  ON cj_discovery_queue(score DESC) WHERE status = 'queued';

-- ── Model Profiles (Sims-Builder) ───────────────────────────────────────────
-- One row per saved model. The "active" one is used by the image-generator
-- when producing Vinted lifestyle shots. `attributes_json` stores the picker
-- selections (skin_tone, hair_color, hair_style, face_shape, body_type,
-- age_range, aesthetic, ...) — building the prompt happens in
-- shared/src/model-builder.ts so identical selections produce identical prompts.
CREATE TABLE IF NOT EXISTS model_profiles (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  name                 TEXT NOT NULL,
  attributes_json      TEXT NOT NULL,
  reference_image_path TEXT,
  active               INTEGER NOT NULL DEFAULT 0,
  created_at           TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at           TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_model_profiles_active ON model_profiles(active) WHERE active = 1;

-- Discovery run log
CREATE TABLE IF NOT EXISTS cj_discovery_runs (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  queries       TEXT,            -- JSON array
  filter_json   TEXT,            -- JSON of price/category/score filters
  raw_found     INTEGER,
  imported      INTEGER,
  skipped       INTEGER,
  errors        INTEGER,
  started_at    TEXT NOT NULL DEFAULT (datetime('now')),
  ended_at      TEXT
);

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

-- ── Auto-Listings (generated Vinted listing drafts) ──────────────────────────
-- Created automatically by the listing-watcher when a crawled_product reaches
-- status 'ready' (= Antigravity has produced the model photos).
-- Status lifecycle: draft → approved → publishing → published | failed
CREATE TABLE IF NOT EXISTS auto_listings (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id            INTEGER NOT NULL DEFAULT 1 REFERENCES vinted_accounts(id) ON DELETE CASCADE,
  folder_num            INTEGER NOT NULL,
  crawled_product_id    INTEGER REFERENCES crawled_products(id) ON DELETE SET NULL,

  -- Vinted listing fields
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

  -- Shipping
  shipping_method       TEXT NOT NULL DEFAULT 'Hermes S',

  -- Generated photos (JSON array of absolute paths)
  photo_paths_json      TEXT NOT NULL DEFAULT '[]',

  -- Source link (carried over from crawled_products so the listing row
  -- alone is sufficient for the purchase-queue view).
  temu_url              TEXT,

  -- Vinted post result
  vinted_url            TEXT,            -- URL of the published listing
  vinted_item_id        TEXT,            -- Vinted's item ID

  -- Status
  status                TEXT NOT NULL DEFAULT 'raw'
                        CHECK(status IN (
                          'raw',         -- no generated photos yet (model+scene+product missing) — won't publish
                          'draft',       -- photos ready, auto-generated text, awaiting user review
                          'approved',    -- user approved, ready to publish (REQUIRES generated photos)
                          'publishing',  -- bot is uploading to Vinted
                          'published',   -- live on Vinted
                          'failed'       -- publish attempt failed
                        )),
  last_error            TEXT,
  created_at            TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at            TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_auto_listings_status ON auto_listings(status);
CREATE INDEX IF NOT EXISTS idx_auto_listings_folder ON auto_listings(folder_num);
-- idx_auto_listings_account created in db.ts after ensureColumn.

-- ── Bot Runs (audit log) ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bot_runs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  bot         TEXT NOT NULL CHECK(bot IN ('vinted','temu','cj')),
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
  -- Auto-listing: whether the watcher should auto-approve drafts (skip review)
  ('auto_listing_auto_approve', 'true'),
  -- Fulfillment automation
  ('auto_fetch_shipping_label', 'true'),
  ('auto_send_tracking_to_buyer', 'true'),
  ('auto_leave_feedback', 'true'),
  ('auto_feedback_template',
    'Super Käufer:in, alles reibungslos! Gerne wieder 💕'),
  ('auto_repricing_enabled', 'true'),
  -- Image generator:
  --   copy_source  → use Temu source images as-is (fast, but not stylized)
  --   antigravity  → wait for external Antigravity agent (legacy)
  --   gemini       → call Gemini image API (requires GEMINI_API_KEY)
  ('image_gen_mode', 'copy_source'),
  ('image_gen_max_per_cycle', '3');


-- ── Multi-Marketplace ─────────────────────────────────────────────────────────
-- Plattform-Listings: 1 Produkt-Folder kann auf N Plattformen gleichzeitig live
-- sein. external_id = Listing-ID auf der Zielplattform.
CREATE TABLE IF NOT EXISTS marketplace_listings (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  marketplace     TEXT NOT NULL CHECK(marketplace IN ('vinted','kleinanzeigen','mercari','depop','wallapop','ebay_de','ebay_uk','etsy','grailed','fb_marketplace')),
  account_id      INTEGER NOT NULL DEFAULT 1,
  folder_num      INTEGER NOT NULL,
  external_id     TEXT,                        -- Listing-ID auf der Plattform
  external_url    TEXT,
  status          TEXT NOT NULL DEFAULT 'active'
                  CHECK(status IN ('draft','publishing','active','sold','deactivated','failed')),
  list_price_eur  REAL NOT NULL,
  views           INTEGER NOT NULL DEFAULT 0,
  likes           INTEGER NOT NULL DEFAULT 0,
  messages        INTEGER NOT NULL DEFAULT 0,
  last_error      TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_mp_listings_folder    ON marketplace_listings(folder_num);
CREATE INDEX IF NOT EXISTS idx_mp_listings_marketplace ON marketplace_listings(marketplace, status);
-- NOTE: the folder-based UNIQUE was replaced by an external-id-based UNIQUE
-- in db.ts migrations. Keeping CREATE UNIQUE here on (marketplace, account_id,
-- folder_num) crashes on DBs that legitimately have multiple rows per folder
-- (re-list history). The real UNIQUE on (marketplace, account_id, external_id
-- WHERE external_id IS NOT NULL) is installed by runMigrations() below.

-- Inventory-Lock: 1 physisches Item → wird gesperrt sobald irgendwo verkauft.
-- Andere Bots prüfen vor Aktion `is_sold = 1` und deaktivieren sich selbst.
CREATE TABLE IF NOT EXISTS inventory_locks (
  folder_num   INTEGER PRIMARY KEY,
  is_sold      INTEGER NOT NULL DEFAULT 0,
  sold_on      TEXT,                              -- 'vinted' | 'kleinanzeigen' | ...
  sold_price_eur REAL,
  sold_at      TEXT,
  buyer_ref    TEXT,
  notes        TEXT,
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Performance-Tracker: pro Listing pro Tag Snapshot
CREATE TABLE IF NOT EXISTS listing_metrics (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  marketplace_listing_id INTEGER NOT NULL,
  date                  TEXT NOT NULL,            -- YYYY-MM-DD
  views                 INTEGER NOT NULL DEFAULT 0,
  likes                 INTEGER NOT NULL DEFAULT 0,
  messages              INTEGER NOT NULL DEFAULT 0,
  offers                INTEGER NOT NULL DEFAULT 0,
  recorded_at           TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_listing_metrics_lid_date
  ON listing_metrics(marketplace_listing_id, date);

-- Per-Account Proxy + Marketplace
-- Spalten werden via ensureColumn() in db.ts nachgezogen, hier nur Doku.
-- ALTER TABLE vinted_accounts ADD COLUMN proxy_url TEXT;
-- ALTER TABLE vinted_accounts ADD COLUMN marketplace TEXT NOT NULL DEFAULT 'vinted';

-- ── Repricing Log ──────────────────────────────────────────────────────────
-- Audit-Trail für jeden automatischen Preis-Drop. Auch für UI sichtbar.
CREATE TABLE IF NOT EXISTS repricing_log (
  id                      INTEGER PRIMARY KEY AUTOINCREMENT,
  marketplace_listing_id  INTEGER NOT NULL,
  marketplace             TEXT NOT NULL,
  folder_num              INTEGER NOT NULL,
  old_price_eur           REAL NOT NULL,
  new_price_eur           REAL NOT NULL,
  pct_change              REAL NOT NULL,        -- e.g. -10 means -10%
  reason                  TEXT NOT NULL,         -- 'idle' | 'low-views' | 'manual'
  outcome                 TEXT NOT NULL DEFAULT 'pending'
                          CHECK(outcome IN ('pending','applied','failed','skipped-floor','skipped-not-implemented')),
  error                   TEXT,
  applied_at              TEXT,
  created_at              TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_repricing_log_listing
  ON repricing_log(marketplace_listing_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_repricing_log_folder
  ON repricing_log(folder_num, created_at DESC);

-- ── Reply Autopilot Log ───────────────────────────────────────────────────
-- Audit + Review-Queue für LLM-generierte Antworten.
CREATE TABLE IF NOT EXISTS reply_autopilot_log (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id         INTEGER NOT NULL,
  message_id      INTEGER,                          -- zugeordnete eingehende Message
  intent          TEXT NOT NULL,                    -- size|shipping|negotiation|smalltalk|other
  in_text         TEXT NOT NULL,
  draft_text      TEXT NOT NULL,
  mode            TEXT NOT NULL DEFAULT 'draft'
                  CHECK(mode IN ('draft','auto')),
  status          TEXT NOT NULL DEFAULT 'pending'
                  CHECK(status IN ('pending','sent','rejected','edited','failed')),
  send_attempted_at TEXT,
  sent_at         TEXT,
  error           TEXT,
  meta_json       TEXT,                             -- Listing-Context, Confidence etc.
  scheduled_send_at TEXT,                            -- When auto-send should fire (10-15min jitter for human-like cadence)
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_reply_log_status ON reply_autopilot_log(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reply_log_chat ON reply_autopilot_log(chat_id, created_at DESC);

-- ── Kleinanzeigen Chats + Messages ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS kleinanzeigen_chats (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id          INTEGER NOT NULL DEFAULT 1,
  ka_conversation_id  TEXT NOT NULL UNIQUE,
  buyer_username      TEXT NOT NULL,
  ad_title            TEXT,
  ad_url              TEXT,
  last_message_at     TEXT,
  unread              INTEGER NOT NULL DEFAULT 0,
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ka_chats_last_msg ON kleinanzeigen_chats(last_message_at DESC);
CREATE INDEX IF NOT EXISTS idx_ka_chats_account ON kleinanzeigen_chats(account_id);

CREATE TABLE IF NOT EXISTS kleinanzeigen_messages (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id           INTEGER NOT NULL REFERENCES kleinanzeigen_chats(id) ON DELETE CASCADE,
  direction         TEXT NOT NULL CHECK(direction IN ('in','out')),
  body              TEXT NOT NULL,
  is_offer          INTEGER NOT NULL DEFAULT 0,
  offer_amount_eur  REAL,
  ka_message_id     TEXT,
  created_at        TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ka_messages_chat ON kleinanzeigen_messages(chat_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_ka_messages_extid ON kleinanzeigen_messages(ka_message_id) WHERE ka_message_id IS NOT NULL;

-- ── Depop Chats + Messages + Offers ───────────────────────────────────────────
-- Depop has no API, so the bot polls the inbox via Playwright. Schema mirrors
-- the kleinanzeigen tables 1:1 so reply-autopilot + chat-UI can reuse the same
-- code path with just a marketplace filter.
CREATE TABLE IF NOT EXISTS depop_chats (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id           INTEGER NOT NULL DEFAULT 1,
  depop_conversation_id TEXT NOT NULL UNIQUE,
  buyer_username       TEXT NOT NULL,
  ad_title             TEXT,
  ad_url               TEXT,
  ad_product_id        TEXT,
  last_message_at      TEXT,
  unread               INTEGER NOT NULL DEFAULT 0,
  created_at           TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at           TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_depop_chats_last_msg ON depop_chats(last_message_at DESC);
CREATE INDEX IF NOT EXISTS idx_depop_chats_account ON depop_chats(account_id);

CREATE TABLE IF NOT EXISTS depop_messages (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id           INTEGER NOT NULL REFERENCES depop_chats(id) ON DELETE CASCADE,
  direction         TEXT NOT NULL CHECK(direction IN ('in','out')),
  body              TEXT NOT NULL,
  is_offer          INTEGER NOT NULL DEFAULT 0,
  offer_amount_gbp  REAL,
  offer_amount_eur  REAL,
  offer_state       TEXT CHECK(offer_state IN ('pending','accepted','declined','expired')),
  depop_message_id  TEXT,
  created_at        TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_depop_messages_chat ON depop_messages(chat_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_depop_messages_extid ON depop_messages(depop_message_id) WHERE depop_message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_depop_messages_offers ON depop_messages(is_offer, offer_state) WHERE is_offer = 1;

-- ── CJ Dropshipping: Product Mapping ──────────────────────────────────────────
-- Maps folder_num (= product) to CJ product + variant IDs.
-- One folder can have multiple variants (sizes) but typically one main link.
CREATE TABLE IF NOT EXISTS cj_products (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  folder_num      INTEGER NOT NULL,
  cj_product_id   TEXT NOT NULL,
  cj_variant_id   TEXT NOT NULL,
  cj_product_url  TEXT,
  cost_eur        REAL,
  shipping_eur    REAL,
  warehouse       TEXT NOT NULL DEFAULT 'CN'
                  CHECK(warehouse IN ('CN','DE','US','NL','PL','UK')),
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_cj_products_folder ON cj_products(folder_num);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_cj_products_folder_variant
  ON cj_products(folder_num, cj_variant_id);

-- ── CJ Dropshipping: Orders ───────────────────────────────────────────────────
-- One row per sale fulfilled via CJ API. Replaces temu_orders for new orders.
CREATE TABLE IF NOT EXISTS cj_orders (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  sale_id         INTEGER NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  cj_order_id     TEXT,
  cj_order_number TEXT,
  status          TEXT NOT NULL DEFAULT 'pending'
                  CHECK(status IN (
                    'pending',     -- awaiting CJ API call
                    'ordered',     -- API call succeeded
                    'shipping',    -- tracking number received
                    'delivered',   -- confirmed delivery
                    'failed',      -- order failed
                    'cancelled'
                  )),
  tracking_number TEXT,
  logistic_name   TEXT,
  cost_total_eur  REAL,
  ordered_at      TEXT,
  shipped_at      TEXT,
  delivered_at    TEXT,
  error           TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_cj_orders_sale ON cj_orders(sale_id);
CREATE INDEX IF NOT EXISTS idx_cj_orders_status ON cj_orders(status);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_cj_orders_sale ON cj_orders(sale_id);

-- ── Cross-Sync Log ────────────────────────────────────────────────────────────
-- Tracks which sales have been cross-synced (deactivated on other platforms).
-- Prevents re-processing the same sale and provides audit trail.
CREATE TABLE IF NOT EXISTS cross_sync_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  sale_id     INTEGER NOT NULL,
  folder_num  INTEGER NOT NULL,
  marketplace TEXT NOT NULL,
  external_id TEXT,
  status      TEXT NOT NULL DEFAULT 'pending'
              CHECK(status IN ('pending', 'deactivated', 'failed', 'no_others')),
  error       TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_cross_sync_sale ON cross_sync_log(sale_id);
CREATE INDEX IF NOT EXISTS idx_cross_sync_folder ON cross_sync_log(folder_num);

-- ── Account Metrics (per-account daily snapshot) ────────────────────────────
-- One row per (account_id, date). Captures Vinted profile stats (followers,
-- rating, wallet, verified, warnings) plus daily aggregates (views, likes,
-- messages, sales, revenue) so the dashboard can show "How is this account
-- doing today?" without expensive joins on every page load.
--
-- profile_* fields can be NULL if the scrape failed (rate-limited, captcha,
-- network error). Aggregate fields default to 0 so the worker can always
-- write a row even without a successful profile scrape.
CREATE TABLE IF NOT EXISTS account_metrics (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id      INTEGER NOT NULL REFERENCES vinted_accounts(id) ON DELETE CASCADE,
  date            TEXT NOT NULL,           -- YYYY-MM-DD
  followers       INTEGER,
  following       INTEGER,
  rating_avg      REAL,                    -- 0.0 to 5.0
  rating_count    INTEGER,
  wallet_eur      REAL,
  verified        INTEGER NOT NULL DEFAULT 0,
  warnings_json   TEXT,                    -- JSON array: ["captcha_hit_2026-05-19", "rate_limit_hit_2026-05-19"]
  views_today     INTEGER DEFAULT 0,       -- aggregiert aus listing_metrics
  likes_today     INTEGER DEFAULT 0,
  messages_today  INTEGER DEFAULT 0,
  sales_today     INTEGER DEFAULT 0,
  revenue_today_eur REAL DEFAULT 0,
  recorded_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_account_metrics_date ON account_metrics(account_id, date);
CREATE INDEX IF NOT EXISTS idx_account_metrics_account ON account_metrics(account_id, date DESC);

-- ── Vinted Trends (sourcing input) ──────────────────────────────────────────
-- Scraped from Vinted's own search/catalog pages so CJ-Discovery can target
-- what Vinted-buyers actually want (instead of what CJ ranks as "popular").
--
-- Workflow:
--   1. vinted-trend-scraper polls top-brands / top-searches / hot-hashtags
--      via the user's own logged-in Vinted session (human-behavior-layer)
--   2. Each trend gets translated DE → EN search-query via LLM (cached)
--   3. cj-discovery picks high-rank trends with no recent `last_used_at`,
--      fires the cj_query against CJ-Search, imports matches
--
-- The (keyword, locale, date(scraped_at)) UNIQUE means we keep at most one
-- snapshot per keyword per day → re-scrapes are idempotent.
CREATE TABLE IF NOT EXISTS vinted_trends (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  trend_type      TEXT NOT NULL CHECK(trend_type IN ('search','brand','category','hashtag')),
  keyword         TEXT NOT NULL,             -- raw keyword as seen on Vinted ("Y2K crop top", "Zara")
  locale          TEXT NOT NULL DEFAULT 'de',
  rank            INTEGER,                    -- 1 = top, NULL if unranked
  popularity      REAL,                       -- 0-1 normalized within snapshot
  category_path   TEXT,                       -- "Women > Dresses > Mini" (when scoped)
  source_url      TEXT,                       -- vinted.de URL we scraped
  cj_query        TEXT,                       -- LLM-translated CJ-Search keyword (EN, lowercased)
  cj_filter_json  TEXT,                       -- optional category/price hints for CJ
  last_used_at    TEXT,                       -- when this trend last triggered a CJ-Discovery run
  imported_count  INTEGER NOT NULL DEFAULT 0, -- how many products we've imported off this trend
  metadata_json   TEXT,                       -- raw scrape payload for debugging
  scraped_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_vinted_trends_scraped ON vinted_trends(scraped_at DESC);
CREATE INDEX IF NOT EXISTS idx_vinted_trends_keyword ON vinted_trends(keyword, locale);
CREATE INDEX IF NOT EXISTS idx_vinted_trends_type_rank ON vinted_trends(trend_type, rank);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_vinted_trends_kw_locale_date
  ON vinted_trends(keyword, locale, date(scraped_at));

-- ── eBay Per-Account OAuth Tokens ────────────────────────────────────────────
-- Per-account OAuth-Tokens for eBay-DE/UK. Each eBay account-identity has
-- its own client_id/secret/refresh_token + cached access_token. The bot
-- looks up by (account_id, marketplace) so the 10 eBay-accounts each have
-- their own login. Fallback to settings-level (legacy single-credential)
-- stays for back-compat.
CREATE TABLE IF NOT EXISTS ebay_account_tokens (
  account_id     INTEGER NOT NULL REFERENCES vinted_accounts(id) ON DELETE CASCADE,
  marketplace    TEXT NOT NULL CHECK(marketplace IN ('ebay_de','ebay_uk')),
  client_id      TEXT,
  client_secret  TEXT,
  refresh_token  TEXT,
  access_token   TEXT,
  access_expires_at TEXT,
  scopes         TEXT,
  updated_at     TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (account_id, marketplace)
);

-- ── CJ API-Call Quota Tracking ───────────────────────────────────────────────
-- Counts ALL CJ-API-calls (Discovery + Orders + Tracking + Inventory) per day
-- against the 1000/day quota. Each call-site bumps `count` via INSERT … ON
-- CONFLICT update. /health/deep + Dashboard read this to warn at 80% used.
CREATE TABLE IF NOT EXISTS cj_api_calls (
  date         TEXT PRIMARY KEY,           -- YYYY-MM-DD
  count        INTEGER NOT NULL DEFAULT 0,
  last_call_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ── Refund / Dispute Workflow ────────────────────────────────────────────────
-- Tracks Käufer-Reklamationen. When the buyer reports "Ware kam nicht an" or
-- "falsche Größe", the workflow opens a dispute, optionally requests a CJ
-- refund, refunds the Vinted-buyer, and closes the case.
CREATE TABLE IF NOT EXISTS refund_disputes (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  sale_id         INTEGER NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  account_id      INTEGER REFERENCES vinted_accounts(id) ON DELETE SET NULL,
  reason          TEXT NOT NULL CHECK(reason IN ('not_arrived','wrong_size','damaged','not_as_described','other')),
  status          TEXT NOT NULL DEFAULT 'open'
                  CHECK(status IN ('open','awaiting_cj','refunded_buyer','closed','rejected')),
  buyer_message   TEXT,
  customer_evidence_url TEXT,        -- screenshot/photo proving the issue
  refund_eur      REAL,
  cj_refund_id    TEXT,
  resolution_note TEXT,
  opened_at       TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at     TEXT
);
CREATE INDEX IF NOT EXISTS idx_refund_disputes_sale ON refund_disputes(sale_id);
CREATE INDEX IF NOT EXISTS idx_refund_disputes_status ON refund_disputes(status, opened_at DESC);

-- ── Variant Conversion Stats (A/B testing input) ─────────────────────────────
-- Per LLM-generated variant: how it performed in the wild. Used by
-- variant-generator to prefer winning variants when generating new listings.
-- Computed nightly by conversion-tracker worker.
CREATE TABLE IF NOT EXISTS variant_conversion_stats (
  variant_id      INTEGER PRIMARY KEY REFERENCES auto_listing_variants(id) ON DELETE CASCADE,
  marketplace     TEXT NOT NULL,
  listings_count  INTEGER NOT NULL DEFAULT 0,    -- how many auto_listings used this variant style
  total_views     INTEGER NOT NULL DEFAULT 0,
  total_likes     INTEGER NOT NULL DEFAULT 0,
  total_messages  INTEGER NOT NULL DEFAULT 0,
  total_sales     INTEGER NOT NULL DEFAULT 0,
  total_revenue   REAL NOT NULL DEFAULT 0,
  conversion_rate REAL,                            -- sales / max(listings, 1)
  message_rate    REAL,                            -- messages / max(views, 1)
  computed_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_variant_stats_conversion
  ON variant_conversion_stats(marketplace, conversion_rate DESC);

-- ── Account Health Events (per-account log) ──────────────────────────────────
-- One row per detected health-event (CAPTCHA, rate-limit, session-loss,
-- shadowban-signal, proxy-down). Worker reads recent events to decide
-- if an account should auto-pause.
CREATE TABLE IF NOT EXISTS account_health_events (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id    INTEGER NOT NULL REFERENCES vinted_accounts(id) ON DELETE CASCADE,
  event_type    TEXT NOT NULL CHECK(event_type IN (
                  'captcha','rate_limit','session_lost','proxy_down',
                  'shadowban_signal','login_blocked','quota_exhausted','ok'
                )),
  severity      TEXT NOT NULL DEFAULT 'warn' CHECK(severity IN ('info','warn','error','critical')),
  message       TEXT,
  context_json  TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_health_events_account_time
  ON account_health_events(account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_health_events_severity
  ON account_health_events(severity, created_at DESC) WHERE severity IN ('error','critical');

-- ── Brand Models (rotation set) ──────────────────────────────────────────────
-- Multiple model profiles can be ACTIVE at once. Image-generator rotates
-- through active models so Vinted's image-hash-detection doesn't see the
-- same face on 200+ listings → ban-risk. `weight` controls rotation share.
-- Existing `model_profiles.active` becomes a "primary" hint (default model
-- when listing-id % count picks this slot); `weight` (added via migration)
-- balances how often each is picked.
