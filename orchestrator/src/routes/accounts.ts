// ──────────────────────────────────────────────────────────────────────────────
// Accounts routes — multi-account CRUD + login proxy to vinted-bot.
//
// GET    /api/accounts                        list all (?marketplace=vinted filters)
// POST   /api/accounts                        create { label, marketplace? }
// PATCH  /api/accounts/:id                    update { label?, active? }
// DELETE /api/accounts/:id                    hard delete (refuses last one)
// GET    /api/accounts/:id                    return one (with marketplace, proxy_url)
// POST   /api/accounts/:id/login              kick off headful login
// GET    /api/accounts/:id/login/status       poll login progress
// POST   /api/accounts/select                 body: { id } — switch current
// GET    /api/accounts/current                returns the current id
// ──────────────────────────────────────────────────────────────────────────────

import { Router } from 'express';
import {
  listAccounts,
  listAccountsFor,
  createAccount,
  createAccountFor,
  isPlatformId,
  renameAccount,
  setAccountActive,
  deleteAccount,
  getAccount,
  getCurrentAccountId,
  setCurrentAccountId,
  requireAccount,
  getLatestAccountMetric,
  getAccountMetricsRange,
  getDb,
  setSetting,
} from '@vinted-system/shared';
import type { PlatformId } from '@vinted-system/shared';
import { vintedClient } from '../bot-clients/vinted.js';
import { eventBus } from '../events.js';

export const accountsRouter = Router();

// Optional `?marketplace=vinted` query filter — when set, returns only
// accounts that belong to that platform. The `currentId` flips to the
// per-platform selection so a UI can show "active eBay-DE account"
// independently of the active Vinted-account.
accountsRouter.get('/', (req, res) => {
  const mp = typeof req.query.marketplace === 'string' ? req.query.marketplace : null;
  if (mp) {
    if (!isPlatformId(mp)) {
      return res.status(400).json({ error: `Unbekanntes marketplace "${mp}"` });
    }
    return res.json({
      items: listAccountsFor(mp),
      currentId: getCurrentAccountId(mp),
      marketplace: mp,
    });
  }
  res.json({ items: listAccounts(), currentId: getCurrentAccountId() });
});

accountsRouter.get('/current', (req, res) => {
  const mp = typeof req.query.marketplace === 'string' ? req.query.marketplace : null;
  if (mp && isPlatformId(mp)) {
    return res.json({ currentId: getCurrentAccountId(mp), marketplace: mp });
  }
  res.json({ currentId: getCurrentAccountId() });
});

