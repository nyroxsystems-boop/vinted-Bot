// ──────────────────────────────────────────────────────────────────────────────
// Shared Playwright helper — adapted from Catalog-Scraper/src/scraper.ts.
// Each bot has ITS OWN browser instance + storage-state file (isolation).
// ──────────────────────────────────────────────────────────────────────────────

import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { createLogger } from './logger.js';

export interface BrowserSetup {
  scope: string;
  storageDir: string; // where state.json lives
  headless?: boolean;
}

export interface ManagedBrowser {
  browser: Browser;
  context: BrowserContext;
  saveState: () => Promise<void>;
  close: () => Promise<void>;
}

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

export async function launchManagedBrowser(opts: BrowserSetup): Promise<ManagedBrowser> {
  const log = createLogger(opts.scope);

  if (!fs.existsSync(opts.storageDir)) {
    fs.mkdirSync(opts.storageDir, { recursive: true });
  }
  const storagePath = path.join(opts.storageDir, 'state.json');
  const hasState = fs.existsSync(storagePath);

  log.info('Launching browser', { headless: opts.headless ?? false, hasState });

  const browser = await chromium.launch({
    headless: opts.headless ?? false,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-blink-features=AutomationControlled',
      '--disable-infobars',
      '--window-size=1440,900',
    ],
  });

  const context = await browser.newContext({
    ...(hasState ? { storageState: storagePath } : {}),
    userAgent: USER_AGENT,
    viewport: { width: 1440, height: 900 },
    locale: 'de-DE',
    timezoneId: 'Europe/Berlin',
    javaScriptEnabled: true,
  });

  // Minimal stealth: hide the webdriver flag. Not a full fingerprint-evasion lib.
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });

  if (hasState) log.info('Restored session from state.json');

  return {
    browser,
    context,
    async saveState() {
      try {
        await context.storageState({ path: storagePath });
        log.info('Session state persisted');
      } catch (err) {
        log.warn('Failed to persist state', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    },
    async close() {
      try {
        await context.storageState({ path: storagePath });
      } catch {
        /* ignore */
      }
      await context.close();
      await browser.close();
      log.info('Browser closed');
    },
  };
}

/**
 * Check if the current page is showing a CAPTCHA / bot-block page.
 * Bots MUST pause (not bypass) when this returns true.
 */
export async function isBotBlocked(page: Page): Promise<{ blocked: boolean; reason?: string }> {
  try {
    const bodyText = await page.locator('body').innerText({ timeout: 5000 }).catch(() => '');
    const lower = bodyText.toLowerCase();
    if (lower.includes('captcha') || lower.includes('recaptcha') || lower.includes('hcaptcha')) {
      return { blocked: true, reason: 'CAPTCHA detected' };
    }
    if (lower.includes('access denied') || lower.includes('zugriff verweigert')) {
      return { blocked: true, reason: 'Access denied' };
    }
    const url = page.url();
    if (url.includes('/captcha') || url.includes('/challenge')) {
      return { blocked: true, reason: 'Challenge URL' };
    }
    return { blocked: false };
  } catch {
    return { blocked: false };
  }
}
