import fs from 'node:fs/promises';
import path from 'node:path';
import { createLogger } from '@vinted-system/shared';

const log = createLogger('crawler-download');

/**
 * Download an image URL to disk. Uses fetch() — no Playwright needed; Temu's
 * CDN images are publicly accessible.
 */
export async function downloadImage(url: string, destPath: string): Promise<void> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Image fetch ${url} → ${res.status}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  await fs.mkdir(path.dirname(destPath), { recursive: true });
  await fs.writeFile(destPath, buf);
  log.info(`Downloaded ${buf.length}B → ${destPath}`);
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
      await downloadImage(url, dest);
      written.push(dest);
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
