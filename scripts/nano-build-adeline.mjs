#!/usr/bin/env node
// Generate "Adeline" — 8 synthetic Persona-Kandidaten via Gemini text-to-image.
// Variiert Hair-Color/Style + leichte Face-Variationen.
// Alle: 21 Jahre, maximal hübsch, curvy hourglass body, natürlich aber sexy.
//
// Output: _anchors/adeline_candidates/adeline_v1.jpg ... v8.jpg
// User picks 1 → wird zu neuer face_ref_adeline.png
//
// Cost: 8 × $0.039 = ~$0.31

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

const BASE_PERSONA = `Hyperrealistic full-body iPhone front-camera selfie portrait of a
fictional 21-year-old European woman, NOT a real person — purely AI-generated character.

She is striking pretty and naturally beautiful, NOT plastic, NOT
filter-overdone. Soft youthful 21-year-old features, soft fine
cheekbones, large expressive doe-eyes with long natural lashes, small
straight nose, full natural lips with subtle pink gloss. Defined
naturally groomed brows.

BODY: petite athletic frame with PRONOUNCED feminine hourglass curves:
toned shoulders, slender fit arms, sharply cinched small waist, FULL
naturally rounded firm hips and glutes (real shape from squats —
shapely, NOT BBL, NOT augmented), lean toned thighs with clear thigh
gap, slender calves, FULL natural firm bust in clear contrast to her
tiny waist (full C cup, real, NOT enhanced). Body reads as slim AND
sexy AND distinctly feminine — NOT flat, NOT skinny-runway, NOT
exaggerated.

Lightly-tanned glowing Mediterranean skin with healthy radiance and
subtle natural texture (visible fine pores, NOT plastic-smooth filter).

Standing in a clean modern bedroom with neutral light backdrop, simple
white tank-top + plain bike shorts, casual relaxed pose, holding
iPhone with both hands taking the mirror selfie.

Real iPhone-front-camera quality (slightly soft, natural sensor grain,
mild JPEG compression), candid lived-in feel, NOT studio.

NEGATIVE: NO plastic doll skin, NO filter overdose, NO makeup heavy,
NO duck-face, NO bare feet, NO oversized phone, NO HDR, NO studio
lighting, NO text/logos/watermarks. NO real person likeness —
fictional character only.`;

// 8 Variationen: 4 Hair-Colors × 2 Pose/Face-Styles
const VARIANTS = [
  { num: 1, desc: 'Long platinum-blonde pin-straight hair, center-parted, falling past shoulders. Hazel-blue eyes.' },
  { num: 2, desc: 'Long honey-blonde balayage with darker roots, soft tousled waves past shoulders. Green eyes.' },
  { num: 3, desc: 'Long warm brunette hair with caramel highlights, gentle waves past shoulders, center-parted. Hazel-brown eyes.' },
  { num: 4, desc: 'Long dark brown almost-black silky-straight hair past mid-back, side-parted. Deep brown eyes.' },
  { num: 5, desc: 'Long ash-blonde hair with subtle highlights, slick high ponytail with smooth crown. Light blue-grey eyes.' },
  { num: 6, desc: 'Long dirty-blonde wavy hair past shoulders, slightly messy lived-in beach waves, middle-parted. Hazel-green eyes.' },
  { num: 7, desc: 'Long medium-brown hair with face-framing layers, soft loose curls, side-swept bangs. Warm brown eyes.' },
  { num: 8, desc: 'Long champagne-blonde hair, sleek and shiny, half-up half-down style. Crystal blue eyes.' },
];

async function callGemini({ prompt, geminiKey }) {
  const res = await fetchWithRetry(
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-image-preview:generateContent',
    {
      method: 'POST',
      headers: { 'x-goog-api-key': geminiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseModalities: ['IMAGE'], temperature: 0.9 },
      }),
    }
  );
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`gemini ${res.status}: ${body.slice(0, 300)}`);
  }
  const data = await res.json();
  const candidate = data?.candidates?.[0];
  if (!candidate) throw new Error(`No candidate: ${JSON.stringify(data).slice(0, 300)}`);
  const imagePart = candidate.content?.parts?.find(p => p.inline_data || p.inlineData);
  const inlineData = imagePart?.inline_data || imagePart?.inlineData;
  if (!inlineData?.data) throw new Error(`No image: ${JSON.stringify(data).slice(0, 300)}`);
  return Buffer.from(inlineData.data, 'base64');
}

async function generateOne({ variant, geminiKey }) {
  const filename = `adeline_v${variant.num}.jpg`;
  const outPath = path.join(OUT_DIR, filename);
  if (await fs.stat(outPath).catch(() => null)) {
    console.log(`  ⏭  ${filename} (existed)`);
    return { ok: true, skipped: true };
  }
  const tStart = Date.now();
  try {
    const fullPrompt = BASE_PERSONA + '\n\nUNIQUE FOR THIS VARIANT: ' + variant.desc;
    const buf = await callGemini({ prompt: fullPrompt, geminiKey });
    await fs.writeFile(outPath, buf);
    const dt = ((Date.now() - tStart) / 1000).toFixed(1);
    console.log(`  ✓ ${filename}  (${dt}s)  ${variant.desc.slice(0, 60)}…`);
    return { ok: true };
  } catch (err) {
    console.log(`  ✗ ${filename} FAILED: ${err.message}`);
    return { ok: false, error: err.message };
  }
}

async function main() {
  await loadEnv();
  const geminiKey = process.env.GEMINI_API_KEY;
  if (!geminiKey) throw new Error('GEMINI_API_KEY missing');

  await fs.mkdir(OUT_DIR, { recursive: true });

  console.log(`Generating 8 Adeline candidates parallel…`);
  console.log(`  Output: ${OUT_DIR}`);
  console.log();

  const t0 = Date.now();
  const results = await Promise.all(VARIANTS.map(v => generateOne({ variant: v, geminiKey })));
  const dt = ((Date.now() - t0) / 1000).toFixed(1);

  const ok = results.filter(r => r.ok).length;
  const fail = results.filter(r => !r.ok).length;

  console.log(`\n=== DONE in ${dt}s ===`);
  console.log(`  ✓ ${ok} ok, ✗ ${fail} failed`);
  console.log(`  Output: ${OUT_DIR}`);
  console.log();
  console.log(`Next: open the candidates, pick best one, copy to _anchors/anchor_persona_face.jpg`);
}

main().catch(err => { console.error('FATAL:', err.message); process.exit(1); });
