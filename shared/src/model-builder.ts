// ──────────────────────────────────────────────────────────────────────────────
// Sims-Style Model Builder
//
// Takes a structured `ModelAttributes` object (user-picked from visual UI)
// and emits a deterministic English prompt for the image-generator. Same
// attributes = same prompt = consistent model across all listings.
//
// Why structured > free-text:
//   * users can't typo their way into bad output
//   * deterministic (same model in every listing — brand recognition)
//   * easy to A/B test ("what if I switch hair color?")
//   * the picker UI stays usable for non-prompt-engineers
// ──────────────────────────────────────────────────────────────────────────────

// ── Vocabulary ────────────────────────────────────────────────────────────────
// Each picker entry has an `id` (stored in DB), a German `label` for the UI,
// and the English `prompt` fragment we splice into the final prompt.

export interface PickerOption<T extends string = string> {
  id: T;
  label: string;
  prompt: string;
  /** Optional preview asset for the UI (relative URL or emoji-ish glyph). */
  swatch?: string;
}

export const SKIN_TONES = [
  { id: 'porcelain',   label: 'Porzellan',     prompt: 'porcelain fair skin',         swatch: '#f5dec4' },
  { id: 'fair',        label: 'Hell',          prompt: 'fair skin with subtle warmth', swatch: '#e9c9a8' },
  { id: 'light_olive', label: 'Hell-Olive',    prompt: 'light olive skin',            swatch: '#d9b48a' },
  { id: 'tan',         label: 'Gebräunt',      prompt: 'sun-kissed tan skin',         swatch: '#c89968' },
  { id: 'medium',      label: 'Mittel',        prompt: 'medium golden-brown skin',    swatch: '#b07e58' },
  { id: 'deep',        label: 'Dunkel',        prompt: 'deep brown skin',             swatch: '#7a4a32' },
  { id: 'ebony',       label: 'Ebenholz',      prompt: 'rich ebony skin',             swatch: '#4a2a1c' },
] as const satisfies readonly PickerOption[];

export const HAIR_COLORS = [
  { id: 'platinum',   label: 'Platin-Blond',   prompt: 'platinum blonde hair',          swatch: '#e8e2d4' },
  { id: 'blonde',     label: 'Blond',          prompt: 'natural blonde hair',           swatch: '#d4ac6a' },
  { id: 'honey',      label: 'Honig-Blond',    prompt: 'honey-blonde hair',             swatch: '#b78850' },
  { id: 'caramel',    label: 'Karamell',       prompt: 'caramel-brown hair',            swatch: '#8a5a32' },
  { id: 'brunette',   label: 'Brünett',        prompt: 'rich brown hair',               swatch: '#5a3820' },
  { id: 'dark_brown', label: 'Dunkelbraun',    prompt: 'dark brown almost-black hair',  swatch: '#3a2316' },
  { id: 'black',      label: 'Schwarz',        prompt: 'jet black hair',                swatch: '#1a1410' },
  { id: 'auburn',     label: 'Kastanie',       prompt: 'auburn red-brown hair',         swatch: '#7a3a20' },
  { id: 'red',        label: 'Rot',            prompt: 'natural copper-red hair',       swatch: '#b04020' },
  { id: 'rose',       label: 'Rosé',           prompt: 'soft rose-pink dyed hair',      swatch: '#d8a5a0' },
] as const satisfies readonly PickerOption[];

export const HAIR_STYLES = [
  { id: 'long_straight',  label: 'Lang, glatt',         prompt: 'long sleek straight hair past the shoulders' },
  { id: 'long_wavy',      label: 'Lang, wellig',        prompt: 'long flowy beach-wave hair' },
  { id: 'long_curly',     label: 'Lang, lockig',        prompt: 'long natural curls falling past the shoulders' },
  { id: 'shoulder_blunt', label: 'Schulterlang',        prompt: 'shoulder-length blunt-cut hair' },
  { id: 'lob',            label: 'Lob (Long-Bob)',      prompt: 'collarbone-length lob with a soft inward curl' },
  { id: 'bob_blunt',      label: 'Bob',                 prompt: 'sharp chin-length blunt bob' },
  { id: 'pixie',          label: 'Pixie',               prompt: 'short pixie cut with a textured fringe' },
  { id: 'bun_sleek',      label: 'Dutt',                prompt: 'slicked-back high bun, polished clean-girl look' },
  { id: 'ponytail',       label: 'Pferdeschwanz',       prompt: 'sleek high ponytail with face-framing strands' },
  { id: 'half_up',        label: 'Halb-Hoch',           prompt: 'half-up half-down clipped style' },
  { id: 'braids',         label: 'Zöpfe',               prompt: 'two french braids' },
  { id: 'space_buns',     label: 'Space Buns',          prompt: 'cute high space buns' },
] as const satisfies readonly PickerOption[];

