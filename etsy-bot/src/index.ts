// ──────────────────────────────────────────────────────────────────────────────
// Etsy Bot HTTP Server :4709 — Scaffold
//
// Etsy is unique: they have an official OAuth API (Etsy Open API v3).
// Long-term this bot should use the API for listing management.
// Short-term: Playwright scaffold for manual-login based operations.
// ──────────────────────────────────────────────────────────────────────────────

import 'dotenv/config';
import express from 'express';
import {
  createLogger,
  MARKETPLACE_REGISTRY,
  type ListingDraft,
  type MarketplaceAdapter,
  type PublishResult,
  type DeactivateResult,
} from '@vinted-system/shared';
import {
  launchEtsy as launch,
  isEtsyLoggedIn as isLoggedIn,
  ETSY_BASE_URL as BASE_URL,
} from './browser.js';
import { updateListingPrice } from './listings/update-price.js';
import { pollEtsyInbox } from './chats/poll.js';
import { sendEtsyMessage } from './chats/send.js';
import { scanEtsySold } from './sales/scan.js';

const log = createLogger('etsy-bot');
const PORT = Number(process.env.ETSY_BOT_PORT ?? 4709);

export const etsyAdapter: MarketplaceAdapter = {
  meta: MARKETPLACE_REGISTRY.etsy,

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
      await page.goto(`${BASE_URL}/signin`, { timeout: 30_000 });
      const deadline = Date.now() + 600_000;
      while (Date.now() < deadline) {
        if (await isLoggedIn(page)) { await page.close(); return { ok: true }; }
        await page.waitForTimeout(2000);
      }
      return { ok: false, error: 'login timeout' };
    } finally { await ctx.close(); }
  },

  async publish(accountId: number, draft: ListingDraft): Promise<PublishResult> {
    // Try official Etsy Open API v3 via orchestrator
    try {
      const orchPort = process.env.ORCHESTRATOR_PORT ?? '4700';
      const resp = await fetch(`http://localhost:${orchPort}/api/crosslist/push`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folder_num: draft.folderNum, platforms: ['etsy'], listing_data: draft, account_id: accountId }),
        signal: AbortSignal.timeout(30_000),
      });
      const result = await resp.json() as any;
      if (result?.results?.etsy?.ok) {
        log.info('Etsy API publish success via orchestrator');
        return result.results.etsy;
      }
      log.warn('Etsy API publish failed, trying Playwright', { error: result?.results?.etsy?.error });
    } catch (importErr) {
      log.warn('Etsy orchestrator call failed', { error: String(importErr) });
    }

    // Fallback: Playwright form filling
    const ctx = await launch(accountId, false);
    try {
      const page = await ctx.newPage();
      await page.goto(BASE_URL, { timeout: 20_000 }).catch(() => {});
      if (!(await isLoggedIn(page))) return { ok: false, error: 'not authenticated', blockedBy: 'login' };

      await page.goto(`${BASE_URL}/your/shops/me/tools/listings/create`, { timeout: 30_000 });
      await page.waitForTimeout(2000);

      // Title
      await page.fill('input[name="title"], #listing-edit-title', (draft.title ?? '').slice(0, 140)).catch(() => {});
      await page.waitForTimeout(500);

      // Description (contenteditable div or textarea)
      const descEl = await page.$('div[contenteditable="true"][role="textbox"]');
      if (descEl) {
        await descEl.fill((draft.description ?? '').slice(0, 5000));
      } else {
        await page.fill('textarea[name="description"]', draft.description ?? '').catch(() => {});
      }
      await page.waitForTimeout(500);

      // Price
      await page.fill('input[name="price"], #price-input', String(draft.priceEur ?? 0)).catch(() => {});
      await page.waitForTimeout(500);

      // Who made it (reselling = someone_else)
      await page.selectOption('select[name*="who_made"]', 'someone_else').catch(() => {});

      // Tags
      if (draft.colors?.length || draft.brand) {
        const tagInput = await page.$('input[name*="tag"], input[placeholder*="tag" i]');
        if (tagInput) {
          const tags = [draft.brand, ...(draft.colors ?? []), draft.category].filter(Boolean);
          for (const tag of tags.slice(0, 13)) {
            await tagInput.fill(tag);
            await page.keyboard.press('Enter');
            await page.waitForTimeout(300);
          }
        }
      }

      // Photos
      if (draft.photos?.length) {
        const fi = await page.$('input[type="file"]');
        if (fi) await fi.setInputFiles(draft.photos.slice(0, 10));
        await page.waitForTimeout(3000);
      }

      log.info('Etsy form filled via Playwright — manual review required');
      const url = page.url();
      await page.close();
      return { ok: true, externalId: '', externalUrl: url };
    } finally {
      await ctx.close();
    }
  },

  async deactivate(accountId: number, externalIdOrUrl: string): Promise<DeactivateResult> {
    log.info('Deactivate scaffold called', { externalIdOrUrl });
    return { ok: false, error: 'deactivation not yet implemented — scaffold only' };
  },

  async updatePrice(accountId: number, externalIdOrUrl: string, newPriceEur: number) {
    // Extract listing id from URL if needed.
    const m = externalIdOrUrl.match(/\/listing\/(\d+)/);
    const externalId = m?.[1] ?? externalIdOrUrl;
    return updateListingPrice(externalId, newPriceEur, accountId);
  },
};

