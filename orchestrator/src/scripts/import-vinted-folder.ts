// ──────────────────────────────────────────────────────────────────────────────
// Importer: /Users/home/Vinted/Vinted/{Category}/{N}/{CJ-CODE}_…/  →  auto_listings
//
// Source of truth:
//   • /Users/home/Vinted/Vinted/Links/Produkte.txt (CJ URLs nummeriert pro Kat)
//   • /Users/home/Vinted/Vinted/{Category}/{N}/{CJ-SKU}_{ts}/{N}_*.jpg (Bilder)
//
// Output: auto_listings rows (status='draft'), eindeutig per (category,position)
// via crawled_product_id ist nicht passend → wir nutzen (folder_num, account_id).
// folder_num wird global fortlaufend vergeben (1..N) — die ursprüngliche
// Position in der Kategorie steckt im title als „[Kleider #3]".
//
// Run: tsx orchestrator/src/scripts/import-vinted-folder.ts [--dry-run] [--reset]
// ──────────────────────────────────────────────────────────────────────────────

import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { getDb, runMigrations } from '@vinted-system/shared';

// ── Konfig ────────────────────────────────────────────────────────────────────

import { vintedRoot } from '@vinted-system/shared';
const VINTED_ROOT = path.join(vintedRoot(), 'Vinted');
const LINKS_FILE = path.join(VINTED_ROOT, 'Links', 'Produkte.txt');
const ACCOUNT_ID = 1;

const PRICE_MIN = 24;
const PRICE_MAX = 35;

// Kategorie-Header in Produkte.txt → Filesystem-Ordnername → Vinted-Kategorie
// Filesystem-Match ist case-insensitive + Whitespace-tolerant.
const CATEGORY_MAP: Array<{
  header: string;          // wie in Produkte.txt geschrieben
  folder: string;          // Filesystem-Ordnername
  vintedCategory: string;  // Vinted-Format, später vom LLM verfeinert
}> = [
  { header: 'KLEIDER',           folder: 'Kleider',          vintedCategory: 'Damen > Kleider > Sommerkleider' },
  { header: 'JUMPSUITS',         folder: 'Jumpsuits',        vintedCategory: 'Damen > Jumpsuits' },
  { header: 'BLAZERS',           folder: 'Blazers',          vintedCategory: 'Damen > Jacken & Mäntel > Blazer' },
  { header: 'SKIRTS',            folder: 'Skirts',           vintedCategory: 'Damen > Röcke' },
  { header: 'HANDBAGS',          folder: 'Handbags',         vintedCategory: 'Damen > Taschen > Schultertaschen' },
  { header: 'HOT PANTS / SHORTS', folder: 'Hotpants Shorts', vintedCategory: 'Damen > Hosen & Leggings > Shorts' },
  { header: 'JEANS',             folder: 'Jeans',            vintedCategory: 'Damen > Hosen & Leggings > Jeans' },
  { header: 'JACKETS',           folder: 'Jackets',          vintedCategory: 'Damen > Jacken & Mäntel > Jacken' },
];

// ── Argparse ──────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const RESET = args.includes('--reset');

// ── Utils ─────────────────────────────────────────────────────────────────────

function randomPrice(): number {
  // 24.00–35.00 in 0.50-Schritten — wirkt menschlicher als plain random
  const steps = (PRICE_MAX - PRICE_MIN) * 2;
  return PRICE_MIN + Math.floor(Math.random() * (steps + 1)) / 2;
}

function unslug(slug: string): string {
  return slug
    .replace(/-/g, ' ')
    .replace(/\bp\b\s+\d+/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function extractPidFromUrl(url: string): string | null {
  // ...-p-2506170815061609200.html  →  2506170815061609200
  const m = url.match(/-p-(\d+)\.html/i);
  return m?.[1] ?? null;
}

function extractSlugFromUrl(url: string): string | null {
  // /product/summer-solid-color-pleated-dress-p-2506...html → summer-solid-color-pleated-dress
  const m = url.match(/\/product\/(.+?)-p-\d+\.html/i);
  return m?.[1] ?? null;
}

// ── Produkte.txt parsen ──────────────────────────────────────────────────────

interface ParsedLink {
  category: string;     // Vinted-Kategorie
  folder: string;       // FS-Ordnername
  position: number;     // 1..N innerhalb der Kategorie
  url: string;
  pid: string | null;
  slug: string | null;
}

function parseLinksFile(filePath: string): ParsedLink[] {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split(/\r?\n/);

  let currentCat: typeof CATEGORY_MAP[number] | null = null;
  const out: ParsedLink[] = [];

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    // Header-Zeile?
    const matched = CATEGORY_MAP.find((c) => c.header === line);
    if (matched) {
      currentCat = matched;
      continue;
    }

    // Nummerierte Zeile? "1.\thttps://..."
    const m = line.match(/^(\d+)\.\s+(https?:\/\/\S+)/);
    if (!m || !currentCat) continue;

    const pos = m[1];
    const url = m[2];
    if (!pos || !url) continue;
    out.push({
      category: currentCat.vintedCategory,
      folder: currentCat.folder,
      position: Number(pos),
      url,
      pid: extractPidFromUrl(url),
      slug: extractSlugFromUrl(url),
    });
  }
  return out;
}

// ── Filesystem: CJ-SKU + Bilder pro {Kategorie, Position} ─────────────────────

interface FsProduct {
  cjSku: string | null;     // z.B. "CJLY2404206"
  fullSubdir: string | null; // z.B. ".../Kleider/1/CJLY2404206_1778078210511"
  photos: string[];          // absolute Bild-Pfade
}

function readFsProduct(folder: string, position: number): FsProduct {
  const dir = path.join(VINTED_ROOT, folder, String(position));
  const result: FsProduct = { cjSku: null, fullSubdir: null, photos: [] };

  if (!fs.existsSync(dir)) return result;

  // Subordner finden — erster Subordner gilt (es gibt typisch nur einen)
  const subs = fs.readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name);

  if (subs.length === 0) return result;

  // CJ-SKU = Teil vor dem ersten "_"  ("CJLY2404206_1778078210511" → "CJLY2404206")
  const subdirName = subs[0];
  if (!subdirName) return result;
  const skuMatch = subdirName.match(/^(CJ[A-Z]{2}\d+)/i);
  result.cjSku = skuMatch?.[1] ?? null;
  result.fullSubdir = path.join(dir, subdirName);

  // Bilder sammeln und sortieren (1_..., 2_..., ...)
  const files = fs.readdirSync(result.fullSubdir)
    .filter((f) => /\.(jpe?g|png|webp)$/i.test(f))
    .sort((a, b) => {
      const na = Number(a.split('_')[0]) || 0;
      const nb = Number(b.split('_')[0]) || 0;
      return na - nb;
    });

  result.photos = files.map((f) => path.join(result.fullSubdir!, f));
  return result;
}

