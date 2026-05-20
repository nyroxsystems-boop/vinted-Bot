// ──────────────────────────────────────────────────────────────────────────────
// Grailed Bot Selftest — best-effort smoke test of selectors and reachability.
//
// Run with:  npm --workspace=@vinted-system/grailed-bot run selftest
// Exits 1 if any required check fails.
// ──────────────────────────────────────────────────────────────────────────────

import 'dotenv/config';
import { cloudflareSafeNavigate } from '@vinted-system/shared';
import {
  launchGrailed,
  isGrailedLoggedIn,
  GRAILED_BASE_URL,
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

const ctx = await launchGrailed(accountId, false);
const page = await ctx.newPage();
let failed = 0;
let passed = 0;
let optional = 0;

try {
  const home = await cloudflareSafeNavigate(page, GRAILED_BASE_URL, { timeoutMs: 30_000 });
  if (!home.ok) {
    console.error('Cloudflare blocked the homepage — aborting:', home.error);
    process.exit(1);
  }

  const loggedIn = await isGrailedLoggedIn(page);
  if (!loggedIn) {
    console.error('Not logged in — run `npm --workspace=@vinted-system/grailed-bot run login` first.');
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
    {
      name: 'new-listing page',
      url: `${GRAILED_BASE_URL}/listings/new`,
      selector: 'input[name*="designer" i], input[placeholder*="designer" i], input[name*="brand" i]',
      required: false,
    },
    {
      name: 'my-items page',
      url: `${GRAILED_BASE_URL}/users/myitems`,
      selector: 'a[href*="/listings/"]',
      required: false,
    },
    {
      name: 'messages page',
      url: `${GRAILED_BASE_URL}/messages`,
      selector: 'a[href*="/messages/"], [data-testid*="conversation"], [class*="conversation" i]',
      required: false,
    },
    {
      name: 'sold page',
      url: `${GRAILED_BASE_URL}/sold`,
      selector: 'a[href*="/listings/"]',
      required: false,
    },
  ];

  for (const c of checks) {
    try {
      if (c.url) {
        const nav = await cloudflareSafeNavigate(page, c.url, { timeoutMs: 25_000 });
        if (!nav.ok) {
          console.log('FAIL', c.name, `(nav: ${nav.error})`);
          if (c.required !== false) failed++;
          else optional++;
          continue;
        }
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
