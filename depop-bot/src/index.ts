// ──────────────────────────────────────────────────────────────────────────────
// Depop-Bot HTTP Server :4705
//
// Depop sits behind Cloudflare Bot Protection. The bot wraps every navigation
// in `cloudflareSafeNavigate()` so the JS interstitial is awaited and Turnstile
// widgets are auto-solved via the existing captcha pipeline (2captcha). When
// Cloudflare hard-blocks the IP, the call returns `blockedBy: 'cloudflare'`
// and the orchestrator can pause the marketplace.
// ──────────────────────────────────────────────────────────────────────────────

import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { chromium } from 'playwright';
import {
  createLogger,
  fingerprintFor,
  stealthInitScript,
  cloudflareLaunchArgs,
  stealthIgnoreDefaultArgs,
  cloudflareSafeNavigate,
  prewarmCloudflareCookies,
  isCloudflareInterstitial,
  waitForCloudflareClear,
  getAccount,
  parseProxyUrl,
  recordHealthEvent,
  MARKETPLACE_REGISTRY,
  type ListingDraft,
  type MarketplaceAdapter,
} from '@vinted-system/shared';
import { SEL_LOGGED_IN } from './selectors.js';
import { createDepopListing } from './listings/create.js';
import { deactivateDepopListing } from './listings/deactivate.js';
import { updateDepopListingPrice } from './listings/update-price.js';
import { pollDepopInbox } from './chats/poll.js';
import { sendDepopMessage, acceptDepopOffer, declineDepopOffer } from './chats/send.js';
import { pollDepopSold } from './chats/sold-poll.js';

const log = createLogger('depop-bot');
const PORT = Number(process.env.DEPOP_BOT_PORT ?? 4705);
const DATA_ROOT = process.env.DEPOP_DATA_ROOT
  ?? path.join(process.cwd(), 'data', 'depop-accounts');

const DEPOP_HOME = 'https://www.depop.com/';
const DEPOP_LOGIN = 'https://www.depop.com/login/';

// Same Chrome.app candidates the shared browser launcher checks. We prefer
// REAL Chrome over Playwright's bundled Chromium because Depop's anti-bot
// fingerprints "Google Chrome for Testing" (different binary name, missing
// internal pages). Falls back to bundled if Chrome isn't installed OR if
// macOS Launch-Services consolidates our launch into an already-open Chrome
// session (which kills our spawned PID).
const CHROME_PATHS = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome-stable',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
];
const realChrome = CHROME_PATHS.find((p) => fs.existsSync(p));

async function launch(accountId: number, headless = true) {
  const fp = fingerprintFor(accountId, 'depop');
  const dir = path.join(DATA_ROOT, String(accountId), 'chromium-profile');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  // When headful (login flow), force a visible window-position on the primary
  // display so the user always sees it. Without this, Chrome on macOS may
  // open the window outside the visible area or behind other apps.
  const extraArgs = headless ? [] : [
    '--window-position=120,80',
    '--window-size=1280,860',
  ];

  // Residential proxy: per-account, read from DB. NULL → direct.
  const acc = getAccount(accountId);
  const proxyUrl = acc?.proxy_url ?? undefined;
  const proxyOpt = proxyUrl
    ? parseProxyUrl(proxyUrl, `depop-bot-${accountId}`)
    : undefined;
  if (proxyOpt) {
    log.info('Depop proxy configured', { accountId, server: new URL(proxyUrl!).host, hasAuth: !!proxyOpt.username });
  }

  const baseOpts = {
    headless,
    userAgent: fp.userAgent,
    viewport: fp.viewport,
    locale: fp.locale,
    timezoneId: fp.timezoneId,
    // Strip Playwright's auto-injected --enable-automation flag (would
    // set navigator.webdriver=true and tell Cloudflare we're a bot).
    ignoreDefaultArgs: stealthIgnoreDefaultArgs(),
    // Cloudflare-safe Chromium flags (covers AutomationControlled removal,
    // realistic sandboxing, no first-run banners, etc.) + visible window
    // when running the headful login flow.
    args: [...cloudflareLaunchArgs(), ...extraArgs],
    // Sync HTTP headers to fingerprint locale
    extraHTTPHeaders: {
      'Accept-Language': `${fp.locale},${fp.locale.split('-')[0]};q=0.9,en;q=0.8`,
    },
    ...(proxyOpt ? { proxy: proxyOpt } : {}),
  };

  let ctx;
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
      log.warn('Real Chrome conflicted with existing session — falling back to bundled Chromium');
      ctx = await chromium.launchPersistentContext(dir, baseOpts);
    } else {
      throw err;
    }
  }

  await ctx.addInitScript(stealthInitScript(fp));
  return ctx;
}

