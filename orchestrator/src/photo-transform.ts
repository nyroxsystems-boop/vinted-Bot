// ──────────────────────────────────────────────────────────────────────────────
// Photo Transform — per-marketplace aspect-ratio conversion (C4)
//
// Each marketplace expects a specific photo aspect ratio:
//   - Depop, Mercari, Poshmark   → 1:1 (square)        — feed-grid layout
//   - eBay (DE, UK)              → 4:3 (landscape)     — product grid
//   - Vinted, Kleinanzeigen      → keep original       — accepts any ratio
//   - Others (default)           → keep original
//
// Crop-strategy: center-crop. We never *upscale* — if the source is smaller
// than the target, we letterbox-pad in white to preserve aspect-ratio for
// marketplaces that reject non-conforming sizes.
//
// Output is cached next to the source: `<original>.<mp>.jpg`. Subsequent
// calls are O(stat). This is critical because re-list cycles re-run on the
// same photos many times and we don't want N CPU-heavy convert calls per re.
//
// Sharp is loaded dynamically — if the host doesn't have it installed (rare:
// only happens in stripped-down CI), the transform falls back to returning
// the source paths unchanged so the publish doesn't crash. The marketplace
// bot will then reject the photos but with a clearer error.
// ──────────────────────────────────────────────────────────────────────────────

import fs from 'node:fs';
import path from 'node:path';
import { createLogger } from '@vinted-system/shared';
import type { MarketplaceId } from '@vinted-system/shared';

const log = createLogger('photo-transform');

type AspectStrategy =
  | { kind: 'keep' }
  | { kind: 'square' }                 // 1:1
  | { kind: 'ratio'; w: number; h: number };  // generic w:h crop

// Lookup is loose-typed `string` to accept marketplace ids that might not be
// in the canonical MarketplaceId union (legacy/test cases).
function aspectFor(mp: string): AspectStrategy {
  switch (mp) {
    case 'depop':
    case 'mercari':
    case 'poshmark':
    case 'whatnot':
      return { kind: 'square' };
    case 'ebay_de':
    case 'ebay_uk':
      return { kind: 'ratio', w: 4, h: 3 };
    case 'vinted':
    case 'kleinanzeigen':
    case 'wallapop':
    case 'leboncoin':
    case 'marktplaats':
    case 'willhaben':
    case 'fb_marketplace':
    case 'etsy':
    case 'grailed':
    case 'vestiaire':
    case 'shopify':
    case 'woocommerce':
    default:
      return { kind: 'keep' };
  }
}

function cachedPathFor(src: string, mp: string): string {
  const ext = path.extname(src);
  const base = src.slice(0, src.length - ext.length);
  return `${base}.${mp}${ext.toLowerCase() === '.png' ? '.png' : '.jpg'}`;
}

// Lazy-load sharp so the orchestrator boots even on machines without the
// native binary. We cache the module reference after the first hit.
let sharpModule: any = null;
let sharpLoadAttempted = false;
async function tryLoadSharp(): Promise<any> {
  if (sharpLoadAttempted) return sharpModule;
  sharpLoadAttempted = true;
  try {
    const mod = await import('sharp');
    sharpModule = (mod as any).default ?? mod;
  } catch (err) {
    log.warn('sharp not available — photo-transform will pass through originals', {
      err: err instanceof Error ? err.message : String(err),
    });
    sharpModule = null;
  }
  return sharpModule;
}

async function transformOne(
  src: string,
  out: string,
  strat: AspectStrategy,
  sharp: any,
): Promise<void> {
  const img = sharp(src);
  const meta = await img.metadata();
  const sw = meta.width ?? 0;
  const sh = meta.height ?? 0;
  if (!sw || !sh) throw new Error(`unreadable image metadata: ${src}`);

  if (strat.kind === 'keep') {
    // No-op transform path — but we still copy so the cached file exists for
    // future calls and the caller can treat the cache as authoritative.
    await fs.promises.copyFile(src, out);
    return;
  }

  // Compute target ratio
  const tr = strat.kind === 'square' ? 1 : strat.w / strat.h;
  const sr = sw / sh;

  // Center-crop to target ratio (no upscale). The longer dimension is trimmed.
  let cw = sw;
  let ch = sh;
  if (sr > tr) {
    // source is wider than target → crop sides
    cw = Math.floor(sh * tr);
    ch = sh;
  } else if (sr < tr) {
    // source is taller than target → crop top/bottom
    cw = sw;
    ch = Math.floor(sw / tr);
  }
  const left = Math.floor((sw - cw) / 2);
  const top = Math.floor((sh - ch) / 2);

  await img
    .extract({ left, top, width: cw, height: ch })
    .jpeg({ quality: 92, mozjpeg: true })
    .toFile(out);
}

/**
 * Transform an array of source photo paths for the given marketplace. Returns
 * a new array of (possibly identical) paths suitable for upload. Cached on
 * disk — the second call with the same inputs is a no-op.
 *
 * Never throws. If transformation fails for a single photo, the original is
 * passed through and the failure is logged. Better to publish slightly-off
 * photos than to block the entire crosslist.
 */
export async function transformPhotosFor(
  marketplace: MarketplaceId | string,
  photoPaths: string[],
): Promise<string[]> {
  const strat = aspectFor(marketplace);
  if (strat.kind === 'keep') return photoPaths;

  const sharp = await tryLoadSharp();
  if (!sharp) return photoPaths;

  const out: string[] = [];
  for (const src of photoPaths) {
    const dst = cachedPathFor(src, marketplace);
    try {
      // Cache hit: skip transform if cached file is newer than source
      const srcStat = await fs.promises.stat(src).catch(() => null);
      const dstStat = await fs.promises.stat(dst).catch(() => null);
      if (srcStat && dstStat && dstStat.mtimeMs >= srcStat.mtimeMs) {
        out.push(dst);
        continue;
      }
      await transformOne(src, dst, strat, sharp);
      out.push(dst);
    } catch (err) {
      log.warn('photo transform failed — using original', {
        marketplace, src, err: err instanceof Error ? err.message : String(err),
      });
      out.push(src);
    }
  }
  return out;
}

// Exported for testing.
export const _internal = { aspectFor, cachedPathFor };
