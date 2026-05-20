// ──────────────────────────────────────────────────────────────────────────────
// Account-scoped Etsy Playwright launcher.
//
// Etsy doesn't use Cloudflare hard-blocks like Grailed/Depop, so this is a
// thin wrapper around chromium.launchPersistentContext.
//
// We export a `launchEtsy(accountId, headless)` helper that all modules
// (publish, poll, send, scan, update-price, selftest) share, plus a
// `withEtsyPage(accountId, fn)` convenience for the common pattern
// "launch ctx → newPage → run → close everything".
// ──────────────────────────────────────────────────────────────────────────────

import path from 'node:path';
import fs from 'node:fs';
import { chromium, type BrowserContext, type Page } from 'playwright';
import {
  fingerprintFor,
  stealthInitScript,
  stealthIgnoreDefaultArgs,
  cloudflareLaunchArgs,
} from '@vinted-system/shared';

export const ETSY_BASE_URL = process.env.ETSY_BASE_URL ?? 'https://www.etsy.com';

const DATA_ROOT = process.env.ETSY_DATA_ROOT
  ?? path.join(process.cwd(), 'data', 'etsy-accounts');

export const SEL_LOGGED_IN_INDICATOR = '[data-test-id="header-user-menu"], a[href*="/your/account"], button[aria-label*="account" i]';

export async function launchEtsy(accountId: number, headless = true): Promise<BrowserContext> {
  const fp = fingerprintFor(accountId, 'etsy');
  const dir = path.join(DATA_ROOT, String(accountId), 'chromium-profile');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const ctx = await chromium.launchPersistentContext(dir, {
    headless,
    userAgent: fp.userAgent,
    viewport: fp.viewport,
    locale: fp.locale,
    timezoneId: fp.timezoneId,
    ignoreDefaultArgs: stealthIgnoreDefaultArgs(),
    args: cloudflareLaunchArgs(),
  });
  await ctx.addInitScript(stealthInitScript(fp));
  return ctx;
}

export async function isEtsyLoggedIn(page: Page): Promise<boolean> {
  try {
    // Best-effort: try several known logged-in indicators with a short timeout.
    // TODO: validate selector against live site — Etsy changes header markup
    // a few times per year.
    await page.waitForSelector(SEL_LOGGED_IN_INDICATOR, { timeout: 5_000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Convenience helper: launch a context, open a page, run fn, then clean up.
 * Use this when the caller does NOT need to share the context across calls.
 */
export async function withEtsyPage<T>(
  accountId: number,
  fn: (page: Page, ctx: BrowserContext) => Promise<T>,
  opts: { headless?: boolean } = {},
): Promise<T> {
  const ctx = await launchEtsy(accountId, opts.headless ?? true);
  const page = await ctx.newPage();
  try {
    return await fn(page, ctx);
  } finally {
    await page.close().catch(() => null);
    await ctx.close().catch(() => null);
  }
}
