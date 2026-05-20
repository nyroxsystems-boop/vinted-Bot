#!/usr/bin/env node
// Adeline v6 — verstärkte Hourglass-Version.
// 4 Varianten mit dem v6-Look (dirty-blonde wavy, mediterranean tan)
// + extra-pronounced sanduhr (kleine Taille, mehr Brust, mehr Po).

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENV_PATH = path.join(__dirname, '..', '.env');
const OUT_DIR = '/Users/home/Vinted/_anchors/adeline_candidates';

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
      await new Promise(r => setTimeout(r, 3000 * (i + 1)));
    }
  }
  throw lastErr;
}

const PROMPT = `Hyperrealistic SINGLE FRAME full-body iPhone front-camera mirror selfie of a fictional 21-year-old European woman, NOT a real person — purely AI-generated character.

CRITICAL: Output is ONE SINGLE PHOTO with ONE woman in it. NOT a multi-frame collage, NOT a triptych, NOT side-by-side variations. ONE woman, ONE pose, ONE photo.

FACE: striking pretty 21-year-old, soft fine cheekbones, large doe-eyes hazel-green, small straight nose, full natural lips with subtle pink gloss. Dirty-blonde wavy hair past shoulders, slightly messy lived-in beach waves, middle-parted. Lightly-tanned glowing Mediterranean skin with subtle natural texture (visible fine pores, NOT plastic-smooth filter). Naturally beautiful, NOT plastic-doll, NOT filter-overdone.

BODY — STRONG hourglass figure with PRONOUNCED curves (this is the priority):
- VERY small cinched waist (sharp wasp waist that pinches in dramatically)
- FULL natural firm bust (full D cup — clearly larger than her ribcage, soft round shape, real and natural NOT augmented-looking)
- FULL naturally rounded hips and rounded firm glutes (clearly wider than ribcage, real shape from squats — round and shapely, NOT BBL but visibly curvy)
- Lean toned thighs with clear thigh gap, slender calves
- Narrow shoulders and slender fit arms keep frame petite
- Visual read: petite frame + EXAGGERATED hourglass = clear strong waist-to-hip-to-bust contrast (about 0.6 waist-to-hip ratio). Slim AND VERY curvy at once. NOT skinny-flat, NOT BBL-overdone — natural but visibly more curvy than a typical fashion model.

OUTFIT: simple white ribbed tank top + plain black bike shorts, white tube socks. NO bare feet.

POSE: standing relaxed, soft hip pop, weight on one leg, holding iPhone in front of her face at chest height (small palm-sized phone, NOT oversized).

SETTING: clean modern bedroom with neutral light backdrop, full body visible head to feet, vertical 9:16 composition.

STYLE: real iPhone-front-camera quality (slightly soft, natural sensor grain, mild JPEG compression), candid lived-in feel, NOT studio.

NEGATIVE: NO multi-frame collage, NO triptych, NO side-by-side, NO multiple instances of the woman, NO plastic doll skin, NO filter overdose, NO bare feet, NO oversized phone, NO HDR, NO studio lighting, NO text/logos/watermarks, NO real person likeness — fictional character only.`;

async function callGemini({ geminiKey, seed }) {
  const res = await fetchWithRetry(
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-image-preview:generateContent',
    {
      method: 'POST',
      headers: { 'x-goog-api-key': geminiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: PROMPT + ' [seed:' + seed + ']' }] }],
        generationConfig: { responseModalities: ['IMAGE'], temperature: 0.95 },
      }),
    }
  );
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`gemini ${res.status}: ${body.slice(0, 300)}`);
  }
  const data = await res.json();
  const candidate = data?.candidates?.[0];
  if (!candidate) throw new Error(`No candidate`);
  const imagePart = candidate.content?.parts?.find(p => p.inline_data || p.inlineData);
  const inlineData = imagePart?.inline_data || imagePart?.inlineData;
  if (!inlineData?.data) throw new Error(`No image`);
  return Buffer.from(inlineData.data, 'base64');
}

async function generateOne({ num, geminiKey }) {
  const filename = `adeline_v6curvy_${num}.jpg`;
  const outPath = path.join(OUT_DIR, filename);
  const tStart = Date.now();
  try {
    const buf = await callGemini({ geminiKey, seed: num * 1000 + Math.floor(Math.random() * 999) });
    await fs.writeFile(outPath, buf);
    const dt = ((Date.now() - tStart) / 1000).toFixed(1);
    console.log(`  ✓ ${filename}  (${dt}s)`);
    return { ok: true };
  } catch (err) {
    console.log(`  ✗ ${filename} FAILED: ${err.message}`);
    return { ok: false };
  }
}

async function main() {
  await loadEnv();
  const geminiKey = process.env.GEMINI_API_KEY;
  if (!geminiKey) throw new Error('GEMINI_API_KEY missing');

  await fs.mkdir(OUT_DIR, { recursive: true });
  console.log(`Generating 4 Adeline-v6-curvy candidates parallel…\n`);

  const results = await Promise.all([1, 2, 3, 4].map(n => generateOne({ num: n, geminiKey })));
  const ok = results.filter(r => r.ok).length;
  console.log(`\nDone: ${ok}/4 ok`);
}

main().catch(err => { console.error('FATAL:', err.message); process.exit(1); });
