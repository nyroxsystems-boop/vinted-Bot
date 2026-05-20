// ──────────────────────────────────────────────────────────────────────────────
// Per-Marketplace Listing-Variant Generator
//
// Vinted and Kleinanzeigen have very different audiences:
//   - Vinted: short emoji-friendly titles (≤100 chars), Gen-Z tone, hashtags
//     at end of description, photo-driven, brand+condition prominent.
//   - Kleinanzeigen: longer factual title (≤65 chars), formal German tone,
//     bullet-list description, mentions Hermes-Versand + Käuferschutz, no
//     emojis, no hashtags. Brand often "Ohne Marke" because lower-trust shop.
//
// For each auto_listings row, we generate one variant per target marketplace
// via Claude, store in auto_listing_variants. Auto-Publisher reads the
// right variant before pushing to each marketplace bot.
//
// The worker batches: tries to keep up with new auto_listings without
// hammering the Claude API (max ~12 generations/cycle, every 5 min).
// ──────────────────────────────────────────────────────────────────────────────

import {
  createLogger, getDb, getSetting, isPaused, withLock, callLLM, parseLLMJson, recordWorkerEvent,
  getTopVariants, readVariantContent, type VariantStats,
} from '@vinted-system/shared';
import { eventBus } from './events.js';

const log = createLogger('variant-generator');

// Best-effort schema add — variants table didn't originally track failures.
// We record them so the auto-publisher can refuse to fall back to the master
// row (avoids publishing an off-brand Vinted master to e.g. eBay).
(function ensureVariantStatusColumns(): void {
  const db = getDb();
  const tryAdd = (sql: string) => {
    try { db.exec(sql); } catch { /* column already exists */ }
  };
  tryAdd(`ALTER TABLE auto_listing_variants ADD COLUMN status TEXT NOT NULL DEFAULT 'ok'`);
  tryAdd(`ALTER TABLE auto_listing_variants ADD COLUMN last_error TEXT`);
})();

let timer: ReturnType<typeof setInterval> | null = null;
const INTERVAL_MS = 5 * 60 * 1000;
// Settings-driven so the user can crank this up when backfilling many
// marketplaces. Claude-CLI (default provider) doesn't meaningfully rate-limit
// us, so 24/cycle is the sweet spot; Gemini Free-Tier rate-limits at 15 RPM
// so users running the gemini fallback should cap at ~12. The setting wins.
function getMaxPerCycle(): number {
  const raw = getSetting('variant_gen_max_per_cycle');
  const n = raw ? Number(raw) : 24;
  return Number.isFinite(n) && n > 0 && n <= 200 ? n : 24;
}

const VINTED_TITLE_MAX = 100;
const KA_TITLE_MAX = 65;
const EBAY_TITLE_MAX = 80;
const DEPOP_TITLE_MAX = 65;
const MERCARI_TITLE_MAX = 80;
const WALLAPOP_TITLE_MAX = 50;
const ETSY_TITLE_MAX = 140;
const GRAILED_TITLE_MAX = 100;
const VESTIAIRE_TITLE_MAX = 100;
const WHATNOT_TITLE_MAX = 100;
const FB_MARKETPLACE_TITLE_MAX = 100;
const POSHMARK_TITLE_MAX = 80;
const LEBONCOIN_TITLE_MAX = 65;
const MARKTPLAATS_TITLE_MAX = 60;
const WILLHABEN_TITLE_MAX = 80;
const SHOPIFY_TITLE_MAX = 255;
const WOOCOMMERCE_TITLE_MAX = 255;

interface MarketplaceVariant {
  title: string;
  description: string;
  category?: string;
  brand?: string;
  size?: string;
  condition?: string;
  color?: string;
  material?: string;
  tags?: string[];
}

const VINTED_PROMPT = (src: SourceListing) => [
  'Du erstellst ein Vinted-Listing für eine Online-Shopperin in Deutschland.',
  '',
  'Style-Vorgaben:',
  `- Titel: maximal ${VINTED_TITLE_MAX} Zeichen. Kurz, modisch, Gen-Z. Emojis erlaubt (max 1-2). Marke/Style/Größe wenn vorhanden.`,
  '- Beschreibung: 2-4 Absätze. Locker, persönlich ("Mega schön zum Sommer-Outfit"). 3-5 Hashtags am Ende (#vintage #y2k #musthave).',
  '- Kategorie: muss aus dieser Liste sein: "Damen > Kleider > Mini/Midi/Maxi/Sommer/Cocktail/Abend/Alltag", "Damen > Oberteile > T-Shirts/Crop Tops/Blusen/Hoodies", "Damen > Hosen > Jeans/Leggings", "Damen > Röcke > Mini/Midi", "Damen > Jacken & Mäntel > Übergangsjacken".',
  '- Zustand: "Neu, mit Etikett" (Default für Dropshipping).',
  '- Brand: "Ohne Marke" oder spezifisch wenn klar.',
  '- Tags: 5-8 deutsche Keywords (Style, Anlass, Material).',
  '',
  'INPUT-Produkt:',
  `Titel-Original: "${src.title}"`,
  `Beschreibung-Original: "${src.description?.slice(0, 500) ?? ''}"`,
  `Kategorie-Hint: "${src.category ?? 'Damen'}"`,
  `Farbe: ${src.color ?? '?'}, Größe: ${src.size ?? '?'}, Material: ${src.material ?? '?'}`,
  `Preis: €${src.priceEur?.toFixed(2) ?? '?'}`,
  '',
  'OUTPUT als JSON (kein Markdown):',
  '{"title":"…","description":"…","category":"Damen > …","brand":"…","condition":"Neu, mit Etikett","color":"Schwarz","size":"S","material":"Polyester","tags":["…","…"]}',
].join('\n');

