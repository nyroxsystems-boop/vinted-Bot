// ──────────────────────────────────────────────────────────────────────────────
// Account-scoped Grailed Playwright launcher.
//
// Grailed sits behind Cloudflare. All navigations go through
// `cloudflareSafeNavigate` (shared/src/marketplace/cloudflare.ts) which:
//   1. Detects interstitial challenges + waits/solves Turnstile
//   2. Hard-fails when the IP is burned (so we surface this clearly)
//
// We export a `launchGrailed(accountId, headless)` helper and a
// `withGrailedPage(accountId, fn)` convenience for ad-hoc page work.
// ──────────────────────────────────────────────────────────────────────────────

import path from 'node:path';
import fs from 'node:fs';
import { chromium, type BrowserContext, type Page } from 'playwright';
import {
  fingerprintFor,
  stealthInitScript,
  cloudflareLaunchArgs,
  stealthIgnoreDefaultArgs,
  prewarmCloudflareCookies,
} from '@vinted-system/shared';

export const GRAILED_BASE_URL = process.env.GRAILED_BASE_URL ?? 'https://www.grailed.com';

const DATA_ROOT = process.env.GRAILED_DATA_ROOT
  ?? path.join(process.cwd(), 'data', 'grailed-accounts');

export const SEL_LOGGED_IN_INDICATOR = [
  '[data-testid="header-avatar"]',
  'a[href="/users/myitems"]',
  'a[href*="/users/" i][href*="/myitems"]',
  '[data-testid="user-menu"]',
  '[class*="header" i] img[alt*="avatar" i]',
].join(', ');

export async function launchGrailed(accountId: number, headless = true): Promise<BrowserContext> {
  const fp = fingerprintFor(accountId, 'grailed');
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

export async function isGrailedLoggedIn(page: Page): Promise<boolean> {
  try {
    await page.waitForSelector(SEL_LOGGED_IN_INDICATOR, { timeout: 5_000 });
    return true;
  } catch {
    return false;
  }
}

/** Pre-warm the context with a homepage visit so cf_clearance is set. */
export async function prewarmGrailed(page: Page): Promise<void> {
  await prewarmCloudflareCookies(page, GRAILED_BASE_URL).catch(() => null);
}

export async function withGrailedPage<T>(
  accountId: number,
  fn: (page: Page, ctx: BrowserContext) => Promise<T>,
  opts: { headless?: boolean } = {},
): Promise<T> {
  const ctx = await launchGrailed(accountId, opts.headless ?? true);
  const page = await ctx.newPage();
  try {
    return await fn(page, ctx);
  } finally {
    await page.close().catch(() => null);
    await ctx.close().catch(() => null);
  }
}
