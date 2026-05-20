// ──────────────────────────────────────────────────────────────────────────────
// Shared TypeScript types — used by all workspace packages.
// ──────────────────────────────────────────────────────────────────────────────

export type BotName = 'vinted' | 'temu' | 'cj';

export interface VintedAccount {
  id: number;
  label: string;
  username: string | null;
  state_path: string;
  data_dir: string;
  active: number;       // 0 | 1 — SQLite boolean
  logged_in: number;    // 0 | 1
  last_login_at: string | null;
  created_at: string;
  /** Platform identity this account belongs to. ALTER-added column
   *  (default 'vinted') — see `shared/src/db.ts` ensureColumn migration.
   *  Must match a `PlatformId` from `shared/src/accounts.ts`. */
  marketplace?: string;
  /** Residential proxy URL for this account. NULL → direct connection. */
  proxy_url?: string | null;
}

export interface Listing {
  id: number;
  vinted_url: string;
  vinted_item_id: string | null;
  title: string;
  list_price_eur: number;
  min_accept_price_eur: number;
  temu_url: string | null;
  temu_variant: TemuVariant | null; // JSON-serialized
  status: 'active' | 'paused' | 'sold' | 'archived';
  dry_run: number; // 0 | 1 (SQLite boolean)
  created_at: string;
  updated_at: string;
}

export interface TemuVariant {
  // Whatever selectors/params are needed to pick the right Temu variant.
  // Kept flexible because Temu variant UIs differ per product.
  size?: string;
  color?: string;
  notes?: string;
  [key: string]: string | undefined;
}

export interface Chat {
  id: number;
  vinted_conversation_id: string;
  buyer_username: string;
  last_message_at: string;
  unread: number; // 0 | 1
  created_at: string;
}

export type MessageDirection = 'in' | 'out';

export interface ChatMessage {
  id: number;
  chat_id: number;
  direction: MessageDirection;
  body: string;
  is_offer: number; // 0 | 1
  offer_amount_eur: number | null;
  vinted_message_id: string | null;
  created_at: string;
}

export type OfferState = 'pending' | 'accepted' | 'declined' | 'countered' | 'expired';
export type OfferDecider = 'auto' | 'manual' | null;

export interface Offer {
  id: number;
  listing_id: number | null;
  chat_id: number;
  amount_eur: number;
  state: OfferState;
  decided_by: OfferDecider;
  decided_at: string | null;
  created_at: string;
}

export interface BuyerAddress {
  name: string;
  street: string;
  street2?: string;
  zip: string;
  city: string;
  country: string; // ISO 3166-1 alpha-2
  phone?: string;
}

export interface Sale {
  id: number;
  listing_id: number;
  offer_id: number | null;
  buyer_name: string;
  buyer_address: BuyerAddress | null; // JSON
  shipping_label_url: string | null;
  shipping_label_path: string | null;
  shipping_label_fetched_at: string | null;
  tracking_number: string | null;
  tracking_sent_at: string | null;
  feedback_left_at: string | null;
  paid_at: string | null;
  shipped_at: string | null;
  created_at: string;
}

export type TemuOrderState =
  | 'queued'     // waiting to be added to a batch
  | 'in_cart'    // bot added to cart, awaiting user checkout
  | 'placed'     // user paid on Temu
  | 'shipped'
  | 'delivered'
  | 'failed'
  | 'cancelled';

export interface TemuOrder {
  id: number;
  sale_id: number;
  batch_id: number | null;
  temu_order_id: string | null;
  state: TemuOrderState;
  amount_eur: number | null;
  tracking_number: string | null;
  placed_at: string | null;
  last_checked_at: string | null;
  last_error: string | null;
  idempotency_key: string; // = "sale-${sale_id}"
  created_at: string;
}

export type TemuBatchStatus = 'open' | 'adding' | 'cart_ready' | 'placed' | 'failed';

export interface TemuBatch {
  id: number;
  window_hours: number;
  status: TemuBatchStatus;
  started_at: string | null;
  cart_ready_at: string | null;
  placed_at: string | null;
  sale_count: number;
  total_eur: number | null;
  last_error: string | null;
  created_at: string;
}

// ── CJ Dropshipping Types ────────────────────────────────────────────────────

export type CJOrderState =
  | 'pending'      // sale detected, CJ order not yet placed
  | 'ordered'      // order placed via CJ API
  | 'shipping'     // CJ shipped, tracking number available
  | 'delivered'    // tracking shows delivered
  | 'failed'       // order failed
  | 'cancelled';

export interface CJOrder {
  id: number;
  sale_id: number;
  cj_order_id: string | null;
  cj_order_number: string | null;
  status: CJOrderState;
  tracking_number: string | null;
  logistic_name: string | null;
  cost_total_eur: number | null;
  ordered_at: string | null;
  shipped_at: string | null;
  delivered_at: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}

export interface CJProductMapping {
  id: number;
  folder_num: number;
  cj_product_id: string;
  cj_variant_id: string;
  cj_product_url: string | null;
  cost_eur: number | null;
  shipping_eur: number | null;
  warehouse: string; // 'CN' | 'DE' | 'US'
  created_at: string;
}

export interface BotRun {
  id: number;
  bot: BotName;
  action: string; // e.g. "poll_chats", "accept_offer", "place_order"
  started_at: string;
  ended_at: string | null;
  outcome: 'success' | 'failure' | 'skipped' | null;
  error: string | null;
}

export type TemuPaymentMethod = 'paypal' | 'bnpl30' | 'rechnung' | 'karte';

export interface Settings {
  paused: boolean;
  vinted_poll_interval_s: number;
  temu_max_order_eur: number;
  temu_max_daily_orders: number;
  temu_payment_method: TemuPaymentMethod;
  temu_batch_window_hours: number;
}

export type CrawledProductStatus =
  | 'crawled'
  | 'generating'
  | 'ready'
  | 'listed'
  | 'sold'
  | 'archived';

export interface CrawledProduct {
  id: number;
  temu_goods_id: string;
  temu_url: string;
  title: string | null;
  price_eur: number | null;
  rating: number | null;
  review_count: number | null;
  search_query: string | null;
  folder_num: number | null;
  folder_path: string | null;
  queue_file_path: string | null;
  status: CrawledProductStatus;
  last_error: string | null;
  crawled_at: string;
  updated_at: string;
}

export interface CrawlerFilters {
  min_rating: number;      // e.g. 4.0
  min_reviews: number;     // e.g. 50
  max_price_eur: number;   // e.g. 25
  max_per_query: number;   // e.g. 10
}

export interface CrawlerPreset {
  name: string;
  label: string;
  queries: string[];
  filters?: Partial<CrawlerFilters>;
}

export interface CrawlerRunSummary {
  id: number;
  preset_name: string | null;
  queries: string[];
  filters: CrawlerFilters | null;
  started_at: string;
  ended_at: string | null;
  products_found: number;
  products_kept: number;
  status: 'running' | 'success' | 'partial' | 'failed' | 'cancelled';
  error: string | null;
}
