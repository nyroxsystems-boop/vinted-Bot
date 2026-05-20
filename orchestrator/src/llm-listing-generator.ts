// ──────────────────────────────────────────────────────────────────────────────
// LLM-powered Listing Auto-Fill
//
// Takes a product folder (images + optional Temu URL/scraped data) and asks
// Claude (vision) to fill ALL Vinted listing fields in one shot:
//   title, description, category, brand, size, condition, colors,
//   material, price_eur, shipping
//
// Designed for the Dashboard "Auto-fill" button: user clicks once, reviews,
// publishes. No per-field tinkering.
// ──────────────────────────────────────────────────────────────────────────────

import fs from 'node:fs/promises';
import path from 'node:path';
import { createLogger, getDb, getSetting } from '@vinted-system/shared';

const log = createLogger('llm-listing-generator');

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY ?? '';
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-6';
const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';

// ── Vinted enum constants (must match dashboard ProductDetail.tsx) ───────────

export const VINTED_CATEGORIES = [
  'Damen > Kleider > Minikleider', 'Damen > Kleider > Midikleider',
  'Damen > Kleider > Maxikleider', 'Damen > Kleider > Sommerkleider',
  'Damen > Kleider > Cocktailkleider', 'Damen > Kleider > Abendkleider',
  'Damen > Kleider > Alltagskleider',
  'Damen > Oberteile > T-Shirts', 'Damen > Oberteile > Crop Tops',
  'Damen > Oberteile > Blusen', 'Damen > Oberteile > Kapuzenpullover',
  'Damen > Oberteile > Sweatshirts',
  'Damen > Hosen > Jeans', 'Damen > Hosen > Leggings', 'Damen > Hosen > Jogginghosen',
  'Damen > Röcke > Miniröcke', 'Damen > Röcke > Midiröcke',
  'Damen > Sportkleidung > Sport-BHs', 'Damen > Sportkleidung > Leggings',
  'Damen > Sportkleidung > Shorts', 'Damen > Sportkleidung > Tops',
  'Damen > Jacken & Mäntel > Übergangsjacken',
  'Damen > Bademode > Bikinis', 'Damen > Bademode > Badeanzüge',
] as const;

export const VINTED_SIZES = ['XXXS','XXS','XS','S','M','L','XL','XXL','XXXL','4XL','5XL'] as const;
export const VINTED_CONDITIONS = ['Neu, mit Etikett','Neu','Sehr gut','Gut','Befriedigend'] as const;
export const VINTED_COLORS = [
  'Schwarz','Weiß','Beige','Grau','Braun','Rot','Orange','Gelb','Grün','Blau',
  'Lila','Rosa','Türkis','Gold','Silber','Weinrot','Khaki','Creme','Bordeaux',
  'Mint','Koralle','Mehrfarbig',
] as const;
export const VINTED_MATERIALS = [
  'Polyester','Baumwolle','Elasthan','Viskose','Nylon','Leinen','Seide','Satin',
  'Spitze','Denim','Wolle','Kunstleder','Samt','Chiffon','Jersey','Tüll','Mesh',
  'Acryl','Andere',
] as const;
export const VINTED_SHIPPING = ['Klein','Mittel','Groß'] as const;

// ── Result type ──────────────────────────────────────────────────────────────

export interface AutoFilledListing {
  title: string;          // ≤ 80 chars, Vinted-girl style
  description: string;    // 80–400 chars, authentic German
  category: string;       // one of VINTED_CATEGORIES
  brand: string;          // "Ohne Marke" wenn unbekannt
  size: string;           // one of VINTED_SIZES
  condition: string;      // one of VINTED_CONDITIONS
  colors: string[];       // 1-2 items from VINTED_COLORS
  material: string;       // one of VINTED_MATERIALS
  price_eur: number;      // EUR, .99-Endung
  shipping: string;       // one of VINTED_SHIPPING
}

export interface AutoFillContext {
  folderNum: number;
  imagePaths: string[];          // bis zu 6 absolute Pfade
  temuTitle?: string;
  temuDescription?: string;
  temuPriceEur?: number;
  temuAttributes?: Record<string, string>;
  hintSize?: string;
  hintColor?: string;
}

// ── Markup pricing (kept consistent with listing-generator.ts) ───────────────

// Mindestpreis pro Listing — liest aus DB settings, dann ENV, dann Default.
// So sind Repricer und Listing-Generator immer synchron.
function getMinListPrice(): number {
  try {
    const dbVal = getSetting('repricing_min_price_eur');
    if (dbVal) return Number(dbVal);
  } catch { /* DB not initialized yet — use env/default */ }
  return Number(process.env.MIN_LIST_PRICE_EUR ?? 20);
}

