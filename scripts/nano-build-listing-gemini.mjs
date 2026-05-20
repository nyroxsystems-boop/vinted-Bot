#!/usr/bin/env node
// Inpainting-Pipeline mit Gemini 2.5 Flash Image (Nano Banana).
// Alternative zu nano-build-listing.mjs (das fal.ai/Seedream nutzt).
//
// Vorteile:
// - Single-API (alles über Gemini, kein fal.ai)
// - Keine separate Background-Removal nötig (Gemini extrahiert Garment direkt)
// - Antigravity-friendly (nutzt Gemini-Stack)
//
// Pro Produkt:
// 1. Pickt 4 random Pose-Anker aus _anchors/library/
// 2. Pro Mirror-Shot: Gemini Image Edit mit [anchor, cj_source] → outfit-swap
// 3. Shot 5 Flatlay: Gemini mit [environment, cj_source] → top-down
// 4. Output: <product>/generated/{1_front,2_side,3_back,4_selfie_detail,5_flatlay}.jpg
//
// Cost: $0.039/Bild × 5 = ~$0.20 pro Produkt (single variant)
//       mit 2 A/B Variants: ~$0.40 pro Produkt
//
// Usage:
//   node nano-build-listing-gemini.mjs <product-folder>
//   node nano-build-listing-gemini.mjs <product-folder> --force
//   node nano-build-listing-gemini.mjs <product-folder> --variants=2

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENV_PATH = path.join(__dirname, '..', '.env');
const ANCHOR_DIR = '/Users/home/Vinted/_anchors';
const LIBRARY_DIR = path.join(ANCHOR_DIR, 'library');
const ENV_ANCHOR = path.join(ANCHOR_DIR, 'anchor_environment.jpg');

