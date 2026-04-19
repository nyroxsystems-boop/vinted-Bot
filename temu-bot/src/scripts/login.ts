// One-time manual login for Temu. Opens headful, waits for you to sign in,
// persists the session to playwright-data/state.json.
//
// Usage: npm run temu:login

import 'dotenv/config';
import { createLogger } from '@vinted-system/shared';
import { getTemuBrowser, closeTemuBrowser } from '../browser.js';
import { isLoggedIn } from '../auth.js';

const log = createLogger('temu-login');
const BASE_URL = process.env.TEMU_BASE_URL ?? 'https://www.temu.com';

async function main(): Promise<void> {
  process.env.HEADLESS = 'false';

  const mb = await getTemuBrowser();
  const page = await mb.context.newPage();

  log.info('Opening Temu — please log in manually (and add your payment method if not done).');
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });

  const deadline = Date.now() + 10 * 60 * 1000; // 10 min
  while (Date.now() < deadline) {
    if (await isLoggedIn(page)) {
      log.info('✓ Login detected — persisting session state.');
      await mb.saveState();
      await closeTemuBrowser();
      process.exit(0);
    }
    await page.waitForTimeout(3000);
  }

  log.error('Login not completed within 10 minutes — aborting.');
  await closeTemuBrowser();
  process.exit(1);
}

main().catch(async (err) => {
  log.error('Login script failed', { error: err instanceof Error ? err.message : String(err) });
  await closeTemuBrowser();
  process.exit(1);
});