accountsRouter.post('/', (req, res) => {
  const label = typeof req.body?.label === 'string' ? req.body.label : '';
  const mpRaw = req.body?.marketplace;
  // Default to 'vinted' for back-compat with existing clients that don't
  // send a marketplace field. Validate against the PlatformId union.
  let marketplace: PlatformId = 'vinted';
  if (mpRaw !== undefined && mpRaw !== null && mpRaw !== '') {
    if (!isPlatformId(mpRaw)) {
      return res.status(400).json({
        error: `Unbekanntes marketplace "${String(mpRaw)}" — erlaubt: vinted, ebay_de, ebay_uk, kleinanzeigen, depop, mercari, wallapop, etsy`,
      });
    }
    marketplace = mpRaw;
  }
  try {
    // Use the generic helper when explicit, the back-compat helper when
    // marketplace was omitted entirely (preserves prior behaviour).
    const acc = mpRaw !== undefined
      ? createAccountFor(label, marketplace)
      : createAccount(label);
    eventBus.publish({
      type: 'alert',
      level: 'warn',
      message: `👤 Account "${acc.label}" (${marketplace}) angelegt — bitte einloggen.`,
    });
    res.status(201).json(acc);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// Single-account fetch. Returns the raw row including `marketplace` and
// `proxy_url` so the UI can render platform-badge + proxy-indicator.
// Numeric-only constraint avoids collision with `/current` (which is
// declared above and matches first anyway, but defense-in-depth helps if
// the route table is reshuffled later).
accountsRouter.get('/:id(\\d+)', (req, res) => {
  // Express casts numeric-regex params to a string key that ts sees as
  // `{ 'id(\\d+)': string }`, so cast via Record before the lookup.
  const params = req.params as Record<string, string>;
  const id = Number.parseInt(params.id ?? params['id(\\d+)'] ?? '', 10);
  try {
    res.json(requireAccount(id));
  } catch (err) {
    res.status(404).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

accountsRouter.patch('/:id', (req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  try {
    requireAccount(id);
    if (typeof req.body?.label === 'string') renameAccount(id, req.body.label);
    if (typeof req.body?.active === 'boolean') setAccountActive(id, req.body.active);
    res.json(getAccount(id));
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

accountsRouter.delete('/:id', (req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  try {
    const acc = requireAccount(id);
    deleteAccount(id);
    eventBus.publish({
      type: 'alert',
      level: 'warn',
      message: `👤 Account "${acc.label}" gelöscht.`,
    });
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

accountsRouter.post('/:id/login', async (req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  try {
    requireAccount(id);
    await vintedClient.startLogin(id);
    res.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Translate raw fetch/connection errors into something the UI can render
    // as actionable. Most-likely failure: vinted-bot service is down.
    const looksOffline =
      msg.toLowerCase().includes('econnrefused') ||
      msg.toLowerCase().includes('fetch failed') ||
      msg.toLowerCase().includes('socket hang up') ||
      msg.toLowerCase().includes('network');
    if (looksOffline) {
      return res.status(503).json({
        error: 'Vinted-Bot ist offline. Settings → Diagnose → „Services neu starten" oder Bot manuell hochfahren.',
        bot_offline: true,
      });
    }
    res.status(500).json({ error: msg });
  }
});

accountsRouter.get('/:id/login/status', async (req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  try {
    const status = await vintedClient.loginStatus(id);
    res.json(status);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// ── Account Metrics ────────────────────────────────────────────────────────
// Returns the latest snapshot for the given account, plus a `range` array
// of up to `days` (default 7) recent snapshots so the dashboard can render
// a trend sparkline. The collector writes one row per (account_id, date)
// every 24h via account-metrics-collector.ts.
accountsRouter.get('/:id/metrics', (req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  const days = Math.max(1, Math.min(90, Number.parseInt(String(req.query.days ?? '7'), 10) || 7));
  try {
    requireAccount(id);
    const latest = getLatestAccountMetric(id);
    const range = getAccountMetricsRange(id, days);
    res.json({ latest, range, days });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// ── Proxy management ─────────────────────────────────────────────────────
// PUT    /api/accounts/:id/proxy        body: { proxy_url }
// DELETE /api/accounts/:id/proxy        clear proxy (direct connection)
// POST   /api/accounts/:id/proxy/test   live IP-change check via vinted-bot
const VINTED_BOT_BASE = `http://localhost:${process.env.VINTED_BOT_PORT ?? '4701'}`;

accountsRouter.put('/:id/proxy', (req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  const proxyUrl = typeof req.body?.proxy_url === 'string' ? req.body.proxy_url.trim() : '';
  if (!proxyUrl) return res.status(400).json({ error: 'proxy_url required' });
  try {
    requireAccount(id);
    // Cheap pre-flight: ensure the URL parses before we persist it.
    new URL(proxyUrl);
    getDb()
      .prepare('UPDATE vinted_accounts SET proxy_url = ? WHERE id = ?')
      .run(proxyUrl, id);
    res.json({ ok: true, proxy_url: proxyUrl });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

accountsRouter.delete('/:id/proxy', (req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  try {
    requireAccount(id);
    getDb().prepare('UPDATE vinted_accounts SET proxy_url = NULL WHERE id = ?').run(id);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

accountsRouter.post('/:id/proxy/test', async (req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  try {
    requireAccount(id);
    // Body override > account's stored proxy_url. Lets the modal test a URL
    // BEFORE persisting it.
    const acc = getAccount(id);
    const proxyUrl = (typeof req.body?.proxy_url === 'string' && req.body.proxy_url.trim())
      || acc?.proxy_url
      || '';
    if (!proxyUrl) return res.status(400).json({ error: 'Kein Proxy gesetzt' });

    const r = await fetch(`${VINTED_BOT_BASE}/api/proxy/test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ proxy_url: proxyUrl }),
      signal: AbortSignal.timeout(35_000),
    });
    const body = await r.json();
    res.status(r.status).json(body);
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});

// Stop EVERYTHING vinted-related: pause the master switch (so workers
// stop ticking + can't re-open browsers a minute later), then close every
// cached Playwright context. With ?wipe=true the chromium-profile dirs are
// deleted too (full logout). The master switch stays paused — user must
// un-pause manually when ready (otherwise pollers immediately reopen
// browsers and defeat the purpose of "kill everything").
//
// Body: { wipe?: boolean, keepRunning?: boolean }
//   wipe=true        → also delete chromium-profile dirs
//   keepRunning=true → skip the master pause (rare — caller wants to keep
//                       workers ticking, e.g. for cookie-only logout)
accountsRouter.post('/sessions/kill-all', async (req, res) => {
  const wipe = req.body?.wipe === true;
  const keepRunning = req.body?.keepRunning === true;

  // ORDER MATTERS — pause BEFORE the bot-call so workers that wake up
  // mid-call don't grab a new browser the moment we close it. We re-confirm
  // pause AFTER the kill too, in case a watcher flipped it back between the
  // setSetting and the bot ACK.
  let paused = false;
  if (!keepRunning) {
    setSetting('paused', 'true');
    paused = true;
  }

  try {
    const r = await fetch(`${VINTED_BOT_BASE}/sessions/kill-all${wipe ? '?wipe=true' : ''}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ wipe }),
      signal: AbortSignal.timeout(30_000),
    });
    const body = await r.json();

    // Re-assert pause after the bot ACK — closes the watcher-race window.
    if (!keepRunning) setSetting('paused', 'true');

    if (r.ok) {
      eventBus.publish({
        type: 'alert',
        level: 'warn',
        message: wipe
          ? `🛑 System pausiert + alle Vinted-Sessions gekillt + Profile gewiped (${body.wiped}/${body.closed}).`
          : `🛑 System pausiert + alle Vinted-Sessions gekillt (${body.closed} Accounts).`,
      });
    }
    res.status(r.status).json({ ...body, paused });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const looksOffline = /econnrefused|fetch failed|socket hang up/i.test(msg);
    if (looksOffline) {
      // Bot unreachable but pause already in place — caller can still retry.
      return res.status(503).json({
        error: 'Vinted-Bot ist offline — keine Sessions zum Killen. System ist trotzdem pausiert.',
        bot_offline: true,
        paused,
      });
    }
    res.status(500).json({ error: msg, paused });
  }
});

accountsRouter.post('/select', async (req, res) => {
  const id = Number.parseInt(String(req.body?.id ?? ''), 10);
  if (!Number.isFinite(id) || id <= 0) {
    return res.status(400).json({ error: 'id required' });
  }
  try {
    // setCurrentAccountId() mirrors the choice into both the global slot
    // AND the per-marketplace slot (based on acc.marketplace), so the
    // platform-aware getCurrentAccountId(mp) lookups stay in sync.
    setCurrentAccountId(id);
    const acc = getAccount(id);
    // Only propagate to the vinted-bot when the selected account is a
    // Vinted-identity. eBay/KA/etc. have their own bot endpoints — calling
    // vintedClient.selectAccount with a non-Vinted id would be a no-op at
    // best, a confusing log line at worst.
    if (acc?.marketplace === 'vinted' || !acc?.marketplace) {
      await vintedClient.selectAccount(id).catch(() => null);
    }
    res.json({ ok: true, currentId: id, marketplace: acc?.marketplace ?? 'vinted' });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});
