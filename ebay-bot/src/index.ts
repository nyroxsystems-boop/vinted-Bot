// ──────────────────────────────────────────────────────────────────────────────
// eBay Bot HTTP Server — Supports eBay DE (:4707) and eBay UK (:4708)
//
// Single codebase, market switched via $EBAY_MARKET (de | uk). All write-paths
// go through the eBay REST API (Sell Inventory + Negotiation + Fulfillment);
// browser automation is only kept as a fallback for the legacy publish path
// during the manual-login bootstrap. Once OAuth is wired up the Playwright path
// can be dropped.
// ──────────────────────────────────────────────────────────────────────────────

import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { chromium } from 'playwright';
import {
  createLogger,
  stealthIgnoreDefaultArgs,
  cloudflareLaunchArgs,
  fingerprintFor,
  stealthInitScript,
  getAccount,
  parseProxyUrl,
  MARKETPLACE_REGISTRY,
  type ListingDraft,
  type MarketplaceAdapter,
  type PublishResult,
  type DeactivateResult,
  type MarketplaceId,
} from '@vinted-system/shared';
import { SEL_LOGGED_IN } from './selectors.js';
import { hasCredentials, type EbayMarket } from './auth/token.js';
import { updateListingPrice, findOfferIdByListing } from './listings/update-price.js';
import { acceptOffer, declineOffer } from './offers/accept.js';
import { pollMessages, sendMessage } from './messages/poll.js';
import { pollSoldOrders } from './sold/poll.js';

// Determine market from env — default to DE
const MARKET = (process.env.EBAY_MARKET ?? 'de').toLowerCase() as EbayMarket;
const MARKETPLACE_ID: MarketplaceId = MARKET === 'uk' ? 'ebay_uk' : 'ebay_de';
const BASE_URL = MARKET === 'uk' ? 'https://www.ebay.co.uk' : 'https://www.ebay.de';
const DEFAULT_PORT = MARKET === 'uk' ? 4708 : 4707;

const log = createLogger(`ebay-${MARKET}-bot`);
const PORT = Number(process.env[`EBAY_${MARKET.toUpperCase()}_BOT_PORT`] ?? DEFAULT_PORT);
const DATA_ROOT = process.env.EBAY_DATA_ROOT
  ?? path.join(process.cwd(), 'data', `ebay-${MARKET}-accounts`);

async function launch(accountId: number, headless = true) {
  const fp = fingerprintFor(accountId, MARKETPLACE_ID);
  const dir = path.join(DATA_ROOT, String(accountId), 'chromium-profile');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const acc = getAccount(accountId);
  const proxyUrl = acc?.proxy_url ?? undefined;
  const proxyOpt = proxyUrl
    ? parseProxyUrl(proxyUrl, `ebay-${MARKET}-bot-${accountId}`)
    : undefined;
  if (proxyOpt) {
    log.info('eBay proxy configured', { accountId, server: new URL(proxyUrl!).host, hasAuth: !!proxyOpt.username });
  }
  const ctx = await chromium.launchPersistentContext(dir, {
    headless,
    userAgent: fp.userAgent,
    viewport: fp.viewport,
    locale: fp.locale,
    timezoneId: fp.timezoneId,
    ignoreDefaultArgs: stealthIgnoreDefaultArgs(), args: cloudflareLaunchArgs(),
    ...(proxyOpt ? { proxy: proxyOpt } : {}),
  });
  await ctx.addInitScript(stealthInitScript(fp));
  return ctx;
}

