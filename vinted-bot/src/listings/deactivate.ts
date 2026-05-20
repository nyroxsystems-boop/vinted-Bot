// ──────────────────────────────────────────────────────────────────────────────
// Vinted-Listing deaktivieren / archivieren.
//
// Vinted hat keine "Deaktivieren" Option im klassischen Sinn — wir benutzen
// "Schließen / Geschlossen" (Item nicht mehr verkäuflich) oder "Löschen".
// Default: schließen (reversibel). Wenn nicht möglich → löschen.
//
// Wird vom MarketplaceAdapter.deactivate() bei Cross-Platform-Sales gerufen.
// ──────────────────────────────────────────────────────────────────────────────

import type { Page } from 'playwright';
import {
  createLogger,
  retry,
  chain,
  type DeactivateResult,
} from '@vinted-system/shared';
import { getVintedBrowser } from '../browser.js';

const log = createLogger('vinted-listing-deactivate');

const BASE_URL = process.env.VINTED_BASE_URL ?? 'https://www.vinted.de';

// Selector-Chains für Item-Action-Menü.
const SEL_ITEM_ACTIONS_MENU = chain('vinted:item-actions-menu',
  '[data-testid="item-page__actions-menu"]',
  'button[aria-label*="Aktionen" i]',
  'button[aria-haspopup="menu"]:near(:text("Verkaufen"))',
  'button:has(svg[aria-label*="more" i])',
);

const SEL_CLOSE_ITEM = chain('vinted:close-item',
  '[data-testid="item-actions-close-button"]',
  'button:has-text("Schließen")',
  'button:has-text("Verkauft")',
  'button:has-text("Als verkauft markieren")',
);

const SEL_DELETE_ITEM = chain('vinted:delete-item',
  '[data-testid="item-actions-delete-button"]',
  'button:has-text("Löschen")',
  'a:has-text("Löschen")',
);

const SEL_CONFIRM_DELETE = chain('vinted:confirm-delete',
  '[data-testid="confirm-delete-button"]',
  'button:has-text("Bestätigen")',
  'button:has-text("Ja, löschen")',
);

function itemUrlFromInput(input: string): string {
  if (input.startsWith('http')) return input;
  // numeric id → /items/<id>
  if (/^\d+$/.test(input)) return `${BASE_URL}/items/${input}`;
  return `${BASE_URL}${input.startsWith('/') ? '' : '/'}${input}`;
}

export async function deactivateListing(
  itemRef: string,
  accountId: number,
  opts: { mode?: 'close' | 'delete' } = {},
): Promise<DeactivateResult> {
  const mode = opts.mode ?? 'close';
  const url = itemUrlFromInput(itemRef);
  log.info('Deactivating Vinted listing', { itemRef, accountId, mode });

  const mb = await getVintedBrowser(accountId);
  const page = await mb.context.newPage();

  try {
    await retry(
      async () => {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
        if (page.url().includes('/login') || page.url().includes('/member/signup')) {
          throw new Error('not authenticated');
        }
      },
      {
        attempts: 2,
        label: 'goto-item',
        abortIf: (e) => /not authenticated/.test(String(e)),
      },
    );

    if (page.url().includes('/login')) {
      return { ok: false, error: 'not authenticated' };
    }

    // Open the actions menu
    try {
      await SEL_ITEM_ACTIONS_MENU.click(page);
      await page.waitForTimeout(400);
    } catch (err) {
      return {
        ok: false,
        error: `actions-menu not found: ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    if (mode === 'close') {
      try {
        await SEL_CLOSE_ITEM.click(page);
        await page.waitForTimeout(800);
        log.info('Vinted listing closed', { itemRef });
        return { ok: true };
      } catch {
        log.warn('close-button not available, falling through to delete', { itemRef });
      }
    }

    // Fallback: delete
    try {
      await SEL_DELETE_ITEM.click(page);
      await page.waitForTimeout(400);
      try { await SEL_CONFIRM_DELETE.click(page); } catch { /* maybe no confirm */ }
      await page.waitForTimeout(800);
      log.info('Vinted listing deleted', { itemRef });
      return { ok: true };
    } catch (err) {
      return {
        ok: false,
        error: `neither close nor delete worked: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  } finally {
    await page.close().catch(() => null);
  }
}
