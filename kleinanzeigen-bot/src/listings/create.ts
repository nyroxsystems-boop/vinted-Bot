// ──────────────────────────────────────────────────────────────────────────────
// Listing-Create Flow für Kleinanzeigen
//
// Nimmt einen ListingDraft und befüllt das KA-Formular. Robuste Selektoren,
// Retry mit Backoff bei Glitches, Auto-Diagnose bei Selektor-Drift.
// ──────────────────────────────────────────────────────────────────────────────

import type { Page, Response } from 'playwright';
import {
  createLogger,
  retry,
  mapCategory,
  markBlocked,
  type ListingDraft,
  type PublishResult,
} from '@vinted-system/shared';
import {
  SEL_NEW_AD_BTN,
  SEL_TITLE_INPUT,
  SEL_DESCRIPTION_TEXTAREA,
  SEL_PRICE_INPUT,
  SEL_PRICE_TYPE_FIXED,
  SEL_PHOTO_INPUT,
  SEL_SHIPPING_TOGGLE,
  SEL_PUBLISH_BTN,
  SEL_PUBLISHED_CONFIRM,
  SEL_CAPTCHA,
  SEL_BLOCKED,
} from '../selectors.js';

const log = createLogger('ka-listing-create');

const HOME_URL = 'https://www.kleinanzeigen.de/';
const KA_BLOCK_COOLDOWN_MIN = 45;

// Rate-Limit-Texte die KA bei Drosselung/Sperrung anzeigt. Lowercased prüfen.
const KA_RATE_LIMIT_PATTERNS: RegExp[] = [
  /zu viele anfragen/i,
  /rate[- ]?limit/i,
  /ihr account wurde tempor[äa]r gesperrt/i,
  /tempor[äa]r gesperrt/i,
  /automatisierte zugriffe/i,
  /too many requests/i,
];

/**
 * Prüft den aktuell geladenen Page-Body auf KA-spezifische Rate-Limit-Texte.
 * Modelliert nach isBotBlocked() in shared/src/browser.ts:367.
 */
async function detectKaRateLimit(page: Page): Promise<{ blocked: boolean; reason?: string }> {
  try {
    const bodyText = await page
      .locator('body')
      .innerText({ timeout: 5000 })
      .catch(() => '');
    const lower = bodyText.toLowerCase();
    for (const pat of KA_RATE_LIMIT_PATTERNS) {
      const m = lower.match(pat);
      if (m) return { blocked: true, reason: `KA_RATE_LIMIT: "${m[0]}"` };
    }
    return { blocked: false };
  } catch {
    return { blocked: false };
  }
}

/**
 * Hängt einen Response-Listener an, der HTTP 429 in beliebigen XHR-Antworten
 * meldet. Gibt eine Detach-Funktion + ein Getter für den ersten Hit zurück.
 */
function attach429Watcher(page: Page): { detach: () => void; getHit: () => string | null } {
  let firstHit: string | null = null;
  const onResponse = (resp: Response): void => {
    if (firstHit) return;
    if (resp.status() === 429) {
      firstHit = `HTTP 429 on ${resp.url().slice(0, 200)}`;
    }
  };
  page.on('response', onResponse);
  return {
    detach: () => page.off('response', onResponse),
    getHit: () => firstHit,
  };
}

