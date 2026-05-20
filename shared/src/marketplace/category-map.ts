// ──────────────────────────────────────────────────────────────────────────────
// Universelle Vinted-Kategorie → Plattform-spezifische Kategorie
//
// Vinted ist der "Master" — neue Plattformen mappen einfach.
// Adapter rufen `mapCategory('kleinanzeigen', vintedCategory)` und kriegen
// die Plattform-Kategorie zurück (Pfad oder ID).
// ──────────────────────────────────────────────────────────────────────────────

import type { MarketplaceId } from './types.js';

export interface CategoryTarget {
  /** Sichtbarer Pfad / Label auf der Zielplattform. */
  path: string;
  /** Plattform-interne ID falls bekannt (für API-basierte Plattformen). */
  externalId?: string;
}

/** Vinted-Kategorie → Kleinanzeigen-Pfad. */
const VINTED_TO_KLEINANZEIGEN: Record<string, CategoryTarget> = {
  'Damen > Kleider > Minikleider':              { path: 'Damenbekleidung > Kleider' },
  'Damen > Kleider > Midikleider':              { path: 'Damenbekleidung > Kleider' },
  'Damen > Kleider > Maxikleider':              { path: 'Damenbekleidung > Kleider' },
  'Damen > Kleider > Sommerkleider':            { path: 'Damenbekleidung > Kleider' },
  'Damen > Kleider > Cocktailkleider':          { path: 'Damenbekleidung > Festliche Kleider' },
  'Damen > Kleider > Abendkleider':             { path: 'Damenbekleidung > Festliche Kleider' },
  'Damen > Kleider > Alltagskleider':           { path: 'Damenbekleidung > Kleider' },
  'Damen > Oberteile > T-Shirts':               { path: 'Damenbekleidung > T-Shirts' },
  'Damen > Oberteile > Crop Tops':              { path: 'Damenbekleidung > Tops & T-Shirts' },
  'Damen > Oberteile > Blusen':                 { path: 'Damenbekleidung > Blusen, Tuniken' },
  'Damen > Oberteile > Kapuzenpullover':        { path: 'Damenbekleidung > Pullover & Strick' },
  'Damen > Oberteile > Sweatshirts':            { path: 'Damenbekleidung > Pullover & Strick' },
  'Damen > Hosen > Jeans':                      { path: 'Damenbekleidung > Jeans' },
  'Damen > Hosen > Leggings':                   { path: 'Damenbekleidung > Sonstige Hosen' },
  'Damen > Hosen > Jogginghosen':               { path: 'Damenbekleidung > Sonstige Hosen' },
  'Damen > Röcke > Miniröcke':                  { path: 'Damenbekleidung > Röcke' },
  'Damen > Röcke > Midiröcke':                  { path: 'Damenbekleidung > Röcke' },
  'Damen > Sportkleidung > Sport-BHs':          { path: 'Damenbekleidung > Sportbekleidung' },
  'Damen > Sportkleidung > Leggings':           { path: 'Damenbekleidung > Sportbekleidung' },
  'Damen > Sportkleidung > Shorts':             { path: 'Damenbekleidung > Sportbekleidung' },
  'Damen > Sportkleidung > Tops':               { path: 'Damenbekleidung > Sportbekleidung' },
  'Damen > Jacken & Mäntel > Übergangsjacken':  { path: 'Damenbekleidung > Jacken & Mäntel' },
  'Damen > Bademode > Bikinis':                 { path: 'Damenbekleidung > Bademode' },
  'Damen > Bademode > Badeanzüge':              { path: 'Damenbekleidung > Bademode' },
};

/** Vinted → Mercari (englisch). */
const VINTED_TO_MERCARI: Record<string, CategoryTarget> = {
  'Damen > Kleider > Minikleider':       { path: 'Women > Dresses > Mini' },
  'Damen > Kleider > Midikleider':       { path: 'Women > Dresses > Midi' },
  'Damen > Kleider > Maxikleider':       { path: 'Women > Dresses > Maxi' },
  'Damen > Kleider > Sommerkleider':     { path: 'Women > Dresses > Casual' },
  'Damen > Kleider > Cocktailkleider':   { path: 'Women > Dresses > Cocktail' },
  'Damen > Kleider > Abendkleider':      { path: 'Women > Dresses > Evening' },
  'Damen > Kleider > Alltagskleider':    { path: 'Women > Dresses > Casual' },
  'Damen > Oberteile > T-Shirts':        { path: 'Women > Tops > T-Shirts' },
  'Damen > Oberteile > Crop Tops':       { path: 'Women > Tops > Crop Tops' },
  'Damen > Oberteile > Blusen':          { path: 'Women > Tops > Blouses' },
  'Damen > Oberteile > Kapuzenpullover': { path: 'Women > Tops > Hoodies' },
  'Damen > Oberteile > Sweatshirts':     { path: 'Women > Tops > Sweatshirts' },
  'Damen > Hosen > Jeans':               { path: 'Women > Pants > Jeans' },
  'Damen > Hosen > Leggings':            { path: 'Women > Pants > Leggings' },
  'Damen > Hosen > Jogginghosen':        { path: 'Women > Pants > Joggers' },
  'Damen > Röcke > Miniröcke':           { path: 'Women > Skirts > Mini' },
  'Damen > Röcke > Midiröcke':           { path: 'Women > Skirts > Midi' },
  'Damen > Sportkleidung > Sport-BHs':   { path: 'Women > Activewear > Sports Bras' },
  'Damen > Sportkleidung > Leggings':    { path: 'Women > Activewear > Leggings' },
  'Damen > Sportkleidung > Shorts':      { path: 'Women > Activewear > Shorts' },
  'Damen > Sportkleidung > Tops':        { path: 'Women > Activewear > Tops' },
  'Damen > Jacken & Mäntel > Übergangsjacken': { path: 'Women > Outerwear > Jackets' },
  'Damen > Bademode > Bikinis':          { path: 'Women > Swim > Bikinis' },
  'Damen > Bademode > Badeanzüge':       { path: 'Women > Swim > One-Piece' },
};

