#!/usr/bin/env node
// Generates anchor_persona_front.jpg + anchor_persona_back.jpg
// from:
//   anchor_persona_face.jpg  (identity / face / hair lock)
//   anchor_environment.jpg   (room / floor / lighting lock)
//
// Output is the SAME woman in the new dressing-room environment, in a NEUTRAL outfit
// (white ribbed tank top + black bike shorts + white tube socks) so listing-time
// garment swaps stay clean and the anchor outfit never bleeds into the listing.

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENV_PATH = path.join(__dirname, '..', '.env');
const A = '/Users/home/Vinted/_anchors';
const FACE = path.join(A, 'anchor_persona_face.jpg');
const ENV  = path.join(A, 'anchor_environment.jpg');
const FRONT_OUT = path.join(A, 'anchor_persona_front.jpg');
const BACK_OUT  = path.join(A, 'anchor_persona_back.jpg');

async function loadEnv() {
  const raw = await fs.readFile(ENV_PATH, 'utf8');
  for (const line of raw.split('\n')) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

const PERSONA_BLOCK = `PERSONA — match the FACE of the woman shown in IMAGE 1:
- Same face geometry, same hazel-blue-green eyes, same nose, same lips, same soft natural features as IMAGE 1.
- Same long dark brown wavy hair with subtle balayage / lighter mid-tone highlights, middle-parted, falling past her shoulders.
- Same lightly-tanned Mediterranean skin tone with subtle natural texture (fine pores visible, no plastic-smooth filter).
- She is 21-23 years old.

BODY — CRITICAL — IGNORE the body proportions visible in IMAGE 1, use the description below instead:
The woman in IMAGE 1 is shown only as a close-up bust shot — her body is NOT visible. For the full-body shot you are generating now, give her a pronounced natural HOURGLASS body shape:
- WAIST: sharply cinched small waist, visibly much narrower than her ribcage and hips. The waist-to-hip ratio is clearly visible from any angle.
- BUST: full, naturally rounded, firm bust, visibly larger than a typical petite-fashion-model frame. The bust pushes the white ribbed tank top outward with a visible feminine curve at the chest. Not exaggerated, but distinctly fuller than flat.
- GLUTES: full, naturally rounded, firm glutes that project clearly outward — visible curve from front, side and back. The black bike shorts hug her glutes and you can clearly see the rounded shape.
- HIPS: noticeably wider than ribcage — strong waist-to-hip differential. Hips are wider than shoulders.
- THIGHS: lean and toned but with a clear feminine roundedness on the outer side, soft thigh gap.
- SHOULDERS / ARMS: narrow shoulders, slim toned arms, slim wrists. Upper body is petite to make the hourglass differential more visible.
- OVERALL silhouette: sportlich-curvy hourglass like a Pilates / glute-training girl. Clearly more curvy than a typical fashion-model. NOT BBL-fake, NOT cartoonish, but distinctly hourglass-shaped, distinctly fuller bust + fuller glutes than petite.
- This body shape is NON-NEGOTIABLE — do not slim her down, do not flatten her bust, do not flatten her glutes.`;

const ROOM_BLOCK = `ROOM — match the EXACT room shown in IMAGE 2 (the environment reference):
- Same lived-in dressing area: white IKEA PAX wardrobe LEFT with hanging clothes inside (uneven, real-looking), neutral cardboard / storage boxes on top.
- Same white IKEA Malm dresser RIGHT with vase + flowers and a small framed art print propped against the wall.
- Same warm honey-oak BLOCK parquet floor (square tile pattern, NOT herringbone, NOT chevron).
- Same off-white walls with subtle uneven texture.
- Same warm uneven interior lighting — natural daylight + one warm LED ceiling spot.
- Same lived-in clutter (tote bag on floor, pair of sneakers off to the side) where shown.
- The mirror is the same large rectangular wall mirror as in IMAGE 2. Reproduce the same framing — the photo shows the mirror reflection, with possibly thin wall edges visible at the very sides like in IMAGE 2 (do not invent a new ornate frame, do not invent a golden arch).

NEGATIVE for the room: NO golden ornate mirror frame, NO arched mirror, NO herringbone floor, NO chevron floor, NO marble, NO white bed, NO Pinterest-perfect aesthetic, NO Hermès orange boxes.`;

const OUTFIT_BLOCK = `OUTFIT — neutral, garment-swap-friendly:
- Plain white ribbed cotton tank top, fitted at her waist, scoop neckline (no logos, no print, no graphics).
- Plain black mid-rise bike shorts (cotton/spandex blend), about mid-thigh length.
- White crew tube ankle socks, no shoes.
- One thin gold necklace at the collarbone, one thin gold bangle on her wrist, 1-2 thin gold rings on the fingers. NO other jewellery.
- NO bag, NO sunglasses, NO hat.`;

const PHONE_BLOCK = `PHONE — small palm-sized iPhone Pro:
- Real iPhone Pro, ~7 cm wide, smaller than her face. 3-lens camera bump in upper-left of the back.
- Clear/white silicone case with a subtle small accessory.
- Held in her right hand, four fingers around the back-left edge, thumb on screen.

PHONE COVERAGE — ABSOLUTE NON-NEGOTIABLE RULE OF THIS PROMPT:
- Her PHONE-HOLDING HAND IS RAISED to face / forehead level. The phone is positioned DIRECTLY IN FRONT OF her EYES.
- Her EYES, NOSE BRIDGE, and UPPER CHEEKS are 100% BLOCKED by the back of the phone in the reflection. Eyes are NEVER visible behind, around, or beside the phone.
- Only her mouth, chin, jawline (below the phone) and hairline at the top of the head MAY be partially visible. Total face coverage 85-95%.
- The phone follows her body angle (diagonal when she's 3/4-turned, frontal when she's frontal-to-mirror), but its center is ALWAYS aligned with her eye-line.
- This rule OVERRIDES anything else: never produce an anchor with an exposed unobstructed face.`;

const AUTHENTICITY_BLOCK = `AUTHENTICITY:
- Output looks like a candid iPhone mirror selfie, NOT a studio shot, NOT HDR.
- Mild natural sensor grain in shadows, slight warm color shift, slight phone-cam soft edges.
- Real skin texture with subtle imperfections, fine pores visible.
- Slight off-center framing, natural hand-held tilt.
- Mirror reflection fills the frame as much as possible — the visible mirror surface is the main content of the photo.

NEGATIVE: NO oversized phone, NO bare feet, NO HDR, NO catalog studio lighting, NO plastic skin, NO different person, NO blonde or platinum hair, NO straight-poker hair, NO fake-looking body, NO golden ornate mirror frame, NO herringbone floor, NO white bed in the reflection, NO text, NO logos, NO watermarks.`;

const FRONT_PROMPT = `Generate ONE authentic candid iPhone mirror selfie of the woman from IMAGE 1, standing in the room from IMAGE 2. Vertical 9:16 aspect ratio.

INPUTS:
- IMAGE 1 = persona / face / identity reference. Lock her face, hair, skin tone from this image. Ignore the surroundings of IMAGE 1.
- IMAGE 2 = room / environment reference. Lock the room, furniture, floor, lighting from this image. Ignore any clothing visible in IMAGE 2.

${PERSONA_BLOCK}

${ROOM_BLOCK}

${OUTFIT_BLOCK}

${PHONE_BLOCK}

POSE for this front anchor:
- Standing nearly FRONTAL to the mirror, full body head-to-feet visible.
- Soft natural hip pop to her right, weight on right leg, left knee slightly bent inward.
- Free LEFT hand resting relaxed at her side.
- RIGHT hand holds the iPhone at forehead/face height covering her eyes.
- Centered in the mirror, about 1.5m back. Wardrobe LEFT and dresser RIGHT both partially visible at the edges of the reflection.

${AUTHENTICITY_BLOCK}`;

const BACK_PROMPT = `Generate ONE authentic candid iPhone mirror selfie of the SAME woman from IMAGE 1, now seen from BEHIND, in the room from IMAGE 2. Vertical 9:16 aspect ratio.

INPUTS:
- IMAGE 1 = persona / face / identity reference. Lock her face, hair, skin tone from this image. Ignore the surroundings of IMAGE 1.
- IMAGE 2 = room / environment reference. Lock the room, furniture, floor, lighting from this image. Ignore any clothing visible in IMAGE 2.

${PERSONA_BLOCK}

${ROOM_BLOCK}

${OUTFIT_BLOCK}

${PHONE_BLOCK}

POSE for this back anchor:
- BACK turned to the mirror, full body head-to-feet visible.
- Upper torso gently twisted so she looks back over her RIGHT shoulder toward the mirror (3/4 back-profile of her face visible — phone covers eyes from this angle, only jawline/lip visible).
- Hair pulled to her LEFT side, cascading over her left shoulder so her upper back is unobstructed.
- Soft hip pop to her LEFT, weight on left leg. Her glutes project clearly outward (curvy hourglass body).
- RIGHT hand holds the iPhone high near her right ear / above shoulder. LEFT hand at her side.
- Centered in the mirror, about 1.5m back. Same room as IMAGE 2.

${AUTHENTICITY_BLOCK}`;

async function callGemini(prompt, imagePaths) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY missing');
  const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-image-preview:generateContent';
  const parts = [{ text: prompt }];
  for (const p of imagePaths) {
    const buf = await fs.readFile(p);
    parts.push({ inlineData: { mimeType: 'image/jpeg', data: buf.toString('base64') } });
  }
  const payload = {
    contents: [{ role: 'user', parts }],
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
      const cParts = data.candidates?.[0]?.content?.parts;
      if (!cParts) throw new Error('No content.parts in response');
      for (const part of cParts) {
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

  for (const f of [FACE, ENV]) {
    if (!await fs.stat(f).catch(() => null)) throw new Error(`Missing: ${f}`);
  }

  const tasks = [
    { name: 'front', out: FRONT_OUT, prompt: FRONT_PROMPT },
    { name: 'back',  out: BACK_OUT,  prompt: BACK_PROMPT },
  ];

  for (const task of tasks) {
    if (!force && await fs.stat(task.out).catch(() => null)) {
      console.log(`[${task.name}] exists, skipping`);
      continue;
    }
    console.log(`[${task.name}] generating…`);
    const t0 = Date.now();
    const buf = await callGemini(task.prompt, [FACE, ENV]);
    await fs.writeFile(task.out, buf);
    console.log(`  ✓ saved (${((Date.now() - t0) / 1000).toFixed(1)}s) → ${task.out}`);
  }
}

main().catch(err => { console.error('FAIL:', err.message); process.exit(1); });
