// ──────────────────────────────────────────────────────────────────────────────
// eBay Sell API Client — Direct Marketplace Integration
//
// Replaces Playwright-based browser automation for eBay DE + eBay UK with
// official eBay REST API calls (Inventory API + Trading API).
//
// Flow: Create Inventory Item → Create Offer → Publish Offer → Live Listing
//
// Prerequisites:
//   - Register at developer.ebay.com (free)
//   - Set EBAY_CLIENT_ID, EBAY_CLIENT_SECRET, EBAY_REFRESH_TOKEN in .env
//   - Opt-in to Business Policies on your eBay account
//   - Create at least one Inventory Location
//
// Docs: https://developer.ebay.com/api-docs/sell/inventory/overview.html
// ──────────────────────────────────────────────────────────────────────────────

import fs from 'node:fs';
import path from 'node:path';
import { createLogger, getDb, getSetting, vintedRoot } from '@vinted-system/shared';
import type { MarketplaceId, PublishResult } from '@vinted-system/shared';

const log = createLogger('ebay-api');

// ── Config ───────────────────────────────────────────────────────────────────

// Credentials are read settings-first, env-fallback. Dashboard can write
// them via PUT /api/ebay/auth without restarting the orchestrator.
function getCred(key: string, envName: string): string {
  const dbVal = getSetting(key);
  if (dbVal && dbVal.length > 0) return dbVal;
  return process.env[envName] ?? '';
}
const EBAY_LOCATION_KEY = process.env.EBAY_LOCATION_KEY ?? 'default_location';

function isSandbox(): boolean {
  const dbVal = getSetting('ebay_sandbox');
  if (dbVal === 'true') return true;
  if (dbVal === 'false') return false;
  return process.env.EBAY_SANDBOX === 'true';
}
function baseUrl(): string {
  return isSandbox() ? 'https://api.sandbox.ebay.com' : 'https://api.ebay.com';
}
function authUrl(): string {
  return isSandbox()
    ? 'https://api.sandbox.ebay.com/identity/v1/oauth2/token'
    : 'https://api.ebay.com/identity/v1/oauth2/token';
}

// ── Token Cache ──────────────────────────────────────────────────────────────

let cachedToken: { token: string; expiresAt: number } | null = null;

export async function getAccessToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt - 60_000) {
    return cachedToken.token;
  }

  const clientId = getCred('ebay_client_id', 'EBAY_CLIENT_ID');
  const clientSecret = getCred('ebay_client_secret', 'EBAY_CLIENT_SECRET');
  const refreshToken = getCred('ebay_refresh_token', 'EBAY_REFRESH_TOKEN');
  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error('eBay API credentials missing. Set in Dashboard → Settings → eBay or .env');
  }

  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

  const res = await fetch(authUrl(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': `Basic ${credentials}`,
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      scope: 'https://api.ebay.com/oauth/api_scope/sell.inventory https://api.ebay.com/oauth/api_scope/sell.fulfillment',
    }),
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`eBay token refresh failed: ${res.status} ${text.slice(0, 200)}`);
  }

  const data = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = {
    token: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };

  log.info('eBay access token refreshed', { expiresIn: data.expires_in });
  return cachedToken.token;
}

// ── Helper: eBay API Call ────────────────────────────────────────────────────

async function ebayCall<T>(
  method: string,
  endpoint: string,
  body?: unknown,
  marketplace?: 'EBAY_DE' | 'EBAY_GB' | 'EBAY_US',
): Promise<T> {
  const token = await getAccessToken();
  const headers: Record<string, string> = {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
    'Content-Language': marketplace === 'EBAY_GB' ? 'en-GB' : 'de-DE',
  };

  if (marketplace) {
    headers['X-EBAY-C-MARKETPLACE-ID'] = marketplace;
  }

  const url = `${baseUrl()}${endpoint}`;
  const res = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`eBay API ${method} ${endpoint}: ${res.status} ${text.slice(0, 400)}`);
  }

  // Some endpoints return 204 No Content
  if (res.status === 204) return {} as T;

  return (await res.json()) as T;
}

// ── Types ────────────────────────────────────────────────────────────────────

