// ──────────────────────────────────────────────────────────────────────────────
// Scene Builder — visual environment picker for listing photos
//
// Same idea as `model-builder.ts` but for the *setting* the model is in:
// bedroom-mirror selfies, café tables, outdoor street scenes, festival
// outfits, gym mirrors, studio shoots, etc. User picks attributes once in
// SceneStudio, the image-generator deterministically renders the active
// model in those scenes.
// ──────────────────────────────────────────────────────────────────────────────

import type { PickerOption } from './model-builder.js';
export type { PickerOption };

// ── Setting (where the photo is taken) ───────────────────────────────────────
export const SETTINGS = [
  { id: 'bedroom_mirror',   label: 'Schlafzimmer-Spiegel',   prompt: 'standing in front of a full-length mirror in a softly lit bedroom, clean white walls, indoor plants', swatch: '🪞' },
  { id: 'cafe_table',       label: 'Café-Tisch',             prompt: 'sitting at a marble café table with cappuccino cup, blurred warm interior background', swatch: '☕' },
  { id: 'street_outdoor',   label: 'Straße / Outdoor',       prompt: 'walking on a quiet city sidewalk, soft golden-hour daylight, blurred shop windows behind', swatch: '🌇' },
  { id: 'studio_white',     label: 'Studio (Weiß)',          prompt: 'professional studio photo, seamless white backdrop, soft beauty lighting', swatch: '⬜' },
  { id: 'studio_grey',      label: 'Studio (Grau)',          prompt: 'professional studio photo, neutral mid-grey backdrop, soft side lighting', swatch: '◽' },
  { id: 'park_natural',     label: 'Park / Natur',           prompt: 'standing in a green city park, soft dappled sunlight through leaves, candid pose', swatch: '🌳' },
  { id: 'gym_mirror',       label: 'Gym-Spiegel',            prompt: 'mirror selfie at a clean modern gym, soft natural lighting, racks blurred in background', swatch: '💪' },
  { id: 'festival_outdoor', label: 'Festival / Open-Air',    prompt: 'at an outdoor music festival, golden-hour light, crowd blurred far in background, candid posture', swatch: '🎪' },
  { id: 'beach_golden',     label: 'Strand (Golden Hour)',   prompt: 'on a soft sand beach during golden hour, ocean blurred behind', swatch: '🏖️' },
  { id: 'apartment_living', label: 'Wohnzimmer',             prompt: 'in a stylish modern apartment living room, soft afternoon light through windows', swatch: '🛋️' },
  { id: 'rooftop_sunset',   label: 'Rooftop / Sonnenuntergang', prompt: 'on a rooftop terrace at sunset, city skyline blurred in background', swatch: '🌆' },
  { id: 'flatlay_top',      label: 'Flat-Lay (Aufsicht)',    prompt: 'overhead flat-lay shot of the garment on a clean wooden surface, props arranged around', swatch: '📐' },
] as const satisfies readonly PickerOption[];

// ── Mood (the vibe / aesthetic of the photo) ─────────────────────────────────
export const MOODS = [
  { id: 'clean_minimal',  label: 'Clean Minimal',      prompt: 'clean minimal aesthetic, soft neutrals, uncluttered', swatch: '🤍' },
  { id: 'warm_cozy',      label: 'Warm & Cozy',        prompt: 'warm cozy mood, golden tones, lived-in feel', swatch: '🧡' },
  { id: 'cool_editorial', label: 'Editorial / Cool',   prompt: 'cool editorial mood, soft cyan undertones, fashion-magazine feel', swatch: '💙' },
  { id: 'luxe_quiet',     label: 'Quiet Luxury',       prompt: 'quiet luxury, muted beige + cream palette, expensive-looking', swatch: '🤎' },
  { id: 'grungy_y2k',     label: 'Grungy / Y2K',       prompt: 'grungy y2k mood, slight film grain, raw flash-lit feel', swatch: '⚡' },
  { id: 'soft_feminine',  label: 'Soft Feminine',      prompt: 'soft feminine mood, blush pinks, dreamy diffuse light', swatch: '🌸' },
  { id: 'gen_z_playful',  label: 'Gen-Z Playful',      prompt: 'playful gen-z mood, slightly oversaturated colors, candid energy', swatch: '🎀' },
] as const satisfies readonly PickerOption[];

