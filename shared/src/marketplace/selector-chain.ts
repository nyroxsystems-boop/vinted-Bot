// ──────────────────────────────────────────────────────────────────────────────
// Robuster Selector mit Fallback-Chain + Auto-Diagnose
//
// Statt brüchiger CSS-Strings:
//   const sel = chain('Accept-Btn',
//     '[data-testid="offer-accept"]',
//     'button[aria-label*="annehmen" i]',
//     'role=button[name=/akzeptier/i]',
//     'text=/annehmen/i'
//   );
//   await sel.click(page);
//
// Bei Fail: schreibt Screenshot + DOM-Snapshot in `_diag/<scope>-<ts>/`,
// mit allen probierten Selektoren + welche matchten/timeouten.
// ──────────────────────────────────────────────────────────────────────────────

import fs from 'node:fs/promises';
import path from 'node:path';
import type { Locator, Page } from 'playwright';
import { createLogger } from '../logger.js';

export interface SelectorAttempt {
  raw: string;
  matched: number;
  visible: number;
  errMsg?: string;
}

export interface SelectorDiagnostic {
  name: string;
  url: string;
  attempts: SelectorAttempt[];
  screenshotPath: string;
  htmlSnippetPath: string;
  timestamp: string;
}

export interface SelectorChainOptions {
  /** Diagnose-Verzeichnis. Default `_diag/` neben CWD. */
  diagDir?: string;
  /** Per-Selektor Timeout (ms). Default 4000. */
  timeoutMs?: number;
  /** Sichtbarkeit erforderlich? Default true. */
  visibleOnly?: boolean;
}

export class SelectorChain {
  private readonly log;

  constructor(
    public readonly name: string,
    private readonly selectors: string[],
    private readonly opts: SelectorChainOptions = {},
  ) {
    if (selectors.length === 0) {
      throw new Error(`SelectorChain ${name}: empty selector list`);
    }
    this.log = createLogger(`selector:${name}`);
  }

  /** Findet die erste matchende Variante. Wirft mit Diagnostik wenn nichts geht. */
  async resolve(page: Page): Promise<Locator> {
    const attempts: SelectorAttempt[] = [];
    for (const raw of this.selectors) {
      try {
        const loc = page.locator(raw).first();
        // count() ist günstig und bricht nicht bei keinem Treffer.
        const matched = await page.locator(raw).count();
        let visible = 0;
        if (matched > 0) {
          try {
            visible = (await loc.isVisible({ timeout: this.opts.timeoutMs ?? 4000 })) ? 1 : 0;
          } catch { /* visibility timeout */ }
        }
        attempts.push({ raw, matched, visible });
        if (matched > 0 && (!this.opts.visibleOnly || visible > 0)) {
          if (attempts.length > 1) {
            this.log.warn('Fallback-Selector matched', { name: this.name, used: raw, fallbackIdx: attempts.length - 1 });
          }
          return loc;
        }
      } catch (err) {
        attempts.push({ raw, matched: 0, visible: 0, errMsg: err instanceof Error ? err.message : String(err) });
      }
    }
    await this.dump(page, attempts);
    const triedSummary = attempts.map((a) => `${a.raw}=${a.matched}`).join(' | ');
    throw new SelectorDriftError(this.name, attempts, `[${this.name}] none matched. Tried: ${triedSummary}`);
  }

  async click(page: Page): Promise<void> {
    const loc = await this.resolve(page);
    await loc.click();
  }

  async fill(page: Page, value: string): Promise<void> {
    const loc = await this.resolve(page);
    await loc.fill(value);
  }

  async type(page: Page, value: string, opts?: { delay?: number }): Promise<void> {
    const loc = await this.resolve(page);
    await loc.fill('');
    await loc.pressSequentially(value, { delay: opts?.delay ?? 30 });
  }

  async waitFor(page: Page, opts?: { timeout?: number; state?: 'visible' | 'attached' }): Promise<void> {
    const loc = await this.resolve(page);
    await loc.waitFor({ state: opts?.state ?? 'visible', timeout: opts?.timeout ?? 10_000 });
  }

  /** Existiert irgendein Treffer? Wirft NICHT — gibt nur boolean zurück. */
  async exists(page: Page): Promise<boolean> {
    for (const raw of this.selectors) {
      try {
        const c = await page.locator(raw).count();
        if (c > 0) return true;
      } catch { /* continue */ }
    }
    return false;
  }

  private async dump(page: Page, attempts: SelectorAttempt[]): Promise<SelectorDiagnostic> {
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const dir = path.join(this.opts.diagDir ?? '_diag', `${this.name}-${ts}`);
    await fs.mkdir(dir, { recursive: true });
    const screenshotPath = path.join(dir, 'screenshot.png');
    const htmlSnippetPath = path.join(dir, 'page.html');
    try {
      await page.screenshot({ path: screenshotPath, fullPage: false });
    } catch { /* ignore */ }
    try {
      const html = await page.content();
      await fs.writeFile(htmlSnippetPath, html.slice(0, 500_000));
    } catch { /* ignore */ }
    const diag: SelectorDiagnostic = {
      name: this.name,
      url: page.url(),
      attempts,
      screenshotPath,
      htmlSnippetPath,
      timestamp: ts,
    };
    await fs.writeFile(path.join(dir, 'diagnostic.json'), JSON.stringify(diag, null, 2));
    this.log.error('Selector-drift detected', { name: this.name, dir });
    return diag;
  }
}

export class SelectorDriftError extends Error {
  constructor(public selectorName: string, public attempts: SelectorAttempt[], message: string) {
    super(message);
    this.name = 'SelectorDriftError';
  }
}

export function chain(name: string, ...selectors: string[]): SelectorChain {
  return new SelectorChain(name, selectors);
}
