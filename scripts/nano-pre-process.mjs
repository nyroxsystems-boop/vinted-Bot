#!/usr/bin/env node
// Pre-Process — Stufe 0 der Inpainting-Pipeline.
//
// Pro CJ-Produkt:
// 1. Lädt alle CJ-Source-Bilder
// 2. Gemini Vision pickt das beste Front-View-Bild des Garments
// 3. fal.ai BiRefNet entfernt Background → transparentes PNG
// 4. Speichert als <product>/_clean/garment.png
//
// Usage:
//   node nano-pre-process.mjs <product-folder>
//   node nano-pre-process.mjs --batch <category>     # alle Produkte einer Kategorie

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
      console.log(`  retry ${i + 1}/${retries} after ${wait}ms`);
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

  // Filter out empty / corrupt source files — fal.ai rejects 0-byte uploads.
  const valid = [];
  for (const p of candidates) {
    try {
      const st = await fs.stat(p);
      if (st.size > 1024) valid.push(p); // require > 1KB
    } catch { /* skip unreadable */ }
  }
  return valid;
}

async function visionPickBest(imagePaths, geminiKey) {
  // Gemini multi-image: send all candidates + ask which is best frontal-view
  const parts = [];
  for (let i = 0; i < imagePaths.length; i++) {
    const buf = await fs.readFile(imagePaths[i]);
    const mime = imagePaths[i].toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg';
    parts.push({ text: `Image ${i + 1}:` });
    parts.push({ inline_data: { mime_type: mime, data: buf.toString('base64') } });
  }
  parts.push({
    text: `Of these ${imagePaths.length} images, which one shows the FULL GARMENT most clearly from the FRONT?

Pick by these criteria (in order):
1. Front view of the entire garment (NOT a back view, NOT a detail close-up of just one part)
2. Garment laid flat or worn, fully visible from neckline to hem
3. Minimum visual clutter (model's face/limbs/background should not obscure the garment)
4. Clear color and pattern visibility

Respond with ONLY the image number (e.g. "1" or "3" or "5"). No explanation, no extra text.`
  });

  const res = await fetchWithRetry('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent', {
    method: 'POST',
    headers: { 'x-goog-api-key': geminiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts }],
      generationConfig: { temperature: 0, maxOutputTokens: 50, thinkingConfig: { thinkingBudget: 0 } },
    }),
  });
  if (!res.ok) throw new Error(`gemini ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
  const match = text?.match(/(\d+)/);
  if (!match) throw new Error(`Could not parse Gemini response: "${text}"`);
  const idx = parseInt(match[1], 10) - 1;
  if (idx < 0 || idx >= imagePaths.length) throw new Error(`Invalid index ${idx + 1}, max ${imagePaths.length}`);
  return imagePaths[idx];
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
    method: 'PUT', headers: { 'Content-Type': mime }, body: buf,
  });
  if (!put.ok) throw new Error(`fal upload ${put.status}: ${await put.text()}`);
  return file_url;
}

async function birefnetRemoveBg(imageUrl, falKey) {
  const res = await fetchWithRetry('https://fal.run/fal-ai/birefnet', {
    method: 'POST',
    headers: { Authorization: `Key ${falKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      image_url: imageUrl,
      operating_resolution: '1024x1024',
      output_format: 'png',
      refine_foreground: true,
    }),
  });
  if (!res.ok) throw new Error(`birefnet ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const url = data?.image?.url;
  if (!url) throw new Error(`No image: ${JSON.stringify(data).slice(0, 400)}`);
  return url;
}

async function downloadTo(url, outPath) {
  const res = await fetchWithRetry(url);
  if (!res.ok) throw new Error(`download ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await fs.writeFile(outPath, buf);
}