const EBAY_PROMPT = (src: SourceListing) => [
  'Du erstellst ein eBay.de-Inserat für eine Verkäuferin in Deutschland.',
  '',
  'Style-Vorgaben:',
  `- Titel: maximal ${EBAY_TITLE_MAX} Zeichen. **Keyword-optimiert** für eBay-Suche. Schema: "[Brand?] [Type] [Color] [Material] [Size] [Style] NEU".`,
  '  Beispiel: "Damen Sommerkleid Schwarz Polyester Gr. S A-Linie NEU"',
  '- Beschreibung: HTML erlaubt. Erste Zeile fett mit Hauptmerkmal. Dann Bullet-Liste mit "•" für: Material, Größe, Farbe, Maßangaben, Versand. Zum Schluss formale Rücknahme-/Gewährleistung-Klausel (kurz, deutsch).',
  '- Kategorie: aus dieser Liste: "Damenmode > Kleider", "Damenmode > Oberteile & T-Shirts", "Damenmode > Hosen", "Damenmode > Röcke", "Damenmode > Jacken, Mäntel & Westen", "Damenmode > Bademode", "Damenmode > Sportbekleidung".',
  '- Zustand: "Neu mit Etikett" (eBay-Wording).',
  '- Tags: 5-10 KEYWORDS (e.g. "Damen", "Sommer", "Bequem", "Casual", "Trendy"). KEINE Sonderzeichen.',
  '',
  'INPUT-Produkt:',
  `Titel-Original: "${src.title}"`,
  `Beschreibung-Original: "${src.description?.slice(0, 500) ?? ''}"`,
  `Kategorie-Hint: "${src.category ?? 'Damen'}"`,
  `Farbe: ${src.color ?? '?'}, Größe: ${src.size ?? '?'}, Material: ${src.material ?? '?'}`,
  `Preis: €${src.priceEur?.toFixed(2) ?? '?'}`,
  '',
  'OUTPUT als JSON (kein Markdown):',
  '{"title":"…","description":"…","category":"Damenmode > …","brand":"…","condition":"Neu mit Etikett","color":"…","size":"…","material":"…","tags":["…","…"]}',
].join('\n');

const DEPOP_PROMPT = (src: SourceListing) => [
  'You are creating a Depop listing for a UK/US Gen-Z buyer.',
  '',
  'Style rules:',
  `- Title: max ${DEPOP_TITLE_MAX} chars. Aesthetic-driven, lowercase or Title Case, NO ALL CAPS. Include style cues ("y2k", "coquette", "old money", "downtown", "preppy", "grunge"). NO emojis in title.`,
  '- Description: 3-5 short paragraphs, casual British/American English. Mention size, fit, material. Include occasion cues ("perfect for festival season", "matches well with low-rise jeans"). End with 10-15 hashtags in one line — Depop is hashtag-driven for discovery.',
  '- Category: pick from "Womenswear > Dresses", "Womenswear > Tops", "Womenswear > Bottoms", "Womenswear > Outerwear", "Womenswear > Swimwear", "Menswear > T-Shirts", "Menswear > Jackets", "Menswear > Jeans". Default to "Womenswear > Dresses".',
  '- Condition: "Brand new with tags" (Depop wording).',
  '- Tags: aesthetic keywords mixed with style ("y2k", "coquette", "fairycore", "minimalist", "preppy", "old money", "vintage", "indie", "streetwear", "boho", "cottagecore", "balletcore"). 10-15 tags total, one-word each.',
  '- Brand: leave empty if no clear brand (Depop tolerates unbranded).',
  '',
  'INPUT product:',
  `Original title: "${src.title}"`,
  `Original description: "${src.description?.slice(0, 500) ?? ''}"`,
  `Category hint: "${src.category ?? 'Womenswear'}"`,
  `Color: ${src.color ?? '?'}, Size: ${src.size ?? '?'}, Material: ${src.material ?? '?'}`,
  `Price: €${src.priceEur?.toFixed(2) ?? '?'}`,
  '',
  'OUTPUT as JSON (no markdown):',
  '{"title":"…","description":"…","category":"Womenswear > …","brand":"","condition":"Brand new with tags","color":"…","size":"…","material":"…","tags":["y2k","coquette","summer","minimalist","…"]}',
].join('\n');

const EBAY_UK_PROMPT = (src: SourceListing) => [
  'You are creating an eBay.co.uk listing for a UK seller.',
  '',
  'Style rules:',
  `- Title: max ${EBAY_TITLE_MAX} chars. **Keyword-optimized** for eBay search. Schema: "[Brand?] [Type] [Color] [Material] [Size] [Style] NEW".`,
  '  Example: "Womens Summer Dress Black Polyester Size S A-Line NEW WITH TAGS"',
  '- Description: HTML allowed. First line bold with main feature. Then bullet-list with "•" for: Material, Size, Color, Measurements, Shipping. End with brief returns clause.',
  '- Category: from list: "Women > Dresses", "Women > Tops & Shirts", "Women > Trousers", "Women > Skirts", "Women > Coats & Jackets", "Women > Swimwear", "Women > Activewear".',
  '- Condition: "New with tags" (eBay UK wording).',
  '- Tags: 5-10 keywords (e.g. "women", "summer", "casual", "trendy"). NO special chars.',
  '',
  'INPUT product:',
  `Original title: "${src.title}"`,
  `Original description: "${src.description?.slice(0, 500) ?? ''}"`,
  `Category hint: "${src.category ?? 'Women'}"`,
  `Color: ${src.color ?? '?'}, Size: ${src.size ?? '?'}, Material: ${src.material ?? '?'}`,
  `Price: £${src.priceEur ? (src.priceEur * 0.85).toFixed(2) : '?'}`,
  '',
  'OUTPUT as JSON (no markdown):',
  '{"title":"…","description":"…","category":"Women > …","brand":"…","condition":"New with tags","color":"…","size":"…","material":"…","tags":["…","…"]}',
].join('\n');

