// ──────────────────────────────────────────────────────────────────────────────
// Grailed Bot HTTP Server :4710 — Scaffold
//
// Grailed = premium menswear marketplace (US-focused).
// Key differentiator: higher price points, designer brands only.
// ──────────────────────────────────────────────────────────────────────────────

import 'dotenv/config';
import express from 'express';
import {
  createLogger,
  getDb,
  cloudflareSafeNavigate,
  prewarmCloudflareCookies,
  isCloudflareInterstitial,
  waitForCloudflareClear,
  MARKETPLACE_REGISTRY,
  type ListingDraft,
  type MarketplaceAdapter,
  type PublishResult,
  type DeactivateResult,
  type Offer,
} from '@vinted-system/shared';
import {
  launchGrailed as launch,
  isGrailedLoggedIn as isLoggedIn,
  GRAILED_BASE_URL as BASE_URL,
} from './browser.js';
import { updateListingPrice } from './listings/update-price.js';
import { pollGrailedInbox } from './chats/poll.js';
import { sendGrailedMessage } from './chats/send.js';
import { acceptOffer } from './offers/accept.js';
import { declineOffer } from './offers/decline.js';
import { scanGrailedSold } from './sales/scan.js';

const log = createLogger('grailed-bot');
const PORT = Number(process.env.GRAILED_BOT_PORT ?? 4710);

export const grailedAdapter: MarketplaceAdapter = {
  meta: MARKETPLACE_REGISTRY.grailed,

  async isAuthenticated(accountId) {
    const ctx = await launch(accountId, true);
    try {
      const page = await ctx.newPage();
      const nav = await cloudflareSafeNavigate(page, BASE_URL, { timeoutMs: 25_000 });
      if (!nav.ok) {
        log.warn('isAuthenticated: CF blocked', { error: nav.error });
        await page.close();
        return false;
      }
      const ok = await isLoggedIn(page);
      await page.close();
      return ok;
    } finally { await ctx.close(); }
  },

  async login(accountId) {
    const ctx = await launch(accountId, false);
    try {
      const page = await ctx.newPage();
      await prewarmCloudflareCookies(page, BASE_URL);
      const nav = await cloudflareSafeNavigate(page, `${BASE_URL}/login`, { timeoutMs: 30_000 });
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
        if (await isLoggedIn(page)) { await page.close(); return { ok: true }; }
        await page.waitForTimeout(2000);
      }
      return { ok: false, error: 'login timeout' };
    } finally { await ctx.close(); }
  },

  async publish(accountId: number, draft: ListingDraft): Promise<PublishResult> {
    const ctx = await launch(accountId, false);
    try {
      const page = await ctx.newPage();
      await page.goto(BASE_URL, { timeout: 20_000 }).catch(() => {});
      if (!(await isLoggedIn(page))) return { ok: false, error: 'not authenticated', blockedBy: 'login' };

      await page.goto(`${BASE_URL}/listings/new`, { timeout: 30_000 });
      await page.waitForTimeout(2000);

      // Photos first (Grailed requires at least 1)
      if (draft.photos?.length) {
        const fi = await page.$('input[type="file"]');
        if (fi) await fi.setInputFiles(draft.photos.slice(0, 6));
        await page.waitForTimeout(3000);
      }

      // Designer/Brand (Grailed's key field)
      if (draft.brand) {
        await page.fill('input[name*="designer" i], input[placeholder*="designer" i], input[name*="brand" i]', draft.brand).catch(() => {});
        await page.waitForTimeout(1000);
        await page.click('[role="option"]:first-child').catch(() => {});
        await page.waitForTimeout(500);
      }

      // Title
      await page.fill('input[name*="title" i], input[placeholder*="title" i]', (draft.title ?? '').slice(0, 80)).catch(() => {});
      await page.waitForTimeout(500);

      // Description
      await page.fill('textarea[name*="description" i], textarea[placeholder*="description" i]', draft.description ?? '').catch(() => {});
      await page.waitForTimeout(500);

      // Price (EUR → USD)
      const usdPrice = Math.round((draft.priceEur ?? 0) * 1.08);
      await page.fill('input[name*="price" i], input[placeholder*="price" i]', String(usdPrice)).catch(() => {});
      await page.waitForTimeout(500);

      log.info('Grailed form filled — manual review required', { folderNum: draft.folderNum });
      const url = page.url();
      await page.close();
      return { ok: true, externalId: '', externalUrl: url };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    } finally { await ctx.close(); }
  },

  async deactivate(accountId: number, externalIdOrUrl: string): Promise<DeactivateResult> {
    log.info('Deactivate scaffold called', { externalIdOrUrl });
    return { ok: false, error: 'deactivation not yet implemented — scaffold only' };
  },

  async updatePrice(accountId: number, externalIdOrUrl: string, newPriceEur: number) {
    const m = externalIdOrUrl.match(/\/listings\/(\d+|[A-Za-z0-9_-]+)/);
    const externalId = m?.[1] ?? externalIdOrUrl;
    return updateListingPrice(externalId, newPriceEur, accountId);
  },
};

