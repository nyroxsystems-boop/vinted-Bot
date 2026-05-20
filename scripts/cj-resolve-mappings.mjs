#!/usr/bin/env node
// ──────────────────────────────────────────────────────────────────────────────
// CJ-Resolver: liest auto_listings, ruft CJ-API pro pid, matcht die richtige
// Variante (Size + Color), schreibt cj_products + füllt temu_price_eur in
// auto_listings.
//
// Args:
//   --limit=N         : nur die ersten N Listings (für Tests)
//   --folder=N        : nur ein konkretes folder_num
//   --dry             : keine DB-Writes
//   --rate=N          : ms zwischen Calls (default 1500 — CJ QPS-Limit ist 1/s)
//
// Usage:
//   node scripts/cj-resolve-mappings.mjs --limit=3
//   node scripts/cj-resolve-mappings.mjs                 # alle
// ──────────────────────────────────────────────────────────────────────────────

import Database from 'better-sqlite3';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.resolve(__dirname, '../orchestrator/data/vinted-system.db');
const CJ_URL = process.env.CJ_SERVICE_URL ?? 'http://localhost:4720';
const USD_PER_EUR = Number(process.env.EUR_USD_RATE ?? 1.07); // 1 EUR = 1.07 USD

// ── Color priority (best-effort default when listing has no color) ────────────
// English CJ variantKey colors → priority (lower = preferred)
const COLOR_PREF = [
  'black', 'noir',
  'white', 'ivory', 'cream', 'beige',
  'gray', 'grey',
  'navy', 'dark blue', 'blue',
  'brown', 'khaki', 'apricot', 'pink', 'red',
  'picture color', 'as picture', 'as shown',
];

// Size order (lower index = smaller)
const SIZE_ORDER = ['XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL', '4XL'];

// ── Args ─────────────────────────────────────────────────────────────────────
const args = Object.fromEntries(
  process.argv.slice(2).map(a => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? true];
  }),
);
const LIMIT = args.limit ? Number(args.limit) : null;
const FOLDER = args.folder ? Number(args.folder) : null;
const DRY = !!args.dry;
const RATE_MS = args.rate ? Number(args.rate) : 1500;

// ── Helpers ──────────────────────────────────────────────────────────────────
const sleep = ms => new Promise(r => setTimeout(r, ms));

function extractPid(url) {
  if (!url) return null;
  const m = url.match(/-p-(\d+)\.html/i);
  return m ? m[1] : null;
}

function parseVariantKey(key, productKeyEn) {
  // productKeyEn examples: "Color-Size", "Color", "Size"
  const schema = (productKeyEn ?? '').toLowerCase();
  const parts = (key ?? '').split('-').map(s => s.trim());

  if (schema === 'color-size') {
    return { color: parts.slice(0, parts.length - 1).join('-'), size: parts[parts.length - 1] };
  }
  if (schema === 'size-color') {
    return { color: parts.slice(1).join('-'), size: parts[0] };
  }
  if (schema === 'color') return { color: key, size: null };
  if (schema === 'size')  return { color: null, size: key };
  // Unknown schema — heuristic: last part looks like a size?
  const last = parts[parts.length - 1]?.toUpperCase();
  if (SIZE_ORDER.includes(last)) {
    return { color: parts.slice(0, -1).join('-'), size: last };
  }
  return { color: key, size: null };
}

function scoreColor(color, prefList = COLOR_PREF) {
  if (!color) return 999;
  const c = color.toLowerCase().trim();
  for (let i = 0; i < prefList.length; i++) {
    if (c.includes(prefList[i])) return i;
  }
  return 100; // unrecognized but still valid
}

function scoreSize(have, want) {
  if (!have && !want) return 0;
  if (!want) return 50;
  const H = have.toUpperCase().trim();
  const W = want.toUpperCase().trim();
  if (H === W) return 0;
  const hi = SIZE_ORDER.indexOf(H);
  const wi = SIZE_ORDER.indexOf(W);
  if (hi >= 0 && wi >= 0) {
    // Prefer slightly larger over smaller (customers complain less about loose vs tight)
    const diff = hi - wi;
    return diff > 0 ? diff * 10 : Math.abs(diff) * 15;
  }
  return 80;
}

