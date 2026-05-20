// Walk through KA's listing-create flow up to the form, then dump all
// category-attribute fields (Zustand/Farbe/Marke/Größe/Sofortkauf).
import { chromium } from 'playwright';

const dir = '/Users/home/Vinted/system/kleinanzeigen-bot/data/kleinanzeigen-accounts/1/chromium-profile';
const ctx = await chromium.launchPersistentContext(dir, { headless: false });
const page = await ctx.newPage();
await page.goto('https://www.kleinanzeigen.de/p-anzeige-aufgeben-schritt2.html', { timeout: 30_000 });
await page.waitForTimeout(3_000);

await page.locator('input[name="title"]').fill('Sommerkleid Plissee Damen Größe S');
await page.waitForTimeout(2_500);

// Category suggestion (typeahead) — usually a dropdown below the title
const sug = page.locator('[role="option"]').first();
if (await sug.isVisible({ timeout: 4_000 }).catch(() => false)) {
  await sug.click();
  console.log('Category suggestion clicked');
  await page.waitForTimeout(5_000);
}

// Now dump every attribute-input + every combobox + every select
const fields = await page.evaluate(() => {
  const out = [];
  // attribute-map inputs/selects (server-known attributes)
  document.querySelectorAll('[name^="attributeMap"]').forEach((el) => {
    out.push({
      kind: 'attributeMap',
      tag: el.tagName.toLowerCase(),
      id: el.id, name: el.getAttribute('name'),
      type: el.getAttribute('type') || '',
      value: el.value || '',
      hidden: el.hidden || getComputedStyle(el).display === 'none',
    });
  });
  // role=combobox triggers (React dropdowns)
  document.querySelectorAll('[role="combobox"]').forEach((el) => {
    out.push({
      kind: 'combobox',
      tag: el.tagName.toLowerCase(),
      id: el.id,
      label: document.getElementById(el.getAttribute('aria-labelledby')?.split(' ')[0])?.textContent?.trim() ?? el.getAttribute('aria-label') ?? '',
    });
  });
  // Selects (legacy)
  document.querySelectorAll('select').forEach((el) => {
    out.push({
      kind: 'select',
      id: el.id, name: el.getAttribute('name'),
      options: Array.from(el.options).map((o) => o.text).slice(0, 6),
    });
  });
  // Sofortkauf / Direkt kaufen toggle
  document.querySelectorAll('input[type="checkbox"], [class*="direct" i], [data-testid*="buy" i]').forEach((el) => {
    const txt = el.parentElement?.textContent?.trim().slice(0, 80) ?? '';
    if (/direkt|sofort|buy/i.test(txt) || /buy/i.test(el.getAttribute('name') ?? '')) {
      out.push({
        kind: 'buyNow',
        tag: el.tagName.toLowerCase(),
        id: el.id, name: el.getAttribute('name'),
        label: txt,
      });
    }
  });
  return out;
});
console.log(JSON.stringify(fields, null, 2));
await ctx.close();
