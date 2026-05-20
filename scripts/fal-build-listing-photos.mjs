#!/usr/bin/env node
// Generiert die 5 Vinted-Listing-Fotos pro Produkt.
//
// Master-Anchors (lock identity + setting across ALL listings):
//   _anchors/model.jpg         — v3-Persona als Mirror-Selfie in der Bedroom (Tank+Shorts)
//   _anchors/environment.jpg   — leere Bedroom für Flatlays
//
// Inputs:
//   <product-folder>/<source-images>   (CJ-Produktbilder — image 1 = Front, image 3 = Back falls vorhanden)
//
// Output (Naming wie in listing.json):
//   <product-folder>/generated/1_front.jpg          — Mirror selfie frontal, hand-in-hair
//   <product-folder>/generated/2_side.jpg           — Mirror selfie 3/4 angle, hand-on-hip, looking-down-at-phone
//   <product-folder>/generated/3_back.jpg           — Mirror selfie back-over-shoulder
//   <product-folder>/generated/4_selfie_detail.jpg  — Cropped waist-up close-up mirror selfie
//   <product-folder>/generated/5_flatlay.jpg        — Top-down garment on parquet, no model
//
// Architektur:
//   Mirror shots:  [model.jpg, productFront]        → Outfit-Swap auf Anchor-Persona+Bedroom
//   Flatlay:       [productFront, environment.jpg]  → Garment auf Anchor-Parquet
//
// Endpoint: fal-ai/bytedance/seedream/v4/edit
// Usage:    node fal-build-listing-photos.mjs <product-folder>

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENV_PATH = path.join(__dirname, '..', '.env');
const ANCHOR_DIR = '/Users/home/Vinted/_anchors';
const MODEL_ANCHOR = path.join(ANCHOR_DIR, 'model.jpg');
const ENV_ANCHOR = path.join(ANCHOR_DIR, 'environment.jpg');

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

// ── Building blocks (locked constants) ──────────────────────────────────────

const IDENTITY = `IDENTITY-LOCK: this is the EXACT SAME WOMAN as in image 1 — match her face, hair, body, skin and proportions precisely from image 1. Do not regenerate the face. She is a 22-year-old fresh youthful European woman: long thick wavy balayage hair (darker brown roots fading into honey-blonde lengths past shoulders, center-parted, slightly tousled), large soft hazel-green almond eyes, soft full natural lips with subtle pink gloss, soft rounded youthful cheeks, small straight nose, defined naturally groomed brows, minimal natural makeup. Slim petite athletic figure with pronounced hourglass curves: very lean toned shoulders and arms, sharply pinched tiny waist, full naturally rounded hips and glutes (real shape from squats — feminine, NOT BBL), lean thighs with thigh gap, full natural firm chest creating clear hourglass contrast (full natural C cup, real). Lightly tanned glowing Mediterranean skin.`;

const ROOM_LOCK = `BEDROOM-LOCK: KEEP the exact bedroom from image 1 — large ornate gold-framed full-length arched mirror leaning against off-white walls, dark warm-brown herringbone parquet wood floor, soft warm natural daylight from a tall window on the left, glimpse of an unmade white bed with white linen visible to the right inside the reflection. NEVER change the room, NEVER add carpet, NEVER add furniture, NEVER change the parquet color, NEVER replace the mirror. The output keeps the same gold-framed arched mirror visible at the edges of the frame as in image 1.`;

const PHONE_LOCK = `PHONE — STRICTLY NORMAL iPHONE SIZE (this is the most common AI failure — pay attention): she holds a real iPhone with a hot pink solid silicone case in ONE hand. The phone is REALISTIC SIZE — roughly as wide as her palm, no taller than chin to forehead, smaller than her face, NEVER oversized, NEVER tablet-sized. iPhone proportions are taller than wide (~2.1:1) with a visible camera bump in the upper-left corner of the back. Her face stays clearly visible above and around the phone — eyes, brows, nose, lips all readable. HAND GRIP: exactly four fingers wrapped naturally around the back-left edge of the phone, thumb on the screen. Fingers slim, natural, with one or two simple subtle gold rings only.`;

