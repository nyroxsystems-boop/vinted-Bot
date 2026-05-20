import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SYSTEM_DIR = path.resolve(__dirname, '..');
const ENV_PATH = path.join(SYSTEM_DIR, '.env');
const ANCHORS_DIR = path.resolve(SYSTEM_DIR, '../_anchors');

async function loadEnv() {
  try {
    const envContent = await fs.readFile(ENV_PATH, 'utf8');
    for (const line of envContent.split('\n')) {
      if (line.trim().startsWith('#')) continue;
      const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
      if (match) {
        let key = match[1];
        let value = match[2] || '';
        value = value.replace(/(^['"]|['"]$)/g, '');
        if (!process.env[key]) process.env[key] = value;
      }
    }
  } catch (err) {
    console.warn(`[WARN] Could not load .env from ${ENV_PATH}`);
  }
}

const ANCHORS = {
    "front": path.join(ANCHORS_DIR, "anchor_persona_front.jpg"),
    "back":  path.join(ANCHORS_DIR, "anchor_persona_back.jpg"),
    "face":  path.join(ANCHORS_DIR, "anchor_persona_face.jpg"),
    "env":   path.join(ANCHORS_DIR, "anchor_environment.jpg"),
};

// === PERSONA — exakt aus den Anchor-Bildern, body slight curvy-boost ===
const PERSONA_BLOCK = `PERSONA — match the EXACT woman in the anchor reference image (do not invent a different person):
- Face: same face geometry as the anchor (hazel-green eyes, soft natural features, subtle pink lips, light natural makeup). She is 21-23 years old.
- Hair: long dark brown wavy hair with subtle balayage / lighter mid-tone highlights, middle-parted, falling past her shoulders. Slightly tousled natural wave (NOT poker-straight, NOT platinum, NOT bleached).
- Skin: lightly-tanned with subtle natural texture (visible fine pores, no plastic-smooth filter).
- BODY — pronounced natural hourglass: sharply cinched small waist, fuller naturally rounded firm bust visible through the fabric, fuller naturally rounded firm glutes that project clearly from any angle, full hips noticeably wider than ribcage, lean toned thighs with a clear thigh gap, slim toned arms. This is a sportlich-curvy hourglass body — clearly more curvy than typical fashion-model slim, but natural (not BBL-fake, not exaggerated cartoon). Keep proportions consistent across all shots.`;

// === ROOM — Ankleidezimmer, rahmenloser Edge-to-Edge-Spiegel, lived-in ===
const ROOM_BLOCK = `ROOM — keep IDENTICAL across all shots (use IMAGE 1 / anchor_environment as the canonical reference):
- This is a small lived-in dressing area / walk-in closet corner, NOT a hotel-perfect Pinterest bedroom.
- A white open IKEA PAX wardrobe on the LEFT with hanging clothes inside (uneven, real-looking), a couple of cardboard / shoebox stacks on top.
- A simple white IKEA Malm 3-6 drawer dresser on the RIGHT with a small ceramic vase + fresh-ish flowers and a small framed art print propped against the wall.
- Floor: warm honey-oak BLOCK parquet (square tile pattern, NOT herringbone, NOT chevron, NOT marble), with subtle real-world wear, faint scuffs, tiny dust specks.
- Off-white walls with subtle uneven paint, possibly a small wall outlet or light switch visible.
- Lighting: WARM uneven interior light — natural daylight from a side window mixed with one warm LED ceiling spot. Real shadows in corners, bright spots only directly under the LED. NOT flat studio HDR.
- Small lived-in clutter where natural: a tote bag slumped on the floor, a pair of shoes off to the side, maybe a folded jumper on the dresser corner — feels like someone actually lives here.

MIRROR — full-bleed, NO frame visible:
- The output IS the mirror surface itself, edge-to-edge. The image fills the entire frame as if the photo file equals the mirror glass.
- NO golden ornate arch frame, NO rectangular black frame, NO wood frame, NO rim, NO border, NO mirror-edge gradient. The mirror has NO visible frame anywhere in the shot.
- Slight phone-camera wide-angle distortion at the very edges is fine. NO vignette.`;

// === PHONE — small, covers eyes, never less than 80% face coverage ===
const PHONE_BLOCK = `PHONE — small palm-sized iPhone Pro:
- Real iPhone Pro, ~7 cm wide × 15 cm tall, roughly 1/3 of her shoulder width, smaller than her face.
- Visible 3-lens camera bump in upper-left of the back. Clear/white silicone case with a subtle small accessory (pink heart popsocket OR plain). Four fingers naturally around the back-left edge, thumb on screen. One thin gold ring on the fingers, slim gold bangle on the wrist.

PHONE COVERAGE — THE SINGLE MOST IMPORTANT RULE OF THIS PROMPT, OVERRIDES ALL OTHER POSE/FRAMING/CAMERA DESCRIPTIONS:
- Her HAND HOLDING THE PHONE IS RAISED to FACE / FOREHEAD LEVEL so the phone is positioned DIRECTLY IN FRONT OF her EYES.
- Her EYES, NOSE BRIDGE, and UPPER CHEEKS are ALWAYS fully blocked by the back of the phone. Eyes are NEVER visible behind, around, or beside the phone.
- The phone covers AT MINIMUM 85% of her face in EVERY model shot — INCLUDING the close-up zoom shot.
- Only her mouth, chin, and jawline (below the phone) MAY be partially visible. Hairline at the top of the head may be visible above the phone.
- This is non-negotiable. If the pose description below says "phone at chest height" or "phone in hand at hip", you STILL raise the phone-holding hand UP TO HER FACE so the phone blocks her eyes. The phone is always positioned where her face would be in the photo.
- If the framing/camera description below describes the camera being at hip height or chest height — that refers to WHERE THE CAMERA (the phone itself) IS HELD in her hand, but in the REFLECTION her hand is raised so the phone is in front of her face. Never expose the eyes. Better to over-cover than under-cover.`;

const AUTHENTICITY_BLOCK = `AUTHENTICITY:
- Slightly soft iPhone front-camera quality with mild natural sensor grain in shadow areas, mild JPEG compression, slight warm color shift typical of iPhone front-cam.
- Real skin texture with subtle imperfections: fine pores, slight uneven tone, faint freckle here or there. NO smoothing filter, NO airbrush, NO plastic look, NO HDR, NO studio lighting.
- Slight off-center framing, hand-held tilt, NOT tripod-perfect, NOT catalog-symmetrical.
- The room shows lived-in detail (uneven hung clothes in wardrobe, dust specks on floor, slightly crooked items on dresser).

NEGATIVE: NO mirror frame visible at any edge, NO border, NO oversized phone, NO bare feet, NO HDR, NO catalog studio lighting, NO plastic-smooth skin, NO catalog pose, NO room/furniture changes from IMAGE 1, NO body slimmed-down or flattened, NO platinum hair, NO bleached blonde, NO straight-poker hair, NO different person, NO text, NO logos, NO watermarks, NO eyes visible behind/around the phone, NO golden ornate mirror frame, NO herringbone floor, NO chevron floor.`;

// === GARMENT-Handling ===
const GARMENT_BLOCK = `GARMENT — place this exact garment on her body (from the garment reference image):
Match perfectly: color hue and saturation, fabric type and finish, cut and length (mini stays mini, midi stays midi), neckline shape, sleeve length, waist detail, prints, patterns, buttons, zippers, ties. The neckline matches the garment reference exactly — do not deepen, do not add cleavage that isn't in the garment.

CRITICAL — GARMENT HUGGING HER FIGURE:
The garment SITS ON her body in a way that REVEALS her hourglass silhouette, not hides it. Specifically:
- Fabric DRAPES AGAINST her curves at the bust, sharply cinched waist, and full hips/glutes — even slightly loose fabrics should show the body line underneath.
- If the garment has a defined waist (belt, cinch, elastic, fitted seam), it is pulled snug — her waist-to-hip ratio reads CLEARLY in the silhouette.
- If the garment is flowy (dress, blouse, pleated skirt), it still drapes from her shoulders and bust over her body — you can read the body shape through the drape. NEVER let the fabric balloon out and hide her shape.
- For fitted garments (bodycon, ribbed, jersey, lycra): the garment HUGS her bust, waist, and hips like a second skin — every curve visible.
- The garment's silhouette should make her body look its sexiest natural self — model-girlfriend energy, not catalog-neutral.
- Small realistic wrinkles where fabric meets her waist and hips (sitting/standing creases) are fine — they actually emphasize the curves.
- Bust fills out the chest area of the garment naturally — the bust line is visible through any fabric.
- Hips fill out the hip area of the garment naturally — visible curve outward from waist.
- Glutes visibly round the back of the garment — when seen from side or back, the rear projects out.

GARMENT-SCOPE rule — what she wears on the OTHER half of her body when the garment covers only one half (CRITICAL for consistency across the 3 model shots of this listing):
- If the garment is a FULL DRESS / FULL JUMPSUIT / FULL SET (covers both top and bottom): she wears ONLY this garment, no other top, no other bottom layered on.
- If the garment is a TOP only (shirt, blouse, tank, sweater, hoodie, jacket): she pairs it with PLAIN BLACK MID-RISE BIKE SHORTS (the same neutral bottom as the persona anchor). Do NOT swap to jeans, leggings, skirt, or anything else.
- If the garment is a BOTTOM only (jeans, pants, leggings, shorts, skirt): she pairs it with a PLAIN WHITE RIBBED COTTON TANK TOP, scoop neckline, fitted at the waist, NO crop, NO crop-top, NO sports bra — the tank reaches to her natural waistline so a sliver of the garment's waistband may be visible. Do NOT swap the tank for a crop-top, t-shirt, blouse, hoodie, or anything else.
- If the garment is OUTERWEAR (a jacket / blazer / coat): she wears it OPEN over the plain white ribbed tank top + plain black bike shorts.
- The paired neutral pieces stay IDENTICAL across all 3 model shots (front / side / zoom) — same tank, same shorts, no swaps.`;

// === SHOT-spezifische Pose-Variationen ===
// 14 Varianten pro Shot — deutlich mehr Spread für 50+ Listings.
const POSE_POOL = {
  "1_front": [
    "STRONG hip pop to her right with weight fully on right leg, hip pushed visibly out to her right, left leg slightly bent and crossed inward. Free left hand resting on her thigh. This pose maximally shows the waist-to-hip curve. Phone in right hand at forehead height.",
    "STRONG hip pop to her left with weight fully on left leg, free RIGHT hand on her left hip with elbow popped clearly out (creates triangle showing waist cinch). Phone in left hand at face level.",
    "Wide CONFIDENT stance feet shoulder-width apart, body slightly arched — chest naturally forward, glutes naturally back — body line maximally visible. Free hand brushing through hair on one side. Phone at face level.",
    "One foot stepped clearly forward, weight on back leg, hip popping to the side over the back foot. Free hand cupping the back of her neck (elbow popped showing arm line + bust line). Phone at forehead height.",
    "Body twisted slightly to her right (3/4 nearly frontal), free hand pinching the garment fabric at her waist — clearly defining the waist line. Phone at chest height angled up to cover face.",
    "Frontal stance, free hand running fingers slowly through hair lifted away from neck (creates lifted-bust silhouette). Phone at face level covering eyes.",
    "Frontal stance, free hand resting flat on her own collarbone — chest naturally pushed slightly forward by the relaxed shoulder. Phone at face level.",
    "One foot crossed casually behind the other (dancer-stance), hip pops to that side, free hand at side. Phone at chest height tilted up.",
    "Frontal, head TILTED to her right ear-toward-shoulder, free hand pinching garment fabric at the side waist (showing cinch). Phone in opposite hand at forehead height.",
    "Frontal, BOTH hands raised: one holds phone in front of face, the other lifted to brush hair back behind ear — both arms up emphasizes bust + slim waist below.",
    "One foot up on tiptoe (back heel lifted), playful stretch creating elongated leg line, free hand on hip with elbow popped. Phone at face level.",
    "Slight forward lean toward the mirror as if checking outfit, free hand fingertip resting on dresser surface — creates a leaned-in pose where bust is naturally prominent. Phone at chest height.",
    "Frontal, free hand resting flat on her own stomach over the garment waist area (palm flat showing the slim waist underneath). Phone at face level.",
    "Frontal, free hand thumb hooked into the waistband/belt-loop/hem area of the garment, elbow relaxed but pulling the fabric snug against the hip. Phone at face level.",
  ],
  "2_side": [
    "Rotated 40° to her LEFT, STRONG S-curve: weight on left back leg, right leg forward, hip pushed sharply left, glutes naturally projected back. Free hand on left hip with elbow popped — silhouette maximally curvy. Phone in right hand at chest height angled diagonally.",
    "Rotated 45° to her RIGHT, S-curve stance with sharp hip-out, free hand running through hair (lifts bust line). Phone at chest height angled diagonally with body. Profile of cheek/jaw partially visible — eyes covered.",
    "Rotated 30° to her LEFT, free hand resting flat on stomach over the cinched waist of the garment — palm flat shows the slim waist. Phone diagonally at chest height covering eyes.",
    "Near-side profile ~70° to her LEFT, hip pushed back creating arched-back silhouette where bust and glutes are both maximally visible in profile. Free hand at side. Phone held in extended right hand diagonally.",
    "Rotated 40° to her RIGHT with one knee slightly bent forward, free hand sliding along the curve of her hip-line — finger trace draws the eye to the hip curve. Phone diagonal at chest height.",
    "Rotated 35° to her LEFT, free hand at the back of her neck with elbow popped wide out (showcases bust line + arm). Phone in right hand diagonally at face height.",
    "Rotated 50° to her RIGHT, free hand pinching the garment fabric INWARD at the side waist — actively cinching the silhouette to show how snug the waist sits. Phone diagonal at chest height.",
    "Rotated 30° to her LEFT, weight shifted dramatically onto back hip, front leg crossed playfully forward at the ankle. Free hand resting on dresser surface for casual lean. Phone diagonal at chest height.",
    "BACK-3/4 angle (~120° turn), most of her back to the mirror, head twisted over her RIGHT shoulder. Free hand on her hip from behind (frames glutes). Phone held high near right ear. Glutes + back arch clearly visible.",
    "BACK-3/4 angle (~135° turn), hair pulled forward over right shoulder so upper-back is clean. Looking over LEFT shoulder. Phone held high above left shoulder. Free hand fingertip resting on the hem of the garment behind her — pulling fabric slightly snug against glutes.",
    "Rotated 50° to her LEFT, mid-step pose with one foot slightly forward as if pausing while walking, hip thrust out sharply on the rest leg. Free hand swinging slightly back. Phone diagonal at chest height.",
    "Rotated 60° to her RIGHT, very tight S-curve with one leg crossed in front of the other (creates exaggerated hourglass profile), free hand pulling the garment fabric at the side waist. Phone diagonal at face height.",
    "Rotated 25° to her LEFT (almost-frontal side), playful slight bend at the knees with weight on one hip, free hand brushing hair off shoulder lifting bust. Phone diagonal at chest height.",
    "Rotated 40° to her RIGHT, weight on far hip arching the back slightly (chest forward, glutes back), free hand running down the side of her thigh tracing the leg-line. Phone at chest height.",
  ],
  "3_zoom": [
    "CROP: frame her from MID-HIP up to just above her head (no thighs, no knees, no feet visible). Nearly frontal with slight torso lean toward the mirror, free hand lightly touching the neckline of the garment to draw attention to the cut. Phone in dominant hand at face level covering eyes — 90% face coverage, only lower lip and chin barely visible.",
    "CROP: frame her from MID-HIP up. Slight 3/4 angle to her left, free hand at the bottom hem of the top portion of the garment (or hand at waistband if garment is a bottom) showing fabric detail, phone at face level covering eyes.",
    "CROP: frame her from MID-HIP up. Frontal, free hand pinching the waist seam between top and bottom (or pinching one side of the waistband / belt area of the garment), phone at forehead height fully covering eyes and nose.",
    "CROP: frame her from MID-HIP up. 3/4 angle to her right, free hand at her collarbone area, phone diagonal at face level covering eyes 90%.",
    "CROP: frame her from MID-HIP up. Frontal-ish with subtle hip pop, free hand lightly lifting a sleeve or strap of the garment to show detail (or fingers at the waistband if bottom), phone at face level — eyes fully covered.",
    "CROP: frame her from MID-HIP up. Slight torso twist, free hand brushing hair off her shoulder so the neckline is unobstructed, phone at face level — only lower face partially visible.",
    "CROP: frame her from MID-HIP up. Frontal, free hand pulling the hem of the top slightly outward to show its drape (or finger hooked into the waistband if bottom), phone at face level fully blocking eyes and nose.",
    "CROP: frame her from MID-HIP up. Slight 3/4 angle, free hand touching the inside of her opposite elbow (relaxed crossed-arm vibe), phone at face level covering 90% of face.",
    "CROP: frame her from CHEST up (tighter than usual). Nearly frontal, free hand at one earring / earlobe area, phone at face level fully covering eyes — only chin and partial jaw visible.",
    "CROP: frame her from MID-HIP up. Body rotated 30° to LEFT, free hand resting flat on the dresser corner beside her, phone diagonal at face height covering eyes.",
    "CROP: frame her from MID-HIP up. Frontal, head clearly tilted toward right shoulder, free hand pinching a tiny detail (button / strap / charm) of the garment, phone at face level.",
    "CROP: frame her from MID-HIP up. Slight 3/4 angle, free hand thumb hooked under chin / cupping under chin briefly, phone at forehead height fully covering eyes and nose.",
    "CROP: frame her from MID-HIP up. Frontal, both hands visible: one holds phone at face, the other pulls a sleeve / strap straight to show fit. Phone covers eyes.",
    "CROP: frame her from MID-HIP up. Slight 3/4 angle to her right, free hand wrapped around her own opposite upper-arm (relaxed self-hug), phone diagonal at face height.",
  ],
};

function pickPose(shotName, seed) {
  const pool = POSE_POOL[shotName];
  if (!pool) return "casual relaxed mirror selfie pose.";
  // Deterministic but varied: hash product folder name to pick
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return pool[h % pool.length];
}

// Deterministic footwear per listing (hash the SEED, not the shot — so the same listing
// uses the same shoes across all model shots).
const FOOTWEAR_POOL = [
  "white crew tube ankle socks, no shoes (barefoot in socks on the parquet)",
  "clean white chunky sneakers (low-top white trainers, simple silhouette)",
  "clean white chunky sneakers (low-top white trainers, simple silhouette)",
  "neutral nude block-heel sandals (square toe, ankle strap)",
];

function pickFootwear(seed) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 17 + seed.charCodeAt(i)) >>> 0;
  return FOOTWEAR_POOL[h % FOOTWEAR_POOL.length];
}

// Per-listing FRAMING preset — same across all 3 model shots of one listing,
// but different between listings. Breaks the "every listing looks identical"
// AI-template feel by varying distance from mirror, vertical position in frame
// and camera height.
const FRAMING_POOL = [
  // Centered variations
  "Body position: ROUGHLY CENTERED in the mirror, about 1.5m back, head-to-feet, normal headroom. Slight upward iPhone-front-cam perspective.",
  "Body position: CENTERED, about 1.6m back, FULL head-to-feet with the floor edge visible at the bottom showing parquet pattern clearly.",
  // Off-center LEFT — varying degrees
  "Body position: SLIGHTLY LEFT OF CENTER (body at ~40% from left edge of mirror), 1.5m back. Empty mirror space on her right showing more dresser side.",
  "Body position: CLEARLY LEFT OF CENTER (body at ~30% from left edge), 1.6m back. Roughly 1/3 of the frame on her right is empty room — dresser + flowers + framed art clearly visible there.",
  "Body position: PUSHED FAR LEFT (body at ~25% from left edge), 1.4m back, taking a wide composition with lots of room visible to her right.",
  // Off-center RIGHT — varying degrees
  "Body position: SLIGHTLY RIGHT OF CENTER (body at ~60% from left edge), 1.5m back. Empty mirror space on her left showing wardrobe interior fully.",
  "Body position: CLEARLY RIGHT OF CENTER (body at ~68% from left edge), 1.6m back. Roughly 1/3 of the frame on her left is room — wardrobe with hanging clothes clearly framed.",
  "Body position: PUSHED FAR RIGHT (body at ~75% from left edge), 1.4m back, wide composition with lots of wardrobe interior visible to her left.",
  // Distance variations
  "Body position: CLOSER to the mirror (about 0.9m back), body fills the frame vertically with minimal headroom — very tight head-to-feet framing.",
  "Body position: FARTHER BACK (about 2.1m back) — visible empty space above head AND below feet, more of the dressing area visible all around her.",
  // Tilt variations — small natural hand-held tilt
  "Body position: HAND-HELD TILT clockwise ~4-7° — the entire reflection is rotated as if she held the phone slightly tilted. Centered in mirror, 1.5m back.",
  "Body position: HAND-HELD TILT counter-clockwise ~4-7°, slightly left of center, 1.4m back.",
  "Body position: HAND-HELD TILT clockwise ~3°, slightly right of center, 1.5m back. Subtle natural tilt.",
  // Camera height variations
  "Body position: 1.3m back. Camera (phone) held at HIP HEIGHT, phone arm raised to face — slight upward look at her body, legs look slightly elongated (wide-angle effect). Centered.",
  "Body position: 1.5m back. Camera held at SHOULDER HEIGHT (higher than usual), phone arm slightly bent — slightly downward look, head slightly more prominent. Slightly off-center left.",
  // Cropping variations
  "Body position: CENTERED but the BOTTOM of frame CUTS at her ankles/shoes (feet partially out of frame). 1.1m back. Casual quick-snap framing.",
  "Body position: SLIGHTLY LEFT OF CENTER, 1.5m back. TOP of the frame cuts slightly above her head (no extra headroom). Casual snapshot vibe.",
  "Body position: CENTERED, 1.5m back, EXTRA HEADROOM at top (visible ceiling spot light fully). Vertical breathing room above her.",
];

function pickFraming(seed) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 23 + seed.charCodeAt(i)) >>> 0;
  return FRAMING_POOL[h % FRAMING_POOL.length];
}

