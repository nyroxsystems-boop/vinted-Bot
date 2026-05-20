// EU Champion Bots — Leboncoin (FR) :4714, Marktplaats (NL) :4715, Willhaben (AT) :4716, Subito (IT) :4717, Ricardo (CH) :4718
// This file exports all EU marketplace adapters using a shared factory pattern.

import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { chromium } from 'playwright';
import { createLogger, fingerprintFor, stealthInitScript, type ListingDraft, type MarketplaceAdapter, type PublishResult, type DeactivateResult } from '@vinted-system/shared';

interface EuMarketConfig {
  id: string;
  name: string;
  port: number;
  baseUrl: string;
  currency: string;
  locale: string;
  loginPath: string;
  sellPath: string;
  loggedInSelector: string;
  titleSelector: string;
  descSelector: string;
  priceSelector: string;
}

const EU_MARKETS: EuMarketConfig[] = [
  {
    id: 'leboncoin', name: 'Leboncoin', port: 4714,
    baseUrl: 'https://www.leboncoin.fr', currency: 'EUR', locale: 'fr-FR',
    loginPath: '/compte/connexion', sellPath: '/deposer-une-annonce',
    loggedInSelector: '[data-testid="avatar"], a[href*="/dashboard"]',
    titleSelector: 'input[name="subject"], input[placeholder*="titre" i]',
    descSelector: 'textarea[name="body"], textarea[placeholder*="décri" i]',
    priceSelector: 'input[name="price"], input[placeholder*="prix" i]',
  },
  {
    id: 'marktplaats', name: 'Marktplaats', port: 4715,
    baseUrl: 'https://www.marktplaats.nl', currency: 'EUR', locale: 'nl-NL',
    loginPath: '/account/login.html', sellPath: '/syi/',
    loggedInSelector: '[data-role="avatar"], a[href*="/verkopers/"]',
    titleSelector: 'input[name="title"], input[id*="title"]',
    descSelector: 'textarea[name="description"], textarea[id*="description"]',
    priceSelector: 'input[name="price"], input[id*="price"]',
  },
  {
    id: 'willhaben', name: 'Willhaben', port: 4716,
    baseUrl: 'https://www.willhaben.at', currency: 'EUR', locale: 'de-AT',
    loginPath: '/myaccount/login', sellPath: '/iad/myprofile/publishad/create/',
    loggedInSelector: '[data-testid="user-menu"], a[href*="/myprofile"]',
    titleSelector: 'input[name="description"], input[id*="title"], input[placeholder*="Titel" i]',
    descSelector: 'textarea[name="body"], textarea[id*="body"], textarea[placeholder*="Beschreibung" i]',
    priceSelector: 'input[name="price"], input[id*="price"], input[placeholder*="Preis" i]',
  },
  {
    id: 'subito', name: 'Subito', port: 4717,
    baseUrl: 'https://www.subito.it', currency: 'EUR', locale: 'it-IT',
    loginPath: '/areaPersonale/login', sellPath: '/inserisci',
    loggedInSelector: '[data-testid="avatar"], a[href*="/dashboard"]',
    titleSelector: 'input[name="subject"], input[placeholder*="titolo" i]',
    descSelector: 'textarea[name="body"], textarea[placeholder*="descri" i]',
    priceSelector: 'input[name="price"], input[placeholder*="prezzo" i]',
  },
  {
    id: 'ricardo', name: 'Ricardo', port: 4718,
    baseUrl: 'https://www.ricardo.ch', currency: 'CHF', locale: 'de-CH',
    loginPath: '/login', sellPath: '/sell/create',
    loggedInSelector: '[data-testid="user-avatar"], a[href*="/myricardo"]',
    titleSelector: 'input[name="title"], input[placeholder*="Titel" i]',
    descSelector: 'textarea[name="description"], textarea[placeholder*="Beschreibung" i]',
    priceSelector: 'input[name="price"], input[placeholder*="Preis" i]',
  },
];

