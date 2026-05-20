// ──────────────────────────────────────────────────────────────────────────────
// Facebook Marketplace Bot HTTP Server :4711 — Scaffold
//
// FB Marketplace is the hardest to automate:
//   - Aggressive bot detection
//   - No public API
//   - Requires real Facebook account with good standing
//   - Meta's automated detection can disable accounts
//
// Strategy: minimal Playwright automation, focus on:
//   1. Session management (persist login)
//   2. Basic listing creation via marketplace UI
//   3. Price update and deactivation
//
// HIGH RISK — Use with caution. Meta bans aggressively.
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
  stealthIgnoreDefaultArgs,
  cloudflareLaunchArgs,
  MARKETPLACE_REGISTRY,
  type ListingDraft,
  type MarketplaceAdapter,
  type PublishResult,
  type DeactivateResult,
  type UpdatePriceResult,
} from '@vinted-system/shared';
import { updateFbListingPrice } from './listings/update-price.js';
import { deactivateFbListing } from './listings/deactivate.js';
import { pollFbInbox } from './chats/poll.js';
import { sendFbMessage } from './chats/send.js';
import { acceptFbOffer } from './offers/accept.js';
import { declineFbOffer } from './offers/decline.js';
import { pollFbSold } from './sales/poll.js';

const log = createLogger('fb-marketplace-bot');
const PORT = Number(process.env.FB_MARKETPLACE_BOT_PORT ?? 4711);
const BASE_URL = 'https://www.facebook.com';
const DATA_ROOT = process.env.FB_DATA_ROOT
  ?? path.join(process.cwd(), 'data', 'fb-accounts');

async function launch(accountId: number, headless = true) {
  const fp = fingerprintFor(accountId, 'fb_marketplace');
  const dir = path.join(DATA_ROOT, String(accountId), 'chromium-profile');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const ctx = await chromium.launchPersistentContext(dir, {
    headless,
    userAgent: fp.userAgent,
    viewport: fp.viewport,
    locale: fp.locale,
    timezoneId: fp.timezoneId,
    ignoreDefaultArgs: stealthIgnoreDefaultArgs(),
    args: [
      ...cloudflareLaunchArgs(),
      '--disable-notifications', // block FB notification popups
    ],
  });
  await ctx.addInitScript(stealthInitScript(fp));
  return ctx;
}

async function isLoggedIn(page: import('playwright').Page): Promise<boolean> {
  try {
    // FB logged-in state: profile menu or marketplace link visible
    await page.waitForSelector(
      '[aria-label="Dein Profil"], [aria-label="Your profile"], a[href*="/marketplace"]',
      { timeout: 8000 },
    );
    return true;
  } catch { return false; }
}

