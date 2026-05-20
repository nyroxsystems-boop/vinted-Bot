#!/usr/bin/env node
// Baut die zwei kanonischen Anchor-Bilder für die Listing-Pipeline:
//
//   _anchors/environment.jpg   — leere Bedroom (Flux Pro Ultra, text-to-image)
//                                 = SETTING-Konstante. Wird in flatlays + als Setting-Anker
//                                   für model.jpg verwendet.
//
//   _anchors/model.jpg         — v3-Persona als Full-Body-Mirror-Selfie in genau dieser
//                                 Bedroom, wearing simple white tank + biker shorts.
//                                 = MASTER-Anchor. Pro Listing wird nur das Outfit
//                                   getauscht, Bedroom + Identität bleiben gelockt.
//
// Inputs:
//   _anchors/face_ref_synth.png  (synthetic v3 face)
//
// Endpoints:
//   environment.jpg → fal-ai/flux-pro/v1.1-ultra (text-to-image)
//   model.jpg       → fal-ai/bytedance/seedream/v4/edit (face + environment composition)
//
// Usage: node fal-build-anchors-synth.mjs

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENV_PATH = path.join(__dirname, '..', '.env');
const ANCHOR_DIR = '/Users/home/Vinted/_anchors';
const FACE_REF = path.join(ANCHOR_DIR, 'face_ref_synth.png');
const ENV_OUT = path.join(ANCHOR_DIR, 'environment.jpg');
const MODEL_OUT = path.join(ANCHOR_DIR, 'model.jpg');

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
      console.log(`  retry ${i + 1}/${retries} after ${wait}ms (${err.message})`);
      await new Promise(r => setTimeout(r, wait));
    }
  }
  throw lastErr;
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
  if (!put.ok) throw new Error(`fal upload ${put.status}: ${await put.text()}`);
  return file_url;
}

