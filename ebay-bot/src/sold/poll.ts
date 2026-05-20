// ──────────────────────────────────────────────────────────────────────────────
// Sold-order polling via eBay Fulfillment API.
//
// GET /sell/fulfillment/v1/order?filter=creationdate:[<ISO since>..]
//
// Returns a normalized list of orders the orchestrator can use to materialize
// sales rows. We do NOT touch the DB here — that's the orchestrator's job
// (see ebay-sale-detector.ts). This bot is the dumb transport.
// ──────────────────────────────────────────────────────────────────────────────

import { createLogger } from '@vinted-system/shared';
import { ebayFetch, hasCredentials, type EbayMarket } from '../auth/token.js';

const log = createLogger('ebay-sold-poll');

export interface SoldOrderItem {
  listingId: string;
  sku?: string;
  title: string;
  price: number;
}

export interface SoldOrder {
  orderId: string;
  legacyOrderId?: string;
  creationDate: string;
  paymentStatus: string;        // PAID, etc.
  totalAmount: number;
  currency: string;
  buyerUsername?: string;
  shippingAddress: {
    fullName?: string;
    line1?: string;
    line2?: string;
    city?: string;
    postalCode?: string;
    countryCode?: string;
  };
  items: SoldOrderItem[];
}

export interface PollSoldResult {
  ok: boolean;
  market: EbayMarket;
  marketplace: 'ebay_de' | 'ebay_uk';
  orders: SoldOrder[];
  error?: string;
}

const PAGE_LIMIT = 50;
const MAX_PAGES = 10;

export async function pollSoldOrders(
  market: EbayMarket,
  sinceMs: number = Date.now() - 7 * 24 * 3600 * 1000,
): Promise<PollSoldResult> {
  const marketplaceLabel = market === 'uk' ? 'ebay_uk' : 'ebay_de';

  if (!hasCredentials(market)) {
    return {
      ok: false,
      market,
      marketplace: marketplaceLabel,
      orders: [],
      error: 'eBay credentials not configured',
    };
  }

  const sinceIso = new Date(sinceMs).toISOString();
  const filter = `creationdate:[${sinceIso}..]`;
  const out: SoldOrder[] = [];
  let offset = 0;

  for (let page = 0; page < MAX_PAGES; page++) {
    const endpoint = `/sell/fulfillment/v1/order?filter=${encodeURIComponent(filter)}&limit=${PAGE_LIMIT}&offset=${offset}`;
    const r = await ebayFetch<{ orders?: unknown[]; total?: number }>(market, 'GET', endpoint);

    if (!r.ok) {
      // Treat unauthorized / forbidden / not-found as soft-fail so callers can keep ticking.
      if ([401, 403, 404].includes(r.status)) {
        return { ok: false, market, marketplace: marketplaceLabel, orders: out, error: r.error };
      }
      return { ok: false, market, marketplace: marketplaceLabel, orders: out, error: r.error };
    }

    const orders = r.data?.orders ?? [];
    for (const raw of orders) {
      out.push(normalizeOrder(raw as Record<string, unknown>));
    }

    if (orders.length < PAGE_LIMIT) break;
    offset += PAGE_LIMIT;
  }

  log.info('sold-poll ok', { market, count: out.length });
  return { ok: true, market, marketplace: marketplaceLabel, orders: out };
}

function normalizeOrder(o: Record<string, unknown>): SoldOrder {
  const ship = (
    (o.fulfillmentStartInstructions as Array<Record<string, unknown>> | undefined)?.[0]
      ?.shippingStep as { shipTo?: Record<string, unknown> } | undefined
  )?.shipTo as { fullName?: string; contactAddress?: Record<string, unknown> } | undefined;
  const contact = ship?.contactAddress as Record<string, unknown> | undefined;

  const items: SoldOrderItem[] = ((o.lineItems as Array<Record<string, unknown>> | undefined) ?? []).map(
    (li) => ({
      listingId: String(li.listingId ?? ''),
      sku: li.sku as string | undefined,
      title: String(li.title ?? ''),
      price: Number(((li.lineItemCost as Record<string, unknown> | undefined)?.value as string | undefined) ?? 0),
    }),
  );

  const totalSummary = (o.pricingSummary as Record<string, unknown> | undefined)?.total as
    | { value?: string; currency?: string }
    | undefined;

  return {
    orderId: String(o.orderId ?? ''),
    legacyOrderId: o.legacyOrderId as string | undefined,
    creationDate: String(o.creationDate ?? ''),
    paymentStatus: String(o.orderPaymentStatus ?? ''),
    totalAmount: Number(totalSummary?.value ?? 0),
    currency: String(totalSummary?.currency ?? 'EUR'),
    buyerUsername: (o.buyer as Record<string, unknown> | undefined)?.username as string | undefined,
    shippingAddress: {
      fullName: ship?.fullName,
      line1: contact?.addressLine1 as string | undefined,
      line2: contact?.addressLine2 as string | undefined,
      city: contact?.city as string | undefined,
      postalCode: contact?.postalCode as string | undefined,
      countryCode: contact?.countryCode as string | undefined,
    },
    items,
  };
}
