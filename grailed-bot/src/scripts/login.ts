import { chromium } from 'playwright';
import path from 'node:path';
import fs from 'node:fs';

const DATA_ROOT = process.env.GRAILED_DATA_ROOT
  ?? path.join(process.cwd(), 'data', 'grailed-accounts');
const dir = path.join(DATA_ROOT, '1', 'chromium-profile');
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

console.log(`\n🔑 Grailed Login — öffne Browser...\n`);
console.log(`   Bitte bei Grailed einloggen.`);
console.log(`   Session wird gespeichert in: ${dir}\n`);

const ctx = await chromium.launchPersistentContext(dir, {
  headless: false,
  args: ['--disable-blink-features=AutomationControlled'],
});
const page = await ctx.newPage();
await page.goto('https://www.grailed.com/login');

const deadline = Date.now() + 600_000;
while (Date.now() < deadline) {
  if (page.url().includes('/users/') || page.url() === 'https://www.grailed.com/') {
    console.log('✅ Login erfolgreich! Session gespeichert.');
    break;
  }
  await page.waitForTimeout(2000);
}
await ctx.close();
process.exit(0);