const MERCARI_PROMPT = (src: SourceListing) => [
  'You are creating a Mercari (US) listing for an American buyer.',
  '',
  'Style rules:',
  `- Title: max ${MERCARI_TITLE_MAX} chars. Descriptive, US English. Schema: "[Brand?] [Item] [Color] [Size] [Key Feature] NWT".`,
  '  Example: "Womens Summer Dress Black Size Small Polyester NWT"',
  '- Description: 2-4 short paragraphs, friendly US English. Include condition, fit, material, measurements (if known), shipping note. Mention "smoke-free home" — Mercari buyers care.',
  '- Category: pick from "Women > Dresses", "Women > Tops & Blouses", "Women > Pants & Jeans", "Women > Skirts", "Women > Coats & Jackets", "Women > Swim", "Women > Activewear".',
  '- Condition: "New with tags" (Mercari wording).',
  '- Tags: 5-10 keywords, US-style ("boho", "preppy", "summer", "vacation", "trendy").',
  '',
  'INPUT product:',
  `Original title: "${src.title}"`,
  `Original description: "${src.description?.slice(0, 500) ?? ''}"`,
  `Category hint: "${src.category ?? 'Women'}"`,
  `Color: ${src.color ?? '?'}, Size: ${src.size ?? '?'}, Material: ${src.material ?? '?'}`,
  `Price: $${src.priceEur ? (src.priceEur * 1.08).toFixed(2) : '?'}`,
  '',
  'OUTPUT as JSON (no markdown):',
  '{"title":"…","description":"…","category":"Women > …","brand":"…","condition":"New with tags","color":"…","size":"…","material":"…","tags":["…","…"]}',
].join('\n');

const WALLAPOP_PROMPT = (src: SourceListing) => [
  'Estás creando un anuncio en Wallapop España.',
  '',
  'Reglas de estilo:',
  `- Título: máximo ${WALLAPOP_TITLE_MAX} caracteres. Conciso, español. Ejemplo: "Vestido mujer rojo verano talla S nuevo".`,
  '- Descripción: 2-4 párrafos cortos. Casual, en español. Menciona material, talla, color, condición. Envío por Correos / SEUR a través de Wallapop posible.',
  '- Categoría: de esta lista: "Moda mujer > Vestidos", "Moda mujer > Camisetas y tops", "Moda mujer > Pantalones", "Moda mujer > Faldas", "Moda mujer > Abrigos y chaquetas", "Moda mujer > Baño", "Moda mujer > Deportiva".',
  '- Estado: "Nuevo con etiqueta" (Wallapop wording).',
  '- Tags: 5-10 palabras clave en español ("nuevo", "verano", "mujer", "moda", "tendencia").',
  '',
  'INPUT producto:',
  `Título original: "${src.title}"`,
  `Descripción original: "${src.description?.slice(0, 500) ?? ''}"`,
  `Categoría sugerida: "${src.category ?? 'Mujer'}"`,
  `Color: ${src.color ?? '?'}, Talla: ${src.size ?? '?'}, Material: ${src.material ?? '?'}`,
  `Precio: €${src.priceEur?.toFixed(2) ?? '?'}`,
  '',
  'OUTPUT como JSON (sin markdown):',
  '{"title":"…","description":"…","category":"Moda mujer > …","brand":"…","condition":"Nuevo con etiqueta","color":"…","size":"…","material":"…","tags":["…","…"]}',
].join('\n');

const ETSY_PROMPT = (src: SourceListing) => [
  'You are creating an Etsy listing for an international buyer (US/UK/EU).',
  '',
  'Style rules:',
  `- Title: max ${ETSY_TITLE_MAX} chars. SEO-optimized, Etsy keyword stuffing is normal here. Schema: "[Item] [Style] [Material] [Color] [Occasion] [Gift?]". Use vertical bars or commas to separate phrases.`,
  '  Example: "Womens Summer Dress | Boho Floral Sundress | Vacation Travel Dress | Beach Cover Up | Gift for Her"',
  '- Description: long-form (400-800 words). First paragraph hook (story-driven). Then bullet list: "✦ Material", "✦ Size", "✦ Care". Then occasion ideas ("perfect for weddings, beach days, brunch dates"). End with shop-policies note ("Free shipping over $35", "Ships within 1-2 business days").',
  '- Category: "Clothing > Womens > Dresses" or "Clothing > Womens > Tops" etc. Etsy uses Taxonomy IDs but a string path is fine for our pipeline.',
  '- Condition: "Brand new" (Etsy mostly handmade/vintage but new with tags is allowed).',
  '- Tags: EXACTLY 13 tags (Etsy maximum) — Etsy-SEO-style multi-word tags ("summer dress", "boho dress", "vacation outfit", "womens fashion", "gift for her", "beach dress", "festival outfit", "casual dress", "sundress", "floral dress", "trendy dress", "everyday wear", "comfortable dress").',
  '',
  'INPUT product:',
  `Original title: "${src.title}"`,
  `Original description: "${src.description?.slice(0, 500) ?? ''}"`,
  `Category hint: "${src.category ?? 'Clothing'}"`,
  `Color: ${src.color ?? '?'}, Size: ${src.size ?? '?'}, Material: ${src.material ?? '?'}`,
  `Price: $${src.priceEur ? (src.priceEur * 1.08).toFixed(2) : '?'}`,
  '',
  'OUTPUT as JSON (no markdown):',
  '{"title":"…","description":"…","category":"Clothing > Womens > …","brand":"…","condition":"Brand new","color":"…","size":"…","material":"…","tags":["…","…","…","…","…","…","…","…","…","…","…","…","…"]}',
].join('\n');