function buildModelPrompt({ shotName, poseDesc, footwear, framing, garmentDesc = "" }) {
  return [
    `Generate ONE authentic candid iPhone mirror selfie for a Vinted clothing listing. The output should look like a real 22-year-old quickly snapped this in her dressing area in the evening — natural, lived-in, slightly imperfect, NOT AI-perfect.`,
    ``,
    `INPUTS:`,
    `- IMAGE 1 = PERSONA + ROOM reference. Lock her face / hair / skin / body proportions from this image. The room around her is also the canonical setting — reproduce furniture, floor, walls, lighting consistently. Ignore the specific pose / outfit in IMAGE 1; pose and outfit for THIS shot are defined below.`,
    `- IMAGE 2 = optional second persona reference (back / face) when provided — use for additional identity / body detail. If conflict with IMAGE 1 about the room, IMAGE 1 wins.`,
    `- LAST IMAGE = GARMENT: clean PNG on transparent background, place this exact garment on her body.`,
    ``,
    PERSONA_BLOCK,
    ``,
    ROOM_BLOCK,
    ``,
    PHONE_BLOCK,
    ``,
    GARMENT_BLOCK,
    ``,
    `FOOTWEAR — FIXED for this listing (every shot of this listing uses EXACTLY this footwear, no variation):`,
    `She is wearing ${footwear}. Reproduce this footwear EXACTLY — do not swap to socks if I said sneakers, do not swap to sneakers if I said socks, do not swap to barefoot.`,
    ``,
    `FRAMING / CAMERA — fixed for THIS listing (all 3 model shots use this same camera vibe so the listing feels like one photoshoot moment, but different from other listings):`,
    framing,
    `Do NOT default to a perfectly centered tripod-style framing. The shot should feel like a casual quick mirror selfie, not a catalog product shot.`,
    ``,
    AUTHENTICITY_BLOCK,
    ``,
    `>>> SHOT-SPECIFIC POSE FOR THIS IMAGE <<<`,
    `Shot type: ${shotName}`,
    `Pose: ${poseDesc}`,
    `${garmentDesc}`,
  ].join('\n');
}

