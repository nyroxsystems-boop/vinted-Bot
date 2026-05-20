#!/usr/bin/env node
// Batch-Runner: läuft fal-build-listing-photos.mjs auf alle CJ-Produkte
// einer Kategorie (oder aller Kategorien).
//
// - skippt Produkte, die schon listing_v6_*.jpg in generated/ haben (resume-fähig)
// - läuft K Produkte parallel (default 2 — innerhalb von 6 parallel = 12 concurrent fal calls)
//
// Usage:
//   node fal-batch-listings.mjs Kleider              # nur Kleider
//   node fal-batch-listings.mjs Kleider Skirts       # mehrere Kategorien
//   node fal-batch-listings.mjs all                  # alle (außer Handbags + Links)
//   node fal-batch-listings.mjs Kleider --concurrency=3

import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VINTED_ROOT = '/Users/home/Vinted/Vinted';
const SUB_SCRIPT = path.join(__dirname, 'fal-build-listing-photos.mjs');

const SKIP = new Set(['Handbags', 'Links']); // Handbags brauchen kein Body-Modell, Links ist leer

async function listProducts(category) {
  const catDir = path.join(VINTED_ROOT, category);
  if (!await fs.stat(catDir).catch(() => null)) return [];
  const numbered = (await fs.readdir(catDir)).filter(d => /^\d+$/.test(d));
  const products = [];
  for (const n of numbered) {
    const numDir = path.join(catDir, n);
    const subs = await fs.readdir(numDir).catch(() => []);
    const cjs = subs.filter(s => s.startsWith('CJ'));
    for (const cj of cjs) {
      products.push(path.join(numDir, cj));
    }
  }
  return products;
}

async function alreadyDone(productPath) {
  const gen = path.join(productPath, 'generated');
  if (!await fs.stat(gen).catch(() => null)) return false;
  const files = await fs.readdir(gen);
  return files.some(f => f.startsWith('listing_v6_'));
}

function runOnProduct(productPath) {
  return new Promise((resolve) => {
    const tStart = Date.now();
    const child = spawn('node', [SUB_SCRIPT, productPath], { stdio: ['ignore', 'pipe', 'pipe'] });
    let buf = '';
    child.stdout.on('data', d => { buf += d.toString(); });
    child.stderr.on('data', d => { buf += d.toString(); });
    child.on('close', code => {
      const dt = ((Date.now() - tStart) / 1000).toFixed(1);
      if (code === 0) {
        console.log(`  ✓ ${path.basename(productPath)}  (${dt}s)`);
      } else {
        console.log(`  ✗ ${path.basename(productPath)}  (exit ${code}, ${dt}s)`);
        const lastLines = buf.trim().split('\n').slice(-5).join('\n    ');
        console.log(`    ${lastLines}`);
      }
      resolve(code === 0);
    });
  });
}

async function processQueue(products, concurrency) {
  const queue = [...products];
  let done = 0, ok = 0, fail = 0;
  const total = queue.length;

  async function worker(workerId) {
    while (queue.length > 0) {
      const p = queue.shift();
      if (!p) return;
      done++;
      console.log(`[${done}/${total}] (worker ${workerId}) ${path.basename(path.dirname(p))}/${path.basename(p)}`);
      const success = await runOnProduct(p);
      if (success) ok++; else fail++;
    }
  }

  const workers = [];
  for (let i = 0; i < concurrency; i++) workers.push(worker(i + 1));
  await Promise.all(workers);
  return { ok, fail, total };
}

async function main() {
  const args = process.argv.slice(2);
  let concurrency = 2;
  const categories = [];
  for (const a of args) {
    if (a.startsWith('--concurrency=')) concurrency = parseInt(a.split('=')[1], 10);
    else categories.push(a);
  }
  if (categories.length === 0) {
    console.error('Usage: node fal-batch-listings.mjs <category> [<category2> ...] | all');
    process.exit(1);
  }

  let cats;
  if (categories.includes('all')) {
    cats = (await fs.readdir(VINTED_ROOT)).filter(d => !SKIP.has(d));
    const stats = await Promise.all(cats.map(async c => {
      const s = await fs.stat(path.join(VINTED_ROOT, c)).catch(() => null);
      return s?.isDirectory() ? c : null;
    }));
    cats = stats.filter(Boolean);
  } else {
    cats = categories;
  }

  console.log(`Categories: ${cats.join(', ')}`);
  console.log(`Concurrency: ${concurrency} products in parallel\n`);

  const allProducts = [];
  for (const c of cats) {
    const ps = await listProducts(c);
    allProducts.push(...ps);
  }
  console.log(`Found ${allProducts.length} products total`);

  const todo = [];
  let skipped = 0;
  for (const p of allProducts) {
    if (await alreadyDone(p)) { skipped++; continue; }
    todo.push(p);
  }
  console.log(`Skipping ${skipped} already-done products. To process: ${todo.length}\n`);
  if (todo.length === 0) { console.log('Nothing to do.'); return; }

  const t0 = Date.now();
  const { ok, fail, total } = await processQueue(todo, concurrency);
  const dt = ((Date.now() - t0) / 1000 / 60).toFixed(1);
  console.log(`\n=== BATCH DONE in ${dt} min ===`);
  console.log(`  ${ok}/${total} ok, ${fail} failed`);
  if (fail > 0) process.exit(2);
}

main().catch(err => { console.error('FATAL:', err.message); process.exit(1); });
