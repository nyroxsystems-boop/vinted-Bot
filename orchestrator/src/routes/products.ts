// ──────────────────────────────────────────────────────────────────────────────
// Products REST routes — filesystem-based product folder scanner.
//
// GET  /api/products                → list all product folders with status
// GET  /api/products/:folderNum     → single folder detail (images, models)
// POST /api/products/:folderNum/generate-listing → generate a Vinted listing draft
// PATCH /api/products/:folderNum/photo-order → update photo ordering
// ──────────────────────────────────────────────────────────────────────────────

import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { createLogger, getDb, safeResolveAssetPath, vintedRoot } from '@vinted-system/shared';
import { autoFillListing, loadTemuContext } from '../llm-listing-generator.js';
import { pushToMarketplaces, syncSoldToOthers, BOT_ENDPOINTS } from '../marketplaces.js';
import { collectPerformance, topListings, staleListings } from '../performance-collector.js';
import { runRepriceCycle, recentRepriceLog, repriceLogForFolder } from '../repricer.js';
import {
  runReplyAutopilotCycle,
  pendingReplies,
  recentReplyLog,
  sendDraftReply,
  rejectDraftReply,
} from '../reply-autopilot.js';
import type { MarketplaceId } from '@vinted-system/shared';

const log = createLogger('products-route');

export const productsRouter = Router();

const VINTED_ROOT = vintedRoot();

// ── Types ────────────────────────────────────────────────────────────────────

interface ModelStatus {
  model: string;         // "model_1" | "model_2" | "model_3"
  label: string;         // "Adeline" | "Lina" | "Mila"
  images: string[];      // filenames found
  count: number;
  complete: boolean;     // has all 5 shots
}

interface ProductFolder {
  folderNum: number;
  folderName: string;
  folderPath: string;
  inputImages: string[];   // source product images in root
  models: ModelStatus[];
  totalGenerated: number;  // total images across all models
  complete: boolean;       // all 3 models × 5 = 15
  hasListing: boolean;     // has an auto_listing entry
  listingStatus: string | null;
  listingId: number | null;
  listing?: unknown;
}

const MODEL_LABELS: Record<string, string> = {
  model_1: 'Adeline',
  model_2: 'Lina',
  model_3: 'Mila',
};

const EXPECTED_SHOTS = ['1_front.jpg', '2_side.jpg', '3_back.jpg', '4_selfie_detail.jpg', '5_flatlay.jpg'];

function isImageFile(f: string): boolean {
  return /\.(jpg|jpeg|png|webp|avif)$/i.test(f);
}

function scanModelDir(folderPath: string, modelDir: string): ModelStatus {
  const modelPath = path.join(folderPath, modelDir);
  let images: string[] = [];
  try {
    images = fs.readdirSync(modelPath).filter(isImageFile).sort();
  } catch { /* dir doesn't exist */ }

  return {
    model: modelDir,
    label: MODEL_LABELS[modelDir] ?? modelDir,
    images,
    count: images.length,
    complete: images.length >= 5,
  };
}

