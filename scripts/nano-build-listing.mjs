#!/usr/bin/env node
// Inpainting-Pipeline — Stufe 2-4 der neuen Vinted-Pipeline.
//
// Pro Produkt:
// 1. Lädt _clean/garment.png (muss durch nano-pre-process.mjs erzeugt sein)
// 2. Pickt 4 random Pose-Anker aus _anchors/library/ (stratifiziert: frontal/side/back/closeup)
// 3. Pro Mirror-Shot: Seedream V4 Edit mit [anchor, garment.png] → outfit-swap
// 4. Shot 5 Flatlay: Seedream mit [environment, garment.png] → top-down
// 5. Pro Shot 2 Variants generieren, Vision-Check, beste pickt
// 6. Output: <product>/generated/{1_front,2_side,3_back,4_selfie_detail,5_flatlay}.jpg
//
// Cost pro Produkt: ~$0.30 (10 Generations + 10 Vision-Checks)
// Laufzeit pro Produkt: ~2-3 Min (Shots parallel)
//
// Usage:
//   node nano-build-listing.mjs <product-folder>
//   node nano-build-listing.mjs <product-folder> --force   # Overwrite existing
//   node nano-build-listing.mjs <product-folder> --variants=3   # mehr Variants

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENV_PATH = path.join(__dirname, '..', '.env');
const ANCHOR_DIR = '/Users/home/Vinted/_anchors';
const LIBRARY_DIR = path.join(ANCHOR_DIR, 'library');
const ENV_ANCHOR = path.join(ANCHOR_DIR, 'anchor_environment.jpg');

// Library categorization — basierend auf User-Curation (43 Picks aus 60)
// (Stratification für Pose-Variety pro Listing-Set)
const LIBRARY_CATEGORIES = {
  frontal: new Set([1,2,3,4,18,19,20,22,23,26,39,41,42,43,46,47,51,53,57,60]),
  side:    new Set([6,7,8,9,10,21,40,45,55]),
  back:    new Set([11,12,24,25,30,56]),
  closeup: new Set([15,16,17,27,28,38,48,58]),
};

function poseNumber(filename) {
  const m = path.basename(filename).match(/^pose_(\d+)\.jpg$/);
  return m ? parseInt(m[1], 10) : null;
}

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
    method: 'PUT', headers: { 'Content-Type': mime }, body: buf,
  });
  if (!put.ok) throw new Error(`fal upload ${put.status}: ${await put.text()}`);
  return file_url;
}

const uploadCache = new Map();
async function uploadCached(filePath, key) {
  if (uploadCache.has(filePath)) return uploadCache.get(filePath);
  const url = await uploadToFal(filePath, key);
  uploadCache.set(filePath, url);
  return url;
}

