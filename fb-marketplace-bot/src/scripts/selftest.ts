// FB Marketplace selftest — verifies critical selectors against live FB.
//
// WARNING: FB has aggressive anti-bot. Run selftest sparingly; the audit
// traffic itself can trigger checkpoints.
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
  SEL_PHOTO_INPUT,
  SEL_TITLE,
  SEL_PRICE,
  SEL_DESCRIPTION,
  SEL_PUBLISH,
  SEL_INBOX_URL,
  SEL_CONVERSATION_ITEM,
  SEL_REPLY_TEXTAREA,
  SEL_YOUR_LISTINGS_URL,
  SEL_CREATE_ITEM_URL,
} from '../selectors.js';

const BASE_URL = 'https://www.facebook.com';
const accountId = Number(process.env.ACCOUNT_ID ?? 1);
const DATA_ROOT = process.env.FB_DATA_ROOT ?? path.join(process.cwd(), 'data', 'fb-accounts');

const fp = fingerprintFor(accountId, 'fb_marketplace');
const dir = path.join(DATA_ROOT, String(accountId), 'chromium-profile');
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

const ctx = await chromium.launchPersistentContext(dir, {
  headless: true,
  userAgent: fp.userAgent,
  viewport: fp.viewport,
  locale: fp.locale,
  timezoneId: fp.timezoneId,
  args: [
    '--disable-blink-features=AutomationControlled',
    '--disable-notifications',
  ],
});
await ctx.addInitScript(stealthInitScript(fp));

const page = await ctx.newPage();
try {
  await page.goto(`${BASE_URL}/`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await page.waitForTimeout(3000);

  if (!(await SEL_LOGGED_IN.exists(page))) {
    console.error('Not logged in — run `npm run login` first.');
    await ctx.close();
    process.exit(1);
  }

  const tests: SelectorTest[] = [
    { name: 'home/logged-in', url: `${BASE_URL}/`, chain: SEL_LOGGED_IN, required: true, postWaitMs: 2000 },
    { name: 'sell/photo-input', url: `${BASE_URL}${SEL_CREATE_ITEM_URL}`, chain: SEL_PHOTO_INPUT, required: true, postWaitMs: 3500 },
    { name: 'sell/title', url: `${BASE_URL}${SEL_CREATE_ITEM_URL}`, chain: SEL_TITLE, required: true, postWaitMs: 3500 },
    { name: 'sell/price', url: `${BASE_URL}${SEL_CREATE_ITEM_URL}`, chain: SEL_PRICE, required: true, postWaitMs: 3500 },
    { name: 'sell/description', url: `${BASE_URL}${SEL_CREATE_ITEM_URL}`, chain: SEL_DESCRIPTION, required: true, postWaitMs: 3500 },
    { name: 'sell/publish', url: `${BASE_URL}${SEL_CREATE_ITEM_URL}`, chain: SEL_PUBLISH, required: false, postWaitMs: 3500 },
    { name: 'inbox/conversation-item', url: `${BASE_URL}${SEL_INBOX_URL}`, chain: SEL_CONVERSATION_ITEM, required: false, postWaitMs: 3500 },
    { name: 'inbox/reply-textarea', url: `${BASE_URL}${SEL_INBOX_URL}`, chain: SEL_REPLY_TEXTAREA, required: false, postWaitMs: 3500 },
  ];

  const report = await runSelftest({ page, marketplace: 'fb_marketplace', tests });
  console.log(`\n${report.ok ? 'OK' : 'FAIL'} ${report.summary.passed}/${report.summary.total}`);
  console.log(`Report: ${report.reportPath}`);
  console.log(`Selling-page URL (verify manually): ${BASE_URL}${SEL_YOUR_LISTINGS_URL}`);

  process.exitCode = report.ok ? 0 : 1;
} finally {
  await page.close().catch(() => null);
  await ctx.close().catch(() => null);
}
