// ──────────────────────────────────────────────────────────────────────────────
// SSE event types — what the orchestrator streams to the dashboard.
// ──────────────────────────────────────────────────────────────────────────────

import type { BotName, Offer, TemuOrder, ChatMessage } from './types.js';

export type SystemEvent =
  | { type: 'bot.status'; bot: BotName; status: 'idle' | 'running' | 'paused' | 'error'; message?: string }
  | { type: 'bot.log'; bot: BotName; level: 'info' | 'warn' | 'error'; message: string; ts: string }
  | { type: 'offer.new'; offer: Offer }
  | { type: 'offer.decided'; offer: Offer }
  | { type: 'message.new'; message: ChatMessage }
  | { type: 'temu_order.updated'; order: TemuOrder }
  | { type: 'settings.updated'; key: string; value: string }
  | { type: 'alert'; level: 'warn' | 'error'; message: string };
