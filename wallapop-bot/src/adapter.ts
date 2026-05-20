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
import { launchWpBrowser } from './browser.js';
import { isLoggedIn, performInteractiveLogin } from './login-flow.js';
import { createWallapopListing } from './listings/create.js';
import { deactivateWallapopListing } from './listings/deactivate.js';
import { updateWallapopListingPrice } from './listings/update-price.js';

const log = createLogger('wp-adapter');

const DATA_ROOT = process.env.WP_DATA_ROOT
  ?? path.join(process.cwd(), 'data', 'wallapop-accounts');

function storageDirFor(accountId: number): string {
  return path.join(DATA_ROOT, String(accountId));
}

export const wallapopAdapter: MarketplaceAdapter = {
  meta: MARKETPLACE_REGISTRY.wallapop,

  async isAuthenticated(accountId) {
    const browser = await launchWpBrowser({
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
    return { ok: result.ok, error: result.error };
  },

  async publish(accountId: number, draft: ListingDraft): Promise<PublishResult> {
    const browser = await launchWpBrowser({
      accountId,
      storageDir: storageDirFor(accountId),
      headless: false,
    });
    try {
      const page = await browser.context.newPage();
      if (!(await isLoggedIn(page))) {
        await page.close();
        return { ok: false, error: 'not authenticated', blockedBy: 'login' };
      }
      const result = await createWallapopListing(page, draft);
      log.info('Publish done', { folderNum: draft.folderNum, ok: result.ok });
      await page.close();
      return result;
    } finally {
      await browser.close();
    }
  },

  async deactivate(accountId: number, externalIdOrUrl: string): Promise<DeactivateResult> {
    const browser = await launchWpBrowser({
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
      const result = await deactivateWallapopListing(page, externalIdOrUrl, { mode: 'reserve' });
      await page.close();
      return result;
    } finally {
      await browser.close();
    }
  },

  async updatePrice(accountId: number, externalId: string, newPriceEur: number): Promise<UpdatePriceResult> {
    const browser = await launchWpBrowser({
      accountId,
      storageDir: storageDirFor(accountId),
      headless: true,
    });
    try {
      return await updateWallapopListingPrice(browser.context, externalId, newPriceEur);
    } finally {
      await browser.close();
    }
  },
};