function createEuAdapter(config: EuMarketConfig): MarketplaceAdapter {
  const log = createLogger(`${config.id}-bot`);
  const dataRoot = process.env[`${config.id.toUpperCase()}_DATA_ROOT`]
    ?? path.join(process.cwd(), 'data', `${config.id}-accounts`);

  async function launch(accountId: number, headless = true) {
    const fp = fingerprintFor(accountId, config.id as any);
    const dir = path.join(dataRoot, String(accountId), 'chromium-profile');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const ctx = await chromium.launchPersistentContext(dir, {
      headless, userAgent: fp.userAgent, viewport: fp.viewport,
      locale: config.locale, timezoneId: fp.timezoneId,
      args: ['--disable-blink-features=AutomationControlled'],
    });
    await ctx.addInitScript(stealthInitScript(fp));
    return ctx;
  }

  async function checkLogin(page: import('playwright').Page) {
    try {
      await page.waitForSelector(config.loggedInSelector, { timeout: 5000 });
      return true;
    } catch { return false; }
  }

  return {
    meta: { id: config.id as any, label: config.name, baseUrl: config.baseUrl, port: config.port, primaryLocale: config.locale },

    async isAuthenticated(accountId) {
      const ctx = await launch(accountId);
      try {
        const page = await ctx.newPage();
        await page.goto(config.baseUrl, { timeout: 20_000 }).catch(() => {});
        return await checkLogin(page);
      } finally { await ctx.close(); }
    },

    async login(accountId) {
      const ctx = await launch(accountId, false);
      try {
        const page = await ctx.newPage();
        await page.goto(`${config.baseUrl}${config.loginPath}`, { timeout: 30_000 });
        const deadline = Date.now() + 600_000;
        while (Date.now() < deadline) {
          if (await checkLogin(page)) return { ok: true };
          await page.waitForTimeout(3000);
        }
        return { ok: false, error: 'login timeout' };
      } finally { await ctx.close(); }
    },

    async publish(accountId: number, draft: ListingDraft): Promise<PublishResult> {
      const ctx = await launch(accountId, true);
      try {
        const page = await ctx.newPage();
        await page.goto(`${config.baseUrl}${config.sellPath}`, {
          timeout: 30_000, waitUntil: 'domcontentloaded',
        });

        if (!(await checkLogin(page))) {
          return { ok: false, error: 'not authenticated' };
        }

        // Upload photos
        if (draft.photos?.length) {
          const fileInput = await page.$('input[type="file"]');
          if (fileInput) {
            await fileInput.setInputFiles(draft.photos.slice(0, 10));
            await page.waitForTimeout(3000);
          }
        }

        // Fill form fields
        await page.fill(config.titleSelector, (draft.title ?? '').slice(0, 80)).catch(() => {});
        await page.waitForTimeout(500);
        await page.fill(config.descSelector, draft.description ?? '').catch(() => {});
        await page.waitForTimeout(500);
        await page.fill(config.priceSelector, String(draft.priceEur ?? 0)).catch(() => {});
        await page.waitForTimeout(500);

        log.info(`${config.name} form filled — manual review required`, { folderNum: draft.folderNum });
        return { ok: true, externalId: '', externalUrl: page.url() };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      } finally { await ctx.close(); }
    },

    async deactivate(): Promise<DeactivateResult> {
      return { ok: false, error: 'not yet implemented' };
    },
    async updatePrice() { return { ok: false, error: 'not implemented' }; },
  };
}

// ── Export all adapters ──────────────────────────────────────────────────────

export const euAdapters = Object.fromEntries(
  EU_MARKETS.map(cfg => [cfg.id, createEuAdapter(cfg)])
);

// ── Boot all servers ─────────────────────────────────────────────────────────

export function startEuBots() {
  for (const config of EU_MARKETS) {
    try {
      const adapter = euAdapters[config.id]!;
      const app = express();
      app.use(express.json({ limit: '10mb' }));

      app.get('/api/health', (_, res) => res.json({ ok: true, marketplace: config.id, port: config.port }));
      app.get('/api/auth/status', async (req, res) => {
        try { res.json({ ok: await adapter.isAuthenticated(Number(req.query.account_id ?? 1)) }); }
        catch (e) { res.status(500).json({ error: String(e) }); }
      });
      app.post('/api/auth/login', async (req, res) => {
        try { res.json(await adapter.login(Number(req.body?.account_id ?? 1))); }
        catch (e) { res.status(500).json({ error: String(e) }); }
      });
      app.post('/api/listings/publish', async (req, res) => {
        try { res.json(await adapter.publish(Number(req.body?.account_id ?? 1), req.body?.draft)); }
        catch (e) { res.status(500).json({ error: String(e) }); }
      });

      app.listen(config.port, () => {
        const log = createLogger(`${config.id}-bot`);
        log.info(`${config.name} Bot listening on :${config.port}`);
      });
    } catch (err) {
      const log = createLogger(`${config.id}-bot`);
      log.error(`${config.name} Bot failed to start`, {
        error: err instanceof Error ? err.message : String(err),
      });
      // Continue starting other bots — don't let one failure cascade.
    }
  }
}

// Auto-start if run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  startEuBots();
}
