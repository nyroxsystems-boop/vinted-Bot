#!/usr/bin/env node
// Builds /tmp/master_listings.json — a flat ordered list of every listing
// to be generated, one entry per (product, variant) tuple. Sorted by
// category, then by numeric folder index. Skips products without _clean/.
//
// Output format:
//   [
//     { "product_folder": "/Users/.../Kleider/1/CJ...", "color_slug": "cream", "color_name": "cream", "garment": "garment.png", "out_dir": "/Users/.../Kleider/1/CJ.../generated/cream" },
//     ...
//   ]

import fs from 'node:fs/promises';
import path from 'node:path';

const VINTED_ROOT = '/Users/home/Vinted/Vinted';
const CATEGORIES = ['Kleider', 'Blazers', 'Hotpants Shorts', 'Jackets', 'Jeans', 'Jumpsuits', 'Skirts'];
const OUT_FILE = '/tmp/master_listings.json';

async function listProductsForCategory(cat) {
  const catDir = path.join(VINTED_ROOT, cat);
  if (!await fs.stat(catDir).catch(() => null)) return [];
  const numDirs = (await fs.readdir(catDir))
    .filter(d => /^\d+$/.test(d))
    .sort((a, b) => parseInt(a, 10) - parseInt(b, 10));
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

async function loadVariants(productFolder) {
  const cleanDir = path.join(productFolder, '_clean');
  const variantsFile = path.join(cleanDir, 'variants.json');
  try {
    const raw = await fs.readFile(variantsFile, 'utf8');
    const variants = JSON.parse(raw);
    if (Array.isArray(variants) && variants.length > 0) return variants;
  } catch { /* no variants.json */ }
  // Fallback: single garment.png?
  const defaultPath = path.join(cleanDir, 'garment.png');
  if (await fs.stat(defaultPath).catch(() => null)) {
    return [{ color_name: 'default', color_slug: 'default', clean_path: 'garment.png' }];
  }
  return null;
}

async function main() {
  const master = [];
  for (const cat of CATEGORIES) {
    const products = await listProductsForCategory(cat);
    for (const p of products) {
      const variants = await loadVariants(p);
      if (!variants) continue;
      const isMulti = variants.length > 1;
      for (const v of variants) {
        const outDir = isMulti
          ? path.join(p, 'generated', v.color_slug)
          : path.join(p, 'generated');
        master.push({
          category: cat,
          product_folder: p,
          product_id: path.basename(p),
          color_slug: v.color_slug,
          color_name: v.color_name,
          is_multi: isMulti,
          garment: v.clean_path,
          out_dir: outDir,
        });
      }
    }
  }
  await fs.writeFile(OUT_FILE, JSON.stringify(master, null, 2));
  console.log(`Master list: ${master.length} listings → ${OUT_FILE}`);
  // Summary per category
  const byCategory = {};
  for (const item of master) byCategory[item.category] = (byCategory[item.category] || 0) + 1;
  for (const [cat, n] of Object.entries(byCategory)) {
    console.log(`  ${cat}: ${n}`);
  }
}

main().catch(err => { console.error('FATAL:', err.message); process.exit(1); });
