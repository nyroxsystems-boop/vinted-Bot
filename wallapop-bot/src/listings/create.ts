// ──────────────────────────────────────────────────────────────────────────────
// Wallapop Listing-Create
//
// Spanischer Markt — DE→ES Übersetzung. Preis bleibt EUR.
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
  SEL_PHOTO_INPUT,
  SEL_PHOTO_THUMB,
  SEL_TITLE,
  SEL_DESCRIPTION,
  SEL_PRICE,
  SEL_CATEGORY_DROPDOWN,
  SEL_SUBCATEGORY_DROPDOWN,
  SEL_BRAND_INPUT,
  SEL_SIZE_DROPDOWN,
  SEL_CONDITION_DROPDOWN,
  SEL_COLOR_DROPDOWN,
  SEL_OPTION_BY_TEXT,
  SEL_SHIPPING_TOGGLE,
  SEL_PUBLISH,
  SEL_PUBLISHED_CONFIRM,
  SEL_CAPTCHA,
  SEL_BLOCKED,
} from '../selectors.js';

const log = createLogger('wp-listing-create');

const SELL_URL = 'https://es.wallapop.com/app/upload';

// ── DE → ES Translations ─────────────────────────────────────────────────────

function translateColor(de: string): string {
  const map: Record<string, string> = {
    'Schwarz': 'Negro', 'Weiß': 'Blanco', 'Beige': 'Beige', 'Grau': 'Gris',
    'Braun': 'Marrón', 'Rot': 'Rojo', 'Orange': 'Naranja', 'Gelb': 'Amarillo',
    'Grün': 'Verde', 'Blau': 'Azul', 'Lila': 'Morado', 'Rosa': 'Rosa',
    'Türkis': 'Turquesa', 'Gold': 'Dorado', 'Silber': 'Plateado',
    'Weinrot': 'Burdeos', 'Khaki': 'Caqui', 'Creme': 'Crema',
    'Bordeaux': 'Burdeos', 'Mint': 'Menta', 'Koralle': 'Coral',
    'Mehrfarbig': 'Multicolor',
  };
  return map[de] ?? de;
}

function translateCondition(de: string): string {
  // Wallapop: Nuevo con etiquetas | Nuevo sin etiquetas | Como nuevo | En buen estado | Le ha dado uso
  const map: Record<string, string> = {
    'Neu, mit Etikett': 'Nuevo con etiquetas',
    'Neu': 'Nuevo sin etiquetas',
    'Sehr gut': 'Como nuevo',
    'Gut': 'En buen estado',
    'Befriedigend': 'Le ha dado uso',
  };
  return map[de] ?? 'En buen estado';
}

function translateMaterial(de: string): string {
  const map: Record<string, string> = {
    'Polyester': 'Poliéster', 'Baumwolle': 'Algodón', 'Elasthan': 'Elastano',
    'Viskose': 'Viscosa', 'Nylon': 'Nailon', 'Leinen': 'Lino', 'Seide': 'Seda',
    'Satin': 'Satén', 'Spitze': 'Encaje', 'Denim': 'Vaquero', 'Wolle': 'Lana',
    'Kunstleder': 'Polipiel', 'Samt': 'Terciopelo', 'Chiffon': 'Gasa',
    'Jersey': 'Punto', 'Tüll': 'Tul', 'Mesh': 'Malla', 'Acryl': 'Acrílico',
  };
  return map[de] ?? de;
}

function translateProductType(de: string): string {
  const map: Record<string, string> = {
    'Minikleider': 'Vestido corto',
    'Midikleider': 'Vestido midi',
    'Maxikleider': 'Vestido largo',
    'Sommerkleider': 'Vestido de verano',
    'Cocktailkleider': 'Vestido de cóctel',
    'Abendkleider': 'Vestido de noche',
    'Alltagskleider': 'Vestido casual',
    'T-Shirts': 'Camiseta',
    'Crop Tops': 'Crop top',
    'Blusen': 'Blusa',
    'Kapuzenpullover': 'Sudadera con capucha',
    'Sweatshirts': 'Sudadera',
    'Jeans': 'Vaqueros',
    'Leggings': 'Leggings',
    'Jogginghosen': 'Pantalón de chándal',
    'Miniröcke': 'Falda corta',
    'Midiröcke': 'Falda midi',
    'Sport-BHs': 'Top deportivo',
    'Shorts': 'Shorts',
    'Tops': 'Top',
    'Übergangsjacken': 'Chaqueta',
    'Bikinis': 'Bikini',
    'Badeanzüge': 'Bañador',
  };
  return map[de] ?? de;
}

// ── Title/Description Builders ───────────────────────────────────────────────

function buildTitle(draft: ListingDraft): string {
  const productType = translateProductType((draft.category.split('>').pop() ?? '').trim());
  const color = translateColor(draft.colors[0] ?? '').toLowerCase();
  const brand = draft.brand && draft.brand !== 'Ohne Marke' ? draft.brand + ' ' : '';
  const parts = [brand, color !== 'multicolor' ? color : '', productType, `Talla ${draft.size}`].filter(Boolean);
  return parts.join(' ').trim().slice(0, 50); // Wallapop title max ~50
}

