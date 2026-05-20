// ──────────────────────────────────────────────────────────────────────────────
// Crosslisting Template Engine
//
// Converts a product listing into marketplace-specific formatted text.
// Each marketplace has different conventions:
//   - eBay: formal, keyword-rich, structured specs
//   - Vinted: casual, emoji-friendly, short
//   - Depop: hashtag-heavy, Gen-Z tone
//   - Etsy: artisan-style, detailed measurements
//   etc.
//
// Inspired by Liberty-Emporium/list-it-everywhere export templates,
// ported to TypeScript and extended for our 10-marketplace system.
// ──────────────────────────────────────────────────────────────────────────────

import type { MarketplaceId } from '@vinted-system/shared';

export interface CrosslistingInput {
  title: string;
  description: string;
  brand: string;
  category: string;
  size: string;
  condition: string;
  colors: string[];
  material: string;
  price_eur: number;
  shipping: string;
  tags?: string;
  sku?: string;
}

export interface CrosslistingOutput {
  marketplace: MarketplaceId | string;
  title: string;
  description: string;
  tags: string[];
  priceLocal: number;
  currency: string;
}

// ── Currency Conversion (approximate static rates for price display) ─────────

const EUR_TO: Record<string, number> = {
  EUR: 1.0,
  GBP: 0.86,
  USD: 1.09,
  JPY: 163.0,
  CHF: 0.95,
};

function convertPrice(eur: number, currency: string): number {
  const rate = EUR_TO[currency] ?? 1.0;
  const raw = eur * rate;
  // Round to .99 pricing
  return Math.floor(raw) + 0.99;
}

// ── Tag Generator ────────────────────────────────────────────────────────────

function generateTags(input: CrosslistingInput): string[] {
  const words = new Set<string>();
  // Extract keywords from title
  input.title.split(/[\s,.-]+/).forEach((w) => {
    if (w.length > 2) words.add(w.toLowerCase());
  });
  // Add brand, category, colors
  if (input.brand && input.brand !== 'Ohne Marke') words.add(input.brand.toLowerCase());
  input.colors.forEach((c) => words.add(c.toLowerCase()));
  if (input.material) words.add(input.material.toLowerCase());
  // Add from tags string if provided
  if (input.tags) {
    input.tags.split(/[,;]+/).forEach((t) => {
      const trimmed = t.trim().toLowerCase();
      if (trimmed.length > 2) words.add(trimmed);
    });
  }
  return [...words].slice(0, 15);
}

// ── Template Functions ───────────────────────────────────────────────────────

function templateVinted(input: CrosslistingInput): CrosslistingOutput {
  const desc = [
    input.description,
    '',
    `Marke: ${input.brand || 'Ohne Marke'}`,
    `Größe: ${input.size || 'Siehe Beschreibung'}`,
    `Farbe: ${input.colors.join(', ') || 'Siehe Fotos'}`,
    `Zustand: ${input.condition}`,
  ].join('\n');

  return {
    marketplace: 'vinted',
    title: input.title.slice(0, 80),
    description: desc,
    tags: generateTags(input),
    priceLocal: input.price_eur,
    currency: 'EUR',
  };
}

function templateKleinanzeigen(input: CrosslistingInput): CrosslistingOutput {
  const desc = [
    input.title,
    '',
    input.description,
    '',
    `📦 Versand: ${input.shipping === 'Klein' ? 'DHL Päckchen S' : input.shipping === 'Mittel' ? 'DHL Paket M' : 'DHL Paket L'}`,
    `🏷️ Marke: ${input.brand || 'No Name'}`,
    `📏 Größe: ${input.size || 'Universalgröße'}`,
    `🎨 Farbe: ${input.colors.join(', ') || 'Siehe Bilder'}`,
    `✨ Zustand: ${input.condition}`,
    '',
    'Keine Rücknahme, da Privatverkauf.',
  ].join('\n');

  return {
    marketplace: 'kleinanzeigen',
    title: input.title.slice(0, 65),
    description: desc,
    tags: generateTags(input),
    priceLocal: input.price_eur,
    currency: 'EUR',
  };
}

