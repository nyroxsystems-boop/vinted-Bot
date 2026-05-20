// ──────────────────────────────────────────────────────────────────────────────
// Wallapop-Bot HTTP Server :4706
//
// MVP routes mirror the vinted-bot surface so the orchestrator can route
// uniformly:
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
import path from 'node:path';
import express from 'express';
import { createLogger, type ListingDraft } from '@vinted-system/shared';
import { wallapopAdapter } from './adapter.js';
import { launchWpBrowser, type WpBrowser } from './browser.js';
import { pollWallapopInbox } from './chats/poll.js';
import { sendWallapopMessage } from './chats/send.js';
import { acceptWallapopOffer } from './offers/accept.js';
import { declineWallapopOffer } from './offers/decline.js';
import { scanWallapopSold } from './sales/scan.js';

const log = createLogger('wp-bot');
const PORT = Number(process.env.WALLAPOP_BOT_PORT ?? 4706);
const DATA_ROOT = process.env.WP_DATA_ROOT
  ?? path.join(process.cwd(), 'data', 'wallapop-accounts');

function storageDirFor(accountId: number): string {
  return path.join(DATA_ROOT, String(accountId));
}

/**
 * Launch a short-lived browser context for a one-shot route call.
 * Caller is responsible for `close()` in a `finally`.
 */
async function launchForRoute(accountId: number, headless = true): Promise<WpBrowser> {
  return launchWpBrowser({
    accountId,
    storageDir: storageDirFor(accountId),
    headless,
  });
}

const app = express();
app.use(express.json({ limit: '10mb' }));

// ── Health + auth ────────────────────────────────────────────────────────────
app.get('/api/health', (_req, res) => {
  res.json({ ok: true, marketplace: 'wallapop', port: PORT });
});

app.get('/api/auth/status', async (req, res) => {
  const accountId = Number(req.query.account_id ?? 1);
  try {
    res.json({ ok: await wallapopAdapter.isAuthenticated(accountId), accountId });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const r = await wallapopAdapter.login(Number(req.body?.account_id ?? 1));
    res.status(r.ok ? 200 : 401).json(r);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// ── Listings ─────────────────────────────────────────────────────────────────
app.post('/api/listings/publish', async (req, res) => {
  const draft = req.body?.draft as ListingDraft | undefined;
  if (!draft) return res.status(400).json({ error: 'missing draft' });
  try {
    res.json(await wallapopAdapter.publish(Number(req.body?.account_id ?? 1), draft));
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

app.post('/api/listings/deactivate', async (req, res) => {
  const externalId = req.body?.external_id as string | undefined;
  if (!externalId) return res.status(400).json({ error: 'missing external_id' });
  try {
    res.json(await wallapopAdapter.deactivate(Number(req.body?.account_id ?? 1), externalId));
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

app.post('/api/listings/update-price', async (req, res) => {
  const externalId = req.body?.external_id as string | undefined;
  const newPriceEur = Number(req.body?.new_price_eur);
  if (!externalId || !Number.isFinite(newPriceEur)) {
    return res.status(400).json({ ok: false, error: 'missing external_id or new_price_eur' });
  }
  try {
    res.json(await wallapopAdapter.updatePrice!(
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
  let browser: WpBrowser | null = null;
  try {
    browser = await launchForRoute(accountId, true);
    const stats = await pollWallapopInbox(accountId, browser.context);
    res.json({ ok: true, ...stats });
  } catch (e) {
    res.status(500).json({ ok: false, error: e instanceof Error ? e.message : String(e) });
  } finally {
    if (browser) await browser.close().catch(() => null);
  }
});

app.post('/api/chats/:convId/send', async (req, res) => {
  const accountId = Number(req.body?.account_id ?? 1);
  const body = String(req.body?.body ?? '');
  if (!body) return res.status(400).json({ ok: false, error: 'missing body' });
  let browser: WpBrowser | null = null;
  try {
    browser = await launchForRoute(accountId, true);
    const r = await sendWallapopMessage(browser.context, req.params.convId, body);
    res.json(r);
  } catch (e) {
    res.status(500).json({ ok: false, error: e instanceof Error ? e.message : String(e) });
  } finally {
    if (browser) await browser.close().catch(() => null);
  }
});

// ── Offers ───────────────────────────────────────────────────────────────────
app.post('/api/offers/:id/accept', async (req, res) => {
  const accountId = Number(req.body?.account_id ?? 1);
  let browser: WpBrowser | null = null;
  try {
    browser = await launchForRoute(accountId, true);
    const r = await acceptWallapopOffer(browser.context, req.params.id);
    res.json(r);
  } catch (e) {
    res.status(500).json({ ok: false, error: e instanceof Error ? e.message : String(e) });
  } finally {
    if (browser) await browser.close().catch(() => null);
  }
});

app.post('/api/offers/:id/decline', async (req, res) => {
  const accountId = Number(req.body?.account_id ?? 1);
  let browser: WpBrowser | null = null;
  try {
    browser = await launchForRoute(accountId, true);
    const r = await declineWallapopOffer(browser.context, req.params.id);
    res.json(r);
  } catch (e) {
    res.status(500).json({ ok: false, error: e instanceof Error ? e.message : String(e) });
  } finally {
    if (browser) await browser.close().catch(() => null);
  }
});

// ── Sold-Item Detection ──────────────────────────────────────────────────────
app.post('/api/sold/poll', async (req, res) => {
  const accountId = Number(req.body?.account_id ?? 1);
  let browser: WpBrowser | null = null;
  try {
    browser = await launchForRoute(accountId, true);
    const stats = await scanWallapopSold(accountId, browser.context);
    res.json({ ok: true, ...stats });
  } catch (e) {
    res.status(500).json({ ok: false, error: e instanceof Error ? e.message : String(e) });
  } finally {
    if (browser) await browser.close().catch(() => null);
  }
});

app.listen(PORT, () => log.info(`Wallapop-Bot listening on :${PORT}`));
