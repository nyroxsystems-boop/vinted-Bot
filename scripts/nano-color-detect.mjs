#!/usr/bin/env node
// Color Detection — extends nano-pre-process by detecting multiple color variants
// of the SAME garment within a product's source images, and producing one
// clean garment.png per detected color variant.
//
// Output structure:
//   <product>/_clean/garment.png                     # default (the largest variant)
//   <product>/_clean/variants.json                   # metadata: list of variants
//   <product>/_clean/garment__<slug>.png             # one per non-default variant (if >1 color)
//
// If only 1 color variant is detected, only garment.png is produced (no variants.json).
//
// Usage:
//   node nano-color-detect.mjs <product-folder> [--force]
//   node nano-color-detect.mjs --batch <category> [--force]

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENV_PATH = path.join(__dirname, '..', '.env');
const VINTED_ROOT = '/Users/home/Vinted/Vinted';

async function loadEnv() {
  const raw = await fs.readFile(ENV_PATH, 'utf8');
  for (const line of raw.split('\n')) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

async function fetchWithRetry(url, opts = {}, retries = 4) {
  let lastErr;
  for (let i = 0; i < retries; i++) {
    try { return await fetch(url, opts); }
    catch (err) {
      lastErr = err;
      const wait = 3000 * (i + 1);
      await new Promise(r => setTimeout(r, wait));
    }
  }
  throw lastErr;
}

async function listSourceImages(productFolder) {
  const files = await fs.readdir(productFolder);
  const candidates = files
    .filter(f => /^\d+_.*\.(jpe?g|png|webp)$/i.test(f))
    .sort((a, b) => {
      const na = parseInt(a.match(/^(\d+)/)[1], 10);
      const nb = parseInt(b.match(/^(\d+)/)[1], 10);
      return na - nb;
    })
    .map(f => path.join(productFolder, f));

  const valid = [];
  for (const p of candidates) {
    try {
      const st = await fs.stat(p);
      if (st.size > 1024) valid.push(p);
    } catch { /* skip */ }
  }
  return valid;
}

async function visionDetectColors(imagePaths, geminiKey) {
  const parts = [];
  for (let i = 0; i < imagePaths.length; i++) {
    const buf = await fs.readFile(imagePaths[i]);
    const mime = imagePaths[i].toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg';
    parts.push({ text: `Image ${i + 1}:` });
    parts.push({ inline_data: { mime_type: mime, data: buf.toString('base64') } });
  }
  parts.push({
    text: `These ${imagePaths.length} images all show the SAME garment design (same cut, same pattern type, same silhouette), possibly in different COLOR variants.

Identify the distinct color variants of the garment visible in the images. For each color variant, pick the single best front-view image that:
1. Shows the garment cleanly from the front
2. Has minimum visual clutter (face / limbs / background should not obscure the garment)
3. Has clear color and pattern visibility

Return STRICT JSON in this exact shape (no markdown, no explanation, no extra text):
{"variants": [{"color_name": "cream", "color_slug": "cream", "best_image_idx": 1}, {"color_name": "light blue", "color_slug": "lightblue", "best_image_idx": 6}]}

Rules:
- color_name is a short human label like "cream", "light blue", "navy floral", "dusty pink", "black"
- color_slug is the same but lowercase, only [a-z0-9_-], no spaces (use _ for spaces, e.g. "light_blue")
- best_image_idx is 1-indexed image number (1..${imagePaths.length})
- If all images show the same single color, return ONE variant
- If there are 2+ distinct colors of the same garment, return one entry per color
- DO NOT include color variants that aren't actually visible in the images
- DO NOT count pure flatlay vs on-body vs detail crops as different variants — only true color differences`
  });

  const res = await fetchWithRetry('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent', {
    method: 'POST',
    headers: { 'x-goog-api-key': geminiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts }],
      generationConfig: { temperature: 0, maxOutputTokens: 800, thinkingConfig: { thinkingBudget: 0 } },
    }),
  });
  if (!res.ok) throw new Error(`gemini ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? '';

  // Strip code fences if Gemini wraps the JSON
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  let parsed;
  try { parsed = JSON.parse(cleaned); }
  catch (err) { throw new Error(`Could not parse Gemini JSON: "${text.slice(0, 200)}"`); }

  const variants = parsed.variants;
  if (!Array.isArray(variants) || variants.length === 0) {
    throw new Error(`No variants in Gemini response: "${text.slice(0, 200)}"`);
  }

  // Validate + normalize
  for (const v of variants) {
    if (typeof v.best_image_idx !== 'number' || v.best_image_idx < 1 || v.best_image_idx > imagePaths.length) {
      throw new Error(`Invalid best_image_idx ${v.best_image_idx}`);
    }
    if (!v.color_slug) v.color_slug = (v.color_name || 'unknown').toLowerCase().replace(/[^a-z0-9_-]+/g, '_');
  }

  return variants.map(v => ({
    color_name: v.color_name,
    color_slug: v.color_slug,
    source_image: imagePaths[v.best_image_idx - 1],
  }));
}

async function uploadToFal(filePath, key) {
  const buf = await fs.readFile(filePath);
  const ext = path.extname(filePath).toLowerCase();
  const mime = ext === '.png' ? 'image/png' : 'image/jpeg';
  const filename = path.basename(filePath);
  const initiate = await fetchWithRetry('https://rest.alpha.fal.ai/storage/upload/initiate', {
    method: 'POST',
    headers: { Authorization: `Key ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ file_name: filename, content_type: mime }),
  });
  if (!initiate.ok) throw new Error(`fal initiate ${initiate.status}: ${await initiate.text()}`);
  const { upload_url, file_url } = await initiate.json();
  const put = await fetchWithRetry(upload_url, {
    method: 'PUT',
    headers: { 'Content-Type': mime },
    body: buf,
  });
  if (!put.ok) throw new Error(`fal upload ${put.status}`);
  return file_url;
}

