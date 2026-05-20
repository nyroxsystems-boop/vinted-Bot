import { chromium } from 'playwright';
import path from 'node:path';
import fs from 'node:fs';

const DATA_ROOT = process.env.FB_DATA_ROOT
  ?? path.join(process.cwd(), 'data', 'fb-accounts');
const dir = path.join(DATA_ROOT, '1', 'chromium-profile');
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

console.log(`\n🔑 Facebook Login — öffne Browser...\n`);
console.log(`   ⚠️  ACHTUNG: Facebook hat aggressive Bot-Erkennung.`);
console.log(`   Bitte manuell einloggen und 2FA bestätigen.`);
console.log(`   Session wird gespeichert in: ${dir}\n`);

const ctx = await chromium.launchPersistentContext(dir, {
  headless: false,
  args: [
    '--disable-blink-features=AutomationControlled',
    '--disable-notifications',
  ],
});
const page = await ctx.newPage();
await page.goto('https://www.facebook.com/login');

const deadline = Date.now() + 600_000;
while (Date.now() < deadline) {
  const url = page.url();
  if (!url.includes('/login') && !url.includes('/checkpoint')) {
    console.log('✅ Login erfolgreich! Session gespeichert.');
    break;
  }
  await page.waitForTimeout(3000);
}
await ctx.close();
process.exit(0);
