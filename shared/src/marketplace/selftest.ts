// ──────────────────────────────────────────────────────────────────────────────
// Selector-Self-Test Framework
//
// Pro Bot: ein Skript ruft `runSelftest({page, marketplace, tests})`. Das
// öffnet jede URL, prüft jede SelectorChain, schreibt Report nach
// _diag/selftest-<marketplace>-<datum>.json + Screenshot pro fehlgeschlagenem
// Test.
//
// Use:
//   import { runSelftest, type SelectorTest } from '@vinted-system/shared';
//
//   const tests: SelectorTest[] = [
//     { name: 'home/avatar',  url: 'https://...', chain: SEL_LOGGED_IN_AVATAR,  required: true },
//     { name: 'sell/title',   url: 'https://.../upload', chain: SEL_TITLE_INPUT, required: true,
//       openModal: async (page) => { await page.click('a[href*="upload"]'); } },
//   ];
//   await runSelftest({ page, marketplace: 'kleinanzeigen', tests, outDir: '_diag' });
// ──────────────────────────────────────────────────────────────────────────────

import fs from 'node:fs/promises';
import path from 'node:path';
import type { Page } from 'playwright';
import { createLogger } from '../logger.js';
import { SelectorChain, type SelectorAttempt } from './selector-chain.js';

const log = createLogger('selftest');

export interface SelectorTest {
  name: string;
  /** Direkte URL die beim Test geöffnet wird. Wenn gesetzt überschreibt baseUrl. */
  url?: string;
  /** Die zu prüfende Selector-Chain. */
  chain: SelectorChain;
  /** Wenn true: Failure macht den ganzen Test als FAIL. */
  required?: boolean;
  /** Optional: vor der Selektorprüfung Modal/Form öffnen (z.B. Sell-Wizard starten). */
  openModal?: (page: Page) => Promise<void>;
  /** Optional: Wartezeit nach goto/openModal vor Selektor-Check. */
  postWaitMs?: number;
}

export interface SelectorTestResult {
  name: string;
  url: string;
  chainName: string;
  matched: boolean;
  attempts: SelectorAttempt[];
  required: boolean;
  durationMs: number;
  error?: string;
  screenshotPath?: string;
}

export interface SelftestReport {
  marketplace: string;
  startedAt: string;
  finishedAt: string;
  totalMs: number;
  results: SelectorTestResult[];
  summary: {
    total: number;
    passed: number;
    failed: number;
    requiredFailed: number;
  };
  /** Wenn true: alle required-Tests passed → Bot ist live-ready. */
  ok: boolean;
  reportPath: string;
}

export interface RunSelftestOptions {
  page: Page;
  marketplace: string;
  tests: SelectorTest[];
  /** Default `_diag` neben CWD. */
  outDir?: string;
  /** Optional: vor jedem Test ausführen (z.B. Login-Check). */
  preEach?: (page: Page) => Promise<void>;
}

async function checkChain(page: Page, chain: SelectorChain): Promise<{ matched: boolean; attempts: SelectorAttempt[]; error?: string }> {
  // Dump-Frei Variant: wir wollen NICHT den Default-Diag-Dump auslösen, nur prüfen.
  // Dafür nutzen wir die exists()-Logik manuell.
  // Trick: chain hat keinen public Zugang zur internen Liste, aber resolve()
  // wirft mit attempts im Error. Wir fangen das.
  try {
    await chain.resolve(page);
    return { matched: true, attempts: [{ raw: '<matched>', matched: 1, visible: 1 }] };
  } catch (err) {
    if (err instanceof Error && err.name === 'SelectorDriftError') {
      const e = err as Error & { attempts?: SelectorAttempt[] };
      return { matched: false, attempts: e.attempts ?? [], error: err.message };
    }
    return { matched: false, attempts: [], error: err instanceof Error ? err.message : String(err) };
  }
}

export async function runSelftest(opts: RunSelftestOptions): Promise<SelftestReport> {
  const startedAt = new Date();
  const ts = startedAt.toISOString().replace(/[:.]/g, '-');
  const outDir = path.resolve(opts.outDir ?? '_diag', `selftest-${opts.marketplace}-${ts}`);
  await fs.mkdir(outDir, { recursive: true });

  log.info('Selftest starting', { marketplace: opts.marketplace, tests: opts.tests.length, outDir });

  const results: SelectorTestResult[] = [];
  for (const t of opts.tests) {
    const t0 = Date.now();
    let url = t.url ?? '';
    let error: string | undefined;
    try {
      if (opts.preEach) await opts.preEach(opts.page);
      if (t.url) await opts.page.goto(t.url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      if (t.openModal) await t.openModal(opts.page);
      if (t.postWaitMs) await opts.page.waitForTimeout(t.postWaitMs);
      url = opts.page.url();
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }

    const check = error
      ? { matched: false, attempts: [] as SelectorAttempt[], error }
      : await checkChain(opts.page, t.chain);

    let screenshotPath: string | undefined;
    if (!check.matched) {
      try {
        const safeName = t.name.replace(/[^a-z0-9_-]/gi, '_');
        const p = path.join(outDir, `${safeName}.png`);
        await opts.page.screenshot({ path: p });
        screenshotPath = p;
      } catch { /* ignore */ }
    }

    results.push({
      name: t.name,
      url,
      chainName: t.chain.name,
      matched: check.matched,
      attempts: check.attempts,
      required: t.required ?? false,
      durationMs: Date.now() - t0,
      error: check.error ?? error,
      screenshotPath,
    });

    log.info(`  [${check.matched ? '✓' : '✗'}] ${t.name}`, {
      chain: t.chain.name,
      attempts: check.attempts.length,
    });
  }

  const finishedAt = new Date();
  const summary = {
    total: results.length,
    passed: results.filter((r) => r.matched).length,
    failed: results.filter((r) => !r.matched).length,
    requiredFailed: results.filter((r) => !r.matched && r.required).length,
  };

  const reportPath = path.join(outDir, 'report.json');
  const report: SelftestReport = {
    marketplace: opts.marketplace,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    totalMs: finishedAt.getTime() - startedAt.getTime(),
    results,
    summary,
    ok: summary.requiredFailed === 0,
    reportPath,
  };
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2));

  // Kompakter Klartext-Bericht daneben
  const txt = [
    `Selftest ${opts.marketplace} — ${startedAt.toISOString()}`,
    `Dauer: ${(report.totalMs / 1000).toFixed(1)}s`,
    `Ergebnis: ${summary.passed}/${summary.total} OK${summary.requiredFailed > 0 ? `  ❌ ${summary.requiredFailed} required failed` : '  ✅ alle required-Tests bestanden'}`,
    '',
    ...results.map((r) => `[${r.matched ? '✓' : '✗'}] ${r.name} (${r.chainName}) ${r.required ? '[REQUIRED]' : ''} — ${r.durationMs}ms${r.error ? ` — ${r.error.slice(0, 100)}` : ''}`),
  ].join('\n');
  await fs.writeFile(path.join(outDir, 'report.txt'), txt);

  log.info('Selftest done', summary);
  return report;
}