const GARMENT_SWAP = `OUTFIT-SWAP: completely replace the white ribbed tank top, white biker shorts and white socks of image 1 with the EXACT garment from image 2. Match the garment 1:1 from image 2: color (NO recoloring, no warmer/cooler shift, exact same hue and saturation), fabric type and finish (matte/satin/ribbed/chiffon/knit — exact), cut and length (mini stays mini, midi stays midi, maxi stays maxi — DO NOT shorten or lengthen), sleeve length and style (short stays short, long stays long, cap-sleeve stays cap-sleeve, sleeveless stays sleeveless), neckline shape (crew/V/square/halter/wrap — exact, NO cleavage modification, NO neckline deepening), waist detail (elastic/belted/seamed/loose), hem shape, any pleats, ruffles, prints, patterns (1:1), buttons, zippers, cut-outs, ties. The garment hangs naturally on her curvy body with realistic small natural wrinkles where fabric meets her waist and hips. Ignore the model and background of image 2 — copy ONLY the garment itself. Footwear stays as the white tube ankle socks visible in image 1 (no shoes), unless the garment requires otherwise.`;

const AUTH = `STYLE: real candid mirror selfie taken on iPhone front camera by an off-duty pretty girl in her own bedroom — NOT a fashion shoot, NOT a studio model, NOT a catalog photo. Soft EVEN natural daylight from the side window, slightly warm — gentle ambient light, not dramatic. NO harsh direct sun beams, NO blown-out window stripes across her body, NO heavy shadows, NO sculptural studio lighting. Faint iPhone-front-camera softness (slightly soft, NOT DSLR-sharp), subtle phone-sensor grain in shadow areas, mild JPEG compression. The mirror surface has very faint everyday smudges. Completely UNEDITED authentic look — NO beauty filter, NO airbrush, NO smoothing, NO Instagram filter, NO color grading, NO portrait-mode bokeh, NO HDR halos. NO text, NO logos, NO watermarks, NO UI overlays, NO time/battery indicators.`;

const NO_FRAME_NOTE = `MIRROR FRAME: keep the gold mirror frame visible at the edges of the photo as in image 1 — this is a real mirror selfie, the gold frame is part of the natural composition. Do NOT crop it out, do NOT replace it.`;

// ── Shots: each one MUST be visibly distinct in pose, gesture, expression, camera angle ──

