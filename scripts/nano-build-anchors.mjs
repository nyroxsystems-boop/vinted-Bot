#!/usr/bin/env node
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
  try {
    const raw = await fs.readFile(ENV_PATH, 'utf8');
    for (const line of raw.split('\n')) {
      const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
    }
  } catch (err) {
    console.warn(`Could not load .env: ${err.message}`);
  }
}

async function callGeminiImageAPI(prompt, imagePaths = []) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY is missing in system/.env');

  const parts = [{ text: prompt }];

  for (const imgPath of imagePaths) {
    const imgData = await fs.readFile(imgPath);
    const ext = path.extname(imgPath).toLowerCase();
    const mimeType = ext === '.png' ? 'image/png' : 'image/jpeg';
    parts.push({
      inline_data: {
        mime_type: mimeType,
        data: imgData.toString('base64')
      }
    });
  }

  const payload = {
    contents: [{ parts }]
  };

  const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image-preview:generateContent';
  
  let lastErr;
  for (let i = 0; i < 4; i++) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'x-goog-api-key': apiKey,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        throw new Error(`Gemini API Error ${res.status}: ${await res.text()}`);
      }

      const data = await res.json();
      
      const candidateParts = data.candidates?.[0]?.content?.parts;
      if (!candidateParts) throw new Error('Unexpected API response structure');

      for (const part of candidateParts) {
        if (part.inline_data && part.inline_data.data) {
          return Buffer.from(part.inline_data.data, 'base64');
        }
      }

      throw new Error('No image returned in API response');
    } catch (err) {
      lastErr = err;
      const wait = 3000 * (i + 1);
      console.log(`  retry ${i + 1}/4 after ${wait}ms (${err.message})`);
      await new Promise(r => setTimeout(r, wait));
    }
  }
  throw lastErr;
}

const BEDROOM_SPEC = \`Modern bedroom corner. The composition is an edge-to-edge mirror reflection. Inside the reflection: To the left, a tall white wardrobe. To the right, a wide white dresser with multiple horizontal drawers. On top of the dresser sits a white vase with pink flowers. The floor is light oak wood mosaic parquet (classic wood squares in a checkerboard pattern). White walls. Warm natural indoor lighting, candid iPhone snapshot aesthetic. NO PERSON in the reflection — the bedroom is empty. The photo is the exact mirror reflection edge-to-edge.\`;

const PERSONA_SPEC = \`20-year-old European woman. She has a very slim, straight, petite figure (no hourglass, no big curves, naturally thin, slender arms, narrow hips, thin waist). Long sleek straight blonde hair with slightly darker roots. Beautiful, natural, soft sweet facial features, small nose, soft jawline, subtle pink lips, minimal natural makeup, very slight tan. Authentic, everyday pretty aesthetic.\`;

const ENVIRONMENT_PROMPT = \`Generate an empty bedroom with the following aesthetic: \${BEDROOM_SPEC}. Aspect Ratio: 9:16. No person in the shot. Ensure it looks like a realistic candid photo.\`;

const MODEL_PROMPT = \`Generate a realistic 9:16 aspect ratio photo. Use the two input images as references. Image 1 is the face reference. Image 2 is the exact bedroom setting. 
The subject should match this description: \${PERSONA_SPEC}. 
She is standing as a mirror-selfie in the EXACT bedroom from Image 2 (matching the white wardrobe, the white dresser, and the parquet floor). 
She is wearing a simple white ribbed tank top, white high-waisted bike shorts, and white tube socks (no shoes). 
She holds an iPhone in her right hand at chest height, left hand at her side. 
Soft hip-pop, weight on right leg. Full-frame mirror selfie. 
CRITICAL: Do NOT use real people. Generate synthetically based on the provided synthetic face. Do NOT alter the room from Image 2. Copy the face exactly from Image 1.\`;

async function main() {
  await loadEnv();
  
  const force = process.argv.includes('--force');
  await fs.mkdir(ANCHOR_DIR, { recursive: true }).catch(() => {});

  if (!await fs.stat(FACE_REF).catch(() => null)) {
    console.error(`Missing synthetic face reference at ${FACE_REF}`);
    process.exit(1);
  }

  // Environment
  const envExists = await fs.stat(ENV_OUT).catch(() => null);
  if (envExists && !force) {
    console.log(`[1/2] Skipping environment.jpg (already exists)`);
  } else {
    console.log(`[1/2] Generating environment.jpg...`);
    const t1 = Date.now();
    const envBuffer = await callGeminiImageAPI(ENVIRONMENT_PROMPT, []);
    await fs.writeFile(ENV_OUT, envBuffer);
    console.log(`  ✓ environment.jpg saved (${((Date.now() - t1) / 1000).toFixed(1)}s)`);
  }

  // Model
  const modelExists = await fs.stat(MODEL_OUT).catch(() => null);
  if (modelExists && !force) {
    console.log(`[2/2] Skipping model.jpg (already exists)`);
  } else {
    console.log(`[2/2] Generating model.jpg...`);
    const t2 = Date.now();
    const modelBuffer = await callGeminiImageAPI(MODEL_PROMPT, [FACE_REF, ENV_OUT]);
    await fs.writeFile(MODEL_OUT, modelBuffer);
    console.log(`  ✓ model.jpg saved (${((Date.now() - t2) / 1000).toFixed(1)}s)`);
  }
}

main().catch(err => { console.error('FAIL:', err.message); process.exit(1); });