export const EYE_COLORS = [
  { id: 'blue',   label: 'Blau',     prompt: 'soft blue eyes',          swatch: '#7ba8c0' },
  { id: 'green',  label: 'Grün',     prompt: 'green eyes',              swatch: '#7a9858' },
  { id: 'hazel',  label: 'Haselnuss', prompt: 'warm hazel eyes',         swatch: '#8a6840' },
  { id: 'brown',  label: 'Braun',    prompt: 'rich brown eyes',         swatch: '#4a3220' },
  { id: 'dark',   label: 'Dunkel',   prompt: 'deep dark-brown eyes',    swatch: '#2a1810' },
  { id: 'grey',   label: 'Grau',     prompt: 'cool grey eyes',          swatch: '#909098' },
] as const satisfies readonly PickerOption[];

export const FACE_SHAPES = [
  { id: 'oval',    label: 'Oval',       prompt: 'oval face shape' },
  { id: 'round',   label: 'Rund',       prompt: 'soft rounded face shape' },
  { id: 'heart',   label: 'Herz',       prompt: 'heart-shaped face with a defined chin' },
  { id: 'square',  label: 'Eckig',      prompt: 'square jawline' },
  { id: 'diamond', label: 'Diamant',    prompt: 'diamond-shape face with high cheekbones' },
] as const satisfies readonly PickerOption[];

export const BODY_TYPES = [
  { id: 'slim',      label: 'Slim',        prompt: 'slim slender build' },
  { id: 'petite',    label: 'Petite',      prompt: 'petite frame, small build' },
  { id: 'athletic',  label: 'Athletisch',  prompt: 'athletic toned figure' },
  { id: 'hourglass', label: 'Sanduhr',     prompt: 'hourglass figure' },
  { id: 'curvy',     label: 'Kurvig',      prompt: 'curvy natural figure' },
  { id: 'midsize',   label: 'Mid-Size',    prompt: 'midsize natural figure (size 40–42)' },
] as const satisfies readonly PickerOption[];

export const AGE_RANGES = [
  { id: '18_22', label: '18–22',  prompt: '18 to 22 years old, youthful' },
  { id: '22_26', label: '22–26',  prompt: '22 to 26 years old' },
  { id: '26_32', label: '26–32',  prompt: '26 to 32 years old' },
  { id: '32_40', label: '32–40',  prompt: '32 to 40 years old, mature elegant' },
] as const satisfies readonly PickerOption[];

export const MAKEUP_STYLES = [
  { id: 'natural',    label: 'Natural',     prompt: 'natural no-makeup makeup, dewy skin, soft brows' },
  { id: 'clean_girl', label: 'Clean Girl',  prompt: 'clean-girl makeup: glossy lips, brushed brows, glowy skin' },
  { id: 'soft_glam',  label: 'Soft Glam',   prompt: 'soft glam: bronzer, mascara, neutral eyeshadow' },
  { id: 'y2k',        label: 'Y2K',         prompt: 'y2k makeup: glossy lips, soft eyeliner, slight shimmer' },
  { id: 'minimal',    label: 'Minimal',     prompt: 'minimal makeup, just mascara and lip balm' },
  { id: 'european',   label: 'European',    prompt: 'effortless european makeup, tinted moisturizer, brown lip' },
] as const satisfies readonly PickerOption[];

export const AESTHETICS = [
  { id: 'clean_girl', label: 'Clean Girl',     prompt: 'clean-girl aesthetic — minimal, polished, expensive-looking' },
  { id: 'old_money',  label: 'Old Money',      prompt: 'old-money european aesthetic, refined and understated' },
  { id: 'downtown',   label: 'Downtown',       prompt: 'downtown nyc aesthetic, effortless cool' },
  { id: 'coquette',   label: 'Coquette',       prompt: 'coquette aesthetic, soft and feminine, bows and pearls' },
  { id: 'y2k',        label: 'Y2K',            prompt: 'y2k aesthetic, low-rise denim, baby tees, butterfly clips' },
  { id: 'preppy',     label: 'Preppy',         prompt: 'preppy aesthetic, polished and academic' },
  { id: 'minimalist', label: 'Minimalist',     prompt: 'minimalist scandi aesthetic, neutral tones, clean lines' },
  { id: 'boho',       label: 'Boho',           prompt: 'bohemian aesthetic, flowy and earthy' },
  { id: 'streetwear', label: 'Streetwear',     prompt: 'modern streetwear aesthetic' },
  { id: 'cottagecore',label: 'Cottagecore',    prompt: 'cottagecore aesthetic, romantic and pastoral' },
] as const satisfies readonly PickerOption[];

