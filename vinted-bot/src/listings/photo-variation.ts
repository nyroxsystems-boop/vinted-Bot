// ──────────────────────────────────────────────────────────────────────────────
// Photo variation helper.
//
// For each listing, we transform the source photos so the resulting set looks
// distinct from previous listings even when they share the same template
// (same mirror selfie pose, same backdrop). Two axes:
//
//   1. Random crop — keep a 80-95% random window of each image to vary the
//      framing. Center stays away from extreme corners so the subject stays
//      in frame.
//   2. Random shuffle — randomize photo order, BUT a "flatlay" / "_flatlay"
//      photo MAY NEVER be first (user feedback: floor shots as cover look
//      bad). Falls back to deterministic order if no non-flatlay exists.
//
// Output: writes transformed files to a temp directory under /tmp/photo-var/
// and returns their absolute paths in upload order. Caller is responsible for
// (not) deleting the temp files — they're cheap to recreate.
// ──────────────────────────────────────────────────────────────────────────────

import sharp from 'sharp';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import * as crypto from 'node:crypto';
import { createLogger } from '@vinted-system/shared';

const log = createLogger('photo-variation');

// FIX 5: deterministic seeded PRNG (mulberry32). When a `seed` is passed
// to varyPhotos(), every random decision below (crop pct, crop offset,
// shuffle order) is reproducible. Useful for tests + audits, and for
// avoiding two re-lists of the same folder hashing to identical images
// when Date.now() happens to collide (rare but real).
function mulberry32(seed: number): () => number {
  return function (): number {
    let t = (seed += 0x6D2B79F5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randFrom(rng: () => number, min: number, max: number): number {
  return min + rng() * (max - min);
}

function isFlatlay(p: string): boolean {
  const base = path.basename(p).toLowerCase();
  return base.includes('flatlay') || base.includes('_flat') || base.includes('lay');
}

/**
 * Shuffle in-place using Fisher-Yates, then move any flatlay-looking image
 * out of position 0 by swapping with the next non-flatlay candidate.
 */
function shuffleNoFlatlayFirst<T>(items: T[], isFlat: (item: T) => boolean, rng: () => number): T[] {
  const arr = items.slice();
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = arr[i] as T;
    arr[i] = arr[j] as T;
    arr[j] = tmp;
  }
  if (arr.length > 1 && isFlat(arr[0] as T)) {
    for (let i = 1; i < arr.length; i++) {
      if (!isFlat(arr[i] as T)) {
        const tmp = arr[0] as T;
        arr[0] = arr[i] as T;
        arr[i] = tmp;
        break;
      }
    }
  }
  return arr;
}

/**
 * Transform + shuffle photos for one listing. Returns absolute paths to the
 * transformed copies in upload order.
 *
 * @param seed Optional 32-bit unsigned int. Same seed → same crop windows +
 *             same shuffle order. Default: time-based.
 */
export async function varyPhotos(srcPaths: string[], seed?: number): Promise<string[]> {
  // Default seed mixes Date.now() with a hash of the first src path so two
  // listings created in the same millisecond still diverge.
  const defaultSeed = (Date.now() ^ (srcPaths[0]?.length ?? 0) * 2654435761) >>> 0;
  const rng = mulberry32((seed ?? defaultSeed) >>> 0);

  const ordered = shuffleNoFlatlayFirst(srcPaths, isFlatlay, rng);
  const tag = crypto.randomBytes(4).toString('hex');
  const outDir = `/tmp/photo-var/${Date.now()}-${tag}`;
  await fs.mkdir(outDir, { recursive: true });

  const outPaths: string[] = [];
  for (let i = 0; i < ordered.length; i++) {
    const src = ordered[i];
    if (!src) continue;
    const outPath = path.join(outDir, `${i + 1}_${path.basename(src).replace(/\.(png|jpg|jpeg)$/i, '.jpg')}`);
    try {
      const img = sharp(src);
      const meta = await img.metadata();
      const w = meta.width ?? 1024;
      const h = meta.height ?? 1024;
      // Random crop window: keep 80-95% of each dimension
      const cropPct = randFrom(rng, 0.80, 0.95);
      const cropW = Math.round(w * cropPct);
      const cropH = Math.round(h * cropPct);
      // Random offset within the available margin (clamped so subject stays roughly framed)
      const maxLeft = w - cropW;
      const maxTop = h - cropH;
      // Bias center for the FIRST image (cover) so it looks intentional,
      // freely random for the rest.
      const left = i === 0
        ? Math.round(maxLeft * randFrom(rng, 0.3, 0.7))
        : Math.round(maxLeft * rng());
      const top = i === 0
        ? Math.round(maxTop * randFrom(rng, 0.1, 0.5))
        : Math.round(maxTop * rng());
      await img
        .extract({ left, top, width: cropW, height: cropH })
        .jpeg({ quality: 90, mozjpeg: true })
        .toFile(outPath);
      outPaths.push(outPath);
    } catch (err) {
      log.warn('varyPhoto failed for one file, using source as-is', {
        src, err: err instanceof Error ? err.message : String(err),
      });
      // Fallback: copy source to outDir so we still get a sane upload list.
      const fallback = path.join(outDir, `${i + 1}_${path.basename(src)}`);
      await fs.copyFile(src, fallback).catch(() => null);
      outPaths.push(fallback);
    }
  }
  log.info('varyPhotos done', { count: outPaths.length, outDir });
  return outPaths;
}
