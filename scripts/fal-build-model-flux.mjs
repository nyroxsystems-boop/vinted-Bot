#!/usr/bin/env node
// Generiert einen NEUEN Model-Anchor mit fal-ai/flux-pro/v1.1-ultra (raw mode).
//
// Wechsel von Seedream v4 Edit (Edit-Modell, Identity drift bei jeder Generation)
// zu Flux Pro 1.1 Ultra (Text-to-Image, top-tier photorealism, raw=true für
// echten Foto-Look statt "instagram-polish").
//
// Output: /Users/home/Vinted/_anchors/model_flux.jpg
// (Wird NICHT model.jpg überschrieben — User entscheidet nach Sichtprüfung.)

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENV_PATH  = path.join(__dirname, '..', '.env');
const OUT_PATH  = '/Users/home/Vinted/_anchors/model_flux.jpg';

async function loadEnv() {
  const raw = await fs.readFile(ENV_PATH, 'utf8');
  for (const line of raw.split('\n')) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

async function callFlux(prompt, key, numImages = 1) {
  const res = await fetch('https://fal.run/fal-ai/flux-pro/v1.1-ultra', {
    method: 'POST',
    headers: { Authorization: `Key ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt,
      aspect_ratio: '9:16',
      num_images: numImages,
      enable_safety_checker: false,
      safety_tolerance: '6',
      output_format: 'jpeg',
      raw: true,
    }),
  });
  if (!res.ok) throw new Error(`flux ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const urls = (data?.images || []).map(i => i.url).filter(Boolean);
  if (urls.length === 0) throw new Error(`No images in response: ${JSON.stringify(data).slice(0, 400)}`);
  return urls;
}

async function downloadTo(url, outPath) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await fs.writeFile(outPath, buf);
}

async function main() {
  await loadEnv();
  const key = process.env.FAL_KEY;
  if (!key) throw new Error('FAL_KEY missing');

  // Lean prompt — Flux Pro Ultra weights early tokens heavier and ignores
  // long "no X" negation lists. So: load-bearing constraints first, short
  // affirmative clauses, no big anti-lists.
  const prompt = [
    'Full-body mirror selfie of a curvy hourglass blonde 22-year-old woman, photographed head-to-toe in a vertical 9:16 frame.',
    'She is a stunning Instagram it-girl with a scroll-stopping pretty face: large doe almond eyes, soft full plump lips with subtle pink gloss, soft rounded cheekbones, soft feminine jawline, small straight nose, thick brows. Long thick voluminous wavy blonde balayage hair with caramel highlights past her shoulders. Sun-kissed glowing tan skin, clean and smooth.',
    'Her body is a pronounced curvy hourglass — cinched narrow waist, full round wide hips, full natural bust, toned thighs, long legs, fit shoulders. Sexy curvy yet athletic young fitness influencer silhouette (Sommer Ray / Anastasia Karanikolaou aesthetic).',
    'She wears a fitted white ribbed crop tank top showing her toned midriff, fitted white high-waisted biker shorts, white ankle socks, white chunky sneakers. Plain all-white casual gym outfit, no other clothing.',
    'She holds a normal-sized iPhone with a hot pink solid silicone case in her right hand at chest height. The phone is small and proportional, partially covering her chin and mouth area only — her eyes, brows, forehead and hair stay fully visible above the phone. Three camera lenses on the back. Her free left hand rests at her side.',
    'Pose: standing confidently with a soft natural hip pop, weight on her right leg, slight S-curve, full body and feet visible at the bottom of the frame.',
    'Setting: bedroom with warm golden oak herringbone parquet floor, white walls, white wardrobe and drawers, lived-in cozy aesthetic.',
    'Light: soft even natural daylight, slightly warm, gentle ambient — no harsh sun, no studio lights.',
    'Style: authentic candid iPhone mirror selfie, slightly soft front-camera look, real JPEG photo quality, completely unedited and unfiltered, no beauty filter, no airbrushing, no portrait-mode bokeh, looks like a real Instagram OOTD post.',
  ].join(' ');

  const numImages = parseInt(process.argv[2] || '4', 10);
  console.log(`Generating ${numImages} variants with fal-ai/flux-pro/v1.1-ultra (raw mode)…`);
  const t0 = Date.now();
  const urls = await callFlux(prompt, key, numImages);
  console.log(`Got ${urls.length} variants in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  const outDir = '/Users/home/Vinted/_anchors';
  const outs = [];
  for (let i = 0; i < urls.length; i++) {
    const out = path.join(outDir, `model_flux_v${i + 1}.jpg`);
    await downloadTo(urls[i], out);
    console.log(`  ✓ ${out}`);
    outs.push(out);
  }
  console.log(`\nDone. Pick the best from: ${outs.join(', ')}`);
}

main().catch(err => { console.error('FAIL:', err.message); process.exit(1); });
