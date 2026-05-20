// ──────────────────────────────────────────────────────────────────────────────
// Deaktivieren einer Kleinanzeige (z.B. nach Cross-Platform-Sale)
//
// Selector-Drift ist hier besonders teuer: schlägt der Klick fehl ODER zeigt
// KA stillschweigend keine Bestätigung, läuft Cross-Sync weiter und der Artikel
// bleibt parallel auf zwei Plattformen aktiv → Doppelverkauf. Deshalb prüfen
// wir aktiv: URL-Change auf eine "deactivated"-Page ODER Success-Toast.
// ──────────────────────────────────────────────────────────────────────────────

import type { Page } from 'playwright';
import { createLogger, type DeactivateResult } from '@vinted-system/shared';
import { SEL_AD_DEACTIVATE_BTN, SEL_DEACTIVATED_CONFIRM } from '../selectors.js';

const log = createLogger('ka-listing-deactivate');

const VERIFY_TIMEOUT_MS = 8_000;

export async function deactivateKleinanzeigenListing(
  page: Page,
  externalUrl: string,
): Promise<DeactivateResult> {
  try {
    await page.goto(externalUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });

    const urlBeforeClick = page.url();
    await SEL_AD_DEACTIVATE_BTN.click(page);

    // Verifikation: Entweder URL ändert sich (z.B. /m-meine-anzeigen.html oder
    // ?status=deactivated) ODER ein Success-Toast/Heading erscheint. Wenn keins
    // davon innerhalb VERIFY_TIMEOUT_MS passiert, gilt der Klick als verpufft.
    // Wir akzeptieren jeden Navigations-Wechsel als positives Signal — KA
    // redirected typischerweise auf /m-meine-anzeigen.html oder hängt einen
    // Query-Param dran. Sicherer als auf einen spezifischen Pfad zu warten,
    // falls KA das Routing ändert.
    const urlChanged = page
      .waitForURL(
        (url) => url.toString() !== urlBeforeClick,
        { timeout: VERIFY_TIMEOUT_MS },
      )
      .then(() => 'url' as const)
      .catch(() => null);

    const toastShown = SEL_DEACTIVATED_CONFIRM
      .waitFor(page, { timeout: VERIFY_TIMEOUT_MS })
      .then(() => 'toast' as const)
      .catch(() => null);

    const verdict = await Promise.race([urlChanged, toastShown]);
    if (!verdict) {
      // Beide Promises laufen noch — letzte Chance: kurz warten, dann beide
      // final auswerten (Race kann gewinnen sobald EINS settled, auch null).
      const [u, t] = await Promise.all([urlChanged, toastShown]);
      if (!u && !t) {
        log.warn('Deactivation click had no visible effect', { externalUrl, urlBeforeClick, urlAfter: page.url() });
        return { ok: false, error: 'deactivation not confirmed (no URL change, no toast within 8s)' };
      }
    }

    log.info('Deactivated', { externalUrl, via: verdict ?? 'late-settle' });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
