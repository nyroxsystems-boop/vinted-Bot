// ──────────────────────────────────────────────────────────────────────────────
// CJ Auto-Discovery Worker
//
// Continuously surfaces new products from CJ Dropshipping matching the user's
// criteria (price band, category, rating), scores them, and queues the top-N
// for import into `crawled_products` so the existing image-gen + variant-gen
// + auto-publisher pipeline picks them up.
//
// Settings:
//   cj_discovery_enabled         — 'true' to run the worker
//   cj_discovery_queries         — JSON array of search keywords
//   cj_discovery_min_cost_eur    — min product cost (default 4)
//   cj_discovery_max_cost_eur    — max product cost (default 18)
//   cj_discovery_target_margin   — min profit margin in € (default 12)
//   cj_discovery_warehouses      — JSON array of preferred warehouses ['CN','DE']
//   cj_discovery_max_per_cycle   — how many to import per tick (default 5)
//
// Score formula:
//   margin_score (0..1) — bigger margin = better
//   price_band_score    — penalises near min/max cost
//   has_image_score     — +0.1 if cover image url present
//
// Pipeline:
//   tick() — every 30 min by default
//     1. For each query, call cj-service /search?keyword=...
//     2. For each result not already in cj_discovery_queue: insert with score
//     3. Pick top-N queued, mark 'importing', fetch detail, create crawled_products
//        row + folder + source images. Mark 'imported'.
//     4. image-generator worker picks up the crawled_products row.
// ──────────────────────────────────────────────────────────────────────────────

import fs from 'node:fs/promises';
import path from 'node:path';
import {
  assignFolderToAccount,
  createLogger,
  getDb,
  getSetting,
  isPaused,
  pickNextAccountForFolder,
  shouldThrottleCj,
  withLock,
} from '@vinted-system/shared';

const log = createLogger('cj-discovery');
const CJ_SERVICE_URL = process.env.CJ_SERVICE_URL ?? 'http://localhost:4720';

let timer: ReturnType<typeof setInterval> | null = null;
let isRunning = false;

const POLL_INTERVAL_MS = 30 * 60 * 1000; // 30 min — discovery is bursty, no need to hammer
const PRODUCTS_ROOT = process.env.CJ_PRODUCTS_ROOT
  ?? path.resolve(process.cwd(), '../model bilder');

interface CJSearchHit {
  pid: string;
  productSku?: string;
  productName?: string;
  productNameEn?: string;
  productImage?: string;
  categoryId?: string;
  categoryName?: string;
  sellPrice?: string | number;
  productScore?: number;
}

interface DiscoveryConfig {
  enabled: boolean;
  queries: string[];
  minCostEur: number;
  maxCostEur: number;
  targetMarginEur: number;
  warehouses: string[];
  maxPerCycle: number;
  sellPriceEur: number;
}

function loadConfig(): DiscoveryConfig {
  const queriesRaw = getSetting('cj_discovery_queries') ?? '[]';
  let queries: string[] = [];
  try {
    queries = JSON.parse(queriesRaw);
    if (!Array.isArray(queries)) queries = [];
  } catch { /* ignore */ }
  if (queries.length === 0) {
    queries = [
      'women summer dress',
      'women mini dress',
      'women crop top',
      'women high waist jeans',
    ];
  }
  return {
    enabled: getSetting('cj_discovery_enabled') === 'true',
    queries,
    minCostEur: Number.parseFloat(getSetting('cj_discovery_min_cost_eur') ?? '4'),
    maxCostEur: Number.parseFloat(getSetting('cj_discovery_max_cost_eur') ?? '18'),
    targetMarginEur: Number.parseFloat(getSetting('cj_discovery_target_margin') ?? '12'),
    warehouses: (() => {
      try { return JSON.parse(getSetting('cj_discovery_warehouses') ?? '["CN","DE"]'); }
      catch { return ['CN', 'DE']; }
    })(),
    maxPerCycle: Number.parseInt(getSetting('cj_discovery_max_per_cycle') ?? '5', 10),
    sellPriceEur: Number.parseFloat(getSetting('listing_price_default') ?? '28'),
  };
}

// USD → EUR rough convert (cj-service can override with live rates)
const USD_TO_EUR = Number(process.env.USD_EUR_RATE ?? 0.92);

