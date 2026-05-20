// ──────────────────────────────────────────────────────────────────────────────
// Cloudflare Bot Protection — detection + bypass
//
// Cloudflare guards Depop, some Mercari endpoints, Grailed, Vestiaire and many
// others with a layered stack:
//
//   1. JS-Challenge ("Just a moment…") — auto-passes when Chromium executes the
//      JS within a few seconds. Our stealth init script + persistent context
//      handle this >95% of the time.
//   2. Managed-Challenge / Turnstile — visible CAPTCHA widget. Solved via our
//      existing detectAndSolveCaptcha() (2captcha "turnstile" task type).
//   3. Block (HTTP 403 with `cf-mitigated: block`) — IP is burned. Only fix is
//      a fresh residential IP; we surface this as a fatal error so the
//      orchestrator pauses the marketplace.
//
// Helpers exported:
//   * isCloudflareInterstitial(page)   — true if we're on a Just-a-moment page
//   * waitForCloudflareClear(page)     — poll until the interstitial is gone
//   * isCloudflareBlock(page)          — true if hard-blocked (403)
//   * cloudflareLaunchArgs()           — chromium args that don't trip CF
//   * cloudflareSafeNavigate(page,url) — goto + auto-handle interstitial
// ──────────────────────────────────────────────────────────────────────────────

import type { Page } from 'playwright';
import { createLogger } from '../logger.js';
import { detectAndSolveCaptcha } from './captcha-page.js';
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const log = createLogger('cloudflare');

/** Chromium launch flags that pass Cloudflare's automation heuristics. */
export function cloudflareLaunchArgs(): string[] {
  return [
    // Strip the "controlled by automated test" banner
    '--disable-blink-features=AutomationControlled',
    // Double-down on automation removal — Playwright's default
    // `--enable-automation` is stripped via `stealthIgnoreDefaultArgs()`
    // (which must be passed to launchPersistentContext as
    // `ignoreDefaultArgs`). This adds belt-and-braces at the args level.
    '--exclude-switches=enable-automation',
    // Remove Playwright-default flags that CF flags
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    // Keep features Chrome would have; disable ones that betray automation
    '--disable-features=AutomationControlled,IsolateOrigins,site-per-process,Translate,BackForwardCache,ScriptStreaming',
    // Look like a real user-launched window
    '--no-default-browser-check',
    '--no-first-run',
    '--password-store=basic',
    // Slightly bigger viewport feels more like a desktop
    '--window-size=1440,900',
  ];
}

/**
 * Default-args that Playwright auto-injects but that scream "I'm a bot" to
 * Vinted / Cloudflare / Mercari. Pass this to `launchPersistentContext` as
 * `ignoreDefaultArgs` to strip them.
 *
 *   `--enable-automation` → sets `navigator.webdriver = true` and shows
 *     Chrome's "controlled by automated test software" infobar.
 *   `--enable-blink-features=IdleDetection` → IdleDetection API only ships
 *     on automated builds; its presence is detectable via JS.
 */
export function stealthIgnoreDefaultArgs(): string[] {
  return ['--enable-automation', '--enable-blink-features=IdleDetection'];
}

/** True if the current page is Cloudflare's "Just a moment…" interstitial. */
export async function isCloudflareInterstitial(page: Page): Promise<boolean> {
  try {
    const title = await page.title();
    if (/just a moment|checking your browser|please wait|attention required/i.test(title)) {
      return true;
    }
    // Cloudflare-specific markers in body
    return await page.evaluate(() => {
      const html = document.documentElement.innerHTML;
      return (
        /cf-mitigated|cf-browser-verification|cf-challenge-running|__cf_chl_/.test(html)
        || !!document.querySelector('#challenge-running, .cf-browser-verification, #cf-please-wait')
      );
    }).catch(() => false);
  } catch {
    return false;
  }
}

/** True if Cloudflare is hard-blocking the request (HTTP 403 page). */
export async function isCloudflareBlock(page: Page): Promise<boolean> {
  try {
    const title = await page.title();
    if (/access denied|sorry, you have been blocked/i.test(title)) return true;
    return await page.evaluate(() => {
      const html = document.documentElement.innerHTML;
      return /cf-error-code|Error 1015|Error 1020|cloudflare.*blocked/i.test(html);
    }).catch(() => false);
  } catch {
    return false;
  }
}

interface ClearOptions {
  /** Total time to wait for CF to clear (ms). Default 45s. */
  timeoutMs?: number;
  /** Whether to attempt Turnstile-solve if a widget appears. Default true. */
  solveCaptcha?: boolean;
}