async function removeBackground(filePath, key) {
  const fileUrl = await uploadToFal(filePath, key);
  const res = await fetchWithRetry('https://fal.run/fal-ai/birefnet', {
    method: 'POST',
    headers: { Authorization: `Key ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ image_url: fileUrl }),
  });
  if (!res.ok) throw new Error(`birefnet ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  const outUrl = data?.image?.url;
  if (!outUrl) throw new Error('No output image from birefnet');
  const dl = await fetchWithRetry(outUrl);
  if (!dl.ok) throw new Error(`download ${dl.status}`);
  return Buffer.from(await dl.arrayBuffer());
}

async function processOne(productFolder, { falKey, geminiKey, force }) {
  const tStart = Date.now();
  const cleanDir = path.join(productFolder, '_clean');
  const variantsFile = path.join(cleanDir, 'variants.json');
  const defaultClean = path.join(cleanDir, 'garment.png');

  if (!force) {
    const variantsExists = await fs.stat(variantsFile).catch(() => null);
    if (variantsExists) {
      const variants = JSON.parse(await fs.readFile(variantsFile, 'utf8'));
      return { ok: true, skipped: true, variants: variants.length, dt: 0 };
    }
    // No variants.json but garment.png exists → single-color from old pre-process. Keep it.
    const defaultExists = await fs.stat(defaultClean).catch(() => null);
    if (defaultExists) {
      // Verify by running detection now? No — skip unless force.
      return { ok: true, skipped: true, variants: 1, dt: 0 };
    }
  }

  await fs.mkdir(cleanDir, { recursive: true });

  const sources = await listSourceImages(productFolder);
  if (sources.length === 0) return { ok: false, error: 'no source images' };

  let detected;
  try { detected = await visionDetectColors(sources, geminiKey); }
  catch (err) {
    // Fallback: single variant from first image
    detected = [{ color_name: 'default', color_slug: 'default', source_image: sources[0] }];
  }

  // Process each variant
  const variantsMeta = [];
  for (let i = 0; i < detected.length; i++) {
    const v = detected[i];
    const isFirst = i === 0;
    const outName = isFirst ? 'garment.png' : `garment__${v.color_slug}.png`;
    const outPath = path.join(cleanDir, outName);
    try {
      const png = await removeBackground(v.source_image, falKey);
      await fs.writeFile(outPath, png);
      variantsMeta.push({
        color_name: v.color_name,
        color_slug: v.color_slug,
        clean_path: path.basename(outPath),
        source_image: path.basename(v.source_image),
      });
    } catch (err) {
      return { ok: false, error: `BG-removal failed for ${v.color_name}: ${err.message}` };
    }
  }

  await fs.writeFile(variantsFile, JSON.stringify(variantsMeta, null, 2));

  const dt = ((Date.now() - tStart) / 1000).toFixed(1);
  return { ok: true, variants: variantsMeta.length, dt, colors: variantsMeta.map(v => v.color_name).join(', ') };
}

async function listProductFolders(category) {
  const catDir = path.join(VINTED_ROOT, category);
  const products = [];
  const numDirs = await fs.readdir(catDir, { withFileTypes: true });
  for (const numDir of numDirs) {
    if (!numDir.isDirectory() || !/^\d+$/.test(numDir.name)) continue;
    const subs = await fs.readdir(path.join(catDir, numDir.name), { withFileTypes: true });
    for (const s of subs) {
      if (s.isDirectory() && s.name.startsWith('CJ')) {
        products.push(path.join(catDir, numDir.name, s.name));
      }
    }
  }
  return products;
}

async function main() {
  await loadEnv();
  const falKey = process.env.FAL_KEY;
  const geminiKey = process.env.GEMINI_API_KEY;
  if (!falKey) throw new Error('FAL_KEY missing');
  if (!geminiKey) throw new Error('GEMINI_API_KEY missing');

  const args = process.argv.slice(2);
  const force = args.includes('--force');
  const batchIdx = args.indexOf('--batch');

  if (batchIdx >= 0) {
    const category = args[batchIdx + 1];
    if (!category) throw new Error('--batch requires a category name');
    const products = await listProductFolders(category);
    console.log(`Color-detecting ${products.length} products in ${category}…\n`);
    let ok = 0, skipped = 0, failed = 0, totalVariants = 0;
    for (let i = 0; i < products.length; i++) {
      let r;
      try { r = await processOne(products[i], { falKey, geminiKey, force }); }
      catch (err) { r = { ok: false, error: err.message }; }
      const tag = `[${i + 1}/${products.length}]`;
      if (r.ok && r.skipped) {
        console.log(`${tag} ⏭  ${path.basename(products[i])}  (${r.variants}v)`);
        skipped++;
      } else if (r.ok) {
        console.log(`${tag} ✓ ${path.basename(products[i])}  ${r.variants}v  [${r.colors}]  (${r.dt}s)`);
        ok++;
        totalVariants += r.variants;
      } else {
        console.log(`${tag} ✗ ${path.basename(products[i])}  ${r.error}`);
        failed++;
      }
    }
    console.log(`\n=== DONE ===  ${ok} ok, ${skipped} skipped, ${failed} failed, ${totalVariants} total variants`);
    if (failed > 0) process.exit(2);
    return;
  }

  const productFolder = args.find(a => !a.startsWith('--'));
  if (!productFolder) {
    console.error('Usage: node nano-color-detect.mjs <product-folder> [--force]');
    console.error('   or: node nano-color-detect.mjs --batch <category> [--force]');
    process.exit(1);
  }

  console.log(`Color-detecting: ${path.basename(productFolder)}`);
  const r = await processOne(productFolder, { falKey, geminiKey, force });
  if (r.ok && r.skipped) console.log(`⏭  already done (${r.variants} variants)`);
  else if (r.ok) console.log(`✓ ${r.variants} variants [${r.colors}] (${r.dt}s)`);
  else { console.error(`✗ FAILED: ${r.error}`); process.exit(1); }
}

main().catch(err => { console.error('FATAL:', err.message); process.exit(1); });
