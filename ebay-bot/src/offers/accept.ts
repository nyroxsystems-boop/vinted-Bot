// ──────────────────────────────────────────────────────────────────────────────
// Best-Offer accept/decline via eBay Negotiation API.
//
// eBay supports two flavours of offers:
//   1. Best-Offer (buyer-initiated)  — managed by /sell/negotiation/v1
//   2. Seller-initiated offers      — same API, different action
//
// Both flows use POST /sell/negotiation/v1/offer/{offerId}/send_offer_action
// with action = ACCEPT_OFFER | DECLINE_OFFER | COUNTER_OFFER.
//
// Reference:
//   https://developer.ebay.com/api-docs/sell/negotiation/overview.html
// ──────────────────────────────────────────────────────────────────────────────

import { createLogger } from '@vinted-system/shared';
import { ebayFetch, type EbayMarket } from '../auth/token.js';

const log = createLogger('ebay-offer-action');

export interface OfferActionResult {
  ok: boolean;
  offerId: string;
  error?: string;
}

async function sendAction(
  market: EbayMarket,
  offerId: string,
  action: 'ACCEPT_OFFER' | 'DECLINE_OFFER',
  reason?: string,
): Promise<OfferActionResult> {
  if (!offerId) return { ok: false, offerId, error: 'offerId required' };

  const body: Record<string, unknown> = { action };
  if (action === 'DECLINE_OFFER' && reason) {
    body.declineReason = reason; // e.g. 'PRICE_TOO_LOW'
  }

  const r = await ebayFetch<unknown>(
    market,
    'POST',
    `/sell/negotiation/v1/offer/${encodeURIComponent(offerId)}/send_offer_action`,
    body,
  );

  if (!r.ok) {
    log.warn('negotiation action failed', { offerId, action, status: r.status, error: r.error });
    return { ok: false, offerId, error: r.error };
  }

  log.info('negotiation action ok', { offerId, action, market });
  return { ok: true, offerId };
}

export async function acceptOffer(market: EbayMarket, offerId: string): Promise<OfferActionResult> {
  return sendAction(market, offerId, 'ACCEPT_OFFER');
}

export async function declineOffer(
  market: EbayMarket,
  offerId: string,
  reason = 'PRICE_TOO_LOW',
): Promise<OfferActionResult> {
  return sendAction(market, offerId, 'DECLINE_OFFER', reason);
}