const GRAILED_PROMPT = (src: SourceListing) => [
  'You are creating a Grailed listing — Grailed is a designer / streetwear / archive resale platform for men (primarily).',
  '',
  'Style rules:',
  `- Title: max ${GRAILED_TITLE_MAX} chars. **Brand-first** schema (Grailed buyers search by brand). Pattern: "[Brand] [Item] [Subtype] [Color] [Era?] [Size]".`,
  '  Example: "Stussy Heavyweight Hoodie Black FW23 Size M"',
  '  Use "Vintage [Brand]" if archive/older.',
  '- Description: 2-4 paragraphs. Hype tone but factual. Mention: brand history reference if applicable, fit (tts, oversized, drop-shoulder), measurements (P2P chest, length, sleeve), material, condition (9/10, 10/10), flaws if any. End with "Open to offers" or "Firm on price".',
  '- Category: from "Tops > Hoodies", "Tops > T-Shirts", "Tops > Long Sleeve T-Shirts", "Bottoms > Jeans", "Bottoms > Sweatpants", "Outerwear > Light Jackets", "Outerwear > Heavy Coats", "Footwear > Hi-Top Sneakers", "Footwear > Low-Top Sneakers", "Accessories > Hats", "Accessories > Bags".',
  '- Condition: "New/Never Worn" (Grailed wording).',
  '- Brand: ALWAYS specify. If unbranded streetwear → "Vintage" or specific aesthetic ("Y2K", "Archive").',
  '- Tags: 4-8 designer/streetwear-relevant tags ("streetwear", "archive", "y2k", "vintage", "designer", "japanese", "techwear", "gorpcore").',
  '',
  'INPUT product:',
  `Original title: "${src.title}"`,
  `Original description: "${src.description?.slice(0, 500) ?? ''}"`,
  `Category hint: "${src.category ?? 'Streetwear'}"`,
  `Color: ${src.color ?? '?'}, Size: ${src.size ?? '?'}, Material: ${src.material ?? '?'}`,
  `Price: $${src.priceEur ? (src.priceEur * 1.08).toFixed(2) : '?'}`,
  '',
  'OUTPUT as JSON (no markdown):',
  '{"title":"…","description":"…","category":"Tops > …","brand":"…","condition":"New/Never Worn","color":"…","size":"…","material":"…","tags":["streetwear","y2k","…"]}',
].join('\n');

const VESTIAIRE_PROMPT = (src: SourceListing) => [
  'You are creating a Vestiaire Collective listing — Vestiaire is the global authenticated luxury resale platform.',
  '',
  'Style rules:',
  `- Title: max ${VESTIAIRE_TITLE_MAX} chars. **Formal, brand-first**. Pattern: "[Brand] [Item] in [Material] [Color]". No emojis, no slang.`,
  '  Example: "Acne Studios Wool Coat in Black"',
  '- Description: 2-3 formal paragraphs, English. Mention: brand reference, season/year if known, condition (Like New / Very Good / Good), material composition (e.g. "60% wool, 40% polyester"), measurements (cm, not inches), fit. Authentication note if relevant.',
  '- Category: from "Womens Clothing > Dresses", "Womens Clothing > Coats", "Womens Clothing > Tops", "Womens Clothing > Skirts", "Womens Clothing > Jackets", "Womens Bags > Handbags", "Womens Shoes > Heels", "Womens Shoes > Flats", "Mens Clothing > Coats", "Mens Clothing > Suits".',
  '- Condition: "Never worn, with tag" (Vestiaire wording for new with tags).',
  '- Brand: REQUIRED — Vestiaire is brand-driven. Use exact brand spelling (e.g. "Saint Laurent" not "YSL").',
  '- Tags: 4-6 brand/style-relevant tags (e.g. "minimalist", "tailoring", "winter", "office", "evening").',
  '',
  'INPUT product:',
  `Original title: "${src.title}"`,
  `Original description: "${src.description?.slice(0, 500) ?? ''}"`,
  `Category hint: "${src.category ?? 'Womens Clothing'}"`,
  `Color: ${src.color ?? '?'}, Size: ${src.size ?? '?'}, Material: ${src.material ?? '?'}`,
  `Price: €${src.priceEur?.toFixed(2) ?? '?'}`,
  '',
  'OUTPUT as JSON (no markdown):',
  '{"title":"…","description":"…","category":"Womens Clothing > …","brand":"…","condition":"Never worn, with tag","color":"…","size":"…","material":"…","tags":["minimalist","…"]}',
].join('\n');

const WHATNOT_PROMPT = (src: SourceListing) => [
  'You are creating a Whatnot listing — Whatnot is a US live-stream auction platform. Listings here surface during live shows and as "Buy It Now" item pages.',
  '',
  'Style rules:',
  `- Title: max ${WHATNOT_TITLE_MAX} chars. Hype, casual, US English. Pattern: "[Item] [Style] [Color] [Size] — [Hype Word]". Allow up to 2 emojis (🔥 ✨).`,
  '  Example: "Y2K Mini Dress Black Size S — Coquette Vibes 🔥"',
  '- Description: 2-3 short paragraphs. Hype tone. Mention "perfect for [season/event]". Include condition + size. If applicable: "Drops daily on my live!" / "Tap follow for restock alerts".',
  '- Category: from "Womenswear > Dresses", "Womenswear > Tops", "Womenswear > Bottoms", "Accessories > Bags", "Footwear > Sneakers".',
  '- Condition: "Brand new" (Whatnot uses casual wording).',
  '- Tags: 5-10 hype/aesthetic keywords ("y2k", "coquette", "streetwear", "trending", "fyp", "hauls", "drop", "live", "fashion").',
  '',
  'INPUT product:',
  `Original title: "${src.title}"`,
  `Original description: "${src.description?.slice(0, 500) ?? ''}"`,
  `Category hint: "${src.category ?? 'Womenswear'}"`,
  `Color: ${src.color ?? '?'}, Size: ${src.size ?? '?'}, Material: ${src.material ?? '?'}`,
  `Price: $${src.priceEur ? (src.priceEur * 1.08).toFixed(2) : '?'}`,
  '',
  'OUTPUT as JSON (no markdown):',
  '{"title":"…","description":"…","category":"Womenswear > …","brand":"…","condition":"Brand new","color":"…","size":"…","material":"…","tags":["y2k","coquette","…"]}',
].join('\n');