// ── Time-of-day / Lighting ───────────────────────────────────────────────────
export const TIME_OF_DAY = [
  { id: 'natural_window',  label: 'Tageslicht (Fenster)',   prompt: 'natural daylight from window, soft shadows' },
  { id: 'golden_hour',     label: 'Golden Hour',            prompt: 'warm golden-hour sunset light, long soft shadows' },
  { id: 'overcast',        label: 'Bewölkt',                prompt: 'soft overcast daylight, even flattering shadows' },
  { id: 'evening_warm',    label: 'Abend (Warm)',           prompt: 'warm evening interior light, tungsten color temperature' },
  { id: 'flash_y2k',       label: 'Direkter Blitz',         prompt: 'direct on-camera flash, sharp shadows, y2k feel' },
  { id: 'soft_studio',     label: 'Studio Soft-Box',        prompt: 'soft studio lighting, large diffused source from side' },
] as const satisfies readonly PickerOption[];

// ── Camera angle / framing ───────────────────────────────────────────────────
export const FRAMING = [
  { id: 'full_body',       label: 'Ganzkörper',             prompt: 'full-body framing, head-to-toe' },
  { id: 'three_quarter',   label: '3/4 (Knie aufwärts)',    prompt: 'three-quarter framing from knees up' },
  { id: 'upper_body',      label: 'Oberkörper',             prompt: 'upper-body framing from hips up' },
  { id: 'closeup_detail',  label: 'Detail / Nahaufnahme',   prompt: 'close-up detail shot focusing on the garment' },
  { id: 'phone_mirror',    label: 'Handy-Mirror-Selfie',    prompt: 'handheld phone mirror selfie, casual angle' },
] as const satisfies readonly PickerOption[];

// ── Props that boost the "authentic Vinted seller" feel ──────────────────────
export const PROPS = [
  { id: 'none',          label: 'Ohne Props',          prompt: '' },
  { id: 'coffee',        label: 'Kaffeebecher',        prompt: ', holding a takeaway coffee cup' },
  { id: 'tote',          label: 'Stoffbeutel',         prompt: ', with a canvas tote bag' },
  { id: 'sneakers',      label: 'Weiße Sneaker',       prompt: ', wearing simple white sneakers' },
  { id: 'sunglasses',    label: 'Sonnenbrille',        prompt: ', wearing minimal sunglasses' },
  { id: 'phone',         label: 'Smartphone',          prompt: ', casually holding a smartphone' },
  { id: 'books',         label: 'Bücher',              prompt: ', with stacked books nearby' },
  { id: 'plant',         label: 'Pflanze',             prompt: ', with potted plants in frame' },
] as const satisfies readonly PickerOption[];

// ── Public picker bundle ─────────────────────────────────────────────────────
export const SCENE_PICKERS = {
  setting:      SETTINGS,
  mood:         MOODS,
  time_of_day:  TIME_OF_DAY,
  framing:      FRAMING,
  props:        PROPS,
} as const;

export type ScenePickersShape = typeof SCENE_PICKERS;

// ── Attributes the UI stores ─────────────────────────────────────────────────
export interface SceneAttributes {
  setting: string;
  mood: string;
  time_of_day: string;
  framing: string;
  props: string;
  /** Optional free-form description appended verbatim (advanced users). */
  freeform?: string;
}

export const DEFAULT_SCENE_ATTRIBUTES: SceneAttributes = {
  setting:     'bedroom_mirror',
  mood:        'clean_minimal',
  time_of_day: 'natural_window',
  framing:     'full_body',
  props:       'none',
};

// ── Deterministic prompt builder ─────────────────────────────────────────────
function find<T extends string>(
  options: ReadonlyArray<PickerOption<T>>,
  id: string,
  fallback: T,
): PickerOption<T> {
  return options.find((o) => o.id === id) ?? options.find((o) => o.id === fallback)!;
}

/** Turn the attributes into a single English fragment the image-LLM can splice
 *  into a "photo of [MODEL] [SCENE]" prompt. Returns just the scene portion. */
export function buildSceneDescription(attrs: SceneAttributes): string {
  const setting = find(SETTINGS, attrs.setting, 'bedroom_mirror');
  const mood    = find(MOODS, attrs.mood, 'clean_minimal');
  const tod     = find(TIME_OF_DAY, attrs.time_of_day, 'natural_window');
  const fr      = find(FRAMING, attrs.framing, 'full_body');
  const props   = find(PROPS, attrs.props, 'none');

  const parts = [
    fr.prompt,
    setting.prompt + props.prompt,
    tod.prompt,
    mood.prompt,
  ].filter(Boolean);

  let out = parts.join(', ');
  if (attrs.freeform && attrs.freeform.trim().length > 0) {
    out += `. ${attrs.freeform.trim()}`;
  }
  return out;
}

/** Quick human-readable summary for UI badges. */
export function describeSceneShort(attrs: SceneAttributes): string {
  const setting = find(SETTINGS, attrs.setting, 'bedroom_mirror');
  const mood    = find(MOODS, attrs.mood, 'clean_minimal');
  return `${setting.label} · ${mood.label}`;
}
