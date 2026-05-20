#!/usr/bin/env node
// Pose-Library Builder — Phase 1 der neuen Vinted-Pipeline.
//
// Generiert 30 Pose-Variationen der Persona im Bedroom mit Seedream V4 Edit.
// Inputs: anchor_persona_front.jpg + anchor_persona_face.jpg
// Output: _anchors/library/_candidates/pose_001.jpg ... pose_030.jpg
//
// Nach Generierung: User curated manuell die 15-20 besten in _anchors/library/.
//
// Kosten: ~$1 (30 × $0.03 Seedream V4 Edit)
// Laufzeit: ~10-15 Min (Concurrency 4)

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENV_PATH = path.join(__dirname, '..', '.env');
const ANCHOR_DIR = '/Users/home/Vinted/_anchors';
const FRONT_ANCHOR = path.join(ANCHOR_DIR, 'anchor_persona_front.jpg');
const FACE_ANCHOR = path.join(ANCHOR_DIR, 'anchor_persona_face.jpg');
const LIBRARY_DIR = path.join(ANCHOR_DIR, 'library', '_candidates');

const POSES = [
  { num: 1,  desc: 'standing fully frontal to the mirror, weight evenly on both legs, free hand at side, phone at face level' },
  { num: 2,  desc: 'standing frontal with soft hip pop to her right, weight on right leg, free hand running through hair on left side, phone at chest level' },
  { num: 3,  desc: 'standing frontal with hip pop to her left, free hand on left hip, phone at face level' },
  { num: 4,  desc: 'standing frontal, both hands holding the phone in front of her face, slight forward lean' },
  { num: 5,  desc: 'rotated 30° to her left, S-curve stance, free hand at hip, phone angled diagonally with body' },
  { num: 6,  desc: 'rotated 45° to her left, strong S-curve, free hand resting on stomach, phone at chest level' },
  { num: 7,  desc: 'rotated 30° to her right, casual stance, free hand at side, phone at face level' },
  { num: 8,  desc: 'rotated 45° to her right, hand running through hair, phone at chest level' },
  { num: 9,  desc: 'side profile (90° turn) to her left, phone held to capture profile in mirror, free hand at side' },
  { num: 10, desc: 'side profile to her right, free hand on hip, phone at chest level' },
  { num: 11, desc: 'fully back-turned to mirror, looking back over right shoulder, hair pulled to left, phone held high near right ear' },
  { num: 12, desc: 'fully back-turned, looking back over left shoulder, hair pulled to right, phone held high near left ear' },
  { num: 13, desc: 'back-turned, NOT looking back (full back view), phone held at hip level, free hand at side' },
  { num: 14, desc: 'back-turned with one foot crossed behind the other, hand on hip, phone held at shoulder height looking back' },
  { num: 15, desc: 'frontal close-up cropped at hips, phone at face level, free hand at collarbone' },
  { num: 16, desc: 'frontal close-up cropped at hips, phone slightly to the side, free hand touching neckline' },
  { num: 17, desc: '3/4 angle close-up cropped at hips, phone diagonal, free hand in hair' },
  { num: 18, desc: 'frontal full-body, leaning lightly against wardrobe casually, phone at chest' },
  { num: 19, desc: 'frontal full-body, peace sign with free hand, phone at face level' },
  { num: 20, desc: 'frontal full-body, free hand holding the bottom hem of her tank top slightly up to show waist, phone at chest' },
  { num: 21, desc: '3/4 angle with one knee slightly bent forward, casual lean, phone at chest' },
  { num: 22, desc: 'frontal with both hands holding phone at face level, strong centered selfie pose' },
  { num: 23, desc: 'frontal, slight twist to right with weight on left leg, free hand at hip' },
  { num: 24, desc: 'back view at 3/4 angle, looking back over shoulder, free hand playing with hair' },
  { num: 25, desc: 'back view, hair fully pulled to one side, free hand touching the back of her tank top, phone held high' },
  { num: 26, desc: 'frontal full-body with one foot slightly forward, free hand at side, phone at face' },
  { num: 27, desc: 'frontal close-up cropped at waist-up, head tilted slightly, phone at face level' },
  { num: 28, desc: 'side angle close-up at waist-up, phone diagonal, free hand at neckline' },
  { num: 29, desc: 'frontal full-body, body slightly turned with playful tilt, both hands on phone at face level' },
  { num: 30, desc: 'back view turning to walk away, looking back over shoulder, phone held mid-air' },
  // ── ZWEITE 30 (alle deutlich anders als 001-030) ──
  { num: 31, desc: 'standing on tiptoes, frontal, body slightly stretched upward, free hand reaching up to touch ceiling-light area, phone at face level' },
  { num: 32, desc: 'low squat / crouch position close to floor, frontal, looking up into mirror, free hand on knee' },
  { num: 33, desc: 'kneeling on ONE knee on the parquet, frontal, casual, free hand resting on the bent knee' },
  { num: 34, desc: 'sitting cross-legged on the parquet floor in front of mirror, looking up into mirror, phone in lap area' },
  { num: 35, desc: 'half-sitting on the edge of the white dresser, leaning casually back, legs crossed at ankle, phone at chest' },
  { num: 36, desc: 'bending forward at the hips with both hands resting on knees, frontal, looking up into mirror, playful pose' },
  { num: 37, desc: 'arms crossed under bust (one arm holds phone visible at face level), frontal, confident stance' },
  { num: 38, desc: 'one hand cupping under chin in pensive thinking pose, frontal, head slightly tilted, phone in other hand at chest' },
  { num: 39, desc: 'free hand on the back of her neck (elbow popped out), frontal, casual stretch pose' },
  { num: 40, desc: 'leaning fully sideways against wardrobe with shoulder pressed to it, side angle, free hand at side' },
  { num: 41, desc: 'one foot lifted up on a low surface (like a small box on floor), bent knee creating stretch line, frontal' },
  { num: 42, desc: 'mid-step walking forward toward mirror, one leg slightly forward, dynamic motion frozen' },
  { num: 43, desc: 'taking a small step backward, head tilted slightly upward, phone held at chest, casual airy mood' },
  { num: 44, desc: 'fully turned 180° (pure back, NO shoulder twist), entire back facing mirror, phone held at hip level by side' },
  { num: 45, desc: 'pure 90° side profile (sharp profile silhouette), no rotation toward mirror, phone held diagonally to capture reflection' },
  { num: 46, desc: 'mid-twirl / spin motion, hair flowing slightly out to one side from movement, frontal-ish, phone at face' },
  { num: 47, desc: 'free hand pulling tank-top down at the waist hem to reveal more waist line, frontal, slight hip pop' },
  { num: 48, desc: 'free hand pulling one shoulder strap of the tank-top slightly, drawing attention to the strap, frontal close-up' },
  { num: 49, desc: 'free hand sweeping hair up into a messy bun gesture (hand visible holding hair on top of head), frontal' },
  { num: 50, desc: 'free hand brushing a strand of hair behind her ear, head slightly tilted, frontal close-up' },
  { num: 51, desc: 'one foot crossed over the other in a casual relaxed standing pose, frontal, phone at chest' },
  { num: 52, desc: 'wide stance with legs apart and feet planted firmly, frontal, confident strong pose, phone at face' },
  { num: 53, desc: 'looking down at her own outfit (head down, NOT at phone), free hand pointing at her tank top, frontal' },
  { num: 54, desc: 'side angle, leaning slightly forward toward the mirror as if checking outfit detail closely, hand on dresser for support' },
  { num: 55, desc: '3/4 angle with free hand sliding down along her hip-line, drawing attention to the hip curve' },
  { num: 56, desc: 'back view with head tilted clearly to one side (ear toward shoulder), playful pose' },
  { num: 57, desc: 'one knee lifted high as if checking shoe / sock, frontal, free hand on the lifted knee, phone at face' },
  { num: 58, desc: 'free hand resting flat on her collarbone / upper chest area, frontal close-up, soft expression' },
  { num: 59, desc: '3/4 angle with both hands on hips (one still holds phone visible), confident wide stance' },
  { num: 60, desc: 'frontal full-body, free arm extended outward to the side (like balancing or showing the room), phone at face' },
];

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