export const ETHNICITIES = [
  { id: 'european',     label: 'European',         prompt: 'european' },
  { id: 'scandinavian', label: 'Skandinavisch',    prompt: 'scandinavian' },
  { id: 'mediterranean', label: 'Mediterran',      prompt: 'mediterranean (italian / spanish / greek)' },
  { id: 'eastern_eu',   label: 'Osteuropäisch',    prompt: 'eastern european (slavic features)' },
  { id: 'middle_eastern', label: 'Nahost',         prompt: 'middle-eastern' },
  { id: 'latina',       label: 'Latina',           prompt: 'latina' },
  { id: 'asian',        label: 'Asiatisch',        prompt: 'east-asian' },
  { id: 'south_asian',  label: 'Süd-Asien',        prompt: 'south-asian' },
  { id: 'african',      label: 'Afrikanisch',      prompt: 'afro-european' },
  { id: 'mixed',        label: 'Gemischt',         prompt: 'mixed-race' },
] as const satisfies readonly PickerOption[];

export const HEIGHTS = [
  { id: 'petite',   label: 'Petite (155–162)',   prompt: 'petite height around 158 cm' },
  { id: 'average',  label: 'Average (162–170)',  prompt: 'average height around 167 cm' },
  { id: 'tall',     label: 'Tall (170–178)',     prompt: 'tall height around 174 cm' },
  { id: 'very_tall',label: 'Very Tall (178+)',   prompt: 'very tall height, model-like 180 cm' },
] as const satisfies readonly PickerOption[];

// ── Schema ────────────────────────────────────────────────────────────────────

export interface ModelAttributes {
  skin_tone: string;
  ethnicity: string;
  hair_color: string;
  hair_style: string;
  eye_color: string;
  face_shape: string;
  body_type: string;
  height: string;
  age_range: string;
  makeup: string;
  aesthetic: string;
  /** Free-text refinement — appended as-is. Optional, default empty. */
  freeform?: string;
}

export const DEFAULT_ATTRIBUTES: ModelAttributes = {
  skin_tone:  'fair',
  ethnicity:  'european',
  hair_color: 'brunette',
  hair_style: 'long_wavy',
  eye_color:  'brown',
  face_shape: 'oval',
  body_type:  'slim',
  height:     'average',
  age_range:  '22_26',
  makeup:     'clean_girl',
  aesthetic:  'clean_girl',
};

function find(opts: readonly PickerOption[], id: string): string {
  return opts.find((o) => o.id === id)?.prompt ?? '';
}

/** Compile attributes into a single descriptive sentence the image-gen will
 *  combine with the scene prompt. */