const SHOTS = [
  {
    name: '1_front',
    type: 'mirror',
    imageSize: { width: 1024, height: 1536 },
    promptCore: [
      'Authentic Vinted listing photo — full-body MIRROR SELFIE, frontal view. Image 1 = the woman in her bedroom; image 2 = the garment to wear.',
      'COMPOSITION: full-body shot from top of head to socked feet, vertical 9:16 frame, breathing room above head and below feet. Positioned slightly LEFT of center inside the mirror.',
      'POSE — UNIQUE TO THIS SHOT: body facing the camera close to straight on with a soft natural hip pop to her RIGHT (weight on her RIGHT leg, LEFT knee soft and slightly inward). The garment\'s waist line clearly visible.',
      'GESTURE — UNIQUE TO THIS SHOT: free LEFT hand reaches UP into her hair, fingers loosely pushing some strands behind her left ear or near her temple. iPhone held in her RIGHT hand at chest height (normal phone size).',
      'EXPRESSION — UNIQUE TO THIS SHOT: soft neutral relaxed, lips slightly parted (no big smile), eyes looking softly AT the camera reflection.',
      'CAMERA ANGLE — UNIQUE TO THIS SHOT: phone held at chest height, slightly upward angle from chest level — standard frontal mirror selfie geometry.',
    ],
  },
  {
    name: '2_side',
    type: 'mirror',
    imageSize: { width: 1024, height: 1536 },
    promptCore: [
      'Authentic Vinted listing photo — full-body MIRROR SELFIE, 3/4 side angle revealing her side silhouette. Image 1 = the woman in her bedroom; image 2 = the garment to wear.',
      'COMPOSITION: full-body shot, vertical 9:16. Positioned slightly RIGHT of center inside the mirror. Body fills slightly more of the frame than shot 1_front.',
      'POSE — UNIQUE TO THIS SHOT: body rotated about 60 DEGREES to her LEFT — strong 3/4 angle so her side silhouette and waist-to-hip curve are the visual anchor of this photo. NOT flat front, NOT 90° profile. Strong natural S-curve: weight on her LEFT (back) leg, RIGHT leg slightly bent and forward, hips pushed out to her left.',
      'GESTURE — UNIQUE TO THIS SHOT: LEFT hand on her LEFT hip with elbow popped out, fingers natural at the hipbone. iPhone held in her RIGHT hand at LOWER-CHEST height (notably lower than shot 1_front).',
      'EXPRESSION — UNIQUE TO THIS SHOT: focused, eyes looking DOWN at the phone screen (NOT at the camera). Hair falling forward over her RIGHT shoulder partially over her right collarbone.',
      'CAMERA ANGLE — UNIQUE TO THIS SHOT: phone held lower-chest, downward angle — different geometry from shot 1_front.',
      'VARIATION CHECK: must read clearly different from 1_front — different body rotation, different hand placement, different gaze direction, different phone height.',
    ],
  },
  {
    name: '3_back',
    type: 'mirror',
    imageSize: { width: 1024, height: 1536 },
    promptCore: [
      'Authentic Vinted listing photo — full-body MIRROR SELFIE FROM BEHIND, looking back over shoulder. Image 1 = the woman in her bedroom; image 2 = the garment to wear.',
      'COMPOSITION: full-body shot, vertical 9:16. Camera angle slightly tilted because she is twisting her torso to look back.',
      'POSE — UNIQUE TO THIS SHOT: her BACK is turned to the camera so the BACK of the garment is fully visible from shoulders to hem (back fabric, any zipper/cut-out/button-row/bow/back-detail must read clearly). She twists her UPPER torso gently to look over her RIGHT shoulder back into the mirror — face partially visible at 3/4 back angle. Soft hip pop to her LEFT, weight on LEFT leg.',
      'GESTURE — UNIQUE TO THIS SHOT: long blonde hair pulled to her LEFT side falling over left shoulder (leaving the entire back of the garment unobstructed). iPhone held in her RIGHT hand UP near her right ear / just above her shoulder. LEFT hand resting softly at her side.',
      'EXPRESSION — UNIQUE TO THIS SHOT: soft glance back over shoulder, subtle hint of a smile, eyes meeting the camera reflection through the corner of her eye. Different feel from shots 1 and 2.',
      'CAMERA ANGLE — UNIQUE TO THIS SHOT: phone held HIGH (near head/ear level), shoulders-twist angle — completely different geometry from shots 1 and 2.',
      'VARIATION CHECK: must read clearly different from 1_front and 2_side — back of garment must be the visual anchor, gaze comes over shoulder, phone held high.',
    ],
  },
  {
    name: '4_selfie_detail',
    type: 'mirror',
    imageSize: { width: 1024, height: 1280 },
    promptCore: [
      'Authentic Vinted listing photo — CROPPED WAIST-UP close-up MIRROR SELFIE focusing on the garment\'s neckline, sleeves and upper-body fit detail. Image 1 = the woman in her bedroom; image 2 = the garment to wear.',
      'COMPOSITION: cropped close-up from approximately mid-thigh / waist UP to a few cm above her head. Vertical 4:5. The crop is the key differentiator — feet and lower body are NOT in frame.',
      'POSE — UNIQUE TO THIS SHOT: standing relaxed nearly facing the mirror with a very slight torso lean toward the camera. Different stance from shots 1, 2, 3 — much more relaxed and casual upper-body, no exaggerated hip pop.',
      'GESTURE — UNIQUE TO THIS SHOT: iPhone held HIGHER than other shots — in her RIGHT hand at face/forehead height (typical Instagram close-up selfie geometry). LEFT hand resting LOWER, lightly touching her own collarbone or the neckline of the garment to draw the eye to the neckline detail.',
      'EXPRESSION — UNIQUE TO THIS SHOT: small playful natural smile (slight lip corner lift, NOT teeth-showing big grin), head tilted very slightly. Eyes looking softly UP toward the camera. Warmer feel than shots 1-3.',
      'CAMERA ANGLE — UNIQUE TO THIS SHOT: phone held HIGH at face level, slight downward angle looking down at her upper body — completely different geometry from shots 1, 2, 3 (which had phone at chest or shoulder height).',
      'VARIATION CHECK: must read clearly different from 1, 2, 3 — cropped not full-body, phone at face level not chest, soft smile not neutral, hand at neckline not in hair / on hip / behind.',
    ],
  },
  {
    name: '5_flatlay',
    type: 'flatlay',
    imageSize: { width: 1024, height: 1280 },
    promptCore: [
      'Top-down phone snapshot of the garment from image 1, laid flat on the SAME warm dark herringbone parquet wood floor visible in image 2 (the bedroom floor). The floor MUST match image 2 — same dark warm-brown medium-toned oak herringbone pattern direction. NOT light oak, NOT walnut, NOT cherry — match image 2 exactly.',
      'GARMENT (from image 1): preserve the EXACT color, fabric, cut, neckline, sleeve length, hem length, pleats, prints and pattern. Spread out so the full silhouette is readable. Sleeves arranged outward at natural angles, neckline visible at top, hem at bottom. Realistic small fabric wrinkles and natural folds.',
      'COMPOSITION: garment centered in frame, photographed straight from above (90° top-down). NO furniture, NO door, NO walls, NO objects, NO foot, NO sock, NO hand, NO model — just the garment alone on the parquet.',
      'LIGHT: soft EVEN ambient indoor daylight — gentle, realistic, slightly diffuse, matching image 2. NO harsh sun stripes, NO blown-out highlights, NO dramatic shadows.',
      'STYLE: real iPhone phone snapshot — slight phone-camera grain, slightly soft, unedited. NO text, NO logos, NO watermarks.',
    ],
  },
];