async function processOne(productFolder, { falKey, geminiKey, force = false }) {
  const cleanDir = path.join(productFolder, '_clean');
  const outPath = path.join(cleanDir, 'garment.png');

  if (!force && await fs.stat(outPath).catch(() => null)) {
    return { ok: true, skipped: true, path: outPath };
  }

  const images = await listSourceImages(productFolder);
  if (images.length === 0) {
    return { ok: false, error: 'no source images' };
  }

  // Vision-Pick (fallback to first image if Gemini key missing)
  const tStart = Date.now();
  let best;
  if (images.length === 1) {
    best = images[0];
  } else if (geminiKey) {
    try {
      best = await visionPickBest(images, geminiKey);
    } catch (err) {
      console.log(`  ⚠ Vision-Pick failed (${err.message.slice(0, 60)}), falling back to first image`);
      best = images[0];
    }
  } else {
    best = images[0]; // Fallback when Gemini key not available
  }
  const pickName = path.basename(best);

  // Upload + Background-Removal
  const falUrl = await uploadToFal(best, falKey);
  const cleanUrl = await birefnetRemoveBg(falUrl, falKey);

  // Download to _clean/
  await fs.mkdir(cleanDir, { recursive: true });
  await downloadTo(cleanUrl, outPath);

  const dt = ((Date.now() - tStart) / 1000).toFixed(1);
  return { ok: true, path: outPath, picked: pickName, dt };
}

async function listProductFolders(category) {
  const catDir = path.join(VINTED_ROOT, category);
  if (!await fs.stat(catDir).catch(() => null)) {
    throw new Error(`Category not found: ${catDir}`);
  }
  const numDirs = (await fs.readdir(catDir)).filter(d => /^\d+$/.test(d));
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

async function main() {
  await loadEnv();
  const falKey = process.env.FAL_KEY;
  const geminiKey = process.env.GEMINI_API_KEY;
  if (!falKey) throw new Error('FAL_KEY missing');
  if (!geminiKey) console.log('⚠ GEMINI_API_KEY not set — using first CJ image as garment ref (no Vision-Pick).');

  const args = process.argv.slice(2);
  const force = args.includes('--force');
  const batchIdx = args.indexOf('--batch');

  if (batchIdx >= 0) {
    const category = args[batchIdx + 1];
    if (!category) throw new Error('--batch requires a category name');
    const products = await listProductFolders(category);
    console.log(`Pre-Processing ${products.length} products in ${category}…\n`);
    let ok = 0, skipped = 0, failed = 0;
    for (let i = 0; i < products.length; i++) {
      const p = products[i];
      let r;
      try {
        r = await processOne(p, { falKey, geminiKey, force });
      } catch (err) {
        r = { ok: false, error: err.message };
      }
      if (r.ok && r.skipped) {
        console.log(`[${i + 1}/${products.length}] ⏭  ${path.basename(p)}`);
        skipped++;
      } else if (r.ok) {
        console.log(`[${i + 1}/${products.length}] ✓ ${path.basename(p)}  picked=${r.picked}  (${r.dt}s)`);
        ok++;
      } else {
        console.log(`[${i + 1}/${products.length}] ✗ ${path.basename(p)}  ${r.error}`);
        failed++;
      }
    }
    console.log(`\n=== DONE ===  ${ok} ok, ${skipped} skipped, ${failed} failed`);
    if (failed > 0) process.exit(2);
    return;
  }

  // Single product mode
  const productFolder = args.find(a => !a.startsWith('--'));
  if (!productFolder) {
    console.error('Usage: node nano-pre-process.mjs <product-folder> [--force]');
    console.error('   or: node nano-pre-process.mjs --batch <category> [--force]');
    process.exit(1);
  }

  console.log(`Pre-Processing: ${path.basename(productFolder)}`);
  const r = await processOne(productFolder, { falKey, geminiKey, force });
  if (r.ok && r.skipped) {
    console.log(`⏭  ${r.path} already exists (use --force to regenerate)`);
  } else if (r.ok) {
    console.log(`✓ Picked source: ${r.picked}`);
    console.log(`✓ Saved clean garment: ${r.path}  (${r.dt}s)`);
  } else {
    console.error(`✗ FAILED: ${r.error}`);
    process.exit(1);
  }
}

main().catch(err => { console.error('FATAL:', err.message); process.exit(1); });
