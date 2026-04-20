import fs from 'node:fs/promises';
import path from 'node:path';
import { createLogger, getDb } from '@vinted-system/shared';

const log = createLogger('crawler-folder');

const VINTED_ROOT = '/Users/home/Desktop/Vinted';

export interface ProductRecord {
  temu_goods_id: string;
  temu_url: string;
  title: string;
  price_eur: number | null;
  rating: number | null;
  review_count: number | null;
  color?: string | null;
  product_type?: string | null;
  details?: string | null;
  size?: string | null;
  search_query: string;
  image_urls: string[];
}

/**
 * Find the next free "Neuer Ordner N" number. Scans both the filesystem
 * and the crawled_products table so we never collide.
 */
export async function nextFolderNum(): Promise<number> {
  // 1. filesystem
  const entries = await fs.readdir(VINTED_ROOT).catch(() => []);
  let maxFs = 0;
  for (const e of entries) {
    const m = e.match(/^Neuer Ordner\s+(\d+)$/);
    if (m?.[1]) {
      const n = Number.parseInt(m[1], 10);
      if (Number.isFinite(n) && n > maxFs) maxFs = n;
    }
  }
  // 2. DB (in case fs entry was deleted)
  const row = getDb()
    .prepare('SELECT MAX(folder_num) AS n FROM crawled_products')
    .get() as { n: number | null };
  const maxDb = row?.n ?? 0;
  return Math.max(maxFs, maxDb) + 1;
}

/**
 * Create the target folder, save images + metadata + URL, and drop the
 * Antigravity queue entry so the agent picks it up on next run.
 */
export async function materialiseProduct(
  product: ProductRecord,
  downloadImages: (urls: string[], dir: string, base: string) => Promise<string[]>,
): Promise<{ folderNum: number; folderPath: string; queuePath: string; imagePath: string }> {
  const folderNum = await nextFolderNum();
  const folderPath = path.join(VINTED_ROOT, `Neuer Ordner ${folderNum}`);
  const sourceDir = path.join(folderPath, 'source');
  await fs.mkdir(sourceDir, { recursive: true });

  // Download images — first one is the "flatlay_original" Antigravity expects
  const saved = await downloadImages(product.image_urls, sourceDir, 'flatlay_original');
  const imagePath = saved[0] ?? '';

  // Save URL + metadata
  await fs.writeFile(path.join(folderPath, 'temu_url.txt'), product.temu_url + '\n');
  await fs.writeFile(
    path.join(folderPath, 'product_info.json'),
    JSON.stringify(
      {
        temu_goods_id: product.temu_goods_id,
        temu_url: product.temu_url,
        title: product.title,
        price_eur: product.price_eur,
        rating: product.rating,
        review_count: product.review_count,
        search_query: product.search_query,
        crawled_at: new Date().toISOString(),
      },
      null,
      2,
    ),
  );

  // Create the Antigravity-queue input file
  const queuePath = path.join(VINTED_ROOT, '_queue', `${folderNum}_input.json`);
  await fs.mkdir(path.dirname(queuePath), { recursive: true });
  await fs.writeFile(
    queuePath,
    JSON.stringify(
      {
        folder_num: folderNum,
        product_type: product.product_type ?? inferType(product.title),
        color: product.color ?? inferColor(product.title),
        details: product.details ?? product.title,
        size: product.size ?? 'S / 36',
        source_flatlay: imagePath,
      },
      null,
      2,
    ),
  );

  log.info('Product materialised', { folderNum, folderPath, queuePath });
  return { folderNum, folderPath, queuePath, imagePath };
}

// ── Helpers — light NLP on titles ───────────────────────────────────────────

function inferType(title: string): string {
  const t = title.toLowerCase();
  if (/minikleid/i.test(t)) return 'Minikleid';
  if (/maxikleid/i.test(t)) return 'Maxikleid';
  if (/midikleid/i.test(t)) return 'Midikleid';
  if (/cocktailkleid/i.test(t)) return 'Cocktailkleid';
  if (/abendkleid/i.test(t)) return 'Abendkleid';
  if (/sommerkleid/i.test(t)) return 'Sommerkleid';
  if (/kleid/i.test(t)) return 'Kleid';
  if (/leggings/i.test(t)) return 'Leggings';
  if (/top|shirt/i.test(t)) return 'Top';
  if (/hoodie/i.test(t)) return 'Hoodie';
  if (/shorts/i.test(t)) return 'Shorts';
  if (/rock/i.test(t)) return 'Rock';
  return 'Kleidungsstück';
}

function inferColor(title: string): string {
  const t = title.toLowerCase();
  const colors: Array<[RegExp, string]> = [
    [/schwarz|black/, 'Schwarz'],
    [/weiß|weiss|white/, 'Weiß'],
    [/rosa|pink|pink/, 'Rosa'],
    [/rot|red/, 'Rot'],
    [/blau|blue|navy/, 'Blau'],
    [/grün|green/, 'Grün'],
    [/gelb|yellow/, 'Gelb'],
    [/beige|nude|creme/, 'Beige'],
    [/grau|gray/, 'Grau'],
    [/braun|brown/, 'Braun'],
    [/lila|purple/, 'Lila'],
    [/koralle|coral|orange/, 'Koralle'],
    [/blumen|floral/, 'Blumenmuster'],
  ];
  for (const [re, name] of colors) if (re.test(t)) return name;
  return 'unbekannt';
}