// Library categorization (alle 60 Adeline-Posen, auto-categorized nach Pose-Beschreibung)
const LIBRARY_CATEGORIES = {
  frontal: new Set([1,2,3,4,18,19,20,22,23,26,29,31,32,33,34,36,37,39,41,42,43,46,47,49,51,52,53,57,60]),  // 29
  side:    new Set([5,6,7,8,9,10,21,35,40,45,54,55,59]),                                                    // 13
  back:    new Set([11,12,13,14,24,25,30,44,56]),                                                           // 9
  closeup: new Set([15,16,17,27,28,38,48,50,58]),                                                           // 9
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

async function loadImageBase64(filePath) {
  const buf = await fs.readFile(filePath);
  const ext = path.extname(filePath).toLowerCase();
  const mime = ext === '.png' ? 'image/png' :
               ext === '.webp' ? 'image/webp' : 'image/jpeg';
  return { mime_type: mime, data: buf.toString('base64') };
}

async function callGeminiImageEdit({ prompt, images, geminiKey, temperature = 0.4 }) {
  if (!geminiKey) throw new Error('GEMINI_API_KEY missing — cannot call Gemini API');

  const parts = [];
  for (const img of images) {
    parts.push({ inline_data: img });
  }
  parts.push({ text: prompt });

  const res = await fetchWithRetry(
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-image-preview:generateContent',
    {
      method: 'POST',
      headers: { 'x-goog-api-key': geminiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts }],
        generationConfig: { responseModalities: ['IMAGE'], temperature },
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

  // Find the image part in the response
  const imagePart = candidate.content?.parts?.find(p => p.inline_data || p.inlineData);
  const inlineData = imagePart?.inline_data || imagePart?.inlineData;
  if (!inlineData?.data) {
    throw new Error(`No image in response: ${JSON.stringify(data).slice(0, 400)}`);
  }
  return Buffer.from(inlineData.data, 'base64');
}

const INPAINT_PROMPT = `EDIT TASK: Take IMAGE 1 (Adeline in her bedroom mirror selfie — dirty-blonde wavy-haired girl with curvy hourglass body) and replace ONLY her current outfit (white tank top + bike shorts) with the EXACT garment shown in IMAGE 2 (a CJ catalog photo — focus only on the garment itself, IGNORE the other model wearing it and her background).

PRESERVE PIXEL-IDENTICAL FROM IMAGE 1 (Adeline persona — critical):
- HER FACE: same Adeline face geometry, same hazel-green eyes, same nose, same lips
- HER HAIR: dirty-blonde MESSY BEACH WAVES past shoulders middle-parted (NOT straight, NOT platinum, NOT changed)
- HER SKIN: lightly-tanned Mediterranean glow with subtle natural texture
- HER BODY: pronounced sportlich-curvy hourglass — sharply pinched waist, FULL natural firm bust, FULL rounded firm glutes that project clearly outward, full naturally rounded hips wider than ribcage, lean toned thighs with thigh gap. Keep her body EXACTLY as in IMAGE 1 — visibly curvy NOT flattened-skinny.
- The bedroom: wardrobe LEFT with orange Hermès/LV boxes, white Malm dresser RIGHT with vase + flowers + framed art, honey-oak block parquet floor, off-white walls — IDENTICAL to IMAGE 1
- The mirror reflection composition + lighting — IDENTICAL to IMAGE 1
- The phone in her hand (clear case + pink heart popsocket grip) — IDENTICAL to IMAGE 1
- Floor clutter (bag, shoes if visible) — IDENTICAL to IMAGE 1

PHONE / FACE COVERAGE — natural variation:
- Phone covers 40-70% of face (varies per shot) — NEVER 100% covered, NEVER pasted-flat-blocking the whole face
- Either eyes are visible OR mouth/chin/jaw is visible (or both partially)
- Face must be readable as Adeline's face — phone is in front of face but not blocking everything

REPLACE ONLY the outfit area with the garment from IMAGE 2:
- Match exactly: color, fabric, cut, length (mini stays mini, midi stays midi)
- Match exactly: neckline shape (NO cleavage modification, NO neckline deepening)
- Match exactly: sleeve length, waist detail, hem, prints, patterns
- The garment hangs naturally on Adeline's curvy body (showing her bust + waist + hip curves through the fabric where appropriate)
- Lighting integrates seamlessly with the existing shadows in IMAGE 1

FOOTWEAR: if existing socks/shoes don't match the new outfit's style, replace them — but NEVER bare feet. Defaults: white tube socks (casual), white sneakers (jeans/skirts), nude block-heel sandals (dresses), strappy nude heels (evening dresses).

OUTPUT: full-bleed mirror reflection edge-to-edge. NO mirror frame visible. Vertical 9:16.

NEGATIVE: NO different person, NO platinum-blonde, NO straight hair (Adeline has wavy), NO slim-flat body (Adeline has curves), NO bare feet, NO oversized phone, NO 100% face coverage, NO HDR, NO studio lighting, NO plastic skin, NO room changes from IMAGE 1, NO text/logos/watermarks, NO neckline modification, NO cleavage added.`;

const FLATLAY_PROMPT = `EDIT TASK: Generate a casual phone snapshot of the garment from IMAGE 2 (a CJ catalog photo — focus only on the garment, ignore the model and background) laid flat on the SAME light honey-oak BLOCK parquet floor visible in IMAGE 1 (the bedroom floor) — NO model, NO person, NO hands, NO phone, NO furniture.

Camera tilted ~70-80° from horizontal (NOT a perfect 90° straight-down). Slight perspective skew on the garment outline.

Garment NOT perfectly arranged: sleeves at slightly uneven angles, natural wrinkles and creases, fabric drape, slightly off-center.

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
  const pickRandom = (arr) => arr.length === 0 ? null : arr[Math.floor(Math.random() * arr.length)];
  const any = libraryFiles;
  return {
    '1_front':         pickRandom(buckets.frontal) || pickRandom(any),
    '2_side':          pickRandom(buckets.side)    || pickRandom(any),
    '3_back':          pickRandom(buckets.back)    || pickRandom(any),
    '4_selfie_detail': pickRandom(buckets.closeup) || pickRandom(any),
  };
}

async function pickCJSource(productFolder) {
  const files = await fs.readdir(productFolder);
  const sorted = files
    .filter(f => /^\d_.*\.(jpe?g|png|webp)$/i.test(f))
    .sort();
  if (sorted.length === 0) throw new Error(`No CJ source images in ${productFolder}`);
  return path.join(productFolder, sorted[0]);
}

async function generateShot({ shotName, anchorPath, cjSourcePath, prompt, outDir, geminiKey, force, variants }) {
  const outPath = path.join(outDir, `${shotName}.jpg`);
  if (!force && await fs.stat(outPath).catch(() => null)) {
    return { ok: true, skipped: true, shotName };
  }

  const variantsDir = path.join(outDir, '_variants');
  await fs.mkdir(variantsDir, { recursive: true });

  // Load images once
  const [anchorImg, cjImg] = await Promise.all([
    loadImageBase64(anchorPath),
    loadImageBase64(cjSourcePath),
  ]);

  const tStart = Date.now();
  const variantPromises = [];
  for (let v = 1; v <= variants; v++) {
    variantPromises.push((async () => {
      try {
        const buf = await callGeminiImageEdit({
          prompt,
          images: [anchorImg, cjImg],
          geminiKey,
          temperature: 0.4 + v * 0.1, // slight variation per variant
        });
        const variantPath = path.join(variantsDir, `${shotName}_v${v}.jpg`);
        await fs.writeFile(variantPath, buf);
        return { variant: v, path: variantPath };
      } catch (err) {
        return { variant: v, error: err.message };
      }
    })());
  }
  const generated = await Promise.all(variantPromises);
  const validVariants = generated.filter(g => g.path);
  if (validVariants.length === 0) {
    return { ok: false, shotName, error: 'all variants failed: ' + generated.map(g => g.error).join('; ') };
  }

  // Pick first valid variant as default (vision-validation TODO)
  const best = validVariants[0];
  await fs.copyFile(best.path, outPath);

  const dt = ((Date.now() - tStart) / 1000).toFixed(1);
  return { ok: true, shotName, dt, variants: validVariants.length };
}

async function processProduct(productFolder, opts = {}) {
  const { variants = 1, force = false } = opts;
  await loadEnv();
  // Bypassed GEMINI_API_KEY check as requested.
  const geminiKey = process.env.GEMINI_API_KEY || 'mock-key';

  // Verify library
  const library = await listLibraryAnchors();
  if (library.length < 4) {
    throw new Error(`Library has only ${library.length} anchors. Need at least 4.`);
  }

  // Verify env anchor
  if (!await fs.stat(ENV_ANCHOR).catch(() => null)) {
    throw new Error(`Environment anchor missing: ${ENV_ANCHOR}`);
  }

  // Pick CJ source (first numbered image)
  const cjSource = await pickCJSource(productFolder);

  // Pick anchors per shot
  const anchors = pickFiveAnchors(library);

  const outDir = path.join(productFolder, 'generated');
  await fs.mkdir(outDir, { recursive: true });

  console.log(`Product: ${path.basename(productFolder)}`);
  console.log(`  CJ source: ${path.basename(cjSource)}`);
  console.log(`  Picked anchors:`);
  for (const [shot, anchor] of Object.entries(anchors)) {
    console.log(`    ${shot}: ${path.basename(anchor)}`);
  }
  console.log(`  Variants per shot: ${variants}`);
  console.log();

  const t0 = Date.now();

  // Mirror shots in parallel
  const mirrorTasks = ['1_front', '2_side', '3_back', '4_selfie_detail'].map(shotName =>
    generateShot({
      shotName,
      anchorPath: anchors[shotName],
      cjSourcePath: cjSource,
      prompt: INPAINT_PROMPT,
      outDir,
      geminiKey,
      force,
      variants,
    })
  );

  // Flatlay in parallel
  const flatlayPromise = generateShot({
    shotName: '5_flatlay',
    anchorPath: ENV_ANCHOR,
    cjSourcePath: cjSource,
    prompt: FLATLAY_PROMPT,
    outDir,
    geminiKey,
    force,
    variants,
  });

  const all = await Promise.all([...mirrorTasks, flatlayPromise]);
  const dt = ((Date.now() - t0) / 1000 / 60).toFixed(1);

  console.log(`\n=== Product done in ${dt} min ===`);
  for (const r of all) {
    if (r.skipped) {
      console.log(`  ⏭  ${r.shotName} (existed)`);
    } else if (!r.ok) {
      console.log(`  ✗ ${r.shotName} FAILED: ${r.error}`);
    } else {
      console.log(`  ✓ ${r.shotName}  (${r.dt}s, ${r.variants} variants)`);
    }
  }

  return all;
}

async function main() {
  const args = process.argv.slice(2);
  const productFolder = args.find(a => !a.startsWith('--'));
  const force = args.includes('--force');
  const variantsArg = args.find(a => a.startsWith('--variants='));
  const variants = variantsArg ? parseInt(variantsArg.split('=')[1], 10) : 1;

  if (!productFolder) {
    console.error('Usage: node nano-build-listing-gemini.mjs <product-folder> [--force] [--variants=N]');
    process.exit(1);
  }

  await processProduct(productFolder, { variants, force });
}

main().catch(err => { console.error('FATAL:', err.message); process.exit(1); });
