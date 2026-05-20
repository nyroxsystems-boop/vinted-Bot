// ──────────────────────────────────────────────────────────────────────────────
// Offer evaluation engine — 4-tier decision system.
//
// Tier 1: AUTO-ACCEPT   → offer ≥ min_accept_price → instant accept
// Tier 2: AUTO-COUNTER  → offer within €2 of min → send counter-offer message
// Tier 3: AUTO-DECLINE  → offer < 50% of list_price → lowball protection
// Tier 4: MANUAL REVIEW → everything else → dashboard notification
//
// Shared between vinted-bot and orchestrator so both can agree on decisions.
// ──────────────────────────────────────────────────────────────────────────────

import { getDb, isPaused, getSetting } from './db.js';
import type { Listing, Offer } from './types.js';

export type EvalDecision =
  | { action: 'auto-accept'; reason: string }
  | { action: 'auto-counter'; reason: string; counterAmount: number; counterMessage: string }
  | { action: 'auto-decline'; reason: string }
  | { action: 'review'; reason: string };

// ── Configurable thresholds ──────────────────────────────────────────────────
// How close (in €) must an offer be to min_accept_price to trigger a counter?
const COUNTER_THRESHOLD_EUR = 2.00;
// Below what % of list_price is the offer an automatic decline?
const LOWBALL_THRESHOLD_PCT = 0.50;

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

  const offerAmt = offer.amount_eur;
  const minAccept = listing.min_accept_price_eur;
  const listPrice = listing.list_price_eur;

  // ── Tier 1: Auto-Accept ────────────────────────────────────────────────
  if (offerAmt >= minAccept) {
    return {
      action: 'auto-accept',
      reason: `€${offerAmt.toFixed(2)} ≥ €${minAccept.toFixed(2)} (min)`,
    };
  }

  // ── Tier 2: Auto-Counter (within €2 of min) ───────────────────────────
  const diff = minAccept - offerAmt;
  if (diff <= COUNTER_THRESHOLD_EUR && offerAmt > listPrice * LOWBALL_THRESHOLD_PCT) {
    const counterAmount = minAccept;
    const counterMessage = generateCounterMessage(counterAmount);
    return {
      action: 'auto-counter',
      reason: `€${offerAmt.toFixed(2)} ist nur €${diff.toFixed(2)} unter Minimum (€${minAccept.toFixed(2)})`,
      counterAmount,
      counterMessage,
    };
  }

  // ── Tier 3: Auto-Decline (lowball: < 50% of list price) ───────────────
  if (offerAmt < listPrice * LOWBALL_THRESHOLD_PCT) {
    return {
      action: 'auto-decline',
      reason: `€${offerAmt.toFixed(2)} < 50% von €${listPrice.toFixed(2)} (Lowball)`,
    };
  }

  // ── Tier 4: Manual review ──────────────────────────────────────────────
  return {
    action: 'review',
    reason: `€${offerAmt.toFixed(2)} liegt zwischen Lowball und Counter-Schwelle`,
  };
}

// ── Counter-offer message templates ──────────────────────────────────────────
// Authentic, friendly Vinted-girl style — no AI fluff

const COUNTER_TEMPLATES = [
  (amt: string) => `Hey! Das geht leider nicht ganz :) Könntest du ${amt}€ machen?`,
  (amt: string) => `Hi! Der Preis ist leider schon super fair 😊 ${amt}€ wäre mein Minimum, ok?`,
  (amt: string) => `Hey! Ich könnte bei ${amt}€ zusagen, das wäre mein bester Preis :)`,
  (amt: string) => `Hi :) ${amt}€ und der Artikel gehört dir! Deal?`,
  (amt: string) => `Hey! Bisschen wenig leider 🙈 Bei ${amt}€ kann ich ihn dir geben!`,
];

function generateCounterMessage(amount: number): string {
  // Pick template based on amount hash for variety but determinism
  const idx = Math.floor(amount * 100) % COUNTER_TEMPLATES.length;
  const amtStr = amount.toFixed(2).replace('.', ',');
  return COUNTER_TEMPLATES[idx]!(amtStr);
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

