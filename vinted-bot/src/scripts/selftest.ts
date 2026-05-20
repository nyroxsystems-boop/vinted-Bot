// Vinted Selftest — wraps existing comma-separated selectors into SelectorChain.
import 'dotenv/config';
import { chain, runSelftest, type SelectorTest } from '@vinted-system/shared';
import { getVintedBrowser } from '../browser.js';
import { VINTED } from '../selectors.js';
import { LISTING_SELECTORS } from '../listings/selectors.js';

const BASE_URL = process.env.VINTED_BASE_URL ?? 'https://www.vinted.de';
const accountId = Number(process.env.ACCOUNT_ID ?? 1);

// Wrap comma-separated CSS lists into individual chain entries.
function wrap(name: string, selectorList: string): ReturnType<typeof chain> {
  const parts = selectorList.split(',').map((s) => s.trim()).filter(Boolean);
  return chain(name, ...parts);
}

const mb = await getVintedBrowser(accountId);
const page = await mb.context.newPage();

try {
  // Login-Check
  await page.goto(`${BASE_URL}/`, { waitUntil: 'domcontentloaded', timeout: 20_000 });
  const isLogged = await page.locator(VINTED.loggedInIndicator).first().isVisible({ timeout: 5000 }).catch(() => false);
  if (!isLogged) {
    console.error('❌ Not logged in — start login via /login/start endpoint');
    await page.close();
    process.exit(1);
  }

  const tests: SelectorTest[] = [
    {
      name: 'home/logged-in-indicator',
      url: `${BASE_URL}/`,
      chain: wrap('vinted:logged-in', VINTED.loggedInIndicator),
      required: true,
    },
    {
      name: 'sell/title-input',
      url: `${BASE_URL}${LISTING_SELECTORS.newListingUrl}`,
      chain: wrap('vinted:sell-title', LISTING_SELECTORS.titleInput),
      required: true,
      postWaitMs: 1500,
    },
    {
      name: 'sell/description-input',
      url: `${BASE_URL}${LISTING_SELECTORS.newListingUrl}`,
      chain: wrap('vinted:sell-description', LISTING_SELECTORS.descriptionInput),
      required: true,
      postWaitMs: 1500,
    },
    {
      name: 'sell/price-input',
      url: `${BASE_URL}${LISTING_SELECTORS.newListingUrl}`,
      chain: wrap('vinted:sell-price', LISTING_SELECTORS.priceInput),
      required: true,
      postWaitMs: 1500,
    },
    {
      name: 'sell/photo-input',
      url: `${BASE_URL}${LISTING_SELECTORS.newListingUrl}`,
      chain: wrap('vinted:sell-photo', LISTING_SELECTORS.photoFileInput),
      required: true,
      postWaitMs: 1500,
    },
    {
      name: 'sell/submit-button',
      url: `${BASE_URL}${LISTING_SELECTORS.newListingUrl}`,
      chain: wrap('vinted:sell-submit', LISTING_SELECTORS.submitButton),
      required: true,
      postWaitMs: 1500,
    },
  ];

  const report = await runSelftest({ page, marketplace: 'vinted', tests });
  console.log(`\n${report.ok ? '✅' : '❌'} ${report.summary.passed}/${report.summary.total} OK`);
  console.log(`Report: ${report.reportPath}`);
  process.exitCode = report.ok ? 0 : 1;
} finally {
  await page.close().catch(() => null);
}
