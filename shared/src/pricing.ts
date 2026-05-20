// ──────────────────────────────────────────────────────────────────────────────
// Shared Pricing Engine — single source of truth for all price calculations.
//
// Used by: listing-generator, repricer, profit-routes, offer-rules
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Vinted fee structure (as of 2026):
 *   Buyer protection fee = 5% of price + €0.70
 *   This is charged to the BUYER, but reduces the seller's effective revenue
 *   since buyers factor it into their willingness to pay.
 *
 * For our profit calculation, we subtract Vinted's seller commission which
 * is effectively ~5% + €0.70 per transaction.
 */
export const VINTED_FEE_PCT = 0.05;
export const VINTED_FEE_FIXED = 0.70;
export const DEFAULT_SHIPPING_EUR = 4.99;

/**
 * Tiered markup pricing: Temu EK → Vinted VK
 *
 *   €3-5   → ×3.5   (= €10-17 VK)
 *   €5-10  → ×3.0   (= €15-30 VK)
 *   €10-15 → ×2.5   (= €25-37 VK)
 *   €15-25 → ×2.0   (= €30-50 VK)
 *   €25+   → ×1.8
 */
export function calculateVintedPrice(temuPrice: number): number {
  let markup: number;
  if (temuPrice <= 5) markup = 3.5;
  else if (temuPrice <= 10) markup = 3.0;
  else if (temuPrice <= 15) markup = 2.5;
  else if (temuPrice <= 25) markup = 2.0;
  else markup = 1.8;

  // Round to .99 ending (looks better on Vinted)
  const raw = temuPrice * markup;
  return Math.floor(raw) + 0.99;
}

/**
 * Calculate net profit for a single sale.
 */
export function calculateNetProfit(opts: {
  salePrice: number;
  temuCost: number;
  shippingCost?: number;
}): number {
  const shipping = opts.shippingCost ?? DEFAULT_SHIPPING_EUR;
  const vintedFee = opts.salePrice * VINTED_FEE_PCT + VINTED_FEE_FIXED;
  return opts.salePrice - vintedFee - opts.temuCost - shipping;
}

/**
 * Calculate the minimum accept price (floor) for an offer.
 * Ensures we never sell below cost.
 *
 * Floor = max(
 *   temuPrice × 1.5,    ← 50% minimum margin over cost
 *   listPrice × 0.75,   ← never accept less than 75% of asking
 * )
 */
export function calculateFloorPrice(opts: {
  listPrice: number;
  temuPrice: number;
  minMarginMultiplier?: number;
  maxDiscountPct?: number;
}): number {
  const minMargin = opts.minMarginMultiplier ?? 1.5;
  const maxDiscount = opts.maxDiscountPct ?? 25;

  return Math.max(
    opts.temuPrice * minMargin,
    opts.listPrice * (1 - maxDiscount / 100),
  );
}

/**
 * Calculate margin percentage.
 */
export function marginPct(revenue: number, cost: number): number {
  if (revenue <= 0) return 0;
  return Math.round(((revenue - cost) / revenue) * 1000) / 10;
}
