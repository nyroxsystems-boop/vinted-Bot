// ──────────────────────────────────────────────────────────────────────────────
// Image-LLM Adapter
//
// Wraps Google's Imagen-3 / Gemini-Image API for product-photo generation.
// Single entry point `generateImageSet({ sourceImageUrl, prompt, count })`
// returns 1..N PNG buffers.
//
// Used by the orchestrator's image-generator worker. Free path:
//   * If GEMINI_API_KEY is set → use Google's gemini-2.5-flash-image-preview
//   * Otherwise → return null and let the worker fall back to copy_source.
//
// Caller is responsible for writing the buffers to disk and updating DB state.
// ──────────────────────────────────────────────────────────────────────────────

import { createLogger } from './logger.js';

const log = createLogger('image-llm');

export interface GenerateImageOpts {
  /** Optional: a source image (URL or absolute file path) the model should
   *  use as visual reference. The model preserves the product but restages it. */
  sourceImageUrl?: string;
  /** Absolute file path of a source image, will be loaded + base64-encoded. */
  sourceImagePath?: string;
  /** Text prompt describing the desired output. */
  prompt: string;
  /** How many variants to generate (1..4). Default 1. */
  count?: number;
  /** Aspect ratio — "1:1" (square), "3:4" (portrait, Vinted default), "9:16" */
  aspectRatio?: '1:1' | '3:4' | '4:3' | '9:16' | '16:9';
  /** Timeout in ms. Default 90s. */
  timeoutMs?: number;
}

export interface GenerateImageResult {
  buffer: Buffer;
  mimeType: string;
}

export interface ImageGenError {
  status?: number;
  message: string;
}

/**
 * @deprecated Use `generateImageSetWithError()` so the error is returned per
 * call instead of via this module-global. Concurrent callers (e.g. preview
 * + auto-publisher both running image-gen) overwrite this flag mid-flight
 * and surface the wrong error to the wrong user. Kept for back-compat.
 */
export let lastImageGenError: ImageGenError | null = null;

const GEMINI_IMAGE_MODEL =
  process.env.GEMINI_IMAGE_MODEL ?? 'gemini-2.5-flash-image';

/**
 * Generate 1..N image variants. Returns empty array if no API key or the model
 * returned no inline images.
 *
 * Cost: ~$0.04 per image with gemini-2.5-flash-image-preview. With 5 imgs/listing
 * = $0.20/listing. At 50 sales/day this is ~$10/day in image-gen costs.
 */
export async function generateImageSet(opts: GenerateImageOpts): Promise<GenerateImageResult[]> {
  const { images } = await generateImageSetWithError(opts);
  return images;
}

/**
 * Same as `generateImageSet` but returns the last per-call error inline
 * so concurrent callers don't overwrite each other's error state.
 */