async function callSeedream({ prompt, imageUrls, imageSize }, key) {
  const res = await fetchWithRetry('https://fal.run/fal-ai/bytedance/seedream/v4/edit', {
    method: 'POST',
    headers: { Authorization: `Key ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt, image_urls: imageUrls, image_size: imageSize,
      num_images: 1, max_images: 1, enable_safety_checker: false,
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

async function visionValidate(imagePath, shotType, geminiKey) {
  // Fallback: if no Gemini key, skip validation and accept all
  if (!geminiKey) return { verdict: 'PASS', violations: [], skipped: true };

  const buf = await fs.readFile(imagePath);
  const mime = imagePath.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg';

  const checklist = `Mirror-Shot Quality Check.

Examine the image. For each criterion below, answer PASS or FAIL.

1. The persona has visible feminine curves (NOT flat-chested, NOT skinny-runway-flat).
2. NO bare feet visible — she wears socks, sneakers, sandals, or heels.
3. The phone is small and palm-sized (NOT oversized, NOT tablet-sized).
4. The bedroom shows: white wardrobe (often LEFT), white dresser (often RIGHT), light wood block parquet floor.
5. NO mirror frame visible at any photo edge — the image bleeds edge-to-edge.
6. The persona wears the new garment (NOT a white tank top and white shorts).
7. NO HDR / studio soft-box / catalog look — natural warm interior lighting.
8. Skin looks real (subtle texture, NOT plastic-smooth).
9. NO text, logo, watermark, or UI overlay visible.

Reply ONLY with valid JSON in this exact format:
{"violations":["criterion N: short reason", ...],"verdict":"PASS"}
or
{"violations":[...],"verdict":"FAIL"}

PASS = 0 violations. FAIL = any violation.`;

  const res = await fetchWithRetry('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent', {
    method: 'POST',
    headers: { 'x-goog-api-key': geminiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{
        parts: [
          { inline_data: { mime_type: mime, data: buf.toString('base64') } },
          { text: checklist },
        ],
      }],
      generationConfig: { temperature: 0, maxOutputTokens: 500, responseMimeType: 'application/json' },
    }),
  });
  if (!res.ok) {
    return { verdict: 'FAIL', violations: [`vision-api error ${res.status}`] };
  }
  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
  try {
    return JSON.parse(text);
  } catch {
    return { verdict: 'FAIL', violations: ['could not parse vision response'] };
  }
}

const INPAINT_PROMPT = `Replace the white tank top and white biker shorts that the woman in IMAGE 1 is currently wearing with the EXACT garment shown in IMAGE 2 (transparent background — only the garment matters, ignore everything else in IMAGE 2).

GARMENT — match 1:1:
- Color: exact hue and saturation, NO recoloring, NO warm/cool shift
- Fabric: exact type and finish (matte/satin/ribbed/chiffon/knit)
- Cut and length: mini stays mini, midi stays midi, maxi stays maxi
- Neckline shape: exact (crew/V/square/halter/wrap), NO cleavage modification, NO neckline deepening
- Sleeve length and style: exact
- Waist detail, hem shape, pleats, ruffles, prints, patterns, buttons, zippers, ties: 1:1

The garment hangs naturally on her body with realistic small wrinkles where fabric meets her waist and hips. Match the lighting of IMAGE 1 so the garment integrates seamlessly with the existing shadows and highlights.

FOOTWEAR: if the existing socks/shoes don't match the new outfit's style, replace them — but NEVER bare feet. Defaults: white tube socks (casual), white sneakers (jeans/skirts), nude block-heel sandals (dresses), strappy nude heels (evening dresses).

PRESERVE EXACTLY (everything outside the outfit area):
- Her face, hair, body proportions, skin tone — IDENTICAL to IMAGE 1
- The room: wardrobe LEFT with orange Hermès/LV boxes on top, white Malm dresser RIGHT with vase + flowers + framed art, honey-oak block parquet, off-white walls — IDENTICAL to IMAGE 1
- The mirror reflection composition — IDENTICAL to IMAGE 1
- The phone in her hand with clear case + pink heart popsocket grip — IDENTICAL to IMAGE 1
- Lighting, shadows, highlights — IDENTICAL to IMAGE 1
- Floor clutter (bag, shoes if visible) — IDENTICAL to IMAGE 1

The output IS the mirror reflection, full-bleed edge-to-edge. NO mirror frame, NO border. Vertical 9:16.

NEGATIVE: NO bare feet, NO oversized phone, NO HDR, NO studio lighting, NO plastic skin, NO room changes, NO body slimmed-down or flattened, NO text/logos/watermarks, NO neckline modification, NO cleavage added.`;

const FLATLAY_PROMPT = `Generate a casual phone snapshot of the garment from IMAGE 2 (transparent PNG, ignore background) laid flat on the SAME light honey-oak BLOCK parquet floor visible in IMAGE 1 (the bedroom floor) — NO model, NO person, NO hands, NO phone, NO furniture.

Camera tilted ~70-80° (NOT a perfect 90° straight-down). Slight perspective skew on the garment outline.

Garment NOT perfectly arranged: sleeves at slightly uneven angles, natural wrinkles and creases, fabric drape, slightly off-center in frame.

Match floor texture and matte finish exactly to IMAGE 1.

Subtle soft shadow under the garment from ambient room light.

Phone-camera quality: slightly soft, mild noise, NOT DSLR sharp.

Vertical 4:5 aspect ratio.

NEGATIVE: NO model, NO person, NO hand, NO foot, NO phone, NO furniture, NO door, NO wall, NO perfect 90° angle, NO bright white studio backdrop, NO HDR, NO heavy color grading, NO text, NO logos, NO watermarks.`;

async function listLibraryAnchors() {
  const files = await fs.readdir(LIBRARY_DIR).catch(() => []);
  return files.filter(f => /^pose_\d+\.jpg$/.test(f)).map(f => path.join(LIBRARY_DIR, f));
}

function categorize(libraryFiles) {
  const buckets = { frontal: [], side: [], back: [], closeup: [] };
  for (const f of libraryFiles) {
    const num = poseNumber(f);
    if (num == null) continue;
    for (const [cat, set] of Object.entries(LIBRARY_CATEGORIES)) {
      if (set.has(num)) { buckets[cat].push(f); break; }
    }
  }
  return buckets;
}

function pickFiveAnchors(libraryFiles) {
  const buckets = categorize(libraryFiles);
  const pickRandom = (arr) => {
    if (arr.length === 0) return null;
    return arr[Math.floor(Math.random() * arr.length)];
  };
  // Fallback: if a bucket is empty, pick from any
  const any = libraryFiles;
  return {
    '1_front':         pickRandom(buckets.frontal) || pickRandom(any),
    '2_side':          pickRandom(buckets.side)    || pickRandom(any),
    '3_back':          pickRandom(buckets.back)    || pickRandom(any),
    '4_selfie_detail': pickRandom(buckets.closeup) || pickRandom(any),
  };
}

async function generateShot({ shotName, anchorPath, garmentPath, prompt, imageSize, falKey, geminiKey, variants, outDir, force }) {
  const outPath = path.join(outDir, `${shotName}.jpg`);
  if (!force && await fs.stat(outPath).catch(() => null)) {
    return { ok: true, skipped: true, shotName };
  }

  const variantsDir = path.join(outDir, '_variants');
  await fs.mkdir(variantsDir, { recursive: true });

  // Upload anchor + garment (cached)
  const [anchorUrl, garmentUrl] = await Promise.all([
    uploadCached(anchorPath, falKey),
    uploadCached(garmentPath, falKey),
  ]);

  // Generate N variants
  const tStart = Date.now();
  const variantPromises = [];
  for (let v = 1; v <= variants; v++) {
    variantPromises.push((async () => {
      try {
        const url = await callSeedream({
          prompt, imageUrls: [anchorUrl, garmentUrl], imageSize,
        }, falKey);
        const variantPath = path.join(variantsDir, `${shotName}_v${v}.jpg`);
        await downloadTo(url, variantPath);
        return { variant: v, path: variantPath };
      } catch (err) {
        return { variant: v, error: err.message };
      }
    })());
  }
  const generated = await Promise.all(variantPromises);
  const validVariants = generated.filter(g => g.path);
  if (validVariants.length === 0) {
    return { ok: false, shotName, error: 'all variants failed to generate' };
  }

  // Vision-validate all variants
  const validated = await Promise.all(validVariants.map(async (g) => {
    const result = await visionValidate(g.path, shotName, geminiKey);
    return { ...g, ...result };
  }));

  // Pick best: PASS first, then fewest violations
  validated.sort((a, b) => {
    if (a.verdict === 'PASS' && b.verdict !== 'PASS') return -1;
    if (b.verdict === 'PASS' && a.verdict !== 'PASS') return 1;
    return (a.violations?.length || 0) - (b.violations?.length || 0);
  });
  const best = validated[0];
  await fs.copyFile(best.path, outPath);

  const dt = ((Date.now() - tStart) / 1000).toFixed(1);
  const score = best.verdict === 'PASS' ? 100 : Math.max(0, 100 - (best.violations?.length || 5) * 15);
  return {
    ok: true, shotName, score, verdict: best.verdict, dt,
    violations: best.violations || [], variantsCount: validated.length,
  };
}

async function processProduct(productFolder, opts = {}) {
  const { variants = 2, force = false } = opts;
  await loadEnv();
  const falKey = process.env.FAL_KEY;
  const geminiKey = process.env.GEMINI_API_KEY;
  if (!falKey) throw new Error('FAL_KEY missing');
  if (!geminiKey) console.log('⚠ GEMINI_API_KEY not set — skipping Vision-Validation, all variants accepted.');

  // Verify _clean/garment.png exists
  const garmentPath = path.join(productFolder, '_clean', 'garment.png');
  if (!await fs.stat(garmentPath).catch(() => null)) {
    throw new Error(`Garment not pre-processed. Run nano-pre-process.mjs first: ${garmentPath}`);
  }

  // Verify library
  const library = await listLibraryAnchors();
  if (library.length < 4) {
    throw new Error(`Library has only ${library.length} anchors. Need at least 4. Run nano-build-library.mjs first and curate.`);
  }

  // Verify env anchor for flatlay
  if (!await fs.stat(ENV_ANCHOR).catch(() => null)) {
    throw new Error(`Environment anchor missing: ${ENV_ANCHOR}`);
  }

  // Pick anchors per shot
  const anchors = pickFiveAnchors(library);

  const outDir = path.join(productFolder, 'generated');
  await fs.mkdir(outDir, { recursive: true });

  console.log(`Product: ${path.basename(productFolder)}`);
  console.log(`  Garment: ${path.relative(productFolder, garmentPath)}`);
  console.log(`  Picked anchors:`);
  for (const [shot, anchor] of Object.entries(anchors)) {
    console.log(`    ${shot}: ${path.basename(anchor)}`);
  }
  console.log();

  const t0 = Date.now();

  // Mirror shots in parallel
  const mirrorTasks = [
    { name: '1_front',         anchor: anchors['1_front'],         size: { width: 1024, height: 1536 } },
    { name: '2_side',          anchor: anchors['2_side'],          size: { width: 1024, height: 1536 } },
    { name: '3_back',          anchor: anchors['3_back'],          size: { width: 1024, height: 1536 } },
    { name: '4_selfie_detail', anchor: anchors['4_selfie_detail'], size: { width: 1024, height: 1280 } },
  ];

  const mirrorPromises = mirrorTasks.map(t => generateShot({
    shotName: t.name, anchorPath: t.anchor, garmentPath,
    prompt: INPAINT_PROMPT, imageSize: t.size,
    falKey, geminiKey, variants, outDir, force,
  }));

  // Flatlay in parallel with mirrors
  const flatlayPromise = generateShot({
    shotName: '5_flatlay', anchorPath: ENV_ANCHOR, garmentPath,
    prompt: FLATLAY_PROMPT, imageSize: { width: 1024, height: 1280 },
    falKey, geminiKey, variants, outDir, force,
  });

  const all = await Promise.all([...mirrorPromises, flatlayPromise]);
  const dt = ((Date.now() - t0) / 1000 / 60).toFixed(1);

  console.log(`\n=== Product done in ${dt} min ===`);
  let totalScore = 0, count = 0;
  for (const r of all) {
    if (r.skipped) {
      console.log(`  ⏭  ${r.shotName} (existed)`);
      continue;
    }
    if (!r.ok) {
      console.log(`  ✗ ${r.shotName} FAILED: ${r.error}`);
      continue;
    }
    const violationsStr = r.violations?.length ? ` [${r.violations.length} violations]` : '';
    console.log(`  ✓ ${r.shotName}  ${r.verdict}${violationsStr}  score=${r.score}  (${r.dt}s)`);
    if (r.violations?.length) {
      for (const v of r.violations) console.log(`      - ${v}`);
    }
    totalScore += r.score;
    count++;
  }
  if (count > 0) {
    const avg = (totalScore / count).toFixed(0);
    console.log(`\nAvg quality score: ${avg}/100  (${count}/5 shots)`);
  }

  return all;
}

async function main() {
  const args = process.argv.slice(2);
  const productFolder = args.find(a => !a.startsWith('--'));
  const force = args.includes('--force');
  const variantsArg = args.find(a => a.startsWith('--variants='));
  const variants = variantsArg ? parseInt(variantsArg.split('=')[1], 10) : 2;

  if (!productFolder) {
    console.error('Usage: node nano-build-listing.mjs <product-folder> [--force] [--variants=N]');
    process.exit(1);
  }

  await processProduct(productFolder, { variants, force });
}

main().catch(err => { console.error('FATAL:', err.message); process.exit(1); });
