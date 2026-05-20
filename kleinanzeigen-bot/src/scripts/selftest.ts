// CLI: npm run kleinanzeigen:selftest
// Loggt ein, ruft Sell-Wizard auf, prüft kritische Selektoren.
import 'dotenv/config';
import path from 'node:path';
import { runSelftest, type SelectorTest } from '@vinted-system/shared';
import { launchKaBrowser } from '../browser.js';
import { isLoggedIn } from '../login-flow.js';
import {
  SEL_LOGGED_IN_AVATAR,
  SEL_NEW_AD_BTN,
  SEL_TITLE_INPUT,
  SEL_DESCRIPTION_TEXTAREA,
  SEL_PRICE_INPUT,
  SEL_PHOTO_INPUT,
  SEL_PUBLISH_BTN,
} from '../selectors.js';

const accountId = Number(process.env.ACCOUNT_ID ?? 1);
const dataRoot = process.env.KA_DATA_ROOT
  ?? path.join(process.cwd(), 'data', 'kleinanzeigen-accounts');

const browser = await launchKaBrowser({
  accountId,
  storageDir: path.join(dataRoot, String(accountId)),
  headless: true,
});

const page = await browser.context.newPage();
try {
  if (!(await isLoggedIn(page))) {
    console.error('❌ Not logged in — run `npm run kleinanzeigen:login` first.');
    await browser.close();
    process.exit(1);
  }

  const tests: SelectorTest[] = [
    {
      name: 'home/avatar',
      url: 'https://www.kleinanzeigen.de/',
      chain: SEL_LOGGED_IN_AVATAR,
      required: true,
    },
    {
      name: 'home/new-ad-button',
      url: 'https://www.kleinanzeigen.de/',
      chain: SEL_NEW_AD_BTN,
      required: true,
    },
    {
      name: 'sell/title-input',
      url: 'https://www.kleinanzeigen.de/p-anzeige-aufgeben-schritt2.html',
      chain: SEL_TITLE_INPUT,
      required: true,
      postWaitMs: 1000,
    },
    {
      name: 'sell/description-textarea',
      url: 'https://www.kleinanzeigen.de/p-anzeige-aufgeben-schritt2.html',
      chain: SEL_DESCRIPTION_TEXTAREA,
      required: true,
      postWaitMs: 1000,
    },
    {
      name: 'sell/price-input',
      url: 'https://www.kleinanzeigen.de/p-anzeige-aufgeben-schritt2.html',
      chain: SEL_PRICE_INPUT,
      required: true,
      postWaitMs: 1000,
    },
    {
      name: 'sell/photo-input',
      url: 'https://www.kleinanzeigen.de/p-anzeige-aufgeben-schritt2.html',
      chain: SEL_PHOTO_INPUT,
      required: true,
      postWaitMs: 1000,
    },
    {
      name: 'sell/publish-button',
      url: 'https://www.kleinanzeigen.de/p-anzeige-aufgeben-schritt2.html',
      chain: SEL_PUBLISH_BTN,
      required: true,
      postWaitMs: 1000,
    },
  ];

  const report = await runSelftest({
    page,
    marketplace: 'kleinanzeigen',
    tests,
  });

  console.log(`\n${report.ok ? '✅' : '❌'} ${report.summary.passed}/${report.summary.total} OK`);
  console.log(`Report: ${report.reportPath}`);
  process.exitCode = report.ok ? 0 : 1;
} finally {
  await page.close().catch(() => null);
  await browser.close();
}