/**
 * Poll until Cloudflare's interstitial clears (it normally redirects within
 * 5–15 s once JS has run). If a Turnstile appears, solve it via the
 * existing captcha pipeline. Returns true if cleared, false on timeout/block.
 */
export async function waitForCloudflareClear(
  page: Page,
  opts: ClearOptions = {},
): Promise<{ cleared: boolean; blocked?: boolean; solved_captcha?: boolean }> {
  const deadline = Date.now() + (opts.timeoutMs ?? 45_000);
  const solveCaptchaEnabled = opts.solveCaptcha !== false;
  let solvedCaptcha = false;

  while (Date.now() < deadline) {
    if (await isCloudflareBlock(page)) {
      log.warn('Cloudflare hard-block detected (1015/1020)');
      return { cleared: false, blocked: true };
    }

    if (!(await isCloudflareInterstitial(page))) {
      // CF cleared on its own
      return { cleared: true, solved_captcha: solvedCaptcha };
    }

    // Interstitial still showing — check for Turnstile widget we can solve
    if (solveCaptchaEnabled) {
      const r = await detectAndSolveCaptcha(page).catch(() => ({ detected: false, solved: false }));
      if (r.detected && r.solved) {
        solvedCaptcha = true;
        // Give CF a moment to redirect after the token is consumed
        await sleep(2500);
        continue;
      }
    }

    // Idle wait — CF's JS challenge usually finishes within 5s
    await sleep(1500);
  }

  log.warn('Cloudflare interstitial did not clear before timeout');
  return { cleared: false };
}

/**
 * Navigate to `url` with built-in Cloudflare handling. Returns ok=true if the
 * final page is the real target (not a CF interstitial / block). On block,
 * `blockedBy: 'cloudflare'` is set so callers can surface to the dashboard.
 */
export async function cloudflareSafeNavigate(
  page: Page,
  url: string,
  opts: { timeoutMs?: number } = {},
): Promise<{ ok: true } | { ok: false; error: string; blockedBy?: 'cloudflare' }> {
  try {
    await page.goto(url, { timeout: opts.timeoutMs ?? 30_000, waitUntil: 'domcontentloaded' });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }

  // Small grace period — CF's JS challenge fires on document-ready
  await sleep(800);

  if (await isCloudflareInterstitial(page)) {
    log.info('Cloudflare interstitial — waiting for clear');
    const r = await waitForCloudflareClear(page);
    if (!r.cleared) {
      return {
        ok: false,
        error: r.blocked ? 'Cloudflare hard-block (IP burned — try residential proxy)' : 'Cloudflare interstitial did not clear',
        blockedBy: 'cloudflare',
      };
    }
    if (r.solved_captcha) log.info('Cloudflare cleared after Turnstile solve');
  }

  if (await isCloudflareBlock(page)) {
    return {
      ok: false,
      error: 'Cloudflare hard-block (IP burned — try residential proxy)',
      blockedBy: 'cloudflare',
    };
  }

  return { ok: true };
}

/**
 * Pre-warm a fresh persistent context by browsing the marketplace homepage
 * before the actual login/publish action. This builds normal cookies (cf_clearance,
 * __cf_bm) and a plausible referrer trail, which makes subsequent requests look
 * less like cold automation.
 *
 * Idempotent: skip if cf_clearance already exists.
 */
export async function prewarmCloudflareCookies(
  page: Page,
  homepageUrl: string,
): Promise<void> {
  try {
    const cookies = await page.context().cookies();
    const hasCfClearance = cookies.some((c) => c.name === 'cf_clearance' && !!c.value);
    if (hasCfClearance) {
      log.debug('cf_clearance already present — skip prewarm');
      return;
    }
    log.info('Prewarming Cloudflare cookies', { homepageUrl });
    const r = await cloudflareSafeNavigate(page, homepageUrl);
    if (!r.ok) {
      log.warn('Prewarm navigation hit Cloudflare', { error: r.error });
      return;
    }
    // Mild scroll + idle — looks like a real user landed
    await page.mouse.move(200, 300).catch(() => undefined);
    await sleep(400);
    await page.mouse.wheel(0, 400).catch(() => undefined);
    await sleep(900);
    await page.mouse.wheel(0, 600).catch(() => undefined);
    await sleep(700);
  } catch (err) {
    log.debug('Prewarm failed (non-fatal)', { error: err instanceof Error ? err.message : String(err) });
  }
}