function templateEbayDe(input: CrosslistingInput): CrosslistingOutput {
  const desc = [
    `<h2>${input.title}</h2>`,
    '',
    `<p>${input.description}</p>`,
    '',
    '<h3>Artikelmerkmale</h3>',
    '<ul>',
    `  <li><strong>Marke:</strong> ${input.brand || 'Markenlos'}</li>`,
    `  <li><strong>Größe:</strong> ${input.size || 'Siehe Beschreibung'}</li>`,
    `  <li><strong>Farbe:</strong> ${input.colors.join(', ') || 'Mehrfarbig'}</li>`,
    `  <li><strong>Material:</strong> ${input.material || 'Keine Angabe'}</li>`,
    `  <li><strong>Zustand:</strong> ${input.condition}</li>`,
    '</ul>',
    '',
    '<p><em>Privatverkauf — keine Garantie, kein Umtausch, keine Rücknahme.</em></p>',
  ].join('\n');

  return {
    marketplace: 'ebay_de',
    title: input.title.slice(0, 80),
    description: desc,
    tags: generateTags(input),
    priceLocal: input.price_eur,
    currency: 'EUR',
  };
}

function templateEbayUk(input: CrosslistingInput): CrosslistingOutput {
  const desc = [
    `Title: ${input.title}`,
    `Condition: ${input.condition}`,
    `Brand: ${input.brand || 'Unbranded'}`,
    `Category: ${input.category || 'Other'}`,
    `Size: ${input.size || 'See description'}`,
    `Colour: ${input.colors.join(', ') || 'See photos'}`,
    `Material: ${input.material || 'Not specified'}`,
    '',
    'Description:',
    input.description,
    '',
    `Keywords: ${generateTags(input).join(', ')}`,
  ].join('\n');

  return {
    marketplace: 'ebay_uk',
    title: input.title.slice(0, 80),
    description: desc,
    tags: generateTags(input),
    priceLocal: convertPrice(input.price_eur, 'GBP'),
    currency: 'GBP',
  };
}

function templateDepop(input: CrosslistingInput): CrosslistingOutput {
  const tags = generateTags(input);
  const hashtags = tags.slice(0, 5).map((t) => `#${t.replace(/\s+/g, '')}`).join(' ');

  const desc = [
    input.title,
    '',
    input.description,
    '',
    `Size: ${input.size || 'See description'}`,
    `Colour: ${input.colors.join(', ') || 'See photos'}`,
    `Condition: ${input.condition}`,
    `Brand: ${input.brand || 'Other'}`,
    '',
    hashtags,
  ].join('\n');

  return {
    marketplace: 'depop',
    title: input.title.slice(0, 80),
    description: desc,
    tags,
    priceLocal: convertPrice(input.price_eur, 'GBP'),
    currency: 'GBP',
  };
}

function templateMercari(input: CrosslistingInput): CrosslistingOutput {
  const desc = [
    input.title,
    '',
    input.description,
    '',
    `Condition: ${input.condition}`,
    `Brand: ${input.brand || 'No brand'}`,
    `Size: ${input.size || 'N/A'}`,
    `Color: ${input.colors.join(', ') || 'See photos'}`,
    `Material: ${input.material || 'Not specified'}`,
  ].join('\n');

  return {
    marketplace: 'mercari',
    title: input.title.slice(0, 80),
    description: desc,
    tags: generateTags(input),
    priceLocal: convertPrice(input.price_eur, 'USD'),
    currency: 'USD',
  };
}

function templateWallapop(input: CrosslistingInput): CrosslistingOutput {
  const desc = [
    input.description,
    '',
    `Marca: ${input.brand || 'Sin marca'}`,
    `Talla: ${input.size || 'Ver descripción'}`,
    `Color: ${input.colors.join(', ') || 'Ver fotos'}`,
    `Estado: ${input.condition}`,
    `Material: ${input.material || 'No especificado'}`,
  ].join('\n');

  return {
    marketplace: 'wallapop',
    title: input.title.slice(0, 80),
    description: desc,
    tags: generateTags(input),
    priceLocal: input.price_eur,
    currency: 'EUR',
  };
}

function templateEtsy(input: CrosslistingInput): CrosslistingOutput {
  const desc = [
    `✨ ${input.title} ✨`,
    '',
    input.description,
    '',
    'Details:',
    `• Condition: ${input.condition}`,
    `• Brand: ${input.brand || 'Handmade/Other'}`,
    `• Size: ${input.size || 'See description'}`,
    `• Color: ${input.colors.join(', ') || 'See photos'}`,
    `• Material: ${input.material || 'See description'}`,
    '',
    `Tags: ${generateTags(input).join(', ')}`,
  ].join('\n');

  return {
    marketplace: 'etsy',
    title: input.title.slice(0, 140),
    description: desc,
    tags: generateTags(input).slice(0, 13), // Etsy max 13 tags
    priceLocal: convertPrice(input.price_eur, 'USD'),
    currency: 'USD',
  };
}