function scanProductFolder(folderName: string, folderPath: string, folderNum: number): ProductFolder {
  // Find source images in root (not in model_X or generated dirs)
  let rootFiles: string[] = [];
  try {
    rootFiles = fs.readdirSync(folderPath);
  } catch { /* folder doesn't exist */ }

  const excludeDirs = new Set(['model_1', 'model_2', 'model_3', 'generated', 'source', '.DS_Store']);
  const inputImages = rootFiles
    .filter((f) => {
      if (excludeDirs.has(f)) return false;
      const stat = fs.statSync(path.join(folderPath, f));
      return stat.isFile() && isImageFile(f) && stat.size > 30_000;
    })
    .sort();

  // Scan model directories
  const models = ['model_1', 'model_2', 'model_3'].map((m) => scanModelDir(folderPath, m));
  const totalGenerated = models.reduce((sum, m) => sum + m.count, 0);

  // Also check legacy generated/ directory
  let legacyGenerated: string[] = [];
  try {
    legacyGenerated = fs.readdirSync(path.join(folderPath, 'generated')).filter(isImageFile);
  } catch { /* no generated dir */ }

  // Check if listing.json exists in folder (filesystem-based)
  let listing: Record<string, unknown> | null = null;
  const listingJsonPath = path.join(folderPath, 'listing.json');
  try {
    listing = JSON.parse(fs.readFileSync(listingJsonPath, 'utf-8'));
  } catch { /* no listing.json */ }

  // Check if listing exists in DB
  let hasListing = !!listing;
  let listingStatus: string | null = (listing?.status as string) ?? null;
  let listingId: number | null = null;
  try {
    const row = getDb()
      .prepare('SELECT id, status FROM auto_listings WHERE folder_num = ? ORDER BY id DESC LIMIT 1')
      .get(folderNum) as Record<string, unknown> | undefined;
    if (row) {
      hasListing = true;
      listingStatus = listingStatus ?? (row.status as string);
      listingId = row.id as number;
    }
  } catch { /* DB not ready */ }

  return {
    folderNum,
    folderName,
    folderPath,
    inputImages,
    models,
    totalGenerated: totalGenerated + legacyGenerated.length,
    complete: models.every((m) => m.complete),
    hasListing,
    listingStatus,
    listingId,
    listing,
  };
}

// ── GET /api/products ────────────────────────────────────────────────────────

