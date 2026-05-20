#!/usr/bin/env node
// Batch-Runner — Phase 3 der neuen Vinted-Pipeline.
//
// Loopt durch alle CJ-Produkte einer/mehrerer Kategorien:
// 1. Pre-Process (Stufe 0): nano-pre-process pro Produkt
// 2. Build-Listing (Stufe 2-4): nano-build-listing pro Produkt
//
// Resume per-Shot: skippt Shots wo Output schon existiert.
// Cost-Cap: Hard-Stop bei $80, Warning bei $50.
// Concurrency: 2-3 Produkte parallel.
//
// Usage:
//   node nano-batch.mjs Kleider
//   node nano-batch.mjs Kleider Skirts Jeans
//   node nano-batch.mjs all                       # alle außer Handbags
//   node nano-batch.mjs Kleider --concurrency=3
//   node nano-batch.mjs Kleider --max-cost=30
//   node nano-batch.mjs Kleider --dry-run         # nur listen, nicht generieren

import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VINTED_ROOT = '/Users/home/Vinted/Vinted';
const PRE_PROCESS = path.join(__dirname, 'nano-pre-process.mjs');
const BUILD_LISTING = path.join(__dirname, 'nano-build-listing.mjs');

const SKIP_CATEGORIES = new Set(['Handbags', 'Links']);

// Cost estimates per call ($)
const COST = {
  vision_pick: 0.001,
  birefnet: 0.003,
  seedream_edit: 0.03,
  vision_validate: 0.001,
};

// Approx cost per product:
// pre-process: 1 vision-pick + 1 birefnet = $0.004
// listing:     5 shots × 2 variants × seedream + 5 shots × 2 vision = 10×$0.03 + 10×$0.001 = $0.31
// Total per product: ~$0.31
const APPROX_COST_PER_PRODUCT = 0.32;

async function listProductFolders(category) {
  const catDir = path.join(VINTED_ROOT, category);
  if (!await fs.stat(catDir).catch(() => null)) return [];
  const numDirs = (await fs.readdir(catDir)).filter(d => /^\d+$/.test(d));
  numDirs.sort((a, b) => parseInt(a) - parseInt(b));
  const products = [];
  for (const n of numDirs) {
    const numPath = path.join(catDir, n);
    const subs = await fs.readdir(numPath).catch(() => []);
    for (const s of subs) {
      if (s.startsWith('CJ')) products.push(path.join(numPath, s));
    }
  }
  return products;
}

async function alreadyDone(productFolder) {
  const gen = path.join(productFolder, 'generated');
  const required = ['1_front.jpg', '2_side.jpg', '3_zoom.jpg', '4_flatlay.jpg'];
  for (const f of required) {
    if (!await fs.stat(path.join(gen, f)).catch(() => null)) return false;
  }
  return true;
}