export const depopAdapter: MarketplaceAdapter = {
  meta: MARKETPLACE_REGISTRY.depop,

  async isAuthenticated(accountId) {
    const ctx = await launch(accountId, true);
    try {
      const page = await ctx.newPage();
      const nav = await cloudflareSafeNavigate(page, DEPOP_HOME, { timeoutMs: 25_000 });
      if (!nav.ok) {
        // CF blocked us — treat as "not authenticated" so the orchestrator
        // surfaces the login flow (which will trigger a clearance build).
        log.warn('isAuthenticated: navigation failed', { error: nav.error });
        // Record a health-event so repeated CF blocks can auto-pause this
        // account via the watcher. CF blocks are essentially a proxy-down
        // signal at the network layer.
        recordHealthEvent(
          accountId,
          nav.blockedBy === 'cloudflare' ? 'proxy_down' : 'session_lost',
          'warn',
          `Depop nav failed: ${nav.error ?? 'unknown'}`,
        );
        await page.close();
        return false;
      }
      const ok = await SEL_LOGGED_IN.exists(page);
      if (!ok) {
        recordHealthEvent(accountId, 'session_lost', 'warn', 'Depop session not authenticated');
      }
      await page.close();
      return ok;
    } finally { await ctx.close(); }
  },

  async login(accountId) {
    // Login flow always runs visible so the user can solve any Cloudflare
    // interactive challenge with one click. We pre-warm cookies on the
    // homepage first to look less like a cold connection.
    const ctx = await launch(accountId, false);
    try {
      const page = await ctx.newPage();

      // 1. Pre-warm: visit homepage so cf_clearance + __cf_bm exist before
      //    the login form ever loads. Big reduction in challenge rate.
      await prewarmCloudflareCookies(page, DEPOP_HOME);

      // 2. Go to login. If CF intercepts here, wait it out.
      const nav = await cloudflareSafeNavigate(page, DEPOP_LOGIN, { timeoutMs: 30_000 });
      if (!nav.ok) {
        if (nav.blockedBy === 'cloudflare') {
          return {
            ok: false,
            error: 'Cloudflare blockt — bitte später erneut versuchen oder Residential-Proxy aktivieren.',
            blockedBy: 'cloudflare' as const,
          };
        }
        return { ok: false, error: nav.error };
      }

      // 3. Wait for the user to actually log in (10 min window).
      const deadline = Date.now() + 600_000;
      while (Date.now() < deadline) {
        // Re-check for a CF interstitial that may pop up *during* login
        if (await isCloudflareInterstitial(page)) {
          await waitForCloudflareClear(page, { timeoutMs: 60_000 });
        }
        if (await SEL_LOGGED_IN.exists(page)) {
          await page.close();
          return { ok: true };
        }
        await page.waitForTimeout(2000);
      }
      return { ok: false, error: 'login timeout — Browser-Fenster geschlossen oder kein Login innerhalb 10 min' };
    } finally { await ctx.close(); }
  },

  async publish(accountId: number, draft: ListingDraft) {
    const ctx = await launch(accountId, false);
    try {
      const page = await ctx.newPage();

      // Pre-warm cookies if this is a cold context (cheap if already warm)
      await prewarmCloudflareCookies(page, DEPOP_HOME);

      // Navigate to homepage to verify auth + auto-handle CF
      const nav = await cloudflareSafeNavigate(page, DEPOP_HOME, { timeoutMs: 25_000 });
      if (!nav.ok) {
        await page.close();
        return {
          ok: false,
          error: nav.error,
          blockedBy: nav.blockedBy === 'cloudflare' ? ('cloudflare' as const) : undefined,
        };
      }

      if (!(await SEL_LOGGED_IN.exists(page))) {
        await page.close();
        return { ok: false, error: 'not authenticated', blockedBy: 'login' as const };
      }

      const result = await createDepopListing(page, draft);
      log.info('Publish done', { folderNum: draft.folderNum, ok: result.ok });
      await page.close();
      return result;
    } finally {
      await ctx.close();
    }
  },

  async deactivate(accountId: number, externalIdOrUrl: string) {
    const ctx = await launch(accountId, true);
    try {
      const page = await ctx.newPage();
      const nav = await cloudflareSafeNavigate(page, DEPOP_HOME, { timeoutMs: 25_000 });
      if (!nav.ok) {
        await page.close();
        return { ok: false, error: nav.error };
      }
      if (!(await SEL_LOGGED_IN.exists(page))) {
        await page.close();
        return { ok: false, error: 'not authenticated' };
      }
      const result = await deactivateDepopListing(page, externalIdOrUrl);
      await page.close();
      return result;
    } finally {
      await ctx.close();
    }
  },

  async updatePrice(accountId: number, externalIdOrUrl: string, newPrice: number) {
    const ctx = await launch(accountId, true);
    try {
      const page = await ctx.newPage();
      const nav = await cloudflareSafeNavigate(page, DEPOP_HOME, { timeoutMs: 25_000 });
      if (!nav.ok) {
        await page.close();
        return { ok: false, error: nav.error };
      }
      if (!(await SEL_LOGGED_IN.exists(page))) {
        await page.close();
        return { ok: false, error: 'not authenticated' };
      }
      const result = await updateDepopListingPrice(page, externalIdOrUrl, newPrice);
      await page.close();
      return result;
    } finally {
      await ctx.close();
    }
  },
};

