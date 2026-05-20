// ──────────────────────────────────────────────────────────────────────────────
// CJ Auto-Matcher Worker
//
// Findet Listings ohne CJ-Mapping und verbindet sie automatisch mit einem
// passenden CJ-Produkt anhand des Titels + Kategorie. So müssen Customer
// nicht manuell pro Listing einen CJ-Variant raussuchen, bevor sie publishen.
//
// Heuristik (simpel, gut genug):
//   1. Listing-Title → extrahiere keywords (Substantive, Farbe, Größe raus)
//   2. CJ-Search mit den 2-3 wichtigsten keywords
//   3. Top-Result → check ob Title-Wörter ≥50% überlappen
//   4. Wenn ja: INSERT in cj_products + UPDATE auto_listings.cj_variant_id
//   5. Wenn nein: leave unmatched, surface in UI für manual match
//
// Läuft alle 30 min. Kann auch via POST /api/cj/auto-match manuell getriggert
// werden (Pipeline-Tab Button).
// ──────────────────────────────────────────────────────────────────────────────

import { createLogger, getDb, getSetting, isPaused, withLock, recordWorkerEvent } from '@vinted-system/shared';

const log = createLogger('cj-auto-matcher');

const CJ_SERVICE_URL = process.env.CJ_SERVICE_URL ?? 'http://localhost:4702';
const POLL_MS = 30 * 60 * 1000; // 30 min
let timer: NodeJS.Timeout | null = null;

export interface MatchResult {
  scanned: number;
  matched: number;
  failed: number;
  details: Array<{
    folder_num: number;
    title: string;
    status: 'matched' | 'no_match' | 'error';
    cj_product_id?: string;
    cj_variant_id?: string;
    cost_eur?: number;
    error?: string;
  }>;
}

interface CJProduct {
  pid: string;
  productName?: string;
  productSku?: string;
  sellPrice?: number | string;
  variants?: Array<{ vid: string; variantSku?: string; variantSellPrice?: number | string }>;
  productImage?: string;
}

const STOPWORDS = new Set([
  'damen', 'herren', 'kinder', 'für', 'die', 'der', 'das', 'mit', 'ohne', 'aus',
  'kleid', 'kleider', 'hose', 'hosen', 'shirt', 'shirts', 'pullover', 'pulli',
  'sehr', 'gut', 'neu', 'getragen', 'small', 'medium', 'large', 'xs', 's', 'm', 'l', 'xl',
  'a', 'an', 'the', 'and', 'or', 'in', 'on', 'of', 'for', 'with',
]);

function extractKeywords(title: string): string[] {
  return title
    .toLowerCase()
    .replace(/[^a-zäöüß0-9 ]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w))
    .slice(0, 5);
}

function overlapScore(a: string, b: string): number {
  const wa = new Set(extractKeywords(a));
  const wb = new Set(extractKeywords(b));
  if (wa.size === 0) return 0;
  let hits = 0;
  for (const w of wa) if (wb.has(w)) hits++;
  return hits / wa.size;
}

async function searchCj(keyword: string): Promise<CJProduct[]> {
  const u = `${CJ_SERVICE_URL}/api/products/search?keyword=${encodeURIComponent(keyword)}&limit=5`;
  const r = await fetch(u, { signal: AbortSignal.timeout(15_000) });
  if (!r.ok) throw new Error(`CJ-Service status ${r.status}`);
  const data = await r.json() as { ok: boolean; products?: CJProduct[]; error?: string };
  if (!data.ok || !data.products) throw new Error(data.error ?? 'no products');
  return data.products;
}

