// ──────────────────────────────────────────────────────────────────────────────
// Crosslist API Router
//
// POST /api/crosslist/push       — Push a listing to specific platforms
// POST /api/crosslist/push-all   — Push a listing to ALL enabled platforms
// GET  /api/crosslist/platforms  — List all platforms with status
// GET  /api/crosslist/health     — Health check all bots
// ──────────────────────────────────────────────────────────────────────────────

import express from 'express';
import { createLogger, getCurrentAccountId, getDb } from '@vinted-system/shared';
import { BOT_ENDPOINTS } from '../marketplaces.js';
import { generateCrosslisting, type CrosslistingInput } from '../crosslisting-templates.js';

const log = createLogger('crosslist-router');
export const crosslistRouter = express.Router();

const ALL_PLATFORMS = Object.keys(BOT_ENDPOINTS);

// ── Push to specific platforms ───────────────────────────────────────────────

crosslistRouter.post('/push', async (req, res) => {
  const { folder_num, platforms, listing_data } = req.body;
  const account_id = (req.body?.account_id as number | undefined) ?? getCurrentAccountId();

  if (!platforms?.length || !listing_data) {
    return res.status(400).json({ error: 'platforms[] and listing_data required' });
  }

  const jobId = `crosslist_${Date.now()}`;
  const results: Record<string, { ok: boolean; error?: string; externalUrl?: string }> = {};

  log.info('Crosslist push started', { jobId, platforms, folderNum: folder_num });

  for (const platform of platforms) {
    try {
      const template = generateCrosslisting(platform, listing_data as CrosslistingInput);

      // Route: API-based platforms get direct API calls, bots get HTTP
      const endpoint = BOT_ENDPOINTS[platform as keyof typeof BOT_ENDPOINTS];

      if (platform === 'shopify' || platform === 'woocommerce') {
        // API-based — import dynamically to avoid hard dependency
        try {
          if (platform === 'shopify') {
            const { shopifyCreateProduct } = await import('../shopify-api.js');
            results[platform] = await shopifyCreateProduct({
              title: template.title, description: template.description,
              priceEur: template.priceLocal, photos: listing_data.image_urls ?? [],
            } as any);
          } else {
            const { wooCreateProduct } = await import('../woocommerce-api.js');
            results[platform] = await wooCreateProduct({
              title: template.title, description: template.description,
              priceEur: template.priceLocal, photos: listing_data.image_urls ?? [],
            } as any);
          }
        } catch (apiErr) {
          results[platform] = { ok: false, error: `API import failed: ${apiErr}` };
        }
      } else if (endpoint && endpoint !== 'API') {
        // Bot-based — HTTP POST to bot
        try {
          const resp = await fetch(`${endpoint}/api/listings/publish`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              account_id,
              draft: {
                folderNum: folder_num,
                title: template.title,
                description: template.description,
                priceEur: template.priceLocal,
                brand: listing_data.brand ?? '',
                category: listing_data.category ?? '',
                size: listing_data.size ?? '',
                condition: listing_data.condition ?? '',
                colors: listing_data.colors ?? [],
                material: listing_data.material ?? '',
                photos: listing_data.image_urls ?? [],
                shipping: listing_data.shipping ?? 'Standard',
              },
            }),
            signal: AbortSignal.timeout(60_000),
          });
          const data = await resp.json().catch(() => ({ ok: false, error: 'invalid response' }));
          results[platform] = data as any;
        } catch (fetchErr) {
          results[platform] = { ok: false, error: `Bot unreachable: ${fetchErr}` };
        }
      } else {
        results[platform] = { ok: false, error: 'no bot endpoint configured' };
        continue;
      }

      // Log to DB
      try {
        const db = getDb();
        db.prepare(`INSERT OR IGNORE INTO marketplace_listings 
          (folder_num, marketplace, external_id, external_url, status, account_id, created_at)
          VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`)
          .run(
            folder_num ?? 0, platform,
            (results[platform] as any)?.externalId ?? '',
            (results[platform] as any)?.externalUrl ?? '',
            results[platform]?.ok ? 'active' : 'failed',
            account_id,
          );
      } catch { /* DB log is best-effort */ }

      log.info(`Crosslist ${platform}`, { ok: results[platform]?.ok });
    } catch (err) {
      results[platform] = { ok: false, error: err instanceof Error ? err.message : String(err) };
      log.error(`Crosslist ${platform} failed`, { error: results[platform].error });
    }
  }

  const summary = {
    jobId,
    total: platforms.length,
    success: Object.values(results).filter(r => r.ok).length,
    failed: Object.values(results).filter(r => !r.ok).length,
    results,
  };

  log.info('Crosslist push done', summary);
  res.json(summary);
});

// ── Push to ALL platforms ────────────────────────────────────────────────────

crosslistRouter.post('/push-all', async (req, res) => {
  // Re-use the push logic by setting platforms to ALL and forwarding
  req.body.platforms = ALL_PLATFORMS;
  // Forward to the /push handler via next() middleware chain
  const next = crosslistRouter.stack.find(
    (layer: any) => layer.route?.path === '/push' && layer.route?.methods?.post,
  );
  if (next) {
    return next.handle(req, res, () => res.status(500).json({ error: 'push handler did not respond' }));
  }
  res.status(500).json({ error: 'push route not found' });
});

// ── List platforms ───────────────────────────────────────────────────────────

crosslistRouter.get('/platforms', (_req, res) => {
  const platforms = ALL_PLATFORMS.map(id => {
    const endpoint = BOT_ENDPOINTS[id as keyof typeof BOT_ENDPOINTS];
    return {
      id,
      endpoint: endpoint === 'API' ? 'API-based' : endpoint,
      type: endpoint === 'API' ? 'api' : 'bot',
    };
  });
  res.json({ platforms, total: platforms.length });
});

// ── Health check all bots ────────────────────────────────────────────────────

crosslistRouter.get('/health', async (_req, res) => {
  const results: Record<string, { ok: boolean; error?: string }> = {};

  await Promise.allSettled(
    ALL_PLATFORMS.map(async (id) => {
      const endpoint = BOT_ENDPOINTS[id as keyof typeof BOT_ENDPOINTS];
      if (!endpoint || endpoint === 'API') {
        results[id] = { ok: true };
        return;
      }
      try {
        const resp = await fetch(`${endpoint}/api/health`, { signal: AbortSignal.timeout(3000) });
        const data = await resp.json() as any;
        results[id] = { ok: data.ok === true };
      } catch {
        results[id] = { ok: false, error: 'unreachable' };
      }
    })
  );

  const online = Object.values(results).filter(r => r.ok).length;
  res.json({ online, total: ALL_PLATFORMS.length, results });
});
