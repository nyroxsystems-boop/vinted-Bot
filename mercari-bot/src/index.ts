// ──────────────────────────────────────────────────────────────────────────────
// Mercari-Bot HTTP Server :4704 — Scaffold mit funktionierendem
// Browser+Login, Listing-Publish + MVP-Routes for chats/offers/sales.
//
// Routes mirror the vinted-bot surface so the orchestrator can route uniformly:
//   POST /api/listings/publish
//   POST /api/listings/deactivate
//   POST /api/listings/update-price
//   POST /api/chats/poll
//   POST /api/chats/:convId/send
//   POST /api/offers/:id/accept
//   POST /api/offers/:id/decline
//   POST /api/sold/poll
// ──────────────────────────────────────────────────────────────────────────────

import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import {
  createLogger,
  launchMarketplaceBrowser,
  cloudflareSafeNavigate,
  prewarmCloudflareCookies,
  isCloudflareInterstitial,
  waitForCloudflareClear,
  MARKETPLACE_REGISTRY,
  type ListingDraft,
  type MarketplaceAdapter,
} from '@vinted-system/shared';
import { type BrowserContext } from 'playwright';
import { SEL_LOGGED_IN } from './selectors.js';
import { createMercariListing } from './listings/create.js';
import { deactivateMercariListing } from './listings/deactivate.js';
import { updateMercariListingPrice } from './listings/update-price.js';
import { pollMercariInbox } from './chats/poll.js';
import { sendMercariMessage } from './chats/send.js';
import { acceptMercariOffer } from './offers/accept.js';
import { declineMercariOffer } from './offers/decline.js';
import { scanMercariSold } from './sales/scan.js';

const log = createLogger('mercari-bot');
const PORT = Number(process.env.MERCARI_BOT_PORT ?? 4704);
const DATA_ROOT = process.env.MERCARI_DATA_ROOT
  ?? path.join(process.cwd(), 'data', 'mercari-accounts');

async function launch(accountId: number, headless = true): Promise<BrowserContext> {
  return launchMarketplaceBrowser({
    marketplace: 'mercari',
    accountId,
    dataRoot: DATA_ROOT,
    headless,
  });
}

export const mercariAdapter: MarketplaceAdapter = {
  meta: MARKETPLACE_REGISTRY.mercari,
  async isAuthenticated(accountId) {
    const ctx = await launch(accountId, true);
    try {
      const page = await ctx.newPage();
      const nav = await cloudflareSafeNavigate(page, 'https://www.mercari.com/', { timeoutMs: 25_000 });
      if (!nav.ok) {
        log.warn('isAuthenticated: CF blocked', { error: nav.error });
        await page.close();
        return false;
      }
      const ok = await SEL_LOGGED_IN.exists(page);
      await page.close();
      return ok;
    } finally {
      await ctx.close();
    }
  },
  async login(accountId) {
    const ctx = await launch(accountId, false);
    try {
      const page = await ctx.newPage();
      // Pre-warm on homepage so cf_clearance is set before the login form
      // loads — significantly lowers the challenge rate.
      await prewarmCloudflareCookies(page, 'https://www.mercari.com/');
      const nav = await cloudflareSafeNavigate(page, 'https://www.mercari.com/login/', { timeoutMs: 30_000 });
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
      const deadline = Date.now() + 600_000;
      while (Date.now() < deadline) {
        if (await isCloudflareInterstitial(page)) {
          await waitForCloudflareClear(page, { timeoutMs: 60_000 });
        }
        if (await SEL_LOGGED_IN.exists(page)) {
          await page.close();
          return { ok: true };
        }
        await page.waitForTimeout(2000);
      }
      return { ok: false, error: 'login timeout' };
    } finally {
      await ctx.close();
    }
  },
  async publish(accountId: number, draft: ListingDraft) {
    const ctx = await launch(accountId, false); // headful first time, can flip via env
    try {
      const page = await ctx.newPage();
      await page.goto('https://www.mercari.com/', { timeout: 20_000 }).catch(() => {});
      if (!(await SEL_LOGGED_IN.exists(page))) {
        await page.close();
        return { ok: false, error: 'not authenticated', blockedBy: 'login' as const };
      }
      const result = await createMercariListing(page, draft);
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
      await page.goto('https://www.mercari.com/', { timeout: 20_000 }).catch(() => {});
      if (!(await SEL_LOGGED_IN.exists(page))) {
        await page.close();
        return { ok: false, error: 'not authenticated' };
      }
      const result = await deactivateMercariListing(page, externalIdOrUrl, { mode: 'hide' });
      await page.close();
      return result;
    } finally {
      await ctx.close();
    }
  },
  async updatePrice(accountId: number, externalId: string, newPriceEur: number) {
    const ctx = await launch(accountId, true);
    try {
      return await updateMercariListingPrice(ctx, externalId, newPriceEur);
    } finally {
      await ctx.close();
    }
  },
};