function runScript(scriptPath, args) {
  return new Promise((resolve) => {
    const tStart = Date.now();
    const child = spawn('node', [scriptPath, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', d => { stdout += d.toString(); });
    child.stderr.on('data', d => { stderr += d.toString(); });
    child.on('close', code => {
      resolve({
        ok: code === 0,
        code,
        stdout,
        stderr,
        dt: ((Date.now() - tStart) / 1000).toFixed(1),
      });
    });
  });
}

async function processProduct(productFolder, { dryRun }) {
  const name = `${path.basename(path.dirname(productFolder))}/${path.basename(productFolder)}`;

  if (await alreadyDone(productFolder)) {
    return { ok: true, skipped: true, name };
  }

  if (dryRun) {
    return { ok: true, dryRun: true, name };
  }

  // Stufe 0: Pre-Process
  const pre = await runScript(PRE_PROCESS, [productFolder]);
  if (!pre.ok) {
    return { ok: false, name, stage: 'pre-process', error: pre.stderr || pre.stdout, dt: pre.dt };
  }

  // Stufe 2-4: Build-Listing
  const build = await runScript(BUILD_LISTING, [productFolder]);
  if (!build.ok) {
    return { ok: false, name, stage: 'build-listing', error: build.stderr || build.stdout, dt: build.dt };
  }

  // Parse quality score from build stdout
  const scoreMatch = build.stdout.match(/Avg quality score: (\d+)\/100/);
  const score = scoreMatch ? parseInt(scoreMatch[1], 10) : null;

  return { ok: true, name, dt: build.dt, score };
}

async function processQueue(products, concurrency, opts) {
  const queue = [...products];
  const results = [];
  const total = products.length;
  let done = 0, ok = 0, skipped = 0, failed = 0;
  let estimatedCost = 0;

  async function worker(workerId) {
    while (queue.length > 0) {
      const p = queue.shift();
      if (!p) break;
      done++;
      const idx = `[${done}/${total}]`;

      // Cost-cap check
      if (estimatedCost >= opts.maxCost) {
        console.log(`${idx} 🛑 COST-CAP HIT ($${estimatedCost.toFixed(2)} >= $${opts.maxCost}). Stopping worker ${workerId}.`);
        return;
      }

      const r = await processProduct(p, opts);
      results.push(r);

      if (r.skipped) {
        console.log(`${idx} ⏭  ${r.name} (already done)`);
        skipped++;
      } else if (r.dryRun) {
        console.log(`${idx} 🔍 ${r.name} (would process)`);
      } else if (r.ok) {
        const scoreStr = r.score != null ? `  score=${r.score}` : '';
        console.log(`${idx} ✓ ${r.name}  (${r.dt}s)${scoreStr}`);
        ok++;
        estimatedCost += APPROX_COST_PER_PRODUCT;
      } else {
        console.log(`${idx} ✗ ${r.name}  [${r.stage}]`);
        const lastLines = (r.error || '').trim().split('\n').slice(-3).join('\n    ');
        if (lastLines) console.log(`    ${lastLines}`);
        failed++;
      }

      if (estimatedCost >= opts.warnCost && !opts.warned) {
        console.log(`\n⚠️  Cost warning: $${estimatedCost.toFixed(2)} estimated. Hard cap at $${opts.maxCost}.\n`);
        opts.warned = true;
      }
    }
  }

  const workers = [];
  for (let i = 0; i < concurrency; i++) workers.push(worker(i + 1));
  await Promise.all(workers);

  return { ok, skipped, failed, total, estimatedCost, results };
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  let concurrency = 2;
  let maxCost = 80;
  const warnCost = 50;
  const categories = [];

  for (const a of args) {
    if (a === '--dry-run') continue;
    if (a.startsWith('--concurrency=')) concurrency = parseInt(a.split('=')[1], 10);
    else if (a.startsWith('--max-cost=')) maxCost = parseFloat(a.split('=')[1]);
    else categories.push(a);
  }

  if (categories.length === 0) {
    console.error('Usage: node nano-batch.mjs <category>... [--concurrency=N] [--max-cost=$] [--dry-run]');
    console.error('       node nano-batch.mjs all');
    process.exit(1);
  }

  // Resolve "all" → all categories except SKIP
  let cats;
  if (categories.includes('all')) {
    const all = (await fs.readdir(VINTED_ROOT).catch(() => []))
      .filter(d => !SKIP_CATEGORIES.has(d));
    const stats = await Promise.all(all.map(async c => {
      const s = await fs.stat(path.join(VINTED_ROOT, c)).catch(() => null);
      return s?.isDirectory() ? c : null;
    }));
    cats = stats.filter(Boolean);
  } else {
    cats = categories.filter(c => !SKIP_CATEGORIES.has(c));
  }

  console.log(`Batch Runner`);
  console.log(`  Categories:  ${cats.join(', ')}`);
  console.log(`  Concurrency: ${concurrency} products parallel`);
  console.log(`  Cost cap:    $${maxCost} (warn at $${warnCost})`);
  console.log(`  Dry run:     ${dryRun ? 'YES' : 'no'}`);
  console.log();

  // Collect all products
  const allProducts = [];
  for (const c of cats) {
    const ps = await listProductFolders(c);
    allProducts.push(...ps);
    console.log(`  ${c}: ${ps.length} products`);
  }
  console.log(`  TOTAL: ${allProducts.length} products\n`);

  // Filter already-done
  const todo = [];
  let alreadyDoneCount = 0;
  for (const p of allProducts) {
    if (await alreadyDone(p)) alreadyDoneCount++;
    else todo.push(p);
  }
  console.log(`  Already done: ${alreadyDoneCount}`);
  console.log(`  To process:   ${todo.length}`);
  console.log(`  Estimated cost: ~$${(todo.length * APPROX_COST_PER_PRODUCT).toFixed(2)}\n`);

  if (todo.length === 0) {
    console.log('Nothing to do.');
    return;
  }

  if (dryRun) {
    for (const p of todo.slice(0, 20)) {
      console.log(`  → would process: ${path.basename(path.dirname(p))}/${path.basename(p)}`);
    }
    if (todo.length > 20) console.log(`  ... and ${todo.length - 20} more`);
    return;
  }

  const t0 = Date.now();
  const opts = { dryRun, maxCost, warnCost, warned: false };
  const stats = await processQueue(todo, concurrency, opts);
  const dt = ((Date.now() - t0) / 1000 / 60).toFixed(1);

  console.log(`\n${'='.repeat(60)}`);
  console.log(`BATCH DONE in ${dt} min`);
  console.log(`  ✓ Successful:  ${stats.ok}`);
  console.log(`  ⏭ Skipped:     ${stats.skipped}`);
  console.log(`  ✗ Failed:      ${stats.failed}`);
  console.log(`  Total products: ${stats.total}`);
  console.log(`  Estimated cost: ~$${stats.estimatedCost.toFixed(2)}`);

  // Avg score across successful
  const scored = stats.results.filter(r => r.ok && r.score != null);
  if (scored.length > 0) {
    const avg = scored.reduce((s, r) => s + r.score, 0) / scored.length;
    console.log(`  Avg quality:    ${avg.toFixed(0)}/100  (${scored.length} scored)`);
  }

  if (stats.failed > 0) {
    console.log(`\nFailed products:`);
    for (const r of stats.results.filter(r => !r.ok)) {
      console.log(`  - ${r.name} [${r.stage}]`);
    }
    process.exit(2);
  }
}

main().catch(err => { console.error('FATAL:', err.message); process.exit(1); });
