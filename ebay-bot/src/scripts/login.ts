import { chromium } from 'playwright';
import path from 'node:path';
import fs from 'node:fs';

const MARKET = (process.env.EBAY_MARKET ?? 'de').toLowerCase();
const BASE_URL = MARKET === 'uk' ? 'https://www.ebay.co.uk' : 'https://www.ebay.de';
const DATA_ROOT = process.env.EBAY_DATA_ROOT
  ?? path.join(process.cwd(), 'data', `ebay-${MARKET}-accounts`);
const dir = path.join(DATA_ROOT, '1', 'chromium-profile');
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

console.log(`\n🔑 eBay ${MARKET.toUpperCase()} Login — öffne Browser...\n`);
console.log(`   Bitte bei eBay einloggen.`);
console.log(`   Session wird gespeichert in: ${dir}\n`);

const ctx = await chromium.launchPersistentContext(dir, {
  headless: false,
  args: ['--disable-blink-features=AutomationControlled'],
});
const page = await ctx.newPage();
await page.goto(`${BASE_URL}/signin`);

// Wait for user to log in (10 min timeout)
const deadline = Date.now() + 600_000;
while (Date.now() < deadline) {
  const url = page.url();
  if (!url.includes('/signin') && !url.includes('/login')) {
    console.log('✅ Login erfolgreich! Session gespeichert.');
    break;
  }
  await page.waitForTimeout(2000);
}

await ctx.close();
process.exit(0);