export async function generateImageSetWithError(
  opts: GenerateImageOpts,
): Promise<{ images: GenerateImageResult[]; error: ImageGenError | null }> {
  let localError: ImageGenError | null = null;
  const key = process.env.GEMINI_API_KEY ?? '';
  if (!key) {
    log.debug('No GEMINI_API_KEY — skipping image generation');
    localError = { message: 'GEMINI_API_KEY not set' };
    lastImageGenError = localError;
    return { images: [], error: localError };
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMINI_IMAGE_MODEL)}:generateContent?key=${key}`;

  // Build the multimodal contents array.
  const parts: Array<Record<string, unknown>> = [];

  // Optional reference image (file or URL)
  let inlineImageB64: string | null = null;
  let inlineMime = 'image/jpeg';
  if (opts.sourceImagePath) {
    try {
      const fs = await import('node:fs/promises');
      const buf = await fs.readFile(opts.sourceImagePath);
      inlineImageB64 = buf.toString('base64');
      if (opts.sourceImagePath.endsWith('.png')) inlineMime = 'image/png';
      else if (opts.sourceImagePath.endsWith('.webp')) inlineMime = 'image/webp';
    } catch (err) {
      log.warn('Failed to read source image', { path: opts.sourceImagePath, err: String(err) });
    }
  } else if (opts.sourceImageUrl) {
    try {
      const r = await fetch(opts.sourceImageUrl, { signal: AbortSignal.timeout(20_000) });
      if (r.ok) {
        const buf = Buffer.from(await r.arrayBuffer());
        inlineImageB64 = buf.toString('base64');
        inlineMime = r.headers.get('content-type') ?? 'image/jpeg';
      }
    } catch (err) {
      log.warn('Failed to fetch source image', { url: opts.sourceImageUrl, err: String(err) });
    }
  }

  if (inlineImageB64) {
    parts.push({
      inline_data: { mime_type: inlineMime, data: inlineImageB64 },
    });
  }
  parts.push({ text: opts.prompt });

  const body: Record<string, unknown> = {
    contents: [{ role: 'user', parts }],
    generationConfig: {
      // Gemini image models output image blobs alongside any text.
      responseModalities: ['IMAGE'],
      // 1 image per request is most reliable; loop on the caller side for N variants.
      candidateCount: 1,
      ...(opts.aspectRatio ? { imageConfig: { aspectRatio: opts.aspectRatio } } : {}),
    },
  };

  const timeoutMs = opts.timeoutMs ?? 90_000;
  const N = Math.max(1, Math.min(4, opts.count ?? 1));

  interface InlineBlob { data?: string; mime_type?: string; mimeType?: string }

  const out: GenerateImageResult[] = [];

  for (let i = 0; i < N; i++) {
    try {
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!r.ok) {
        const text = await r.text();
        log.warn('Gemini image non-2xx', { status: r.status, body: text.slice(0, 300) });
        let parsed: { error?: { message?: string } } = {};
        try { parsed = JSON.parse(text); } catch { /* ignore */ }
        localError = {
          status: r.status,
          message: parsed.error?.message ?? text.slice(0, 200),
        };
        lastImageGenError = localError;
        continue;
      }
      const data = await r.json() as {
        candidates?: Array<{
          content?: { parts?: Array<{ inline_data?: InlineBlob; inlineData?: InlineBlob }> };
        }>;
      };
      const cand = data.candidates?.[0]?.content?.parts ?? [];
      for (const part of cand) {
        const inline: InlineBlob | undefined = part.inline_data ?? part.inlineData;
        if (inline?.data) {
          out.push({
            buffer: Buffer.from(inline.data, 'base64'),
            mimeType: inline.mime_type ?? inline.mimeType ?? 'image/png',
          });
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn('Gemini image call failed', { i, err: msg });
      localError = { message: msg };
      lastImageGenError = localError;
    }
  }
  return { images: out, error: out.length > 0 ? null : localError };
}

/**
 * Build a Vinted-style fashion prompt. The model receives the source image (a
 * CJ flatlay/mannequin shot) and is asked to restage the same item on a real
 * person in different environments so we get 4-5 visually distinct lifestyle
 * photos.
 */
export function buildVintedFashionPrompt(opts: {
  productType: string;          // "Summer Mini Dress", "Crop Top", "Jeans"
  color?: string;
  size?: string;
  scene: 'mirror_selfie' | 'outdoor' | 'café' | 'studio' | 'flat_lay';
}): string {
  const sceneDesc = {
    mirror_selfie: 'A young European woman taking a mirror selfie in a clean, well-lit bedroom. Hands holding the phone, casual pose, soft natural light from a window. The clothing item is the focus.',
    outdoor:       'A young European woman walking on a sunny street in a European city, candid pose, golden-hour light, soft bokeh background.',
    'café':        'A young European woman sitting at a café table, holding a coffee cup, looking softly off-camera, warm indoor lighting.',
    studio:        'Clean studio shot, neutral grey background, professional fashion photography lighting, full-body view of the model.',
    flat_lay:      'A top-down flatlay of the clothing item on a clean wooden or marble surface, neatly arranged, soft natural daylight, minimalist styling.',
  }[opts.scene];

  return `${sceneDesc}

She is wearing the EXACT same ${opts.productType.toLowerCase()} as shown in the reference image — preserve the colour (${opts.color ?? 'as in reference'}), pattern, cut, and any visible details (buttons, hem, neckline, fabric texture). DO NOT add jewellery, a different bag, or other distracting accessories — keep focus on the clothing item.

Style: realistic photography, Gen-Z aesthetic, Instagram-friendly. Avoid text, watermarks, logos. The pose should look natural, not staged. Output a single high-resolution photo, portrait orientation (3:4).`;
}
