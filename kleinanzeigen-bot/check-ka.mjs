import { chromium } from 'playwright';
const dir = '/Users/home/Vinted/system/kleinanzeigen-bot/data/kleinanzeigen-accounts/1/chromium-profile';
const ctx = await chromium.launchPersistentContext(dir, { headless: true });
const page = await ctx.newPage();
await page.goto('https://www.kleinanzeigen.de/m-meine-anzeigen.html', { timeout: 30000 });
await page.waitForTimeout(4000);
const counter = await page.locator('text=/\\d+ Anzeigen online \\/ \\d+ gesamt/').first().textContent().catch(()=>null);
console.log('counter:', counter);
await ctx.close();
