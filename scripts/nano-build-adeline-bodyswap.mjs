#!/usr/bin/env node
// Adeline Body-Swap: Gesicht aus v6 + Körperform aus existierendem anchor_persona_front.jpg.
// Zwei Image Inputs an Gemini:
//   IMAGE 1 = adeline_v6.jpg → Persona-Identität (Gesicht, Haare, Skin)
//   IMAGE 2 = anchor_persona_front.jpg → Body-Form (Sanduhr, Po, Brust, sportlich)
// Output: 4 Varianten in _anchors/adeline_candidates/

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENV_PATH = path.join(__dirname, '..', '.env');
const ADELINE_FACE = '/Users/home/Vinted/_anchors/adeline_candidates/adeline_v6.jpg';
const BODY_REF = '/Users/home/Vinted/_anchors/anchor_persona_front.jpg';
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

const PROMPT = `EDIT TASK: Generate a single full-body iPhone mirror selfie of a fictional 21-year-old European woman.

COMBINE TWO IMAGES:
- IMAGE 1 (Adeline) → use ONLY for face, hair, skin tone:
  * Face: dirty-blonde wavy-haired girl from IMAGE 1, exact same face geometry, same hazel-green eyes, same nose, same lips, same expression
  * Hair: same dirty-blonde messy beach waves past shoulders, middle-parted, same length and style
  * Skin: same lightly-tanned Mediterranean glow with same subtle texture

- IMAGE 2 (body reference) → use ONLY for body proportions and figure:
  * Body shape: copy the EXACT athletic curvy hourglass figure from IMAGE 2 — pronounced full rounded butt that projects clearly outward, sharply pinched waist, full firm bust visible through tight top, slim toned arms, long lean toned legs with thigh gap, narrow shoulders. Sportlich-fit-curvy aesthetic.
  * Body type: visible strong waist-to-hip-to-bust contrast, fit AND curvy, like a fitness/Pilates girl with strong glutes from training. NOT skinny, NOT BBL-fake, but distinctly more curvy than a typical fashion model.

OUTFIT: same simple white ribbed tank top + plain bike shorts (any color black or white) + white tube ankle socks + sneakers OR barefoot socks.

POSE: standing relaxed in a slight 3/4 angle (like the body reference IMAGE 2), holding small palm-sized iPhone in front of her face at chest height, free hand at side. Mirror selfie pose.

SETTING: clean modern bedroom (similar to the references — neutral light backdrop, parquet floor, simple wall behind). Vertical 9:16 full-body composition.

STYLE: real iPhone-front-camera quality (slightly soft, natural sensor grain), candid lived-in feel, NOT studio.

CRITICAL: this is a SINGLE-FRAME photo with ONE woman in it (NOT collage, NOT triptych, NOT side-by-side). Output is the mirror reflection edge-to-edge.

NEGATIVE: NO multi-frame, NO collage, NO different face from IMAGE 1, NO different body from IMAGE 2, NO bare feet without socks, NO oversized phone, NO HDR, NO studio lighting, NO text/logos/watermarks, NO real person likeness — fictional character.`;

async function loadImageBase64(filePath) {
  const buf = await fs.readFile(filePath);
  return { mime_type: 'image/jpeg', data: buf.toString('base64') };
}

async function callGemini({ images, geminiKey, seed }) {
  const parts = [];
  for (const img of images) parts.push({ inline_data: img });
  parts.push({ text: PROMPT + ' [variation seed:' + seed + ']' });

  const res = await fetchWithRetry(
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-image-preview:generateContent',
    {
      method: 'POST',
      headers: { 'x-goog-api-key': geminiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts }],
        generationConfig: { responseModalities: ['IMAGE'], temperature: 0.8 },
      }),
    }
  );
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`gemini ${res.status}: ${body.slice(0, 300)}`);
  }
  const data = await res.json();
  const candidate = data?.candidates?.[0];
  if (!candidate) throw new Error('No candidate');
  const imagePart = candidate.content?.parts?.find(p => p.inline_data || p.inlineData);
  const inlineData = imagePart?.inline_data || imagePart?.inlineData;
  if (!inlineData?.data) throw new Error('No image');
  return Buffer.from(inlineData.data, 'base64');
}

async function generateOne({ num, faceImg, bodyImg, geminiKey }) {
  const filename = `adeline_bodyswap_${num}.jpg`;
  const outPath = path.join(OUT_DIR, filename);
  const tStart = Date.now();
  try {
    const buf = await callGemini({
      images: [faceImg, bodyImg],
      geminiKey,
      seed: num * 1000 + Math.floor(Math.random() * 999),
    });
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
  for (const f of [ADELINE_FACE, BODY_REF]) {
    if (!await fs.stat(f).catch(() => null)) throw new Error(`Missing: ${f}`);
  }

  const [faceImg, bodyImg] = await Promise.all([
    loadImageBase64(ADELINE_FACE),
    loadImageBase64(BODY_REF),
  ]);

  console.log(`Body-swap: Adeline-face + curvy-body → 4 variants…\n`);
  const results = await Promise.all([1, 2, 3, 4].map(n =>
    generateOne({ num: n, faceImg, bodyImg, geminiKey })
  ));
  const ok = results.filter(r => r.ok).length;
  console.log(`\nDone: ${ok}/4 ok`);
}

main().catch(err => { console.error('FATAL:', err.message); process.exit(1); });
