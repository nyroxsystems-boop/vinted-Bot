// ──────────────────────────────────────────────────────────────────────────────
// Auto-Listing Generator
//
// Scans crawled_products with status 'ready' (= Antigravity has produced the
// model photos) and generates a complete Vinted listing draft:
//   title, description, category, price, size, condition, brand, photos, …
//
// The draft is stored in the `auto_listings` table with status 'draft'.
// The Dashboard shows these drafts for one-click review → publish.
// ──────────────────────────────────────────────────────────────────────────────

import fs from 'node:fs/promises';
import path from 'node:path';
import { createLogger, getDb, getSetting, calculateVintedPrice, vintedRoot } from '@vinted-system/shared';

const log = createLogger('listing-generator');

const VINTED_ROOT = vintedRoot();

// ── Types ────────────────────────────────────────────────────────────────────

export interface AutoListing {
  id?: number;
  folder_num: number;
  crawled_product_id: number;

  // Vinted listing fields
  title: string;
  description: string;
  category: string;        // e.g. "Damen > Kleider > Minikleider"
  subcategory: string;     // e.g. "Minikleider"
  brand: string;           // "Ohne Marke" for Temu goods
  size: string;            // "S" / "36"
  condition: string;       // "Sehr gut" / "Gut" / "Neu mit Etikett"
  color: string;
  material: string;
  price_eur: number;       // calculated Vinted selling price
  temu_price_eur: number;  // Temu purchase price
  profit_margin_eur: number;

  // Shipping
  shipping_method: string; // "Hermes S" / "DHL Päckchen"

  // Photos (absolute paths to generated images)
  photo_paths: string[];

  // Status
  status: 'draft' | 'approved' | 'publishing' | 'published' | 'failed';

  created_at?: string;
  updated_at?: string;
}

// ── Markup pricing: imported from @vinted-system/shared (calculateVintedPrice)

// ── Category inference ───────────────────────────────────────────────────────

interface CategoryResult {
  category: string;
  subcategory: string;
}

function inferCategory(title: string, productType?: string): CategoryResult {
  const t = (title + ' ' + (productType ?? '')).toLowerCase();

  // Kleider
  if (/minikleid|mini.?kleid/i.test(t)) return { category: 'Damen > Kleider > Minikleider', subcategory: 'Minikleider' };
  if (/maxikleid|maxi.?kleid/i.test(t)) return { category: 'Damen > Kleider > Maxikleider', subcategory: 'Maxikleider' };
  if (/midikleid|midi.?kleid/i.test(t)) return { category: 'Damen > Kleider > Midikleider', subcategory: 'Midikleider' };
  if (/cocktailkleid/i.test(t)) return { category: 'Damen > Kleider > Cocktailkleider', subcategory: 'Cocktailkleider' };
  if (/abendkleid/i.test(t)) return { category: 'Damen > Kleider > Abendkleider', subcategory: 'Abendkleider' };
  if (/sommerkleid/i.test(t)) return { category: 'Damen > Kleider > Sommerkleider', subcategory: 'Sommerkleider' };
  if (/kleid|dress/i.test(t)) return { category: 'Damen > Kleider > Alltagskleider', subcategory: 'Alltagskleider' };

  // Sport
  if (/leggings/i.test(t)) return { category: 'Damen > Sportkleidung > Leggings', subcategory: 'Leggings' };
  if (/sport.?bh|bra/i.test(t)) return { category: 'Damen > Sportkleidung > Sport-BHs', subcategory: 'Sport-BHs' };
  if (/shorts/i.test(t)) return { category: 'Damen > Sportkleidung > Shorts', subcategory: 'Shorts' };
  if (/yoga|pilates|fitness|sport|gym/i.test(t)) return { category: 'Damen > Sportkleidung > Tops', subcategory: 'Sport-Tops' };

  // Oberteile
  if (/crop.?top|croptop/i.test(t)) return { category: 'Damen > Oberteile > Crop Tops', subcategory: 'Crop Tops' };
  if (/hoodie/i.test(t)) return { category: 'Damen > Oberteile > Kapuzenpullover', subcategory: 'Hoodies' };
  if (/jacke|jacket|zip/i.test(t)) return { category: 'Damen > Oberteile > Sweatshirts', subcategory: 'Jacken' };
  if (/top|shirt|bluse/i.test(t)) return { category: 'Damen > Oberteile > T-Shirts', subcategory: 'Tops' };

  // Röcke
  if (/rock|skirt/i.test(t)) return { category: 'Damen > Röcke > Miniröcke', subcategory: 'Röcke' };

  // Hosen
  if (/hose|jeans|jogger|pants/i.test(t)) return { category: 'Damen > Hosen > Sonstige Hosen', subcategory: 'Hosen' };

  // Default
  return { category: 'Damen > Kleidung', subcategory: 'Sonstiges' };
}

