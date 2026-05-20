// ──────────────────────────────────────────────────────────────────────────────
// Generic bot-proxy router — `/api/bot/:mp/<action>`
//
// Routes login/status/selftest calls through to the right marketplace-bot
// HTTP server. The dashboard's Accounts page hits one consistent path-shape
// (`/api/bot/<mp>/login`) for ALL 12 marketplaces; this router demultiplexes
// to the bot on its dedicated port via `BOT_ENDPOINTS[mp]`.
//
// Why proxy through the orchestrator instead of letting the dashboard call
// the bots directly? Two reasons:
//   1. Single Bearer-Token boundary — the dashboard already authenticates
//      with the orchestrator. Bots run on loopback without their own auth.
//   2. Account-context — the orchestrator owns the "current account" state
//      and can validate/inject the account_id before dispatching.
// ──────────────────────────────────────────────────────────────────────────────

import { Router, type Request, type Response } from 'express';
import { createLogger } from '@vinted-system/shared';
import { BOT_ENDPOINTS } from '../marketplaces.js';

const log = createLogger('routes:bot');
export const botRouter = Router();

// Whitelist with alias → canonical id mapping. The dashboard sends "ebay"
// (no region) and "fb" (short for fb_marketplace); we normalize here.
const ALIASES: Record<string, string> = {
  ebay: 'ebay_de',           // default to DE — region-pick comes later via setting
  ebay_de: 'ebay_de',
  ebay_uk: 'ebay_uk',
  fb: 'fb_marketplace',
  fb_marketplace: 'fb_marketplace',
  vinted: 'vinted',
  kleinanzeigen: 'kleinanzeigen',
  depop: 'depop',
  mercari: 'mercari',
  wallapop: 'wallapop',
  etsy: 'etsy',
  grailed: 'grailed',
  vestiaire: 'vestiaire',
  whatnot: 'whatnot',
  poshmark: 'poshmark',
  leboncoin: 'leboncoin',
  marktplaats: 'marktplaats',
  willhaben: 'willhaben',
  shopify: 'shopify',
  woocommerce: 'woocommerce',
};

function resolveBotBase(mpParam: string): { id: string; base: string } | null {
  const id = ALIASES[mpParam] ?? mpParam;
  const base = BOT_ENDPOINTS[id as keyof typeof BOT_ENDPOINTS];
  if (!base || base === 'API') return null;
  return { id, base };
}

function getAccount(req: Request): number {
  const raw =
    (req.query.account as string | undefined) ??
    (req.body?.account_id as string | number | undefined) ??
    '1';
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

// POST /api/bot/:mp/login — opens a visible browser, user logs in, session
//                          is persisted via the bot's playwright profile.
botRouter.post('/:mp/login', async (req, res) => {
  const target = resolveBotBase(req.params.mp);
  if (!target) {
    return res.status(404).json({ ok: false, error: `unknown marketplace: ${req.params.mp}` });
  }
  const accountId = getAccount(req);
  try {
    const r = await fetch(`${target.base}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ account_id: accountId }),
      // Login can take a while — user has to type credentials + CAPTCHA.
      signal: AbortSignal.timeout(600_000),
    });
    const text = await r.text();
    let body: unknown;
    try { body = JSON.parse(text); } catch { body = { ok: r.ok, raw: text }; }
    log.info(`Bot-login dispatched`, { mp: target.id, accountId, status: r.status });
    res.status(r.status).json(body);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.warn(`Bot-login proxy failed`, { mp: target.id, error: msg });
    res.status(502).json({ ok: false, error: `bot unreachable: ${msg}` });
  }
});

// GET /api/bot/:mp/status — is the session valid?
botRouter.get('/:mp/status', async (req, res) => {
  const target = resolveBotBase(req.params.mp);
  if (!target) {
    return res.status(404).json({ ok: false, error: `unknown marketplace: ${req.params.mp}` });
  }
  const accountId = getAccount(req);
  try {
    const r = await fetch(`${target.base}/api/auth/status?account_id=${accountId}`, {
      signal: AbortSignal.timeout(15_000),
    });
    const body = (await r.json()) as Record<string, unknown>;
    res.json({ ok: true, marketplace: target.id, accountId, ...body });
  } catch (err) {
    res.status(502).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});

// POST /api/bot/:mp/selftest — runs the bot's selftest script via HTTP if
// the bot exposes /api/selftest, else returns 404. Most bots expose this.
botRouter.post('/:mp/selftest', async (req, res) => {
  const target = resolveBotBase(req.params.mp);
  if (!target) {
    return res.status(404).json({ ok: false, error: `unknown marketplace: ${req.params.mp}` });
  }
  try {
    const r = await fetch(`${target.base}/api/selftest`, {
      method: 'POST',
      signal: AbortSignal.timeout(120_000),
    });
    const body = await r.json().catch(() => ({ ok: r.ok }));
    res.status(r.status).json(body);
  } catch (err) {
    res.status(502).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});