async function matchOne(folder_num: number, title: string): Promise<MatchResult['details'][number]> {
  try {
    const keywords = extractKeywords(title);
    if (keywords.length === 0) {
      return { folder_num, title, status: 'no_match', error: 'no usable keywords in title' };
    }
    const query = keywords.slice(0, 3).join(' ');
    const candidates = await searchCj(query);
    if (candidates.length === 0) {
      return { folder_num, title, status: 'no_match', error: 'CJ returned no products' };
    }
    // Score by title-overlap, take the best.
    let best: { p: CJProduct; score: number } | null = null;
    for (const p of candidates) {
      const s = overlapScore(title, p.productName ?? '');
      if (!best || s > best.score) best = { p, score: s };
    }
    if (!best || best.score < 0.5) {
      return { folder_num, title, status: 'no_match', error: `best score ${best?.score.toFixed(2) ?? '0'} < 0.5` };
    }
    const p = best.p;
    const variant = p.variants?.[0];
    if (!variant) {
      return { folder_num, title, status: 'no_match', error: 'matched product has no variants' };
    }
    const cost = Number(variant.variantSellPrice ?? p.sellPrice ?? 0);
    const db = getDb();
    db.prepare(`
      INSERT INTO cj_products (folder_num, cj_product_id, cj_variant_id, cj_product_url, cost_eur, shipping_eur, warehouse, created_at)
      VALUES (?, ?, ?, ?, ?, 0, 'CN', datetime('now'))
      ON CONFLICT(folder_num) DO UPDATE SET
        cj_product_id = excluded.cj_product_id,
        cj_variant_id = excluded.cj_variant_id,
        cj_product_url = excluded.cj_product_url,
        cost_eur = excluded.cost_eur
    `).run(
      folder_num,
      p.pid,
      variant.vid,
      `https://cjdropshipping.com/product/${p.pid}`,
      cost,
    );
    // Mirror onto auto_listings so the publisher has the variant directly.
    db.prepare(`UPDATE auto_listings SET cj_variant_id = ?, cj_cost_eur = ? WHERE folder_num = ?`)
      .run(variant.vid, cost, folder_num);
    return {
      folder_num,
      title,
      status: 'matched',
      cj_product_id: p.pid,
      cj_variant_id: variant.vid,
      cost_eur: cost,
    };
  } catch (e) {
    return { folder_num, title, status: 'error', error: e instanceof Error ? e.message : String(e) };
  }
}

export async function runOnce(opts: { limit?: number } = {}): Promise<MatchResult> {
  const limit = Math.max(1, Math.min(200, opts.limit ?? 50));
  const db = getDb();
  // Listings without a CJ-variant. Skip archived/sold rows.
  const rows = db.prepare(`
    SELECT al.folder_num, al.title
      FROM auto_listings al
     WHERE (al.cj_variant_id IS NULL OR al.cj_variant_id = '')
       AND al.status NOT IN ('archived', 'sold')
       AND NOT EXISTS (SELECT 1 FROM cj_products cp WHERE cp.folder_num = al.folder_num)
     ORDER BY al.created_at DESC
     LIMIT ?
  `).all(limit) as Array<{ folder_num: number; title: string }>;

  const result: MatchResult = { scanned: rows.length, matched: 0, failed: 0, details: [] };
  for (const row of rows) {
    const r = await matchOne(row.folder_num, row.title);
    result.details.push(r);
    if (r.status === 'matched') result.matched++;
    else result.failed++;
    // Light rate-limit to avoid CJ throttling.
    await new Promise((resolve) => setTimeout(resolve, 350));
  }

  log.info('cj auto-match cycle done', { scanned: result.scanned, matched: result.matched, failed: result.failed });
  if (result.failed > 0) {
    recordWorkerEvent('cj-auto-matcher', 'warn',
      `${result.failed}/${result.scanned} listings konnten nicht automatisch mit CJ verknüpft werden`,
      { scanned: result.scanned, matched: result.matched, failed: result.failed });
  }
  return result;
}

async function tick() {
  if (isPaused()) return;
  if (getSetting('cj_auto_match_enabled') !== 'true') return;
  await withLock('cj-auto-matcher', 600, async () => {
    await runOnce({ limit: 30 });
  });
}

export function startCjAutoMatcher() {
  if (timer) return;
  log.info(`cj-auto-matcher up; tick every ${POLL_MS / 60_000} min`);
  timer = setInterval(() => { void tick().catch((e) => log.error('tick error', { err: String(e) })); }, POLL_MS);
}

export function stopCjAutoMatcher() {
  if (timer) clearInterval(timer);
  timer = null;
}
