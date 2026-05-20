// ──────────────────────────────────────────────────────────────────────────────
// Vinted Marketplace-Adapter
//
// Implementiert das gemeinsame MarketplaceAdapter-Interface aus shared.
// Mappt universellen ListingDraft auf den vinted-spezifischen ListingInput
// und bindet bestehende Flows (createListing, updateListingPrice,
// deactivateListing) als HTTP-fähige Methoden.
// ──────────────────────────────────────────────────────────────────────────────

import {
  createLogger,
  getSetting,
  getBlockState,
  clearBlock,
  MARKETPLACE_REGISTRY,
  type DeactivateResult,
  type ListingDraft,
  type MarketplaceAdapter,
  type PublishResult,
  type UpdatePriceResult,
} from '@vinted-system/shared';
import { createListing, type ListingInput } from './listings/create.js';
import { createListingApi } from './listings/create-via-api.js';
import { updateListingPrice } from './listings/update-price.js';
import { deactivateListing } from './listings/deactivate.js';
import { getVintedBrowser } from './browser.js';
import { extractVintedSession } from './api/session.js';
import { VintedApi } from './api/client.js';
import { updateItemPriceViaApi, deleteItemViaApi } from './api/listings.js';

const log = createLogger('vinted-adapter');

const BASE_URL = process.env.VINTED_BASE_URL ?? 'https://www.vinted.de';

function draftToVintedInput(draft: ListingDraft): ListingInput {
  // Vinted: max 2 Farben, Komma-getrennt
  const color = (draft.colors ?? []).slice(0, 2).join(', ');
  return {
    title: draft.title,
    description: draft.description,
    category: draft.category,
    brand: draft.brand || 'Ohne Marke',
    size: draft.size,
    condition: draft.condition,
    color: color || 'Mehrfarbig',
    material: draft.material,
    price: draft.priceEur,
    photoPaths: draft.photos,
  };
}

async function isLoggedInRemote(accountId: number): Promise<boolean> {
  const mb = await getVintedBrowser(accountId);
  const page = await mb.context.newPage();
  try {
    await page.goto(`${BASE_URL}/`, { waitUntil: 'domcontentloaded', timeout: 20_000 });
    if (page.url().includes('/login') || page.url().includes('/member/signup')) return false;
    // Profil-Avatar oder "Anzeige aufgeben" Button als Login-Indicator
    const exists = await page
      .locator('[data-testid="user-menu-button"], a[data-testid="header--upload-button"]')
      .first()
      .isVisible({ timeout: 5000 })
      .catch(() => false);
    return exists;
  } finally {
    await page.close().catch(() => null);
  }
}

