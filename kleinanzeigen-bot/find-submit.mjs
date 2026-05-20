import { chromium } from 'playwright';
const dir = '/Users/home/Vinted/system/kleinanzeigen-bot/data/kleinanzeigen-accounts/1/chromium-profile';
const ctx = await chromium.launchPersistentContext(dir, { headless: false });
const page = await ctx.newPage();
// Start fresh ad creation in 'Damen Kleider' category
await page.goto('https://www.kleinanzeigen.de/p-anzeige-aufgeben-schritt2.html', { timeout: 30000 });
await page.waitForTimeout(3000);
await page.locator('input[name="title"]').fill('Sommerkleid Plissee Damen Größe S').catch(() => {});
await page.waitForTimeout(2500);
const sug = page.locator('[role="option"]').first();
if (await sug.isVisible({ timeout: 4000 }).catch(() => false)) {
  await sug.click();
  await page.waitForTimeout(3000);
}
// Scroll all the way down so the submit button is mounted
await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
await page.waitForTimeout(2000);
// Dump ALL buttons including their position
const buttons = await page.evaluate(() => {
  return Array.from(document.querySelectorAll('button, input[type="submit"]'))
    .map((el) => ({
      tag: el.tagName.toLowerCase(),
      type: el.getAttribute('type') || '',
      id: el.id,
      text: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60) || (el as HTMLInputElement).value || '',
      classes: (el.className || '').slice(0, 80),
      bottom: el.getBoundingClientRect().bottom,
      inForm: !!el.closest('form'),
      formId: el.closest('form')?.id || '',
    }))
    .filter(b => b.text.length > 0);
});
buttons.forEach((b) => console.log(JSON.stringify(b)));
await ctx.close();
