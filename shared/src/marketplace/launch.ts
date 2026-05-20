// ──────────────────────────────────────────────────────────────────────────────
// Shared marketplace-browser launcher.
//
// All marketplace bots (depop, mercari, wallapop, etsy, grailed, …) share the
// same launch pattern:
//   1. Persistent Chromium profile under <DATA_ROOT>/<accountId>/chromium-profile
//   2. Per-account fingerprint (UA, viewport, locale, timezone)
//   3. Cloudflare-safe Chromium flags + stealth init script
//   4. Real Chrome (Google Chrome.app) when available — bundled Playwright
//      Chromium is fingerprintable by anti-bot systems ("Chrome for Testing"
//      shows up in process paths and missing internal pages).
//   5. Auto-fallback to bundled Chromium when macOS Launch-Services merges
//      our spawned PID into the user's already-open Chrome (the spawned PID
//      dies and Playwright reports "Target page, context or browser has been
//      closed").
//   6. When launched headful (login flow), force visible window position so
//      the user always sees it.
//
// Previously each bot reimplemented this differently and drifted — Depop got
// the Real-Chrome fallback, Mercari got nothing, etc. This helper centralizes
// it.
// ──────────────────────────────────────────────────────────────────────────────

import { chromium, type BrowserContext } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import {
  fingerprintFor,
  stealthInitScript,
  stealthIgnoreDefaultArgs,
  cloudflareLaunchArgs,
} from '../index.js';
import { createLogger } from '../logger.js';

const log = createLogger('mp-launch');

const CHROME_PATHS = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',           // macOS
  '/usr/bin/google-chrome-stable',                                          // Linux
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',             // Windows
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
];

function detectRealChrome(): string | undefined {
  return CHROME_PATHS.find((p) => fs.existsSync(p));
}

export interface MarketplaceLaunchOpts {
  /** Marketplace id used as fingerprint scope (e.g. "depop", "mercari"). */
  marketplace: string;
  /** Account id (1, 2, …) — used both for fingerprint and profile-dir name. */
  accountId: number;
  /** Root dir for `<accountId>/chromium-profile` subdir. */
  dataRoot: string;
  /** Headless? `true` for status-checks, `false` for the login flow. */
  headless: boolean;
  /**
   * Optional proxy URL. If not provided, reads `<MARKETPLACE>_PROXY` env var
   * — useful when CF / marketplace anti-bot blocks the user's residential IP
   * (notably Depop + Mercari from non-US IPs).
   * Format: `http://user:pass@host:port` or `socks5://...`.
   */
  proxyUrl?: string;
}

/**
 * Launch a Chromium browser context preconfigured for marketplace scraping.
 *
 * - Real Chrome first, bundled Chromium fallback on consolidation conflict.
 * - Cloudflare-safe flags + stealth init script.
 * - Per-account persistent profile + locale-aware HTTP headers.
 * - Visible window position when `headless: false`.
 */
export async function launchMarketplaceBrowser(opts: MarketplaceLaunchOpts): Promise<BrowserContext> {
  const fp = fingerprintFor(opts.accountId, opts.marketplace);
  const dir = path.join(opts.dataRoot, String(opts.accountId), 'chromium-profile');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  // When headful (login flow), force a visible window position on the primary
  // display so the user always sees the browser. Without this, Chrome on macOS
  // can open windows outside visible area or behind other apps.
  const extraArgs = opts.headless ? [] : [
    '--window-position=120,80',
    '--window-size=1280,860',
  ];

  // Proxy: explicit arg wins, else env-var fallback. Lets users configure
  // residential proxies per-marketplace without code changes.
  const envProxy = process.env[`${opts.marketplace.toUpperCase()}_PROXY`];
  const proxyUrl = opts.proxyUrl ?? envProxy;

  const baseOpts = {
    headless: opts.headless,
    userAgent: fp.userAgent,
    viewport: fp.viewport,
    locale: fp.locale,
    timezoneId: fp.timezoneId,
    // Strip Playwright's auto-injected --enable-automation flag (would set
    // navigator.webdriver=true and tell Cloudflare we're a bot).
    ignoreDefaultArgs: stealthIgnoreDefaultArgs(),
    // Cloudflare-safe Chromium flags + visible window when headful.
    args: [...cloudflareLaunchArgs(), ...extraArgs],
    extraHTTPHeaders: {
      'Accept-Language': `${fp.locale},${fp.locale.split('-')[0]};q=0.9,en;q=0.8`,
    },
    ...(proxyUrl ? { proxy: { server: proxyUrl } } : {}),
  };
  if (proxyUrl) {
    log.info(`${opts.marketplace}: using proxy`, { server: proxyUrl.replace(/(:\/\/)[^@]+@/, '$1***@') });
  }

  const realChrome = detectRealChrome();
  let ctx: BrowserContext;

  try {
    ctx = await chromium.launchPersistentContext(dir, {
      ...baseOpts,
      ...(realChrome ? { executablePath: realChrome } : {}),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // macOS Launch-Services consolidation: Real-Chrome path was used but
    // the spawned PID died immediately because Chrome merged into an
    // existing session. Fall back to bundled Chromium.
    if (realChrome && /Target page, context or browser has been closed/i.test(msg)) {
      log.warn(`${opts.marketplace}: Real Chrome conflicted with existing session — falling back to bundled Chromium`);
      ctx = await chromium.launchPersistentContext(dir, baseOpts);
    } else {
      throw err;
    }
  }

  await ctx.addInitScript(stealthInitScript(fp));
  return ctx;
}
