// Vestiaire Collective selftest — probes critical selectors against the live site.
import 'dotenv/config';
import path from 'node:path';
import fs from 'node:fs';
import { chromium } from 'playwright';
import {
  fingerprintFor, stealthInitScript,
  runSelftest, type SelectorTest,
} from '@vinted-system/shared';
import {
  SEL_LOGGED_IN,
  SEL_SELL_BTN,
  SEL_PHOTO_INPUT,
  SEL_TITLE,
  SEL_DESCRIPTION,
  SEL_PRICE,
  SEL_PUBLISH,
  SEL_INBOX_URL,
  SEL_CONVERSATION_ITEM,
  SEL_SOLD_URL,
} from '../selectors.js';

const BASE_URL = 'https://www.vestiairecollective.com';
const accountId = Number(process.env.ACCOUNT_ID ?? 1);
const DATA_ROOT = process.env.VESTIAIRE_DATA_ROOT ?? path.join(process.cwd(), 'data', 'vestiaire-accounts');

const fp = fingerprintFor(accountId, 'vestiaire');
const dir = path.join(DATA_ROOT, String(accountId), 'chromium-profile');
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

const ctx = await chromium.launchPersistentContext(dir, {
  headless: true,
  userAgent: fp.userAgent,
  viewport: fp.viewport,
  locale: fp.locale,
  timezoneId: fp.timezoneId,
  args: ['--disable-blink-features=AutomationControlled'],
});
await ctx.addInitScript(stealthInitScript(fp));

const page = await ctx.newPage();
try {
  await page.goto(`${BASE_URL}/`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await page.waitForTimeout(2000);

  if (!(await SEL_LOGGED_IN.exists(page))) {
    console.error('❌ Not logged in — run `npm run login` first.');
    await ctx.close();
    process.exit(1);
  }

  const tests: SelectorTest[] = [
    { name: 'home/logged-in', url: `${BASE_URL}/`, chain: SEL_LOGGED_IN, required: true, postWaitMs: 1500 },
    { name: 'home/sell-btn', url: `${BASE_URL}/`, chain: SEL_SELL_BTN, required: false, postWaitMs: 1500 },
    { name: 'sell/photo-input', url: `${BASE_URL}/sell/`, chain: SEL_PHOTO_INPUT, required: true, postWaitMs: 2500 },
    { name: 'sell/title', url: `${BASE_URL}/sell/`, chain: SEL_TITLE, required: true, postWaitMs: 2500 },
    { name: 'sell/description', url: `${BASE_URL}/sell/`, chain: SEL_DESCRIPTION, required: true, postWaitMs: 2500 },
    { name: 'sell/price', url: `${BASE_URL}/sell/`, chain: SEL_PRICE, required: true, postWaitMs: 2500 },
    { name: 'sell/publish', url: `${BASE_URL}/sell/`, chain: SEL_PUBLISH, required: false, postWaitMs: 2500 },
    { name: 'inbox/conversation-item', url: `${BASE_URL}${SEL_INBOX_URL}`, chain: SEL_CONVERSATION_ITEM, required: false, postWaitMs: 2500 },
  ];

  const report = await runSelftest({ page, marketplace: 'vestiaire', tests });
  console.log(`\n${report.ok ? 'OK' : 'FAIL'} ${report.summary.passed}/${report.summary.total}`);
  console.log(`Report: ${report.reportPath}`);

  // soldUrl is a constant, just print it so users know which page to manually verify
  console.log(`Sold-page URL (verify manually): ${BASE_URL}${SEL_SOLD_URL}`);

  process.exitCode = report.ok ? 0 : 1;
} finally {
  await page.close().catch(() => null);
  await ctx.close().catch(() => null);
}
