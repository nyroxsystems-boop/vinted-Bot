// ──────────────────────────────────────────────────────────────────────────────
// Listing-Create via Vinted-API (statt Playwright-UI).
//
// Vorteile:
//   • 5-10s statt 60-120s pro Listing
//   • Kein Browser-Fingerprint zum Blocken
//   • Sieht aus wie Vinted's eigene Mobile-App
//
// Flow:
//   1. Holt VintedSession aus persistent context (Cookies + CSRF)
//   2. Lädt Photos via /api/v2/photos hoch (multipart)
//   3. Lookup-IDs (Brand, Color, Size, Category, Condition, Material)
//   4. POST /api/v2/items mit photo-IDs + IDs aller Felder
//
// Fallback: bei VintedAuthExpiredError → caller weiß, dass Re-Login nötig.
// Bei anderen Errors → caller kann Playwright-UI als Fallback versuchen.
// ──────────────────────────────────────────────────────────────────────────────

import { createLogger } from '@vinted-system/shared';
import type { ListingInput, ListingResult } from './create.js';
import { extractVintedSession } from '../api/session.js';
import { VintedApi, VintedAuthExpiredError } from '../api/client.js';
import { VintedLookups } from '../api/lookups.js';
import { uploadPhotos as uploadPhotosApi } from '../api/photos.js';
import { createListingViaApi } from '../api/listings.js';
import { getVintedBrowser } from '../browser.js';

const log = createLogger('vinted-listing-create-api');

export async function createListingApi(input: ListingInput, accountId: number): Promise<ListingResult> {
  log.info('Creating Vinted listing via API', {
    accountId, title: input.title.slice(0, 60), photos: input.photoPaths.length, price: input.price,
  });

  const mb = await getVintedBrowser(accountId);

  let session;
  try {
    session = await extractVintedSession(mb.context);
  } catch (err) {
    return {
      ok: false,
      error: `Session extraction failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const api = new VintedApi(session);
  const lookups = new VintedLookups(api);

  // 1. Photos hochladen
  let photos;
  try {
    photos = await uploadPhotosApi(api, input.photoPaths);
    log.info('Photos uploaded via API', { count: photos.length });
  } catch (err) {
    if (err instanceof VintedAuthExpiredError) {
      return { ok: false, error: 'API session expired — please re-login via dashboard' };
    }
    return {
      ok: false,
      error: `Photo upload (API) failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  // 2. Item erstellen
  const result = await createListingViaApi(api, lookups, {
    title: input.title,
    description: input.description,
    price: input.price,
    category: input.category,
    brand: input.brand,
    size: input.size,
    condition: input.condition,
    color: input.color,
    material: input.material,
    shipping: 'Klein',
    photos,
  });

  if (!result.ok) {
    return {
      ok: false,
      error: result.error ?? 'unknown api error',
    };
  }

  const url = result.url ?? `${session.baseUrl}/items/${result.itemId}`;
  log.info('Listing created via API', { itemId: result.itemId, url, warnings: result.warnings });

  return {
    ok: true,
    vintedUrl: url,
    vintedItemId: String(result.itemId),
  };
}