const FB_MARKETPLACE_PROMPT = (src: SourceListing) => [
  'Du erstellst ein Facebook Marketplace Inserat für eine lokale Verkäuferin in Deutschland.',
  '',
  'Style-Vorgaben:',
  `- Titel: maximal ${FB_MARKETPLACE_TITLE_MAX} Zeichen. Casual, deutsch, lokal. Stil: "Damen Kleid Sommer rot Größe S - neu mit Etikett".`,
  '- Beschreibung: 2-3 lockere Absätze. Lokaler/Privatverkauf-Ton ("Nur Abholung in Berlin Mitte oder Versand möglich"). Erwähne Material, Größe, Farbe, Zustand. Schluss: "Privatverkauf, keine Garantie oder Rücknahme".',
  '- Kategorie: "Kleidung & Accessoires > Damen" (FB Marketplace hat sehr breite Kategorien).',
  '- Zustand: "Neu" (FB Marketplace Wording: "Neu", "Wie neu", "Gut", "Akzeptabel", "Mit Mängeln").',
  '- Tags: 3-5 deutsche Keywords ("Sommer", "Casual", "Trendy"). FB ist weniger Tag-orientiert als andere Plattformen.',
  '',
  'INPUT-Produkt:',
  `Titel-Original: "${src.title}"`,
  `Beschreibung-Original: "${src.description?.slice(0, 500) ?? ''}"`,
  `Kategorie-Hint: "${src.category ?? 'Damen'}"`,
  `Farbe: ${src.color ?? '?'}, Größe: ${src.size ?? '?'}, Material: ${src.material ?? '?'}`,
  `Preis: €${src.priceEur?.toFixed(2) ?? '?'}`,
  '',
  'OUTPUT als JSON (kein Markdown):',
  '{"title":"…","description":"…","category":"Kleidung & Accessoires > Damen","brand":"…","condition":"Neu","color":"…","size":"…","material":"…","tags":["…","…"]}',
].join('\n');

const KA_PROMPT = (src: SourceListing) => [
  'Du erstellst ein Kleinanzeigen.de Inserat in Deutschland.',
  '',
  'Style-Vorgaben:',
  `- Titel: maximal ${KA_TITLE_MAX} Zeichen. Sachlich, deutsch. KEINE Emojis. Stil: "Damen Kleid Sommer rot Größe S, neu".`,
  '- Beschreibung: 3-5 Absätze, dann Bullet-Liste mit "•" für Eigenschaften (Material, Größe, Zustand, Farbe). Formal aber persönlich. Erwähne: "Versand per Hermes möglich (Käuferschutz)" und "Privatverkauf, keine Garantie oder Rücknahme".',
  '- Kategorie: aus dieser Liste: "Damenbekleidung > Kleider", "Damenbekleidung > Festliche Kleider", "Damenbekleidung > T-Shirts", "Damenbekleidung > Tops & T-Shirts", "Damenbekleidung > Blusen, Tuniken", "Damenbekleidung > Pullover & Strick", "Damenbekleidung > Jeans", "Damenbekleidung > Sonstige Hosen", "Damenbekleidung > Röcke", "Damenbekleidung > Sportbekleidung", "Damenbekleidung > Jacken & Mäntel", "Damenbekleidung > Bademode".',
  '- Zustand: "Neu" (Default).',
  '',
  'INPUT-Produkt:',
  `Titel-Original: "${src.title}"`,
  `Beschreibung-Original: "${src.description?.slice(0, 500) ?? ''}"`,
  `Kategorie-Hint: "${src.category ?? 'Damen'}"`,
  `Farbe: ${src.color ?? '?'}, Größe: ${src.size ?? '?'}, Material: ${src.material ?? '?'}`,
  `Preis: €${src.priceEur?.toFixed(2) ?? '?'}`,
  '',
  'OUTPUT als JSON (kein Markdown):',
  '{"title":"…","description":"…","category":"Damenbekleidung > …","brand":"…","condition":"Neu","color":"…","size":"…","material":"…","tags":["…","…"]}',
].join('\n');

interface SourceListing {
  title: string;
  description: string;
  category: string;
  brand?: string;
  size?: string;
  condition?: string;
  color?: string;
  material?: string;
  priceEur?: number;
}

async function callLLMForVariant(prompt: string): Promise<MarketplaceVariant | null> {
  const text = await callLLM({ user: prompt, maxTokens: 700 });
  return parseLLMJson<MarketplaceVariant>(text);
}

/** Build an exemplar block from past TOP-performing variants for one marketplace.
 *  Returned string is empty (cold start) when no variants have stats yet. */
