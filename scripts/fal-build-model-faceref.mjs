#!/usr/bin/env node
// Generiert den finalen Model-Anchor durch Face-Transfer:
//   • image 1 = face_ref_1.png (echte Frau aus Auto-Foto — face/hair/eyes target)
//   • image 2 = face_ref_2.png (zweite Ansicht derselben Frau — face robustness)
//   • image 3 = model_flux_v4.jpg (curvy body, white outfit, mirror-selfie pose target)
//
// Ziel: das EXAKTE Gesicht aus image 1+2 auf den Körper/Outfit/Pose von image 3.
// Endpoint: fal-ai/bytedance/seedream/v4/edit (multi-image composition).
//
// Generiert N Varianten (default 4), User wählt beste.
// Output: /Users/home/Vinted/_anchors/model_final_v{1..N}.jpg

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENV_PATH  = path.join(__dirname, '..', '.env');

const ANCHOR_DIR = '/Users/home/Vinted/_anchors';
const FACE_1 = path.join(ANCHOR_DIR, 'face_ref_1.png');
const FACE_2 = path.join(ANCHOR_DIR, 'face_ref_2.png');
const BODY   = path.join(ANCHOR_DIR, 'model_flux_v4.jpg');

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
      const res = await fetch(url, opts);
      return res;
    } catch (err) {
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

async function callSeedream({ prompt, imageUrls, imageSize, numImages = 1 }, key) {
  const res = await fetchWithRetry('https://fal.run/fal-ai/bytedance/seedream/v4/edit', {
    method: 'POST',
    headers: { Authorization: `Key ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt,
      image_urls: imageUrls,
      image_size: imageSize,
      num_images: numImages,
      max_images: numImages,
      enable_safety_checker: false,
    }),
  });
  if (!res.ok) throw new Error(`fal seedream ${res.status}: ${await res.text()}`);
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
  if (!key) throw new Error('FAL_KEY missing');

  for (const f of [FACE_1, FACE_2, BODY]) {
    if (!await fs.stat(f).catch(() => null)) throw new Error(`missing: ${f}`);
  }

  const numImages = parseInt(process.argv[2] || '4', 10);

  console.log(`Uploading 3 reference images…`);
  const [face1Url, face2Url, bodyUrl] = await Promise.all([
    uploadToFal(FACE_1, key),
    uploadToFal(FACE_2, key),
    uploadToFal(BODY, key),
  ]);

  const prompt = [
    'Generate a full-body iPhone mirror-selfie of a real 21-year-old slim gym-girl.',
    '',
    'FACE — must be the EXACT same girl as in image 1 and image 2 (those are reference photos of the same girl in her car). Copy her face precisely: same face shape, same bright hazel-blue eyes, same eye shape (large soft almond), same small straight nose, same NATURAL relaxed soft lips with subtle pink lip gloss (NOT pouty, NOT plump, NOT duck face, NOT a kissy mouth — just her real natural mouth, slightly relaxed or with a tiny soft smile), same soft rounded youthful cheeks, same eyebrow shape, same fresh natural minimal makeup (subtle blush, mascara, glossy lip — that is all). She must look like the EXACT girl in image 1 and 2 — recognizable as her, NOT glamorized, NOT stylized, NOT a different prettier woman. Soft natural relaxed expression — she is NOT posing for a magazine.',
    '',
    'HAIR — match image 1 and 2: long thick wavy blonde balayage with cool ash/silver lowlights and lighter blonde top, mittelscheitel/center-parted, slightly tousled lived-in waves, falling past her shoulders to mid-back, healthy and shiny.',
    '',
    'BODY — slim natural gym-girl figure (this is critical — she is SLIM, NOT thick, NOT BBL). Imagine a real Pilates / Alo Yoga / Lululemon model body: slim slender frame, slim narrow hips (NOT wide, NOT full), small cinched waist, naturally firm small round perky butt (real shape from squats, NOT augmented, NOT oversized, NOT BBL), small natural soft B-cup bust (real, NOT enhanced), long lean toned legs with a clear gap at the inner thigh — her thighs do NOT touch each other and are NOT thick. She is light, slim, athletic — like a real young fit girl, NOT a fitness influencer with implants. Soft delicate feminine lines, NOT exaggerated curves.',
    '',
    'OUTFIT, POSE, SETTING — copy from image 3: fitted plain white ribbed crop tank top, fitted plain white high-waisted ribbed biker shorts, white ankle socks, white chunky sneakers. Standing mirror-selfie pose with soft natural hip pop (weight on right leg, left knee slightly bent inward), free left hand resting at her side, holding a normal-sized iPhone with hot pink solid silicone case in her right hand at chest height (phone is small, partially covering only her chin/mouth, eyes and forehead clearly visible above the phone). Bedroom with warm golden-oak herringbone parquet floor, white panelled door, white wardrobe, lived-in cozy feel. Vertical 9:16 full-body composition with feet visible at the bottom of the frame.',
    '',
    'The whole image IS the mirror reflection — no visible mirror frame, edge-to-edge.',
    '',
    'Style: candid authentic real iPhone mirror selfie, slightly soft front-camera quality, completely unedited, NO beauty filter, NO airbrushing, NO portrait-mode bokeh, NO glamour styling, NO heavy contour, NO heavy lashes, NO lip filler look. NO text, NO logos, NO watermarks, NO UI overlays. She looks like a normal pretty real girl, NOT an Instagram influencer.',
  ].join('\n');

  console.log(`Generating ${numImages} variants via Seedream v4 Edit…`);
  const t0 = Date.now();
  const urls = await callSeedream({
    prompt,
    imageUrls: [face1Url, face2Url, bodyUrl],
    imageSize: { width: 1024, height: 1536 },
    numImages,
  }, key);
  console.log(`Got ${urls.length} variants in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  const outs = [];
  for (let i = 0; i < urls.length; i++) {
    const out = path.join(ANCHOR_DIR, `model_final_v${i + 1}.jpg`);
    await downloadTo(urls[i], out);
    console.log(`  ✓ ${out}`);
    outs.push(out);
  }
  console.log(`\nDone. Pick the best.`);
}

main().catch(err => { console.error('FAIL:', err.message); process.exit(1); });