function buildDescription(draft: ListingDraft): string {
  const lines: string[] = [];
  // ES Beschreibung — wir nehmen DE-Description als Original und ergänzen ES-Spec.
  lines.push(draft.description);
  lines.push('');
  lines.push(`Talla: ${draft.size}`);
  if (draft.colors.length > 0) lines.push(`Color: ${draft.colors.map(translateColor).join(', ')}`);
  if (draft.material) lines.push(`Material: ${translateMaterial(draft.material)}`);
  if (draft.brand && draft.brand !== 'Ohne Marke') lines.push(`Marca: ${draft.brand}`);
  lines.push(`Estado: ${translateCondition(draft.condition)}`);
  lines.push('');
  lines.push('Envío disponible. Hogar sin humo, sin mascotas. ¡Pregúntame lo que quieras!');
  return lines.join('\n').slice(0, 1500);
}

// ── Helpers ──────────────────────────────────────────────────────────────────

async function selectSelectOrDrawer(
  page: Page,
  trigger: typeof SEL_CATEGORY_DROPDOWN,
  label: string,
  warnings: string[],
  fieldName: string,
): Promise<void> {
  try {
    const loc = await trigger.resolve(page);
    const tag = await loc.evaluate((el) => el.tagName);
    if (tag === 'SELECT') {
      try {
        await loc.selectOption({ label });
      } catch {
        try { await loc.selectOption({ label: new RegExp(label, 'i').source }); }
        catch (e) { warnings.push(`${fieldName} (select): no option for "${label}"`); }
      }
    } else {
      await loc.click();
      await page.waitForTimeout(300);
      try {
        await SEL_OPTION_BY_TEXT(label).click(page);
      } catch {
        warnings.push(`${fieldName} (drawer): no option for "${label}"`);
      }
    }
  } catch (err) {
    warnings.push(`${fieldName}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────

export async function createWallapopListing(
  page: Page,
  draft: ListingDraft,
): Promise<PublishResult> {
  const warnings: string[] = [];

  try {
    await retry(async () => {
      await page.goto(SELL_URL, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      if (await SEL_BLOCKED.exists(page)) throw new Error('blocked');
      if (await SEL_CAPTCHA.exists(page)) throw new Error('captcha');
    }, { attempts: 2, label: 'goto-sell', abortIf: (e) => /captcha|blocked/.test(String(e)) });

    if (await SEL_BLOCKED.exists(page)) return { ok: false, error: 'blocked', blockedBy: 'rate-limit' };
    if (await SEL_CAPTCHA.exists(page)) return { ok: false, error: 'captcha', blockedBy: 'captcha' };

    // 1. Photos (Wallapop max 10)
    if (draft.photos.length === 0) return { ok: false, error: 'no photos' };
    const photoInput = await SEL_PHOTO_INPUT.resolve(page);
    await photoInput.setInputFiles(draft.photos.slice(0, 10));
    try { await SEL_PHOTO_THUMB.waitFor(page, { timeout: 15_000 }); } catch { warnings.push('photo-thumb timeout'); }

    // 2. Title
    await retry(() => SEL_TITLE.fill(page, buildTitle(draft)), { attempts: 2, label: 'title' });

    // 3. Category
    const target = mapCategory('wallapop', draft.category);
    const parts = target.path.split('>').map((s) => s.trim()).filter(Boolean);
    if (parts.length >= 1) {
      await selectSelectOrDrawer(page, SEL_CATEGORY_DROPDOWN, parts[parts.length - 2] ?? parts[0]!, warnings, 'category');
    }
    if (parts.length >= 2) {
      await selectSelectOrDrawer(page, SEL_SUBCATEGORY_DROPDOWN, parts[parts.length - 1]!, warnings, 'subcategory');
    }

    // 4. Description (nach Category — manche Wizards zeigen es erst dann)
    await retry(() => SEL_DESCRIPTION.fill(page, buildDescription(draft)), { attempts: 2, label: 'description' });

    // 5. Brand
    if (draft.brand && draft.brand !== 'Ohne Marke') {
      try { await SEL_BRAND_INPUT.fill(page, draft.brand); }
      catch (err) { warnings.push(`brand: ${err instanceof Error ? err.message : String(err)}`); }
    }

    // 6. Size
    await selectSelectOrDrawer(page, SEL_SIZE_DROPDOWN, draft.size, warnings, 'size');

    // 7. Condition
    await selectSelectOrDrawer(page, SEL_CONDITION_DROPDOWN, translateCondition(draft.condition), warnings, 'condition');

    // 8. Color
    if (draft.colors.length > 0) {
      await selectSelectOrDrawer(page, SEL_COLOR_DROPDOWN, translateColor(draft.colors[0]!), warnings, 'color');
    }

    // 9. Shipping
    try { await SEL_SHIPPING_TOGGLE.click(page); }
    catch (err) { warnings.push(`shipping: ${err instanceof Error ? err.message : String(err)}`); }

    // 10. Price (EUR)
    await retry(() => SEL_PRICE.fill(page, draft.priceEur.toFixed(2)), { attempts: 2, label: 'price' });

    // 11. Submit
    await retry(() => SEL_PUBLISH.click(page), { attempts: 2, label: 'publish' });
    await page.waitForLoadState('domcontentloaded', { timeout: 30_000 });

    // 12. Confirm
    let externalUrl: string | undefined;
    let externalId: string | undefined;
    try {
      await SEL_PUBLISHED_CONFIRM.waitFor(page, { timeout: 15_000 });
      externalUrl = page.url();
      const m = externalUrl.match(/\/item\/[^\/]+\-(\d+)/);
      if (m) externalId = m[1];
    } catch {
      warnings.push('confirmation not detected');
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