export interface EbayListingInput {
  sku: string;
  title: string;
  description: string;
  category_id: string;
  condition: 'NEW' | 'LIKE_NEW' | 'VERY_GOOD' | 'GOOD' | 'ACCEPTABLE';
  price_eur: number;
  quantity: number;
  brand?: string;
  size?: string;
  color?: string;
  material?: string;
  image_urls: string[];    // must be publicly accessible URLs
  image_paths?: string[];  // local paths — will be uploaded if image_urls empty
  fulfillment_policy_id?: string;
  payment_policy_id?: string;
  return_policy_id?: string;
}

// Condition mapping from our system to eBay enum
const CONDITION_MAP: Record<string, string> = {
  'Neu, mit Etikett': 'NEW',
  'Neu': 'NEW',
  'Sehr gut': 'LIKE_NEW',
  'Gut': 'VERY_GOOD',
  'Befriedigend': 'GOOD',
};

function mapCondition(condition: string): string {
  return CONDITION_MAP[condition] ?? 'LIKE_NEW';
}

// ── Step 1: Create/Replace Inventory Item ────────────────────────────────────

export async function createInventoryItem(input: EbayListingInput): Promise<void> {
  const body = {
    product: {
      title: input.title.slice(0, 80),
      description: input.description,
      aspects: {} as Record<string, string[]>,
      imageUrls: input.image_urls.slice(0, 12),
    },
    condition: input.condition,
    availability: {
      shipToLocationAvailability: {
        quantity: input.quantity,
      },
    },
  };

  // Add product aspects
  if (input.brand) body.product.aspects['Marke'] = [input.brand];
  if (input.size) body.product.aspects['Größe'] = [input.size];
  if (input.color) body.product.aspects['Farbe'] = [input.color];
  if (input.material) body.product.aspects['Material'] = [input.material];

  await ebayCall('PUT', `/sell/inventory/v1/inventory_item/${encodeURIComponent(input.sku)}`, body);
  log.info('eBay inventory item created', { sku: input.sku, title: input.title.slice(0, 40) });
}

// ── Step 2: Create Offer ─────────────────────────────────────────────────────

export async function createOffer(
  input: EbayListingInput,
  marketplace: 'EBAY_DE' | 'EBAY_GB' = 'EBAY_DE',
): Promise<string> {
  const body = {
    sku: input.sku,
    marketplaceId: marketplace,
    format: 'FIXED_PRICE',
    availableQuantity: input.quantity,
    categoryId: input.category_id || '63861', // Default: Damenbekleidung
    listingDescription: input.description,
    listingPolicies: {
      fulfillmentPolicyId: input.fulfillment_policy_id,
      paymentPolicyId: input.payment_policy_id,
      returnPolicyId: input.return_policy_id,
    },
    merchantLocationKey: EBAY_LOCATION_KEY,
    pricingSummary: {
      price: {
        value: input.price_eur.toFixed(2),
        currency: marketplace === 'EBAY_GB' ? 'GBP' : 'EUR',
      },
    },
  };

  const result = await ebayCall<{ offerId: string }>(
    'POST',
    '/sell/inventory/v1/offer',
    body,
    marketplace,
  );

  log.info('eBay offer created', { offerId: result.offerId, marketplace });
  return result.offerId;
}

// ── Step 3: Publish Offer → Live Listing ─────────────────────────────────────

export async function publishOffer(
  offerId: string,
  marketplace: 'EBAY_DE' | 'EBAY_GB' = 'EBAY_DE',
): Promise<string> {
  const result = await ebayCall<{ listingId: string }>(
    'POST',
    `/sell/inventory/v1/offer/${encodeURIComponent(offerId)}/publish`,
    undefined,
    marketplace,
  );

  log.info('eBay listing published', { offerId, listingId: result.listingId });
  return result.listingId;
}

// ── Combined: Full Publish Flow ──────────────────────────────────────────────