// === FLATLAY — Pool variabler Stile, deterministisch per Seed gewählt ===
const FLATLAY_STYLE_POOL = [
  `Composition: garment slightly LEFT of center, neckline at top with the whole garment rotated about 8-12° clockwise (not pin-aligned to frame). Camera angle about 70° (not perfect 90°). Sleeves splayed at uneven angles, one more bent than the other. Soft natural shadow falling to the right of the garment from window light.`,

  `Composition: garment fills most of the frame with one edge (a sleeve or hem) almost touching the image border. Distinctly off-center to the right, the whole frame slightly tilted clockwise. Camera angle about 65°, perspective visibly skewed.`,

  `Composition: garment roughly centered but rotated about 5° counter-clockwise. At the very edge of frame, a peek of a small lifestyle prop barely entering the frame — e.g. a corner of a folded knit, a wooden handle of a hairbrush, or the strap of a tote bag. The prop is NEVER the subject, just a tiny edge.`,

  `Composition: garment slightly RIGHT of center, hem toward the bottom-left so the garment lies diagonally across the frame at about 20°. Strong directional warm window-light from the upper-left creates a soft diagonal shadow of the fabric folds across the floor.`,

  `Composition: garment laid down very naturally — one sleeve partially folded under itself, the hem slightly crumpled at one corner, fabric with organic uneven folds as if just taken off and dropped on the floor. Garment roughly centered with subtle clockwise tilt. Camera angle about 75°.`,

  `Composition: garment relatively small in frame — more of the surrounding parquet floor visible around it. Garment positioned in the lower-center of frame with empty wood-grain floor above it. Camera angle about 70° from a slightly higher hold.`,

  `Composition: garment styled with one sleeve crossed casually over the body (or for a dress, the skirt portion slightly twisted to one side as if just thrown down). Off-center to the right, tilted about 6° clockwise. Camera angle about 72°.`,

  `Composition: garment fills most of frame with a steeper camera angle of about 62° — the floor stretches into perspective at the bottom of the image, you see the wood-grain pattern getting more compressed toward the top. Slight counter-clockwise tilt.`,

  `Composition: garment in upper portion of frame, with near the BOTTOM EDGE a small partial peek of a casual lifestyle item — e.g. one white sneaker, edge of a magazine, or corner of a folded cardigan — barely entering the bottom-right or bottom-left corner. Garment is the main subject. Camera angle about 70°.`,

  `Composition: garment centered but rotated about 8° clockwise. Camera angle about 68°. Soft uneven shadow falling on the LEFT side of the garment where the fabric meets the floor — late-afternoon side-light from a window. A few tiny dust specks visible in the angled light beam.`,
];

