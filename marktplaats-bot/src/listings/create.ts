// ──────────────────────────────────────────────────────────────────────────────
// Marktplaats Listing-Create Flow
//
// Marktplaats (US) — englischer Markt. Wir mappen ListingDraft → Marktplaats-Form:
//   - title (max 80 chars)
//   - description (max 1000 chars)
//   - photos (mind. 1, max 12)
//   - category (3-level)
//   - brand (auto-complete dropdown)
//   - condition (5 levels)
//   - size (US sizing)
//   - color
//   - price (USD = EUR × USD_RATE)
//   - shipping (STANDARD)
// ──────────────────────────────────────────────────────────────────────────────

import type { Page } from 'playwright';
import {
  createLogger,
  retry,
  mapCategory,
  type ListingDraft,
  type PublishResult,
} from '@vinted-system/shared';
import {
  SEL_SELL_BTN,
  SEL_PHOTO_INPUT,
  SEL_PHOTO_THUMB,
  SEL_TITLE,
  SEL_DESCRIPTION,
  SEL_PRICE,
  SEL_CATEGORY_TRIGGER,
  SEL_CATEGORY_SEARCH,
  SEL_BRAND_INPUT,
  SEL_BRAND_OPTION,
  SEL_SIZE_TRIGGER,
  SEL_CONDITION_TRIGGER,
  SEL_COLOR_TRIGGER,
  SEL_OPTION_BY_TEXT,
  SEL_SHIPPING_TYPE_STANDARD,
  SEL_PUBLISH,
  SEL_PUBLISHED_CONFIRM,
  SEL_CAPTCHA,
} from '../selectors.js';

const log = createLogger('marktplaats-listing-create');

const HOME_URL = 'https://www.marktplaats.com';
const SELL_URL = 'https://www.marktplaats.com/sell/';
const USD_RATE = Number(process.env.EUR_USD_RATE ?? 1.07); // konservativ

// ── Mappings ─────────────────────────────────────────────────────────────────

