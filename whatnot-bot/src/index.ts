// ──────────────────────────────────────────────────────────────────────────────
// Whatnot Bot HTTP Server :4713 — Live-stream selling marketplace.
//
// Whatnot is auction/live-stream based. Many traditional marketplace features
// (update-price, accept/decline offers) are not natively supported. Those
// routes still exist and return { ok: true, notSupported: true } so the
// orchestrator doesn't crash when calling them.
// ──────────────────────────────────────────────────────────────────────────────
import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { chromium } from 'playwright';
import {
  createLogger, fingerprintFor, stealthInitScript,
  type ListingDraft, type MarketplaceAdapter, type PublishResult,
  type DeactivateResult, type UpdatePriceResult,
} from '@vinted-system/shared';
import { pollWhatnotInbox } from './chats/poll.js';
import { sendWhatnotMessage } from './chats/send.js';
import { pollWhatnotSold } from './sales/poll.js';

const log = createLogger('whatnot-bot');
const PORT = Number(process.env.WHATNOT_BOT_PORT ?? 4713);
const BASE_URL = 'https://www.whatnot.com';
const DATA_ROOT = process.env.WHATNOT_DATA_ROOT ?? path.join(process.cwd(), 'data', 'whatnot-accounts');

async function launch(id: number, headless = true) {
  const fp = fingerprintFor(id, 'whatnot');
  const dir = path.join(DATA_ROOT, String(id), 'chromium-profile');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const ctx = await chromium.launchPersistentContext(dir, {
    headless, userAgent: fp.userAgent, viewport: fp.viewport,
    locale: fp.locale, timezoneId: fp.timezoneId,
    args: ['--disable-blink-features=AutomationControlled'],
  });
  await ctx.addInitScript(stealthInitScript(fp));
  return ctx;
}

async function isLoggedIn(p: import('playwright').Page) {
  try { await p.waitForSelector('[data-testid="avatar"], a[href*="/profile"]', { timeout: 5000 }); return true; }
  catch { return false; }
}

export const whatnotAdapter: MarketplaceAdapter = {
  meta: { id: 'whatnot', label: 'Whatnot', baseUrl: BASE_URL, port: PORT, primaryLocale: 'en-US' },
  async isAuthenticated(id) {
    const c = await launch(id); try {
      const p = await c.newPage();
      await p.goto(BASE_URL, { timeout: 20_000 }).catch(()=>{});
      return await isLoggedIn(p);
    } finally { await c.close(); }
  },
  async login(id) {
    const c = await launch(id, false); try {
      const p = await c.newPage();
      await p.goto(`${BASE_URL}/login`, { timeout: 30_000 });
      const d = Date.now() + 600_000;
      while (Date.now() < d) {
        if (await isLoggedIn(p)) return { ok: true };
        await p.waitForTimeout(3000);
      }
      return { ok: false, error: 'login timeout' };
    } finally { await c.close(); }
  },
  async publish(_id, draft): Promise<PublishResult> {
    // Whatnot listings are bound to live shows — scaffold only.
    log.info('Whatnot publish', { folderNum: draft.folderNum });
    return { ok: false, error: 'Whatnot listing creation requires live show — scaffold only' };
  },
  async deactivate(): Promise<DeactivateResult> {
    return { ok: false, error: 'not implemented — Whatnot listings auto-close after show' };
  },
  async updatePrice(): Promise<UpdatePriceResult> {
    // Whatnot prices are auction-driven during live shows — not applicable.
    return { ok: false, error: 'updatePrice not supported on Whatnot (auction-based)' };
  },
};

const app = express();
app.use(express.json({ limit: '10mb' }));

app.get('/api/health', (_, r) => r.json({ ok: true, marketplace: 'whatnot', port: PORT }));

app.get('/api/auth/status', async (q, r) => {
  try { r.json({ ok: await whatnotAdapter.isAuthenticated(Number(q.query.account_id ?? 1)) }); }
  catch (e) { r.status(500).json({ error: String(e) }); }
});

app.post('/api/auth/login', async (q, r) => {
  try { r.json(await whatnotAdapter.login(Number(q.body?.account_id ?? 1))); }
  catch (e) { r.status(500).json({ error: String(e) }); }
});

app.post('/api/listings/publish', async (q, r) => {
  try { r.json(await whatnotAdapter.publish(Number(q.body?.account_id ?? 1), q.body?.draft)); }
  catch (e) { r.status(500).json({ error: String(e) }); }
});

// Whatnot listings auto-close after live shows — return notSupported.
app.post('/api/listings/deactivate', (_q, r) => {
  r.json({ ok: true, notSupported: true, reason: 'Whatnot listings auto-close after live show' });
});

// Whatnot is auction-based — no manual price updates.
app.post('/api/listings/update-price', (_q, r) => {
  r.json({ ok: true, notSupported: true, reason: 'Whatnot is auction-based; price not user-controlled' });
});

app.post('/api/chats/poll', async (req, res) => {
  const accountId = Number(req.body?.account_id ?? 1);
  const ctx = await launch(accountId, true);
  try {
    const page = await ctx.newPage();
    await page.goto(BASE_URL, { timeout: 20_000 }).catch(() => {});
    res.json(await pollWhatnotInbox(page));
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
    res.json(await sendWhatnotMessage(page, convId, body));
  } catch (e) {
    res.status(500).json({ error: String(e) });
  } finally {
    await ctx.close().catch(() => null);
  }
});

// Whatnot doesn't have generic offers (it's auction-bid based).
app.post('/api/offers/:id/accept', (_q, r) => {
  r.json({ ok: true, notSupported: true, reason: 'Whatnot uses live auctions, not offers' });
});
app.post('/api/offers/:id/decline', (_q, r) => {
  r.json({ ok: true, notSupported: true, reason: 'Whatnot uses live auctions, not offers' });
});

app.post('/api/sold/poll', async (req, res) => {
  const accountId = Number(req.body?.account_id ?? 1);
  const ctx = await launch(accountId, true);
  try {
    const page = await ctx.newPage();
    await page.goto(BASE_URL, { timeout: 20_000 }).catch(() => {});
    res.json(await pollWhatnotSold(page));
  } catch (e) {
    res.status(500).json({ error: String(e) });
  } finally {
    await ctx.close().catch(() => null);
  }
});

app.listen(PORT, () => log.info(`Whatnot Bot listening on :${PORT}`));
