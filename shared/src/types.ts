// ──────────────────────────────────────────────────────────────────────────────
// Shared TypeScript types — used by all workspace packages.
// ──────────────────────────────────────────────────────────────────────────────

export type BotName = 'vinted' | 'temu';

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

export type OfferState = 'pending' | 'accepted' | 'declined' | 'expired';
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
