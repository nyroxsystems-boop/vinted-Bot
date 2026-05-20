// ──────────────────────────────────────────────────────────────────────────────
// Buyer-question / Q&A polling.
//
// NOTE — eBay does NOT expose a public REST API for member messages. The old
// Trading API has `GetMemberMessages` but it requires a separate set of OAuth
// scopes and ships XML, not JSON. To keep the bot minimum-viable we expose a
// stub that returns an empty conversation list and logs a structured TODO so
// the orchestrator can surface it in the dashboard.
//
// When eBay ships a proper REST equivalent (or when we wire up the Trading-API
// XML path), this is the only file to change.
// ──────────────────────────────────────────────────────────────────────────────

import { createLogger } from '@vinted-system/shared';
import { hasCredentials, type EbayMarket } from '../auth/token.js';

const log = createLogger('ebay-messages-poll');

export interface MessageThread {
  threadId: string;
  buyerUsername: string;
  itemId?: string;
  lastMessageAt: string;
  lastMessageBody: string;
  unread: boolean;
}

export interface PollResult {
  ok: boolean;
  market: EbayMarket;
  threads: MessageThread[];
  note?: string;
  error?: string;
}

export async function pollMessages(market: EbayMarket): Promise<PollResult> {
  if (!hasCredentials(market)) {
    return {
      ok: false,
      market,
      threads: [],
      error: 'eBay credentials not configured',
    };
  }

  // TODO: integrate GetMemberMessages from Trading API (XML).
  // See https://developer.ebay.com/devzone/xml/docs/reference/ebay/getmembermessages.html
  // For MVP we return empty so the orchestrator chat-aggregator
  // doesn't error and the Dashboard simply shows "0 unread".
  log.info('messages poll stub — returning empty thread list', { market });
  return {
    ok: true,
    market,
    threads: [],
    note: 'eBay Q&A polling not yet implemented (requires Trading API + XML scopes)',
  };
}

// ── Send Q&A response ────────────────────────────────────────────────────────
// AddMemberMessageAAQToPartner / AddMemberMessageRTQ would be the Trading-API
// calls. Until that's wired up we accept the request but report not-implemented
// so callers don't silently believe the reply was sent.

export interface SendResult {
  ok: boolean;
  threadId: string;
  error?: string;
  note?: string;
}

export async function sendMessage(
  market: EbayMarket,
  threadId: string,
  _body: string,
): Promise<SendResult> {
  if (!hasCredentials(market)) {
    return { ok: false, threadId, error: 'eBay credentials not configured' };
  }
  if (!threadId) return { ok: false, threadId, error: 'threadId required' };

  log.warn('sendMessage stub — eBay Q&A reply not implemented', { market, threadId });
  return {
    ok: false,
    threadId,
    error: 'not_implemented',
    note: 'eBay Q&A reply requires Trading-API XML path — not yet wired up',
  };
}
