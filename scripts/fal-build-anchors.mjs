#!/usr/bin/env node
// Baut die zwei Anchor-Bilder, die jede Vinted-Listing-Generation als Referenz verwendet:
//
//   _anchors/environment.jpg  — kanonisches Schlafzimmer (Parkett, Spiegel, lived-in, leer)
//   _anchors/model.jpg        — kanonische Frau in dieser Umgebung (Mirror-Selfie,
//                                Gesicht ~90% verdeckt, athletischer Gym-Body, neutrales Outfit)
//
// Diese Anchors werden EINMAL gebaut und dann für alle 105 Produkte wiederverwendet, damit:
//   – die gleiche Frau in jedem Listing erscheint (Account-Konsistenz)
//   – der gleiche Raum in jedem Listing erscheint
//   – pro Produkt nur noch [env, model, product] in Flux Kontext Max Multi reingeht
//
// Usage:
//   node scripts/fal-build-anchors.mjs environment
//   node scripts/fal-build-anchors.mjs model

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

const ANCHOR_DIR = '/Users/home/Vinted/_anchors';
const REF_ROOT   = '/Users/home/Vinted';
const IMG_7922   = path.join(REF_ROOT, 'IMG_7922.PNG'); // mirror + parquet + white door
const IMG_7926   = path.join(REF_ROOT, 'IMG_7926.PNG'); // mirror selfie, blonde, parquet
const LINA       = path.join(ANCHOR_DIR, 'lina.png');   // existing identity ref (blonde, full body)

