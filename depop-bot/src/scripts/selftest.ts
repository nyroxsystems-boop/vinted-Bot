// Depop bot selftest — verifies all critical selectors against the live site.
// Uses cloudflareLaunchArgs() + prewarm so the test passes through CF cleanly.
//
// Run:  ACCOUNT_ID=1 npm run -w @vinted-system/depop-bot selftest
import 'dotenv/config';
import path from 'node:path';
import fs from 'node:fs';
import { chromium } from 'playwright';
import {
  fingerprintFor,
  stealthInitScript,
  runSelftest,
  cloudflareLaunchArgs,
  prewarmCloudflareCookies,
  type SelectorTest,
} from '@vinted-system/shared';
import {
  SEL_LOGGED_IN,
  SEL_SELL_BTN,
  SEL_PHOTO_INPUT,
  SEL_DESCRIPTION,
  SEL_PRICE,
  SEL_PUBLISH,
  SEL_INBOX_LIST,
  SEL_SOLD_ITEM,
} from '../selectors.js';

const accountId = Number(process.env.ACCOUNT_ID ?? 1);
const dataRoot = process.env.DEPOP_DATA_ROOT
  ?? path.join(process.cwd(), 'data', 'depop-accounts');

const fp = fingerprintFor(accountId, 'depop');
const dir = path.join(dataRoot, String(accountId), 'chromium-profile');
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

const ctx = await chromium.launchPersistentContext(dir, {
  headless: true,
  userAgent: fp.userAgent,
  viewport: fp.viewport,
  locale: fp.locale,
  timezoneId: fp.timezoneId,
  args: cloudflareLaunchArgs(),
  extraHTTPHeaders: {
    'Accept-Language': `${fp.locale},${fp.locale.split('-')[0]};q=0.9,en;q=0.8`,
  },
});
await ctx.addInitScript(stealthInitScript(fp));
const page = await ctx.newPage();

try {
  // Pre-warm CF cookies once before the selftest fires multiple navigations
  await prewarmCloudflareCookies(page, 'https://www.depop.com/');

  if (!(await SEL_LOGGED_IN.exists(page))) {
    console.error('Not logged in — run `npm run depop:login` first.');
    await ctx.close();
    process.exit(1);
  }

  const tests: SelectorTest[] = [
    { name: 'home/logged-in',     url: 'https://www.depop.com/',          chain: SEL_LOGGED_IN,    required: true },
    { name: 'home/sell-btn',      url: 'https://www.depop.com/',          chain: SEL_SELL_BTN,     required: true },
    { name: 'sell/photo',         url: 'https://www.depop.com/sell/',     chain: SEL_PHOTO_INPUT,  required: true, postWaitMs: 1500 },
    { name: 'sell/description',   url: 'https://www.depop.com/sell/',     chain: SEL_DESCRIPTION,  required: true, postWaitMs: 1500 },
    { name: 'sell/price',         url: 'https://www.depop.com/sell/',     chain: SEL_PRICE,        required: true, postWaitMs: 1500 },
    { name: 'sell/publish',       url: 'https://www.depop.com/sell/',     chain: SEL_PUBLISH,      required: true, postWaitMs: 1500 },
    { name: 'inbox/list',         url: 'https://www.depop.com/messages/', chain: SEL_INBOX_LIST,   required: false, postWaitMs: 2000 },
    { name: 'sold/items',         url: 'https://www.depop.com/my-shop/sold/', chain: SEL_SOLD_ITEM, required: false, postWaitMs: 2000 },
  ];

  const report = await runSelftest({ page, marketplace: 'depop', tests });
  console.log(`\n${report.ok ? 'OK' : 'FAIL'} — ${report.summary.passed}/${report.summary.total} passed`);
  console.log(`Report: ${report.reportPath}`);
  process.exitCode = report.ok ? 0 : 1;
} finally {
  await page.close().catch(() => null);
  await ctx.close();
}