function buildExemplarBlock(marketplace: SupportedMarketplace): string {
  let winners: VariantStats[] = [];
  try {
    winners = getTopVariants(marketplace, 5);
  } catch {
    // conversion_stats table may not exist on very old DBs.
    return '';
  }
  // Only include winners that actually performed — having 5 variants with
  // 0 sales and 0 messages is worse than no exemplars at all (model would
  // imitate the duds).
  const useful = winners.filter(
    v => (v.total_sales ?? 0) > 0 || (v.total_messages ?? 0) > 0,
  );
  if (useful.length === 0) return '';

  const blocks: string[] = [];
  for (let i = 0; i < useful.length; i++) {
    const w = useful[i]!;
    const content = readVariantContent(w.variant_id);
    if (!content) continue;
    const stats = [
      `listings ${w.listings_count}`,
      `sales ${w.total_sales}`,
      `messages ${w.total_messages}`,
      w.conversion_rate != null ? `conv ${(w.conversion_rate * 100).toFixed(1)}%` : null,
      w.message_rate != null ? `msgRate ${(w.message_rate * 100).toFixed(1)}%` : null,
    ].filter(Boolean).join(' · ');
    blocks.push([
      `[Top Variant #${i + 1}]`,
      `Title: ${content.title.slice(0, 120)}`,
      `Description: ${content.description.slice(0, 400)}`,
      content.tags_json ? `Tags: ${content.tags_json.slice(0, 200)}` : '',
      `Stats: ${stats}`,
    ].filter(Boolean).join('\n'));
  }
  if (blocks.length === 0) return '';

  return [
    `You are generating a listing variant for marketplace ${marketplace}.`,
    `Here are ${blocks.length} TOP-PERFORMING past variants (high message-rate + sales).`,
    `Study their style + structure, then create a NEW variant in the same successful pattern.`,
    `Do NOT copy them verbatim — write original content, but match tone, title structure, hashtag/tag style.`,
    '',
    blocks.join('\n\n'),
    '',
    '────────── New variant brief follows ──────────',
    '',
  ].join('\n');
}

/** Cap title at marketplace limit; trim word-aware so we don't cut mid-word. */
function capTitle(title: string, maxLen: number): string {
  if (title.length <= maxLen) return title;
  const cut = title.slice(0, maxLen).replace(/\s+\S*$/, '');
  return cut.length > 5 ? cut : title.slice(0, maxLen);
}

export type SupportedMarketplace =
  | 'vinted'
  | 'kleinanzeigen'
  | 'ebay_de'
  | 'ebay_uk'
  | 'depop'
  | 'mercari'
  | 'wallapop'
  | 'etsy'
  | 'grailed'
  | 'vestiaire'
  | 'whatnot'
  | 'fb_marketplace'
  | 'poshmark'
  | 'leboncoin'
  | 'marktplaats'
  | 'willhaben'
  | 'shopify'
  | 'woocommerce';

function defaultCondition(mp: SupportedMarketplace): string {
  switch (mp) {
    case 'vinted':         return 'Neu, mit Etikett';
    case 'ebay_de':        return 'Neu mit Etikett';
    case 'ebay_uk':        return 'New with tags';
    case 'depop':          return 'Brand new with tags';
    case 'mercari':        return 'New with tags';
    case 'wallapop':       return 'Nuevo con etiqueta';
    case 'etsy':           return 'Brand new';
    case 'grailed':        return 'New/Never Worn';
    case 'vestiaire':      return 'Never worn, with tag';
    case 'whatnot':        return 'Brand new';
    case 'fb_marketplace': return 'Neu';
    case 'kleinanzeigen':  return 'Neu';
    case 'poshmark':       return 'NWT';
    case 'leboncoin':      return 'Neuf avec étiquette';
    case 'marktplaats':    return 'Nieuw met etiket';
    case 'willhaben':      return 'Neu';
    case 'shopify':        return 'new';
    case 'woocommerce':    return 'new';
  }
}

function titleLimit(mp: SupportedMarketplace): number {
  switch (mp) {
    case 'vinted':         return VINTED_TITLE_MAX;
    case 'ebay_de':        return EBAY_TITLE_MAX;
    case 'ebay_uk':        return EBAY_TITLE_MAX;
    case 'depop':          return DEPOP_TITLE_MAX;
    case 'mercari':        return MERCARI_TITLE_MAX;
    case 'wallapop':       return WALLAPOP_TITLE_MAX;
    case 'etsy':           return ETSY_TITLE_MAX;
    case 'grailed':        return GRAILED_TITLE_MAX;
    case 'vestiaire':      return VESTIAIRE_TITLE_MAX;
    case 'whatnot':        return WHATNOT_TITLE_MAX;
    case 'fb_marketplace': return FB_MARKETPLACE_TITLE_MAX;
    case 'kleinanzeigen':  return KA_TITLE_MAX;
    case 'poshmark':       return POSHMARK_TITLE_MAX;
    case 'leboncoin':      return LEBONCOIN_TITLE_MAX;
    case 'marktplaats':    return MARKTPLAATS_TITLE_MAX;
    case 'willhaben':      return WILLHABEN_TITLE_MAX;
    case 'shopify':        return SHOPIFY_TITLE_MAX;
    case 'woocommerce':    return WOOCOMMERCE_TITLE_MAX;
  }
}

// Stub-prompts for the 6 newly-added marketplaces. They reuse the closest
// established template (English for poshmark/shopify/woo, French for
// leboncoin, Dutch for marktplaats, German for willhaben) and inherit the
// title-limit + condition from the per-mp constants above. Tonality can be
// fine-tuned per MP in a later pass.
const POSHMARK_PROMPT = MERCARI_PROMPT;
const LEBONCOIN_PROMPT = WALLAPOP_PROMPT;  // FR/ES romance-language style — close enough
const MARKTPLAATS_PROMPT = KA_PROMPT;       // NL classifieds — same buyer expectations
const WILLHABEN_PROMPT = KA_PROMPT;         // AT-German classifieds — same as KA
const SHOPIFY_PROMPT = EBAY_PROMPT;         // SEO-heavy long-form e-commerce
const WOOCOMMERCE_PROMPT = EBAY_PROMPT;     // SEO-heavy long-form e-commerce