function templateGrailed(input: CrosslistingInput): CrosslistingOutput {
  const desc = [
    input.description,
    '',
    `Size: ${input.size || 'See description'}`,
    `Color: ${input.colors.join(', ') || 'See photo'}`,
    `Condition: ${input.condition}`,
    `Brand: ${input.brand || 'Other'}`,
    `Material: ${input.material || 'Not specified'}`,
    '',
    `Tags: ${generateTags(input).join(', ')}`,
  ].join('\n');

  return {
    marketplace: 'grailed',
    title: input.title.slice(0, 80),
    description: desc,
    tags: generateTags(input),
    priceLocal: convertPrice(input.price_eur, 'USD'),
    currency: 'USD',
  };
}

function templateFbMarketplace(input: CrosslistingInput): CrosslistingOutput {
  const desc = [
    `${input.title} — €${input.price_eur}`,
    '',
    input.description,
    '',
    `Zustand: ${input.condition}`,
    `Marke: ${input.brand || 'Keine Angabe'}`,
    `Größe: ${input.size || 'Keine Angabe'}`,
    `Farbe: ${input.colors.join(', ') || 'Siehe Fotos'}`,
  ].join('\n');

  return {
    marketplace: 'fb_marketplace',
    title: input.title.slice(0, 99),
    description: desc,
    tags: generateTags(input),
    priceLocal: input.price_eur,
    currency: 'EUR',
  };
}

// ── Poshmark ─────────────────────────────────────────────────────────────────

function templatePoshmark(input: CrosslistingInput): CrosslistingOutput {
  const desc = [input.description, '', `Size: ${input.size || 'See description'}`, `Brand: ${input.brand || 'Other'}`,
    `Color: ${input.colors.join(', ') || 'See photos'}`, `Condition: ${input.condition}`, `Material: ${input.material || 'N/A'}`].join('\n');
  return { marketplace: 'poshmark', title: input.title.slice(0, 80), description: desc, tags: generateTags(input), priceLocal: convertPrice(input.price_eur, 'USD'), currency: 'USD' };
}

// ── Vestiaire Collective ─────────────────────────────────────────────────────

function templateVestiaire(input: CrosslistingInput): CrosslistingOutput {
  const desc = [input.description, '', `Designer: ${input.brand || 'Unknown'}`, `Size: ${input.size || 'See description'}`,
    `Colour: ${input.colors.join(', ') || 'See photos'}`, `Condition: ${input.condition}`, `Material: ${input.material || 'See listing'}`].join('\n');
  return { marketplace: 'vestiaire', title: input.title.slice(0, 80), description: desc, tags: generateTags(input), priceLocal: input.price_eur, currency: 'EUR' };
}

// ── Whatnot ──────────────────────────────────────────────────────────────────

function templateWhatnot(input: CrosslistingInput): CrosslistingOutput {
  const desc = [`🔥 ${input.title}`, '', input.description, '', `Brand: ${input.brand || 'N/A'}`, `Size: ${input.size || 'OS'}`, `Condition: ${input.condition}`].join('\n');
  return { marketplace: 'whatnot', title: input.title.slice(0, 80), description: desc, tags: generateTags(input), priceLocal: convertPrice(input.price_eur, 'USD'), currency: 'USD' };
}

// ── Shopify / WooCommerce ────────────────────────────────────────────────────

function templateShopify(input: CrosslistingInput): CrosslistingOutput {
  const desc = [`<h2>${input.title}</h2>`, `<p>${input.description}</p>`, '<ul>',
    `<li><b>Brand:</b> ${input.brand || 'N/A'}</li>`, `<li><b>Size:</b> ${input.size || 'See description'}</li>`,
    `<li><b>Color:</b> ${input.colors.join(', ') || 'See photos'}</li>`, `<li><b>Condition:</b> ${input.condition}</li>`, '</ul>'].join('\n');
  return { marketplace: 'shopify', title: input.title.slice(0, 255), description: desc, tags: generateTags(input), priceLocal: input.price_eur, currency: 'EUR' };
}

function templateWooCommerce(input: CrosslistingInput): CrosslistingOutput {
  return { ...templateShopify(input), marketplace: 'woocommerce' };
}

// ── EU Champions ─────────────────────────────────────────────────────────────

function templateLeboncoin(input: CrosslistingInput): CrosslistingOutput {
  const desc = [input.description, '', `Marque: ${input.brand || 'Sans marque'}`, `Taille: ${input.size || 'Voir description'}`,
    `Couleur: ${input.colors.join(', ') || 'Voir photos'}`, `État: ${input.condition}`].join('\n');
  return { marketplace: 'leboncoin', title: input.title.slice(0, 80), description: desc, tags: generateTags(input), priceLocal: input.price_eur, currency: 'EUR' };
}