export const vintedAdapter: MarketplaceAdapter = {
  meta: MARKETPLACE_REGISTRY.vinted,

  async isAuthenticated(accountId) {
    try {
      return await isLoggedInRemote(accountId);
    } catch (err) {
      log.warn('isAuthenticated failed', { accountId, err: String(err) });
      return false;
    }
  },

  async login(_accountId) {
    // Vinted hat einen separaten startLogin-Flow in login-flow.ts.
    // Adapter.login() ist hier eine sanfte Hülle: triggert NICHT den
    // headful Login-Flow (das macht /login/start). Stattdessen prüft
    // sie den Status und gibt Hinweis.
    return {
      ok: false,
      error: 'use POST /login/start for interactive Vinted login (headful)',
    };
  },

  async publish(accountId: number, draft: ListingDraft): Promise<PublishResult> {
    const input = draftToVintedInput(draft);
    if (!input.photoPaths || input.photoPaths.length === 0) {
      return { ok: false, error: 'no photos in draft' };
    }

    // Block-Cooldown-Check: skip wenn IP noch im Vinted-Cooldown
    const block = getBlockState('vinted');
    if (block.blocked && block.until) {
      const remaining = Math.ceil((block.remainingMs ?? 0) / 60000);
      return {
        ok: false,
        error: `Vinted blockiert bis ${block.until.toLocaleTimeString('de-DE')} (noch ${remaining}min) — ${block.reason ?? ''}`,
        blockedBy: 'rate-limit',
      };
    }

    const useApi = (getSetting('vinted_use_api') ?? 'true') === 'true';

    if (useApi) {
      log.info('Trying API path first', { folderNum: draft.folderNum });
      const apiRes = await createListingApi(input, accountId);
      if (apiRes.ok) {
        return { ok: true, externalId: apiRes.vintedItemId, externalUrl: apiRes.vintedUrl };
      }
      const apiErr = apiRes.error ?? 'unknown api error';
      log.warn('API path failed', { folderNum: draft.folderNum, error: apiErr });

      // Bei Auth-Fehler: nicht zu UI fallback, das hilft nicht
      if (/session expired|not authenticated|401/i.test(apiErr)) {
        return { ok: false, error: apiErr, blockedBy: 'login' };
      }
      // Sonst: Playwright-UI als Fallback
      const fallback = (getSetting('vinted_api_fallback_to_ui') ?? 'true') === 'true';
      if (!fallback) {
        return { ok: false, error: `API failed (no fallback): ${apiErr}` };
      }
      log.info('Falling back to Playwright UI');
    }

    const result = await createListing(input, accountId);
    if (!result.ok) {
      return {
        ok: false,
        error: result.error ?? 'unknown',
        blockedBy: /not authenticated/i.test(result.error ?? '') ? 'login'
                 : /captcha/i.test(result.error ?? '')          ? 'captcha'
                 : /selector/i.test(result.error ?? '')         ? 'selector-drift'
                 : /SESSION_BLOCKED|RATE_LIMITED/i.test(result.error ?? '') ? 'rate-limit'
                 : 'unknown',
      };
    }
    return {
      ok: true,
      externalId: result.vintedItemId,
      externalUrl: result.vintedUrl,
    };
  },

  async deactivate(accountId: number, externalIdOrUrl: string): Promise<DeactivateResult> {
    const useApi = (getSetting('vinted_use_api') ?? 'true') === 'true';
    if (useApi) {
      const idMatch = externalIdOrUrl.startsWith('http')
        ? externalIdOrUrl.match(/\/items\/(\d+)/)?.[1]
        : externalIdOrUrl;
      const itemId = Number(idMatch);
      if (Number.isFinite(itemId) && itemId > 0) {
        try {
          const mb = await getVintedBrowser(accountId);
          const session = await extractVintedSession(mb.context);
          const api = new VintedApi(session);
          const r = await deleteItemViaApi(api, itemId);
          if (r.ok) return { ok: true };
          log.warn('API delete failed, falling back to UI', { error: r.error });
        } catch (err) {
          log.warn('API delete exception, falling back to UI', { err: String(err) });
        }
      }
    }
    return deactivateListing(externalIdOrUrl, accountId, { mode: 'close' });
  },

  async updatePrice(accountId: number, externalIdOrUrl: string, newPriceEur: number): Promise<UpdatePriceResult> {
    try {
      let itemIdStr = externalIdOrUrl;
      if (externalIdOrUrl.startsWith('http')) {
        const m = externalIdOrUrl.match(/\/items\/(\d+)/);
        if (!m) return { ok: false, error: 'cannot extract item id from URL' };
        itemIdStr = m[1]!;
      }
      const itemIdNum = Number(itemIdStr);

      const useApi = (getSetting('vinted_use_api') ?? 'true') === 'true';
      if (useApi && Number.isFinite(itemIdNum)) {
        try {
          const mb = await getVintedBrowser(accountId);
          const session = await extractVintedSession(mb.context);
          const api = new VintedApi(session);
          const r = await updateItemPriceViaApi(api, itemIdNum, newPriceEur);
          if (r.ok) return { ok: true, newPriceEur };
          log.warn('API price update failed, falling back to UI', { error: r.error });
        } catch (err) {
          log.warn('API price update exception, falling back to UI', { err: String(err) });
        }
      }

      const result = await updateListingPrice(itemIdStr, newPriceEur, accountId);
      return { ok: result.ok, newPriceEur: result.ok ? newPriceEur : undefined, error: result.error };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  },
};
