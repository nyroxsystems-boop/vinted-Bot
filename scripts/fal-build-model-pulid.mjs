#!/usr/bin/env node
// Generiert Model-Anchor mit fal-ai/flux-pulid (face-identity preservation).
//
// Vorteil gegenüber Seedream Edit: PuLID lockt das Gesicht aus dem Reference-Bild
// 1:1 ein, ohne Seedream's "Insta-Glamour-Stylization" (duck face, plump lips,
// heavy lashes). Body + Outfit + Setting kommen rein aus dem Prompt.
//
// Body diesmal explizit SCHLANK-ATHLETIC (nicht thick/BBL).

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENV_PATH  = path.join(__dirname, '..', '.env');

const ANCHOR_DIR = '/Users/home/Vinted/_anchors';
const FACE_1     = path.join(ANCHOR_DIR, 'face_ref_1.png');

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

async function callPuLID({ prompt, faceUrl }, key) {
  const res = await fetchWithRetry('https://fal.run/fal-ai/flux-pulid', {
    method: 'POST',
    headers: { Authorization: `Key ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt,
      reference_image_url: faceUrl,
      image_size: 'portrait_16_9',
      num_inference_steps: 20,
      guidance_scale: 4,
      negative_prompt: 'thick body, BBL, augmented, plastic surgery, lip filler, fake lips, pouty lips, duck face, oversized hips, overweight, exaggerated curves, fitness influencer with implants, body builder, muscle, heavy makeup, glamour makeup, instagram filter, beauty filter, airbrushed, plastic doll skin, fake tan, orange tan, anorexic, skinny',
      true_cfg: 1,
      id_weight: 1,
      max_sequence_length: '128',
      enable_safety_checker: false,
      output_format: 'jpeg',
      num_images: 1,
    }),
  });
  if (!res.ok) throw new Error(`fal pulid ${res.status}: ${await res.text()}`);
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

async function main() {
  await loadEnv();
  const key = process.env.FAL_KEY;
  if (!key) throw new Error('FAL_KEY missing');
  if (!await fs.stat(FACE_1).catch(() => null)) throw new Error(`missing: ${FACE_1}`);

  const numImages = parseInt(process.argv[2] || '4', 10);

  console.log('Uploading face reference…');
  const faceUrl = await uploadToFal(FACE_1, key);

  // Lean prompt — body is SLIM-ATHLETIC, NOT thick. Face is NATURAL, not stylized.
  const prompt = [
    'Full-body iPhone mirror selfie of a real 21-year-old blonde gym-girl in her bedroom.',
    'BODY — slim natural gym-girl figure: she is SLIM and toned, NOT thick, NOT BBL, NOT augmented, NOT muscular. Real lean athletic build from regular Pilates and gym work. Cinched narrow waist, naturally firm round perky butt (real shape from squats, NOT oversized), naturally full soft natural B-cup to small-C-cup bust (real, NOT augmented, NOT enhanced), toned slim legs with a soft inner-thigh gap, fit narrow shoulders. The kind of body real fit Instagram girls have — slim with subtle feminine curves where it counts, NOT a fitness influencer with surgery. Imagine a slim Alo-Yoga-model / Pilates-girl body — clean lines, light frame, just naturally pretty curves.',
    'FACE — exactly the face from the reference image: soft natural pretty 21-year-old face, fresh skin, light natural minimal makeup (subtle blush, light pink glossy lip, mascara only, NO heavy lashes, NO lip filler, NO contour). Lips are her own natural lips — relaxed soft mouth, NOT pouty, NOT duck face, NOT plump, just a natural relaxed expression. Bright soft hazel-blue eyes, clear and real. Soft rounded cheeks (still has youthful soft cheek fullness). Skin: clean, smooth, natural light sun-kissed tan, real youthful texture, not airbrushed.',
    'HAIR — exactly like the reference: long thick wavy blonde balayage with cool ash silver lowlights and lighter blonde top, mittelscheitel/center-parted, slightly tousled lived-in waves, falling past her shoulders to mid-back.',
    'OUTFIT: fitted plain white ribbed crop tank top showing midriff, fitted plain white high-waisted ribbed biker shorts ending mid-thigh, white ankle socks, clean white chunky sneakers. Plain casual gym aesthetic, no logos.',
    'POSE: standing relaxed and confidently in front of the mirror, soft natural hip pop with weight on her right leg, left knee slightly soft. Free left hand resting at her side. Holding a normal-sized iPhone with a hot pink solid silicone case in her right hand at chest height — phone is small and proportional to her hand, partially covering ONLY her chin and mouth area, her eyes and forehead are fully visible above the phone.',
    'SETTING: bedroom with warm golden-oak herringbone parquet floor, white panelled door, white wardrobe, lived-in cozy feel.',
    'STYLE: soft even natural daylight, slightly warm. Authentic candid iPhone mirror selfie, slightly soft front-camera quality, completely unedited and unfiltered, no beauty filter, no airbrushing, no portrait-mode bokeh, no glamour styling. Vertical 9:16 full-body composition with her feet and sneakers visible at the bottom of the frame.',
  ].join(' ');

  console.log(`Generating ${numImages} variants via flux-pulid (sequential)…`);
  const t0 = Date.now();
  const outs = [];
  for (let i = 0; i < numImages; i++) {
    console.log(`  v${i + 1}…`);
    const url = await callPuLID({ prompt, faceUrl }, key);
    const out = path.join(ANCHOR_DIR, `model_pulid_v${i + 1}.jpg`);
    await downloadTo(url, out);
    outs.push(out);
    console.log(`  ✓ ${out}`);
  }
  console.log(`\nDone in ${((Date.now() - t0) / 1000).toFixed(1)}s. Pick the best.`);
}

main().catch(err => { console.error('FAIL:', err.message); process.exit(1); });