function promptFor(mp: SupportedMarketplace, src: SourceListing): string {
  switch (mp) {
    case 'vinted':         return VINTED_PROMPT(src);
    case 'ebay_de':        return EBAY_PROMPT(src);
    case 'ebay_uk':        return EBAY_UK_PROMPT(src);
    case 'depop':          return DEPOP_PROMPT(src);
    case 'mercari':        return MERCARI_PROMPT(src);
    case 'wallapop':       return WALLAPOP_PROMPT(src);
    case 'etsy':           return ETSY_PROMPT(src);
    case 'grailed':        return GRAILED_PROMPT(src);
    case 'vestiaire':      return VESTIAIRE_PROMPT(src);
    case 'whatnot':        return WHATNOT_PROMPT(src);
    case 'fb_marketplace': return FB_MARKETPLACE_PROMPT(src);
    case 'kleinanzeigen':  return KA_PROMPT(src);
    case 'poshmark':       return POSHMARK_PROMPT(src);
    case 'leboncoin':      return LEBONCOIN_PROMPT(src);
    case 'marktplaats':    return MARKTPLAATS_PROMPT(src);
    case 'willhaben':      return WILLHABEN_PROMPT(src);
    case 'shopify':        return SHOPIFY_PROMPT(src);
    case 'woocommerce':    return WOOCOMMERCE_PROMPT(src);
  }
}

export async function generateVariantFor(autoListingId: number, marketplace: SupportedMarketplace): Promise<boolean> {
  const db = getDb();
  const src = db.prepare(`
    SELECT title, description, category, brand, size, condition, color, material,
           price_eur AS priceEur
      FROM auto_listings WHERE id = ?
  `).get(autoListingId) as SourceListing | undefined;
  if (!src) return false;

  const exemplars = buildExemplarBlock(marketplace);
  const finalPrompt = exemplars ? `${exemplars}${promptFor(marketplace, src)}` : promptFor(marketplace, src);
  const variant = await callLLMForVariant(finalPrompt);
  if (!variant || !variant.title || !variant.description) {
    log.warn('Variant generation produced empty result', { autoListingId, marketplace });
    // Persist a failure marker so the auto-publisher knows NOT to fall back
    // to the master row (which would publish a Vinted-styled listing to
    // e.g. eBay — off-brand). The publisher should retry generation or skip.
    const errMsg = !variant
      ? 'LLM returned null (parse failed or empty)'
      : 'LLM result missing title or description';
    db.prepare(`
      INSERT INTO auto_listing_variants (
        auto_listing_id, marketplace, title, description, category, subcategory,
        brand, size, condition, color, material, tags_json, status, last_error
      ) VALUES (?, ?, '', '', '', '', '', '', '', '', '', '[]', 'failed', ?)
      ON CONFLICT(auto_listing_id, marketplace) DO UPDATE SET
        status = 'failed',
        last_error = excluded.last_error,
        updated_at = datetime('now')
    `).run(autoListingId, marketplace, errMsg);
    try {
      recordWorkerEvent('variant-gen', 'warn', 'variant_unavailable', { autoListingId, marketplace, error: errMsg });
    } catch { /* telemetry best-effort */ }
    return false;
  }

  const finalTitle = capTitle(variant.title, titleLimit(marketplace));

  db.prepare(`
    INSERT INTO auto_listing_variants (
      auto_listing_id, marketplace, title, description, category, subcategory,
      brand, size, condition, color, material, tags_json, status, last_error
    ) VALUES (?, ?, ?, ?, ?, '', ?, ?, ?, ?, ?, ?, 'ok', NULL)
    ON CONFLICT(auto_listing_id, marketplace) DO UPDATE SET
      title = excluded.title,
      description = excluded.description,
      category = excluded.category,
      brand = excluded.brand,
      size = excluded.size,
      condition = excluded.condition,
      color = excluded.color,
      material = excluded.material,
      tags_json = excluded.tags_json,
      status = 'ok',
      last_error = NULL,
      updated_at = datetime('now')
  `).run(
    autoListingId, marketplace, finalTitle, variant.description,
    variant.category ?? src.category,
    variant.brand ?? src.brand ?? 'Ohne Marke',
    variant.size ?? src.size ?? 'S',
    variant.condition ?? defaultCondition(marketplace),
    variant.color ?? src.color ?? '',
    variant.material ?? src.material ?? '',
    JSON.stringify(variant.tags ?? []),
  );

  log.info('Variant stored', { autoListingId, marketplace, title: finalTitle.slice(0, 60) });
  return true;
}

/** Read a variant or fall back to the auto_listings master row.
 *
 * Important: when the per-marketplace variant explicitly failed
 * (`status='failed'`) we return `null` for non-Vinted marketplaces so the
 * auto-publisher won't push the Vinted-styled master to eBay/KA/Depop
 * (style mismatch = ban risk). Vinted is the only marketplace whose master
 * row IS the canonical content, so it's allowed to fall through.
 */
