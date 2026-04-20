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
 * Dismiss any cookie-consent banner the page might be showing.
 *
 * Covers OneTrust (Vinted), Temu's own consent dialog, and a long list of
 * generic patterns. The order tries the least-intrusive approaches first
 * (click a proper "reject" button) before escalating to removing the
 * overlay from the DOM.
 *
 * Safe to call on every page load — returns quickly when no banner exists.
 * Returns `true` if something was actually dismissed.
 */
export async function dismissOneTrust(page: import('playwright').Page): Promise<boolean> {
  // ── Strategy 1: OneTrust API (Vinted + many other sites) ─────────────
  const oneTrustDone = await page
    .evaluate(() => {
      const w = window as unknown as { OneTrust?: { RejectAll?: () => void } };
      if (w.OneTrust?.RejectAll) {
        try {
          w.OneTrust.RejectAll();
          return true;
        } catch {
          return false;
        }
      }
      return false;
    })
    .catch(() => false);
  if (oneTrustDone) {
    await page.waitForTimeout(400);
    return true;
  }

  // ── Strategy 2: Click a visible reject/accept button by text ─────────
  // Works on Temu (Datenschutz- & Cookie-Einstellung dialog) and most
  // generic banners. Searches the ENTIRE document INCLUDING shadow roots —
  // buttons below the fold still match because we look at .innerText
  // regardless of visibility.
  const textClicked = await page
    .evaluate(() => {
      const preferences = [
        // German
        'Alle ablehnen', 'Nur notwendige', 'Nur Notwendige zulassen',
        'Notwendige auswählen', 'Notwendige Cookies', 'Ablehnen',
        'Alle akzeptieren', 'Akzeptieren',
        // English
        'Reject all', 'Only necessary', 'Only essential',
        'Accept all', 'Accept',
      ];

      // Walk the main DOM plus any shadow roots we find.
      function collectClickables(root: Document | ShadowRoot): HTMLElement[] {
        const out: HTMLElement[] = [];
        const all = root.querySelectorAll<HTMLElement>('button, [role="button"], a');
        all.forEach((el) => out.push(el));
        // Descend into shadow roots
        root.querySelectorAll<HTMLElement>('*').forEach((el) => {
          const sr = (el as HTMLElement & { shadowRoot?: ShadowRoot }).shadowRoot;
          if (sr) out.push(...collectClickables(sr));
        });
        return out;
      }

      const all = collectClickables(document);
      const foundTexts: string[] = [];
      for (const target of preferences) {
        const hit = all.find((el) => {
          const t = (el.innerText || el.textContent || '').trim();
          return t === target || t.startsWith(target);
        });
        if (hit) {
          try {
            hit.scrollIntoView({ block: 'center' });
            (hit as HTMLButtonElement).click();
            return { clicked: true, label: target, totalClickables: all.length };
          } catch {
            /* keep trying next preference */
          }
        }
      }
      // No hit. Return a snapshot for diagnostics.
      for (const el of all.slice(0, 40)) {
        const t = (el.innerText || el.textContent || '').trim().slice(0, 50);
        if (t) foundTexts.push(t);
      }
      return { clicked: false, totalClickables: all.length, sampleTexts: foundTexts };
    })
    .catch(() => ({ clicked: false } as { clicked: boolean; label?: string }));
  if ('clicked' in textClicked && textClicked.clicked) {
    await page.waitForTimeout(600);
    return true;
  }
  // Log diagnostic so we can see what buttons WERE on the page.
  // (Only logs if no strategy worked and we reach Strategy 3.)
  if ('sampleTexts' in textClicked) {
    const d = textClicked as { clicked: false; totalClickables: number; sampleTexts: string[] };
    console.warn('[dismissOneTrust] text strategy failed', {
      totalClickables: d.totalClickables,
      sampleTexts: d.sampleTexts.slice(0, 15),
    });
  }

  // ── Strategy 2b: Press Escape — some dialogs listen for it ───────────
  await page.keyboard.press('Escape').catch(() => null);
  await page.waitForTimeout(200);

  // ── Strategy 3: Fixed overlay / dialog nuke ──────────────────────────
  // If still stuck, remove any fixed-position full-screen overlay and any
  // role=dialog element that appears to be a cookie notice.
  const nuked = await page
    .evaluate(() => {
      let removed = 0;

      const killSelectors = [
        '#onetrust-banner-sdk',
        '.onetrust-pc-dark-filter',
        '[id*="cookie" i][id*="banner" i]',
        '[class*="cookie" i][class*="banner" i]',
        '[id*="consent" i]',
        '[class*="consent-banner" i]',
      ];
      for (const s of killSelectors) {
        document.querySelectorAll(s).forEach((el) => {
          el.remove();
          removed++;
        });
      }

      // Dialogs whose text contains "Cookie" or "Datenschutz"
      document.querySelectorAll<HTMLElement>('[role="dialog"]').forEach((d) => {
        const t = (d.innerText || '').slice(0, 200).toLowerCase();
        if (/cookie|datenschutz|consent|privacy/.test(t)) {
          d.remove();
          removed++;
        }
      });

      // Any fixed-position full-width element near top/bottom with cookie text
      document.querySelectorAll<HTMLElement>('*').forEach((el) => {
        const style = window.getComputedStyle(el);
        if (style.position !== 'fixed' && style.position !== 'sticky') return;
        const rect = el.getBoundingClientRect();
        if (rect.width < window.innerWidth * 0.6) return;
        if (rect.height < 40 || rect.height > window.innerHeight) return;
        const t = (el.innerText || '').slice(0, 200).toLowerCase();
        if (/cookie|datenschutz|consent|privacy/.test(t)) {
          el.remove();
          removed++;
        }
      });

      // Restore scroll in case overlay froze body
      document.body.style.overflow = '';
      document.documentElement.style.overflow = '';
      return removed;
    })
    .catch(() => 0);

  return nuked > 0;
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