const app = express();
app.use(express.json({ limit: '10mb' }));

// ── Health + auth ────────────────────────────────────────────────────────────
app.get('/api/health', (_req, res) => res.json({ ok: true, marketplace: 'mercari', port: PORT }));

app.get('/api/auth/status', async (req, res) => {
  try { res.json({ ok: await mercariAdapter.isAuthenticated(Number(req.query.account_id ?? 1)) }); }
  catch (e) { res.status(500).json({ error: String(e) }); }
});

app.post('/api/auth/login', async (req, res) => {
  try { res.json(await mercariAdapter.login(Number(req.body?.account_id ?? 1))); }
  catch (e) { res.status(500).json({ error: String(e) }); }
});

// ── Listings ─────────────────────────────────────────────────────────────────
app.post('/api/listings/publish', async (req, res) => {
  try { res.json(await mercariAdapter.publish(Number(req.body?.account_id ?? 1), req.body?.draft)); }
  catch (e) { res.status(500).json({ error: String(e) }); }
});

app.post('/api/listings/deactivate', async (req, res) => {
  const externalId = req.body?.external_id as string | undefined;
  if (!externalId) return res.status(400).json({ ok: false, error: 'missing external_id' });
  try { res.json(await mercariAdapter.deactivate(Number(req.body?.account_id ?? 1), externalId)); }
  catch (e) { res.status(500).json({ ok: false, error: String(e) }); }
});

app.post('/api/listings/update-price', async (req, res) => {
  const externalId = req.body?.external_id as string | undefined;
  const newPriceEur = Number(req.body?.new_price_eur);
  if (!externalId || !Number.isFinite(newPriceEur)) {
    return res.status(400).json({ ok: false, error: 'missing external_id or new_price_eur' });
  }
  try {
    res.json(await mercariAdapter.updatePrice!(
      Number(req.body?.account_id ?? 1),
      externalId,
      newPriceEur,
    ));
  } catch (e) {
    res.status(500).json({ ok: false, error: e instanceof Error ? e.message : String(e) });
  }
});

// ── Chats / Inbox ────────────────────────────────────────────────────────────
app.post('/api/chats/poll', async (req, res) => {
  const accountId = Number(req.body?.account_id ?? 1);
  let ctx: BrowserContext | null = null;
  try {
    ctx = await launch(accountId, true);
    const stats = await pollMercariInbox(accountId, ctx);
    res.json({ ok: true, ...stats });
  } catch (e) {
    res.status(500).json({ ok: false, error: e instanceof Error ? e.message : String(e) });
  } finally {
    if (ctx) await ctx.close().catch(() => null);
  }
});

app.post('/api/chats/:convId/send', async (req, res) => {
  const accountId = Number(req.body?.account_id ?? 1);
  const body = String(req.body?.body ?? '');
  if (!body) return res.status(400).json({ ok: false, error: 'missing body' });
  let ctx: BrowserContext | null = null;
  try {
    ctx = await launch(accountId, true);
    const r = await sendMercariMessage(ctx, req.params.convId, body);
    res.json(r);
  } catch (e) {
    res.status(500).json({ ok: false, error: e instanceof Error ? e.message : String(e) });
  } finally {
    if (ctx) await ctx.close().catch(() => null);
  }
});

// ── Offers ───────────────────────────────────────────────────────────────────
app.post('/api/offers/:id/accept', async (req, res) => {
  const accountId = Number(req.body?.account_id ?? 1);
  let ctx: BrowserContext | null = null;
  try {
    ctx = await launch(accountId, true);
    const r = await acceptMercariOffer(ctx, req.params.id);
    res.json(r);
  } catch (e) {
    res.status(500).json({ ok: false, error: e instanceof Error ? e.message : String(e) });
  } finally {
    if (ctx) await ctx.close().catch(() => null);
  }
});

app.post('/api/offers/:id/decline', async (req, res) => {
  const accountId = Number(req.body?.account_id ?? 1);
  let ctx: BrowserContext | null = null;
  try {
    ctx = await launch(accountId, true);
    const r = await declineMercariOffer(ctx, req.params.id);
    res.json(r);
  } catch (e) {
    res.status(500).json({ ok: false, error: e instanceof Error ? e.message : String(e) });
  } finally {
    if (ctx) await ctx.close().catch(() => null);
  }
});

// ── Sold-Item Detection ──────────────────────────────────────────────────────
app.post('/api/sold/poll', async (req, res) => {
  const accountId = Number(req.body?.account_id ?? 1);
  let ctx: BrowserContext | null = null;
  try {
    ctx = await launch(accountId, true);
    const stats = await scanMercariSold(accountId, ctx);
    res.json({ ok: true, ...stats });
  } catch (e) {
    res.status(500).json({ ok: false, error: e instanceof Error ? e.message : String(e) });
  } finally {
    if (ctx) await ctx.close().catch(() => null);
  }
});

app.listen(PORT, () => log.info(`Mercari-Bot listening on :${PORT}`));