function calcPrice(temuPrice: number): number {
  const minPrice = getMinListPrice();
  if (!temuPrice || temuPrice <= 0) return Math.max(minPrice + 0.99, 24.99);
  let m: number;
  if (temuPrice <= 5) m = 3.5;
  else if (temuPrice <= 10) m = 3.0;
  else if (temuPrice <= 15) m = 2.5;
  else if (temuPrice <= 25) m = 2.0;
  else m = 1.8;
  const raw = Math.floor(temuPrice * m) + 0.99;
  // Floor: nie unter MIN_LIST_PRICE_EUR
  return Math.max(raw, minPrice + 0.99);
}

// ── Image loader (resize-light: just base64 the file) ────────────────────────

async function imageToBlock(absPath: string): Promise<{
  type: 'image';
  source: { type: 'base64'; media_type: string; data: string };
} | null> {
  try {
    const ext = path.extname(absPath).toLowerCase();
    const mediaType =
      ext === '.png'  ? 'image/png'  :
      ext === '.webp' ? 'image/webp' :
      ext === '.gif'  ? 'image/gif'  :
                        'image/jpeg';
    const buf = await fs.readFile(absPath);
    // Anthropic limit: ~5MB per image. Hard-skip larger files.
    if (buf.byteLength > 4_500_000) {
      log.warn('Skipping oversized image', { absPath, size: buf.byteLength });
      return null;
    }
    return {
      type: 'image',
      source: {
        type: 'base64',
        media_type: mediaType,
        data: buf.toString('base64'),
      },
    };
  } catch (err) {
    log.warn('Failed to read image', { absPath, err: String(err) });
    return null;
  }
}

// ── Prompt builder ───────────────────────────────────────────────────────────

function buildPrompt(ctx: AutoFillContext): string {
  const lines: string[] = [];
  lines.push(
    'Du bist ein professioneller Vinted-Verkäufer aus Deutschland. ' +
    'Du erhältst Fotos eines Kleidungsstücks (von einer i-Model getragen) ' +
    'und ggf. Temu-Quelldaten. Erzeuge ein KOMPLETTES, sofort veröffentlichbares Vinted-Listing auf Deutsch.',
  );
  lines.push('');
  lines.push('STIL: Authentisch, persönlich, wie eine echte junge Frau die Klamotten verkauft. Keine KI-Floskeln, keine Werbe-Sprache, keine Übertreibungen.');
  lines.push('');
  lines.push('REGELN:');
  lines.push('- Titel max 80 Zeichen, knackig (z.B. "Schwarzes Minikleid Größe S")');
  lines.push('- Beschreibung 80-400 Zeichen, 1-2 kurze Absätze, locker geschrieben');
  lines.push('- Brand "Ohne Marke" wenn keine sichtbar');
  lines.push('- Zustand: in der Regel "Sehr gut" (1x getragen) oder "Neu, mit Etikett" wenn Etikett sichtbar');
  lines.push('- Farben: 1-2 dominante Farben aus der Liste');
  lines.push('- Versand: "Klein" für Tops/Kleider/Röcke, "Mittel" für Hosen/Jacken, "Groß" für Mäntel');
  lines.push(`- price_eur: HARTE Untergrenze ${getMinListPrice()}€ — niemals weniger. Bei Unsicherheit 0 setzen, dann rechnet das System.`);
  lines.push('');
  lines.push('ERLAUBTE WERTE (genau so verwenden):');
  lines.push(`- category: ${VINTED_CATEGORIES.join(' | ')}`);
  lines.push(`- size: ${VINTED_SIZES.join(' | ')}`);
  lines.push(`- condition: ${VINTED_CONDITIONS.join(' | ')}`);
  lines.push(`- colors (1-2): ${VINTED_COLORS.join(' | ')}`);
  lines.push(`- material: ${VINTED_MATERIALS.join(' | ')}`);
  lines.push(`- shipping: ${VINTED_SHIPPING.join(' | ')}`);
  lines.push('');

  if (ctx.temuTitle || ctx.temuDescription || ctx.temuPriceEur || ctx.temuAttributes) {
    lines.push('TEMU-QUELLDATEN (zur Orientierung, NICHT 1:1 übernehmen):');
    if (ctx.temuTitle)        lines.push(`- Original-Titel: ${ctx.temuTitle}`);
    if (ctx.temuPriceEur)     lines.push(`- Einkaufspreis: €${ctx.temuPriceEur.toFixed(2)}`);
    if (ctx.temuDescription)  lines.push(`- Original-Beschreibung: ${ctx.temuDescription.slice(0, 500)}`);
    if (ctx.temuAttributes && Object.keys(ctx.temuAttributes).length > 0) {
      lines.push('- Attribute:');
      for (const [k, v] of Object.entries(ctx.temuAttributes).slice(0, 12)) {
        lines.push(`  • ${k}: ${v}`);
      }
    }
    lines.push('');
  }

  if (ctx.hintSize || ctx.hintColor) {
    lines.push('HINWEISE:');
    if (ctx.hintSize)  lines.push(`- Größe ist ${ctx.hintSize}`);
    if (ctx.hintColor) lines.push(`- Farbe ist ${ctx.hintColor}`);
    lines.push('');
  }

  lines.push('Antworte AUSSCHLIESSLICH mit folgendem JSON-Objekt, keine Erklärungen, kein Markdown-Codeblock:');
  lines.push('{"title":"","description":"","category":"","brand":"","size":"","condition":"","colors":[],"material":"","price_eur":0,"shipping":""}');

  return lines.join('\n');
}