export const fbAdapter: MarketplaceAdapter = {
  meta: MARKETPLACE_REGISTRY.fb_marketplace,

  async isAuthenticated(accountId) {
    const ctx = await launch(accountId, true);
    try {
      const page = await ctx.newPage();
      await page.goto(BASE_URL, { timeout: 20_000 }).catch(() => {});
      const ok = await isLoggedIn(page);
      await page.close();
      return ok;
    } finally { await ctx.close(); }
  },

  async login(accountId) {
    const ctx = await launch(accountId, false);
    try {
      const page = await ctx.newPage();
      await page.goto(`${BASE_URL}/login`, { timeout: 30_000 });
      const deadline = Date.now() + 600_000;
      while (Date.now() < deadline) {
        if (await isLoggedIn(page)) { await page.close(); return { ok: true }; }
        await page.waitForTimeout(3000);
      }
      return { ok: false, error: 'login timeout' };
    } finally { await ctx.close(); }
  },

  async publish(accountId: number, draft: ListingDraft): Promise<PublishResult> {
    log.warn('FB Marketplace automation is HIGH RISK — proceeding with caution');
    const ctx = await launch(accountId, false); // headful for safety
    try {
      const page = await ctx.newPage();
      await page.goto(`${BASE_URL}/marketplace/create/item`, { timeout: 30_000 });
      await page.waitForTimeout(3000);

      if (!(await isLoggedIn(page))) return { ok: false, error: 'not authenticated', blockedBy: 'login' };

      // FB uses aria-labels extensively — try multiple selector patterns

      // Photos first
      if (draft.photos?.length) {
        const fi = await page.$('input[type="file"][accept*="image"]');
        if (fi) await fi.setInputFiles(draft.photos.slice(0, 10));
        await page.waitForTimeout(3000);
      }

      // Title
      const titleSels = ['input[aria-label*="Title" i]', 'input[aria-label*="Titel" i]', 'input[placeholder*="What are you selling" i]', 'input[placeholder*="Was verkaufst" i]'];
      for (const sel of titleSels) {
        try { await page.fill(sel, (draft.title ?? '').slice(0, 99)); break; } catch {}
      }
      await page.waitForTimeout(800 + Math.random() * 600);

      // Price
      const priceSels = ['input[aria-label*="Price" i]', 'input[aria-label*="Preis" i]'];
      for (const sel of priceSels) {
        try { await page.fill(sel, String(Math.round(draft.priceEur ?? 0))); break; } catch {}
      }
      await page.waitForTimeout(800 + Math.random() * 600);

      // Description
      const descSels = ['textarea[aria-label*="Description" i]', 'textarea[aria-label*="Beschreibung" i]'];
      for (const sel of descSels) {
        try { await page.fill(sel, (draft.description ?? '').slice(0, 4999)); break; } catch {}
      }
      await page.waitForTimeout(800 + Math.random() * 600);

      // Location (if empty)
      const locSels = ['input[aria-label*="Location" i]', 'input[aria-label*="Standort" i]'];
      for (const sel of locSels) {
        const el = await page.$(sel);
        if (el) {
          const val = await el.inputValue().catch(() => '');
          if (!val) {
            await el.fill('Germany');
            await page.waitForTimeout(1000);
            await page.click('[role="option"]:first-child').catch(() => {});
          }
          break;
        }
      }

      log.info('FB Marketplace form filled — MANUAL REVIEW REQUIRED', { folderNum: draft.folderNum });
      const url = page.url();
      // DO NOT auto-submit — user must click "Veröffentlichen" manually
      await page.close();
      return { ok: true, externalId: '', externalUrl: url };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    } finally { await ctx.close(); }
  },

  async deactivate(accountId: number, externalIdOrUrl: string): Promise<DeactivateResult> {
    const ctx = await launch(accountId, true);
    try {
      const page = await ctx.newPage();
      await page.goto(BASE_URL, { timeout: 20_000 }).catch(() => {});
      return await deactivateFbListing(page, externalIdOrUrl, { mode: 'mark-sold' });
    } finally { await ctx.close(); }
  },

  async updatePrice(accountId: number, externalId: string, newPriceEur: number): Promise<UpdatePriceResult> {
    const ctx = await launch(accountId, true);
    try {
      const page = await ctx.newPage();
      await page.goto(BASE_URL, { timeout: 20_000 }).catch(() => {});
      return await updateFbListingPrice(page, externalId, newPriceEur);
    } finally { await ctx.close(); }
  },
};

const app = express();
app.use(express.json({ limit: '10mb' }));

app.get('/api/health', (_req, res) => res.json({
  ok: true, marketplace: 'fb_marketplace', port: PORT,
  warning: 'FB Marketplace automation is HIGH RISK',
}));