const app = express();
app.use(express.json({ limit: '10mb' }));

app.get('/api/health', (_req, res) => res.json({ ok: true, marketplace: 'depop', port: PORT }));

app.get('/api/auth/status', async (req, res) => {
  try { res.json({ ok: await depopAdapter.isAuthenticated(Number(req.query.account_id ?? 1)) }); }
  catch (e) { res.status(500).json({ error: String(e) }); }
});

app.post('/api/auth/login', async (req, res) => {
  try { res.json(await depopAdapter.login(Number(req.body?.account_id ?? 1))); }
  catch (e) { res.status(500).json({ error: String(e) }); }
});

app.post('/api/listings/publish', async (req, res) => {
  try { res.json(await depopAdapter.publish(Number(req.body?.account_id ?? 1), req.body?.draft)); }
  catch (e) { res.status(500).json({ error: String(e) }); }
});

app.post('/api/listings/deactivate', async (req, res) => {
  const accountId = Number(req.body?.account_id ?? 1);
  const externalIdOrUrl = String(req.body?.externalId ?? req.body?.url ?? '');
  if (!externalIdOrUrl) return res.status(400).json({ ok: false, error: 'externalId or url required' });
  try { res.json(await depopAdapter.deactivate(accountId, externalIdOrUrl)); }
  catch (e) { res.status(500).json({ ok: false, error: String(e) }); }
});