// ── Validate + clamp LLM output to enums ─────────────────────────────────────

function clampToEnum<T extends string>(val: unknown, allowed: readonly T[], fallback: T): T {
  if (typeof val !== 'string') return fallback;
  const direct = allowed.find((a) => a === val);
  if (direct) return direct;
  const ci = allowed.find((a) => a.toLowerCase() === val.toLowerCase());
  if (ci) return ci;
  return fallback;
}

function validateOutput(raw: unknown, ctx: AutoFillContext): AutoFilledListing {
  const r = (raw ?? {}) as Record<string, unknown>;

  const colorsRaw = Array.isArray(r.colors) ? r.colors : [];
  const colors = colorsRaw
    .slice(0, 2)
    .map((c) => clampToEnum(c, VINTED_COLORS, 'Mehrfarbig'))
    .filter((c, i, a) => a.indexOf(c) === i);

  const llmPrice = typeof r.price_eur === 'number' ? r.price_eur : 0;
  const computed = calcPrice(ctx.temuPriceEur ?? 0);
  // Wenn LLM Preis < MIN, ignorieren und Floor-Berechnung verwenden
  const finalPrice = llmPrice >= getMinListPrice() ? llmPrice : computed;

  return {
    title: typeof r.title === 'string' ? r.title.slice(0, 150) : '',
    description: typeof r.description === 'string' ? r.description.slice(0, 2000) : '',
    category: clampToEnum(r.category, VINTED_CATEGORIES, 'Damen > Kleider > Alltagskleider'),
    brand: typeof r.brand === 'string' && r.brand.trim() ? r.brand.trim() : 'Ohne Marke',
    size: clampToEnum(r.size, VINTED_SIZES, ctx.hintSize as typeof VINTED_SIZES[number] | undefined ?? 'S'),
    condition: clampToEnum(r.condition, VINTED_CONDITIONS, 'Sehr gut'),
    colors: colors.length > 0 ? colors : ['Mehrfarbig'],
    material: clampToEnum(r.material, VINTED_MATERIALS, 'Polyester'),
    price_eur: Math.round(finalPrice * 100) / 100,
    shipping: clampToEnum(r.shipping, VINTED_SHIPPING, 'Klein'),
  };
}

// ── Heuristic fallback (when no API key configured) ──────────────────────────

function heuristicFallback(ctx: AutoFillContext): AutoFilledListing {
  const txt = (ctx.temuTitle ?? '').toLowerCase();
  const cat: string =
    /minikleid|mini.?kleid/.test(txt) ? 'Damen > Kleider > Minikleider' :
    /maxikleid|maxi.?kleid/.test(txt) ? 'Damen > Kleider > Maxikleider' :
    /midikleid|midi.?kleid/.test(txt) ? 'Damen > Kleider > Midikleider' :
    /sommerkleid/.test(txt)           ? 'Damen > Kleider > Sommerkleider' :
    /kleid|dress/.test(txt)           ? 'Damen > Kleider > Alltagskleider' :
    /leggings/.test(txt)              ? 'Damen > Sportkleidung > Leggings' :
    /crop.?top/.test(txt)             ? 'Damen > Oberteile > Crop Tops' :
    /hoodie/.test(txt)                ? 'Damen > Oberteile > Kapuzenpullover' :
    /top|shirt|bluse/.test(txt)       ? 'Damen > Oberteile > T-Shirts' :
    /rock|skirt/.test(txt)            ? 'Damen > Röcke > Miniröcke' :
    /hose|jeans|jogger/.test(txt)     ? 'Damen > Hosen > Jeans' :
                                         'Damen > Kleider > Alltagskleider';

  const color =
    /schwarz|black/.test(txt) ? 'Schwarz' :
    /weiß|weiss|white/.test(txt) ? 'Weiß' :
    /rosa|pink/.test(txt) ? 'Rosa' :
    /blau|blue|navy/.test(txt) ? 'Blau' :
    /grün|green/.test(txt) ? 'Grün' :
    /rot|red/.test(txt) ? 'Rot' :
    /beige|nude|creme/.test(txt) ? 'Beige' :
    /grau|grey/.test(txt) ? 'Grau' :
    'Mehrfarbig';

  const productName = cat.split(' > ').pop() ?? 'Kleidungsstück';
  const size = ctx.hintSize ?? 'S';

  return {
    title: `${color !== 'Mehrfarbig' ? color + ' ' : ''}${productName} Gr. ${size}`.slice(0, 80),
    description:
      `Verkaufe ${color !== 'Mehrfarbig' ? 'mein ' + color.toLowerCase() + 'es' : 'mein süßes'} ${productName.toLowerCase()}.\n\n` +
      `Nur einmal getragen, Zustand wie neu. Tierfreier Nichtraucherhaushalt. Bei Fragen einfach schreiben! :)`,
    category: cat,
    brand: 'Ohne Marke',
    size,
    condition: 'Sehr gut',
    colors: [color],
    material: 'Polyester',
    price_eur: calcPrice(ctx.temuPriceEur ?? 0),
    shipping: /hose|jacke|mantel/.test(txt) ? 'Mittel' : 'Klein',
  };
}