const app = express();
app.use(express.json({ limit: '10mb' }));

app.get('/api/health', (_req, res) => res.json({ ok: true, marketplace: 'etsy', port: PORT }));
app.get('/api/auth/status', async (req, res) => {
  try { res.json({ ok: await etsyAdapter.isAuthenticated(Number(req.query.account_id ?? 1)) }); }
  catch (e) { res.status(500).json({ error: String(e) }); }
});
app.post('/api/auth/login', async (req, res) => {
  try { res.json(await etsyAdapter.login(Number(req.body?.account_id ?? 1))); }
  catch (e) { res.status(500).json({ error: String(e) }); }
});
app.post('/api/listings/publish', async (req, res) => {
  try { res.json(await etsyAdapter.publish(Number(req.body?.account_id ?? 1), req.body?.draft)); }
  catch (e) { res.status(500).json({ error: String(e) }); }
});
app.post('/api/listings/deactivate', async (req, res) => {
  try { res.json(await etsyAdapter.deactivate(Number(req.body?.account_id ?? 1), req.body?.external_id)); }
  catch (e) { res.status(500).json({ error: String(e) }); }
});

app.post('/api/listings/update-price', async (req, res) => {
  const accountId = Number(req.body?.account_id ?? 1);
  const externalId = req.body?.external_id as string | undefined;
  const newPrice = Number(req.body?.new_price_eur);
  if (!externalId || !Number.isFinite(newPrice)) {
    return res.status(400).json({ ok: false, error: 'missing external_id or new_price_eur' });
  }
  try { res.json(await etsyAdapter.updatePrice(accountId, externalId, newPrice)); }
  catch (e) { res.status(500).json({ ok: false, error: String(e) }); }
});

app.post('/api/chats/poll', async (req, res) => {
  const accountId = Number(req.body?.account_id ?? 1);
  try {
    const result = await pollEtsyInbox(accountId);
    res.json({ ok: true, accountId, result });
  } catch (e) { res.status(500).json({ ok: false, error: String(e) }); }
});

app.post('/api/chats/:convId/send', async (req, res) => {
  const convId = Number.parseInt(req.params.convId, 10);
  const { message } = req.body as { message?: string };
  if (!Number.isFinite(convId)) return res.status(400).json({ ok: false, error: 'invalid convId' });
  if (!message) return res.status(400).json({ ok: false, error: 'message required' });
  try { res.json(await sendEtsyMessage(convId, message)); }
  catch (e) { res.status(500).json({ ok: false, error: String(e) }); }
});

// Etsy has no buyer offers (fixed-price marketplace) — endpoints intentionally
// not implemented. Orchestrator should not call them for marketplace='etsy'.

app.post('/api/sold/poll', async (req, res) => {
  const accountId = Number(req.body?.account_id ?? 1);
  try {
    const result = await scanEtsySold(accountId);
    res.json({ ok: true, accountId, result });
  } catch (e) { res.status(500).json({ ok: false, error: String(e) }); }
});

app.listen(PORT, () => log.info(`Etsy Bot listening on :${PORT}`));