async function callFluxUltra({ prompt, aspectRatio }, key) {
  const res = await fetchWithRetry('https://fal.run/fal-ai/flux-pro/v1.1-ultra', {
    method: 'POST',
    headers: { Authorization: `Key ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt,
      num_images: 1,
      aspect_ratio: aspectRatio,
      raw: true,
      safety_tolerance: '6',
      output_format: 'jpeg',
      enable_safety_checker: false,
    }),
  });
  if (!res.ok) throw new Error(`flux-ultra ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const url = data?.images?.[0]?.url;
  if (!url) throw new Error(`No image: ${JSON.stringify(data).slice(0, 400)}`);
  return url;
}

async function callSeedream({ prompt, imageUrls, imageSize }, key) {
  const res = await fetchWithRetry('https://fal.run/fal-ai/bytedance/seedream/v4/edit', {
    method: 'POST',
    headers: { Authorization: `Key ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt,
      image_urls: imageUrls,
      image_size: imageSize,
      num_images: 1,
      max_images: 1,
      enable_safety_checker: false,
    }),
  });
  if (!res.ok) throw new Error(`seedream ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const url = data?.images?.[0]?.url;
  if (!url) throw new Error(`No image: ${JSON.stringify(data).slice(0, 400)}`);
  return url;
}

async function downloadTo(url, outPath) {
  const res = await fetchWithRetry(url);
  if (!res.ok) throw new Error(`download ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await fs.writeFile(outPath, buf);
}

const ENVIRONMENT_PROMPT = [
  'Empty modern bedroom corner photographed straight-on, candid iPhone snapshot aesthetic.',
  'A large ornate gold-framed full-length arched mirror leans against a clean off-white wall and DOMINATES the frame — the mirror takes up most of the vertical composition, edge to edge.',
  'Inside the mirror reflection: dark warm-brown herringbone parquet wood floor, the same off-white walls, soft warm natural daylight from a tall window on the left side, a glimpse of an unmade white bed with white linen and a textured cream throw cushion partially visible to the right inside the reflection. Lived-in cozy minimal aesthetic.',
  'NO PERSON in the reflection — the bedroom is empty.',
  'STYLE: photorealistic candid iPhone snapshot, soft warm even daylight, slight phone-camera grain, very faint smudges on mirror surface. NOT staged, NOT magazine, NOT studio, NOT HDR. Slightly soft (not DSLR-sharp). NO text, NO logos, NO watermarks.',
  'Vertical 9:16 composition.',
].join(' ');

const MODEL_PROMPT = [
  'Full-body iPhone mirror selfie of the woman from image 1, standing alone inside the bedroom shown in image 2.',
  '',
  'IDENTITY (from image 1) — match her face EXACTLY: 22-year-old, long thick wavy balayage hair (darker brown roots fading into honey-blonde lengths past shoulders, center-parted, slightly tousled lived-in waves), lightly tanned Mediterranean complexion, large soft hazel-green almond eyes with defined naturally groomed full eyebrows, small straight nose, full natural relaxed lips with subtle pink gloss, soft rounded youthful cheeks, minimal natural makeup (subtle blush, mascara, lip gloss). Soft neutral expression with lips slightly parted, looking softly toward camera.',
  '',
  'BODY — slim petite athletic figure with pronounced hourglass curves: very lean toned narrow shoulders, slender fit arms, sharply pinched tiny defined waist, full naturally rounded hips and glutes giving a strong waist-to-hip contrast (real shape from squats and Pilates — shapely and feminine, NOT BBL, NOT augmented), lean toned thighs with a clear thigh gap, slender lean calves, full natural firm chest in clear contrast to her tiny waist creating a striking hourglass silhouette (full natural C cup, real). Slim petite fashion-model frame with strong feminine curves at bust and hips. Polished soft glowing lightly tanned Mediterranean skin.',
  '',
  'SETTING (from image 2) — KEEP THIS BEDROOM EXACTLY: same large gold-framed full-length arched mirror, same off-white walls, same dark warm-brown herringbone parquet floor, same window left, same white bed glimpse right. Do NOT change the room, do NOT add furniture, do NOT change colors.',
  '',
  'OUTFIT (base anchor — will be swapped per listing): plain white ribbed tank top fitted at her cinched waist, plain white high-waisted ribbed biker shorts, white tube ankle socks. NO shoes (barefoot in socks on the parquet).',
  '',
  'POSE: standing relaxed in front of the mirror, weight on her RIGHT leg with a soft natural hip pop, LEFT knee slightly bent inward. Right hand holding a real iPhone with a hot pink solid silicone case at chest height (phone is realistic SIZE — about as wide as her palm, smaller than her face, taller than wide ~2.1:1 with a visible camera bump in the upper-left corner of the back; she holds it with exactly four fingers wrapped naturally around the back-left edge and her thumb on the screen; eyes/forehead clearly visible above the phone, phone partially covers chin only). LEFT hand resting softly at her side.',
  '',
  'COMPOSITION: full-body shot from the top of her head down to her socked feet, vertical frame, she fills the frame with breathing room above her head and below her feet, positioned slightly LEFT of center inside the mirror reflection.',
  '',
  'CRITICAL — NO MIRROR FRAME IN THE OUTPUT: the entire output image IS the mirror reflection — no visible mirror frame, no gold rim, no border around the photo. The image fills 9:16 edge-to-edge as if the photo is what the mirror shows. Do NOT draw any mirror frame around the image.',
  '',
  'STYLE: real candid iPhone front-camera mirror selfie, soft EVEN warm natural daylight from the side window, faint phone-camera softness and natural grain in shadows, completely UNEDITED authentic look — NO beauty filter, NO airbrush, NO smoothing, NO Instagram filter, NO portrait-mode bokeh, NO HDR. NO text, NO logos, NO watermarks, NO UI overlays. Faint everyday smudges on the mirror surface.',
].join('\n');

async function main() {
  await loadEnv();
  const key = process.env.FAL_KEY;
  if (!key) throw new Error('FAL_KEY missing in system/.env');

  if (!await fs.stat(FACE_REF).catch(() => null)) {
    throw new Error(`face_ref_synth.png missing at ${FACE_REF}`);
  }

  // ── Step 1: environment.jpg ──────────────────────────────────────────────
  console.log('[1/2] Building environment.jpg (empty bedroom, Flux Pro Ultra)…');
  const t1 = Date.now();
  const envUrl = await callFluxUltra({ prompt: ENVIRONMENT_PROMPT, aspectRatio: '9:16' }, key);
  await downloadTo(envUrl, ENV_OUT);
  console.log(`  ✓ ${ENV_OUT}  (${((Date.now() - t1) / 1000).toFixed(1)}s)\n`);

  // ── Step 2: model.jpg ────────────────────────────────────────────────────
  console.log('[2/2] Building model.jpg (v3 persona in bedroom, Seedream Edit)…');
  const t2 = Date.now();
  const [faceUrl, envRefUrl] = await Promise.all([
    uploadToFal(FACE_REF, key),
    uploadToFal(ENV_OUT, key),
  ]);
  const modelUrl = await callSeedream({
    prompt: MODEL_PROMPT,
    imageUrls: [faceUrl, envRefUrl],
    imageSize: { width: 1024, height: 1536 },
  }, key);
  await downloadTo(modelUrl, MODEL_OUT);
  console.log(`  ✓ ${MODEL_OUT}  (${((Date.now() - t2) / 1000).toFixed(1)}s)\n`);

  console.log('Done. Anchors ready.');
  console.log('  environment.jpg → flatlay setting + model anchor base');
  console.log('  model.jpg       → master mirror-selfie persona for all listings');
}

main().catch(err => { console.error('FAIL:', err.message); process.exit(1); });
