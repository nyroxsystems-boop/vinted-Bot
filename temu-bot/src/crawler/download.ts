import fs from 'node:fs/promises';
import path from 'node:path';
import { createLogger } from '@vinted-system/shared';

const log = createLogger('crawler-download');

/**
 * Download an image URL to disk. Uses fetch() — no Playwright needed; Temu's
 * CDN images are publicly accessible.
 */
export async function downloadImage(url: string, destPath: string): Promise<string> {
  const res = await fetch(url, {
    headers: {
      // Temu CDN refuses plain fetches without a referer
      Referer: 'https://www.temu.com/',
      'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
    },
  });
  if (!res.ok) {
    throw new Error(`Image fetch ${url} → ${res.status}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());

  // Guard against tiny/broken responses (1x1 pixels, LQIP blurs)
  if (buf.length < 2000) {
    throw new Error(`Image too small (${buf.length}B), likely pixel/placeholder: ${url}`);
  }

  // Fix extension based on actual bytes — Temu serves AVIF behind .png paths
  const sniffedExt = sniffImageType(buf) ?? (path.extname(destPath).replace('.', '') || 'jpg');
  const fixedPath = destPath.replace(/\.[^.]+$/, `.${sniffedExt}`);

  await fs.mkdir(path.dirname(fixedPath), { recursive: true });
  await fs.writeFile(fixedPath, buf);
  log.info(`Downloaded ${buf.length}B (${sniffedExt}) → ${fixedPath}`);
  return fixedPath;
}

function sniffImageType(buf: Buffer): string | null {
  if (buf.length < 12) return null;
  // JPEG: FF D8 FF
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  // PNG: 89 50 4E 47
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'png';
  // GIF: 47 49 46 38
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38) return 'gif';
  // WebP: "RIFF....WEBP"
  if (
    buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
    buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50
  ) {
    return 'webp';
  }
  // AVIF: ftyp box at offset 4, "avif" at offset 8
  if (
    buf[4] === 0x66 && buf[5] === 0x74 && buf[6] === 0x79 && buf[7] === 0x70 &&
    buf[8] === 0x61 && buf[9] === 0x76 && buf[10] === 0x69 && buf[11] === 0x66
  ) {
    return 'avif';
  }
  return null;
}

/**
 * Download multiple images into a target directory.
 * Returns the written absolute paths.
 */
export async function downloadImages(
  urls: string[],
  dir: string,
  baseName: string,
): Promise<string[]> {
  await fs.mkdir(dir, { recursive: true });
  const written: string[] = [];
  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    if (!url) continue;
    const ext = urlExtension(url) ?? 'jpg';
    const filename =
      i === 0 ? `${baseName}.${ext}` : `${baseName.replace(/_original$/, '')}_${i}.${ext}`;
    const dest = path.join(dir, filename);
    try {
      const actualPath = await downloadImage(url, dest);
      written.push(actualPath);
    } catch (err) {
      log.warn(`Skipping image ${i}`, { url, error: String(err) });
    }
  }
  return written;
}

function urlExtension(url: string): string | null {
  const before = url.split('?')[0] ?? url;
  const m = before.match(/\.([a-zA-Z0-9]{2,4})$/);
  return m?.[1]?.toLowerCase() ?? null;
}