function templateMarktplaats(input: CrosslistingInput): CrosslistingOutput {
  const desc = [input.description, '', `Merk: ${input.brand || 'Geen merk'}`, `Maat: ${input.size || 'Zie beschrijving'}`,
    `Kleur: ${input.colors.join(', ') || 'Zie foto\u0027s'}`, `Staat: ${input.condition}`].join('\n');
  return { marketplace: 'marktplaats', title: input.title.slice(0, 80), description: desc, tags: generateTags(input), priceLocal: input.price_eur, currency: 'EUR' };
}

function templateWillhaben(input: CrosslistingInput): CrosslistingOutput {
  const desc = [input.description, '', `Marke: ${input.brand || 'Keine Angabe'}`, `Größe: ${input.size || 'Siehe Beschreibung'}`,
    `Farbe: ${input.colors.join(', ') || 'Siehe Fotos'}`, `Zustand: ${input.condition}`, '', 'Privatverkauf – keine Garantie.'].join('\n');
  return { marketplace: 'willhaben', title: input.title.slice(0, 80), description: desc, tags: generateTags(input), priceLocal: input.price_eur, currency: 'EUR' };
}

function templateSubito(input: CrosslistingInput): CrosslistingOutput {
  const desc = [input.description, '', `Marca: ${input.brand || 'Senza marca'}`, `Taglia: ${input.size || 'Vedi descrizione'}`,
    `Colore: ${input.colors.join(', ') || 'Vedi foto'}`, `Condizione: ${input.condition}`].join('\n');
  return { marketplace: 'subito', title: input.title.slice(0, 80), description: desc, tags: generateTags(input), priceLocal: input.price_eur, currency: 'EUR' };
}

function templateRicardo(input: CrosslistingInput): CrosslistingOutput {
  const desc = [input.description, '', `Marke: ${input.brand || 'Ohne Marke'}`, `Grösse: ${input.size || 'Siehe Beschreibung'}`,
    `Farbe: ${input.colors.join(', ') || 'Siehe Fotos'}`, `Zustand: ${input.condition}`].join('\n');
  return { marketplace: 'ricardo', title: input.title.slice(0, 80), description: desc, tags: generateTags(input), priceLocal: convertPrice(input.price_eur, 'CHF'), currency: 'CHF' };
}

// ── Public API ───────────────────────────────────────────────────────────────

const TEMPLATE_MAP: Record<string, (input: CrosslistingInput) => CrosslistingOutput> = {
  vinted: templateVinted,
  kleinanzeigen: templateKleinanzeigen,
  ebay_de: templateEbayDe,
  ebay_uk: templateEbayUk,
  depop: templateDepop,
  mercari: templateMercari,
  wallapop: templateWallapop,
  etsy: templateEtsy,
  grailed: templateGrailed,
  fb_marketplace: templateFbMarketplace,
  // ── New Tier 1 + Enterprise ──────────
  poshmark: templatePoshmark,
  vestiaire: templateVestiaire,
  whatnot: templateWhatnot,
  shopify: templateShopify,
  woocommerce: templateWooCommerce,
  // ── EU Champions ─────────────────────
  leboncoin: templateLeboncoin,
  marktplaats: templateMarktplaats,
  willhaben: templateWillhaben,
  subito: templateSubito,
  ricardo: templateRicardo,
};

/**
 * Generate a crosslisting for a specific marketplace.
 */
export function generateCrosslisting(
  marketplace: MarketplaceId | string,
  input: CrosslistingInput,
): CrosslistingOutput {
  const fn = TEMPLATE_MAP[marketplace];
  if (!fn) {
    // Fallback: generic template
    return {
      marketplace,
      title: input.title.slice(0, 80),
      description: `${input.title}\n\n${input.description}\n\nBrand: ${input.brand}\nSize: ${input.size}\nCondition: ${input.condition}`,
      tags: generateTags(input),
      priceLocal: input.price_eur,
      currency: 'EUR',
    };
  }
  return fn(input);
}

/**
 * Generate crosslistings for ALL marketplaces at once.
 */
export function generateAllCrosslistings(
  input: CrosslistingInput,
): Record<string, CrosslistingOutput> {
  const results: Record<string, CrosslistingOutput> = {};
  for (const mp of Object.keys(TEMPLATE_MAP)) {
    results[mp] = generateCrosslisting(mp, input);
  }
  return results;
}

/**
 * Get list of supported marketplace IDs.
 */
export function supportedMarketplaces(): string[] {
  return Object.keys(TEMPLATE_MAP);
}
