#!/usr/bin/env node
// Adeline v6 Image-Edit Variante.
// Input: adeline_v6.jpg (die original Persona)
// Prompt: same girl, but mehr Sanduhr (schmalere Taille, mehr Brust, mehr Arsch)
// Output: 4 Variants in _anchors/adeline_candidates/

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENV_PATH = path.join(__dirname, '..', '.env');
const SOURCE = '/Users/home/Vinted/_anchors/adeline_candidates/adeline_v6.jpg';
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

const EDIT_PROMPT = `EDIT TASK: Take the woman in IMAGE 1 (the dirty-blonde wavy-haired Mediterranean-tan girl in white tank top + black bike shorts mirror selfie) and modify ONLY her body proportions to have a MUCH MORE PRONOUNCED HOURGLASS figure.

CRITICAL — PRESERVE EXACTLY from IMAGE 1:
- Her face (same face geometry, same eyes, same nose, same lips, same expression)
- Her hair (same dirty-blonde messy beach waves, same length, same parting)
- Her skin tone (same Mediterranean lightly-tanned glow)
- Her outfit (same white ribbed tank top, same black bike shorts, same white tube socks)
- The bedroom setting, lighting, mirror — keep the overall vibe similar

MODIFY HER BODY to be VISIBLY more curvy:
- WAIST: much narrower, sharply pinched-in wasp waist (small visible cinch)
- BUST: noticeably FULLER and rounder (full D cup feel — clearly larger and more present than in IMAGE 1, real and natural shape, NOT augmented-looking)
- HIPS: noticeably WIDER with full naturally rounded firm shape
- GLUTES: noticeably FULLER and more rounded (visible curve at the back of the bike shorts even from this front angle — projecting outward)
- Maintain lean toned thighs with thigh gap and slender petite frame
- Visual read: SAME pretty girl as IMAGE 1, but with a MUCH MORE PRONOUNCED hourglass shape — small waist, full bust, full butt, narrow shoulders, slim arms

She should look like the same Adeline character, just with a more curvy body. NOT a different person.

OUTPUT: single full-body mirror selfie photo, vertical 9:16, photo-realistic iPhone-front-camera quality.

NEGATIVE: NO multi-frame collage, NO triptych, NO different-looking person, NO different hair color, NO different outfit, NO bare feet, NO oversized phone, NO text/logos/watermarks, NO BBL-overdone exaggeration — natural-looking but visibly more curvy.`;

async function loadImageBase64(filePath) {
  const buf = await fs.readFile(filePath);
  return { mime_type: 'image/jpeg', data: buf.toString('base64') };
}

async function callGeminiEdit({ images, geminiKey, seed }) {
  const parts = [];
  for (const img of images) parts.push({ inline_data: img });
  parts.push({ text: EDIT_PROMPT + ' [variation seed:' + seed + ']' });

  const res = await fetchWithRetry(
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-image-preview:generateContent',
    {
      method: 'POST',
      headers: { 'x-goog-api-key': geminiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts }],
        generationConfig: { responseModalities: ['IMAGE'], temperature: 0.7 },
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

async function generateOne({ num, sourceImg, geminiKey }) {
  const filename = `adeline_v6edit_${num}.jpg`;
  const outPath = path.join(OUT_DIR, filename);
  const tStart = Date.now();
  try {
    const buf = await callGeminiEdit({
      images: [sourceImg],
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
  if (!await fs.stat(SOURCE).catch(() => null)) {
    throw new Error(`Source missing: ${SOURCE}`);
  }

  const sourceImg = await loadImageBase64(SOURCE);
  console.log(`Editing adeline_v6.jpg → 4 hourglass variants…\n`);

  const results = await Promise.all([1, 2, 3, 4].map(n =>
    generateOne({ num: n, sourceImg, geminiKey })
  ));
  const ok = results.filter(r => r.ok).length;
  console.log(`\nDone: ${ok}/4 ok`);
}

main().catch(err => { console.error('FATAL:', err.message); process.exit(1); });
