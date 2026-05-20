// ──────────────────────────────────────────────────────────────────────────────
// Marktplaats-Bot HTTP Server :4715 — Scaffold mit funktionierendem
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
  stealthIgnoreDefaultArgs,
  cloudflareLaunchArgs,
  fingerprintFor,
  stealthInitScript,
  MARKETPLACE_REGISTRY,
  type ListingDraft,
  type MarketplaceAdapter,
} from '@vinted-system/shared';
import { chromium, type BrowserContext } from 'playwright';
import fs from 'node:fs';
import { SEL_LOGGED_IN } from './selectors.js';
import { createMarktplaatsListing } from './listings/create.js';
import { deactivateMarktplaatsListing } from './listings/deactivate.js';
import { updateMarktplaatsListingPrice } from './listings/update-price.js';
import { pollMarktplaatsInbox } from './chats/poll.js';
import { sendMarktplaatsMessage } from './chats/send.js';
import { acceptMarktplaatsOffer } from './offers/accept.js';
import { declineMarktplaatsOffer } from './offers/decline.js';
import { scanMarktplaatsSold } from './sales/scan.js';

const log = createLogger('marktplaats-bot');
const PORT = Number(process.env.MARKTPLAATS_BOT_PORT ?? 4715);
const DATA_ROOT = process.env.MARKTPLAATS_DATA_ROOT
  ?? path.join(process.cwd(), 'data', 'marktplaats-accounts');

async function launch(accountId: number, headless = true): Promise<BrowserContext> {
  const fp = fingerprintFor(accountId, 'marktplaats');
  const dir = path.join(DATA_ROOT, String(accountId), 'chromium-profile');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const ctx = await chromium.launchPersistentContext(dir, {
    headless,
    userAgent: fp.userAgent,
    viewport: fp.viewport,
    locale: fp.locale,
    timezoneId: fp.timezoneId,
    ignoreDefaultArgs: stealthIgnoreDefaultArgs(), args: cloudflareLaunchArgs(),
  });
  await ctx.addInitScript(stealthInitScript(fp));
  return ctx;
}

export const marktplaatsAdapter: MarketplaceAdapter = {
  meta: MARKETPLACE_REGISTRY.marktplaats,
  async isAuthenticated(accountId) {
    const ctx = await launch(accountId, true);
    try {
      const page = await ctx.newPage();
      await page.goto('https://www.marktplaats.com/', { timeout: 20_000 }).catch(() => {});
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
      await page.goto('https://www.marktplaats.com/login/', { timeout: 30_000 });
      const deadline = Date.now() + 600_000;
      while (Date.now() < deadline) {
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
      await page.goto('https://www.marktplaats.com/', { timeout: 20_000 }).catch(() => {});
      if (!(await SEL_LOGGED_IN.exists(page))) {
        await page.close();
        return { ok: false, error: 'not authenticated', blockedBy: 'login' as const };
      }
      const result = await createMarktplaatsListing(page, draft);
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
      await page.goto('https://www.marktplaats.com/', { timeout: 20_000 }).catch(() => {});
      if (!(await SEL_LOGGED_IN.exists(page))) {
        await page.close();
        return { ok: false, error: 'not authenticated' };
      }
      const result = await deactivateMarktplaatsListing(page, externalIdOrUrl, { mode: 'hide' });
      await page.close();
      return result;
    } finally {
      await ctx.close();
    }
  },
  async updatePrice(accountId: number, externalId: string, newPriceEur: number) {
    const ctx = await launch(accountId, true);
    try {
      return await updateMarktplaatsListingPrice(ctx, externalId, newPriceEur);
    } finally {
      await ctx.close();
    }
  },
};

const app = express();
app.use(express.json({ limit: '10mb' }));

// ── Health + auth ────────────────────────────────────────────────────────────
app.get('/api/health', (_req, res) => res.json({ ok: true, marketplace: 'marktplaats', port: PORT }));

app.get('/api/auth/status', async (req, res) => {
  try { res.json({ ok: await marktplaatsAdapter.isAuthenticated(Number(req.query.account_id ?? 1)) }); }
  catch (e) { res.status(500).json({ error: String(e) }); }
});

app.post('/api/auth/login', async (req, res) => {
  try { res.json(await marktplaatsAdapter.login(Number(req.body?.account_id ?? 1))); }
  catch (e) { res.status(500).json({ error: String(e) }); }
});

// ── Listings ─────────────────────────────────────────────────────────────────
app.post('/api/listings/publish', async (req, res) => {
  try { res.json(await marktplaatsAdapter.publish(Number(req.body?.account_id ?? 1), req.body?.draft)); }
  catch (e) { res.status(500).json({ error: String(e) }); }
});

app.post('/api/listings/deactivate', async (req, res) => {
  const externalId = req.body?.external_id as string | undefined;
  if (!externalId) return res.status(400).json({ ok: false, error: 'missing external_id' });
  try { res.json(await marktplaatsAdapter.deactivate(Number(req.body?.account_id ?? 1), externalId)); }
  catch (e) { res.status(500).json({ ok: false, error: String(e) }); }
});

app.post('/api/listings/update-price', async (req, res) => {
  const externalId = req.body?.external_id as string | undefined;
  const newPriceEur = Number(req.body?.new_price_eur);
  if (!externalId || !Number.isFinite(newPriceEur)) {
    return res.status(400).json({ ok: false, error: 'missing external_id or new_price_eur' });
  }
  try {
    res.json(await marktplaatsAdapter.updatePrice!(
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
    const stats = await pollMarktplaatsInbox(accountId, ctx);
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
    const r = await sendMarktplaatsMessage(ctx, req.params.convId, body);
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
    const r = await acceptMarktplaatsOffer(ctx, req.params.id);
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
    const r = await declineMarktplaatsOffer(ctx, req.params.id);
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
    const stats = await scanMarktplaatsSold(accountId, ctx);
    res.json({ ok: true, ...stats });
  } catch (e) {
    res.status(500).json({ ok: false, error: e instanceof Error ? e.message : String(e) });
  } finally {
    if (ctx) await ctx.close().catch(() => null);
  }
});

app.listen(PORT, () => log.info(`Marktplaats-Bot listening on :${PORT}`));