productsRouter.get('/', (_req, res) => {
  try {
    const entries = fs.readdirSync(VINTED_ROOT, { withFileTypes: true });

    const folders: ProductFolder[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name.startsWith('_') || entry.name.startsWith('.')) continue;

      // Parse folder number
      let folderNum: number;
      if (entry.name === 'Neuer Ordner') {
        folderNum = 1;
      } else {
        const match = entry.name.match(/^Neuer Ordner (\d+)$/);
        if (!match || !match[1]) continue;
        folderNum = parseInt(match[1], 10);
      }

      const folderPath = path.join(VINTED_ROOT, entry.name);
      folders.push(scanProductFolder(entry.name, folderPath, folderNum));
    }

    // Sort by folder number
    folders.sort((a, b) => a.folderNum - b.folderNum);

    res.json({
      total: folders.length,
      complete: folders.filter((f) => f.complete).length,
      withListings: folders.filter((f) => f.hasListing).length,
      products: folders,
    });
  } catch (e) {
    log.error('Failed to scan products', { error: e instanceof Error ? e.message : String(e) });
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ── Serve product images via /api/products/image?path=... ────────────────────
// IMPORTANT: This route MUST be before /:folderNum to avoid 'image' being
// parsed as a folder number.

productsRouter.get('/image', (req, res) => {
  try {
    const requested = (req.query.path as string | undefined) ?? '';
    const resolved = safeResolveAssetPath(requested);
    if (!resolved) {
      return res.status(400).json({ error: 'Invalid or unauthorized path' });
    }
    if (!fs.existsSync(resolved)) {
      return res.status(404).json({ error: 'Image not found' });
    }
    res.sendFile(resolved);
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ── GET /api/products/:folderNum ─────────────────────────────────────────────

productsRouter.get('/:folderNum', (req, res) => {
  try {
    const folderNum = parseInt(req.params.folderNum, 10);
    if (isNaN(folderNum)) {
      return res.status(400).json({ error: 'Invalid folder number' });
    }
    const folderName = folderNum === 1 ? 'Neuer Ordner' : `Neuer Ordner ${folderNum}`;
    const folderPath = path.join(VINTED_ROOT, folderName);

    if (!fs.existsSync(folderPath)) {
      return res.status(404).json({ error: `Folder "${folderName}" not found` });
    }

    const product = scanProductFolder(folderName, folderPath, folderNum);

    // Get full listing data if exists
    let listing = null;
    try {
      listing = getDb()
        .prepare('SELECT * FROM auto_listings WHERE folder_num = ? ORDER BY id DESC LIMIT 1')
        .get(folderNum);
    } catch { /* no listing */ }

    res.json({ ...product, listing });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ── POST /api/products/:folderNum/listing — Save listing.json ────────────────

productsRouter.post('/:folderNum/listing', (req, res) => {
  try {
    const folderNum = parseInt(req.params.folderNum, 10);
    const folderName = folderNum === 1 ? 'Neuer Ordner' : `Neuer Ordner ${folderNum}`;
    const folderPath = path.join(VINTED_ROOT, folderName);
    const listingPath = path.join(folderPath, 'listing.json');
    fs.writeFileSync(listingPath, JSON.stringify(req.body, null, 2));
    log.info(`Saved listing.json for folder ${folderNum}`);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ── PATCH /api/products/:folderNum/listing — Update listing.json ─────────────

productsRouter.patch('/:folderNum/listing', (req, res) => {
  try {
    const folderNum = parseInt(req.params.folderNum, 10);
    const folderName = folderNum === 1 ? 'Neuer Ordner' : `Neuer Ordner ${folderNum}`;
    const fp = path.join(VINTED_ROOT, folderName, 'listing.json');
    let existing: Record<string, unknown> = {};
    try { existing = JSON.parse(fs.readFileSync(fp, 'utf-8')); } catch {}
    const merged = { ...existing, ...req.body, updated_at: new Date().toISOString() };
    fs.writeFileSync(fp, JSON.stringify(merged, null, 2));
    res.json({ ok: true, listing: merged });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ── POST /api/products/:folderNum/auto-fill — LLM Auto-Fill all fields ───────

productsRouter.post('/:folderNum/auto-fill', async (req, res) => {
  try {
    const folderNum = parseInt(req.params.folderNum ?? '', 10);
    if (isNaN(folderNum)) {
      return res.status(400).json({ error: 'invalid folderNum' });
    }
    const folderName = folderNum === 1 ? 'Neuer Ordner' : `Neuer Ordner ${folderNum}`;
    const folderPath = path.join(VINTED_ROOT, folderName);

    if (!fs.existsSync(folderPath)) {
      return res.status(404).json({ error: 'folder not found' });
    }

    // Collect images: optional override from request body, otherwise scan models
    const bodyPhotos = Array.isArray((req.body as { photos?: unknown }).photos)
      ? ((req.body as { photos?: unknown }).photos as unknown[]).filter((x): x is string => typeof x === 'string')
      : [];

    let imagePaths: string[] = bodyPhotos.length > 0 ? bodyPhotos : [];
    if (imagePaths.length === 0) {
      for (const m of ['model_1', 'model_2', 'model_3']) {
        const dir = path.join(folderPath, m);
        try {
          const files = fs.readdirSync(dir)
            .filter((f) => /\.(jpg|jpeg|png|webp|avif)$/i.test(f))
            .sort()
            .slice(0, 2)
            .map((f) => path.join(dir, f));
          imagePaths.push(...files);
        } catch { /* model dir missing */ }
      }
    }
    imagePaths = imagePaths.slice(0, 6);

    if (imagePaths.length === 0) {
      return res.status(400).json({ error: 'no images found in folder' });
    }

    const temuCtx = loadTemuContext(folderNum);
    const body = req.body as { hintSize?: string; hintColor?: string };
    const result = await autoFillListing({
      folderNum,
      imagePaths,
      ...temuCtx,
      hintSize: body.hintSize,
      hintColor: body.hintColor,
    });

    log.info('Auto-fill done', {
      folderNum,
      source: result.source,
      images: imagePaths.length,
      title: result.listing.title,
    });

    res.json({
      ok: true,
      listing: result.listing,
      source: result.source,
      warnings: result.warnings,
      imagesUsed: imagePaths.length,
    });
  } catch (e) {
    log.error('Auto-fill failed', { err: e instanceof Error ? e.message : String(e) });
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ── POST /api/products/:folderNum/push-multi — Multi-Marketplace Push ────────

productsRouter.post('/:folderNum/push-multi', async (req, res) => {
  try {
    const folderNum = parseInt(req.params.folderNum ?? '', 10);
    if (isNaN(folderNum)) return res.status(400).json({ error: 'invalid folderNum' });

    const body = req.body as { marketplaces?: string[]; account_id?: number };
    const requested = Array.isArray(body.marketplaces) ? body.marketplaces : [];
    const valid: MarketplaceId[] = ['vinted', 'kleinanzeigen', 'mercari', 'depop', 'wallapop'];
    const marketplaces = requested.filter((m): m is MarketplaceId => valid.includes(m as MarketplaceId));
    if (marketplaces.length === 0) return res.status(400).json({ error: 'no valid marketplaces selected' });

    const result = await pushToMarketplaces({
      folderNum,
      marketplaces,
      accountId: body.account_id ?? 1,
    });
    res.json(result);
  } catch (e) {
    log.error('push-multi failed', { err: e instanceof Error ? e.message : String(e) });
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ── GET /api/products/marketplaces/health — Status aller Bot-Server ──────────

productsRouter.get('/marketplaces/health', async (_req, res) => {
  const ids = Object.keys(BOT_ENDPOINTS) as MarketplaceId[];
  const out = await Promise.all(ids.map(async (id) => {
    const url = `${BOT_ENDPOINTS[id]}/api/health`;
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(2000) });
      return { marketplace: id, online: r.ok, status: r.status };
    } catch {
      return { marketplace: id, online: false };
    }
  }));
  res.json({ marketplaces: out });
});

// ── GET /api/products/:folderNum/marketplace-listings — Status pro Plattform ─

productsRouter.get('/:folderNum/marketplace-listings', (req, res) => {
  try {
    const folderNum = parseInt(req.params.folderNum ?? '', 10);
    if (isNaN(folderNum)) return res.status(400).json({ error: 'invalid folderNum' });
    const rows = getDb()
      .prepare(
        `SELECT id, marketplace, account_id, external_id, external_url, status,
                list_price_eur, views, likes, messages, last_error, updated_at
           FROM marketplace_listings
          WHERE folder_num = ?
          ORDER BY marketplace ASC`,
      )
      .all(folderNum);
    res.json({ folderNum, listings: rows });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ── POST /api/products/sold — Sale gemeldet, Cross-Deactivate triggern ───────

productsRouter.post('/sold', async (req, res) => {
  try {
    const { folderNum, soldOn, priceEur, buyerRef } = req.body as {
      folderNum: number;
      soldOn: MarketplaceId;
      priceEur: number;
      buyerRef?: string;
    };
    if (!folderNum || !soldOn) return res.status(400).json({ error: 'missing folderNum or soldOn' });

    const { lockSold } = await import('@vinted-system/shared');
    const others = lockSold(folderNum, soldOn, priceEur, buyerRef);
    const sync = await syncSoldToOthers({ folderNum, soldOn, others });
    res.json({ ok: true, deactivated: sync });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ── POST /api/products/bulk — Massen-Aktionen über mehrere Folder ────────────

productsRouter.post('/bulk', async (req, res) => {
  try {
    const body = req.body as {
      action: 'push-multi' | 'pause' | 'resume' | 'price-change';
      folderNums: number[];
      marketplaces?: string[];
      pricePct?: number; // -10 = -10%
      accountId?: number;
    };
    if (!Array.isArray(body.folderNums) || body.folderNums.length === 0) {
      return res.status(400).json({ error: 'folderNums required' });
    }

    const results: Array<Record<string, unknown>> = [];

    if (body.action === 'push-multi') {
      const valid: MarketplaceId[] = ['vinted', 'kleinanzeigen', 'mercari', 'depop', 'wallapop'];
      const mps = (body.marketplaces ?? []).filter((m): m is MarketplaceId => valid.includes(m as MarketplaceId));
      if (mps.length === 0) return res.status(400).json({ error: 'no valid marketplaces' });
      // Sequenziell um Browser-Profile nicht zu fluten — pro Folder parallele
      // Plattformen, aber Folder nacheinander.
      for (const fn of body.folderNums) {
        const r = await pushToMarketplaces({ folderNum: fn, marketplaces: mps, accountId: body.accountId ?? 1 });
        results.push({ ...r });
      }
    } else if (body.action === 'price-change' && typeof body.pricePct === 'number') {
      const pct = body.pricePct;
      for (const fn of body.folderNums) {
        getDb()
          .prepare(
            `UPDATE marketplace_listings
                SET list_price_eur = ROUND(list_price_eur * (1 + ?/100.0), 2),
                    updated_at = datetime('now')
              WHERE folder_num = ? AND status IN ('active','draft')`,
          )
          .run(pct, fn);
        results.push({ folderNum: fn, ok: true, pct });
      }
    } else if (body.action === 'pause' || body.action === 'resume') {
      const target = body.action === 'pause' ? 'deactivated' : 'active';
      for (const fn of body.folderNums) {
        getDb()
          .prepare(
            `UPDATE marketplace_listings
                SET status = ?, updated_at = datetime('now')
              WHERE folder_num = ? AND status NOT IN ('sold')`,
          )
          .run(target, fn);
        results.push({ folderNum: fn, ok: true, status: target });
      }
    } else {
      return res.status(400).json({ error: 'unsupported action' });
    }

    res.json({ ok: true, count: results.length, results });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ── Per-Marketplace Listings (für eigene UI-Tabs) ────────────────────────────

productsRouter.get('/marketplace/:mp/listings', (req, res) => {
  try {
    const mp = req.params.mp;
    const valid: MarketplaceId[] = ['vinted', 'kleinanzeigen', 'mercari', 'depop', 'wallapop'];
    if (!valid.includes(mp as MarketplaceId)) {
      return res.status(400).json({ error: 'invalid marketplace' });
    }
    const status = (req.query.status as string | undefined) ?? null;
    const params: Array<string | number> = [mp];
    let sql = `SELECT ml.*,
                      al.title       AS folder_title,
                      al.description AS folder_description,
                      al.size        AS folder_size,
                      al.brand       AS folder_brand
                 FROM marketplace_listings ml
                 LEFT JOIN auto_listings al ON al.folder_num = ml.folder_num
                WHERE ml.marketplace = ?`;
    if (status) { sql += ` AND ml.status = ?`; params.push(status); }
    sql += ` ORDER BY ml.updated_at DESC LIMIT 500`;
    const rows = getDb().prepare(sql).all(...params);
    res.json({ marketplace: mp, listings: rows });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

productsRouter.get('/marketplace/:mp/summary', (req, res) => {
  try {
    const mp = req.params.mp;
    const counts = getDb()
      .prepare(
        `SELECT status, COUNT(*) AS n
           FROM marketplace_listings
          WHERE marketplace = ?
          GROUP BY status`,
      )
      .all(mp) as Array<{ status: string; n: number }>;
    const totals = getDb()
      .prepare(
        `SELECT COALESCE(SUM(views),0) AS views,
                COALESCE(SUM(likes),0) AS likes,
                COALESCE(SUM(messages),0) AS messages
           FROM marketplace_listings
          WHERE marketplace = ?`,
      )
      .get(mp);
    res.json({ marketplace: mp, counts, totals });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ── Performance ─────────────────────────────────────────────────────────────

productsRouter.post('/performance/collect', async (req, res) => {
  try {
    const limit = Number((req.body as { limit?: number })?.limit ?? 100);
    const stats = await collectPerformance({ limit });
    res.json({ ok: true, ...stats });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

productsRouter.get('/performance/top', (req, res) => {
  try {
    const by = (req.query.by as string | undefined) === 'likes' ? 'likes' : 'views';
    const limit = Number(req.query.limit ?? 20);
    res.json({ listings: topListings({ by, limit }) });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

productsRouter.get('/performance/stale', (req, res) => {
  try {
    const days = Number(req.query.days ?? 7);
    res.json({ listings: staleListings(days) });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

productsRouter.get('/:folderNum/metrics', (req, res) => {
  try {
    const folderNum = parseInt(req.params.folderNum ?? '', 10);
    if (isNaN(folderNum)) return res.status(400).json({ error: 'invalid folderNum' });
    const rows = getDb()
      .prepare(
        `SELECT lm.*, ml.marketplace, ml.external_url
           FROM listing_metrics lm
           JOIN marketplace_listings ml ON ml.id = lm.marketplace_listing_id
          WHERE ml.folder_num = ?
          ORDER BY lm.date DESC, lm.id DESC
          LIMIT 200`,
      )
      .all(folderNum);
    res.json({ folderNum, metrics: rows });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ── Repricing ───────────────────────────────────────────────────────────────

productsRouter.post('/repricer/run', async (_req, res) => {
  try {
    const stats = await runRepriceCycle();
    res.json({ ok: true, ...stats });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

productsRouter.get('/repricer/log', (req, res) => {
  try {
    const limit = Number(req.query.limit ?? 50);
    res.json({ entries: recentRepriceLog(limit) });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

productsRouter.get('/:folderNum/repricer-log', (req, res) => {
  try {
    const folderNum = parseInt(req.params.folderNum ?? '', 10);
    if (isNaN(folderNum)) return res.status(400).json({ error: 'invalid folderNum' });
    res.json({ folderNum, entries: repriceLogForFolder(folderNum) });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ── Reply-Autopilot ─────────────────────────────────────────────────────────

productsRouter.post('/replies/run', async (_req, res) => {
  try {
    const stats = await runReplyAutopilotCycle();
    res.json({ ok: true, ...stats });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

productsRouter.get('/replies/pending', (req, res) => {
  try {
    const limit = Number(req.query.limit ?? 50);
    res.json({ entries: pendingReplies(limit) });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

productsRouter.get('/replies/log', (req, res) => {
  try {
    const limit = Number(req.query.limit ?? 100);
    res.json({ entries: recentReplyLog(limit) });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

productsRouter.post('/replies/:id/send', async (req, res) => {
  try {
    const id = parseInt(req.params.id ?? '', 10);
    if (isNaN(id)) return res.status(400).json({ error: 'invalid id' });
    const edited = (req.body as { edited?: string })?.edited;
    const result = await sendDraftReply(id, edited);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

productsRouter.post('/replies/:id/reject', (req, res) => {
  try {
    const id = parseInt(req.params.id ?? '', 10);
    if (isNaN(id)) return res.status(400).json({ error: 'invalid id' });
    rejectDraftReply(id);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ── POST /api/products/push — Bulk push listings to Vinted via Playwright ────

productsRouter.post('/push', (req, res) => {
  try {
    const { folder_nums } = req.body as { folder_nums: number[] };
    if (!Array.isArray(folder_nums) || folder_nums.length === 0) {
      return res.status(400).json({ error: 'folder_nums required' });
    }

    // Read each listing.json, queue for Playwright
    const queued: number[] = [];
    const errors: { folder: number; error: string }[] = [];

    for (const num of folder_nums) {
      const name = num === 1 ? 'Neuer Ordner' : `Neuer Ordner ${num}`;
      const fp = path.join(VINTED_ROOT, name, 'listing.json');
      try {
        const listing = JSON.parse(fs.readFileSync(fp, 'utf-8'));
        if (listing.status !== 'ready') {
          errors.push({ folder: num, error: 'Not ready' });
          continue;
        }
        // Update status to publishing
        listing.status = 'publishing';
        listing.queued_at = new Date().toISOString();
        fs.writeFileSync(fp, JSON.stringify(listing, null, 2));

        // Queue for Playwright push (write to _queue/)
        const queueDir = path.join(VINTED_ROOT, '_push_queue');
        if (!fs.existsSync(queueDir)) fs.mkdirSync(queueDir, { recursive: true });
        fs.writeFileSync(
          path.join(queueDir, `${num}_push.json`),
          JSON.stringify({ folder_num: num, listing, queued_at: listing.queued_at }, null, 2),
        );
        queued.push(num);
      } catch (e) {
        errors.push({ folder: num, error: e instanceof Error ? e.message : String(e) });
      }
    }

    log.info(`Push queued: ${queued.length} listings, ${errors.length} errors`);
    res.json({ ok: true, queued, errors });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ── PATCH /api/products/:folderNum/photo-order ───────────────────────────────

productsRouter.patch('/:folderNum/photo-order', (req, res) => {
  try {
    const folderNum = parseInt(req.params.folderNum, 10);
    const { photo_paths } = req.body as { photo_paths: string[] };

    if (!Array.isArray(photo_paths)) {
      return res.status(400).json({ error: 'photo_paths must be an array' });
    }

    const result = getDb()
      .prepare(`UPDATE auto_listings SET photo_paths_json = ?, updated_at = datetime('now') WHERE folder_num = ?`)
      .run(JSON.stringify(photo_paths), folderNum);

    res.json({ ok: true, changes: result.changes });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});