// ── Color inference ──────────────────────────────────────────────────────────

function inferColor(title: string, existingColor?: string): string {
  if (existingColor && existingColor !== 'unbekannt') return existingColor;
  const t = title.toLowerCase();
  const colors: Array<[RegExp, string]> = [
    [/schwarz|black/, 'Schwarz'],
    [/weiß|weiss|white/, 'Weiß'],
    [/rosa|pink/, 'Rosa'],
    [/rot|red/, 'Rot'],
    [/blau|blue|navy/, 'Blau'],
    [/grün|green|khaki/, 'Grün'],
    [/gelb|yellow/, 'Gelb'],
    [/beige|nude|creme/, 'Beige'],
    [/grau|grey|gray/, 'Grau'],
    [/braun|brown|schoko/, 'Braun'],
    [/lila|purple|violett/, 'Lila'],
    [/korall|coral|orange/, 'Orange'],
    [/weinrot|bordeaux|burgundy/, 'Weinrot'],
    [/mint|türkis|turquoise/, 'Türkis'],
  ];
  for (const [re, name] of colors) if (re.test(t)) return name;
  return 'Mehrfarbig';
}

// ── Material inference ───────────────────────────────────────────────────────

function inferMaterial(attrs: Record<string, string>): string {
  // Look through Temu's structured attributes for material info
  for (const [key, val] of Object.entries(attrs)) {
    const k = key.toLowerCase();
    if (k.includes('material') || k.includes('stoff') || k.includes('fabric') || k.includes('zusammensetzung')) {
      return val;
    }
  }
  return 'Polyester'; // Default for Temu goods
}

// ── Title generator (Vinted-style, authentic) ────────────────────────────────