// ── Main ──────────────────────────────────────────────────────────────────────

function main(): void {
  runMigrations();
  const db = getDb();

  if (RESET && !DRY_RUN) {
    const del = db.prepare(`DELETE FROM auto_listings WHERE account_id = ? AND title LIKE '[Import]%'`).run(ACCOUNT_ID);
    console.log(`RESET: ${del.changes} rows deleted (auto_listings with [Import] tag)`);
  }

  console.log('Parsing Produkte.txt …');
  const links = parseLinksFile(LINKS_FILE);
  console.log(`  → ${links.length} links parsed across ${new Set(links.map(l => l.folder)).size} categories`);

  const insert = db.prepare(`
    INSERT INTO auto_listings (
      account_id, folder_num, title, description, category, subcategory,
      brand, size, condition, color, material,
      price_eur, temu_price_eur, profit_margin_eur,
      shipping_method, photo_paths_json, temu_url,
      cj_product_id, cj_variant_id, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  // Höchste vergebene folder_num als Offset, damit wir keine Kollisionen bauen
  const maxRow = db.prepare(`SELECT COALESCE(MAX(folder_num), 0) AS m FROM auto_listings WHERE account_id = ?`).get(ACCOUNT_ID) as { m: number };
  let folderNum = maxRow.m;

  let imported = 0;
  let skipped = 0;
  const skipReasons: Record<string, number> = {};

  for (const link of links) {
    const fs_ = readFsProduct(link.folder, link.position);

    // Skip-Bedingungen
    if (!fs_.cjSku) {
      skipped++;
      skipReasons['no-cj-sku'] = (skipReasons['no-cj-sku'] || 0) + 1;
      console.log(`  SKIP ${link.folder}/${link.position}: kein CJ-SKU im Subordner-Namen`);
      continue;
    }
    if (fs_.photos.length === 0) {
      skipped++;
      skipReasons['no-photos'] = (skipReasons['no-photos'] || 0) + 1;
      console.log(`  SKIP ${link.folder}/${link.position}: keine Bilder gefunden`);
      continue;
    }
    if (!link.pid) {
      skipped++;
      skipReasons['no-pid'] = (skipReasons['no-pid'] || 0) + 1;
      console.log(`  SKIP ${link.folder}/${link.position}: keine pid in URL`);
      continue;
    }

    folderNum += 1;
    const title = `[Import] ${link.folder} #${link.position} — ${unslug(link.slug ?? '')}`.slice(0, 200);
    const description = `Import-Platzhalter (LLM-Generator überschreibt das).\nQuelle: ${link.url}\nCJ-SKU: ${fs_.cjSku}\nPhotos: ${fs_.photos.length}`;
    const price = randomPrice();

    if (DRY_RUN) {
      console.log(`  [dry] folder_num=${folderNum} cat=${link.folder} pos=${link.position} sku=${fs_.cjSku} pid=${link.pid} photos=${fs_.photos.length} price=${price}€`);
    } else {
      insert.run(
        ACCOUNT_ID, folderNum,
        title, description, link.category, '',
        'Ohne Marke', 'S', 'Sehr gut', '', '',
        price, 0, 0,
        'Hermes S',
        JSON.stringify(fs_.photos),
        link.url,                  // → temu_url-Spalte hält jetzt CJ-URL
        link.pid,                  // → cj_product_id
        null,                      // cj_variant_id (wird beim ersten CJ-Lookup gesetzt)
        'draft',
      );
    }
    imported++;
  }

  console.log('');
  console.log(`Import done: ${imported} ${DRY_RUN ? '(dry)' : 'rows inserted'}, ${skipped} skipped`);
  if (Object.keys(skipReasons).length) {
    console.log('Skip-Gründe:', skipReasons);
  }
  console.log('');
  console.log('Verification:');
  const total = db.prepare(`SELECT COUNT(*) AS c FROM auto_listings WHERE status='draft'`).get() as { c: number };
  console.log(`  auto_listings (status=draft): ${total.c}`);
}

main();
