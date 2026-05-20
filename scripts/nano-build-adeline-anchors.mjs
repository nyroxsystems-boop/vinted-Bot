#!/usr/bin/env node
// Generate Adeline Back + Face Anchors based on the new Front anchor.
// Input: anchor_persona_front.jpg (= bodyswap_1, Adeline-Persona)
// Output: anchor_persona_back.jpg + anchor_persona_face.jpg

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENV_PATH = path.join(__dirname, '..', '.env');
const FRONT = '/Users/home/Vinted/_anchors/anchor_persona_front.jpg';
const ENV_ANCHOR = '/Users/home/Vinted/_anchors/anchor_environment.jpg';
const BACK_OUT = '/Users/home/Vinted/_anchors/anchor_persona_back.jpg';
const FACE_OUT = '/Users/home/Vinted/_anchors/anchor_persona_face.jpg';

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

async function loadImageBase64(filePath) {
  const buf = await fs.readFile(filePath);
  return { mime_type: 'image/jpeg', data: buf.toString('base64') };
}

const BACK_PROMPT = `EDIT TASK: Take the woman in IMAGE 1 (the dirty-blonde wavy-haired Adeline mirror selfie) and generate the SAME WOMAN from the BACK in the SAME bedroom shown in IMAGE 2.

PRESERVE EXACTLY from IMAGE 1:
- Same Adeline face (visible in profile when she looks back over her shoulder)
- Same dirty-blonde wavy hair past shoulders
- Same Mediterranean lightly-tanned skin
- Same slim+curvy hourglass body (sharp waist, full glutes, full bust)
- Same outfit: white ribbed tank top + black bike shorts + white tube ankle socks

PRESERVE EXACTLY from IMAGE 2 (or IMAGE 1 background):
- Same bedroom: white IKEA wardrobe LEFT with orange Hermès/LV boxes on top, white IKEA Malm dresser RIGHT with vase + flowers, light honey-oak block parquet floor, off-white walls
- Same warm interior lighting

POSE: She is now turned with her BACK to the mirror, looking back over her RIGHT shoulder toward the mirror (so you see her back + face in 3/4 profile). Hair pulled to her LEFT side falling over left shoulder so the back of her tank top is unobstructed. Her glutes are clearly visible from this back angle, projecting outward (the same curvy body as IMAGE 1 just shown from behind). Right hand holds the small palm-sized iPhone with pink heart popsocket high near her right ear / above shoulder. Left hand at her side.

OUTPUT: SINGLE FRAME full-body mirror selfie, vertical 9:16, photo-realistic iPhone-front-camera quality. Mirror reflection edge-to-edge, NO mirror frame.

NEGATIVE: NO different person, NO different hair, NO different body, NO different outfit, NO multi-frame collage, NO bare feet, NO oversized phone, NO HDR, NO text/logos.`;

const FACE_PROMPT = `EDIT TASK: Take the woman in IMAGE 1 (the dirty-blonde wavy-haired Adeline) and generate a CLOSE-UP HEADSHOT of her face from the same angle as a regular selfie (not mirror selfie this time — direct front-camera close-up of her face from chin to top of head).

PRESERVE EXACTLY:
- Same Adeline face (exact face geometry, eye color, nose, lips, expression — she is naturally pretty 21-year-old)
- Same dirty-blonde wavy hair (visible around her face)
- Same Mediterranean lightly-tanned skin tone with subtle natural texture
- Naturally pretty soft expression, mouth gently relaxed or with hint of smile

OUTPUT: close-up headshot from chin to top of head + small bit of shoulders, vertical 3:4. Soft natural light from a window (similar to her bedroom). Hair frames the face. Photo-realistic iPhone-front-camera quality. Real skin texture (visible fine pores, NOT plastic-smooth).

NEGATIVE: NO different person, NO different hair color, NO heavy makeup, NO Instagram filter, NO plastic smoothing, NO mirror selfie, NO phone in frame, NO text/logos.`;

async function callGemini({ prompt, images, geminiKey, temperature = 0.5 }) {
  const parts = [];
  for (const img of images) parts.push({ inline_data: img });
  parts.push({ text: prompt });
  const res = await fetchWithRetry(
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-image-preview:generateContent',
    {
      method: 'POST',
      headers: { 'x-goog-api-key': geminiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts }],
        generationConfig: { responseModalities: ['IMAGE'], temperature },
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

async function main() {
  await loadEnv();
  const geminiKey = process.env.GEMINI_API_KEY;
  if (!geminiKey) throw new Error('GEMINI_API_KEY missing');

  const [frontImg, envImg] = await Promise.all([
    loadImageBase64(FRONT),
    loadImageBase64(ENV_ANCHOR),
  ]);

  console.log('Generating Adeline Back + Face anchors parallel…\n');
  const t0 = Date.now();

  const [backResult, faceResult] = await Promise.all([
    (async () => {
      const tStart = Date.now();
      try {
        const buf = await callGemini({
          prompt: BACK_PROMPT,
          images: [frontImg, envImg],
          geminiKey,
          temperature: 0.6,
        });
        await fs.writeFile(BACK_OUT, buf);
        return { name: 'back', ok: true, dt: ((Date.now() - tStart) / 1000).toFixed(1) };
      } catch (err) {
        return { name: 'back', ok: false, error: err.message };
      }
    })(),
    (async () => {
      const tStart = Date.now();
      try {
        const buf = await callGemini({
          prompt: FACE_PROMPT,
          images: [frontImg],
          geminiKey,
          temperature: 0.5,
        });
        await fs.writeFile(FACE_OUT, buf);
        return { name: 'face', ok: true, dt: ((Date.now() - tStart) / 1000).toFixed(1) };
      } catch (err) {
        return { name: 'face', ok: false, error: err.message };
      }
    })(),
  ]);

  const dt = ((Date.now() - t0) / 1000).toFixed(1);
  for (const r of [backResult, faceResult]) {
    if (r.ok) console.log(`  ✓ ${r.name}_anchor  (${r.dt}s)`);
    else console.log(`  ✗ ${r.name} FAILED: ${r.error}`);
  }
  console.log(`\nDone in ${dt}s`);
}

main().catch(err => { console.error('FATAL:', err.message); process.exit(1); });
