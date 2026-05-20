// ──────────────────────────────────────────────────────────────────────────────
// Listing price update via eBay Inventory API.
//
// eBay model: a listing is published from an "offer". To change the price we
// PATCH the offer with a new pricingSummary, then call publish again so eBay
// pushes the change to the live listing.
//
// Caller passes the eBay offerId. If only the listingId is known, the caller
// must first map it to an offerId via /sell/inventory/v1/offer?listing_id=...
// (we expose `findOfferIdByListing` below for convenience).
// ──────────────────────────────────────────────────────────────────────────────

import { createLogger } from '@vinted-system/shared';
import {
  ebayFetch,
  currencyOf,
  type EbayMarket,
} from '../auth/token.js';

const log = createLogger('ebay-update-price');

export interface UpdatePriceResult {
  ok: boolean;
  offerId?: string;
  error?: string;
}

/**
 * Look up the offerId for a published listingId. eBay returns at most one
 * active offer per listingId, so this is a 1:1 mapping for our purposes.
 */
export async function findOfferIdByListing(
  market: EbayMarket,
  listingId: string,
): Promise<string | null> {
  // Newer endpoint: GET /sell/inventory/v1/offer?listing_id=
  const r = await ebayFetch<{ offers?: Array<{ offerId: string; listing?: { listingId?: string } }> }>(
    market,
    'GET',
    `/sell/inventory/v1/offer?listing_id=${encodeURIComponent(listingId)}&limit=1`,
  );
  if (!r.ok || !r.data?.offers?.length) return null;
  return r.data.offers[0]?.offerId ?? null;
}

export async function updateListingPrice(
  market: EbayMarket,
  offerId: string,
  newPrice: number,
): Promise<UpdatePriceResult> {
  if (!offerId) return { ok: false, error: 'offerId required' };
  if (!Number.isFinite(newPrice) || newPrice <= 0) {
    return { ok: false, error: 'newPrice must be > 0' };
  }

  const body = {
    pricingSummary: {
      price: {
        value: newPrice.toFixed(2),
        currency: currencyOf(market),
      },
    },
  };

  const patch = await ebayFetch<unknown>(
    market,
    'PATCH',
    `/sell/inventory/v1/offer/${encodeURIComponent(offerId)}`,
    body,
  );
  if (!patch.ok) {
    log.warn('PATCH offer failed', { offerId, status: patch.status, error: patch.error });
    return { ok: false, offerId, error: patch.error };
  }

  // Re-publish to push the price change to the live listing.
  const pub = await ebayFetch<{ listingId: string }>(
    market,
    'POST',
    `/sell/inventory/v1/offer/${encodeURIComponent(offerId)}/publish`,
  );
  if (!pub.ok) {
    log.warn('re-publish after price patch failed', { offerId, error: pub.error });
    return { ok: false, offerId, error: pub.error };
  }

  log.info('price updated', { offerId, newPrice, market });
  return { ok: true, offerId };
}