export async function publishToEbay(
  input: EbayListingInput,
  marketplace: 'EBAY_DE' | 'EBAY_GB' = 'EBAY_DE',
): Promise<PublishResult> {
  try {
    // Step 1: Create inventory item
    await createInventoryItem(input);

    // Step 2: Create offer
    const offerId = await createOffer(input, marketplace);

    // Step 3: Publish
    const listingId = await publishOffer(offerId, marketplace);

    const externalUrl = marketplace === 'EBAY_GB'
      ? `https://www.ebay.co.uk/itm/${listingId}`
      : `https://www.ebay.de/itm/${listingId}`;

    // Track in DB
    try {
      getDb().prepare(
        `INSERT INTO marketplace_listings
           (marketplace, account_id, folder_num, external_id, external_url, status, list_price_eur)
         VALUES (?, 1, ?, ?, ?, 'active', ?)
         ON CONFLICT(marketplace, account_id, folder_num) DO UPDATE SET
           external_id = excluded.external_id,
           external_url = excluded.external_url,
           status = 'active',
           list_price_eur = excluded.list_price_eur,
           last_error = NULL,
           updated_at = datetime('now')`,
      ).run(
        marketplace === 'EBAY_GB' ? 'ebay_uk' : 'ebay_de',
        parseInt(input.sku.replace(/\D/g, ''), 10) || 0,
        listingId,
        externalUrl,
        input.price_eur,
      );
    } catch (dbErr) {
      log.warn('DB tracking failed', { err: String(dbErr) });
    }

    return {
      ok: true,
      externalId: listingId,
      externalUrl,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error('eBay publish failed', { sku: input.sku, err: msg });
    return { ok: false, error: msg };
  }
}

// ── Deactivate Listing ───────────────────────────────────────────────────────

export async function deactivateEbayListing(listingId: string): Promise<{ ok: boolean; error?: string }> {
  try {
    // eBay: withdraw offer by listing ID
    // First get offers for the listing
    await ebayCall('POST', `/sell/inventory/v1/offer/${encodeURIComponent(listingId)}/withdraw`);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ── Order Fetching (for sale detection) ─────────────────────────────────────

export interface EbayOrder {
  orderId: string;
  legacyOrderId?: string;
  creationDate: string;        // ISO
  orderPaymentStatus: string;  // PAID, PARTIALLY_PAID, etc.
  totalAmount: number;
  currency: string;
  buyer: { username?: string };
  shippingAddress: {
    fullName?: string;
    line1?: string;
    line2?: string;
    city?: string;
    postalCode?: string;
    countryCode?: string;
  };
  items: Array<{
    listingId: string;
    sku?: string;
    title: string;
    price: number;
  }>;
}

/**
 * Fetch recent PAID orders from eBay. Pages through results until we have all
 * orders since `sinceMs`. Returns a flat list of EbayOrder.
 * https://developer.ebay.com/api-docs/sell/fulfillment/resources/order/methods/getOrders
 */
export async function getRecentOrders(sinceMs: number = Date.now() - 7 * 24 * 3600 * 1000): Promise<EbayOrder[]> {
  const sinceIso = new Date(sinceMs).toISOString();
  const filter = `creationdate:[${sinceIso}..]`;
  const limit = 50;
  const out: EbayOrder[] = [];
  let offset = 0;
  for (let page = 0; page < 10; page++) {
    const endpoint = `/sell/fulfillment/v1/order?filter=${encodeURIComponent(filter)}&limit=${limit}&offset=${offset}`;
    let resp: { orders?: unknown[]; total?: number };
    try {
      resp = await ebayCall<{ orders?: unknown[]; total?: number }>('GET', endpoint);
    } catch (err) {
      // Treat 401/403/404 as "not configured / no orders" so detector keeps running
      const msg = err instanceof Error ? err.message : String(err);
      if (/401|403|404/.test(msg)) return out;
      throw err;
    }
    const orders = resp.orders ?? [];
    for (const raw of orders) {
      const o = raw as Record<string, unknown>;
      const ship = ((o.fulfillmentStartInstructions as Array<Record<string, unknown>> | undefined)?.[0]?.shippingStep as
        | { shipTo?: Record<string, unknown> } | undefined)?.shipTo;
      const addr = ship as { fullName?: string; contactAddress?: Record<string, unknown> } | undefined;
      const contact = addr?.contactAddress as Record<string, unknown> | undefined;
      const items = ((o.lineItems as Array<Record<string, unknown>> | undefined) ?? []).map((li) => ({
        listingId: String(li.listingId ?? ''),
        sku: li.sku as string | undefined,
        title: String(li.title ?? ''),
        price: Number(((li.lineItemCost as Record<string, unknown> | undefined)?.value as string | undefined) ?? 0),
      }));
      const total = Number(((o.pricingSummary as Record<string, unknown> | undefined)?.total as Record<string, unknown> | undefined)?.value as string | undefined ?? 0);
      const cur = String(((o.pricingSummary as Record<string, unknown> | undefined)?.total as Record<string, unknown> | undefined)?.currency as string | undefined ?? 'EUR');
      out.push({
        orderId: String(o.orderId ?? ''),
        legacyOrderId: o.legacyOrderId as string | undefined,
        creationDate: String(o.creationDate ?? ''),
        orderPaymentStatus: String(o.orderPaymentStatus ?? ''),
        totalAmount: total,
        currency: cur,
        buyer: { username: ((o.buyer as Record<string, unknown> | undefined)?.username as string | undefined) },
        shippingAddress: {
          fullName: addr?.fullName,
          line1: contact?.addressLine1 as string | undefined,
          line2: contact?.addressLine2 as string | undefined,
          city: contact?.city as string | undefined,
          postalCode: contact?.postalCode as string | undefined,
          countryCode: contact?.countryCode as string | undefined,
        },
        items,
      });
    }
    if (orders.length < limit) break;
    offset += limit;
  }
  return out;
}

// ── Listing from Folder ──────────────────────────────────────────────────────

const VINTED_ROOT = vintedRoot();

export async function publishFolderToEbay(
  folderNum: number,
  marketplace: 'EBAY_DE' | 'EBAY_GB' = 'EBAY_DE',
): Promise<PublishResult> {
  const folderName = folderNum === 1 ? 'Neuer Ordner' : `Neuer Ordner ${folderNum}`;
  const folderPath = path.join(VINTED_ROOT, folderName);
  const listingPath = path.join(folderPath, 'listing.json');

  if (!fs.existsSync(listingPath)) {
    return { ok: false, error: `listing.json not found for folder ${folderNum}` };
  }

  const listing = JSON.parse(fs.readFileSync(listingPath, 'utf-8'));

  // Collect image URLs — for now use local paths (needs image hosting)
  const imagePaths: string[] = [];
  for (const m of ['model_1', 'model_2', 'model_3']) {
    const dir = path.join(folderPath, m);
    try {
      const files = fs.readdirSync(dir)
        .filter((f) => /\.(jpg|jpeg|png|webp)$/i.test(f))
        .sort()
        .slice(0, 4)
        .map((f) => path.join(dir, f));
      imagePaths.push(...files);
    } catch { /* no model dir */ }
  }

  const input: EbayListingInput = {
    sku: `folder_${folderNum}`,
    title: listing.title ?? '',
    description: listing.description ?? '',
    category_id: listing.ebay_category_id ?? '63861',
    condition: mapCondition(listing.condition ?? 'Sehr gut') as EbayListingInput['condition'],
    price_eur: listing.price_eur ?? 0,
    quantity: 1,
    brand: listing.brand,
    size: listing.size,
    color: listing.colors?.[0],
    material: listing.material,
    image_urls: listing.ebay_image_urls ?? [], // Pre-uploaded image URLs
    image_paths: imagePaths,
  };

  return publishToEbay(input, marketplace);
}

// ── Status Check ─────────────────────────────────────────────────────────────

export function isEbayConfigured(): boolean {
  return !!(getCred('ebay_client_id', 'EBAY_CLIENT_ID')
    && getCred('ebay_client_secret', 'EBAY_CLIENT_SECRET')
    && getCred('ebay_refresh_token', 'EBAY_REFRESH_TOKEN'));
}

export function getEbayStatus(): {
  configured: boolean;
  sandbox: boolean;
  locationKey: string;
  hasToken: boolean;
} {
  return {
    configured: isEbayConfigured(),
    sandbox: isSandbox(),
    locationKey: EBAY_LOCATION_KEY,
    hasToken: !!cachedToken,
  };
}
