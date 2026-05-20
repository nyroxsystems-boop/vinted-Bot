// Whatnot — manual login flow.
// Opens a headful Chromium, waits for user to complete login (incl. 2FA),
// persists the session into the per-account profile dir.
import 'dotenv/config';
import { chromium } from 'playwright';
import path from 'node:path';
import fs from 'node:fs';
import { fingerprintFor, stealthInitScript } from '@vinted-system/shared';

const accountId = Number(process.env.ACCOUNT_ID ?? 1);
const DATA_ROOT = process.env.WHATNOT_DATA_ROOT ?? path.join(process.cwd(), 'data', 'whatnot-accounts');
const dir = path.join(DATA_ROOT, String(accountId), 'chromium-profile');
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

console.log(`\nWhatnot Login — Browser wird geöffnet...`);
console.log(`Session wird gespeichert in: ${dir}\n`);

const fp = fingerprintFor(accountId, 'whatnot');
const ctx = await chromium.launchPersistentContext(dir, {
  headless: false,
  userAgent: fp.userAgent,
  viewport: fp.viewport,
  locale: fp.locale,
  timezoneId: fp.timezoneId,
  args: ['--disable-blink-features=AutomationControlled'],
});
await ctx.addInitScript(stealthInitScript(fp));

const page = await ctx.newPage();
await page.goto('https://www.whatnot.com/login');

const deadline = Date.now() + 600_000;
while (Date.now() < deadline) {
  try {
    const ok = (await page.locator('[data-testid="avatar"], a[href*="/profile"]').count()) > 0;
    if (ok && !page.url().includes('/login')) {
      console.log('Login erfolgreich! Session gespeichert.');
      break;
    }
  } catch { /* ignore */ }
  await page.waitForTimeout(3000);
}
await ctx.close();
process.exit(0);