function pickFlatlayStyle(seed) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 29 + seed.charCodeAt(i)) >>> 0;
  return FLATLAY_STYLE_POOL[h % FLATLAY_STYLE_POOL.length];
}

function buildFlatlayPrompt(styleDesc) {
  return `Generate ONE authentic iPhone snapshot of a clothing item laid on a bedroom floor — the kind of casual photo someone takes for a Vinted listing in their dressing room. This is NOT a catalog product shot, NOT a studio flatlay, NOT a polished editorial — it is a quick handheld snapshot.

INPUT:
- IMAGE 1 = anchor_environment.jpg (defines the FLOOR: warm honey-oak BLOCK parquet, square tile pattern, NOT herringbone, NOT chevron, NOT marble, NOT tile — match floor color, wood grain, and the slight worn matte finish EXACTLY)
- IMAGE 2 = the garment reference. Use IMAGE 2 ONLY for the GARMENT itself — its color, fabric, cut, neckline, sleeves, length, prints, patterns, buttons, zippers, ties. Reproduce the garment EXACTLY in those aspects. IGNORE any background, hanger, or model in IMAGE 2.

${styleDesc}

GARMENT STYLING — AUTHENTICITY IS THE KEY THING:
- Fabric is NOT perfectly ironed, NOT perfectly symmetric, NOT perfectly laid out. Real natural drape and gentle wrinkles where fabric meets the floor or folds on itself.
- Sleeves at clearly UNEVEN angles (one more bent than the other). Hem can be slightly crumpled or curled at one corner.
- Light bulk and dimensionality — fabric is not pancake-flat, it has subtle hills and shadows from its own weight pulling against the floor.
- Tiny imperfections show this was actually placed on a real floor and not photoshopped: a thread sticking out somewhere, a faint crease across the chest area, a slightly off-center fold.

CAMERA AUTHENTICITY:
- Hand-held at hip-to-chest height looking down — NOT a tripod, NOT a perfect 90° top-down architectural angle.
- The frame has slight rotation as if the phone wasn't perfectly straight — a quick snap, not a studio shot.
- Slight phone-front-camera softness in the corners, very subtle vignetting, mild natural JPEG compression, faint warm color cast typical of iPhone snapshots.
- Lighting is warm and uneven: warm window daylight from one side, optional indoor LED spot — creating one stronger-lit side and one softer-shadowed side of the garment. Real shadow falls naturally on one side, not flat all around.
- The parquet floor shows subtle real-world wear: faint scuffs, tiny dust specks in the angled light, slight color variation between wood blocks.

THIS SHOULD LOOK like a private mirror-selfie-girl quickly snapped this on her bedroom floor with her iPhone before listing it on Vinted. Slightly imperfect, slightly off-axis, slightly warm-toned, slightly grainy in the shadows, slightly hand-held tilted.

NEGATIVE: NO model, NO person, NO hand, NO foot, NO phone in frame, NO furniture in frame, NO door, NO wall, NO bright white studio backdrop, NO HDR, NO heavy color grading, NO perfect 90° straight-down architectural angle, NO perfect symmetry, NO catalog vibe, NO Pinterest-perfect aesthetic, NO Shein/AliExpress watermark, NO herringbone floor, NO marble, NO tile, NO bed sheet under the garment, NO crisp ironed look, NO clinical lighting.`;
}