export function buildModelDescription(attrs: ModelAttributes): string {
  const parts: string[] = [];

  // Base subject: a [age] [ethnicity] woman
  const age = find(AGE_RANGES, attrs.age_range);
  const ethnicity = find(ETHNICITIES, attrs.ethnicity);
  parts.push(`A ${age || '22 to 26 years old'} ${ethnicity || 'european'} woman`);

  // Body
  const body = find(BODY_TYPES, attrs.body_type);
  const height = find(HEIGHTS, attrs.height);
  if (body || height) parts.push(`with a ${[body, height].filter(Boolean).join(', ')}`);

  // Skin
  const skin = find(SKIN_TONES, attrs.skin_tone);
  if (skin) parts.push(`${skin}`);

  // Face
  const faceShape = find(FACE_SHAPES, attrs.face_shape);
  if (faceShape) parts.push(`with an ${faceShape}`);

  // Eyes
  const eyes = find(EYE_COLORS, attrs.eye_color);
  if (eyes) parts.push(`and ${eyes}`);

  // Hair
  const hairColor = find(HAIR_COLORS, attrs.hair_color);
  const hairStyle = find(HAIR_STYLES, attrs.hair_style);
  if (hairColor && hairStyle) parts.push(`Hair: ${hairColor}, ${hairStyle}.`);
  else if (hairColor)         parts.push(`Hair: ${hairColor}.`);

  // Makeup + aesthetic
  const makeup = find(MAKEUP_STYLES, attrs.makeup);
  if (makeup) parts.push(`Makeup: ${makeup}.`);
  const aesthetic = find(AESTHETICS, attrs.aesthetic);
  if (aesthetic) parts.push(`Overall aesthetic: ${aesthetic}.`);

  if (attrs.freeform?.trim()) parts.push(attrs.freeform.trim());

  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

/** Helper for the image-generator: gives the full subject-lock paragraph to
 *  prepend before the scene description. */
export function buildModelLockPrompt(attrs: ModelAttributes): string {
  return `MODEL LOCK — every generated image must feature the SAME model:
${buildModelDescription(attrs)}
Keep her face, hair, skin, and body proportions consistent across all images.`;
}

/** UI-facing catalog — bundled for one Settings/Studio import. */
export const MODEL_PICKERS = {
  ethnicity:  ETHNICITIES,
  skin_tone:  SKIN_TONES,
  hair_color: HAIR_COLORS,
  hair_style: HAIR_STYLES,
  eye_color:  EYE_COLORS,
  face_shape: FACE_SHAPES,
  body_type:  BODY_TYPES,
  height:     HEIGHTS,
  age_range:  AGE_RANGES,
  makeup:     MAKEUP_STYLES,
  aesthetic:  AESTHETICS,
} as const;

// ──────────────────────────────────────────────────────────────────────────────
// Multi-Model Rotation
//
// Older builds picked the single `model_profiles WHERE active=1 LIMIT 1` row
// for every listing — fine for one Vinted account, but at 20 accounts the
// same face appears on hundreds of listings/week and Vinted's image-hash
// detector flags it as a coordinated network → mass ban.
//
// Newer builds let multiple profiles be `active=1`. Image-generator now picks
// one per listing via `pickRotatedModelProfile(seed)`. Seed is the folder
// number, so re-runs of the same listing always pick the same model
// (consistency on retry) but different listings spread across the pool.
//
// `weight` (added via ensureColumn migration) tunes the share — set the
// brand's "primary" model weight=3 and two backup models weight=1 to keep
// the brand recognisable but still avoid hash-collisions.
// ──────────────────────────────────────────────────────────────────────────────

import { getDb } from './db.js';

export interface ModelProfile {
  id: number;
  name: string;
  attributes: ModelAttributes;
  reference_image_path: string | null;
  active: boolean;
  weight: number;
  created_at: string;
  updated_at: string;
}

interface ModelProfileRow {
  id: number;
  name: string;
  attributes_json: string;
  reference_image_path: string | null;
  active: number;
  weight: number | null;
  created_at: string;
  updated_at: string;
}

function parseRow(row: ModelProfileRow): ModelProfile {
  let attrs: ModelAttributes = DEFAULT_ATTRIBUTES;
  try { attrs = { ...DEFAULT_ATTRIBUTES, ...JSON.parse(row.attributes_json) }; }
  catch { /* keep defaults */ }
  return {
    id: row.id,
    name: row.name,
    attributes: attrs,
    reference_image_path: row.reference_image_path,
    active: row.active === 1,
    weight: Math.max(1, row.weight ?? 1),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

/** All `active = 1` model profiles, ordered by id for deterministic listings. */
export function listActiveModelProfiles(): ModelProfile[] {
  const rows = getDb()
    .prepare(
      `SELECT id, name, attributes_json, reference_image_path, active, weight,
              created_at, updated_at
         FROM model_profiles
        WHERE active = 1
        ORDER BY id ASC`,
    )
    .all() as ModelProfileRow[];
  return rows.map(parseRow);
}

/** First active profile, or null when none. Back-compat for call-sites that
 *  predate the rotation feature and just want "the" active model. */
export function getActiveModelProfile(): ModelProfile | null {
  const row = getDb()
    .prepare(
      `SELECT id, name, attributes_json, reference_image_path, active, weight,
              created_at, updated_at
         FROM model_profiles
        WHERE active = 1
        ORDER BY id ASC
        LIMIT 1`,
    )
    .get() as ModelProfileRow | undefined;
  return row ? parseRow(row) : null;
}

/** Deterministic weighted-random pick across all active model profiles.
 *
 *  Same `seed` always yields the same profile, so a folder that gets
 *  re-generated picks the same face every time → no churn on retries.
 *
 *  • 0 active profiles → null (image-generator falls back to no-model)
 *  • 1 active profile  → that profile
 *  • N active profiles → weighted-random by `weight`
 */
export function pickRotatedModelProfile(seed: number): ModelProfile | null {
  const profiles = listActiveModelProfiles();
  if (profiles.length === 0) return null;
  if (profiles.length === 1) return profiles[0] ?? null;

  const totalWeight = profiles.reduce((s, p) => s + Math.max(1, p.weight), 0);
  if (totalWeight <= 0) return profiles[0] ?? null;

  // Deterministic [0..1) from seed — small Mulberry32-style hash so close
  // folder_nums don't cluster on the same profile.
  let h = (seed * 2654435761) >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  const r = ((h >>> 0) / 0xffffffff) * totalWeight;

  let acc = 0;
  for (const p of profiles) {
    acc += Math.max(1, p.weight);
    if (r < acc) return p;
  }
  return profiles[profiles.length - 1] ?? null;
}