async function callSeedream({ prompt, imageUrls }, key) {
  const res = await fetchWithRetry('https://fal.run/fal-ai/bytedance/seedream/v4/edit', {
    method: 'POST',
    headers: { Authorization: `Key ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt,
      image_urls: imageUrls,
      image_size: { width: 1024, height: 1536 },
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

function buildPrompt(poseDesc) {
  return [
    'Generate the EXACT SAME WOMAN from IMAGE 1 in the EXACT SAME BEDROOM shown in IMAGE 1, taking a candid iPhone mirror selfie. Use IMAGE 2 for additional face detail to lock her identity precisely.',
    '',
    'PERSONA — match EXACTLY from IMAGE 1 + IMAGE 2 (this is Adeline, dirty-blonde wavy):',
    '- Face: SAME pretty 21-year-old face from the references, same hazel-green eyes, same nose, same lips. Same DIRTY-BLONDE MESSY BEACH WAVES past shoulders middle-parted (NOT straight hair, NOT platinum white)',
    '- Body: SAME pronounced sportlich-curvy hourglass figure as IMAGE 1 — sharply pinched small waist, FULL natural firm bust visible through the tight tank top, FULL naturally rounded firm glutes that project clearly outward (visible curve from any angle), full naturally rounded hips wider than ribcage, lean toned thighs with thigh gap, slim arms and shoulders. SPORTLICH-FIT-CURVY look (Pilates girl with strong glutes from training) — NOT skinny-flat, NOT BBL-fake, but distinctly more curvy than typical fashion model.',
    '- Skin: lightly-tanned Mediterranean glow with subtle natural texture (visible fine pores, NOT plastic smooth)',
    '',
    'BEDROOM — match EXACTLY from IMAGE 1, do NOT modify any element:',
    '- White IKEA PAX wardrobe LEFT with orange Hermès/LV boxes stacked on top',
    '- White IKEA Malm 6-drawer dresser RIGHT with vase + flowers + framed art',
    '- Light honey-oak BLOCK parquet floor (NOT herringbone)',
    '- Off-white walls',
    '- Warm uneven interior lighting (LED + window)',
    '- Floor clutter (bag, shoes) where present in IMAGE 1',
    '',
    'BASE OUTFIT (same in every library shot — will be replaced with garments later):',
    '- Plain white ribbed tank top fitted at her waist',
    '- Plain white high-waisted bike shorts',
    '- White crew tube ankle socks (NEVER bare feet)',
    '',
    'PHONE — small palm-sized iPhone Pro:',
    '- Less than 12% of image area, smaller than her face',
    '- Clear/white silicone case with PINK HEART popsocket grip on back',
    '- PHONE COVERS 40-70% OF FACE (varies per shot) — NEVER fully blocks face, NEVER 100% covered. Either eyes are visible OR mouth/chin is visible (or both partially). The face must be readable — phone is in front of face but not pasted-flat-blocking.',
    '- 4 fingers on back-left edge, thumb on screen, 1-2 thin gold rings',
    '',
    `POSE FOR THIS SHOT: ${poseDesc}`,
    '',
    'AUTHENTICITY:',
    '- Output IS the mirror reflection, full-bleed edge-to-edge, NO mirror frame visible at any photo edge',
    '- Slightly soft iPhone-front-cam quality with natural sensor grain in shadows',
    '- Casual just-standing pose, not catalog-perfect, slight off-center framing',
    '- Real skin texture with subtle imperfections, no plastic-smooth filter',
    '- Warm uneven interior lighting matching IMAGE 1',
    '- Subtle iPhone wide-angle distortion at edges',
    '',
    'NEGATIVE: NO mirror frame, NO border, NO oversized phone, NO bare feet, NO HDR, NO studio lighting, NO plastic skin, NO catalog pose, NO room changes from IMAGE 1, NO body slimmed-down or flattened, NO text/logos/watermarks.',
  ].join('\n');
}

async function generateOne({ pose, frontUrl, faceUrl, key }) {
  const filename = `pose_${String(pose.num).padStart(3, '0')}.jpg`;
  const outPath = path.join(LIBRARY_DIR, filename);

  // Skip if already exists
  if (await fs.stat(outPath).catch(() => null)) {
    console.log(`  ⏭  ${filename} (exists)`);
    return { ok: true, skipped: true, num: pose.num };
  }

  const tStart = Date.now();
  try {
    const prompt = buildPrompt(pose.desc);
    const url = await callSeedream({
      prompt,
      imageUrls: [frontUrl, faceUrl],
    }, key);
    await downloadTo(url, outPath);
    const dt = ((Date.now() - tStart) / 1000).toFixed(1);
    console.log(`  ✓ ${filename}  (${dt}s)  ${pose.desc.slice(0, 60)}…`);
    return { ok: true, num: pose.num };
  } catch (err) {
    console.log(`  ✗ ${filename} FAILED: ${err.message}`);
    return { ok: false, num: pose.num, error: err.message };
  }
}

async function processInBatches(items, fn, concurrency) {
  const results = [];
  const queue = [...items];
  const workers = [];
  for (let w = 0; w < concurrency; w++) {
    workers.push((async () => {
      while (queue.length > 0) {
        const item = queue.shift();
        if (!item) break;
        results.push(await fn(item));
      }
    })());
  }
  await Promise.all(workers);
  return results;
}

async function main() {
  await loadEnv();
  const key = process.env.FAL_KEY;
  if (!key) throw new Error('FAL_KEY missing in system/.env');

  // Verify anchors
  for (const f of [FRONT_ANCHOR, FACE_ANCHOR]) {
    if (!await fs.stat(f).catch(() => null)) {
      throw new Error(`Anchor missing: ${f}`);
    }
  }

  await fs.mkdir(LIBRARY_DIR, { recursive: true });

  console.log(`Pose-Library Builder`);
  console.log(`  Inputs: ${path.basename(FRONT_ANCHOR)}, ${path.basename(FACE_ANCHOR)}`);
  console.log(`  Output: ${LIBRARY_DIR}`);
  console.log(`  Poses:  ${POSES.length}`);
  console.log();

  console.log('Uploading 2 anchor images to fal storage…');
  const [frontUrl, faceUrl] = await Promise.all([
    uploadToFal(FRONT_ANCHOR, key),
    uploadToFal(FACE_ANCHOR, key),
  ]);
  console.log('  ✓ uploaded\n');

  console.log(`Generating ${POSES.length} pose variations (concurrency 4)…`);
  const t0 = Date.now();
  const results = await processInBatches(POSES, p => generateOne({ pose: p, frontUrl, faceUrl, key }), 4);
  const dt = ((Date.now() - t0) / 1000 / 60).toFixed(1);

  const ok = results.filter(r => r.ok).length;
  const skipped = results.filter(r => r.skipped).length;
  const failed = results.filter(r => !r.ok).length;

  console.log(`\n=== DONE in ${dt} min ===`);
  console.log(`  ${ok} ok (${skipped} skipped — already existed)`);
  console.log(`  ${failed} failed`);
  console.log(`  Output dir: ${LIBRARY_DIR}`);
  console.log();
  console.log(`Next steps:`);
  console.log(`  1. Review the candidates`);
  console.log(`  2. Pick 15-20 best ones (Persona + Bedroom konsistent, Pose sauber)`);
  console.log(`  3. Move picks from _candidates/ to library/`);

  if (failed > 0) process.exit(2);
}

main().catch(err => { console.error('FATAL:', err.message); process.exit(1); });