const SHOT_PLAN = [
    { name: "1_front",    anchors: ["front"],          aspect: "9:16" },
    { name: "2_side",     anchors: ["front"],          aspect: "9:16" },
    { name: "3_zoom",     anchors: ["front", "face"],  aspect: "4:5"  },
    { name: "4_flatlay",  anchors: ["env"],            aspect: "4:5"  },
];

async function checkAnchors() {
  for (const [key, anchorPath] of Object.entries(ANCHORS)) {
    try {
      await fs.access(anchorPath);
    } catch {
      console.error(`[ERROR] Missing anchor file: ${anchorPath} - Ask user, do not regenerate!`);
      process.exit(1);
    }
  }
}

async function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

function getMimeType(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    if (ext === '.png') return 'image/png';
    if (ext === '.webp') return 'image/webp';
    return 'image/jpeg';
}

async function callGemini(prompt, imagePaths, retries = 4) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error("GEMINI_API_KEY environment variable is not set");
    // Primary: gemini-3.1-flash-image-preview (highest quality, 1000/day quota).
    // Fallback: gemini-2.5-flash-image (separate quota bucket) when 3.1 returns 429.
    const PRIMARY_MODEL = process.env.GEMINI_IMAGE_MODEL || 'gemini-3.1-flash-image-preview';
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${PRIMARY_MODEL}:generateContent`;
    const parts = [{ text: prompt }];
    for (const imgPath of imagePaths) {
        const data = await fs.readFile(imgPath);
        parts.push({ inlineData: { mimeType: getMimeType(imgPath), data: data.toString('base64') } });
    }
    const payload = {
      contents: [{ role: "user", parts }],
      generationConfig: { responseModalities: ['IMAGE'] },
    };

    let attempt = 0;
    while (attempt <= retries) {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 120000);
            const response = await fetch(url, {
                method: "POST",
                headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
                body: JSON.stringify(payload),
                signal: controller.signal,
            });
            clearTimeout(timeoutId);
            if (!response.ok) throw new Error(`API Error ${response.status}: ${await response.text()}`);
            const data = await response.json();
            const candidate = data.candidates?.[0];
            if (!candidate) throw new Error("No candidates in response");
            const contentParts = candidate.content?.parts || [];
            let base64Image = null;
            for (const p of contentParts) {
                if (p.inlineData?.data) { base64Image = p.inlineData.data; break; }
                if (p.inline_data?.data) { base64Image = p.inline_data.data; break; }
            }
            if (!base64Image) throw new Error("No image data in response: " + JSON.stringify(data).substring(0, 300));
            return Buffer.from(base64Image, 'base64');
        } catch (error) {
            attempt++;
            if (attempt > retries) throw error;
            const delay = attempt * 3000;
            console.warn(`[WARN] Gemini failed (${error.message}). Retry ${attempt}/${retries} in ${delay}ms`);
            await sleep(delay);
        }
    }
}

async function loadVariants(productFolder) {
    const cleanDir = path.join(productFolder, '_clean');
    const variantsFile = path.join(cleanDir, 'variants.json');
    try {
        const raw = await fs.readFile(variantsFile, 'utf8');
        const variants = JSON.parse(raw);
        if (Array.isArray(variants) && variants.length > 0) return variants;
    } catch { /* no variants.json — fall through */ }
    // Fallback: single default garment.png
    const defaultPath = path.join(cleanDir, 'garment.png');
    await fs.access(defaultPath); // throws if missing
    return [{ color_name: 'default', color_slug: 'default', clean_path: 'garment.png' }];
}

async function generateOneListing({ productFolder, garmentPath, seed, outDir }) {
    await fs.mkdir(outDir, { recursive: true });

    for (const shot of SHOT_PLAN) {
        const outFile = path.join(outDir, `${shot.name}.jpg`);
        if (await fs.access(outFile).then(() => true).catch(() => false)) {
            console.log(`  - ${shot.name} exists, skipping.`);
            continue;
        }
        console.log(`  - Generating: ${shot.name}`);

        let prompt;
        let imagePaths;
        if (shot.name === "4_flatlay") {
            const styleDesc = pickFlatlayStyle(seed);
            prompt = buildFlatlayPrompt(styleDesc) + `\n\nCRITICAL: Output aspect ratio MUST be exactly ${shot.aspect}`;
            imagePaths = [ANCHORS.env, garmentPath];
        } else {
            const poseDesc = pickPose(shot.name, seed + "::" + shot.name);
            const footwear = pickFootwear(seed);
            const framing = pickFraming(seed);
            prompt = buildModelPrompt({ shotName: shot.name, poseDesc, footwear, framing })
                   + `\n\nCRITICAL: Output aspect ratio MUST be exactly ${shot.aspect}`;
            imagePaths = [...shot.anchors.map(a => ANCHORS[a]), garmentPath];
        }

        try {
            const buf = await callGemini(prompt, imagePaths);
            await fs.writeFile(outFile, buf);
            console.log(`  - Saved: ${shot.name}`);
        } catch (err) {
            console.error(`  - Failed ${shot.name}: ${err.message}`);
        }
    }
}

export { ANCHORS, SHOT_PLAN, buildModelPrompt, buildFlatlayPrompt, pickPose, pickFootwear, pickFraming, pickFlatlayStyle, callGemini, loadEnv };

export async function generateForProduct(productFolder) {
    await checkAnchors();
    await loadEnv();

    const variants = await loadVariants(productFolder).catch(err => {
        throw new Error(`No clean garment in ${productFolder}: ${err.message}. Run pre-process / color-detect first.`);
    });

    const productName = path.basename(productFolder);
    const isMultiColor = variants.length > 1;
    console.log(`Processing product: ${productName}  (${variants.length} variant${variants.length > 1 ? 's' : ''})`);

    for (let i = 0; i < variants.length; i++) {
        const v = variants[i];
        const garmentPath = path.join(productFolder, '_clean', v.clean_path);
        // Output dir: single-color → generated/, multi-color → generated/<color_slug>/
        const outDir = isMultiColor
            ? path.join(productFolder, 'generated', v.color_slug)
            : path.join(productFolder, 'generated');
        const doneMarker = path.join(outDir, '4_flatlay.jpg');
        if (await fs.access(doneMarker).then(() => true).catch(() => false)) {
            console.log(`  [variant ${v.color_name}] already done, skipping`);
            continue;
        }
        console.log(`  [variant ${i + 1}/${variants.length}: ${v.color_name}]`);
        // Seed must differ per variant so poses + framing don't repeat across colors.
        const variantSeed = isMultiColor ? `${productName}::${v.color_slug}` : productName;
        await generateOneListing({ productFolder, garmentPath, seed: variantSeed, outDir });
    }

    console.log(`SUCCESS: ${productName}`);
    return true;
}

if (import.meta.url === `file://${process.argv[1]}`) {
    const targetFolder = process.argv[2];
    if (!targetFolder) {
        console.error("Usage: node nano-build-listing-photos.mjs <product-folder-path>");
        process.exit(1);
    }
    const absPath = path.resolve(process.cwd(), targetFolder);
    generateForProduct(absPath).then(ok => process.exit(ok ? 0 : 1));
}
