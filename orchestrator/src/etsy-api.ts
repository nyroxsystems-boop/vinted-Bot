// ──────────────────────────────────────────────────────────────────────────────
// Etsy Open API v3 Client — Direct Marketplace Integration
//
// Replaces Playwright-based browser automation for Etsy with
// official Etsy Open API v3 calls.
//
// Flow: OAuth2 PKCE → Create Draft Listing → Upload Images → Publish
//
// Prerequisites:
//   - Register app at etsy.com/developers
//   - Set ETSY_API_KEY, ETSY_SHOP_ID in .env
//   - Complete OAuth2 flow to get ETSY_ACCESS_TOKEN + ETSY_REFRESH_TOKEN
//
// Docs: https://developers.etsy.com/documentation
// ──────────────────────────────────────────────────────────────────────────────

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createLogger, getDb, vintedRoot } from '@vinted-system/shared';
import type { PublishResult } from '@vinted-system/shared';

const log = createLogger('etsy-api');

// ── Config ───────────────────────────────────────────────────────────────────

const ETSY_API_KEY = process.env.ETSY_API_KEY ?? '';
const ETSY_SHOP_ID = process.env.ETSY_SHOP_ID ?? '';
const ETSY_ACCESS_TOKEN = process.env.ETSY_ACCESS_TOKEN ?? '';
const ETSY_REFRESH_TOKEN = process.env.ETSY_REFRESH_TOKEN ?? '';

const ETSY_BASE_URL = 'https://openapi.etsy.com/v3';
const ETSY_TOKEN_URL = 'https://api.etsy.com/v3/public/oauth/token';

// ── Token Management ─────────────────────────────────────────────────────────

let cachedToken: { token: string; refresh: string; expiresAt: number } | null = null;

function initToken(): void {
  if (ETSY_ACCESS_TOKEN && !cachedToken) {
    cachedToken = {
      token: ETSY_ACCESS_TOKEN,
      refresh: ETSY_REFRESH_TOKEN,
      expiresAt: Date.now() + 3600_000, // Assume 1 hour from now
    };
  }
}

export async function getAccessToken(): Promise<string> {
  initToken();

  if (cachedToken && Date.now() < cachedToken.expiresAt - 60_000) {
    return cachedToken.token;
  }

  if (!cachedToken?.refresh) {
    throw new Error('Etsy: No refresh token available. Complete OAuth2 flow first.');
  }

  const res = await fetch(ETSY_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: ETSY_API_KEY,
      refresh_token: cachedToken.refresh,
    }),
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Etsy token refresh failed: ${res.status} ${text.slice(0, 200)}`);
  }

  const data = (await res.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
  };

  cachedToken = {
    token: data.access_token,
    refresh: data.refresh_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };

  // Persist new refresh token to DB for next restart
  try {
    getDb().prepare(
      `INSERT INTO settings (key, value) VALUES ('etsy_refresh_token', ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    ).run(data.refresh_token);
  } catch { /* settings table may not exist */ }

  log.info('Etsy access token refreshed', { expiresIn: data.expires_in });
  return cachedToken.token;
}

// ── OAuth2 PKCE Flow Helpers (for initial setup) ─────────────────────────────

export function generatePKCE(): { verifier: string; challenge: string } {
  const verifier = crypto.randomBytes(32)
    .toString('base64url')
    .slice(0, 128);
  const challenge = crypto
    .createHash('sha256')
    .update(verifier)
    .digest('base64url');
  return { verifier, challenge };
}

export function getOAuthUrl(redirectUri: string, scopes: string[] = ['listings_w', 'listings_r', 'listings_d']): {
  url: string;
  verifier: string;
  state: string;
} {
  const { verifier, challenge } = generatePKCE();
  const state = crypto.randomBytes(16).toString('hex');

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: ETSY_API_KEY,
    redirect_uri: redirectUri,
    scope: scopes.join(' '),
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  });

  return {
    url: `https://www.etsy.com/oauth/connect?${params}`,
    verifier,
    state,
  };
}

// ── Helper: Etsy API Call ────────────────────────────────────────────────────