function scoreHit(hit: CJSearchHit, cfg: DiscoveryConfig): number {
  const usd = Number(hit.sellPrice ?? 0);
  if (!usd) return 0;
  const costEur = Math.round(usd * USD_TO_EUR * 100) / 100;

  if (costEur < cfg.minCostEur || costEur > cfg.maxCostEur) return 0;

  // Margin score — full mark if expected margin ≥ targetMarginEur
  const margin = cfg.sellPriceEur - costEur;
  const marginScore = Math.max(0, Math.min(1, margin / cfg.targetMarginEur));

  // Price-band score — peak in the middle of [min..max]
  const mid = (cfg.minCostEur + cfg.maxCostEur) / 2;
  const halfBand = (cfg.maxCostEur - cfg.minCostEur) / 2;
  const distance = Math.abs(costEur - mid) / halfBand;
  const bandScore = Math.max(0, 1 - distance);

  const imgScore = hit.productImage ? 0.1 : 0;
  const cjScore = (hit.productScore ?? 0) / 5;  // CJ's own rating 0-5 normalised

  return marginScore * 0.5 + bandScore * 0.25 + cjScore * 0.15 + imgScore;
}

async function searchCJ(query: string, cfg: DiscoveryConfig): Promise<CJSearchHit[]> {
  // Convert € band to $ band for the CJ API
  const params = new URLSearchParams({
    keyword: query,
    pageSize: '40',
    minPrice: String(Math.floor(cfg.minCostEur / USD_TO_EUR)),
    maxPrice: String(Math.ceil(cfg.maxCostEur / USD_TO_EUR)),
  });
  const r = await fetch(`${CJ_SERVICE_URL}/api/products/search?${params}`, {
    signal: AbortSignal.timeout(60_000),
  });
  if (!r.ok) {
    log.warn('CJ search returned non-OK', { query, status: r.status });
    return [];
  }
  // cj-service `/api/products/search` returns `{ ok, products[], count }` —
  // NOT the raw CJ-API `list[]`. Read the proxied field; fall back to `list`
  // for safety if the cj-service shape ever changes back.
  const data = await r.json() as { products?: CJSearchHit[]; list?: CJSearchHit[] };
  return data.products ?? data.list ?? [];
}

function alreadyKnown(cjProductId: string): boolean {
  const row = getDb().prepare(
    `SELECT 1 FROM cj_discovery_queue WHERE cj_product_id = ?`,
  ).get(cjProductId);
  return !!row;
}

