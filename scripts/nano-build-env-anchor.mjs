#!/usr/bin/env node
// Generates anchor_environment.jpg — the canonical dressing area / closet room
// used as the room reference for every listing photo.
//
// Rules of this room:
// - Edge-to-edge mirror reflection, NO mirror frame visible anywhere
// - Lived-in dressing area, NOT hotel-perfect Pinterest bedroom
// - Block parquet (NOT herringbone, NOT chevron, NOT marble)
// - Warm uneven interior light (window + 1 LED)
// - Small natural clutter (bag, shoes, slightly hung clothes)

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENV_PATH = path.join(__dirname, '..', '.env');
const ENV_OUT = '/Users/home/Vinted/_anchors/anchor_environment.jpg';

async function loadEnv() {
  const raw = await fs.readFile(ENV_PATH, 'utf8');
  for (const line of raw.split('\n')) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

const ENV_PROMPT = `Generate one realistic photo of an empty dressing area, framed as if the entire image IS the surface of a large frameless wall mirror. Aspect ratio 9:16.

ROOM CONTENT visible in the reflection:
- LEFT side: a white open IKEA PAX wardrobe with hanging clothes inside, slightly uneven (some on hangers, some folded on a shelf, a small stack of 2-3 cardboard / shoe boxes on top — NOT luxury orange Hermès boxes, just plain cardboard / neutral storage boxes).
- RIGHT side: a simple white IKEA Malm 3-drawer dresser, with a small ceramic vase holding a few real-looking fresh flowers, a small framed art print propped casually against the wall behind, a couple of small jewellery / perfume items.
- FLOOR: warm honey-oak BLOCK parquet (square tiles in a basket-weave / fingerblock pattern). NOT herringbone, NOT chevron, NOT marble, NOT tile. Subtle real-world wear visible: faint scuffs, tiny dust specks in the light, slight color variation between blocks.
- WALLS: off-white painted walls with subtle uneven texture, maybe a wall outlet or light switch visible. NOT pristine, NOT freshly painted.
- LIGHTING: warm interior light — natural daylight coming from a window on one side, plus one warm LED ceiling spot. Real shadows in corners. Bright spots only where the LED hits directly. NOT flat HDR studio, NOT bright catalog white.
- LIVED-IN clutter: a slumped tote bag on the floor near the wardrobe, a pair of small sneakers / sandals off to the side, maybe a folded jumper or sock on the dresser corner. Feels like someone actually lives here.

MIRROR — STRICT:
- The image edge IS the mirror edge. The output fills the entire frame edge-to-edge as if the photo file is the mirror surface itself.
- NO golden ornate frame, NO arched frame, NO rectangular frame, NO wood frame, NO black frame, NO rim, NO border, NO mirror-edge gradient. NO visible frame anywhere in the photo, on any side.
- Slight phone wide-angle distortion at the very edges is fine.

CAMERA / STYLE:
- Looks like a candid iPhone snapshot of an empty room, not a polished interior magazine shot.
- Slightly soft, mild sensor grain in shadows, warm tone, slight off-center framing.
- Empty room — NO PERSON anywhere in the reflection.

NEGATIVE: NO person, NO mirror frame of any kind, NO herringbone floor, NO chevron floor, NO marble, NO tile, NO Pinterest aesthetic, NO Hermès orange boxes, NO HDR, NO catalog studio light, NO plastic look, NO text, NO logos, NO watermark.`;

async function callGeminiImageAPI(prompt) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY missing in system/.env');
  const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-image-preview:generateContent';
  const payload = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { responseModalities: ['IMAGE'] },
  };

  let lastErr;
  for (let i = 0; i < 4; i++) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'x-goog-api-key': apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 300)}`);
      const data = await res.json();
      const parts = data.candidates?.[0]?.content?.parts;
      if (!parts) throw new Error('No content.parts in response');
      for (const part of parts) {
        const inline = part.inline_data || part.inlineData;
        if (inline?.data) return Buffer.from(inline.data, 'base64');
      }
      throw new Error('No image in response');
    } catch (err) {
      lastErr = err;
      const wait = 3000 * (i + 1);
      console.log(`  retry ${i + 1}/4 after ${wait}ms (${err.message})`);
      await new Promise(r => setTimeout(r, wait));
    }
  }
  throw lastErr;
}

async function main() {
  await loadEnv();
  const force = process.argv.includes('--force');
  if (!force && await fs.stat(ENV_OUT).catch(() => null)) {
    console.log(`anchor_environment.jpg already exists. Use --force to regenerate.`);
    return;
  }
  console.log(`Generating anchor_environment.jpg…`);
  const t0 = Date.now();
  const buf = await callGeminiImageAPI(ENV_PROMPT);
  await fs.writeFile(ENV_OUT, buf);
  console.log(`  ✓ saved (${((Date.now() - t0) / 1000).toFixed(1)}s) → ${ENV_OUT}`);
}

main().catch(err => { console.error('FAIL:', err.message); process.exit(1); });
