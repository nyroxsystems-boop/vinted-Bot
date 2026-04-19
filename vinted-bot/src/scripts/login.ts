// ──────────────────────────────────────────────────────────────────────────────
// One-time login helper. Opens a headful browser so you can log in MANUALLY
// (email, password, 2FA, CAPTCHA if any). Once logged in, the session state is
// persisted to playwright-data/state.json and reused by the bot afterwards.
//
// Usage: npm run vinted:login
// ──────────────────────────────────────────────────────────────────────────────

import 'dotenv/config';
import { createLogger } from '@vinted-system/shared';
import { getVintedBrowser, closeVintedBrowser } from '../browser.js';
import { isLoggedIn } from '../auth.js';

const log = createLogger('vinted-login');
const BASE_URL = process.env.VINTED_BASE_URL ?? 'https://www.vinted.de';

async function main(): Promise<void> {
  // Force headful for manual login regardless of HEADLESS env.
  process.env.HEADLESS = 'false';

  const mb = await getVintedBrowser();
  const page = await mb.context.newPage();

  log.info('Opening Vinted — please log in manually in the browser window.');
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });

  // Poll every 3 seconds for up to 5 minutes for successful login.
  const deadline = Date.now() + 5 * 60 * 1000;
  while (Date.now() < deadline) {
    if (await isLoggedIn(page)) {
      log.info('✓ Login detected — persisting session state.');
      await mb.saveState();
      await closeVintedBrowser();
      process.exit(0);
    }
    await page.waitForTimeout(3000);
  }

  log.error('Login not completed within 5 minutes — aborting.');
  await closeVintedBrowser();
  process.exit(1);
}

main().catch(async (err) => {
  log.error('Login script failed', { error: err instanceof Error ? err.message : String(err) });
  await closeVintedBrowser();
  process.exit(1);
});
