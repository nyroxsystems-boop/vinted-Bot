// ──────────────────────────────────────────────────────────────────────────────
// Vestiaire Collective Bot HTTP Server :4712
//
// Luxury fashion marketplace with authentication/verification.
// Strategy: Playwright automation for listing + Chrome Extension auto-fill.
// ──────────────────────────────────────────────────────────────────────────────

import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { chromium } from 'playwright';
import {
  createLogger, fingerprintFor, stealthInitScript,
  cloudflareLaunchArgs, stealthIgnoreDefaultArgs,
  cloudflareSafeNavigate, prewarmCloudflareCookies,
  isCloudflareInterstitial, waitForCloudflareClear,
  MARKETPLACE_REGISTRY,
  type ListingDraft, type MarketplaceAdapter, type PublishResult, type DeactivateResult, type UpdatePriceResult,
} from '@vinted-system/shared';
import { updateVestiaireListingPrice } from './listings/update-price.js';
import { deactivateVestiaireListing } from './listings/deactivate.js';
import { pollVestiaireInbox } from './chats/poll.js';
import { sendVestiaireMessage } from './chats/send.js';
import { acceptVestiaireOffer } from './offers/accept.js';
import { declineVestiaireOffer } from './offers/decline.js';
import { pollVestiaireSold } from './sales/poll.js';

const log = createLogger('vestiaire-bot');
const PORT = Number(process.env.VESTIAIRE_BOT_PORT ?? 4712);
const BASE_URL = 'https://www.vestiairecollective.com';
const DATA_ROOT = process.env.VESTIAIRE_DATA_ROOT ?? path.join(process.cwd(), 'data', 'vestiaire-accounts');

async function launch(accountId: number, headless = true) {
  const fp = fingerprintFor(accountId, 'vestiaire');
  const dir = path.join(DATA_ROOT, String(accountId), 'chromium-profile');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const ctx = await chromium.launchPersistentContext(dir, {
    headless, userAgent: fp.userAgent, viewport: fp.viewport,
    locale: fp.locale, timezoneId: fp.timezoneId,
    // Cloudflare-safe Chromium flags + strip the auto-injected
    // --enable-automation flag that would expose navigator.webdriver=true.
    ignoreDefaultArgs: stealthIgnoreDefaultArgs(),
    args: cloudflareLaunchArgs(),
  });
  await ctx.addInitScript(stealthInitScript(fp));
  return ctx;
}

async function isLoggedIn(page: import('playwright').Page): Promise<boolean> {
  try {
    await page.waitForSelector('[data-testid="avatar"], a[href*="/member/"]', { timeout: 5000 });
    return true;
  } catch { return false; }
}