async function uploadToFal(filePath, key) {
  const buf = await fs.readFile(filePath);
  const ext = path.extname(filePath).toLowerCase();
  const mime = ext === '.png' ? 'image/png' : 'image/jpeg';
  const filename = path.basename(filePath);

  const initiate = await fetch('https://rest.alpha.fal.ai/storage/upload/initiate', {
    method: 'POST',
    headers: { Authorization: `Key ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ file_name: filename, content_type: mime }),
  });
  if (!initiate.ok) throw new Error(`fal initiate ${initiate.status}: ${await initiate.text()}`);
  const { upload_url, file_url } = await initiate.json();

  const put = await fetch(upload_url, {
    method: 'PUT',
    headers: { 'Content-Type': mime },
    body: buf,
  });
  if (!put.ok) throw new Error(`fal upload ${put.status}: ${await put.text()}`);
  return file_url;
}

async function callSeedream({ prompt, imageUrls, imageSize = { width: 1024, height: 1536 } }, key) {
  const endpoint = 'fal-ai/bytedance/seedream/v4/edit';
  const res = await fetch(`https://fal.run/${endpoint}`, {
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
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await fs.writeFile(outPath, buf);
}

async function buildEnvironment(key) {
  console.log('Building environment anchor…');
  const t0 = Date.now();
  const url = await uploadToFal(IMG_7922, key);

  const prompt = [
    'Edit this photo to remove the woman entirely. Keep the room exactly: warm herringbone parquet wood floor, white panelled door on the left, full-length mirror against the wall, soft daylight from the window, neutral beige walls.',
    'Make the room feel REAL and LIVED-IN — not staged, not perfect. Add naturalistic clutter typical of a 22-year-old woman\'s bedroom: a wooden chair in the corner with a knitted sweater draped over it, a small potted plant on the floor near the door, a folded throw blanket on the floor or chair, one or two stray clothing items casually placed, a coffee mug on a windowsill, a framed picture leaning against the wall. Slightly imperfect — small everyday mess, but cozy and feminine.',
    'IMPORTANT: keep it photorealistic, like a candid iPhone snapshot. NO model, NO person, NO reflection in the mirror — the mirror reflects only the empty room. NO beauty filters, NO oversaturation, NO smoothing. Slight natural film grain. No text, no logos, no watermarks.',
  ].join(' ');

  const result = await callSeedream({ prompt, imageUrls: [url], imageSize: { width: 1024, height: 1536 } }, key);
  const out = path.join(ANCHOR_DIR, 'environment.jpg');
  await downloadTo(result, out);
  console.log(`✓ ${out}  (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  return out;
}

async function buildModel(key) {
  console.log('Building model anchor…');
  const envPath = path.join(ANCHOR_DIR, 'environment.jpg');
  if (!await fs.stat(envPath).catch(() => null)) {
    throw new Error(`Run "environment" step first — ${envPath} missing`);
  }

  const t0 = Date.now();
  // Single primary reference: IMG_7926 (real Julia mirror-selfie aesthetic — blonde,
  // heavy face cover, parquet floor, white IKEA Malm wardrobes, candid iPhone shot).
  // Secondary: environment.jpg, used only to lock in the same room.
  const refUrl = await uploadToFal(IMG_7926, key);
  const envUrl = await uploadToFal(envPath, key);

  const prompt = [
    'Edit image 1 to create a perfect mirror-selfie portrait of a stunning young woman standing in front of a full-length wall mirror in her bedroom. Keep the candid iPhone-selfie aesthetic, the parquet floor, the white wardrobe and lived-in feel from image 1. Image 2 shows the same canonical bedroom for additional context.',
    '',
    'WOMAN — AGE & BEAUTY (critical — she must look 22 and stunning):',
    '- AGE: she is 22 years old. Fresh youthful face with soft baby-face elements — soft cheek fullness, smooth flawless youthful skin, that fresh university-student look. ABSOLUTELY NO wrinkles, NO smile lines, NO crow\'s feet, NO forehead lines, NO nasolabial folds. Her skin is taut and youthful. Not a 30-year-old face under any circumstance.',
    '- A scroll-stopping stunning face — top-tier model-agency beautiful, but young and fresh. Soft symmetric feminine features. Large bright doe-eyed almond-shaped eyes. Soft full plump natural lips with subtle pink tint. Naturally rounded soft cheekbones (NOT sculpted-mature). Soft feminine jawline (NOT sharp). Small straight feminine nose. Thick well-shaped dark blonde brows. Minimal natural makeup — subtle blush, glossy lip, mascara — fresh-faced no-makeup-makeup look.',
    '- Long thick voluminous blonde wavy hair with natural balayage highlights, falling well past her shoulders, slightly tousled bedhead waves, shiny and healthy youthful hair.',
    '- The kind of fresh young Instagram-It-Girl face that stops people scrolling.',
    '',
    'WOMAN — FIGURE (must look curvy):',
    '- A clear feminine hourglass figure with pronounced curves — defined narrow waist, naturally wider hips than ribcage creating a strong S-curve silhouette, toned thighs and legs, fit shoulders. Curvy AND athletic at the same time, like a young curvy fitness model.',
    '',
    'WOMAN — SKIN (critical to fix the previous broken output):',
    '- CLEAN, SMOOTH, FLAWLESS golden sun-kissed tan skin. Healthy natural glow. Even skin tone everywhere.',
    '- ABSOLUTELY NO freckles, NO pores rendered as dots, NO acne, NO blemishes, NO rashes, NO skin spots, NO pigmentation marks, NO moles, NO stippled texture. Just clean even gorgeous skin.',
    '- Realistic — not plastic, not airbrushed-doll, just naturally beautiful clean skin.',
    '',
    'OUTFIT:',
    '- Plain seamless white ribbed cropped tank top fitted to her body.',
    '- Plain seamless high-waisted white biker shorts fitted to her hips.',
    '- Nothing branded, nothing patterned, nothing logo.',
    '- White ankle socks, white chunky sneakers.',
    '',
    'SETTING (must match image 1 / image 2):',
    '- Same bedroom: warm herringbone parquet wood floor, white panelled door on the left, white IKEA chest of drawers, open wardrobe with hanging clothes visible to the side, lived-in cozy feel.',
    '- IMPORTANT: this whole image IS the mirror reflection — there is NO mirror frame visible in the photo, NO black border, NO mirror edge. The image fills the frame edge-to-edge as if the photo itself is what the mirror shows. Do NOT draw any mirror frame, border, or rim.',
    '',
    'PHONE & FACE:',
    '- She holds a normal-sized pink-cased iPhone naturally in front of her chest at chest-to-chin height — NOT covering her face, NOT held high. The phone is NORMAL SIZE, proportional to her hand, not oversized.',
    '- Her face is clearly visible and recognizable above the phone — we see her eyes, nose, soft cheek, brows. The phone is just below her chin/mouth area.',
    '- Hair falls naturally around her face and shoulders.',
    '',
    'POSE:',
    '- Standing relaxed and confidently in front of the mirror, slight natural hip pop to one side, weight on her right leg, left knee slightly bent inward.',
    '- Free hand resting at her side.',
    '- Full body visible from chunky sneakers up to top of head, centered in the mirror.',
    '',
    'LIGHTING & QUALITY:',
    '- Soft even ambient natural daylight from a side window. NO harsh direct sun beams, NO blown-out highlights, NO dramatic light stripes. Just smooth, realistic, slightly warm indoor light.',
    '- Real candid iPhone mirror-selfie look — slightly soft (iPhone front-cam softness, NOT DSLR-sharp), faint phone-camera grain, JPEG-y, completely unedited. The mirror surface has slight smudges that add realism.',
    '- NO beauty filter haze, NO instagram filters, NO color grading.',
    '- NO text, NO logos, NO watermarks, NO UI overlays, NO captions, NO time/battery indicator.',
  ].join('\n');

  const result = await callSeedream({ prompt, imageUrls: [refUrl, envUrl], imageSize: { width: 1024, height: 1536 } }, key);
  const out = path.join(ANCHOR_DIR, 'model.jpg');
  await downloadTo(result, out);
  console.log(`✓ ${out}  (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  return out;
}

async function main() {
  await loadEnv();
  const key = process.env.FAL_KEY;
  if (!key) throw new Error('FAL_KEY missing');

  const target = process.argv[2];
  if (target === 'environment') await buildEnvironment(key);
  else if (target === 'model')   await buildModel(key);
  else throw new Error('Usage: node fal-build-anchors.mjs <environment|model>');
}

main().catch(err => { console.error('FAIL:', err.message); process.exit(1); });