/** Vinted → Depop (en-GB, eher Tags/Stil). */
const VINTED_TO_DEPOP: Record<string, CategoryTarget> = {
  'Damen > Kleider > Minikleider':       { path: 'Womenswear > Dresses > Mini Dress' },
  'Damen > Kleider > Midikleider':       { path: 'Womenswear > Dresses > Midi Dress' },
  'Damen > Kleider > Maxikleider':       { path: 'Womenswear > Dresses > Maxi Dress' },
  'Damen > Oberteile > Crop Tops':       { path: 'Womenswear > Tops > Crop Top' },
  'Damen > Oberteile > T-Shirts':        { path: 'Womenswear > Tops > T-Shirt' },
  'Damen > Hosen > Jeans':               { path: 'Womenswear > Bottoms > Jeans' },
  'Damen > Röcke > Miniröcke':           { path: 'Womenswear > Bottoms > Mini Skirt' },
};

/** Vinted → Wallapop (es-ES). */
const VINTED_TO_WALLAPOP: Record<string, CategoryTarget> = {
  'Damen > Kleider > Minikleider':       { path: 'Moda y accesorios > Mujer > Vestidos' },
  'Damen > Kleider > Midikleider':       { path: 'Moda y accesorios > Mujer > Vestidos' },
  'Damen > Oberteile > T-Shirts':        { path: 'Moda y accesorios > Mujer > Camisetas' },
  'Damen > Hosen > Jeans':               { path: 'Moda y accesorios > Mujer > Pantalones' },
  'Damen > Röcke > Miniröcke':           { path: 'Moda y accesorios > Mujer > Faldas' },
};

const TABLES: Partial<Record<MarketplaceId, Record<string, CategoryTarget>>> = {
  vinted: {}, // identity
  kleinanzeigen: VINTED_TO_KLEINANZEIGEN,
  mercari: VINTED_TO_MERCARI,
  depop: VINTED_TO_DEPOP,
  wallapop: VINTED_TO_WALLAPOP,
};

/** Mappt Vinted-Kategorie → Zielplattform. Fallback = generischer Damenbekleidung-Pfad. */
export function mapCategory(target: MarketplaceId, vintedCategory: string): CategoryTarget {
  if (target === 'vinted') return { path: vintedCategory };
  const direct = TABLES[target]?.[vintedCategory];
  if (direct) return direct;
  // Fallback per Top-Level
  const fallback: Partial<Record<MarketplaceId, CategoryTarget>> = {
    vinted:        { path: 'Damen > Kleidung' },
    kleinanzeigen: { path: 'Damenbekleidung > Sonstige Damenbekleidung' },
    mercari:       { path: 'Women > Other' },
    depop:         { path: 'Womenswear > Other' },
    wallapop:      { path: 'Moda y accesorios > Mujer > Otros' },
  };
  return fallback[target] ?? { path: vintedCategory };
}

/** Größen-Mapping: Vinted "S" → Plattform. */
export function mapSize(target: MarketplaceId, vintedSize: string): string {
  // Vinted Größen: XXXS,XXS,XS,S,M,L,XL,XXL,XXXL,4XL,5XL
  if (target === 'mercari' || target === 'depop') return vintedSize; // identisch
  return vintedSize;
}

/** Versand: Vinted "Klein" → KA "Versand möglich" boolean / Mercari shipping-class etc. */
export function mapShipping(target: MarketplaceId, vintedShipping: string): {
  enabled: boolean;
  /** Optional: Plattform-spezifischer Service-Code */
  serviceCode?: string;
} {
  if (target === 'kleinanzeigen') {
    return { enabled: true, serviceCode: vintedShipping === 'Groß' ? 'paket' : 'kleinpaket' };
  }
  if (target === 'mercari') {
    return { enabled: true, serviceCode: 'standard' };
  }
  return { enabled: true };
}
