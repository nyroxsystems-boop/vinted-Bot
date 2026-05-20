// ──────────────────────────────────────────────────────────────────────────────
// Depop Listing-Create
//
// Depop (UK/US) — englisch, Stil-orientiert. Beschreibung+Hashtags ist KING.
// Es gibt keinen Title — die Description ist das Listing.
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
  SEL_DESCRIPTION,
  SEL_HASHTAGS,
  SEL_PRICE,
  SEL_CATEGORY_DROPDOWN,
  SEL_SUBCATEGORY_DROPDOWN,
  SEL_BRAND_INPUT,
  SEL_BRAND_OPTION,
  SEL_SIZE_DROPDOWN,
  SEL_CONDITION_RADIO,
  SEL_COLOR_TRIGGER,
  SEL_COLOR_OPTION,
  SEL_SHIPPING_DOMESTIC,
  SEL_PUBLISH,
  SEL_PUBLISHED_CONFIRM,
  SEL_CAPTCHA,
} from '../selectors.js';

const log = createLogger('depop-listing-create');

const SELL_URL = 'https://www.depop.com/sell/';
const GBP_RATE = Number(process.env.EUR_GBP_RATE ?? 0.86);

function eurToGbp(eur: number): number {
  return Math.round(eur * GBP_RATE * 100) / 100;
}

function translateColor(de: string): string {
  const map: Record<string, string> = {
    'Schwarz': 'Black', 'Weiß': 'White', 'Beige': 'Beige', 'Grau': 'Grey',
    'Braun': 'Brown', 'Rot': 'Red', 'Orange': 'Orange', 'Gelb': 'Yellow',
    'Grün': 'Green', 'Blau': 'Blue', 'Lila': 'Purple', 'Rosa': 'Pink',
    'Türkis': 'Turquoise', 'Gold': 'Gold', 'Silber': 'Silver',
    'Weinrot': 'Burgundy', 'Khaki': 'Khaki', 'Creme': 'Cream',
    'Bordeaux': 'Burgundy', 'Mint': 'Mint', 'Koralle': 'Coral',
    'Mehrfarbig': 'Multicolour',
  };
  return map[de] ?? de;
}

function translateCondition(de: string): string {
  // Depop conditions: Brand new | New (with tags) | Used
  const map: Record<string, string> = {
    'Neu, mit Etikett': 'Brand new',
    'Neu': 'New',
    'Sehr gut': 'Used',
    'Gut': 'Used',
    'Befriedigend': 'Used',
  };
  return map[de] ?? 'Used';
}

function buildDescription(draft: ListingDraft): string {
  // Depop Style: kurzer Beschreibungstext + Hashtags am Ende.
  // Wir nehmen Vinted-Description, übersetzen Größen-/Farb-Spec auf englisch,
  // und ergänzen Hashtags.
  const lines: string[] = [];
  // Vinted-Description ist DE — Depop akzeptiert mehrsprachig, aber englisch funktioniert besser
  lines.push(draft.description);
  lines.push('');
  lines.push(`Size: ${draft.size}`);
  if (draft.colors.length > 0) lines.push(`Colour: ${draft.colors.map(translateColor).join(', ')}`);
  if (draft.brand && draft.brand !== 'Ohne Marke') lines.push(`Brand: ${draft.brand}`);

  const tags = generateHashtags(draft);
  if (tags.length > 0) {
    lines.push('');
    lines.push(tags.map((t) => `#${t}`).join(' '));
  }
  return lines.join('\n').slice(0, 1000);
}

function generateHashtags(draft: ListingDraft): string[] {
  const tags = new Set<string>();
  // Stil-basiert
  const cat = (draft.category.split('>').pop() ?? '').trim().toLowerCase();
  if (/minikleid|midi|maxi|kleid|sommerkleid/.test(cat)) {
    tags.add('dress'); tags.add('y2k'); tags.add('summer');
  }
  if (/crop/.test(cat))    { tags.add('croptop'); tags.add('y2k'); }
  if (/jeans/.test(cat))   { tags.add('jeans'); tags.add('denim'); }
  if (/hoodie/.test(cat))  { tags.add('hoodie'); tags.add('streetwear'); }
  if (/rock/.test(cat))    { tags.add('skirt'); tags.add('miniskirt'); }
  // Farbe
  draft.colors.forEach((c) => tags.add(translateColor(c).toLowerCase().replace(/\s+/g, '')));
  // Generisch
  tags.add('cute'); tags.add('vintage'); tags.add('aesthetic');
  return Array.from(tags).slice(0, 8);
}

// ── Helpers ──────────────────────────────────────────────────────────────────

async function selectFromNativeOrDropdown(
  page: Page,
  selectors: { dropdown: ReturnType<typeof SEL_CATEGORY_DROPDOWN.exists> extends Promise<boolean> ? typeof SEL_CATEGORY_DROPDOWN : never },
  value: string,
): Promise<boolean> {
  // Helper retired in favor of inline logic below
  return false;
}

// ── Main ─────────────────────────────────────────────────────────────────────