function insertQueued(hit: CJSearchHit, cfg: DiscoveryConfig, query: string): void {
  if (alreadyKnown(hit.pid)) return;
  const score = scoreHit(hit, cfg);
  const usd = Number(hit.sellPrice ?? 0);
  const eur = Math.round(usd * USD_TO_EUR * 100) / 100;

  const status = score >= 0.3 ? 'queued' : 'skipped';
  const skipReason = status === 'skipped' ? `score=${score.toFixed(2)}` : null;

  getDb().prepare(
    `INSERT INTO cj_discovery_queue
       (cj_product_id, cj_sku, title, category_id, category_path,
        cost_usd, cost_eur, image_url, source_query, score, status, skip_reason)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    hit.pid,
    hit.productSku ?? null,
    hit.productNameEn ?? hit.productName ?? null,
    hit.categoryId ?? null,
    hit.categoryName ?? null,
    usd,
    eur,
    hit.productImage ?? null,
    query,
    score,
    status,
    skipReason,
  );
}

async function importTopQueued(cfg: DiscoveryConfig): Promise<{ imported: number; errors: number }> {
  const top = getDb().prepare(
    `SELECT id, cj_product_id, cj_sku, title, image_url
       FROM cj_discovery_queue
      WHERE status = 'queued'
      ORDER BY score DESC
      LIMIT ?`,
  ).all(cfg.maxPerCycle) as Array<{
    id: number; cj_product_id: string; cj_sku: string | null;
    title: string | null; image_url: string | null;
  }>;

  let imported = 0;
  let errors = 0;

  for (const row of top) {
    try {
      getDb().prepare(
        `UPDATE cj_discovery_queue SET status = 'importing', updated_at = datetime('now') WHERE id = ?`,
      ).run(row.id);

      // Fetch detail (more images, attributes)
      const detail = await fetchDetail(row.cj_product_id);
      if (!detail) {
        getDb().prepare(
          `UPDATE cj_discovery_queue SET status = 'failed', last_error = 'detail fetch failed', updated_at = datetime('now') WHERE id = ?`,
        ).run(row.id);
        errors++;
        continue;
      }

      // Determine folder_num — next free integer
      const maxFn = getDb().prepare(`SELECT MAX(folder_num) AS m FROM crawled_products`).get() as { m: number | null } | undefined;
      const folderNum = (maxFn?.m ?? 0) + 1;

      // Create source-image folder structure: <PRODUCTS_ROOT>/Kleider/<folderNum>/<sku>/source/
      const sku = row.cj_sku ?? `CJ${row.cj_product_id}`;
      const baseDir = path.join(PRODUCTS_ROOT, 'CJ-Auto', String(folderNum), sku);
      const sourceDir = path.join(baseDir, 'source');
      await fs.mkdir(sourceDir, { recursive: true });

      // Download images
      const imgs = detail.productImageSet ?? (row.image_url ? [row.image_url] : []);
      let dlCount = 0;
      for (let i = 0; i < Math.min(5, imgs.length); i++) {
        const url = imgs[i];
        if (!url) continue;
        try {
          const resp = await fetch(url, { signal: AbortSignal.timeout(20_000) });
          if (!resp.ok) continue;
          const buf = Buffer.from(await resp.arrayBuffer());
          await fs.writeFile(path.join(sourceDir, `${i + 1}_cj.jpg`), buf);
          dlCount++;
        } catch (e) {
          log.debug('img dl skip', { url, err: e instanceof Error ? e.message : String(e) });
        }
      }
      if (dlCount === 0) {
        getDb().prepare(
          `UPDATE cj_discovery_queue SET status = 'failed', last_error = 'no images downloaded', updated_at = datetime('now') WHERE id = ?`,
        ).run(row.id);
        errors++;
        continue;
      }

      // Create crawled_products row → image-generator will pick it up.
      // Pre-pick the round-robin Vinted account so the listing-watcher knows
      // which account owns this folder. NULL is OK when no Vinted accounts
      // are active yet — assignFolderToAccount/backfill will claim it later.
      const preAssignedAcc = pickNextAccountForFolder('vinted');
      const insert = getDb().prepare(
        `INSERT INTO crawled_products
           (temu_goods_id, temu_url, title, price_eur, search_query, description, folder_num, folder_path, status, assigned_account_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'crawled', ?)`,
      );
      insert.run(
        `cj:${row.cj_product_id}`,
        `https://app.cjdropshipping.com/product/${row.cj_product_id}`,
        row.title,
        detail.cost_eur ?? null,
        null,
        detail.description ?? null,
        folderNum,
        baseDir,
        preAssignedAcc,
      );
      const cpId = (getDb().prepare(`SELECT last_insert_rowid() AS id`).get() as { id: number }).id;

      getDb().prepare(
        `UPDATE cj_discovery_queue
            SET status = 'imported', crawled_product_id = ?, updated_at = datetime('now')
          WHERE id = ?`,
      ).run(cpId, row.id);

      imported++;
      log.info('Imported CJ product', { pid: row.cj_product_id, folderNum, images: dlCount });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      getDb().prepare(
        `UPDATE cj_discovery_queue SET status = 'failed', last_error = ?, updated_at = datetime('now') WHERE id = ?`,
      ).run(msg, row.id);
      errors++;
      log.warn('Import error', { id: row.id, err: msg });
    }
  }

  return { imported, errors };
}

interface CJDetailResp {
  productImageSet?: string[];
  description?: string;
  cost_eur?: number;
}

async function fetchDetail(pid: string): Promise<CJDetailResp | null> {
  try {
    const r = await fetch(`${CJ_SERVICE_URL}/api/products/${encodeURIComponent(pid)}`, {
      signal: AbortSignal.timeout(20_000),
    });
    if (!r.ok) return null;
    const data = await r.json() as CJDetailResp;
    return data;
  } catch { return null; }
}