export function readVariant(autoListingId: number, marketplace: string): {
  title: string; description: string; category: string; brand: string;
  size: string; condition: string; color: string; material: string;
  tags: string[];
} | null {
  const db = getDb();
  const v = db.prepare(`
    SELECT title, description, category, brand, size, condition, color, material, tags_json, status
      FROM auto_listing_variants WHERE auto_listing_id = ? AND marketplace = ?
  `).get(autoListingId, marketplace) as Record<string, string> | undefined;
  if (v) {
    if (v.status === 'failed') {
      // Variant is a known-failed marker. Don't return a usable shape so
      // the publisher skips this marketplace entirely until variant-gen
      // produces a successful row.
      try {
        recordWorkerEvent('variant-gen', 'warn', 'variant_unavailable', { autoListingId, marketplace });
      } catch { /* best-effort */ }
      if (marketplace !== 'vinted') return null;
      // For vinted we fall through to the master row below.
    } else {
      return {
        title: v.title ?? '', description: v.description ?? '',
        category: v.category ?? '', brand: v.brand ?? 'Ohne Marke',
        size: v.size ?? 'S', condition: v.condition ?? 'Neu',
        color: v.color ?? '', material: v.material ?? '',
        tags: (() => { try { return JSON.parse(v.tags_json ?? '[]'); } catch { return []; } })(),
      };
    }
  }
  // No row at all: for non-Vinted marketplaces we refuse to publish with
  // the Vinted-styled master (off-brand). For vinted, the master IS the
  // canonical content so falling back is correct.
  if (marketplace !== 'vinted') {
    try {
      recordWorkerEvent('variant-gen', 'warn', 'variant_unavailable', { autoListingId, marketplace, reason: 'no_variant_row' });
    } catch { /* best-effort */ }
    return null;
  }
  // Fallback to master row (for Vinted, which is the "base" listing)
  const master = db.prepare(`
    SELECT title, description, category, brand, size, condition, color, material
      FROM auto_listings WHERE id = ?
  `).get(autoListingId) as Record<string, string> | undefined;
  if (!master) return null;
  return {
    title: master.title ?? '', description: master.description ?? '',
    category: master.category ?? '', brand: master.brand ?? 'Ohne Marke',
    size: master.size ?? 'S', condition: master.condition ?? 'Neu',
    color: master.color ?? '', material: master.material ?? '',
    tags: [],
  };
}

async function tickInner(): Promise<void> {
  const provider = getSetting('llm_provider') ?? 'gemini';
  const keyMissing = provider === 'gemini'
    ? !process.env.GEMINI_API_KEY
    : !process.env.ANTHROPIC_API_KEY;
  if (keyMissing) {
    log.debug(`No API key for ${provider} — variant generation off`);
    return;
  }
  const db = getDb();

  // Find auto_listings ready for variant generation:
  //   - has cj_variant_id (so it's a real product)
  //   - is status draft/approved/published (in flight or live)
  //   - missing the variant for at least one of the active marketplaces
  const targets: SupportedMarketplace[] = ['vinted'];
  if (getSetting('kleinanzeigen_enabled') === 'true')  targets.push('kleinanzeigen');
  if (getSetting('ebay_de_enabled') === 'true')        targets.push('ebay_de');
  if (getSetting('ebay_uk_enabled') === 'true')        targets.push('ebay_uk');
  if (getSetting('depop_enabled') === 'true')          targets.push('depop');
  if (getSetting('mercari_enabled') === 'true')        targets.push('mercari');
  if (getSetting('wallapop_enabled') === 'true')       targets.push('wallapop');
  if (getSetting('etsy_enabled') === 'true')           targets.push('etsy');
  if (getSetting('grailed_enabled') === 'true')        targets.push('grailed');
  if (getSetting('vestiaire_enabled') === 'true')      targets.push('vestiaire');
  if (getSetting('whatnot_enabled') === 'true')        targets.push('whatnot');
  if (getSetting('fb_marketplace_enabled') === 'true') targets.push('fb_marketplace');
  if (getSetting('poshmark_enabled') === 'true')       targets.push('poshmark');
  if (getSetting('leboncoin_enabled') === 'true')      targets.push('leboncoin');
  if (getSetting('marktplaats_enabled') === 'true')    targets.push('marktplaats');
  if (getSetting('willhaben_enabled') === 'true')      targets.push('willhaben');
  if (getSetting('shopify_enabled') === 'true')        targets.push('shopify');
  if (getSetting('woocommerce_enabled') === 'true')    targets.push('woocommerce');

  for (const mp of targets) {
    // Pick listings missing a usable variant: either no row at all, OR
    // a `status='failed'` row whose last attempt was >30 min ago (so we
    // don't hammer the LLM on the same broken row every cycle).
    const rows = db.prepare(`
      SELECT al.id
        FROM auto_listings al
       WHERE al.cj_variant_id IS NOT NULL
         AND al.status IN ('draft','approved','published')
         AND NOT EXISTS (
           SELECT 1 FROM auto_listing_variants v
            WHERE v.auto_listing_id = al.id
              AND v.marketplace = ?
              AND (v.status IS NULL OR v.status = 'ok'
                   OR (v.status = 'failed' AND v.updated_at > datetime('now', '-30 minutes')))
         )
       ORDER BY al.id ASC
       LIMIT ?
    `).all(mp, getMaxPerCycle()) as Array<{ id: number }>;

    if (rows.length === 0) continue;
    log.info(`Generating ${rows.length} ${mp} variants`);

    for (const r of rows) {
      try {
        await generateVariantFor(r.id, mp);
      } catch (err) {
        log.warn('Variant generation crashed', { id: r.id, mp, error: err instanceof Error ? err.message : String(err) });
      }
    }
  }
}

async function tick(): Promise<void> {
  if (isPaused()) return;
  await withLock('variant-generator-tick', 600, tickInner);
}

export function startVariantGenerator(): void {
  if (timer) return;
  log.info('Variant generator started', { intervalMs: INTERVAL_MS, maxPerCycle: getMaxPerCycle() });
  setTimeout(() => void tick(), 60_000);
  timer = setInterval(() => void tick(), INTERVAL_MS);
}

export function stopVariantGenerator(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
    log.info('Variant generator stopped');
  }
}

export const _internal = { tickInner, generateVariantFor, readVariant };
