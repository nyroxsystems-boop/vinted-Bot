#!/usr/bin/env node
// Generiert 8 vollständig synthetische Gesichts-Kandidaten from scratch
// (kein Input-Bild — reines Text-to-Image via Flux 1.1 Pro Ultra).
//
// Look-Anker: blonde Balayage, schlank, mediterran, ~22, candid iPhone.
// Output:  /Users/home/Vinted/_anchors/synth_face_v{1..N}.png
//
// Nach Auswahl des besten Kandidaten -> wird zu neuem face_ref.png
// für die bestehende Seedream-Edit-Pipeline (Body/Outfit/Pose).
//
// Usage:
//   node fal-build-synthetic-persona.mjs           # 8 Kandidaten (default)
//   node fal-build-synthetic-persona.mjs 4         # 4 Kandidaten

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENV_PATH  = path.join(__dirname, '..', '.env');
const ANCHOR_DIR = '/Users/home/Vinted/_anchors';

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
    try {
      return await fetch(url, opts);
    } catch (err) {
      lastErr = err;
      const wait = 3000 * (i + 1);
      console.log(`  retry ${i + 1}/${retries} after ${wait}ms (${err.message})`);
      await new Promise(r => setTimeout(r, wait));
    }
  }
  throw lastErr;
}

async function callFluxUltra({ prompt, numImages }, key) {
  const res = await fetchWithRetry('https://fal.run/fal-ai/flux-pro/v1.1-ultra', {
    method: 'POST',
    headers: { Authorization: `Key ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt,
      num_images: numImages,
      aspect_ratio: '3:4',
      raw: true,
      safety_tolerance: '6',
      output_format: 'png',
      enable_safety_checker: false,
    }),
  });
  if (!res.ok) throw new Error(`fal flux-ultra ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const urls = (data?.images || []).map(i => i.url).filter(Boolean);
  if (urls.length === 0) throw new Error(`No images: ${JSON.stringify(data).slice(0, 400)}`);
  return urls;
}

async function downloadTo(url, outPath) {
  const res = await fetchWithRetry(url);
  if (!res.ok) throw new Error(`download ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await fs.writeFile(outPath, buf);
}

async function main() {
  await loadEnv();
  const key = process.env.FAL_KEY;
  if (!key) throw new Error('FAL_KEY missing in system/.env');

  const numImages = parseInt(process.argv[2] || '8', 10);

  const prompt = [
    'Candid authentic iPhone front-camera selfie portrait of a fully fictional 22-year-old European woman.',
    '',
    'FACE: long thick wavy balayage hair with darker brown roots fading into cool honey-blonde lengths past shoulders, center-parted, slightly tousled lived-in waves, healthy and shiny.',
    '',
    'Lightly tanned Mediterranean complexion with natural undertone, soft rounded youthful cheeks (NOT chiseled, NOT contoured hard), large soft almond-shaped hazel-green eyes, defined naturally groomed full eyebrows, small straight nose, full natural relaxed lips with subtle pink gloss (NOT pouty, NOT plump, NOT duck-face — just real soft natural mouth slightly relaxed).',
    '',
    'MAKEUP: minimal natural — subtle blush on cheeks, mascara, glossy lip. NO heavy contour, NO heavy eyeliner, NO false lashes, NO lip filler look, NO Instagram glam.',
    '',
    'EXPRESSION: soft neutral relaxed, looking softly toward camera, tiny hint of a natural smile or completely neutral, NOT posed, NOT smizing.',
    '',
    'COMPOSITION: head and upper-shoulders portrait, vertical 3:4 frame, plain neutral warm beige interior background slightly out of focus, soft natural daylight from window on the side.',
    '',
    'STYLE: photorealistic, real human skin with visible pores and natural texture, slight imperfections (tiny blemish, fine peach fuzz), NOT airbrushed, NOT beauty-filtered, NOT plastic, NOT CGI, NOT 3D-rendered. Slightly soft front-camera quality with very subtle natural grain. Candid lived-in feel — she looks like a real normal pretty 22-year-old, NOT a fashion model, NOT an influencer.',
    '',
    'NEGATIVE: no text, no logos, no watermarks, no UI overlays, no glamour lighting, no studio backdrop, no airbrushing.',
  ].join('\n');

  console.log(`Generating ${numImages} synthetic face candidates via Flux 1.1 Pro Ultra…`);
  console.log(`(no input images — pure text-to-image, fully fictional persona)\n`);

  const BATCH = 4;
  const t0 = Date.now();
  const urls = [];
  for (let remaining = numImages; remaining > 0; remaining -= BATCH) {
    const batchSize = Math.min(BATCH, remaining);
    console.log(`  batch of ${batchSize}…`);
    const batchUrls = await callFluxUltra({ prompt, numImages: batchSize }, key);
    urls.push(...batchUrls);
  }
  console.log(`\nGot ${urls.length} variants in ${((Date.now() - t0) / 1000).toFixed(1)}s\n`);

  await fs.mkdir(ANCHOR_DIR, { recursive: true });
  const outs = [];
  for (let i = 0; i < urls.length; i++) {
    const out = path.join(ANCHOR_DIR, `synth_face_v${i + 1}.png`);
    await downloadTo(urls[i], out);
    console.log(`  ✓ ${out}`);
    outs.push(out);
  }
  console.log(`\nDone. Schau dir die ${outs.length} Kandidaten in _anchors/ an und sag welcher (v1..v${outs.length}).`);
  console.log(`Der gewählte wird dann zu face_ref_synth.png und füttert die Seedream-Edit-Pipeline.`);
}

main().catch(err => { console.error('FAIL:', err.message); process.exit(1); });