async function etsyCall<T>(
  method: string,
  endpoint: string,
  body?: unknown,
  isMultipart?: boolean,
): Promise<T> {
  const token = await getAccessToken();
  const url = `${ETSY_BASE_URL}${endpoint}`;

  const headers: Record<string, string> = {
    'Authorization': `Bearer ${token}`,
    'x-api-key': ETSY_API_KEY,
  };

  let fetchBody: BodyInit | undefined;
  if (isMultipart && body instanceof FormData) {
    fetchBody = body;
    // Don't set Content-Type for multipart — fetch handles it
  } else if (body) {
    headers['Content-Type'] = 'application/json';
    fetchBody = JSON.stringify(body);
  }

  const res = await fetch(url, {
    method,
    headers,
    body: fetchBody,
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Etsy API ${method} ${endpoint}: ${res.status} ${text.slice(0, 400)}`);
  }

  if (res.status === 204) return {} as T;
  return (await res.json()) as T;
}

// ── Types ────────────────────────────────────────────────────────────────────

export interface EtsyListingInput {
  title: string;
  description: string;
  price_eur: number;
  quantity: number;
  taxonomy_id?: number;        // Etsy category ID
  who_made: 'i_did' | 'someone_else' | 'collective';
  when_made: string;           // e.g. '2020_2025', 'made_to_order'
  is_supply: boolean;
  shipping_profile_id?: number;
  image_paths?: string[];      // local paths to upload
  tags?: string[];             // max 13 tags
  materials?: string[];
  state?: 'draft' | 'active';
}

// Condition/when_made mapping from our system
function mapWhenMade(condition: string): string {
  if (condition.includes('Neu') || condition.includes('Etikett')) return '2020_2025';
  return '2020_2025'; // Etsy requires a range even for secondhand
}

// ── Step 1: Create Draft Listing ─────────────────────────────────────────────

export async function createDraftListing(input: EtsyListingInput): Promise<number> {
  if (!ETSY_SHOP_ID) throw new Error('ETSY_SHOP_ID not configured');

  const body = {
    title: input.title.slice(0, 140),
    description: input.description.slice(0, 65535),
    price: input.price_eur,
    quantity: input.quantity,
    taxonomy_id: input.taxonomy_id ?? 482, // Default: Clothing > Women's
    who_made: input.who_made ?? 'someone_else',
    when_made: input.when_made ?? '2020_2025',
    is_supply: input.is_supply ?? false,
    shipping_profile_id: input.shipping_profile_id,
    tags: (input.tags ?? []).slice(0, 13),
    materials: input.materials ?? [],
    state: input.state ?? 'draft',
  };

  const result = await etsyCall<{ listing_id: number }>(
    'POST',
    `/application/shops/${ETSY_SHOP_ID}/listings`,
    body,
  );

  log.info('Etsy draft listing created', { listingId: result.listing_id, title: input.title.slice(0, 40) });
  return result.listing_id;
}

// ── Step 2: Upload Images ────────────────────────────────────────────────────

export async function uploadListingImage(
  listingId: number,
  imagePath: string,
  rank: number = 1,
): Promise<number> {
  if (!ETSY_SHOP_ID) throw new Error('ETSY_SHOP_ID not configured');

  const fileBuffer = fs.readFileSync(imagePath);
  const fileName = path.basename(imagePath);

  // Create FormData with file
  const formData = new FormData();
  formData.append('image', new Blob([fileBuffer]), fileName);
  formData.append('rank', rank.toString());

  const result = await etsyCall<{ listing_image_id: number }>(
    'POST',
    `/application/shops/${ETSY_SHOP_ID}/listings/${listingId}/images`,
    formData,
    true,
  );

  log.info('Etsy image uploaded', { listingId, imageId: result.listing_image_id, rank });
  return result.listing_image_id;
}

// ── Step 3: Update Listing State ─────────────────────────────────────────────

export async function updateListingState(
  listingId: number,
  state: 'active' | 'draft' | 'inactive',
): Promise<void> {
  if (!ETSY_SHOP_ID) throw new Error('ETSY_SHOP_ID not configured');

  await etsyCall(
    'PUT',
    `/application/shops/${ETSY_SHOP_ID}/listings/${listingId}`,
    { state },
  );

  log.info('Etsy listing state updated', { listingId, state });
}

// ── Combined: Full Publish Flow ──────────────────────────────────────────────

export async function publishToEtsy(input: EtsyListingInput): Promise<PublishResult> {
  try {
    // Step 1: Create draft listing
    const listingId = await createDraftListing({
      ...input,
      state: 'draft', // Always start as draft
    });

    // Step 2: Upload images
    const imagePaths = input.image_paths ?? [];
    for (let i = 0; i < Math.min(imagePaths.length, 10); i++) {
      try {
        await uploadListingImage(listingId, imagePaths[i]!, i + 1);
      } catch (imgErr) {
        log.warn('Image upload failed', { listingId, path: imagePaths[i], err: String(imgErr) });
      }
    }

    // Step 3: Activate listing
    await updateListingState(listingId, 'active');

    const externalUrl = `https://www.etsy.com/listing/${listingId}`;

    // Track in DB
    try {
      getDb().prepare(
        `INSERT INTO marketplace_listings
           (marketplace, account_id, folder_num, external_id, external_url, status, list_price_eur)
         VALUES ('etsy', 1, ?, ?, ?, 'active', ?)
         ON CONFLICT(marketplace, account_id, folder_num) DO UPDATE SET
           external_id = excluded.external_id,
           external_url = excluded.external_url,
           status = 'active',
           list_price_eur = excluded.list_price_eur,
           last_error = NULL,
           updated_at = datetime('now')`,
      ).run(0, String(listingId), externalUrl, input.price_eur);
    } catch (dbErr) {
      log.warn('DB tracking failed', { err: String(dbErr) });
    }

    return {
      ok: true,
      externalId: String(listingId),
      externalUrl,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error('Etsy publish failed', { err: msg });
    return { ok: false, error: msg };
  }
}

// ── Deactivate Listing ───────────────────────────────────────────────────────

export async function deactivateEtsyListing(listingId: number): Promise<{ ok: boolean; error?: string }> {
  try {
    await updateListingState(listingId, 'inactive');
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ── Publish from Folder ──────────────────────────────────────────────────────

const VINTED_ROOT = vintedRoot();

export async function publishFolderToEtsy(folderNum: number): Promise<PublishResult> {
  const folderName = folderNum === 1 ? 'Neuer Ordner' : `Neuer Ordner ${folderNum}`;
  const folderPath = path.join(VINTED_ROOT, folderName);
  const listingPath = path.join(folderPath, 'listing.json');

  if (!fs.existsSync(listingPath)) {
    return { ok: false, error: `listing.json not found for folder ${folderNum}` };
  }

  const listing = JSON.parse(fs.readFileSync(listingPath, 'utf-8'));

  // Collect image paths
  const imagePaths: string[] = [];
  for (const m of ['model_1', 'model_2', 'model_3']) {
    const dir = path.join(folderPath, m);
    try {
      const files = fs.readdirSync(dir)
        .filter((f) => /\.(jpg|jpeg|png|webp)$/i.test(f))
        .sort()
        .slice(0, 3)
        .map((f) => path.join(dir, f));
      imagePaths.push(...files);
    } catch { /* no model dir */ }
  }

  // Extract tags from listing
  const tags = (listing.tags ?? listing.description ?? '')
    .split(/[,;]+/)
    .map((t: string) => t.trim().toLowerCase())
    .filter((t: string) => t.length > 2)
    .slice(0, 13);

  const input: EtsyListingInput = {
    title: listing.title ?? '',
    description: listing.description ?? '',
    price_eur: listing.price_eur ?? 0,
    quantity: 1,
    who_made: 'someone_else',
    when_made: mapWhenMade(listing.condition ?? 'Sehr gut'),
    is_supply: false,
    image_paths: imagePaths.slice(0, 10),
    tags,
    materials: listing.material ? [listing.material] : [],
  };

  return publishToEtsy(input);
}

// ── Status Check ─────────────────────────────────────────────────────────────

export function isEtsyConfigured(): boolean {
  return !!(ETSY_API_KEY && ETSY_SHOP_ID && (ETSY_ACCESS_TOKEN || ETSY_REFRESH_TOKEN));
}

export function getEtsyStatus(): {
  configured: boolean;
  shopId: string;
  hasToken: boolean;
  tokenExpiry: string | null;
} {
  return {
    configured: isEtsyConfigured(),
    shopId: ETSY_SHOP_ID,
    hasToken: !!cachedToken,
    tokenExpiry: cachedToken ? new Date(cachedToken.expiresAt).toISOString() : null,
  };
}
