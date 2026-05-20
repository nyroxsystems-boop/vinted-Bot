// ──────────────────────────────────────────────────────────────────────────────
// Etsy Bot Selftest — best-effort smoke test of selectors and reachability.
//
// Run with:  npm --workspace=@vinted-system/etsy-bot run selftest
// Exits 1 if any required check fails. Optional checks emit "○" but don't
// fail the run.
// ──────────────────────────────────────────────────────────────────────────────

import 'dotenv/config';
import {
  launchEtsy,
  isEtsyLoggedIn,
  ETSY_BASE_URL,
  SEL_LOGGED_IN_INDICATOR,
} from '../browser.js';

const accountId = Number(process.env.ACCOUNT_ID ?? 1);

interface Check {
  name: string;
  required?: boolean;
  test?: () => Promise<boolean>;
  selector?: string;
  url?: string;
}

const ctx = await launchEtsy(accountId, false);
const page = await ctx.newPage();
let failed = 0;
let passed = 0;
let optional = 0;

try {
  await page.goto(ETSY_BASE_URL, { waitUntil: 'domcontentloaded', timeout: 20_000 });

  const loggedIn = await isEtsyLoggedIn(page);
  if (!loggedIn) {
    console.error('Not logged in — run `npm --workspace=@vinted-system/etsy-bot run login` first.');
    process.exit(1);
  }

  const checks: Check[] = [
    {
      name: 'home loaded',
      required: true,
      test: async () => (await page.title()).length > 0,
    },
    {
      name: 'logged-in indicator',
      selector: SEL_LOGGED_IN_INDICATOR,
      required: true,
    },
    // Listings page
    {
      name: 'shop listings page',
      url: `${ETSY_BASE_URL}/your/shops/me/tools/listings`,
      selector: 'a[href*="/listing/"], a[href*="/your/shops/me/listings/"]',
      required: false,
    },
    // Orders page
    {
      name: 'orders page',
      url: `${ETSY_BASE_URL}/your/shops/me/orders`,
      selector: 'a[href*="/listing/"], [data-test-id*="receipt"], [data-testid*="order"]',
      required: false,
    },
    // Inbox / conversations
    {
      name: 'conversations page',
      url: `${ETSY_BASE_URL}/your/conversations`,
      selector: 'a[href*="/your/conversations/"], [data-test-id*="conversation"]',
      required: false,
    },
    // New-listing page (title field is the most stable anchor)
    {
      name: 'new-listing title input',
      url: `${ETSY_BASE_URL}/your/shops/me/tools/listings/create`,
      selector: 'input[name="title"], #listing-edit-title',
      required: false,
    },
  ];

  for (const c of checks) {
    try {
      if (c.url) {
        await page.goto(c.url, { waitUntil: 'domcontentloaded', timeout: 25_000 }).catch(() => null);
        await page.waitForTimeout(1_500);
      }
      if (c.test) {
        const ok = await c.test();
        if (ok) {
          console.log('OK ', c.name);
          passed++;
        } else {
          console.log('FAIL', c.name);
          if (c.required !== false) failed++;
          else optional++;
        }
      } else if (c.selector) {
        const cnt = await page.locator(c.selector).count();
        if (cnt > 0) {
          console.log('OK ', c.name, `(${cnt} found)`);
          passed++;
        } else if (c.required !== false) {
          console.log('FAIL', c.name, '(0 found)');
          failed++;
        } else {
          console.log('opt', c.name, '(0 found)');
          optional++;
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log('FAIL', c.name, msg);
      if (c.required !== false) failed++;
      else optional++;
    }
  }

  console.log(`\nResult: ${passed} passed, ${failed} failed, ${optional} optional-not-found`);
  process.exit(failed > 0 ? 1 : 0);
} finally {
  await page.close().catch(() => null);
  await ctx.close().catch(() => null);
}
