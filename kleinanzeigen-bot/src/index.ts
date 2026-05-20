// ──────────────────────────────────────────────────────────────────────────────
// Kleinanzeigen-Bot HTTP Server :4703
// ──────────────────────────────────────────────────────────────────────────────

import './load-env.js';
import path from 'node:path';
import express from 'express';
import { createLogger, type ListingDraft } from '@vinted-system/shared';
import { kleinanzeigenAdapter } from './adapter.js';
import { pollKleinanzeigenInbox } from './chats/poll.js';
import { sendKleinanzeigenMessage } from './chats/send.js';
import { launchKaBrowser } from './browser.js';
import { isLoggedIn } from './login-flow.js';
import { updatePriceKleinanzeigen } from './listings/update-price.js';

const log = createLogger('ka-bot');

const PORT = Number(process.env.KA_BOT_PORT ?? 4703);
const DATA_ROOT = process.env.KA_DATA_ROOT
  ?? path.join(process.cwd(), 'data', 'kleinanzeigen-accounts');

const app = express();
app.use(express.json({ limit: '10mb' }));

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, marketplace: 'kleinanzeigen', port: PORT });
});

app.get('/api/auth/status', async (req, res) => {
  const accountId = Number(req.query.account_id ?? 1);
  try {
    res.json({ ok: await kleinanzeigenAdapter.isAuthenticated(accountId), accountId });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.post('/api/auth/login', async (req, res) => {
  const accountId = Number(req.body?.account_id ?? 1);
  try {
    const result = await kleinanzeigenAdapter.login(accountId);
    res.status(result.ok ? 200 : 401).json(result);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.post('/api/listings/publish', async (req, res) => {
  const accountId = Number(req.body?.account_id ?? 1);
  const draft = req.body?.draft as ListingDraft | undefined;
  if (!draft) return res.status(400).json({ error: 'missing draft' });
  try {
    res.json(await kleinanzeigenAdapter.publish(accountId, draft));
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.post('/api/listings/deactivate', async (req, res) => {
  const accountId = Number(req.body?.account_id ?? 1);
  const externalId = req.body?.external_id as string | undefined;
  if (!externalId) return res.status(400).json({ error: 'missing external_id' });
  try {
    res.json(await kleinanzeigenAdapter.deactivate(accountId, externalId));
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.post('/api/listings/update-price', async (req, res) => {
  const accountId = Number(req.body?.account_id ?? 1);
  const externalId = req.body?.external_id as string | undefined;
  const newPrice = Number(req.body?.new_price_eur);
  if (!externalId || !Number.isFinite(newPrice)) {
    return res.status(400).json({ ok: false, error: 'missing external_id or new_price_eur' });
  }
  try {
    res.json(await updatePriceKleinanzeigen(accountId, DATA_ROOT, externalId, newPrice));
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});

// ── Chats / Inbox ──────────────────────────────────────────────────────────

app.post('/api/chats/poll', async (req, res) => {
  const accountId = Number(req.body?.account_id ?? 1);
  try {
    const stats = await pollKleinanzeigenInbox(accountId, DATA_ROOT);
    res.json({ ok: true, ...stats });
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});

app.post('/api/chats/send', async (req, res) => {
  const accountId = Number(req.body?.account_id ?? 1);
  const conversationId = req.body?.conversation_id as string | undefined;
  const body = req.body?.body as string | undefined;
  if (!conversationId || !body) {
    return res.status(400).json({ ok: false, error: 'conversation_id + body required' });
  }
  try {
    res.json(await sendKleinanzeigenMessage(accountId, DATA_ROOT, conversationId, body));
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});

app.listen(PORT, () => {
  log.info(`Kleinanzeigen-Bot listening on :${PORT}`);
});
