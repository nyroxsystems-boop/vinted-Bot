#!/usr/bin/env node
// Test-Script: 5 Vinted-Listing-Bilder via fal.ai Seedream 4 Edit.
//
// 5 Shot-Typen:
//   1_front       — Mirror Selfie, frontal
//   2_side        — Mirror Selfie, Seite (S-Kurve, andere Distanz/Hand)
//   3_back        — Mirror Selfie, Rücken über Schulter
//   4_flatlay_fr  — Produkt flach von vorne
//   5_flatlay_bk  — Produkt flach von hinten
//
// Architektur:
//   Mirror shots:  [MODEL, product]              → Outfit-Swap auf Anchor-Frau
//   Flatlays:      [product, ENVIRONMENT]        → Produkt auf Anchor-Boden

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENV_PATH = path.join(__dirname, '..', '.env');

async function loadEnv() {
  const raw = await fs.readFile(ENV_PATH, 'utf8');
  for (const line of raw.split('\n')) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

const ANCHOR_DIR  = '/Users/home/Vinted/_anchors';
const MODEL       = path.join(ANCHOR_DIR, 'model.jpg');
const ENVIRONMENT = path.join(ANCHOR_DIR, 'environment.jpg');

async function fetchWithRetry(url, opts = {}, retries = 3) {
  let lastErr;
  for (let i = 0; i < retries; i++) {
    try {
      return await fetch(url, opts);
    } catch (err) {
      lastErr = err;
      if (i < retries - 1) await new Promise(r => setTimeout(r, 2000 * (i + 1)));
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

async function callSeedream({ prompt, imageUrls, imageSize = { width: 1024, height: 1536 } }, key) {
  const endpoint = process.env.FAL_MODEL_ENDPOINT || 'fal-ai/bytedance/seedream/v4/edit';
  const res = await fetchWithRetry(`https://fal.run/${endpoint}`, {
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
  if (!res.ok) throw new Error(`fal seedream ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const url = data?.images?.[0]?.url;
  if (!url) throw new Error(`No image in response: ${JSON.stringify(data).slice(0, 400)}`);
  return url;
}

async function downloadTo(url, outPath) {
  const res = await fetchWithRetry(url);
  if (!res.ok) throw new Error(`download ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await fs.writeFile(outPath, buf);
}

const uploadCache = new Map();
async function uploadCached(filePath, key) {
  if (uploadCache.has(filePath)) return uploadCache.get(filePath);
  const url = await uploadToFal(filePath, key);
  uploadCache.set(filePath, url);
  return url;
}

async function generateOne({ name, prompt, refs, imageSize, productFolder, key }) {
  console.log(`→ ${name}`);
  const t0 = Date.now();
  const imageUrls = [];
  for (const r of refs) imageUrls.push(await uploadCached(r, key));
  const resultUrl = await callSeedream({ prompt, imageUrls, imageSize }, key);
  const outPath = path.join(productFolder, 'generated', `${name}.jpg`);
  await downloadTo(resultUrl, outPath);
  console.log(`  ✓ ${path.basename(outPath)}  (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  return outPath;
}

async function main() {
  await loadEnv();
  const key = process.env.FAL_KEY;
  if (!key) throw new Error('FAL_KEY missing in .env');
  for (const a of [MODEL, ENVIRONMENT]) {
    if (!await fs.stat(a).catch(() => null)) throw new Error(`anchor missing: ${a}`);
  }

  const productFolder = process.argv[2];
  if (!productFolder) throw new Error('Usage: node fal-vinted-test.mjs <product-folder>');

  const generatedDir = path.join(productFolder, 'generated');
  await fs.mkdir(generatedDir, { recursive: true });

  const entries = (await fs.readdir(productFolder)).filter(f => /\.(jpe?g|png|webp)$/i.test(f)).sort();
  if (entries.length === 0) throw new Error(`No source images in ${productFolder}`);
  const productFront = path.join(productFolder, entries[0]);
  // CJ convention: image 1 = front, image 2 = sitting/detail, image 3 = back.
  // If 3+ images exist prefer index 2 (real back view); otherwise fall back.
  const backIdx = entries.length >= 3 ? 2 : Math.min(1, entries.length - 1);
  const productBack = path.join(productFolder, entries[backIdx]);

  console.log(`Product: ${path.basename(productFolder)}`);
  console.log(`Anchor:  ${path.basename(MODEL)}, ${path.basename(ENVIRONMENT)}`);
  console.log(`Front:   ${path.basename(productFront)}`);
  console.log(`Back:    ${path.basename(productBack)}\n`);

  // ── Building blocks ────────────────────────────────────────────────────────

  const WOMAN = [
    'IDENTITY-LOCK: this is the EXACT SAME WOMAN as in image 1 — match her face, hair, body and skin precisely from image 1. Do not regenerate the face. She is a 22-year-old fresh youthful it-girl with a scroll-stopping pretty face: large doe almond eyes, soft full natural lips with a subtle pink tint, soft rounded cheekbones, a soft feminine jawline, a small straight nose, thick well-shaped brows, very minimal natural no-makeup-makeup look (subtle blush, glossy lip, mascara). Long thick voluminous blonde balayage waves past her shoulders, slightly tousled. Naturally sun-kissed glowing tan skin.',
    'SKIN TEXTURE: clean fresh youthful skin with subtle natural softness — must read like a REAL young woman, not airbrushed plastic doll skin and not stippled-acne dots. Smooth even tan tone. NO freckles, NO pimples, NO stippled red dots, NO pigmentation patches, NO blemishes, NO wrinkles, NO smile lines, NO crow\'s feet. Just naturally beautiful, healthy, sun-kissed skin with realistic but very subtle pore softness.',
  ].join(' ');

  const CURVES = 'BODY — must look STUNNING and CURVY (critical for the product to sell): pronounced feminine hourglass silhouette — clearly cinched narrow waist, naturally full round hips noticeably wider than her ribcage, a soft natural full bust proportional to her frame, toned thighs with a clear inner-thigh gap, fit shoulders, long legs. Curvy AND athletic at once — like a young Instagram fitness it-girl (Sommer Ray / Anastasia Karanikolaou aesthetic). Sexy yet young, fresh and natural — never plastic, never bimbo, never overdone. The garment must hang on a body that clearly shows these curves.';

  const ROOM = 'KEEP THE SAME BEDROOM FROM IMAGE 1: warm medium-toned golden oak herringbone parquet wood floor, white panelled door, white IKEA wardrobe with hanging clothes visible, white IKEA chest of drawers, lived-in cozy feel. NEVER change the room, NEVER add carpet, NEVER add furniture not in image 1.';

  const NO_FRAME = 'NO MIRROR FRAME: the entire image IS the mirror reflection — no visible mirror frame, no black border, no rim around the photo. The image fills the frame edge-to-edge as if the photo itself is what the mirror shows. Do NOT draw any mirror frame, border, or rim around the image.';

  const PHONE_NORMAL = 'PHONE — STRICTLY NORMAL iPHONE SIZE (this is the most common AI failure — pay attention): she holds a real iPhone with a pink silicone case in ONE hand. The phone is REALISTIC SIZE: roughly as wide as her palm, no taller than from her chin to her forehead, smaller than her face — NEVER oversized, NEVER tablet-sized, NEVER taking up more than ~15% of the image area. iPhone proportions are taller than wide (~2.1:1), with a visible camera bump in the upper-left corner of the back. The phone is held at chest-to-chin height in front of her, not floating, not at face level blocking her features. Her face stays clearly visible above and around the phone — eyes, brows, nose, lips, jawline all readable. HAND GRIP: exactly four fingers wrapped naturally around the back-left edge of the phone (NOT five, NOT six, NOT three — exactly four), thumb resting on the screen. Fingers are slim, slightly curved, natural length, with one or two simple subtle gold rings only. Faint reflection of the bedroom and window visible on the phone\'s glass back.';

  const GARMENT = 'CHANGE HER OUTFIT: completely replace the white ribbed tank top, the white biker shorts and the chunky sneakers from image 1 with the EXACT garment from the product reference image. Match the garment 1:1: color (NO recoloring, no warmer/cooler shift, exact same hue and saturation), fabric type and finish (matte/satin/ribbed/chiffon/knit — exact), cut and length (mini stays mini, midi stays midi, maxi stays maxi — DO NOT shorten or lengthen), sleeve length and style (short stays short, long stays long, cap-sleeve stays cap-sleeve, sleeveless stays sleeveless), neckline shape (crew/V/square/halter/wrap — exact), waist detail (elastic/belted/seamed/loose), hem shape, any pleats or ruffles, any print or pattern (1:1), buttons, zippers, cut-outs, ties. The garment hangs naturally on her curvy body with realistic small natural wrinkles where fabric meets her waist and hips. Ignore the model and background of the product image — copy ONLY the garment itself.';

  const AUTH = 'STYLE: real candid mirror selfie taken on iPhone front camera by an off-duty pretty girl in her own bedroom — NOT a fashion shoot, NOT a studio model, NOT a catalog photo. Soft EVEN natural daylight from a side window, slightly warm — gentle ambient light, not dramatic. NO harsh direct sun beams, NO blown-out window stripes across her body, NO heavy shadows, NO sculptural studio lighting. Faint iPhone-front-camera softness (slightly soft, NOT DSLR-sharp), subtle phone-sensor grain in shadow areas, mild JPEG compression. The mirror surface has very faint everyday smudges. Completely UNEDITED authentic look — NO beauty filter, NO airbrush, NO smoothing, NO Instagram filter, NO color grading, NO portrait-mode bokeh, NO HDR halos, NO selective sharpening. White ankle socks visible if feet are in frame. NO text, NO logos, NO watermarks, NO UI overlays, NO time/battery indicators, NO captions.';

  const tasks = [
    {
      // Shot 1 — Front, classic, weight-on-right, hand-in-hair
      name: '1_front',
      refs: [MODEL, productFront],
      imageSize: { width: 1024, height: 1536 },
      prompt: [
        'Authentic Vinted listing — full-body MIRROR SELFIE, frontal view. Image 1 = woman in her bedroom; image 2 = the garment to wear.',
        WOMAN, CURVES, ROOM, GARMENT, NO_FRAME, PHONE_NORMAL,
        'COMPOSITION: full-body shot, she fills the vertical frame with a small bit of breathing room above her head and below her feet. Positioned slightly LEFT of center.',
        'POSE: body facing the camera close to straight on with a soft natural hip pop to her right (weight on her RIGHT leg, LEFT knee soft and slightly inward) — this hip pop is essential to show off her hourglass silhouette. The garment\'s waist line clearly visible. Free LEFT hand reaches up into her hair, fingers loosely pushing some strands behind her left ear or resting near her collarbone. iPhone held in her right hand at chest height (normal phone size — see PHONE rules above). Soft natural relaxed expression, lips slightly parted but no big smile, eyes looking softly at the camera reflection.',
        AUTH,
      ].join(' '),
    },
    {
      // Shot 2 — 3/4 angle, S-curve, hand-on-hip, looking-down-at-phone
      name: '2_side',
      refs: [MODEL, productFront],
      imageSize: { width: 1024, height: 1536 },
      prompt: [
        'Authentic Vinted listing — MIRROR SELFIE, 3/4 angle showing the side of the silhouette. Image 1 = woman in her bedroom; image 2 = the garment to wear.',
        WOMAN, CURVES, ROOM, GARMENT, NO_FRAME, PHONE_NORMAL,
        'COMPOSITION: full-body shot, body fills slightly more of the frame than shot 1. Positioned RIGHT of center.',
        'POSE: body rotated about 60 DEGREES to her LEFT — a strong 3/4 angle that reveals her side silhouette clearly (waist-to-hip curve must be the visual anchor of this photo). NOT a perfect 90° profile, NOT a flat front view. Strong natural S-curve: weight on her LEFT (back) leg, RIGHT leg slightly bent and forward, hips pushed out to her left. LEFT hand resting on her LEFT hip with elbow popped out, fingers natural. iPhone held in her right hand at lower-chest height (normal phone size). Gaze DOWN at the phone screen, hair falling forward over her right shoulder.',
        'VARIATION FROM SHOT 1: 3/4 angle (not flat front), free hand on hip (not in hair), phone held lower, looking down at the screen (not at the camera). The two photos must read clearly as different poses.',
        AUTH,
      ].join(' '),
    },
    {
      // Shot 3 — Back, looking over shoulder
      name: '3_back',
      refs: [MODEL, productFront],
      imageSize: { width: 1024, height: 1536 },
      prompt: [
        'Authentic Vinted listing — MIRROR SELFIE from behind. Image 1 = woman in her bedroom; image 2 = the garment to wear.',
        WOMAN, CURVES, ROOM, GARMENT, NO_FRAME, PHONE_NORMAL,
        'COMPOSITION: full-body shot, camera angle slightly tilted because she is twisting her torso to look back over her shoulder.',
        'POSE: her back is turned to the camera so the BACK of the garment is fully visible from shoulders to hem (the back fabric, any zipper, cut-out, button row, bow or back detail must read clearly). She twists her UPPER torso gently to look over her RIGHT shoulder back into the mirror — face is partially visible at a 3/4 back angle. Her long blonde hair is pulled to her LEFT side and falls over her left shoulder, leaving the entire back of the garment unobstructed. Soft hip pop to her left, weight on left leg. iPhone held in her right hand up near her right ear / just above her shoulder (normal phone size). LEFT hand rests softly at her side.',
        'VARIATION: completely different stance from shots 1 and 2. Back of garment must read clearly — that is the single most important purpose of this shot.',
        AUTH,
      ].join(' '),
    },
    {
      // Shot 4 — Flatlay FRONT, on bedroom floor, soft realistic light
      name: '4_flatlay_front',
      refs: [productFront, ENVIRONMENT],
      imageSize: { width: 1024, height: 1280 },
      prompt: [
        'Top-down phone snapshot of the garment from image 1, laid flat showing its FRONT side, on the SAME warm medium-toned golden oak herringbone parquet wood floor visible in image 2 (the bedroom floor). The floor MUST match image 2 — same medium oak/honey color, same herringbone pattern direction. NOT dark walnut, NOT cherry, NOT black wood — match image 2 exactly.',
        'GARMENT: preserve the EXACT color, fabric, cut, neckline, sleeves (short stays short, long stays long), length, pleats, prints and pattern of image 1. Spread out so the full silhouette is readable. Sleeves arranged outward at natural angles, neckline visible at top, hem at bottom. Realistic small fabric wrinkles and natural folds.',
        'COMPOSITION: garment centered in frame, photographed straight from above (90° top-down). NO furniture, NO door, NO walls, NO objects, NO foot, NO sock, NO hand — just the garment on the parquet.',
        'LIGHT: soft EVEN ambient indoor daylight — gentle, realistic, slightly diffuse. NO harsh sun stripes, NO blown-out highlights, NO dramatic shadows, NO direct sun beams across the garment. Just smooth natural indoor light like an overcast afternoon.',
        'STYLE: real iPhone phone snapshot — slight phone-camera grain, slightly soft, unedited. NO text, NO logos, NO watermarks, NO color grading, NO studio polish.',
      ].join(' '),
    },
    {
      // Shot 5 — Flatlay BACK
      name: '5_flatlay_back',
      refs: [productBack, ENVIRONMENT],
      imageSize: { width: 1024, height: 1280 },
      prompt: [
        'Top-down phone snapshot of the SAME garment from image 1, now flipped over showing its BACK side, on the SAME warm medium-toned golden oak herringbone parquet wood floor from image 2. The floor MUST match image 2 — same medium oak/honey color, same herringbone pattern. NOT dark walnut.',
        'GARMENT: same garment, now showing the BACK. Preserve color, fabric, cut, sleeves (short stays short, long stays long), length, pleats, any back details (zipper, button row, cutout). Spread out flat. Realistic fabric wrinkles and folds.',
        'COMPOSITION: garment centered in frame, photographed straight from above (90° top-down). The back is fully visible — collar/shoulders at top, hem at bottom. NO furniture, NO door, NO walls, NO objects, NO foot, NO hand.',
        'LIGHT: same soft EVEN ambient daylight as the front flatlay shot — same lighting consistency. NO harsh sun stripes, NO blown highlights.',
        'STYLE: real iPhone phone snapshot, slightly soft, unedited. NO text, NO logos, NO watermarks.',
      ].join(' '),
    },
  ];

  const out = [];
  for (const t of tasks) {
    out.push(await generateOne({ ...t, productFolder, key }));
  }
  console.log(`\nDone. ${out.length} images in ${generatedDir}`);
}

main().catch(err => { console.error('FAIL:', err.message); process.exit(1); });
