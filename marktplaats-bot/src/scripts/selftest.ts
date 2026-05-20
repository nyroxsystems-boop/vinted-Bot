import 'dotenv/config';
import path from 'node:path';
import fs from 'node:fs';
import { chromium } from 'playwright';
import {
  fingerprintFor,
  stealthInitScript,
  runSelftest,
  type SelectorTest,
} from '@vinted-system/shared';
import {
  SEL_LOGGED_IN,
  SEL_SELL_BTN,
  SEL_PHOTO_INPUT,
  SEL_TITLE,
  SEL_DESCRIPTION,
  SEL_PRICE,
  SEL_PUBLISH,
  // New selectors for MVP routes — optional (yet-to-validate live)
  SEL_INBOX_ITEM,
  SEL_CHAT_REPLY_BOX,
  SEL_CHAT_SEND_BTN,
  SEL_OFFER_ACCEPT_BTN,
  SEL_OFFER_DECLINE_BTN,
  SEL_SOLD_LIST_ITEM,
  SEL_EDIT_PRICE_INPUT,
} from '../selectors.js';

const accountId = Number(process.env.ACCOUNT_ID ?? 1);
const dataRoot = process.env.MARKTPLAATS_DATA_ROOT
  ?? path.join(process.cwd(), 'data', 'marktplaats-accounts');

const fp = fingerprintFor(accountId, 'marktplaats');
const dir = path.join(dataRoot, String(accountId), 'chromium-profile');
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
  await page.goto('https://www.marktplaats.com/', { timeout: 20_000 }).catch(() => {});
  if (!(await SEL_LOGGED_IN.exists(page))) {
    console.error('❌ Not logged in — run `npm run marktplaats:login` first.');
    await ctx.close();
    process.exit(1);
  }

  const tests: SelectorTest[] = [
    // ── Core (required) ────────────────────────────────────────────────────
    { name: 'home/avatar',     url: 'https://www.marktplaats.com/',     chain: SEL_LOGGED_IN, required: true },
    { name: 'home/sell-btn',   url: 'https://www.marktplaats.com/',     chain: SEL_SELL_BTN, required: true },
    { name: 'sell/photo',      url: 'https://www.marktplaats.com/sell/', chain: SEL_PHOTO_INPUT, required: true, postWaitMs: 1500 },
    { name: 'sell/title',      url: 'https://www.marktplaats.com/sell/', chain: SEL_TITLE, required: true, postWaitMs: 1500 },
    { name: 'sell/description', url: 'https://www.marktplaats.com/sell/', chain: SEL_DESCRIPTION, required: true, postWaitMs: 1500 },
    { name: 'sell/price',      url: 'https://www.marktplaats.com/sell/', chain: SEL_PRICE, required: true, postWaitMs: 1500 },
    { name: 'sell/publish',    url: 'https://www.marktplaats.com/sell/', chain: SEL_PUBLISH, required: true, postWaitMs: 1500 },

    // ── MVP routes (optional — selectors not yet validated against live DOM) ─
    { name: 'inbox/list',      url: 'https://www.marktplaats.com/mypage/messages/', chain: SEL_INBOX_ITEM, required: false, postWaitMs: 2000 },
    { name: 'inbox/reply-box',  url: 'https://www.marktplaats.com/mypage/messages/', chain: SEL_CHAT_REPLY_BOX, required: false, postWaitMs: 2000 },
    { name: 'inbox/send-btn',  url: 'https://www.marktplaats.com/mypage/messages/', chain: SEL_CHAT_SEND_BTN, required: false, postWaitMs: 2000 },
    { name: 'inbox/offer-accept', url: 'https://www.marktplaats.com/mypage/messages/', chain: SEL_OFFER_ACCEPT_BTN, required: false, postWaitMs: 2000 },
    { name: 'inbox/offer-decline', url: 'https://www.marktplaats.com/mypage/messages/', chain: SEL_OFFER_DECLINE_BTN, required: false, postWaitMs: 2000 },
    { name: 'sold/list',       url: 'https://www.marktplaats.com/mypage/listings/?status=sold', chain: SEL_SOLD_LIST_ITEM, required: false, postWaitMs: 2000 },
    // Edit page is per-listing so we can't selftest without a known item id
    { name: 'edit/price-input', url: 'https://www.marktplaats.com/mypage/listings/', chain: SEL_EDIT_PRICE_INPUT, required: false, postWaitMs: 2000 },
  ];

  const report = await runSelftest({ page, marketplace: 'marktplaats', tests });
  console.log(`\n${report.ok ? '✅' : '❌'} ${report.summary.passed}/${report.summary.total} OK`);
  console.log(`Report: ${report.reportPath}`);
  process.exitCode = report.ok ? 0 : 1;
} finally {
  await page.close().catch(() => null);
  await ctx.close();
}