export const vestiaireAdapter: MarketplaceAdapter = {
  meta: MARKETPLACE_REGISTRY.vestiaire,

  async isAuthenticated(accountId) {
    const ctx = await launch(accountId, true);
    try {
      const page = await ctx.newPage();
      const nav = await cloudflareSafeNavigate(page, BASE_URL, { timeoutMs: 25_000 });
      if (!nav.ok) {
        log.warn('isAuthenticated: CF blocked', { error: nav.error });
        return false;
      }
      return await isLoggedIn(page);
    } finally { await ctx.close(); }
  },

  async login(accountId) {
    const ctx = await launch(accountId, false);
    try {
      const page = await ctx.newPage();
      await prewarmCloudflareCookies(page, BASE_URL);
      const nav = await cloudflareSafeNavigate(page, `${BASE_URL}/login/`, { timeoutMs: 30_000 });
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
        if (await isLoggedIn(page)) return { ok: true };
        await page.waitForTimeout(3000);
      }
      return { ok: false, error: 'login timeout' };
    } finally { await ctx.close(); }
  },

  async publish(accountId: number, draft: ListingDraft): Promise<PublishResult> {
    const ctx = await launch(accountId, true);
    try {
      const page = await ctx.newPage();
      await page.goto(`${BASE_URL}/sell/`, { timeout: 30_000, waitUntil: 'domcontentloaded' });
      if (!(await isLoggedIn(page))) return { ok: false, error: 'not authenticated' };

      // Upload photos first
      if (draft.photos?.length) {
        const fileInput = await page.$('input[type="file"]');
        if (fileInput) {
          await fileInput.setInputFiles(draft.photos.slice(0, 8));
          await page.waitForTimeout(3000);
        }
      }

      // Fill title
      const titleSel = 'input[name*="title" i], input[placeholder*="title" i], input[data-testid*="title"]';
      await page.fill(titleSel, (draft.title ?? '').slice(0, 80)).catch(() => {});
      await page.waitForTimeout(500);

      // Fill description
      const descSel = 'textarea[name*="description" i], textarea[placeholder*="description" i]';
      await page.fill(descSel, draft.description ?? '').catch(() => {});
      await page.waitForTimeout(500);

      // Fill price
      const priceSel = 'input[name*="price" i], input[placeholder*="price" i]';
      await page.fill(priceSel, String(draft.priceEur ?? 0)).catch(() => {});
      await page.waitForTimeout(500);

      // Brand (Vestiaire requires designer selection)
      if (draft.brand) {
        const brandSel = 'input[name*="brand" i], input[placeholder*="designer" i], input[placeholder*="brand" i]';
        await page.fill(brandSel, draft.brand).catch(() => {});
        await page.waitForTimeout(1000);
        await page.click('[role="option"]:first-child').catch(() => {});
      }

      log.info('Vestiaire form filled — manual review required', { folderNum: draft.folderNum });
      return { ok: true, externalId: '', externalUrl: page.url() };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    } finally { await ctx.close(); }
  },

  async deactivate(accountId, externalIdOrUrl): Promise<DeactivateResult> {
    const ctx = await launch(accountId, true);
    try {
      const page = await ctx.newPage();
      await page.goto(BASE_URL, { timeout: 20_000 }).catch(() => {});
      return await deactivateVestiaireListing(page, externalIdOrUrl);
    } finally { await ctx.close(); }
  },

  async updatePrice(accountId, externalId, newPriceEur): Promise<UpdatePriceResult> {
    const ctx = await launch(accountId, true);
    try {
      const page = await ctx.newPage();
      await page.goto(BASE_URL, { timeout: 20_000 }).catch(() => {});
      return await updateVestiaireListingPrice(page, externalId, newPriceEur);
    } finally { await ctx.close(); }
  },
};

const app = express();
app.use(express.json({ limit: '10mb' }));

app.get('/api/health', (_, res) => res.json({ ok: true, marketplace: 'vestiaire', port: PORT }));

app.get('/api/auth/status', async (req, res) => {
  try { res.json({ ok: await vestiaireAdapter.isAuthenticated(Number(req.query.account_id ?? 1)) }); }
  catch (e) { res.status(500).json({ error: String(e) }); }
});

app.post('/api/auth/login', async (req, res) => {
  try { res.json(await vestiaireAdapter.login(Number(req.body?.account_id ?? 1))); }
  catch (e) { res.status(500).json({ error: String(e) }); }
});

app.post('/api/listings/publish', async (req, res) => {
  try { res.json(await vestiaireAdapter.publish(Number(req.body?.account_id ?? 1), req.body?.draft)); }
  catch (e) { res.status(500).json({ error: String(e) }); }
});

app.post('/api/listings/deactivate', async (req, res) => {
  const externalId = req.body?.external_id as string | undefined;
  if (!externalId) return res.status(400).json({ error: 'missing external_id' });
  try { res.json(await vestiaireAdapter.deactivate(Number(req.body?.account_id ?? 1), externalId)); }
  catch (e) { res.status(500).json({ error: String(e) }); }
});

app.post('/api/listings/update-price', async (req, res) => {
  const externalId = req.body?.external_id as string | undefined;
  const price = Number(req.body?.new_price_eur ?? req.body?.priceEur ?? 0);
  if (!externalId) return res.status(400).json({ error: 'missing external_id' });
  if (!price || price <= 0) return res.status(400).json({ error: 'missing/invalid new_price_eur' });
  try {
    res.json(await vestiaireAdapter.updatePrice!(Number(req.body?.account_id ?? 1), externalId, price));
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

app.post('/api/chats/poll', async (req, res) => {
  const accountId = Number(req.body?.account_id ?? 1);
  const ctx = await launch(accountId, true);
  try {
    const page = await ctx.newPage();
    await page.goto(BASE_URL, { timeout: 20_000 }).catch(() => {});
    const r = await pollVestiaireInbox(page);
    res.json(r);
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
    res.json(await sendVestiaireMessage(page, convId, body));
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
    res.json(await acceptVestiaireOffer(page, id));
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
    res.json(await declineVestiaireOffer(page, id));
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
    res.json(await pollVestiaireSold(page));
  } catch (e) {
    res.status(500).json({ error: String(e) });
  } finally {
    await ctx.close().catch(() => null);
  }
});

app.listen(PORT, () => log.info(`Vestiaire Bot listening on :${PORT}`));