async function tick(): Promise<void> {
  if (isRunning) return;
  if (isPaused()) return;
  const cfg = loadConfig();
  if (!cfg.enabled) return;
  // Quota guard: discovery is non-critical — back off at 80% so the order
  // pipeline keeps its budget. CJ caps accounts at ~1000 calls/day.
  if (shouldThrottleCj('discovery')) {
    log.warn('CJ quota high, skipping discovery cycle');
    return;
  }
  isRunning = true;
  try {
    await withLock('cj-discovery-tick', 600, async () => {
      const startedAt = new Date().toISOString();
      let rawFound = 0;
      let skipped = 0;

      for (const q of cfg.queries) {
        try {
          const hits = await searchCJ(q, cfg);
          rawFound += hits.length;
          for (const hit of hits) {
            const before = getDb().prepare(
              `SELECT COUNT(*) AS n FROM cj_discovery_queue WHERE cj_product_id = ?`,
            ).get(hit.pid) as { n: number };
            if (before.n > 0) { skipped++; continue; }
            insertQueued(hit, cfg, q);
          }
        } catch (err) {
          log.warn('Query failed', { q, err: err instanceof Error ? err.message : String(err) });
        }
      }

      const { imported, errors } = await importTopQueued(cfg);

      getDb().prepare(
        `INSERT INTO cj_discovery_runs (queries, filter_json, raw_found, imported, skipped, errors, started_at, ended_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
      ).run(
        JSON.stringify(cfg.queries),
        JSON.stringify({ minCostEur: cfg.minCostEur, maxCostEur: cfg.maxCostEur, warehouses: cfg.warehouses }),
        rawFound,
        imported,
        skipped,
        errors,
        startedAt,
      );

      log.info('Discovery cycle complete', { rawFound, imported, skipped, errors });
    });
  } catch (err) {
    log.warn('Tick failed', { err: err instanceof Error ? err.message : String(err) });
  } finally {
    isRunning = false;
  }
}

/** One-shot backfill at boot: any pre-existing crawled_products rows that
 *  predate the assigned_account_id column (or were inserted while no Vinted
 *  account was active) get a round-robin assignment now. Skips rows in
 *  terminal states (archived/sold) — those don't need owners anymore.
 *
 *  Guarded with `backfillDone` so the function only runs once per process. */
let backfillDone = false;
function backfillFolderAssignments(): void {
  if (backfillDone) return;
  backfillDone = true;
  try {
    const unassigned = getDb()
      .prepare(
        `SELECT id, folder_num FROM crawled_products
          WHERE assigned_account_id IS NULL
            AND status NOT IN ('archived','sold')
          ORDER BY id ASC`,
      )
      .all() as Array<{ id: number; folder_num: number }>;
    if (unassigned.length === 0) return;

    let assigned = 0;
    for (const cp of unassigned) {
      const accId = assignFolderToAccount(cp.id, 'vinted');
      if (accId === null) break; // no active vinted accounts — bail until later
      assigned++;
    }
    if (assigned > 0) {
      log.info(`Backfilled ${assigned} crawled_products to accounts (round-robin)`);
    }
  } catch (err) {
    log.warn('Backfill failed', { err: err instanceof Error ? err.message : String(err) });
  }
}

export function startCjDiscovery(): void {
  if (timer) return;
  log.info(`CJ discovery worker started — interval ${POLL_INTERVAL_MS / 60_000} min`);
  // One-shot: assign any legacy unassigned crawled_products rows.
  backfillFolderAssignments();
  setTimeout(() => void tick(), 60_000); // first tick after 1 min
  timer = setInterval(() => void tick(), POLL_INTERVAL_MS);
}

export function stopCjDiscovery(): void {
  if (timer) { clearInterval(timer); timer = null; log.info('CJ discovery stopped'); }
}

/** Manual one-shot trigger for the dashboard. */
export async function runCjDiscoveryOnce(): Promise<{ ok: boolean; imported?: number; errors?: number }> {
  if (isRunning) return { ok: false };
  await tick();
  // Return last-run stats from DB
  const r = getDb().prepare(
    `SELECT imported, errors FROM cj_discovery_runs ORDER BY id DESC LIMIT 1`,
  ).get() as { imported: number; errors: number } | undefined;
  return { ok: true, imported: r?.imported ?? 0, errors: r?.errors ?? 0 };
}