export const ebayAdapter: MarketplaceAdapter = {
  meta: MARKETPLACE_REGISTRY[MARKETPLACE_ID],

  async isAuthenticated(accountId) {
    // API-first: if OAuth creds are configured we treat the account as authenticated.
    if (hasCredentials(MARKET)) return true;
    const ctx = await launch(accountId, true);
    try {
      const page = await ctx.newPage();
      await page.goto(BASE_URL, { timeout: 20_000 }).catch(() => {});
      const ok = await SEL_LOGGED_IN.exists(page);
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
        if (await SEL_LOGGED_IN.exists(page)) { await page.close(); return { ok: true }; }
        await page.waitForTimeout(2000);
      }
      return { ok: false, error: 'login timeout' };
    } finally { await ctx.close(); }
  },

  async publish(accountId: number, draft: ListingDraft): Promise<PublishResult> {
    // Delegate to the orchestrator's eBay API client (it owns the full
    // Inventory→Offer→Publish flow + DB tracking).
    try {
      const orchPort = process.env.ORCHESTRATOR_PORT ?? '4700';
      const mp = MARKETPLACE_ID;
      const resp = await fetch(`http://localhost:${orchPort}/api/crosslist/push`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folder_num: draft.folderNum, platforms: [mp], listing_data: draft, account_id: accountId }),
        signal: AbortSignal.timeout(30_000),
      });
      const result = await resp.json() as { results?: Record<string, PublishResult> };
      if (result?.results?.[mp]?.ok) {
        log.info('eBay API publish success via orchestrator');
        return result.results[mp] as PublishResult;
      }
      log.warn('eBay API publish failed', { error: result?.results?.[mp]?.error });
      return { ok: false, error: result?.results?.[mp]?.error ?? 'eBay API returned failure' };
    } catch (importErr) {
      log.warn('eBay API publish via orchestrator failed', { error: String(importErr) });
      return { ok: false, error: importErr instanceof Error ? importErr.message : String(importErr) };
    }
  },

  async deactivate(_accountId: number, externalIdOrUrl: string): Promise<DeactivateResult> {
    const listingId = externalIdOrUrl.match(/(\d{8,})/)?.[1] ?? externalIdOrUrl;
    try {
      const r = await fetch(`http://localhost:4700/api/ebay/deactivate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ listingId }),
        signal: AbortSignal.timeout(20_000),
      });
      const j = (await r.json()) as { ok: boolean; error?: string };
      if (j.ok) {
        log.info('eBay listing deactivated via API', { listingId });
        return { ok: true };
      }
      return { ok: false, error: j.error ?? 'unknown' };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  },

  async updatePrice(_accountId: number, externalId: string, newPrice: number) {
    // externalId may be either an offerId or a listingId — try offerId first,
    // fall back to listingId-→offerId lookup.
    let offerId = externalId;
    const r = await updateListingPrice(MARKET, offerId, newPrice);
    if (r.ok) return { ok: true };

    // Maybe the caller passed a listingId — resolve and retry once.
    if (r.error && /not.*found|404/i.test(r.error)) {
      const resolved = await findOfferIdByListing(MARKET, externalId);
      if (resolved) {
        offerId = resolved;
        const r2 = await updateListingPrice(MARKET, offerId, newPrice);
        return r2.ok ? { ok: true } : { ok: false, error: r2.error };
      }
    }
    return { ok: false, error: r.error };
  },
};

const app = express();
app.use(express.json({ limit: '10mb' }));

app.get('/api/health', (_req, res) => res.json({
  ok: true,
  marketplace: MARKETPLACE_ID,
  market: MARKET,
  port: PORT,
  hasCredentials: hasCredentials(MARKET),
}));

app.get('/api/auth/status', async (req, res) => {
  try { res.json({ ok: await ebayAdapter.isAuthenticated(Number(req.query.account_id ?? 1)) }); }
  catch (e) { res.status(500).json({ error: String(e) }); }
});

app.post('/api/auth/login', async (req, res) => {
  try { res.json(await ebayAdapter.login(Number(req.body?.account_id ?? 1))); }
  catch (e) { res.status(500).json({ error: String(e) }); }
});

// ── Listings ────────────────────────────────────────────────────────────────

app.post('/api/listings/publish', async (req, res) => {
  try { res.json(await ebayAdapter.publish(Number(req.body?.account_id ?? 1), req.body?.draft)); }
  catch (e) { res.status(500).json({ error: String(e) }); }
});

app.post('/api/listings/deactivate', async (req, res) => {
  try { res.json(await ebayAdapter.deactivate(Number(req.body?.account_id ?? 1), req.body?.external_id)); }
  catch (e) { res.status(500).json({ error: String(e) }); }
});

app.post('/api/listings/update-price', async (req, res) => {
  try {
    const offerId = String(req.body?.offer_id ?? req.body?.external_id ?? '').trim();
    const listingId = String(req.body?.listing_id ?? '').trim();
    const newPrice = Number(req.body?.new_price ?? req.body?.price);
    if (!Number.isFinite(newPrice) || newPrice <= 0) {
      return res.status(400).json({ ok: false, error: 'new_price required (>0)' });
    }
    // Prefer offerId; otherwise resolve listingId → offerId
    let resolvedOfferId = offerId;
    if (!resolvedOfferId && listingId) {
      const found = await findOfferIdByListing(MARKET, listingId);
      if (!found) return res.status(404).json({ ok: false, error: `no offer for listingId=${listingId}` });
      resolvedOfferId = found;
    }
    if (!resolvedOfferId) {
      return res.status(400).json({ ok: false, error: 'offer_id or listing_id required' });
    }
    res.json(await updateListingPrice(MARKET, resolvedOfferId, newPrice));
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// ── Messages (Q&A) — stubbed until Trading API XML path is wired up ─────────

app.post('/api/messages/poll', async (_req, res) => {
  try { res.json(await pollMessages(MARKET)); }
  catch (e) { res.status(500).json({ error: String(e) }); }
});

app.post('/api/messages/:id/send', async (req, res) => {
  try {
    const body = String(req.body?.body ?? '').trim();
    if (!body) return res.status(400).json({ ok: false, error: 'body required' });
    res.json(await sendMessage(MARKET, String(req.params.id), body));
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// ── Best-Offer accept / decline ─────────────────────────────────────────────

app.post('/api/offers/:id/accept', async (req, res) => {
  try { res.json(await acceptOffer(MARKET, String(req.params.id))); }
  catch (e) { res.status(500).json({ ok: false, error: String(e) }); }
});

app.post('/api/offers/:id/decline', async (req, res) => {
  try {
    const reason = typeof req.body?.reason === 'string' ? req.body.reason : 'PRICE_TOO_LOW';
    res.json(await declineOffer(MARKET, String(req.params.id), reason));
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// ── Sold-order polling ──────────────────────────────────────────────────────

app.post('/api/sold/poll', async (req, res) => {
  try {
    const sinceMs = Number(req.body?.since_ms ?? Date.now() - 7 * 24 * 3600 * 1000);
    res.json(await pollSoldOrders(MARKET, sinceMs));
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

app.listen(PORT, () => log.info(`eBay ${MARKET.toUpperCase()} Bot listening on :${PORT}`));