app.post('/api/listings/update-price', async (req, res) => {
  const accountId = Number(req.body?.account_id ?? 1);
  const externalIdOrUrl = String(req.body?.externalId ?? req.body?.url ?? '');
  const newPrice = Number(req.body?.newPrice ?? req.body?.price);
  if (!externalIdOrUrl) return res.status(400).json({ ok: false, error: 'externalId or url required' });
  if (!Number.isFinite(newPrice) || newPrice <= 0) return res.status(400).json({ ok: false, error: 'newPrice must be positive number' });
  try { res.json(await depopAdapter.updatePrice(accountId, externalIdOrUrl, newPrice)); }
  catch (e) { res.status(500).json({ ok: false, error: String(e) }); }
});

// ── Chats / Inbox ─────────────────────────────────────────────────────────────
app.post('/api/chats/poll', async (req, res) => {
  const accountId = Number(req.body?.account_id ?? 1);
  const ctx = await launch(accountId, true).catch((e) => { res.status(500).json({ error: String(e) }); return null; });
  if (!ctx) return;
  try {
    const stats = await pollDepopInbox(accountId, ctx);
    res.json({ ok: true, ...stats });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  } finally {
    await ctx.close();
  }
});

app.post('/api/chats/:convId/send', async (req, res) => {
  const accountId = Number(req.body?.account_id ?? 1);
  const body = String(req.body?.body ?? '');
  const ctx = await launch(accountId, true).catch((e) => { res.status(500).json({ error: String(e) }); return null; });
  if (!ctx) return;
  try {
    const r = await sendDepopMessage(ctx, req.params.convId, body);
    res.json(r);
  } finally { await ctx.close(); }
});

app.post('/api/offers/:convId/accept', async (req, res) => {
  const accountId = Number(req.body?.account_id ?? 1);
  const ctx = await launch(accountId, true).catch((e) => { res.status(500).json({ error: String(e) }); return null; });
  if (!ctx) return;
  try {
    const r = await acceptDepopOffer(ctx, req.params.convId);
    res.json(r);
  } finally { await ctx.close(); }
});

app.post('/api/offers/:convId/decline', async (req, res) => {
  const accountId = Number(req.body?.account_id ?? 1);
  const ctx = await launch(accountId, true).catch((e) => { res.status(500).json({ error: String(e) }); return null; });
  if (!ctx) return;
  try {
    const r = await declineDepopOffer(ctx, req.params.convId);
    res.json(r);
  } finally { await ctx.close(); }
});

// ── Sold-Item Detection ───────────────────────────────────────────────────────
app.post('/api/sold/poll', async (req, res) => {
  const accountId = Number(req.body?.account_id ?? 1);
  const ctx = await launch(accountId, true).catch((e) => { res.status(500).json({ error: String(e) }); return null; });
  if (!ctx) return;
  try {
    const stats = await pollDepopSold(accountId, ctx);
    res.json({ ok: true, ...stats });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  } finally {
    await ctx.close();
  }
});

// Reset a chromium profile (used by the dashboard when CF burns the IP and
// fresh cookies are needed).
app.post('/api/auth/reset-profile', (req, res) => {
  try {
    const id = Number(req.body?.account_id ?? 1);
    const dir = path.join(DATA_ROOT, String(id), 'chromium-profile');
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
      log.warn('Profile reset', { accountId: id });
    }
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// Probe Cloudflare status without persisting auth — useful for the dashboard
// to show a "CF healthy / CF blocked" badge.
app.get('/api/cloudflare/probe', async (req, res) => {
  const accountId = Number(req.query.account_id ?? 1);
  const ctx = await launch(accountId, true).catch((e) => { res.status(500).json({ ok: false, error: String(e) }); return null; });
  if (!ctx) return;
  try {
    const page = await ctx.newPage();
    const r = await cloudflareSafeNavigate(page, DEPOP_HOME, { timeoutMs: 25_000 });
    await page.close();
    res.json({
      ok: r.ok,
      cloudflare: r.ok ? 'clear' : (r.blockedBy === 'cloudflare' ? 'blocked' : 'unknown'),
      error: r.ok ? undefined : r.error,
    });
  } finally {
    await ctx.close();
  }
});

app.listen(PORT, () => log.info(`Depop-Bot listening on :${PORT}`));
