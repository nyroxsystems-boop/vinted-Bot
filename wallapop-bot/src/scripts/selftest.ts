import 'dotenv/config';
import path from 'node:path';
import { runSelftest, type SelectorTest } from '@vinted-system/shared';
import { launchWpBrowser } from '../browser.js';
import { isLoggedIn } from '../login-flow.js';
import {
  SEL_LOGGED_IN,
  SEL_SELL_BTN,
  SEL_PHOTO_INPUT,
  SEL_TITLE,
  SEL_DESCRIPTION,
  SEL_PRICE,
  SEL_PUBLISH,
  // New MVP-route selectors — optional (yet-to-validate live)
  SEL_INBOX_ITEM,
  SEL_CHAT_REPLY_BOX,
  SEL_CHAT_SEND_BTN,
  SEL_OFFER_ACCEPT_BTN,
  SEL_OFFER_DECLINE_BTN,
  SEL_SOLD_LIST_ITEM,
  SEL_EDIT_PRICE_INPUT,
} from '../selectors.js';

const accountId = Number(process.env.ACCOUNT_ID ?? 1);
const dataRoot = process.env.WP_DATA_ROOT
  ?? path.join(process.cwd(), 'data', 'wallapop-accounts');

const browser = await launchWpBrowser({
  accountId,
  storageDir: path.join(dataRoot, String(accountId)),
  headless: true,
});
const page = await browser.context.newPage();

try {
  if (!(await isLoggedIn(page))) {
    console.error('❌ Not logged in — run `npm run wallapop:login` first.');
    await browser.close();
    process.exit(1);
  }

  const tests: SelectorTest[] = [
    // ── Core (required) ────────────────────────────────────────────────────
    { name: 'home/logged-in', url: 'https://es.wallapop.com/', chain: SEL_LOGGED_IN, required: true },
    { name: 'home/sell-btn',  url: 'https://es.wallapop.com/', chain: SEL_SELL_BTN, required: true },
    { name: 'sell/photo',     url: 'https://es.wallapop.com/app/upload', chain: SEL_PHOTO_INPUT, required: true, postWaitMs: 1500 },
    { name: 'sell/title',     url: 'https://es.wallapop.com/app/upload', chain: SEL_TITLE, required: true, postWaitMs: 1500 },
    { name: 'sell/description', url: 'https://es.wallapop.com/app/upload', chain: SEL_DESCRIPTION, required: true, postWaitMs: 1500 },
    { name: 'sell/price',     url: 'https://es.wallapop.com/app/upload', chain: SEL_PRICE, required: true, postWaitMs: 1500 },
    { name: 'sell/publish',   url: 'https://es.wallapop.com/app/upload', chain: SEL_PUBLISH, required: true, postWaitMs: 1500 },

    // ── MVP routes (optional — selectors not yet validated against live DOM) ─
    { name: 'inbox/list',     url: 'https://es.wallapop.com/app/chat', chain: SEL_INBOX_ITEM, required: false, postWaitMs: 2000 },
    { name: 'inbox/reply-box', url: 'https://es.wallapop.com/app/chat', chain: SEL_CHAT_REPLY_BOX, required: false, postWaitMs: 2000 },
    { name: 'inbox/send-btn', url: 'https://es.wallapop.com/app/chat', chain: SEL_CHAT_SEND_BTN, required: false, postWaitMs: 2000 },
    { name: 'inbox/offer-accept', url: 'https://es.wallapop.com/app/chat', chain: SEL_OFFER_ACCEPT_BTN, required: false, postWaitMs: 2000 },
    { name: 'inbox/offer-decline', url: 'https://es.wallapop.com/app/chat', chain: SEL_OFFER_DECLINE_BTN, required: false, postWaitMs: 2000 },
    { name: 'sold/list',      url: 'https://es.wallapop.com/app/catalog?status=sold', chain: SEL_SOLD_LIST_ITEM, required: false, postWaitMs: 2000 },
    // Edit page requires a known item id, so we check on the seller catalog index.
    { name: 'edit/price-input', url: 'https://es.wallapop.com/app/catalog', chain: SEL_EDIT_PRICE_INPUT, required: false, postWaitMs: 2000 },
  ];

  const report = await runSelftest({ page, marketplace: 'wallapop', tests });
  console.log(`\n${report.ok ? '✅' : '❌'} ${report.summary.passed}/${report.summary.total} OK`);
  console.log(`Report: ${report.reportPath}`);
  process.exitCode = report.ok ? 0 : 1;
} finally {
  await page.close().catch(() => null);
  await browser.close();
}
