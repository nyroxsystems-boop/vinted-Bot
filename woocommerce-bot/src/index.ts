// ──────────────────────────────────────────────────────────────────────────────
// WooCommerce-Bot HTTP Server :4718 — API-based via WooCommerce REST API v3.
// ──────────────────────────────────────────────────────────────────────────────

import 'dotenv/config';
import express from 'express';
import { createLogger, type ListingDraft } from '@vinted-system/shared';
import { hasCredentials, wooFetch } from './auth/credentials.js';
import { createWooListing } from './listings/create.js';
import { updateListingPrice } from './listings/update-price.js';
import { deactivateListing } from './listings/deactivate.js';
import { pollWooSold } from './sold/poll.js';

const log = createLogger('woocommerce-bot');
const PORT = Number(process.env.WOOCOMMERCE_BOT_PORT ?? 4718);

const app = express();
app.use(express.json({ limit: '10mb' }));

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    marketplace: 'woocommerce',
    port: PORT,
    hasCredentials: hasCredentials(),
  });
});

app.get('/api/auth/status', async (_req, res) => {
  if (!hasCredentials()) {
    return res.json({ ok: false, configured: false, error: 'woocommerce credentials not set' });
  }
  // /system_status is a privileged endpoint — returns 200 if creds valid + has perms.
  const r = await wooFetch('/system_status');
  res.json({ ok: r.ok, configured: true, status: r.status, error: r.error });
});

app.post('/api/auth/login', (_req, res) => {
  res.status(400).json({
    ok: false,
    error: 'WooCommerce uses Consumer Key/Secret — not browser login. Set settings: woocommerce_url, woocommerce_consumer_key, woocommerce_consumer_secret.',
  });
});

app.post('/api/listings/publish', async (req, res) => {
  const draft = req.body?.draft as ListingDraft | undefined;
  if (!draft) return res.status(400).json({ ok: false, error: 'missing draft' });
  try {
    res.json(await createWooListing(draft));
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});

app.post('/api/listings/deactivate', async (req, res) => {
  const externalId = String(req.body?.externalId ?? '');
  if (!externalId) return res.status(400).json({ ok: false, error: 'externalId required' });
  res.json(await deactivateListing(externalId));
});

app.post('/api/listings/update-price', async (req, res) => {
  const externalId = String(req.body?.externalId ?? '');
  const newPrice = Number(req.body?.newPrice);
  if (!externalId) return res.status(400).json({ ok: false, error: 'externalId required' });
  if (!Number.isFinite(newPrice) || newPrice <= 0) return res.status(400).json({ ok: false, error: 'newPrice required (>0)' });
  res.json(await updateListingPrice(externalId, newPrice));
});

app.post('/api/sold/poll', async (req, res) => {
  const sinceMs = req.body?.sinceMs ? Number(req.body.sinceMs) : undefined;
  try {
    res.json({ ok: true, ...await pollWooSold(sinceMs) });
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});

app.listen(PORT, '127.0.0.1', () => {
  log.info(`Woocommerce-bot API listening on http://127.0.0.1:${PORT}`);
});
