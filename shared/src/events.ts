// ──────────────────────────────────────────────────────────────────────────────
// SSE event types — what the orchestrator streams to the dashboard.
// ──────────────────────────────────────────────────────────────────────────────

import type { BotName, Offer, TemuOrder, ChatMessage } from './types.js';

export type SystemEvent =
  | { type: 'bot.status'; bot: BotName; status: 'idle' | 'running' | 'paused' | 'error'; message?: string }
  | { type: 'bot.log'; bot: BotName; level: 'info' | 'warn' | 'error'; message: string; ts: string }
  | { type: 'offer.new'; offer: Offer }
  | { type: 'offer.created'; amount: number; buyer: string; listing: string }
  | { type: 'offer.decided'; offer: Offer; decision?: string; amount?: number; listing?: string; by?: string }
  | { type: 'message.new'; message: ChatMessage }
  | { type: 'sale.created'; amount: number; buyer: string; listing: string }
  | { type: 'tracking.sent'; saleId: number; tracking: string }
  | { type: 'temu_order.updated'; order: TemuOrder }
  | { type: 'settings.updated'; key: string; value: string }
  | { type: 'bot.error'; bot: string; error: string }
  | { type: 'alert'; level: 'warn' | 'error'; message: string };