export async function createDepopListing(
  page: Page,
  draft: ListingDraft,
): Promise<PublishResult> {
  const warnings: string[] = [];
  const gbpPrice = eurToGbp(draft.priceEur);

  try {
    await retry(async () => {
      await page.goto(SELL_URL, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      if (await SEL_CAPTCHA.exists(page)) throw new Error('captcha');
    }, { attempts: 2, label: 'goto-sell', abortIf: (e) => /captcha/.test(String(e)) });

    if (await SEL_CAPTCHA.exists(page)) {
      return { ok: false, error: 'captcha challenge', blockedBy: 'captcha' };
    }

    // 1. Photos
    if (draft.photos.length === 0) return { ok: false, error: 'no photos' };
    const photoInput = await SEL_PHOTO_INPUT.resolve(page);
    await photoInput.setInputFiles(draft.photos.slice(0, 4)); // Depop max 4
    try { await SEL_PHOTO_THUMB.waitFor(page, { timeout: 15_000 }); } catch { warnings.push('photo-thumb timeout'); }

    // 2. Description (key field on Depop — kein Title)
    await retry(() => SEL_DESCRIPTION.fill(page, buildDescription(draft)), { attempts: 2, label: 'description' });

    // 3. Hashtags (extra field, falls separat)
    try {
      const tags = generateHashtags(draft).map((t) => `#${t}`).join(' ');
      await SEL_HASHTAGS.fill(page, tags);
    } catch { /* hashtags might be in description only */ }

    // 4. Category — versucht native <select> zuerst, dann Custom-Dropdown
    const target = mapCategory('depop', draft.category);
    const parts = target.path.split('>').map((s) => s.trim()).filter(Boolean);
    try {
      const catLoc = await SEL_CATEGORY_DROPDOWN.resolve(page);
      const tag = await catLoc.evaluate((el) => el.tagName);
      if (tag === 'SELECT' && parts[1]) {
        await catLoc.selectOption({ label: parts[1] }).catch(async () => {
          await catLoc.selectOption({ label: new RegExp(parts[1]!, 'i').source });
        });
      } else {
        await catLoc.click();
        await page.waitForTimeout(400);
        for (const p of parts.slice(1)) {
          await page.locator(`text=${p}`).first().click().catch(() => null);
          await page.waitForTimeout(300);
        }
      }
    } catch (err) {
      warnings.push(`category: ${err instanceof Error ? err.message : String(err)}`);
    }

    // 5. Subcategory (nur wenn 3-Level Path)
    if (parts.length >= 3) {
      try {
        const subLoc = await SEL_SUBCATEGORY_DROPDOWN.resolve(page);
        const tag = await subLoc.evaluate((el) => el.tagName);
        if (tag === 'SELECT') {
          await subLoc.selectOption({ label: parts[2]! }).catch(() => null);
        } else {
          await subLoc.click();
          await page.waitForTimeout(300);
          await page.locator(`text=${parts[2]}`).first().click().catch(() => null);
        }
      } catch {
        warnings.push(`subcategory not selected: ${parts[2]}`);
      }
    }

    // 6. Brand
    if (draft.brand && draft.brand !== 'Ohne Marke') {
      try {
        await SEL_BRAND_INPUT.fill(page, draft.brand);
        await page.waitForTimeout(500);
        try { await SEL_BRAND_OPTION.click(page); }
        catch { warnings.push(`brand auto-complete: no option for "${draft.brand}"`); }
      } catch (err) {
        warnings.push(`brand: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // 7. Size
    try {
      const sizeLoc = await SEL_SIZE_DROPDOWN.resolve(page);
      const tag = await sizeLoc.evaluate((el) => el.tagName);
      if (tag === 'SELECT') {
        await sizeLoc.selectOption({ label: new RegExp(`\\b${draft.size}\\b`, 'i').source }).catch(async () => {
          await sizeLoc.selectOption({ label: draft.size });
        });
      } else {
        await sizeLoc.click();
        await page.waitForTimeout(300);
        await page.locator(`button:has-text("${draft.size}")`).first().click().catch(() => null);
      }
    } catch (err) {
      warnings.push(`size: ${err instanceof Error ? err.message : String(err)}`);
    }

    // 8. Condition
    try {
      const cond = translateCondition(draft.condition);
      await SEL_CONDITION_RADIO(cond).click(page);
    } catch (err) {
      warnings.push(`condition: ${err instanceof Error ? err.message : String(err)}`);
    }

    // 9. Color (max 1 — Depop nimmt meist primary)
    if (draft.colors.length > 0) {
      try {
        await SEL_COLOR_TRIGGER.click(page);
        await page.waitForTimeout(300);
        const c = translateColor(draft.colors[0]!);
        await SEL_COLOR_OPTION(c).click(page);
      } catch (err) {
        warnings.push(`color: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // 10. Shipping
    try { await SEL_SHIPPING_DOMESTIC.click(page); }
    catch { warnings.push('shipping-domestic toggle not found'); }

    // 11. Price (GBP)
    await retry(() => SEL_PRICE.fill(page, gbpPrice.toFixed(2)), { attempts: 2, label: 'price' });

    // 12. Submit
    await retry(() => SEL_PUBLISH.click(page), { attempts: 2, label: 'publish' });
    await page.waitForLoadState('domcontentloaded', { timeout: 30_000 });

    // 13. Confirm
    let externalUrl: string | undefined;
    let externalId: string | undefined;
    try {
      await SEL_PUBLISHED_CONFIRM.waitFor(page, { timeout: 15_000 });
      externalUrl = page.url();
      const m = externalUrl.match(/\/products\/([a-zA-Z0-9_-]+)/);
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