app.get('/api/auth/status', async (req, res) => {
  try { res.json({ ok: await fbAdapter.isAuthenticated(Number(req.query.account_id ?? 1)) }); }
  catch (e) { res.status(500).json({ error: String(e) }); }
});
app.post('/api/auth/login', async (req, res) => {
  try { res.json(await fbAdapter.login(Number(req.body?.account_id ?? 1))); }
  catch (e) { res.status(500).json({ error: String(e) }); }
});
app.post('/api/listings/publish', async (req, res) => {
  try { res.json(await fbAdapter.publish(Number(req.body?.account_id ?? 1), req.body?.draft)); }
  catch (e) { res.status(500).json({ error: String(e) }); }
});
app.post('/api/listings/deactivate', async (req, res) => {
  const externalId = req.body?.external_id as string | undefined;
  if (!externalId) return res.status(400).json({ error: 'missing external_id' });
  try { res.json(await fbAdapter.deactivate(Number(req.body?.account_id ?? 1), externalId)); }
  catch (e) { res.status(500).json({ error: String(e) }); }
});

app.post('/api/listings/update-price', async (req, res) => {
  const externalId = req.body?.external_id as string | undefined;
  const price = Number(req.body?.new_price_eur ?? req.body?.priceEur ?? 0);
  if (!externalId) return res.status(400).json({ error: 'missing external_id' });
  if (!price || price <= 0) return res.status(400).json({ error: 'missing/invalid new_price_eur' });
  try {
    res.json(await fbAdapter.updatePrice!(Number(req.body?.account_id ?? 1), externalId, price));
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

app.post('/api/chats/poll', async (req, res) => {
  const accountId = Number(req.body?.account_id ?? 1);
  const ctx = await launch(accountId, true);
  try {
    const page = await ctx.newPage();
    await page.goto(BASE_URL, { timeout: 20_000 }).catch(() => {});
    res.json(await pollFbInbox(page));
  } catch (e) {
    res.status(500).json({ error: String(e) });
  } finally {
    await ctx.close().catch(() => null);
  }
});

app.post('/api/chats/:convId/send', async (req, res) => {
  const convId = req.params.convId;
  const accountId = Number(req.body?.account_id ?? 1);
  const body = String(req.body?.body ?? '').trim();
  if (!body) return res.status(400).json({ error: 'missing body' });
  const ctx = await launch(accountId, true);
  try {
    const page = await ctx.newPage();
    await page.goto(BASE_URL, { timeout: 20_000 }).catch(() => {});
    res.json(await sendFbMessage(page, convId, body));
  } catch (e) {
    res.status(500).json({ error: String(e) });
  } finally {
    await ctx.close().catch(() => null);
  }
});

app.post('/api/offers/:id/accept', async (req, res) => {
  const id = req.params.id;
  const accountId = Number(req.body?.account_id ?? 1);
  const ctx = await launch(accountId, true);
  try {
    const page = await ctx.newPage();
    await page.goto(BASE_URL, { timeout: 20_000 }).catch(() => {});
    res.json(await acceptFbOffer(page, id));
  } catch (e) {
    res.status(500).json({ error: String(e) });
  } finally {
    await ctx.close().catch(() => null);
  }
});

app.post('/api/offers/:id/decline', async (req, res) => {
  const id = req.params.id;
  const accountId = Number(req.body?.account_id ?? 1);
  const ctx = await launch(accountId, true);
  try {
    const page = await ctx.newPage();
    await page.goto(BASE_URL, { timeout: 20_000 }).catch(() => {});
    res.json(await declineFbOffer(page, id));
  } catch (e) {
    res.status(500).json({ error: String(e) });
  } finally {
    await ctx.close().catch(() => null);
  }
});

app.post('/api/sold/poll', async (req, res) => {
  const accountId = Number(req.body?.account_id ?? 1);
  const ctx = await launch(accountId, true);
  try {
    const page = await ctx.newPage();
    await page.goto(BASE_URL, { timeout: 20_000 }).catch(() => {});
    res.json(await pollFbSold(page));
  } catch (e) {
    res.status(500).json({ error: String(e) });
  } finally {
    await ctx.close().catch(() => null);
  }
});

app.listen(PORT, () => log.info(`FB Marketplace Bot listening on :${PORT}`));
