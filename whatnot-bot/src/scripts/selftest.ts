// Whatnot selftest — probes critical selectors.
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
  SEL_INBOX_URL,
  SEL_ORDERS_URL,
  SEL_REPLY_TEXTAREA,
} from '../selectors.js';

const BASE_URL = 'https://www.whatnot.com';
const accountId = Number(process.env.ACCOUNT_ID ?? 1);
const DATA_ROOT = process.env.WHATNOT_DATA_ROOT ?? path.join(process.cwd(), 'data', 'whatnot-accounts');

const fp = fingerprintFor(accountId, 'whatnot');
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
    console.error('Not logged in — run `npm run login` first.');
    await ctx.close();
    process.exit(1);
  }

  const tests: SelectorTest[] = [
    { name: 'home/logged-in', url: `${BASE_URL}/`, chain: SEL_LOGGED_IN, required: true, postWaitMs: 1500 },
    { name: 'home/sell-btn', url: `${BASE_URL}/`, chain: SEL_SELL_BTN, required: false, postWaitMs: 1500 },
    { name: 'inbox/reply-textarea', url: `${BASE_URL}${SEL_INBOX_URL}`, chain: SEL_REPLY_TEXTAREA, required: false, postWaitMs: 2500 },
  ];

  const report = await runSelftest({ page, marketplace: 'whatnot', tests });
  console.log(`\n${report.ok ? 'OK' : 'FAIL'} ${report.summary.passed}/${report.summary.total}`);
  console.log(`Report: ${report.reportPath}`);
  console.log(`Orders-page URL (verify manually): ${BASE_URL}${SEL_ORDERS_URL}`);

  process.exitCode = report.ok ? 0 : 1;
} finally {
  await page.close().catch(() => null);
  await ctx.close().catch(() => null);
}