/** Pick the best variant. Returns { variant, parsed, reason } or null. */
function pickVariant(product, want) {
  const variants = product.variants ?? [];
  if (variants.length === 0) return null;
  const wantSize = (want.size ?? '').trim();
  const wantColor = (want.color ?? '').trim();

  const scored = variants
    .filter(v => v.vid && v.variantKey != null)
    .map(v => {
      const parsed = parseVariantKey(v.variantKey, product.productKeyEn);
      const sScore = scoreSize(parsed.size ?? '', wantSize);
      const cScore = wantColor
        ? (parsed.color?.toLowerCase().includes(wantColor.toLowerCase()) ? 0 : 50)
        : scoreColor(parsed.color);
      return { v, parsed, score: sScore * 2 + cScore };
    })
    .sort((a, b) => a.score - b.score);

  if (scored.length === 0) return null;
  const best = scored[0];
  const sizeMatches = !wantSize
    || !best.parsed.size
    || best.parsed.size.toUpperCase() === wantSize.toUpperCase();
  let reason = 'best-score';
  if (best.score === 0) reason = 'perfect-match';
  else if (sizeMatches) reason = 'size-match';
  else reason = 'size-mismatch';
  return { variant: best.v, parsed: best.parsed, reason, score: best.score };
}

// ── CJ API caller ────────────────────────────────────────────────────────────
async function getProduct(pid) {
  const r = await fetch(`${CJ_URL}/api/products/${pid}`, { signal: AbortSignal.timeout(30_000) });
  const j = await r.json();
  if (!j.ok) throw new Error(j.error ?? 'unknown CJ error');
  return j.product;
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`▶ CJ-Resolver  (db=${DB_PATH}  cj=${CJ_URL}  dry=${DRY}  rate=${RATE_MS}ms)`);

  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');

  let query = `SELECT id, folder_num, title, size, color, price_eur, temu_url
               FROM auto_listings WHERE temu_url IS NOT NULL AND temu_url != ''`;
  const params = [];
  if (FOLDER != null) { query += ' AND folder_num = ?'; params.push(FOLDER); }
  query += ' ORDER BY id';
  if (LIMIT) { query += ' LIMIT ?'; params.push(LIMIT); }

  const listings = db.prepare(query).all(...params);
  console.log(`  Found ${listings.length} listings to resolve\n`);

  // Pre-check: which folders already have a mapping?
  const existing = new Set(
    db.prepare('SELECT folder_num FROM cj_products').all().map(r => r.folder_num),
  );

  const upsert = db.prepare(`
    INSERT INTO cj_products (folder_num, cj_product_id, cj_variant_id, cj_product_url, cost_eur, shipping_eur, warehouse)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(folder_num, cj_variant_id) DO UPDATE SET
      cj_product_id = excluded.cj_product_id,
      cj_product_url = excluded.cj_product_url,
      cost_eur = excluded.cost_eur,
      shipping_eur = excluded.shipping_eur,
      warehouse = excluded.warehouse
  `);

  const updateListing = db.prepare(`
    UPDATE auto_listings
       SET temu_price_eur = ?, profit_margin_eur = ?,
           cj_product_id = ?, cj_variant_id = ?,
           size = ?, color = ?,
           updated_at = datetime('now')
     WHERE id = ?
  `);

  const stats = { ok: 0, exact: 0, fuzzy: 0, no_pid: 0, api_err: 0, no_variant: 0, skipped: 0 };
  const issues = [];

  for (const [i, lst] of listings.entries()) {
    const tag = `[${i + 1}/${listings.length}] folder #${lst.folder_num}`;
    const pid = extractPid(lst.temu_url);
    if (!pid) {
      console.log(`${tag} ⚠️  no pid in URL: ${lst.temu_url}`);
      stats.no_pid++;
      issues.push({ folder: lst.folder_num, problem: 'no_pid', url: lst.temu_url });
      continue;
    }

    try {
      const product = await getProduct(pid);
      const want = { size: lst.size || 'S', color: lst.color || '' };
      const picked = pickVariant(product, want);

      if (!picked) {
        console.log(`${tag} ❌ no variants in product ${pid}`);
        stats.no_variant++;
        issues.push({ folder: lst.folder_num, problem: 'no_variant', pid });
        await sleep(RATE_MS);
        continue;
      }

      const v = picked.variant;
      const costUsd = Number(v.variantSellPrice ?? 0);
      const costEur = +(costUsd / USD_PER_EUR).toFixed(2);
      // Shipping estimate: CN→DE air mail, 200-500g typical for women's clothing
      // ~3€ for 200g, 4€ for 500g — pauschal 3.5€
      const shippingEur = 3.5;
      const totalCost = +(costEur + shippingEur).toFixed(2);
      const margin = +(lst.price_eur - totalCost).toFixed(2);

      const icon = picked.reason === 'perfect-match' ? '✅'
                 : picked.reason === 'size-match'    ? '🟢'
                 : '⚠️ ';
      console.log(
        `${tag} ${icon} ${picked.reason}  pid=${pid} vid=${v.vid} key="${v.variantKey}" ` +
        `cost=$${costUsd}=€${costEur} margin=€${margin}`,
      );

      if (picked.reason === 'perfect-match') stats.exact++;
      else if (picked.reason === 'size-match') stats.sizeOk = (stats.sizeOk ?? 0) + 1;
      else stats.fuzzy++;

      if (picked.parsed.size && picked.parsed.size.toUpperCase() !== want.size.toUpperCase()) {
        issues.push({
          folder: lst.folder_num,
          problem: 'size-mismatch',
          want: want.size, got: picked.parsed.size,
          available: product.variants.map(x => x.variantKey),
        });
      }

      if (!DRY) {
        upsert.run(
          lst.folder_num,
          pid,
          v.vid,
          lst.temu_url,
          costEur,
          shippingEur,
          'CN',
        );
        const actualSize = picked.parsed.size ?? lst.size;
        const actualColor = picked.parsed.color ?? '';
        updateListing.run(totalCost, margin, pid, v.vid, actualSize, actualColor, lst.id);
      }

      stats.ok++;
    } catch (err) {
      const msg = err.message ?? String(err);
      console.log(`${tag} 💥 ${pid}: ${msg}`);
      stats.api_err++;
      issues.push({ folder: lst.folder_num, problem: 'api_error', pid, error: msg });
    }

    if (i < listings.length - 1) await sleep(RATE_MS);
  }

  console.log('\n──────────────────────────────────────────────────────');
  console.log('SUMMARY:');
  console.log(`  ✅ perfect-match    : ${stats.exact}`);
  console.log(`  🟢 size-match (def color) : ${stats.sizeOk ?? 0}`);
  console.log(`  ⚠️  size-mismatch    : ${stats.fuzzy}`);
  console.log(`  💥 API errors       : ${stats.api_err}`);
  console.log(`  ❌ no variant       : ${stats.no_variant}`);
  console.log(`  ⚠️  no pid          : ${stats.no_pid}`);
  console.log(`  total processed    : ${stats.ok + stats.api_err + stats.no_variant + stats.no_pid}`);
  console.log(`  DB writes          : ${DRY ? 'DRY-RUN, no writes' : stats.ok}`);

  if (issues.length) {
    const issuePath = path.resolve(__dirname, '../_logs/cj-resolver-issues.json');
    const fs = await import('node:fs');
    fs.mkdirSync(path.dirname(issuePath), { recursive: true });
    fs.writeFileSync(issuePath, JSON.stringify(issues, null, 2));
    console.log(`\n  issues logged to: ${issuePath}`);
  }

  db.close();
}

main().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