const app = express();
app.use(express.json({ limit: '10mb' }));

app.get('/api/health', (_req, res) => res.json({ ok: true, marketplace: 'grailed', port: PORT }));
app.get('/api/auth/status', async (req, res) => {
  try { res.json({ ok: await grailedAdapter.isAuthenticated(Number(req.query.account_id ?? 1)) }); }
  catch (e) { res.status(500).json({ error: String(e) }); }
});
app.post('/api/auth/login', async (req, res) => {
  try { res.json(await grailedAdapter.login(Number(req.body?.account_id ?? 1))); }
  catch (e) { res.status(500).json({ error: String(e) }); }
});
app.post('/api/listings/publish', async (req, res) => {
  try { res.json(await grailedAdapter.publish(Number(req.body?.account_id ?? 1), req.body?.draft)); }
  catch (e) { res.status(500).json({ error: String(e) }); }
});
app.post('/api/listings/deactivate', async (req, res) => {
  try { res.json(await grailedAdapter.deactivate(Number(req.body?.account_id ?? 1), req.body?.external_id)); }
  catch (e) { res.status(500).json({ error: String(e) }); }
});

app.post('/api/listings/update-price', async (req, res) => {
  const accountId = Number(req.body?.account_id ?? 1);
  const externalId = req.body?.external_id as string | undefined;
  const newPrice = Number(req.body?.new_price_eur);
  if (!externalId || !Number.isFinite(newPrice)) {
    return res.status(400).json({ ok: false, error: 'missing external_id or new_price_eur' });
  }
  try { res.json(await grailedAdapter.updatePrice(accountId, externalId, newPrice)); }
  catch (e) { res.status(500).json({ ok: false, error: String(e) }); }
});

app.post('/api/chats/poll', async (req, res) => {
  const accountId = Number(req.body?.account_id ?? 1);
  try {
    const result = await pollGrailedInbox(accountId);
    res.json({ ok: true, accountId, result });
  } catch (e) { res.status(500).json({ ok: false, error: String(e) }); }
});

app.post('/api/chats/:convId/send', async (req, res) => {
  const convId = Number.parseInt(req.params.convId, 10);
  const { message } = req.body as { message?: string };
  if (!Number.isFinite(convId)) return res.status(400).json({ ok: false, error: 'invalid convId' });
  if (!message) return res.status(400).json({ ok: false, error: 'message required' });
  try { res.json(await sendGrailedMessage(convId, message)); }
  catch (e) { res.status(500).json({ ok: false, error: String(e) }); }
});

app.post('/api/offers/:id/accept', async (req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ ok: false, error: 'invalid offer id' });
  const decidedBy: 'auto' | 'manual' = req.body?.decidedBy === 'manual' ? 'manual' : 'auto';
  const db = getDb();
  const offer = db.prepare('SELECT * FROM offers WHERE id = ?').get(id) as Offer | undefined;
  if (!offer) return res.status(404).json({ ok: false, error: 'offer not found' });
  const chat = db.prepare('SELECT account_id FROM chats WHERE id = ?').get(offer.chat_id) as
    | { account_id: number }
    | undefined;
  const accountId = chat?.account_id ?? Number(req.body?.account_id ?? 1);
  try { res.json(await acceptOffer(offer, decidedBy, accountId)); }
  catch (e) { res.status(500).json({ ok: false, error: String(e) }); }
});

app.post('/api/offers/:id/decline', async (req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ ok: false, error: 'invalid offer id' });
  const decidedBy: 'auto' | 'manual' = req.body?.decidedBy === 'manual' ? 'manual' : 'auto';
  const db = getDb();
  const offer = db.prepare('SELECT * FROM offers WHERE id = ?').get(id) as Offer | undefined;
  if (!offer) return res.status(404).json({ ok: false, error: 'offer not found' });
  const chat = db.prepare('SELECT account_id FROM chats WHERE id = ?').get(offer.chat_id) as
    | { account_id: number }
    | undefined;
  const accountId = chat?.account_id ?? Number(req.body?.account_id ?? 1);
  try { res.json(await declineOffer(offer, decidedBy, accountId)); }
  catch (e) { res.status(500).json({ ok: false, error: String(e) }); }
});

app.post('/api/sold/poll', async (req, res) => {
  const accountId = Number(req.body?.account_id ?? 1);
  try {
    const result = await scanGrailedSold(accountId);
    res.json({ ok: true, accountId, result });
  } catch (e) { res.status(500).json({ ok: false, error: String(e) }); }
});

app.listen(PORT, () => log.info(`Grailed Bot listening on :${PORT}`));
