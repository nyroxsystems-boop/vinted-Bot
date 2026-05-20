// ──────────────────────────────────────────────────────────────────────────────
// Kleinanzeigen Marketplace-Adapter — implementiert das gemeinsame Interface.
// ──────────────────────────────────────────────────────────────────────────────

import path from 'node:path';
import {
  createLogger,
  MARKETPLACE_REGISTRY,
  type DeactivateResult,
  type ListingDraft,
  type MarketplaceAdapter,
  type PublishResult,
  type UpdatePriceResult,
} from '@vinted-system/shared';
import { launchKaBrowser } from './browser.js';
import { isLoggedIn, performInteractiveLogin } from './login-flow.js';
import { createKleinanzeigenListing } from './listings/create.js';
import { deactivateKleinanzeigenListing } from './listings/deactivate.js';
import { updatePriceKleinanzeigen } from './listings/update-price.js';

const log = createLogger('ka-adapter');

const DATA_ROOT = process.env.KA_DATA_ROOT
  ?? path.join(process.cwd(), 'data', 'kleinanzeigen-accounts');

function storageDirFor(accountId: number): string {
  return path.join(DATA_ROOT, String(accountId));
}

export const kleinanzeigenAdapter: MarketplaceAdapter = {
  meta: MARKETPLACE_REGISTRY.kleinanzeigen,

  async isAuthenticated(accountId) {
    const browser = await launchKaBrowser({
      accountId,
      storageDir: storageDirFor(accountId),
      headless: true,
    });
    try {
      const page = await browser.context.newPage();
      const ok = await isLoggedIn(page);
      await page.close();
      return ok;
    } finally {
      await browser.close();
    }
  },

  async login(accountId) {
    const result = await performInteractiveLogin({
      accountId,
      storageDir: storageDirFor(accountId),
    });
    try { await result.browser.close(); } catch { /* ignore */ }
    // Notify orchestrator so Home page sees "eingeloggt" without a poll
    if (result.ok) {
      fetch('http://localhost:4700/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kleinanzeigen_logged_in: 'true' }),
        signal: AbortSignal.timeout(5000),
      }).catch(() => { /* orchestrator might be offline; flag will sync next time */ });
    }
    return { ok: result.ok, error: result.error };
  },

  async publish(accountId: number, draft: ListingDraft): Promise<PublishResult> {
    const browser = await launchKaBrowser({
      accountId,
      storageDir: storageDirFor(accountId),
      headless: false, // beim ersten Mal headful; später konfigurierbar
    });
    try {
      const page = await browser.context.newPage();
      if (!(await isLoggedIn(page))) {
        await page.close();
        return { ok: false, error: 'not authenticated', blockedBy: 'login' };
      }
      const result = await createKleinanzeigenListing(page, draft);
      log.info('Publish done', { folderNum: draft.folderNum, ok: result.ok });
      await page.close();
      return result;
    } finally {
      await browser.close();
    }
  },

  async deactivate(accountId: number, externalIdOrUrl: string): Promise<DeactivateResult> {
    const externalUrl = externalIdOrUrl.startsWith('http')
      ? externalIdOrUrl
      : `https://www.kleinanzeigen.de/s-anzeige/${externalIdOrUrl}`;
    const browser = await launchKaBrowser({
      accountId,
      storageDir: storageDirFor(accountId),
      headless: true,
    });
    try {
      const page = await browser.context.newPage();
      if (!(await isLoggedIn(page))) {
        await page.close();
        return { ok: false, error: 'not authenticated' };
      }
      const result = await deactivateKleinanzeigenListing(page, externalUrl);
      await page.close();
      return result;
    } finally {
      await browser.close();
    }
  },

  async updatePrice(accountId: number, externalIdOrUrl: string, newPriceEur: number): Promise<UpdatePriceResult> {
    return updatePriceKleinanzeigen(accountId, DATA_ROOT, externalIdOrUrl, newPriceEur);
  },
};