// ── Main entry ───────────────────────────────────────────────────────────────

export async function autoFillListing(ctx: AutoFillContext): Promise<{
  listing: AutoFilledListing;
  source: 'llm' | 'heuristic';
  warnings: string[];
}> {
  const warnings: string[] = [];

  if (!ANTHROPIC_API_KEY) {
    warnings.push('ANTHROPIC_API_KEY nicht gesetzt — Heuristik-Fallback aktiv');
    return { listing: heuristicFallback(ctx), source: 'heuristic', warnings };
  }

  // Pick up to 6 best photos (API cost + speed)
  const picked = ctx.imagePaths.slice(0, 6);
  const imageBlocks = (await Promise.all(picked.map(imageToBlock))).filter((b): b is NonNullable<typeof b> => b !== null);

  if (imageBlocks.length === 0) {
    warnings.push('Keine ladbaren Bilder — Heuristik-Fallback');
    return { listing: heuristicFallback(ctx), source: 'heuristic', warnings };
  }

  const prompt = buildPrompt(ctx);
  const userContent: unknown[] = [...imageBlocks, { type: 'text', text: prompt }];

  try {
    const res = await fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: 1024,
        messages: [{ role: 'user', content: userContent }],
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      log.error('Anthropic API error', { status: res.status, body: text.slice(0, 300) });
      warnings.push(`LLM-API ${res.status}: Heuristik-Fallback aktiv`);
      return { listing: heuristicFallback(ctx), source: 'heuristic', warnings };
    }

    const data = (await res.json()) as { content?: Array<{ type: string; text?: string }> };
    const textBlock = data.content?.find((c) => c.type === 'text');
    const reply = (textBlock?.text ?? '').trim();

    // Strip markdown fences if present
    const jsonStr = reply
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```\s*$/i, '')
      .trim();

    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonStr);
    } catch {
      // Try to extract first {…} block
      const m = jsonStr.match(/\{[\s\S]*\}/);
      if (m) {
        try { parsed = JSON.parse(m[0]); } catch { /* */ }
      }
    }

    if (!parsed) {
      warnings.push('LLM-Antwort nicht parsebar — Heuristik');
      return { listing: heuristicFallback(ctx), source: 'heuristic', warnings };
    }

    return { listing: validateOutput(parsed, ctx), source: 'llm', warnings };
  } catch (err) {
    log.error('LLM call failed', { err: String(err) });
    warnings.push('LLM-Aufruf fehlgeschlagen — Heuristik');
    return { listing: heuristicFallback(ctx), source: 'heuristic', warnings };
  }
}

// ── DB context helper ────────────────────────────────────────────────────────
//
// Pulls Temu source data from the crawled_products table for a given folder.
// Best-effort — returns empty object if no row.

export function loadTemuContext(folderNum: number): Partial<AutoFillContext> {
  try {
    const row = getDb()
      .prepare(
        `SELECT title, description, price_eur, attributes_json, temu_url
           FROM crawled_products WHERE folder_num = ? ORDER BY id DESC LIMIT 1`,
      )
      .get(folderNum) as Record<string, unknown> | undefined;

    if (!row) return {};
    let attrs: Record<string, string> = {};
    try {
      const parsed = JSON.parse((row.attributes_json as string) ?? '{}');
      if (parsed && typeof parsed === 'object') attrs = parsed as Record<string, string>;
    } catch { /* ignore */ }

    return {
      temuTitle: (row.title as string) ?? undefined,
      temuDescription: (row.description as string) ?? undefined,
      temuPriceEur: typeof row.price_eur === 'number' ? row.price_eur : undefined,
      temuAttributes: attrs,
    };
  } catch (err) {
    log.warn('loadTemuContext failed', { folderNum, err: String(err) });
    return {};
  }
}