function generateTitle(
  title: string,
  productType: string,
  color: string,
  size: string,
): string {
  // Clean Temu noise from titles
  let clean = title
    .replace(/Top-Auswahl/gi, '')
    .replace(/In neuer Registerkarte öffnen\.?/gi, '')
    .replace(/Kaufen Sie.*?bei Temu/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();

  // If the cleaned title is too long or too messy, build a fresh one
  if (clean.length > 80 || clean.length < 10) {
    const parts: string[] = [];
    if (color && color !== 'unbekannt' && color !== 'Mehrfarbig') parts.push(color);
    parts.push(productType || 'Kleid');
    parts.push(`Gr. ${size}`);
    clean = parts.join(' ');
  }

  // Vinted title max 150 chars
  return clean.slice(0, 150);
}

// ── Description generator ────────────────────────────────────────────────────

function generateDescription(opts: {
  productType: string;
  color: string;
  size: string;
  material: string;
  details: string;
  temuDescription: string;
}): string {
  const { productType, color, size, material, details } = opts;

  // Authentic Vinted-girl style descriptions — no AI fluff
  const templates = [
    `Verkaufe mein schönes ${color !== 'unbekannt' ? color.toLowerCase() + 'es' : ''} ${productType}. ${details ? details + '.' : ''} Sitzt perfekt bei einer ${size}.\n\nZustand wie neu, nur einmal getragen. Bei Fragen einfach schreiben! :)`,
    `Hey! Gebe hier mein ${productType} ab. ${details ? details + '.' : ''} Der Stoff fühlt sich super an (${material}).\n\nFällt aus wie eine ${size}. Tierfreier Nichtraucherhaushalt.`,
    `Süßes ${productType}${color !== 'unbekannt' ? ' in ' + color : ''}. ${details ? details + '.' : ''} Passt perfekt einer normalen ${size}.\n\nKeine Mängel, Zustand top! Meldet euch bei Fragen.`,
  ];

  // Pick based on hash of details to be deterministic but varied
  const idx = (details?.length ?? 0) % templates.length;
  return templates[idx]!;
}

// ── Scan ready products and generate drafts ──────────────────────────────────

export async function generateListingsForReadyProducts(): Promise<{
  generated: number;
  skipped: number;
  errors: number;
}> {
  const stats = { generated: 0, skipped: 0, errors: 0 };

  // Find products that are 'ready' (photos generated) but don't have an
  // ACTIVE auto_listing yet.
  //   * Match per-account: a folder assigned to account A still needs its
  //     own auto_listing even when account B already lists the same
  //     folder_num (multi-account installs share the catalog).
  //   * Skip dead history — 'failed' / 'archived' rows from previous wipes
  //     must not block a fresh auto_listing for a re-eligible folder.
  const readyProducts = getDb()
    .prepare(
      `SELECT cp.*
         FROM crawled_products cp
         LEFT JOIN auto_listings al
                ON al.folder_num = cp.folder_num
               AND al.account_id = COALESCE(cp.assigned_account_id, 1)
               AND al.status NOT IN ('archived', 'failed')
        WHERE cp.status = 'ready'
          AND al.id IS NULL
        ORDER BY cp.folder_num ASC`,
    )
    .all() as Array<Record<string, unknown>>;

  log.info('Ready products without listings', { count: readyProducts.length });

  for (const row of readyProducts) {
    try {
      const folderNum = row.folder_num as number;
      const folderPath = row.folder_path as string;
      const temuPrice = (row.price_eur as number) ?? 5.0;
      const title = (row.title as string) ?? 'Kleidungsstück';
      const description = (row.description as string) ?? '';
      const attrsJson = (row.attributes_json as string) ?? '{}';
      const attrs: Record<string, string> = JSON.parse(attrsJson);

      // Read product_info.json for additional data
      let productInfo: Record<string, unknown> = {};
      try {
        const raw = await fs.readFile(path.join(folderPath, 'product_info.json'), 'utf-8');
        productInfo = JSON.parse(raw);
      } catch { /* no product_info — use DB data */ }

      // Find generated images
      const generatedDir = path.join(folderPath, 'generated');
      const generatedFiles = await fs.readdir(generatedDir).catch(() => []);
      const photoPaths = generatedFiles
        .filter((f) => /\.(jpg|jpeg|png|webp|avif)$/i.test(f))
        .sort()
        .map((f) => path.join(generatedDir, f));

      if (photoPaths.length < 3) {
        log.warn('Insufficient generated images', { folderNum, count: photoPaths.length });
        stats.skipped++;
        continue;
      }

      // Read queue input for product type info
      let queueData: Record<string, unknown> = {};
      try {
        const queuePath = path.join(VINTED_ROOT, '_done', `${folderNum}_input.json`);
        const raw = await fs.readFile(queuePath, 'utf-8');
        queueData = JSON.parse(raw);
      } catch {
        // Try _queue as fallback
        try {
          const queuePath = path.join(VINTED_ROOT, '_queue', `${folderNum}_input.json`);
          const raw = await fs.readFile(queuePath, 'utf-8');
          queueData = JSON.parse(raw);
        } catch { /* no queue data */ }
      }

      const productType = (queueData.product_type as string) ?? inferCategory(title).subcategory;
      const existingColor = (queueData.color as string) ?? 'unbekannt';
      const details = (queueData.details as string) ?? '';
      const size = (queueData.size as string) ?? 'S / 36';

      const color = inferColor(title, existingColor);
      const cat = inferCategory(title, productType);
      const material = inferMaterial(attrs);
      const vintedPrice = calculateVintedPrice(temuPrice);

      const listing: AutoListing = {
        folder_num: folderNum,
        crawled_product_id: row.id as number,
        title: generateTitle(title, productType, color, size),
        description: generateDescription({
          productType,
          color,
          size,
          material,
          details,
          temuDescription: description,
        }),
        category: cat.category,
        subcategory: cat.subcategory,
        brand: 'Ohne Marke',
        size: size.replace(/\s*\/.*/, ''), // "S / 36" → "S"
        condition: 'Sehr gut',
        color,
        material,
        price_eur: vintedPrice,
        temu_price_eur: temuPrice,
        profit_margin_eur: Math.round((vintedPrice - temuPrice) * 100) / 100,
        shipping_method: vintedPrice >= 20 ? 'DHL Päckchen' : 'Hermes S',
        photo_paths: photoPaths,
        status: 'draft',
      };

      // If auto-approve is on, skip the review step and go straight to the
      // auto-publisher. This is the "nur noch packen" default.
      const autoApprove = getSetting('auto_listing_auto_approve') === 'true';
      const initialStatus = autoApprove ? 'approved' : 'draft';

      const temuUrlForDraft = (row.temu_url as string | null) ?? '';

      getDb()
        .prepare(
          `INSERT INTO auto_listings
             (folder_num, crawled_product_id, title, description, category,
              subcategory, brand, size, condition, color, material,
              price_eur, temu_price_eur, profit_margin_eur,
              shipping_method, photo_paths_json, temu_url, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          listing.folder_num,
          listing.crawled_product_id,
          listing.title,
          listing.description,
          listing.category,
          listing.subcategory,
          listing.brand,
          listing.size,
          listing.condition,
          listing.color,
          listing.material,
          listing.price_eur,
          listing.temu_price_eur,
          listing.profit_margin_eur,
          listing.shipping_method,
          JSON.stringify(listing.photo_paths),
          temuUrlForDraft,
          initialStatus,
        );

      log.info('Listing draft generated', {
        folderNum,
        title: listing.title,
        price: listing.price_eur,
        photos: photoPaths.length,
      });
      stats.generated++;
    } catch (err) {
      stats.errors++;
      log.error('Failed to generate listing', {
        folder_num: row.folder_num,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return stats;
}

// ── Query helpers ────────────────────────────────────────────────────────────

export function listAutoListings(status?: string): AutoListing[] {
  const query = status
    ? 'SELECT * FROM auto_listings WHERE status = ? ORDER BY created_at DESC'
    : 'SELECT * FROM auto_listings ORDER BY created_at DESC LIMIT 200';
  const rows = status
    ? (getDb().prepare(query).all(status) as Array<Record<string, unknown>>)
    : (getDb().prepare(query).all() as Array<Record<string, unknown>>);

  return rows.map(rowToListing);
}

export function getAutoListing(id: number): AutoListing | null {
  const row = getDb()
    .prepare('SELECT * FROM auto_listings WHERE id = ?')
    .get(id) as Record<string, unknown> | undefined;
  return row ? rowToListing(row) : null;
}

export function updateAutoListing(
  id: number,
  updates: Partial<Pick<AutoListing, 'title' | 'description' | 'price_eur' | 'size' | 'condition' | 'color' | 'status'>>,
): void {
  const fields: string[] = [];
  const values: unknown[] = [];

  for (const [key, val] of Object.entries(updates)) {
    if (val !== undefined) {
      fields.push(`${key} = ?`);
      values.push(val);
    }
  }
  if (fields.length === 0) return;

  fields.push("updated_at = datetime('now')");
  values.push(id);

  getDb()
    .prepare(`UPDATE auto_listings SET ${fields.join(', ')} WHERE id = ?`)
    .run(...values);
}

export function approveAutoListing(id: number): void {
  // Guard: only approve when generated photos exist. Raw CJ-source rows must
  // stay in 'raw' until image-generator produces a model+scene+product render.
  const row = getDb()
    .prepare(`SELECT photo_paths_json, status FROM auto_listings WHERE id = ?`)
    .get(id) as { photo_paths_json: string; status: string } | undefined;
  if (!row) throw new Error(`Auto-listing ${id} not found`);
  const photos = row.photo_paths_json || '';
  const hasGenerated = /\/scene\/|\/final\/|\/generated\//.test(photos);
  if (!hasGenerated) {
    throw new Error(
      `Cannot approve listing ${id}: no generated photos (only raw CJ stock). ` +
      `Run image-generator first.`,
    );
  }
  updateAutoListing(id, { status: 'approved' });
}

/**
 * Approve all listings whose photos are *fully generated* (have a model+scene+
 * product render — i.e. path contains `/scene/`, `/final/`, or `/generated/`).
 *
 * Raw CJ-source listings stay in 'raw' status and are excluded. This prevents
 * the auto-publisher from publishing listings with bare stock photos.
 */
export function approveAllDrafts(): number {
  const result = getDb()
    .prepare(`
      UPDATE auto_listings
         SET status = 'approved', updated_at = datetime('now')
       WHERE status = 'draft'
         AND (photo_paths_json LIKE '%/scene/%'
              OR photo_paths_json LIKE '%/final/%'
              OR photo_paths_json LIKE '%/generated/%')
    `)
    .run();
  return result.changes;
}

function rowToListing(row: Record<string, unknown>): AutoListing {
  return {
    id: row.id as number,
    folder_num: row.folder_num as number,
    crawled_product_id: row.crawled_product_id as number,
    title: row.title as string,
    description: row.description as string,
    category: row.category as string,
    subcategory: row.subcategory as string,
    brand: row.brand as string,
    size: row.size as string,
    condition: row.condition as string,
    color: row.color as string,
    material: row.material as string,
    price_eur: row.price_eur as number,
    temu_price_eur: row.temu_price_eur as number,
    profit_margin_eur: row.profit_margin_eur as number,
    shipping_method: row.shipping_method as string,
    photo_paths: JSON.parse((row.photo_paths_json as string) || '[]'),
    status: row.status as AutoListing['status'],
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
  };
}
