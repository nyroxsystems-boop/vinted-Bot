// ──────────────────────────────────────────────────────────────────────────────
// Offer detection inside chat messages.
//
// VERIFIED pattern (April 2026): Vinted auto-generates offer messages as
//   "Hi! Würdest du mir diese(n) Artikel für {X,XX} € verkaufen?"
// This is NOT free text — buyers press the "Preis vorschlagen" button and
// Vinted injects this exact template. We detect these reliably via regex.
//
// Free-text price negotiations ("Würdest du für 20 gehen?") are also detected
// as a best-effort fallback, but the canonical offers are the primary signal.
// ──────────────────────────────────────────────────────────────────────────────

import { VINTED } from '../selectors.js';

export interface ParsedMessage {
  body: string;
  isOffer: boolean;
  offerAmountEur: number | null;
  source: 'vinted-template' | 'freetext' | null;
}

// Matches: "15", "15 €", "15€", "15,50 €", "€15.50"
const PRICE_RE = /(?:€\s*)?(\d{1,4}(?:[.,]\d{1,2})?)\s*(?:€|eur)?/i;

const FREETEXT_HINTS = [
  'biete', 'angebot', 'offer', 'würdest du', 'würden sie',
  'ist der preis', 'preis verhandelbar', 'nimmst du', 'gehst du runter',
  'nehme ich', 'letztes angebot', 'final offer',
];

function parsePrice(raw: string): number | null {
  const m = raw.match(PRICE_RE);
  if (!m?.[1]) return null;
  const n = Number.parseFloat(m[1].replace(',', '.'));
  return Number.isFinite(n) && n > 0 && n < 10_000 ? n : null;
}

export function parseMessageText(raw: string): ParsedMessage {
  const body = raw.trim();

  // 1. VERIFIED Vinted-template offer (highest confidence).
  const templateMatch = body.match(VINTED.offerMessageTextRegex);
  if (templateMatch?.[1]) {
    const amount = parsePrice(templateMatch[1]);
    if (amount !== null) {
      return { body, isOffer: true, offerAmountEur: amount, source: 'vinted-template' };
    }
  }

  // 2. Free-text heuristic fallback.
  const lower = body.toLowerCase();
  const hasHint = FREETEXT_HINTS.some((h) => lower.includes(h));
  const amount = parsePrice(body);
  const isShortPriceOnly = /^[€\s]*\d{1,4}([.,]\d{1,2})?\s*€?$/.test(body);
  const isOffer = (hasHint && amount !== null) || isShortPriceOnly;

  if (isOffer) {
    return { body, isOffer: true, offerAmountEur: amount, source: 'freetext' };
  }

  return { body, isOffer: false, offerAmountEur: null, source: null };
}
