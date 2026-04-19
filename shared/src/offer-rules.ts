// ──────────────────────────────────────────────────────────────────────────────
// Pure offer-evaluation logic. Shared between vinted-bot and orchestrator so
// both can agree on "what would auto-accept do here?" without cross-package
// imports.
// ──────────────────────────────────────────────────────────────────────────────

import { getDb, isPaused } from './db.js';
import type { Listing, Offer } from './types.js';

export type EvalDecision =
  | { action: 'auto-accept'; reason: string }
  | { action: 'auto-decline'; reason: string }
  | { action: 'review'; reason: string };

export function evaluateOffer(offer: Offer): EvalDecision {
  if (isPaused()) return { action: 'review', reason: 'System paused' };
  if (offer.listing_id === null) return { action: 'review', reason: 'No listing linked to offer' };

  const listing = getDb()
    .prepare('SELECT * FROM listings WHERE id = ?')
    .get(offer.listing_id) as Listing | undefined;
  if (!listing) return { action: 'review', reason: 'Listing not found' };
  if (listing.dry_run === 1) return { action: 'review', reason: 'Listing in dry-run mode' };
  if (listing.status !== 'active') {
    return { action: 'review', reason: `Listing status is ${listing.status}` };
  }
  if (offer.amount_eur >= listing.min_accept_price_eur) {
    return {
      action: 'auto-accept',
      reason: `€${offer.amount_eur} ≥ €${listing.min_accept_price_eur} (min)`,
    };
  }
  return {
    action: 'review',
    reason: `€${offer.amount_eur} below min €${listing.min_accept_price_eur}`,
  };
}

export function loadPendingOffers(): Offer[] {
  return getDb()
    .prepare("SELECT * FROM offers WHERE state = 'pending' ORDER BY created_at ASC")
    .all() as Offer[];
}

export function markOfferDecided(
  offerId: number,
  state: 'accepted' | 'declined',
  decidedBy: 'auto' | 'manual',
): void {
  getDb()
    .prepare(
      `UPDATE offers
         SET state = ?, decided_by = ?, decided_at = datetime('now')
       WHERE id = ?`,
    )
    .run(state, decidedBy, offerId);
}