function buildTitle(draft: ListingDraft): string {
  // Marktplaats titles bevorzugen "Brand + Item Type + Color + Size".
  const brand = draft.brand && draft.brand !== 'Ohne Marke' ? draft.brand + ' ' : '';
  const color = (draft.colors[0] ?? '').replace(/^Mehrfarbig$/, 'Multicolor');
  // Wenn der Vinted-Titel bereits englisch wirkt, nehmen
  if (/^[a-z0-9 ,'\-&]+$/i.test(draft.title) && draft.title.length <= 80) {
    return draft.title;
  }
  // sonst aus Komponenten bauen
  const productType = (draft.category.split('>').pop() ?? 'Item').trim();
  const productEn = translateCategory(productType);
  const parts = [brand, color, productEn, `Size ${draft.size}`].filter(Boolean);
  return parts.join(' ').trim().slice(0, 80);
}

function translateCategory(german: string): string {
  const map: Record<string, string> = {
    'Minikleider': 'Mini Dress',
    'Midikleider': 'Midi Dress',
    'Maxikleider': 'Maxi Dress',
    'Sommerkleider': 'Summer Dress',
    'Cocktailkleider': 'Cocktail Dress',
    'Abendkleider': 'Evening Dress',
    'Alltagskleider': 'Casual Dress',
    'T-Shirts': 'T-Shirt',
    'Crop Tops': 'Crop Top',
    'Blusen': 'Blouse',
    'Kapuzenpullover': 'Hoodie',
    'Sweatshirts': 'Sweatshirt',
    'Jeans': 'Jeans',
    'Leggings': 'Leggings',
    'Jogginghosen': 'Joggers',
    'Miniröcke': 'Mini Skirt',
    'Midiröcke': 'Midi Skirt',
    'Sport-BHs': 'Sports Bra',
    'Shorts': 'Shorts',
    'Tops': 'Top',
    'Übergangsjacken': 'Light Jacket',
    'Bikinis': 'Bikini',
    'Badeanzüge': 'Swimsuit',
  };
  return map[german] ?? german;
}

function translateCondition(de: string): string {
  // Marktplaats: New | Like new | Good | Fair | Poor
  const map: Record<string, string> = {
    'Neu, mit Etikett': 'New',
    'Neu': 'New',
    'Sehr gut': 'Like new',
    'Gut': 'Good',
    'Befriedigend': 'Fair',
  };
  return map[de] ?? 'Good';
}

function translateColor(de: string): string {
  const map: Record<string, string> = {
    'Schwarz': 'Black', 'Weiß': 'White', 'Beige': 'Beige', 'Grau': 'Gray',
    'Braun': 'Brown', 'Rot': 'Red', 'Orange': 'Orange', 'Gelb': 'Yellow',
    'Grün': 'Green', 'Blau': 'Blue', 'Lila': 'Purple', 'Rosa': 'Pink',
    'Türkis': 'Turquoise', 'Gold': 'Gold', 'Silber': 'Silver',
    'Weinrot': 'Burgundy', 'Khaki': 'Khaki', 'Creme': 'Cream',
    'Bordeaux': 'Burgundy', 'Mint': 'Mint', 'Koralle': 'Coral',
    'Mehrfarbig': 'Multicolor',
  };
  return map[de] ?? de;
}

function buildDescription(draft: ListingDraft): string {
  // Translate German description heuristisch — wir behalten die Original-Form,
  // ergänzen aber englische Spec-Zeilen damit Marktplaats-Suche es findet.
  const lines: string[] = [];
  lines.push(draft.description);
  lines.push('');
  lines.push(`Size: ${draft.size}`);
  if (draft.colors.length > 0) lines.push(`Color: ${draft.colors.map(translateColor).join(', ')}`);
  if (draft.material) lines.push(`Material: ${translateMaterial(draft.material)}`);
  if (draft.brand && draft.brand !== 'Ohne Marke') lines.push(`Brand: ${draft.brand}`);
  lines.push('');
  lines.push('Smoke-free, pet-free home. Ships fast!');
  return lines.join('\n').slice(0, 1000);
}

function translateMaterial(de: string): string {
  const map: Record<string, string> = {
    'Polyester': 'Polyester', 'Baumwolle': 'Cotton', 'Elasthan': 'Elastane',
    'Viskose': 'Viscose', 'Nylon': 'Nylon', 'Leinen': 'Linen', 'Seide': 'Silk',
    'Satin': 'Satin', 'Spitze': 'Lace', 'Denim': 'Denim', 'Wolle': 'Wool',
    'Kunstleder': 'Faux Leather', 'Samt': 'Velvet', 'Chiffon': 'Chiffon',
    'Jersey': 'Jersey', 'Tüll': 'Tulle', 'Mesh': 'Mesh', 'Acryl': 'Acrylic',
  };
  return map[de] ?? 'Other';
}

function eurToUsd(eur: number): number {
  return Math.round(eur * USD_RATE * 100) / 100;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

async function pickFromDrawer(page: Page, label: string): Promise<boolean> {
  try {
    const sel = SEL_OPTION_BY_TEXT(label);
    await sel.click(page);
    return true;
  } catch (err) {
    log.warn('option not found', { label, err: err instanceof Error ? err.message : String(err) });
    return false;
  }
}

async function pickCategory(page: Page, vintedCat: string, warnings: string[]): Promise<void> {
  const target = mapCategory('marktplaats', vintedCat);
  const parts = target.path.split('>').map((s) => s.trim()).filter(Boolean);
  try {
    await SEL_CATEGORY_TRIGGER.click(page);
    await page.waitForTimeout(500);
    // Versuche jeden Level zu clicken.
    for (const part of parts) {
      const ok = await pickFromDrawer(page, part);
      if (!ok) {
        warnings.push(`category-level not found: ${part}`);
        // Fallback: in Suchfeld eintippen
        try {
          await SEL_CATEGORY_SEARCH.fill(page, part);
          await page.waitForTimeout(400);
          await pickFromDrawer(page, part);
        } catch { /* ignore */ }
        break;
      }
      await page.waitForTimeout(300);
    }
  } catch (err) {
    warnings.push(`category trigger failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function pickBrand(page: Page, brand: string, warnings: string[]): Promise<void> {
  if (!brand || brand === 'Ohne Marke' || brand === 'No Brand') return;
  try {
    await SEL_BRAND_INPUT.fill(page, brand);
    await page.waitForTimeout(600);
    try {
      await SEL_BRAND_OPTION.click(page);
    } catch {
      warnings.push(`brand auto-complete: no option for "${brand}"`);
    }
  } catch (err) {
    warnings.push(`brand input: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function pickFromTriggerDrawer(
  page: Page,
  trigger: typeof SEL_SIZE_TRIGGER,
  optionLabel: string,
  warnings: string[],
  fieldName: string,
): Promise<void> {
  try {
    await trigger.click(page);
    await page.waitForTimeout(400);
    const ok = await pickFromDrawer(page, optionLabel);
    if (!ok) warnings.push(`${fieldName}: no option for "${optionLabel}"`);
  } catch (err) {
    warnings.push(`${fieldName} trigger: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────

export async function createMarktplaatsListing(
  page: Page,
  draft: ListingDraft,
): Promise<PublishResult> {
  const warnings: string[] = [];
  const usdPrice = eurToUsd(draft.priceEur);

  try {
    // 1. Auf Sell-Page navigieren
    await retry(async () => {
      await page.goto(SELL_URL, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      if (await SEL_CAPTCHA.exists(page)) throw new Error('captcha');
    }, { attempts: 2, label: 'goto-sell', abortIf: (e) => /captcha/.test(String(e)) });

    if (await SEL_CAPTCHA.exists(page)) {
      return { ok: false, error: 'captcha challenge', blockedBy: 'captcha' };
    }

    // Falls Sell-Button auf Homepage statt direkter URL
    if (page.url() === HOME_URL || page.url().endsWith('marktplaats.com/')) {
      try { await SEL_SELL_BTN.click(page); } catch { /* schon auf sell */ }
    }

    // 2. Photos hochladen
    if (draft.photos.length === 0) return { ok: false, error: 'no photos' };
    const photoInput = await SEL_PHOTO_INPUT.resolve(page);
    await photoInput.setInputFiles(draft.photos.slice(0, 12));
    // Warten bis Thumbs erscheinen
    try { await SEL_PHOTO_THUMB.waitFor(page, { timeout: 15_000 }); } catch { warnings.push('photo-thumb timeout'); }

    // 3. Title
    await retry(() => SEL_TITLE.fill(page, buildTitle(draft)), { attempts: 2, label: 'title' });

    // 4. Description
    await retry(() => SEL_DESCRIPTION.fill(page, buildDescription(draft)), { attempts: 2, label: 'description' });

    // 5. Category
    await pickCategory(page, draft.category, warnings);

    // 6. Brand
    await pickBrand(page, draft.brand, warnings);

    // 7. Size
    await pickFromTriggerDrawer(page, SEL_SIZE_TRIGGER, draft.size, warnings, 'size');

    // 8. Condition
    await pickFromTriggerDrawer(page, SEL_CONDITION_TRIGGER, translateCondition(draft.condition), warnings, 'condition');

    // 9. Color
    if (draft.colors.length > 0) {
      await pickFromTriggerDrawer(page, SEL_COLOR_TRIGGER, translateColor(draft.colors[0]!), warnings, 'color');
    }

    // 10. Shipping
    try { await SEL_SHIPPING_TYPE_STANDARD.click(page); }
    catch (err) { warnings.push(`shipping: ${err instanceof Error ? err.message : String(err)}`); }

    // 11. Price (USD)
    await retry(() => SEL_PRICE.fill(page, usdPrice.toFixed(2)), { attempts: 2, label: 'price' });

    // 12. Submit
    await retry(() => SEL_PUBLISH.click(page), { attempts: 2, label: 'publish' });
    await page.waitForLoadState('domcontentloaded', { timeout: 30_000 });

    // 13. Confirm + URL
    let externalUrl: string | undefined;
    let externalId: string | undefined;
    try {
      await SEL_PUBLISHED_CONFIRM.waitFor(page, { timeout: 15_000 });
      externalUrl = page.url();
      const m = externalUrl.match(/\/item\/([a-zA-Z0-9_-]+)/);
      if (m) externalId = m[1];
    } catch {
      warnings.push('confirmation not detected — verify manually');
    }

    return {
      ok: !!externalUrl,
      externalId,
      externalUrl,
      warnings: warnings.length > 0 ? warnings : undefined,
    };
  } catch (err) {
    if (err instanceof Error && err.name === 'SelectorDriftError') {
      return { ok: false, error: err.message, blockedBy: 'selector-drift', warnings };
    }
    return { ok: false, error: err instanceof Error ? err.message : String(err), warnings };
  }
}