// Mirror shots vs flatlay use different anchor pairs:
//   mirror   refs: [model.jpg, productFront]
//   flatlay  refs: [productFront, environment.jpg]

function buildMirrorPrompt(shot) {
  return [
    ...shot.promptCore,
    IDENTITY,
    ROOM_LOCK,
    PHONE_LOCK,
    GARMENT_SWAP,
    NO_FRAME_NOTE,
    AUTH,
  ].join('\n\n');
}

function buildFlatlayPrompt(shot) {
  return shot.promptCore.join('\n\n');
}

async function pickProductImages(productFolder) {
  const files = (await fs.readdir(productFolder))
    .filter(f => /^\d_.*\.(jpg|jpeg|png|webp)$/i.test(f))
    .sort();
  if (files.length === 0) throw new Error(`No source images in ${productFolder}`);
  return path.join(productFolder, files[0]);
}

async function main() {
  await loadEnv();
  const key = process.env.FAL_KEY;
  if (!key) throw new Error('FAL_KEY missing in system/.env');

  for (const a of [MODEL_ANCHOR, ENV_ANCHOR]) {
    if (!await fs.stat(a).catch(() => null)) {
      throw new Error(`Anchor missing: ${a} — run fal-build-anchors-synth.mjs first`);
    }
  }

  const productFolder = process.argv[2];
  if (!productFolder) throw new Error('Usage: node fal-build-listing-photos.mjs <product-folder>');

  const productFront = await pickProductImages(productFolder);
  const outDir = path.join(productFolder, 'generated');
  await fs.mkdir(outDir, { recursive: true });

  console.log(`Product:    ${path.basename(productFolder)}`);
  console.log(`Anchors:    model.jpg, environment.jpg`);
  console.log(`Product:    ${path.basename(productFront)}\n`);

  console.log('Uploading anchors + product reference…');
  const [modelUrl, envUrl, productUrl] = await Promise.all([
    uploadToFal(MODEL_ANCHOR, key),
    uploadToFal(ENV_ANCHOR, key),
    uploadToFal(productFront, key),
  ]);
  console.log('  ✓ uploaded\n');

  console.log(`Generating ${SHOTS.length} listing shots in parallel…`);
  const t0 = Date.now();

  const tasks = SHOTS.map(async shot => {
    const tStart = Date.now();
    try {
      const prompt = shot.type === 'mirror' ? buildMirrorPrompt(shot) : buildFlatlayPrompt(shot);
      const imageUrls = shot.type === 'mirror'
        ? [modelUrl, productUrl]
        : [productUrl, envUrl];
      const url = await callSeedream({
        prompt,
        imageUrls,
        imageSize: shot.imageSize,
      }, key);
      const out = path.join(outDir, `${shot.name}.jpg`);
      await downloadTo(url, out);
      const dt = ((Date.now() - tStart) / 1000).toFixed(1);
      console.log(`  ✓ ${shot.name}.jpg  (${dt}s)`);
      return { ok: true, name: shot.name };
    } catch (err) {
      console.log(`  ✗ ${shot.name} FAILED: ${err.message}`);
      return { ok: false, name: shot.name, error: err.message };
    }
  });

  const results = await Promise.all(tasks);
  const ok = results.filter(r => r.ok).length;
  const dt = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`\nDone in ${dt}s: ${ok}/${SHOTS.length} ok`);
  console.log(`Outputs: ${outDir}`);
  if (ok < SHOTS.length) process.exit(2);
}

main().catch(err => { console.error('FAIL:', err.message); process.exit(1); });