function buildKaTitle(draft: ListingDraft): string {
  // KA-Titel max 65 Zeichen + Cleanup. KA's category-auto-suggest fails when
  // the title contains:
  //   - "[Import]" / "[Draft]" prefix (raw CJ artifact)
  //   - "Kleider #N —" enumeration prefix
  //   - Em-dashes "—" or "–"
  //   - "Test #N" suffixes (test-runs)
  //   - Parenthesized color suffixes like "(Sage Green Floral)"
  // We strip these defensively so KA can match against its category tree.
  const cleaned = draft.title
    .replace(/^\[(?:Import|Draft|Test)\]\s*/i, '')
    .replace(/^\w+\s*#\d+\s*[—–-]\s*/, '')
    .replace(/\s*[—–]\s*Test\s*#?\d*\s*$/i, '')
    .replace(/\s*\([^)]*\)\s*$/, '')
    .replace(/[—–]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned.slice(0, 65);
}

function buildKaDescription(draft: ListingDraft): string {
  // Auf KA verkauft sich "alles drin"-Beschreibung besser.
  const lines: string[] = [];
  lines.push(draft.description);
  lines.push('');
  lines.push(`Größe: ${draft.size}`);
  if (draft.colors && draft.colors.length > 0) lines.push(`Farbe: ${draft.colors.join(', ')}`);
  if (draft.material) lines.push(`Material: ${draft.material}`);
  if (draft.brand && draft.brand !== 'Ohne Marke') lines.push(`Marke: ${draft.brand}`);
  lines.push('');
  lines.push('Versand möglich. Privatverkauf — keine Rücknahme/Garantie.');
  return lines.join('\n').slice(0, 4000);
}

export async function createKleinanzeigenListing(
  page: Page,
  draft: ListingDraft,
): Promise<PublishResult> {
  const warnings: string[] = [];

  // XHR 429 sniffer — läuft über die gesamte Sitzung mit. Bei Hit wird nach
  // dem Submit (oder bei jedem Block-Check) ausgewertet.
  const rate429 = attach429Watcher(page);

  try {
    // 1. Home laden, "Anzeige aufgeben" klicken
    await retry(async () => {
      await page.goto(HOME_URL, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      if (await SEL_BLOCKED.exists(page)) throw new Error('blocked');
      if (await SEL_CAPTCHA.exists(page)) throw new Error('captcha');
    }, { attempts: 2, label: 'goto-home', abortIf: (e) => /captcha|blocked/.test(String(e)) });

    if (await SEL_BLOCKED.exists(page)) {
      // Pre-flight: KA zeigt schon vor Submit eine Sperr-Seite — Polling
      // auch hier auto-pausieren statt nur einmaligen Fehler zu melden.
      const pre = await detectKaRateLimit(page);
      const reason = pre.reason ?? 'KA_BLOCKED (pre-flight selector match)';
      markBlocked('kleinanzeigen', reason, KA_BLOCK_COOLDOWN_MIN);
      return {
        ok: false,
        error: `${reason} — KA-Polling pausiert für ${KA_BLOCK_COOLDOWN_MIN} min`,
        blockedBy: 'rate-limit',
      };
    }
    if (await SEL_CAPTCHA.exists(page)) {
      log.warn('Captcha detected on KA home — attempting 2captcha solve');
      const { detectAndSolveCaptcha } = await import('@vinted-system/shared');
      const cap = await detectAndSolveCaptcha(page);
      if (!cap.solved) {
        return { ok: false, error: `captcha: ${cap.error ?? 'unsolved'}`, blockedBy: 'captcha' };
      }
      log.info('Captcha solved on home page');
      await page.waitForTimeout(2000);
    }

    await SEL_NEW_AD_BTN.click(page);
    await page.waitForLoadState('domcontentloaded', { timeout: 20_000 });

    // 2. Titel
    await retry(() => SEL_TITLE_INPUT.fill(page, buildKaTitle(draft)), { attempts: 2, label: 'title' });

    // 3. Kategorie — KA bietet nach dem Titel 3 Suggestion-Radios + "Andere
    //    Kategorie wählen" Link. Auto-Pick wählt oft die FALSCHE Kategorie
    //    (z.B. Damenschuhe statt Kleider). Wir scannen die Labels und klicken
    //    die Suggestion die zu target.path passt.
    const target = mapCategory('kleinanzeigen', draft.category);
    log.info('Target category', { vinted: draft.category, ka: target.path });
    // Suggestions are rendered by an Astro island after title is committed.
    // KA's astro island can take up to 20s under load. Trigger title-blur
    // via JS-eval so the onBlur handler actually fires (Playwright's
    // .blur() is not a locator method).
    await page.evaluate(() => {
      const el = document.querySelector<HTMLInputElement>('#postad-title, input[name="title"]');
      if (el) {
        el.dispatchEvent(new Event('change', { bubbles: true }));
        el.blur();
      }
    }).catch(() => {});
    await page.keyboard.press('Tab').catch(() => null);
    await page.waitForTimeout(1200);
    await page.locator('#ad-category-picker label.group\\/radioLabel').first()
      .waitFor({ state: 'visible', timeout: 20_000 }).catch(() => null);
    try {
      const labels = page.locator('#ad-category-picker label.group\\/radioLabel');
      const count = await labels.count();
      log.info('Category suggestions found', { count });
      let clicked = false;
      // First pass: look for ideal match (Damenbekleidung + Kleider/Röcke)
      for (let i = 0; i < count; i++) {
        const lbl = labels.nth(i);
        const text = (await lbl.innerText().catch(() => '') ?? '').replace(/\s+/g, ' ');
        if (/damenbekleidung/i.test(text) && /kleid|kleider|röcke|rock/i.test(text)) {
          await lbl.click({ force: true });
          log.info('Category suggestion picked', { idx: i, label: text.slice(0, 80) });
          clicked = true;
          break;
        }
      }
      // Second pass: fall back to ANY Damenbekleidung
      if (!clicked) {
        for (let i = 0; i < count; i++) {
          const lbl = labels.nth(i);
          const text = (await lbl.innerText().catch(() => '') ?? '');
          if (/damenbekleidung/i.test(text)) {
            await lbl.click({ force: true });
            log.info('Category suggestion (fallback) picked', { idx: i, label: text.slice(0, 80) });
            clicked = true;
            break;
          }
        }
      }
      // Third pass: if NO suggestions at all (count=0), KA didn't auto-suggest.
      // Open "Andere Kategorie wählen" link → navigate the tree to
      // Mode & Beauty → Damenbekleidung → Röcke & Kleider, then close.
      if (!clicked && count === 0) {
        log.info('No auto-suggestions — opening tree picker');
        // KA renders the tree-link several ways depending on viewport/A-B:
        //   • Pre-pick (no category yet) — GREEN "Wähle deine Kategorie" link
        //   • Post-pick (changing) — "Andere Kategorie wählen" / "Kategorie ändern"
        //   • Mobile A-B — <button data-testid="open-category-picker">
        // Verified live via user screenshot 2026-05-15: pre-pick state shows
        // a green link with text "Wähle deine Kategorie" — must match that.
        const treeLink = page
          .locator([
            '#postad-category-link',
            'a:has-text("Wähle deine Kategorie")',
            'button:has-text("Wähle deine Kategorie")',
            'a:has-text("Andere Kategorie wählen")',
            'a:has-text("Kategorie ändern")',
            'a:has-text("Kategorie wählen")',
            'button:has-text("Andere Kategorie wählen")',
            'button:has-text("Kategorie wählen")',
            '[data-testid*="category" i] a',
            '#ad-category-picker a',
            '#ad-category-picker button',
          ].join(', '))
          .first();
        if (await treeLink.count().then((n) => n > 0).catch(() => false)) {
          await treeLink.evaluate((el) => (el as HTMLElement).click()).catch(() => {});
          await page.waitForTimeout(1500);
          // Tree levels: click "Mode & Beauty" → "Damenbekleidung" → "Röcke & Kleider"
          const path = ['Mode & Beauty', 'Damenbekleidung', 'Röcke & Kleider'];
          let treeOk = true;
          for (const lvl of path) {
            const node = page
              .locator(`button:has-text("${lvl}"), a:has-text("${lvl}"), [role="treeitem"]:has-text("${lvl}")`)
              .first();
            if (await node.count().then((n) => n > 0).catch(() => false)) {
              await node.evaluate((el) => (el as HTMLElement).click()).catch(() => {});
              await page.waitForTimeout(800);
              log.info('Tree-node clicked', { level: lvl });
            } else {
              treeOk = false;
              log.warn('Tree-node not found', { level: lvl });
              break;
            }
          }
          if (treeOk) {
            // Confirm tree-pick if there's a modal with a button
            const confirm = page
              .locator([
                'dialog button:has-text("Übernehmen")',
                'dialog button:has-text("Bestätigen")',
                'dialog button:has-text("Auswählen")',
                '[role="dialog"] button:has-text("Übernehmen")',
              ].join(', '))
              .first();
            if (await confirm.isVisible({ timeout: 1_500 }).catch(() => false)) {
              await confirm.evaluate((el) => (el as HTMLButtonElement).click()).catch(() => {});
              await page.waitForTimeout(800);
            }
            clicked = true;
            log.info('Category picked via tree picker');
          }
        } else {
          log.warn('Tree-picker link not in DOM');
        }
      }
      if (!clicked) {
        warnings.push('category: no suggestion & tree fallback failed');
      }
      await page.waitForTimeout(2500); // let category-specific fields render (shipping, attributes)
    } catch (err) {
      warnings.push(`category-suggestion: ${err instanceof Error ? err.message : String(err)}`);
    }

    // Helper: KA's category-attribute pickers are <button role="combobox">
    // with id like "kleidung_damen.brand". Click opens a listbox/modal with
    // options. After picking, the hidden input attributeMap[<id>] receives
    // the value. Verified DOM via _diag/form-dump-* (2026-05-14).
    async function pickCategoryAttribute(
      attrId: string,
      wantedLabel: string,
      hiddenName: string,
      opts: { typeahead?: boolean } = {},
    ): Promise<{ ok: boolean; error?: string }> {
      try {
        // CSS-escape the dot in "kleidung_damen.brand" for the id selector.
        const escaped = attrId.replace('.', '\\.');
        // Don't constrain to <button> — KA renders some comboboxes as <div>
        // role="combobox" (e.g. brand-typeahead-trigger). Tag-agnostic match.
        const trigger = page.locator(`[id="${attrId}"][role="combobox"], #${escaped}[role="combobox"]`).first();
        const hasTrigger = await trigger.count().then((n) => n > 0).catch(() => false);
        if (!hasTrigger) return { ok: false, error: `trigger #${attrId} not in DOM` };
        await trigger.scrollIntoViewIfNeeded({ timeout: 3_000 }).catch(() => {});
        // KA's wrapper divs intercept Playwright clicks — JS-eval click bypasses.
        await trigger.evaluate((el) => (el as HTMLButtonElement).click()).catch(async () => {
          // Fallback: regular click for elements that don't accept JS-click.
          await trigger.click({ timeout: 5_000, force: true });
        });
        await page.waitForTimeout(700);

        // Typeahead path (brand): listbox is empty until user types. Find the
        // search input that just appeared and fill it with the wanted label.
        if (opts.typeahead) {
          const searchInput = page
            .locator([
              'input[role="combobox"]',
              'input[aria-controls*="listbox" i]',
              'input[type="text"]:visible',
              '[role="dialog"] input[type="text"]',
            ].join(', '))
            .first();
          const hasSearch = await searchInput.count().then((n) => n > 0).catch(() => false);
          if (hasSearch) {
            await searchInput.fill(wantedLabel).catch(() => {});
            await page.waitForTimeout(900); // wait for suggestion list to render
          }
        }

        // Listbox / modal opens — pick option by visible text. KA renders
        // dropdown options in many shapes depending on field type:
        //   • role="option" (ARIA listbox)
        //   • role="menuitem"
        //   • <li> inside [role="listbox"]
        //   • <button> inside a [role="dialog"] or <dialog> (modal sheet)
        //   • plain <li> / <div> with [data-value="..."]
        const optionSelector = [
          `[role="option"]:has-text("${wantedLabel}")`,
          `[role="listbox"] li:has-text("${wantedLabel}")`,
          `[role="menu"] [role="menuitem"]:has-text("${wantedLabel}")`,
          `dialog button:has-text("${wantedLabel}")`,
          `dialog label:has-text("${wantedLabel}")`,
          `dialog li:has-text("${wantedLabel}")`,
          `[role="dialog"] button:has-text("${wantedLabel}")`,
          `[role="dialog"] label:has-text("${wantedLabel}")`,
          `[aria-modal="true"] button:has-text("${wantedLabel}")`,
          `[aria-modal="true"] label:has-text("${wantedLabel}")`,
          `[data-testid*="option" i]:has-text("${wantedLabel}")`,
          `li[data-value]:has-text("${wantedLabel}")`,
        ].join(', ');
        const option = page.locator(optionSelector).first();
        const found = await option.count().then((n) => n > 0).catch(() => false);
        if (!found) {
          // For typeahead: try clicking the first suggestion as fallback.
          if (opts.typeahead) {
            const firstOpt = page.locator('[role="option"], [role="listbox"] li').first();
            if (await firstOpt.count().then((n) => n > 0).catch(() => false)) {
              const label = (await firstOpt.textContent().catch(() => '') ?? '').trim();
              await firstOpt.click({ timeout: 4_000 });
              await page.waitForTimeout(400);
              const hv = await page
                .locator(`input[name="${hiddenName}"]`)
                .first()
                .inputValue()
                .catch(() => '');
              if (hv) return { ok: true, error: `picked first suggestion: ${label}` };
            }
          }
          await page.keyboard.press('Escape').catch(() => {});
          return { ok: false, error: `option "${wantedLabel}" not in listbox` };
        }
        // Click the option. For modal-sheet selectors (dialog/aria-modal), KA
        // shows a green "Bestätigen" button at the bottom that must be clicked
        // to commit the choice — without it the hidden input stays empty.
        // Strategy:
        //   1. Click option. If it's a radio-container, click the inner radio
        //      via JS-eval to feuer React's onChange.
        //   2. Wait 500ms — modal may auto-close (simple dropdown).
        //   3. If a "Bestätigen" / "Speichern" / "Übernehmen" / "OK" button
        //      is still visible in an open dialog, click it to commit.
        await option.evaluate((el) => {
          const container = el as HTMLElement;
          const radio = container.querySelector('input[type="radio"]') as HTMLInputElement | null;
          if (radio) {
            radio.click();
            return;
          }
          (container.querySelector('label') as HTMLLabelElement | null)?.click();
          container.click();
        }).catch(async () => {
          await option.click({ timeout: 4_000 });
        });
        await page.waitForTimeout(600);

        // Modal-confirm pass — many KA pickers (Zustand, Größe-Sheet) require
        // an explicit confirm click after the radio is chosen.
        const confirmBtn = page
          .locator([
            'dialog button:has-text("Bestätigen")',
            'dialog button:has-text("Übernehmen")',
            'dialog button:has-text("Speichern")',
            'dialog button:has-text("Auswählen")',
            'dialog button:has-text("OK")',
            '[role="dialog"] button:has-text("Bestätigen")',
            '[role="dialog"] button:has-text("Übernehmen")',
            '[role="dialog"] button:has-text("Speichern")',
            '[role="dialog"] button:has-text("Auswählen")',
            '[aria-modal="true"] button:has-text("Bestätigen")',
            '[aria-modal="true"] button:has-text("Übernehmen")',
          ].join(', '))
          .first();
        const hasConfirm = await confirmBtn
          .isVisible({ timeout: 800 })
          .catch(() => false);
        if (hasConfirm) {
          await confirmBtn
            .evaluate((el) => (el as HTMLButtonElement).click())
            .catch(async () => {
              await confirmBtn.click({ timeout: 4_000 });
            });
          await page.waitForTimeout(600);
        }

        // Force-close any lingering dialog so subsequent fields aren't blocked.
        await page.evaluate(() => {
          document.querySelectorAll('dialog[open]').forEach((d) => {
            try { (d as HTMLDialogElement).close(); } catch { /* ignore */ }
          });
        }).catch(() => {});

        // Verify the hidden input now has a value.
        const hiddenValue = await page
          .locator(`input[name="${hiddenName}"]`)
          .first()
          .inputValue()
          .catch(() => '');
        if (!hiddenValue) return { ok: false, error: `hidden ${hiddenName} still empty after pick` };
        return { ok: true };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    }

    // 3b. Marke (kleidung_damen.brand) — uses pickCategoryAttribute helper
    // with typeahead mode (brand-combobox is empty until user types).
    //
    // KA mounts category-attribute fields lazily AFTER the category is set,
    // so the brand button isn't in DOM immediately. Wait for it explicitly
    // up to 15s — without this, brand+color+condition all silently fail.
    try {
      await page.waitForSelector('#kleidung_damen\\.brand', { timeout: 15_000, state: 'attached' });
      log.info('Brand attribute mounted, picker starting', { folderNum: draft.folderNum });
    } catch {
      log.warn('Brand attribute did not mount within 15s — proceeding anyway');
    }
    try {
      const wantedBrand = draft.brand && draft.brand !== 'Ohne Marke' && draft.brand !== 'Keine Marke'
        ? draft.brand
        : 'Sonstige Marken';
      const r = await pickCategoryAttribute(
        'kleidung_damen.brand',
        wantedBrand,
        'attributeMap[kleidung_damen.brand]',
        { typeahead: true },
      );
      log.info('Brand pickCategoryAttribute result', { ok: r.ok, error: r.error });
      if (r.ok) {
        log.info('Brand picked', { brand: wantedBrand, note: r.error });
      } else {
        // Fallback to "Sonstige Marken" if specific brand wasn't found.
        const fb = await pickCategoryAttribute(
          'kleidung_damen.brand',
          'Sonstige Marken',
          'attributeMap[kleidung_damen.brand]',
          { typeahead: true },
        );
        log.info('Brand fallback pickCategoryAttribute result', { ok: fb.ok, error: fb.error });
        if (fb.ok) {
          log.info('Brand fallback to "Sonstige Marken"', { note: fb.error });
        } else {
          log.warn('Brand picker FAILED', { primary: r.error, fallback: fb.error });
          warnings.push(`brand: ${r.error}; fallback failed: ${fb.error}`);
        }
      }
    } catch (err) {
      log.warn('Brand picker threw', { err: err instanceof Error ? err.message : String(err) });
      warnings.push(`brand: ${err instanceof Error ? err.message : String(err)}`);
    }

    // [DEBUG] Dump form structure when KA_DUMP_FORM=1 so we can find the
    // actual selectors for Zustand/Farbe/Sofortkauf in this category. Runs
    // BEFORE we try to set those fields, so the dump shows raw post-category
    // state. Output written to _diag/form-dump-<ts>.json.
    if (process.env.KA_DUMP_FORM === '1') {
      try {
        const dump = await page.evaluate(() => {
          const out: Record<string, unknown> = {};
          // All attributeMap inputs/selects (server-known category attrs)
          out.attributeMap = Array.from(document.querySelectorAll('[name^="attributeMap"]')).map((el) => ({
            tag: el.tagName.toLowerCase(),
            id: el.id,
            name: el.getAttribute('name'),
            type: el.getAttribute('type') || '',
            value: (el as HTMLInputElement).value || '',
            options: el.tagName === 'SELECT'
              ? Array.from((el as HTMLSelectElement).options).map((o) => ({ value: o.value, text: o.text }))
              : undefined,
          }));
          out.comboboxes = Array.from(document.querySelectorAll('[role="combobox"]')).map((el) => ({
            id: el.id,
            ariaLabel: el.getAttribute('aria-label') || '',
            label: document.getElementById(((el.getAttribute('aria-labelledby') || '').split(' ')[0] ?? ''))?.textContent?.trim().slice(0, 60) ?? '',
            selectedText: document.getElementById((((el.getAttribute('aria-labelledby') || '').split(' ').slice(-1)[0]) ?? ''))?.textContent?.trim().slice(0, 60) ?? '',
          }));
          // labels with text near "Zustand", "Farbe", "Direkt", "Sofort", "Buy"
          out.labelHits = Array.from(document.querySelectorAll('label, span, div'))
            .filter((el) => /Zustand|Farbe|Direkt kaufen|Sofortkauf|Buy.now/i.test(el.textContent || ''))
            .slice(0, 12)
            .map((el) => ({
              tag: el.tagName.toLowerCase(),
              id: el.id,
              for: el.getAttribute('for') || '',
              text: (el.textContent || '').trim().slice(0, 80),
            }));
          return out;
        });
        const fs = await import('node:fs');
        const ts = new Date().toISOString().replace(/[:.]/g, '-');
        const dir = `_diag/form-dump-${ts}`;
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(`${dir}/form.json`, JSON.stringify(dump, null, 2));
        log.info('Form DOM dump written', { dir });
      } catch (err) {
        log.warn('Form dump failed', { err: err instanceof Error ? err.message : String(err) });
      }
    }

    // 3c. Farbe (kleidung_damen.color) — required.
    // Map raw color (LLM/EN/multi-color) → KA's actual color labels. Multi-color
    // strings ("schwarz-weiß", "pink and blue leopard") are split and we use
    // the FIRST mappable token. KA labels verified live 2026-05-15.
    try {
      const colorMap: Record<string, string> = {
        'grün': 'Grün',  'gruen': 'Grün',  'green': 'Grün',
        'salbei': 'Grün', 'sage': 'Grün', 'mint': 'Grün',
        'olive': 'Grün', 'oliv': 'Grün',
        'blau': 'Blau',   'blue': 'Blau',
        'hellblau': 'Blau', 'dunkelblau': 'Blau', 'light blue': 'Blau', 'navy': 'Blau',
        'türkis': 'Blau', 'turquoise': 'Blau',
        'rot': 'Rot',     'red': 'Rot', 'burgundy': 'Rot',
        'rosa': 'Rosa',   'pink': 'Rosa', 'magenta': 'Rosa',
        'schwarz': 'Schwarz', 'black': 'Schwarz',
        'weiß': 'Weiß',   'weiss': 'Weiß', 'white': 'Weiß',
        'creme': 'Beige', 'cream': 'Beige', 'beige': 'Beige', 'sand': 'Beige',
        'ivory': 'Beige', 'champagner': 'Beige',
        'grau': 'Grau',   'gray': 'Grau', 'grey': 'Grau', 'silber': 'Grau', 'silver': 'Grau',
        'gelb': 'Gelb',   'yellow': 'Gelb',
        'orange': 'Orange', 'peach': 'Orange', 'pfirsich': 'Orange', 'coral': 'Orange',
        'braun': 'Braun', 'brown': 'Braun',
        'lila': 'Lila',   'violett': 'Lila', 'purple': 'Lila', 'lavendel': 'Lila',
      };
      const rawColor = (draft.colors?.[0] ?? '').trim().toLowerCase();
      // Compound color "pink and blue leopard" → split, take first mappable token
      // KA allows ONE color so we pick the dominant one.
      let wantedColor = colorMap[rawColor];
      if (!wantedColor) {
        for (const token of rawColor.split(/[\s\-_/,&]+/)) {
          if (colorMap[token]) { wantedColor = colorMap[token]; break; }
        }
      }
      // If still no match, default to "Bunt" (multi-color) which KA has for floral/pattern.
      if (!wantedColor) wantedColor = 'Bunt';
      log.info('Color mapping', { raw: rawColor, mapped: wantedColor });

      const r = await pickCategoryAttribute(
        'kleidung_damen.color',
        wantedColor,
        'attributeMap[kleidung_damen.color]',
      );
      if (r.ok) {
        log.info('Color picked', { color: wantedColor });
      } else {
        // Fallback chain: try "Sonstige", then "Bunt", then first available
        const fallbacks = ['Sonstige', 'Bunt', 'Mehrfarbig'];
        let picked = false;
        for (const fb of fallbacks) {
          const r2 = await pickCategoryAttribute(
            'kleidung_damen.color',
            fb,
            'attributeMap[kleidung_damen.color]',
          );
          if (r2.ok) {
            log.info('Color fallback picked', { fallback: fb });
            picked = true;
            break;
          }
        }
        if (!picked) {
          // Last resort: open the color combobox, pick first available option
          try {
            const trigger = page.locator('#kleidung_damen\\.color[role="combobox"]').first();
            await trigger.evaluate((el) => (el as HTMLElement).click()).catch(() => {});
            await page.waitForTimeout(800);
            const firstOpt = page
              .locator('[role="option"], [role="listbox"] li, dialog button, dialog label')
              .first();
            if (await firstOpt.count().then((n) => n > 0).catch(() => false)) {
              const txt = (await firstOpt.textContent().catch(() => '') ?? '').trim().slice(0, 40);
              await firstOpt.evaluate((el) => (el as HTMLElement).click()).catch(() => {});
              await page.waitForTimeout(500);
              log.info('Color picked via first-option fallback', { text: txt });
              picked = true;
            }
          } catch { /* */ }
          if (!picked) warnings.push(`color: all fallbacks failed for raw="${rawColor}"`);
        }
      }
    } catch (err) {
      warnings.push(`color: ${err instanceof Error ? err.message : String(err)}`);
    }

    // 3d. Zustand (kleidung_damen.condition) — required.
    // KA renders this as a Button + Modal-Sheet (not role="combobox"), so the
    // combobox helper doesn't reach it directly. The trigger text is
    // "Zustand auswählen"; clicking opens a modal with the condition options.
    try {
      const conditionMap: Record<string, string> = {
        'Neu mit Etikett': 'Neu mit Etikett',
        'Neu':              'Neu mit Etikett',
        'Wie neu':          'Neu ohne Etikett',
        'Neuwertig':        'Neu ohne Etikett',
        'Sehr gut':         'Sehr Gut',
        'Gut':              'Gut',
        'Befriedigend':     'In Ordnung',
        'Akzeptabel':       'In Ordnung',
      };
      const wantedCondition = conditionMap[draft.condition] || 'Sehr Gut';
      log.info('Condition picker starting', { wanted: wantedCondition });
      // KA's condition control: a <div> wrapper labeled "Zustand", inside
      // which there is a smaller clickable showing "Zustand auswählen" plus
      // current selection ("Bitte wählen"). We need the innermost clickable.
      // Strategy: locate the smallest element with text "Zustand auswählen"
      // (likely a <span> inside a <button> or <div role="button">), then
      // climb to its nearest clickable ancestor via JS-eval.
      const trigger = page
        .locator(':is(button, [role="button"], div, span, a):has-text("Zustand auswählen")')
        .filter({ hasNotText: 'Sehr Gut' })
        .last(); // innermost (deepest) match
      const has = await trigger.count().then((n) => n > 0).catch(() => false);
      log.info('Condition trigger found?', { has });
      if (!has) {
        warnings.push('condition: trigger "Zustand auswählen" not in DOM');
      } else {
        await trigger.scrollIntoViewIfNeeded().catch(() => {});
        // JS-eval click on the element itself + propagate up to nearest
        // clickable ancestor if click is swallowed.
        await trigger.evaluate((el) => {
          let target: HTMLElement | null = el as HTMLElement;
          while (target && target !== document.body) {
            const style = getComputedStyle(target);
            const isClickable =
              target.tagName === 'BUTTON' ||
              target.getAttribute('role') === 'button' ||
              style.cursor === 'pointer' ||
              target.onclick !== null;
            if (isClickable) break;
            target = target.parentElement;
          }
          (target ?? el as HTMLElement).click();
        });
        await page.waitForTimeout(2000); // longer wait for modal to mount

        // [DEBUG] Dump everything that's visible after the trigger click so
        // we can see what the modal actually renders.
        const postClickDump = await page.evaluate(() => {
          const out: Record<string, unknown> = {};
          out.dialogs = Array.from(document.querySelectorAll('[role="dialog"], [aria-modal="true"]')).map((el) => ({
            tag: el.tagName.toLowerCase(),
            id: el.id,
            innerText: (el.textContent || '').slice(0, 300),
          }));
          out.newComboboxes = Array.from(document.querySelectorAll('[role="combobox"]')).map((el) => ({
            id: el.id,
            text: (el.textContent || '').slice(0, 80),
          }));
          out.bottomSheets = Array.from(document.querySelectorAll('[class*="sheet" i], [class*="modal" i], [class*="drawer" i], [class*="overlay" i]'))
            .filter((el) => (el.textContent || '').length > 5)
            .slice(0, 5)
            .map((el) => ({
              tag: el.tagName.toLowerCase(),
              classes: el.className.slice(0, 100),
              innerText: (el.textContent || '').slice(0, 200),
            }));
          out.optionsRoleAttr = Array.from(document.querySelectorAll('[role="option"]')).map((el) => (el.textContent || '').trim().slice(0, 40));
          return out;
        });
        log.info('Post-condition-click DOM', postClickDump);
        // Modal-Sheet might use [role="dialog"] or a Tailwind portal.
        // Try a wide selector then narrow.
        // KA renders condition as a native <dialog> with the options as
        // clickable child elements (likely <button> or <li> or <div>).
        const option = page
          .locator([
            `dialog button:has-text("${wantedCondition}")`,
            `dialog [role="button"]:has-text("${wantedCondition}")`,
            `dialog li:has-text("${wantedCondition}")`,
            `dialog div:has-text("${wantedCondition}")`,
            `[role="option"]:has-text("${wantedCondition}")`,
            `[role="dialog"] button:has-text("${wantedCondition}")`,
            `[role="menuitem"]:has-text("${wantedCondition}")`,
            `li:has-text("${wantedCondition}")`,
          ].join(', '))
          .last(); // innermost match — outer ancestors all contain the text
        const found = await option.count().then((n) => n > 0).catch(() => false);
        log.info('Condition option found?', { found, wanted: wantedCondition });
        if (!found) {
          const visibleTexts = await page
            .locator('[role="option"], [role="dialog"] *')
            .allInnerTexts()
            .catch(() => []);
          log.warn('Condition options visible after trigger click', {
            sample: visibleTexts.slice(0, 8),
          });
          await page.keyboard.press('Escape').catch(() => {});
          warnings.push(`condition: option "${wantedCondition}" not in dialog`);
        } else {
          // KA's condition options are RADIO BUTTONS inside containers.
          const picked = await option.evaluate((el, condText) => {
            const container = el as HTMLElement;
            const radio = container.querySelector('input[type="radio"]') as HTMLInputElement | null;
            if (radio) {
              radio.click();
              return { method: 'inner-radio', value: radio.value };
            }
            const label = container.querySelector('label') as HTMLLabelElement | null;
            if (label) {
              label.click();
              return { method: 'inner-label', for: label.getAttribute('for') ?? '' };
            }
            container.click();
            return { method: 'self-click', text: condText };
          }, wantedCondition);
          log.info('Condition radio clicked', picked);
          await page.waitForTimeout(700);

          // Condition modal requires a green "Bestätigen" button click to
          // commit (verified live 2026-05-15). Without this the hidden input
          // attributeMap[kleidung_damen.condition] stays empty.
          const confirmBtn = page
            .locator([
              'dialog button:has-text("Bestätigen")',
              'dialog button:has-text("Übernehmen")',
              'dialog button:has-text("Speichern")',
              'dialog button:has-text("Auswählen")',
              '[role="dialog"] button:has-text("Bestätigen")',
              '[role="dialog"] button:has-text("Übernehmen")',
              '[role="dialog"] button:has-text("Speichern")',
              '[aria-modal="true"] button:has-text("Bestätigen")',
              '[aria-modal="true"] button:has-text("Übernehmen")',
            ].join(', '))
            .first();
          const hasConfirm = await confirmBtn
            .isVisible({ timeout: 1_200 })
            .catch(() => false);
          if (hasConfirm) {
            const btnText = (await confirmBtn.textContent().catch(() => '') ?? '').trim();
            await confirmBtn
              .evaluate((el) => (el as HTMLButtonElement).click())
              .catch(async () => {
                await confirmBtn.click({ timeout: 4_000 });
              });
            log.info('Condition modal Bestätigen clicked', { btn: btnText });
            await page.waitForTimeout(800);
          } else {
            log.info('No Bestätigen button visible — radio may have auto-committed');
          }

          // Force-close any lingering dialog so subsequent fields aren't blocked.
          const dialogStillOpen = await page
            .locator('dialog[open]')
            .count()
            .catch(() => 0);
          if (dialogStillOpen > 0) {
            log.info('Dialog still open — force-closing');
            await page.evaluate(() => {
              document.querySelectorAll('dialog[open]').forEach((d) => {
                try { (d as HTMLDialogElement).close(); } catch { /* ignore */ }
              });
              document
                .querySelectorAll('[data-testid="modal-backdrop"]')
                .forEach((b) => b.parentElement?.removeChild(b));
            });
            await page.waitForTimeout(300);
          }

          // Verify the hidden input was actually set. If not, the Bestätigen
          // click didn't propagate or radio click failed — log it loudly.
          const hv = await page
            .locator('input[name="attributeMap[kleidung_damen.condition]"]')
            .first()
            .inputValue()
            .catch(() => '');
          if (!hv) {
            warnings.push(`condition: hidden input still empty after pick+confirm`);
            log.warn('Condition hidden input empty after Bestätigen', { wanted: wantedCondition });
          } else {
            log.info('Condition picked + committed', { condition: wantedCondition, hiddenValue: hv });
          }
        }
      }
    } catch (err) {
      warnings.push(`condition: ${err instanceof Error ? err.message : String(err)}`);
    }

    // 3e. Direkt kaufen — KA's "Direkt kaufen" feature is a RADIO with the
    // label "Ja, ich möchte die Vorteile von 'Direkt kaufen' kostenlos nutzen".
    // Click the inner radio input via JS so React's onChange fires.
    try {
      const r = await page.evaluate(() => {
        // Find a radio input whose label contains "Direkt kaufen" + "kostenlos".
        const inputs = Array.from(document.querySelectorAll('input[type="radio"]'));
        for (const input of inputs) {
          const label = input.closest('label') ?? document.querySelector(`label[for="${input.id}"]`);
          const text = (label?.textContent ?? '').replace(/\s+/g, ' ');
          if (/Direkt\s*[Kk]aufen.*kostenlos/i.test(text) || /Vorteile.*Direkt/i.test(text)) {
            (input as HTMLInputElement).click();
            return { ok: true, value: (input as HTMLInputElement).value, label: text.slice(0, 80) };
          }
        }
        return { ok: false };
      });
      if (r.ok) log.info('Direkt-kaufen enabled', r);
      else log.info('Direkt-kaufen radio not in DOM — skipped');
    } catch (err) {
      warnings.push(`direkt-kaufen: ${err instanceof Error ? err.message : String(err)}`);
    }

    // 4. Beschreibung
    await retry(() => SEL_DESCRIPTION_TEXTAREA.fill(page, buildKaDescription(draft)), { attempts: 2, label: 'description' });

    // 5. Preis (Festpreis)
    await retry(async () => {
      await SEL_PRICE_INPUT.fill(page, Math.round(draft.priceEur).toString());
      try { await SEL_PRICE_TYPE_FIXED.click(page); } catch { /* optional */ }
    }, { attempts: 2, label: 'price' });

    // 6. Versand aktivieren — three failure modes to handle:
    //   a) Toggle already checked → click would race against wrapper-div
    //      interception → 30s retry timeout. Just skip.
    //   b) Toggle not in DOM at all (e.g. when category selection failed,
    //      the dynamic versand form-section is never mounted). Skip silently
    //      instead of throwing selector-drift.
    //   c) Toggle present + unchecked → normal click path.
    try {
      const handle = await page.locator('#ad-shipping-enabled-yes').first();
      const exists = await handle.count().then((n) => n > 0).catch(() => false);
      if (!exists) {
        warnings.push('shipping-toggle: not in DOM — skipped (form section not mounted)');
      } else {
        const alreadyOn = await handle
          .evaluate((el) => (el as HTMLInputElement).checked)
          .catch(() => false);
        if (!alreadyOn) {
          await SEL_SHIPPING_TOGGLE.click(page);
        }
      }
    } catch (err) {
      warnings.push(`shipping-toggle: ${err instanceof Error ? err.message : String(err)}`);
    }

    // 6b. Versandmethode auswählen — KA's "Direkt kaufen" requires at least
    // one shipping method to be picked from the "Versandmethoden auswählen"
    // modal (verified 2026-05-15 — submit fails silently with this missing).
    // Pick "Hermes S-Paket" by default since it covers most clothing items
    // and matches our default shipping_method config.
    try {
      const versandTrigger = page
        .locator(':is(button, [role="button"]):has-text("Versandmethoden auswählen")')
        .first();
      const has = await versandTrigger.count().then((n) => n > 0).catch(() => false);
      if (has) {
        // Read whether a method is already picked. KA shows "Versandmethoden
        // auswählen" until pick → then it shows the selected method name.
        const triggerText = (await versandTrigger.textContent().catch(() => '') ?? '').trim();
        const alreadyPicked = !/Versandmethoden\s*auswählen/i.test(triggerText);
        if (alreadyPicked) {
          log.info('Versandmethode already picked', { text: triggerText.slice(0, 60) });
        } else {
          log.info('Versandmethode picker opening');
          await versandTrigger.scrollIntoViewIfNeeded({ timeout: 3_000 }).catch(() => {});
          await versandTrigger.evaluate((el) => (el as HTMLButtonElement).click()).catch(async () => {
            await versandTrigger.click({ force: true, timeout: 4_000 });
          });
          await page.waitForTimeout(1_200);
          // Pick Hermes S-Paket (or fall back to first option).
          const wantedMethods = ['Hermes S-Paket', 'Hermes S', 'DHL Paket', 'Hermes Päckchen', 'DHL'];
          let picked = false;
          for (const m of wantedMethods) {
            const opt = page
              .locator([
                `dialog label:has-text("${m}")`,
                `dialog [role="checkbox"]:has-text("${m}")`,
                `dialog input[type="checkbox"][aria-label*="${m}" i]`,
                `[role="dialog"] label:has-text("${m}")`,
              ].join(', '))
              .first();
            if (await opt.count().then((n) => n > 0).catch(() => false)) {
              await opt.evaluate((el) => {
                const container = el as HTMLElement;
                const cb = container.querySelector('input[type="checkbox"]') as HTMLInputElement | null;
                if (cb && !cb.checked) cb.click();
                else container.click();
              }).catch(() => {});
              await page.waitForTimeout(400);
              picked = true;
              log.info('Versandmethode option clicked', { method: m });
              break;
            }
          }
          if (!picked) {
            // Fallback: any first checkbox/label in the dialog.
            const anyOpt = page
              .locator('dialog input[type="checkbox"], [role="dialog"] input[type="checkbox"]')
              .first();
            if (await anyOpt.count().then((n) => n > 0).catch(() => false)) {
              await anyOpt.evaluate((el) => (el as HTMLInputElement).click()).catch(() => {});
              await page.waitForTimeout(400);
              picked = true;
              log.info('Versandmethode fallback (first checkbox) clicked');
            }
          }
          // Confirm the modal (green "Bestätigen" / "Übernehmen").
          const confirm = page
            .locator([
              'dialog button:has-text("Bestätigen")',
              'dialog button:has-text("Übernehmen")',
              'dialog button:has-text("Speichern")',
              '[role="dialog"] button:has-text("Bestätigen")',
            ].join(', '))
            .first();
          if (await confirm.isVisible({ timeout: 1_000 }).catch(() => false)) {
            await confirm.evaluate((el) => (el as HTMLButtonElement).click()).catch(() => {});
            await page.waitForTimeout(800);
            log.info('Versandmethode modal Bestätigen clicked');
          } else {
            await page.keyboard.press('Escape').catch(() => null);
          }
          if (!picked) warnings.push('versand-method: no checkbox found in dialog');
        }
      } else {
        log.info('Versandmethoden trigger not in DOM — skipped (no Direkt-kaufen?)');
      }
    } catch (err) {
      warnings.push(`versand-method: ${err instanceof Error ? err.message : String(err)}`);
    }

    // 7. Fotos hochladen — Pattern aus vinted-bot's uploadPhotos kopiert.
    // Wichtig: NUR setInputFiles, KEIN manuelles dispatchEvent. Wait via
    // blob-img-diff (max 5s/Foto + 10s Puffer).
    if (draft.photos.length > 0) {
      const fsMod = await import('node:fs');
      const filesToUpload = draft.photos
        .filter((p) => {
          try { const s = fsMod.statSync(p); return s.isFile() && s.size > 0; }
          catch { return false; }
        })
        .slice(0, 20);
      log.info('Photo upload starting', { count: filesToUpload.length });
      try {
        // Pattern aus vinted-bot. KA renders uploaded photos as <img> with
        // KA-CDN URL, NOT a blob URL. Wide thumb selector: any image inside
        // the photo-upload form-area (excluding placeholders/icons).
        const THUMB_SEL = [
          'img[src^="blob:"]',
          'img[src*="ebayimg.com"]',           // legacy KA-CDN
          'img[src*="kleinanzeigen.de"][src*="/t/"]',  // KA-thumb CDN
          'img[alt*="Bild" i]',
          'img[alt*="Foto" i]',
          '[class*="image" i] img:not([src*="placeholder"]):not([src*="icon"])',
          '[class*="photo" i] img:not([src*="placeholder"]):not([src*="icon"])',
        ].join(', ');
        const fileInput = page.locator('input[type="file"]').first();
        const attached = await fileInput
          .waitFor({ state: 'attached', timeout: 5_000 })
          .then(() => true).catch(() => false);
        if (!attached) {
          warnings.push('photo-upload: file input not in DOM');
        } else {
          const before = await page.locator(THUMB_SEL).count();
          await fileInput.setInputFiles(filesToUpload);
          log.info('setInputFiles done — waiting for thumbnails', { before });
          const expectedCount = filesToUpload.length;
          const maxWait = expectedCount * 5_000 + 10_000;
          const startTime = Date.now();
          let done = false;
          while (Date.now() - startTime < maxWait) {
            const thumbCount = await page.locator(THUMB_SEL).count();
            if (thumbCount - before >= expectedCount) {
              log.info('All photos uploaded (thumb-diff matches)', { before, after: thumbCount });
              done = true;
              break;
            }
            await page.waitForTimeout(500);
          }
          if (!done) {
            const finalCount = await page.locator(THUMB_SEL).count();
            warnings.push(`photo-upload: only ${finalCount - before}/${expectedCount} previews after ${maxWait}ms`);
            log.warn('Photo upload incomplete', { sent: expectedCount, before, finalCount });
          }
        }
      } catch (err) {
        warnings.push(`photo-upload: ${err instanceof Error ? err.message : String(err)}`);
        log.warn('Photo upload threw', { err: err instanceof Error ? err.message : String(err) });
      }
    } else {
      warnings.push('no photos provided');
    }

    // 8. Veröffentlichen — initial Submit. Scroll to bottom first so the
    // green "Anzeige aufgeben" button (at form end) is in viewport. Then
    // click via JS-eval to bypass any wrapper-overlay interception. We
    // explicitly target buttons INSIDE main so the header link with the
    // same text is skipped.
    //
    // IMPORTANT (verified live 2026-05-15): KA's submit button is rendered
    // as <button type="button"> with text "Anzeige aufgeben", NOT
    // <button type="submit">. Don't constrain by type. The header has an
    // <a href="..."> with the same text — we filter to button/role=button
    // elements inside <main> and skip Vorschau/Entwurf neighbors.
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(800);
    const submitBtn = page.locator([
      'main button:has-text("Anzeige aufgeben")',
      'main [role="button"]:has-text("Anzeige aufgeben")',
      'form button:has-text("Anzeige aufgeben")',
      'button[type="submit"]:has-text("Anzeige aufgeben")',
      'button:has-text("Anzeige aufgeben"):not([type="reset"])',
    ].join(', '))
      .filter({ hasNotText: 'Vorschau' })
      .filter({ hasNotText: 'Entwurf' })
      .last();
    try {
      await submitBtn.scrollIntoViewIfNeeded({ timeout: 3_000 });
      await submitBtn.evaluate((el) => (el as HTMLButtonElement).click());
      log.info('Submit clicked via JS-eval');
    } catch (err) {
      log.warn('JS-eval submit failed, falling back to selector chain', { err: err instanceof Error ? err.message : String(err) });
      await retry(() => SEL_PUBLISH_BTN.click(page), { attempts: 2, label: 'publish' });
    }
    await page.waitForLoadState('domcontentloaded', { timeout: 30_000 });
    await page.waitForTimeout(3_000);

    // 8b. After-Submit Modal handling: KA sometimes shows a confirmation
    // dialog (Terms accept, age verify, payment options). Auto-confirm.
    try {
      const postSubmitModal = await page
        .locator('dialog[open], [role="dialog"]:visible')
        .count();
      if (postSubmitModal > 0) {
        log.info('Post-submit modal detected — attempting auto-confirm');
        const confirmBtn = page.locator([
          'dialog button:has-text("Bestätigen")',
          'dialog button:has-text("Veröffentlichen")',
          'dialog button:has-text("Akzeptieren")',
          'dialog button:has-text("Weiter")',
          'dialog button:has-text("Ja")',
          'dialog button[type="submit"]',
          '[role="dialog"] button:has-text("Bestätigen")',
        ].join(', ')).first();
        if (await confirmBtn.count().then((n) => n > 0).catch(() => false)) {
          const txt = (await confirmBtn.textContent().catch(() => '') ?? '').trim();
          await confirmBtn.evaluate((el) => (el as HTMLElement).click());
          log.info('Post-submit modal confirmed', { btn: txt });
          await page.waitForTimeout(2_000);
        }
      }
    } catch { /* best-effort */ }

    // [DEBUG] Dump what's visible 3s after submit click. Sometimes KA's
    // SPA replaces the main-content via JS without URL change — we need
    // to inspect for hidden modals + section nodes too.
    const postSubmitDump = await page.evaluate(() => ({
      url: location.href,
      title: document.title,
      mainContent: (document.querySelector('main, [class*="main" i] > div')?.textContent || '').slice(0, 200),
      modals: Array.from(document.querySelectorAll('[data-testid*="modal" i], [aria-modal="true"], dialog, [class*="modal" i]'))
        .slice(0, 5)
        .map((el) => ({
          tag: el.tagName.toLowerCase(),
          attrs: el.getAttribute('data-testid') || el.getAttribute('class')?.slice(0, 60) || '',
          isVisible: !!(el as HTMLElement).offsetParent || (el as HTMLDialogElement).open,
          text: (el.textContent || '').replace(/\s+/g, ' ').slice(0, 100),
        })),
      validations: Array.from(document.querySelectorAll('[role="alert"], .web_ui__Validation__validation, [class*="error" i], [class*="invalid" i]'))
        .map((el) => (el.textContent || '').trim())
        .filter((t) => t.length > 0 && t.length < 200)
        .slice(0, 6),
      allInputsVisible: Array.from(document.querySelectorAll('form, fieldset'))
        .map((el) => ({ tag: el.tagName, visible: !!(el as HTMLElement).offsetParent }))
        .slice(0, 5),
      links: Array.from(document.querySelectorAll('a[href]'))
        .map((el) => (el as HTMLAnchorElement).href)
        .filter((h) => h.includes('kleinanzeigen.de') && !h.includes('kontakt') && !h.includes('agb'))
        .slice(0, 10),
    }));
    log.info('Post-submit DOM detailed', postSubmitDump);

    // 8a. 2-Step Submit: KA shows a "Kostenpflichtige Optionen" page after
    // the first submit, where the user picks paid features (Highlight,
    // Top-Anzeige, etc.) OR clicks "Kostenlos einstellen" / "Anzeige
    // veröffentlichen" to publish for free. Without this 2nd click, the
    // listing is saved as a draft and never goes online.
    try {
      const finalPublishBtn = page
        .locator([
          'button:has-text("Kostenlos einstellen")',
          'button:has-text("Kostenlos veröffentlichen")',
          'button:has-text("Anzeige veröffentlichen")',
          'button:has-text("Jetzt veröffentlichen")',
          'button:has-text("Anzeige online stellen")',
          'button:has-text("Online stellen")',
          'button:has-text("Gratis einstellen")',
          'button[type="submit"]:has-text("Veröffentlichen")',
          '[data-testid*="publish-button" i]',
          '[data-testid*="submit-button" i]',
        ].join(', '))
        .first();
      const exists = await finalPublishBtn.count().then((n) => n > 0).catch(() => false);
      if (exists) {
        const btnText = (await finalPublishBtn.textContent().catch(() => '') ?? '').trim();
        log.info('2nd-step publish button found — clicking', { text: btnText });
        await finalPublishBtn.scrollIntoViewIfNeeded().catch(() => {});
        await finalPublishBtn.evaluate((el) => (el as HTMLButtonElement).click());
        await page.waitForLoadState('domcontentloaded', { timeout: 30_000 });
        await page.waitForTimeout(2_000);
      } else {
        log.info('No 2nd-step publish button — single-step KA flow');
      }
    } catch (err) {
      warnings.push(`2nd-step publish: ${err instanceof Error ? err.message : String(err)}`);
    }

    // 8a. Rate-Limit/Block-Detection NACH dem Submit. KA serviert Drosselungs-
    //     Seiten oft erst auf die POST-Antwort, nicht beim Aufruf der Form.
    //     Sowohl Body-Text als auch XHR-Responses prüfen.
    const postBlock = await detectKaRateLimit(page);
    const xhr429 = rate429.getHit();
    if (postBlock.blocked || xhr429) {
      const reason = postBlock.reason ?? xhr429 ?? 'KA_RATE_LIMIT';
      log.error('KA rate-limited after submit', { reason });
      markBlocked('kleinanzeigen', reason, KA_BLOCK_COOLDOWN_MIN);
      return {
        ok: false,
        error: `${reason} — KA-Polling pausiert für ${KA_BLOCK_COOLDOWN_MIN} min`,
        blockedBy: 'rate-limit',
        warnings: warnings.length > 0 ? warnings : undefined,
      };
    }

    // 9. Bestätigung — multiple success signals (any one = success):
    //   • h1 contains "aufgegeben" / "erfolgreich" / "veröffentlicht"
    //   • URL navigated away from /p-anzeige-aufgeben.html (no longer the form)
    //   • URL contains /s-anzeige/ (= live listing page)
    //   • URL contains "bestaetigung" or "/m-meine-anzeigen"
    let externalId: string | undefined;
    let externalUrl: string | undefined;
    // Wait up to 45s for confirmation. KA can be slow when traffic is high
    // and the success page transitions through several intermediate states
    // (uploading photos → review → confirm). 20s was too tight for ~30% of
    // legitimate publishes — bumped to 45s.
    let success = false;
    const deadline = Date.now() + 45_000;
    while (Date.now() < deadline) {
      const url = page.url();
      // URL-based success patterns: s-anzeige/, bestaetigung, meine-anzeigen,
      // or any URL no longer on the multi-step "aufgeben" wizard.
      if (
        url.includes('/s-anzeige/') ||
        url.includes('bestaetigung') ||
        url.includes('/m-meine-anzeigen') ||
        url.includes('/anzeige-erfolgreich') ||
        (!url.includes('/p-anzeige-aufgeben') && !url.includes('/p-anzeige-bearbeiten'))
      ) {
        success = true;
        externalUrl = url;
        // KA's success URL is either:
        //   • /s-anzeige/<slug>/<digits>-... (live ad page)
        //   • /p-anzeige-aufgeben-bestaetigung.html?adId=<digits>&uuid=... (confirmation page)
        // Try both patterns so externalId is always populated.
        const m1 = url.match(/\/s-anzeige\/[^/]+\/(\d+)-/);
        const m2 = url.match(/[?&]adId=(\d+)/);
        if (m1) externalId = m1[1];
        else if (m2) externalId = m2[1];
        break;
      }
      // Headline-based success patterns — KA renders various toasts/modals
      // depending on review queue + account standing.
      try {
        const confirm = await page
          .locator([
            'h1:has-text("aufgegeben")',
            'h1:has-text("erfolgreich")',
            'h1:has-text("veröffentlicht")',
            'h1:has-text("eingestellt")',
            'h2:has-text("erfolgreich aufgegeben")',
            '[role="status"]:has-text("erfolgreich")',
            '.success-message, .alert-success',
            'a[href*="/s-anzeige/"]', // direct deep-link to the new ad
          ].join(', '))
          .first()
          .isVisible({ timeout: 500 });
        if (confirm) {
          success = true;
          externalUrl = url;
          // Try to extract external id from any visible s-anzeige link.
          try {
            const adLink = await page
              .locator('a[href*="/s-anzeige/"]')
              .first()
              .getAttribute('href');
            const m = adLink?.match(/\/s-anzeige\/[^/]+\/(\d+)-/);
            if (m) externalId = m[1];
          } catch { /* best-effort */ }
          break;
        }
      } catch { /* ignore */ }
      await page.waitForTimeout(800);
    }
    if (!success) {
      // Diagnostic dump so we can debug *why* confirmation failed. KA's flow
      // has multiple intermediate states (preview → final-confirm → toast),
      // and we need to see which one we got stuck on.
      const url = page.url();
      const visibleHeadings = await page
        .locator('h1, h2')
        .allInnerTexts()
        .catch(() => []);
      const visibleButtons = await page
        .locator('button:visible, input[type="submit"]:visible')
        .allInnerTexts()
        .catch(() => []);
      log.warn('Confirmation not detected — final page state', {
        url,
        headings: visibleHeadings.slice(0, 5),
        buttons: visibleButtons.slice(0, 8),
      });
      warnings.push(
        `confirmation not detected at url=${url} — headings=${JSON.stringify(visibleHeadings.slice(0, 3))}`,
      );
    }

    return {
      ok: success,
      externalId,
      externalUrl,
      warnings: warnings.length > 0 ? warnings : undefined,
    };
  } catch (err) {
    // Falls der Fehler durch einen 429 ausgelöst wurde, das auch hier melden.
    const xhr429 = rate429.getHit();
    if (xhr429) {
      log.error('KA rate-limited during publish flow', { reason: xhr429 });
      markBlocked('kleinanzeigen', xhr429, KA_BLOCK_COOLDOWN_MIN);
      return {
        ok: false,
        error: `${xhr429} — KA-Polling pausiert für ${KA_BLOCK_COOLDOWN_MIN} min`,
        blockedBy: 'rate-limit',
        warnings,
      };
    }
    if (err instanceof Error && err.name === 'SelectorDriftError') {
      log.error('Selector drift', { err: err.message });
      return { ok: false, error: err.message, blockedBy: 'selector-drift', warnings };
    }
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      blockedBy: 'unknown',
      warnings,
    };
  } finally {
    rate429.detach();
  }
}
