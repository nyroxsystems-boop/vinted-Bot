// ──────────────────────────────────────────────────────────────────────────────
// Vinted Listing Upload Bot
//
// Creates a new Vinted listing via Playwright browser automation:
//   1. Navigate to /items/new
//   2. Upload photos (via file-input, not drag-and-drop)
//   3. Fill in title, description, category, brand, size, condition, color, price
//   4. Submit the form
//   5. Capture the resulting listing URL + item ID
//
// Uses the existing ManagedBrowser + session pattern from vinted-bot/src/browser.ts.
// ──────────────────────────────────────────────────────────────────────────────

import type { Page } from 'playwright';
import { createLogger, dismissOneTrust, isBotBlocked, markBlocked, assertNotBlocked, detectAndSolveCaptcha } from '@vinted-system/shared';
import { getVintedBrowser } from '../browser.js';
import { requireLogin } from '../auth.js';
import { LISTING_SELECTORS } from './selectors.js';
import { varyPhotos } from './photo-variation.js';

const log = createLogger('vinted-listing-create');
const BASE_URL = process.env.VINTED_BASE_URL ?? 'https://www.vinted.de';

// FIX 6: Globaler Rate-Limiter zwischen Listings. Mehrere parallele Auto-
// Publisher-Ticks oder eine Bulk-Start-Batch dürfen NICHT in <60s aufeinander
// listen — Vinted's Anti-Bot misst Listing-Frequenz pro Account und ein
// Sub-60s-Burst löst sofort die Block-Page aus.
let lastListingSubmitAt = 0;
const MIN_GAP_BETWEEN_LISTINGS_MS = 60_000;

async function rateLimitBetweenListings(): Promise<void> {
  const elapsed = Date.now() - lastListingSubmitAt;
  if (elapsed < MIN_GAP_BETWEEN_LISTINGS_MS) {
    const wait = MIN_GAP_BETWEEN_LISTINGS_MS - elapsed + Math.floor(Math.random() * 8000);
    log.info('rate-limit between listings — waiting', { waitMs: wait });
    await new Promise((r) => setTimeout(r, wait));
  }
}

// ── Public types ─────────────────────────────────────────────────────────────

export interface ListingInput {
  title: string;
  description: string;
  category: string;     // e.g. "Damen > Kleider > Minikleider"
  brand: string;        // "Ohne Marke"
  size: string;         // "S" — substring match against "S / 36 / 8"
  condition: string;    // "Sehr gut" | "Neu, mit Etikett" | "Gut" | …
  color: string;        // "Schwarz" — or comma-separated "Schwarz, Weiß" (max 2)
  material?: string;    // "Polyester" (optional, recommended)
  price: number;        // 12.99
  photoPaths: string[]; // absolute paths to image files (3-10)
}

export interface ListingResult {
  ok: boolean;
  vintedUrl?: string;
  vintedItemId?: string;
  error?: string;
}

// ── Main function ────────────────────────────────────────────────────────────

export async function createListing(input: ListingInput, accountId: number): Promise<ListingResult> {
  log.info('Creating Vinted listing', {
    accountId,
    title: input.title,
    photos: input.photoPaths.length,
    price: input.price,
  });

  // FIX 6: Block hier wenn das letzte Listing <60s alt ist (mit Jitter).
  // Failures werden NICHT als "submit" gewertet (siehe Catch-Block), so dass
  // Retry nicht künstlich rate-limited wird.
  await rateLimitBetweenListings();

  const mb = await getVintedBrowser(accountId);
  const page = await mb.context.newPage();

  try {
    // 1. Navigate to Vinted and verify login
    await page.goto(`${BASE_URL}${LISTING_SELECTORS.newListingUrl}`, {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });
    await dismissOneTrust(page).catch(() => null);
    await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => null);

    // Check if we got redirected to login
    if (page.url().includes('/member/signup') || page.url().includes('/login')) {
      await page.close();
      return { ok: false, error: 'Not authenticated — please login first via the dashboard.' };
    }

    // Block-Check VOR allem (Vinted blockt bei Bot-Verdacht mit eigener Seite)
    const blocked = await isBotBlocked(page);
    if (blocked.blocked) {
      log.error('Vinted blocked the session', { reason: blocked.reason });
      markBlocked('vinted', blocked.reason ?? 'page-level block', 45);
      await page.close();
      return {
        ok: false,
        error: `${blocked.reason ?? 'session blocked'} — IP-Cooldown 45min eingetragen. Profil-Reset im Dashboard hilft nur teilweise da Block IP-basiert ist`,
      };
    }

    // CAPTCHA-Check: wenn Vinted h/recaptcha/turnstile zeigt, auto-solve.
    // Bei manual-mode oder fail: 2captcha-Setting auto-pauses paused=true.
    const cap1 = await detectAndSolveCaptcha(page);
    if (cap1.detected && !cap1.solved) {
      log.error('Captcha detected and not solved', cap1);
      await page.close();
      return { ok: false, error: `[captcha] ${cap1.error ?? 'unsolved'}` };
    }
    if (cap1.solved) {
      log.info('Captcha auto-solved on landing page');
      await page.waitForTimeout(1500); // give the page time to validate the token
    }

    // ── Human-like Pausen zwischen Schritten ───────────────────────────────
    // Vinted's Anti-Bot misst u.a. Gleichmäßigkeit der Aktions-Pausen.
    // Jitter = sin(now)-basiert verteilt, +- 30% um den Mittelwert.
    const jitter = (baseMs: number): Promise<void> => {
      const variance = baseMs * 0.6;
      const ms = baseMs - variance / 2 + Math.random() * variance;
      return page.waitForTimeout(Math.round(ms));
    };

    // 2. Upload photos
    await uploadPhotos(page, input.photoPaths);
    await jitter(1500);

    // 3. Fill in the form fields (order matters — category must be chosen
    //    before brand / size / condition / color / material exist in the DOM).
    await fillTitle(page, input.title);
    await jitter(800);
    await fillDescription(page, input.description);
    await jitter(1200);
    await selectCategory(page, input.category);
    await waitForDynamicFields(page);
    await jitter(1500);
    await selectBrand(page, input.brand);
    await jitter(700);
    await selectSize(page, input.size);
    await jitter(700);
    await selectCondition(page, input.condition);
    await jitter(700);
    await selectColor(page, input.color);
    await jitter(700);
    if (input.material) {
      await selectMaterial(page, input.material);
      await jitter(700);
    }
    await fillPrice(page, input.price);

    // Kurzer Sanity-Check: Sind Title/Description/Price wirklich gefüllt?
    // Manchmal swallowed Vinted's React-State unsere Eingaben (focus-loss).
    await page.waitForTimeout(800); // dem Frontend Zeit für Re-Render geben
    const titleVal = await page.locator(LISTING_SELECTORS.titleInput).first().inputValue().catch(() => '');
    const priceVal = await page.locator(LISTING_SELECTORS.priceInput).first().inputValue().catch(() => '');
    log.info('Pre-submit values', { titleVal: titleVal.slice(0, 60), priceVal });
    if (!titleVal) {
      log.warn('Title leer — re-fill vor submit');
      await fillTitle(page, input.title);
    }
    if (!priceVal || priceVal === '0,00 €' || priceVal === '0' || priceVal === '0,00') {
      log.warn('Preis leer — re-fill vor submit');
      await fillPrice(page, input.price);
    }

    // 4. Submit
    const result = await submitListing(page);
    // FIX 6: Stamp the global last-submit timestamp ONLY on success — failures
    // (validation errors, captcha-blocks, network issues) should not penalize
    // the next attempt with a 60s wait.
    if (result.ok) lastListingSubmitAt = Date.now();
    return result;
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    log.error('Listing creation failed', { title: input.title, error });
    return { ok: false, error };
  } finally {
    await page.close().catch(() => null);
  }
}

// ── Step implementations ─────────────────────────────────────────────────────

async function uploadPhotos(page: Page, photoPaths: string[]): Promise<void> {
  // Filter out missing / 0-byte files. setInputFiles will silently fail OR
  // close the browser context if any file is empty.
  const fs = await import('node:fs');
  const validPhotos = photoPaths.filter((p) => {
    try {
      const st = fs.statSync(p);
      return st.isFile() && st.size > 0;
    } catch {
      return false;
    }
  });
  if (validPhotos.length < photoPaths.length) {
    log.warn('Filtered invalid photo paths', {
      total: photoPaths.length,
      valid: validPhotos.length,
      dropped: photoPaths.filter((p) => !validPhotos.includes(p)),
    });
  }
  if (validPhotos.length < 3) {
    throw new Error(`Photo upload failed — only ${validPhotos.length} valid files (need ≥3)`);
  }

  // Vary the photos: random crop per image + random order (flatlay never #1).
  // This makes our profile less monotonous when all listings share the same
  // base template (same mirror, same pose).
  let finalPaths = validPhotos;
  try {
    finalPaths = await varyPhotos(validPhotos);
  } catch (err) {
    log.warn('varyPhotos failed entirely — falling back to originals', {
      err: err instanceof Error ? err.message : String(err),
    });
  }
  log.info('Uploading photos', { count: finalPaths.length });
  photoPaths = finalPaths;

  // ── 1. File-Input finden ──────────────────────────────────────────────────
  // Manche Vinted-Versionen rendern den Input erst NACH einem Klick auf
  // "Fotos hinzufügen". Wenn nichts gefunden, Button klicken und nochmal.
  let fileInput = page.locator(LISTING_SELECTORS.photoFileInput).first();
  let attached = await fileInput.waitFor({ state: 'attached', timeout: 5_000 }).then(() => true).catch(() => false);
  if (!attached) {
    log.info('photo-input not yet present, clicking add-button first');
    try {
      await page.locator(LISTING_SELECTORS.photoAddButton).first().click({ timeout: 5_000 });
      await page.waitForTimeout(800);
    } catch { /* */ }
    fileInput = page.locator(LISTING_SELECTORS.photoFileInput).first();
    attached = await fileInput.waitFor({ state: 'attached', timeout: 8_000 }).then(() => true).catch(() => false);
    if (!attached) throw new Error('Photo upload failed — file input not found');
  }

  // ── 2. Snapshot vor Upload ────────────────────────────────────────────────
  // Manche Selektoren matchen auch Logo/Icon-Bilder (false positives). Wir
  // messen den Diff vor/nach Upload statt absolute Counts.
  const before = await page.locator(LISTING_SELECTORS.uploadedPhotoThumb).count();

  // ── 3. setInputFiles ──────────────────────────────────────────────────────
  await fileInput.setInputFiles(photoPaths);
  log.info('setInputFiles done — waiting for thumbnails', { before });

  // ── 4. Warten auf Upload ──────────────────────────────────────────────────
  // Strategie: warte bis EINER der Indikatoren matched:
  //   a) Thumb-Count ist um ≥ photoPaths.length gestiegen
  //   b) Mind. 1 blob:-Image taucht auf (= Browser hat Datei akzeptiert)
  //   c) Upload-Progress-Bars verschwunden NACH sie aufgetaucht waren
  const expectedCount = photoPaths.length;
  const maxWait = expectedCount * 5_000 + 10_000; // 5s pro Foto + 10s Puffer
  const startTime = Date.now();
  let lastSeen = before;
  let everSawProgress = false;

  while (Date.now() - startTime < maxWait) {
    const thumbCount = await page.locator(LISTING_SELECTORS.uploadedPhotoThumb).count();
    const blobCount = await page.locator('img[src^="blob:"]').count();
    const progressCount = await page.locator(LISTING_SELECTORS.uploadInProgress).count();
    if (progressCount > 0) everSawProgress = true;

    // a) genug neue Thumbs erschienen
    if (thumbCount - before >= expectedCount) {
      log.info('All photos uploaded (thumb-diff matches)', { before, after: thumbCount });
      return;
    }
    // b) blob-Images erschienen UND Progress-Bar (falls je sichtbar) ist weg
    if (blobCount > 0 && (!everSawProgress || progressCount === 0)) {
      // Noch 1.5s Puffer für Vinted-Internal-Ack
      await page.waitForTimeout(1500);
      const finalThumbs = await page.locator(LISTING_SELECTORS.uploadedPhotoThumb).count();
      log.info('Photos appear uploaded (blob preview ready)', { blobCount, finalThumbs });
      return;
    }
    if (thumbCount > lastSeen) {
      log.debug('thumb-count rising', { now: thumbCount, before });
      lastSeen = thumbCount;
    }
    await page.waitForTimeout(500);
  }

  // ── 5. Final-Check + Diagnose-Dump ────────────────────────────────────────
  const finalThumbs = await page.locator(LISTING_SELECTORS.uploadedPhotoThumb).count();
  const finalBlobs = await page.locator('img[src^="blob:"]').count();
  if (finalThumbs - before > 0 || finalBlobs > 0) {
    log.warn('Partial photo upload — proceeding anyway', {
      expected: expectedCount, before, after: finalThumbs, blobs: finalBlobs,
    });
    return;
  }

  // Gar nichts hochgeladen — Diagnose dumpen
  try {
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const dir = `_diag/photo-upload-fail-${ts}`;
    const fs = await import('node:fs/promises');
    await fs.mkdir(dir, { recursive: true });
    await page.screenshot({ path: `${dir}/screenshot.png`, fullPage: true });
    const html = await page.content();
    await fs.writeFile(`${dir}/page.html`, html.slice(0, 500_000));
    const inputs = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('input[type="file"]')).map((el) => ({
        accept: (el as HTMLInputElement).accept,
        multiple: (el as HTMLInputElement).multiple,
        name: (el as HTMLInputElement).name,
        id: (el as HTMLInputElement).id,
        outerHTML: (el as HTMLInputElement).outerHTML.slice(0, 500),
      }));
    });
    await fs.writeFile(`${dir}/file-inputs.json`, JSON.stringify(inputs, null, 2));
    log.error('Photo upload diagnostic dumped', { dir });
  } catch (err) {
    log.warn('Could not dump diagnostic', { err: String(err) });
  }

  throw new Error('Photo upload failed — no thumbnails appeared (check _diag/photo-upload-fail-*)');
}

// Vinted rejects titles with emojis ("Überschrift darf keine Sonderzeichen
// wie ✨ enthalten"). LLM-variants for Vinted sometimes include 🌸/✨/💖 —
// strip everything outside German letters/digits/punctuation before fill.
function stripVintedDisallowed(title: string): string {
  return title
    // Drop emoji ranges (extended + symbols + dingbats + flags + pictographic)
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{1F1E6}-\u{1F1FF}\u{2300}-\u{23FF}\u{2B00}-\u{2BFF}]/gu, '')
    // Variation selectors and zero-width joiners that survive after emoji strip
    .replace(/[\u{FE0F}\u{200D}]/gu, '')
    // Collapse leftover whitespace
    .replace(/\s+/g, ' ')
    .trim();
}

async function fillTitle(page: Page, title: string): Promise<void> {
  const input = page.locator(LISTING_SELECTORS.titleInput).first();
  await input.waitFor({ state: 'visible', timeout: 5_000 });
  const clean = stripVintedDisallowed(title);
  await input.clear();
  await input.fill(clean);
  if (clean !== title) log.info('Title sanitized', { original: title, clean });
  log.info('Title filled', { title: clean });
}

async function fillDescription(page: Page, description: string): Promise<void> {
  const textarea = page.locator(LISTING_SELECTORS.descriptionInput).first();
  await textarea.waitFor({ state: 'visible', timeout: 5_000 });
  await textarea.clear();
  await textarea.fill(description);
  log.info('Description filled', { chars: description.length });
}

async function selectCategory(page: Page, categoryPath: string): Promise<void> {
  // Strategy: open category dropdown → use the SEARCH input ("Finde eine
  // Kategorie") with the LEAF name (e.g. "Sommerkleider") → click the first
  // matching result. This avoids cascade-click brittleness and mirrors what
  // a user does: type a few letters, pick first suggestion.
  const levels = categoryPath.split('>').map((s) => s.trim());
  const leaf = levels[levels.length - 1];

  const catButton = page.locator(LISTING_SELECTORS.categoryButton).first();
  await catButton.waitFor({ state: 'visible', timeout: 5_000 });
  await catButton.click({ force: true });
  await page.waitForTimeout(1500);

  // ── Click first NLP suggestion in the open popup ────────────────────────
  // Vinted analyzes title+description and shows ~3 best-match leaf categories
  // under "Vorgeschlagen" BEFORE the user types. The first one is the
  // strongest match. User: "einfach das erste immer". Verified 2026-05-12.
  // Each suggestion has id="catalog-suggestion-{catalogId}" wrapping a radio.
  const firstSuggestion = page.locator(
    '.input-dropdown__content [id^="catalog-suggestion-"]'
  ).first();
  const suggestionVisible = await firstSuggestion.isVisible({ timeout: 3_000 }).catch(() => false);
  if (suggestionVisible) {
    // Capture title text for log
    const sTitle = await firstSuggestion.locator('.web_ui__Cell__title').first().textContent().catch(() => '?');
    await firstSuggestion.click({ force: true }).catch((e) =>
      log.warn('First-suggestion click failed', { err: String(e).slice(0, 100) })
    );
    await page.waitForTimeout(1000);
    const after = await catButton.inputValue().catch(() => '');
    if (after) {
      log.info('Category selected via first suggestion', { picked: sTitle, actualValue: after });
      return;
    }
    log.warn('Clicked first suggestion but category input still empty', { picked: sTitle });
  } else {
    log.warn('No suggestion items visible in popup');
  }

  // ── 2. Cascade fallback ──────────────────────────────────────────────────
  log.info('Falling back to cascade click', { levels });
  // If we got here the popup is in some state — close + reopen for sanity
  await page.keyboard.press('Escape').catch(() => null);
  await page.waitForTimeout(300);
  await catButton.click({ force: true });
  await page.waitForTimeout(700);

  for (let i = 0; i < levels.length; i++) {
    const level = levels[i];
    if (!level) continue;
    const option = page.locator(LISTING_SELECTORS.categoryOption(level)).first();
    try {
      await option.waitFor({ state: 'visible', timeout: 5_000 });
      await option.click({ force: true });
      await page.waitForTimeout(600);
    } catch {
      const fallback = page.getByText(level, { exact: false }).first();
      await fallback.click({ force: true, timeout: 3000 }).catch(() => log.warn('Cascade level skipped', { level }));
      await page.waitForTimeout(600);
    }
  }

  const catVal = await catButton.inputValue().catch(() => '');
  log.info('Category selected (cascade)', { categoryPath, actualValue: catVal });
  if (!catVal) log.warn('Category input still empty after cascade');
}

/**
 * After the category cascade completes, Vinted lazy-mounts the attribute
 * dropdowns (Marke / Größe / Zustand / Farbe / Material). Wait for at
 * least one of them to appear before trying to fill them.
 */
async function waitForDynamicFields(page: Page): Promise<void> {
  const markerSelector = LISTING_SELECTORS.brandTrigger;
  try {
    await page.locator(markerSelector).first().waitFor({ state: 'visible', timeout: 10_000 });
    log.info('Dynamic fields mounted');
  } catch {
    log.warn('Dynamic fields did not appear within 10s — continuing anyway');
  }
}

/**
 * Open a dropdown by clicking its placeholder trigger.
 * Vinted renders the trigger as a readonly-ish row with the placeholder
 * text visible; clicking opens an overlay with the selectable options.
 */
async function openDropdown(page: Page, triggerSelector: string, label: string): Promise<boolean> {
  const trigger = page.locator(triggerSelector).first();
  try {
    await trigger.waitFor({ state: 'visible', timeout: 5_000 });
    await trigger.click({ timeout: 3_000 });
    await page.waitForTimeout(400);
    return true;
  } catch {
    log.warn(`${label} trigger not found`);
    return false;
  }
}

/**
 * Generic dropdown picker. Trigger = the placeholder input. After opening
 * we look INSIDE .input-dropdown__content (the popup) and either:
 *   • click the first item (pickFirst=true)
 *   • OR click a Cell whose title text matches `text`
 * Then we verify the trigger input's value changed (popup closed and value
 * was committed). Returns true on success.
 */
async function pickInDropdown(
  page: Page,
  triggerSelector: string,
  label: string,
  opts: { text?: string; pickFirst?: boolean; multi?: boolean } = {},
): Promise<boolean> {
  const trigger = page.locator(triggerSelector).first();
  try {
    await trigger.scrollIntoViewIfNeeded({ timeout: 3_000 }).catch(() => null);
    await trigger.waitFor({ state: 'visible', timeout: 5_000 });
    await trigger.click({ force: true });
  } catch {
    log.warn(`${label} trigger not found`);
    return false;
  }
  await page.waitForTimeout(800);

  let target;
  if (opts.pickFirst) {
    target = page.locator(
      '.input-dropdown__content li .web_ui__Cell__content, .input-dropdown__content [id^="catalog-suggestion-"], .input-dropdown__content li .web_ui__Radio__radio, .input-dropdown__content li .web_ui__Checkbox__checkbox'
    ).first();
  } else if (opts.text) {
    // Match a Cell title via XPath — exact text match inside .input-dropdown
    target = page.locator(
      `.input-dropdown__content li:has(.web_ui__Cell__title:text-is("${opts.text}"))`
    ).first();
  } else {
    log.warn(`${label}: neither pickFirst nor text given`);
    return false;
  }

  const found = await target.isVisible({ timeout: 3_000 }).catch(() => false);
  if (!found) {
    log.warn(`${label} option not visible`, { text: opts.text });
    await page.keyboard.press('Escape').catch(() => null);
    return false;
  }
  await target.click({ force: true }).catch(() => log.warn(`${label} option click failed`));
  await page.waitForTimeout(500);

  // Multi-select dropdowns (Color) need an explicit close
  if (opts.multi) {
    const done = page.locator(LISTING_SELECTORS.colorMultiSelectDone).first();
    if (await done.isVisible({ timeout: 1_000 }).catch(() => false)) {
      await done.click();
    } else {
      await page.keyboard.press('Escape').catch(() => null);
    }
    await page.waitForTimeout(400);
  }

  // Click outside to ensure popup closed (also useful for radio dropdowns)
  await page.keyboard.press('Escape').catch(() => null);
  await page.waitForTimeout(300);

  // Verify value committed
  const val = await trigger.inputValue().catch(() => '');
  if (val) {
    log.info(`${label} selected`, { text: opts.text ?? '<first>', actualValue: val });
    return true;
  }
  log.warn(`${label} input still empty after pick`, { text: opts.text });
  return false;
}

async function selectBrand(page: Page, brand: string): Promise<void> {
  const target = brand?.trim() || 'Ohne Marke';
  const trigger = page.locator(LISTING_SELECTORS.brandTrigger).first();
  try {
    await trigger.scrollIntoViewIfNeeded({ timeout: 3_000 }).catch(() => null);
    await trigger.waitFor({ state: 'visible', timeout: 5_000 });
    await trigger.click({ force: true });
  } catch {
    log.warn('Brand trigger not found');
    return;
  }
  await page.waitForTimeout(1000);

  // Brand popup ALWAYS contains "Ohne Marke" as a permanent option (at the
  // top under "Ergebnisse" after typing). Type to filter, then click the
  // exact-text match.
  const inputs = page.locator('.input-dropdown__content input');
  const inputCount = await inputs.count().catch(() => 0);
  if (inputCount > 0) {
    await inputs.first().fill(target).catch(() => null);
    await page.waitForTimeout(900);
  }

  // Try several strategies to find the target row.
  // Vinted does NOT have "Ohne Marke" as a real brand — it offers a
  // "{target} als Markenname nutzen" custom-brand option via #custom-select-brand.
  const strategies = [
    '#custom-select-brand',                                                          // ← custom-brand button (works for "Ohne Marke" + any other text)
    `.input-dropdown__content li:has(.web_ui__Cell__title:text-is("${target}"))`,
    `.input-dropdown__content li:has(.web_ui__Cell__title:has-text("${target}"))`,
    `.input-dropdown__content [aria-labelledby*="brand"]:has-text("${target}")`,
    `.input-dropdown__content :text-is("${target}")`,
  ];

  let clicked = false;
  for (const sel of strategies) {
    const loc = page.locator(sel).first();
    if (await loc.isVisible({ timeout: 1_500 }).catch(() => false)) {
      await loc.click({ force: true }).catch(() => null);
      await page.waitForTimeout(500);
      clicked = true;
      break;
    }
  }

  if (!clicked) {
    // Final fallback: dump popup state for diag, then pick first visible cell
    try {
      const fs = await import('node:fs/promises');
      const ts = new Date().toISOString().replace(/[:.]/g, '-');
      const dir = `_diag/brand-popup-${ts}`;
      await fs.mkdir(dir, { recursive: true });
      const popupHTML = await page.locator('.input-dropdown__content').first().innerHTML().catch(() => '');
      await fs.writeFile(`${dir}/popup.html`, popupHTML);
      log.warn('Brand: no target found, dumped popup', { dir, target });
    } catch { /* */ }
    const first = page.locator('.input-dropdown__content li .web_ui__Cell__title').first();
    if (await first.isVisible({ timeout: 1_500 }).catch(() => false)) {
      await first.click({ force: true });
      await page.waitForTimeout(500);
    }
  }
  await page.keyboard.press('Escape').catch(() => null);
  await page.waitForTimeout(300);
  const val = await trigger.inputValue().catch(() => '');
  if (val) log.info('Brand selected', { target, actualValue: val });
  else log.warn('Brand still empty after pick', { target });
}

async function selectCondition(page: Page, condition: string): Promise<void> {
  await pickInDropdown(page, LISTING_SELECTORS.conditionButton, 'Condition', { text: condition });
}

// EN/raw → Vinted-DE color names. CJ-imports + LLM-variants spit out
// lowercase english ("grey", "pink purple", "yellow floral") but Vinted-DE
// only lists capitalized German labels in its dropdown. Map aggressively
// then fall through to substring match in pickColorWithFallback.
const COLOR_MAP_DE: Record<string, string> = {
  // Greys
  'grau': 'Grau', 'gray': 'Grau', 'grey': 'Grau', 'silber': 'Grau',
  'silver': 'Grau', 'hellgrau': 'Grau', 'dunkelgrau': 'Grau',
  // Blacks
  'schwarz': 'Schwarz', 'black': 'Schwarz',
  // Whites
  'weiß': 'Weiß', 'weiss': 'Weiß', 'white': 'Weiß',
  // Blues
  'blau': 'Blau', 'blue': 'Blau', 'hellblau': 'Blau',
  'dunkelblau': 'Blau', 'navy': 'Blau', 'royal': 'Blau',
  // Greens
  'grün': 'Grün', 'gruen': 'Grün', 'green': 'Grün',
  'olivgrün': 'Grün', 'mintgrün': 'Grün', 'salbei': 'Grün',
  'sage': 'Grün', 'olive': 'Grün', 'oliv': 'Grün',
  // Reds
  'rot': 'Rot', 'red': 'Rot', 'dunkelrot': 'Rot', 'burgundy': 'Rot',
  // Pinks
  'rosa': 'Rosa', 'pink': 'Rosa', 'hellrosa': 'Rosa',
  // Purples
  'lila': 'Lila', 'violett': 'Lila', 'purple': 'Lila',
  // Yellows
  'gelb': 'Gelb', 'yellow': 'Gelb', 'goldgelb': 'Gelb',
  // Orange
  'orange': 'Orange',
  // Browns
  'braun': 'Braun', 'brown': 'Braun', 'dunkelbraun': 'Braun',
  // Beige
  'beige': 'Beige', 'creme': 'Beige', 'cream': 'Beige',
  'sand': 'Beige', 'ivory': 'Beige', 'champagner': 'Beige',
  // Khaki
  'khaki': 'Khaki', 'kaki': 'Khaki',
  // Gold/Silver are own categories on Vinted
  'gold': 'Gold',
  // Peach/Coral/Mint/Turkis — Vinted has no direct match, map to closest
  'peach': 'Orange', 'pfirsich': 'Orange', 'coral': 'Orange', 'koralle': 'Orange',
  'mint': 'Grün',
  'türkis': 'Blau', 'turquoise': 'Blau', 'turkis': 'Blau',
  'apricot': 'Orange', 'apricose': 'Orange',
  'lavender': 'Lila', 'lavendel': 'Lila',
  'magenta': 'Lila', 'plum': 'Lila',
  // Multi/Print
  'mehrfarbig': 'Mehrfarbig', 'multicolor': 'Mehrfarbig',
  'bunt': 'Mehrfarbig', 'floral': 'Mehrfarbig', 'blumen': 'Mehrfarbig',
  'pattern': 'Mehrfarbig', 'print': 'Mehrfarbig', 'gemustert': 'Mehrfarbig',
  'ikat': 'Mehrfarbig', 'zebra': 'Mehrfarbig', 'leopard': 'Mehrfarbig',
  'paisley': 'Mehrfarbig', 'animal': 'Mehrfarbig',
};

function mapColorToVintedDe(raw: string): string | null {
  const lower = raw.trim().toLowerCase();
  if (!lower) return null;
  // Exact match first
  if (COLOR_MAP_DE[lower]) return COLOR_MAP_DE[lower];
  // Compound color "pink purple" → take first token that maps
  for (const token of lower.split(/[\s\-_/,]+/)) {
    if (COLOR_MAP_DE[token]) return COLOR_MAP_DE[token];
  }
  return null;
}

async function selectColor(page: Page, color: string): Promise<void> {
  const first = color.split(',').map((c) => c.trim()).filter(Boolean)[0];
  if (!first) return;
  const mapped = mapColorToVintedDe(first);
  const candidates = mapped
    ? [mapped, first.charAt(0).toUpperCase() + first.slice(1).toLowerCase()]
    : [first.charAt(0).toUpperCase() + first.slice(1).toLowerCase()];

  // Color picker is a MULTI-SELECT CHECKBOX list (NOT a normal dropdown).
  // pickInDropdown's Cell__title selector doesn't match — checkbox rows use
  // <label> / [role="checkbox"]. Open trigger, then probe candidates with
  // the dedicated colorOption() selector.
  const trigger = page.locator(LISTING_SELECTORS.colorButton).first();
  try {
    await trigger.scrollIntoViewIfNeeded({ timeout: 3_000 }).catch(() => null);
    await trigger.waitFor({ state: 'visible', timeout: 5_000 });
    await trigger.click({ force: true });
  } catch {
    log.warn('Color trigger not found');
    return;
  }
  await page.waitForTimeout(800);

  let picked: string | null = null;
  for (const candidate of candidates) {
    // Build the candidate selectors. Prefer exact-text match in checkbox
    // labels — case-insensitive (i flag in :text-matches). Vinted uses
    // capitalized German color names ("Rosa", "Schwarz", "Khaki").
    const exact = page.locator(
      [
        `label.web_ui__Cell__cell:has-text("${candidate}")`,
        `label:has(input[type="checkbox"]):has-text("${candidate}")`,
        `[role="checkbox"]:has-text("${candidate}")`,
        `[role="option"]:has-text("${candidate}")`,
        `.web_ui__Cell__title:text-matches("^\\\\s*${candidate}\\\\s*$", "i")`,
      ].join(', ')
    ).first();
    // count() rather than isVisible — option may be below the fold.
    const exists = await exact.count().then((n) => n > 0).catch(() => false);
    if (exists) {
      await exact.scrollIntoViewIfNeeded({ timeout: 2_000 }).catch(() => null);
      await exact.click({ force: true, timeout: 3_000 }).catch(() => null);
      await page.waitForTimeout(400);
      picked = candidate;
      log.info('Color selected', { raw: first, picked: candidate });
      break;
    }
  }

  // Close the multi-select overlay (Fertig button or Escape).
  const done = page.locator(LISTING_SELECTORS.colorMultiSelectDone).first();
  if (await done.isVisible({ timeout: 1_000 }).catch(() => false)) {
    await done.click({ force: true }).catch(() => null);
  } else {
    await page.keyboard.press('Escape').catch(() => null);
  }
  await page.waitForTimeout(500);

  if (!picked) {
    // Last-resort: dump dropdown HTML so we can debug next time.
    try {
      const fs = await import('node:fs/promises');
      const ts = new Date().toISOString().replace(/[:.]/g, '-');
      const dir = `_diag/color-picker-${ts}`;
      await fs.mkdir(dir, { recursive: true });
      await trigger.click({ force: true }).catch(() => null);
      await page.waitForTimeout(500);
      const popupHTML = await page
        .locator('[role="dialog"], .web_ui__Dropdown__dropdown, .input-dropdown__content')
        .first().innerHTML().catch(() => '');
      await fs.writeFile(`${dir}/popup.html`, popupHTML.slice(0, 50_000));
      log.warn('Color picker: dumped popup for debug', { dir, raw: first, mapped, candidates });
      await page.keyboard.press('Escape').catch(() => null);
    } catch { /* */ }
  }
}

async function selectSize(page: Page, size: string): Promise<void> {
  // Size options are like "S / 36 / 8" — :text-is("S") wouldn't match.
  // Use a contains-text picker by inlining a different target selector.
  const trigger = page.locator(LISTING_SELECTORS.sizeButton).first();
  try {
    await trigger.scrollIntoViewIfNeeded({ timeout: 3_000 }).catch(() => null);
    await trigger.waitFor({ state: 'visible', timeout: 5_000 });
    await trigger.click({ force: true });
  } catch {
    log.warn('Size trigger not found');
    return;
  }
  await page.waitForTimeout(800);

  // Match a Cell title containing the size (e.g. "S / 36 / 8")
  const target = page.locator(
    `.input-dropdown__content li:has(.web_ui__Cell__title:text-matches("(^|\\\\s|/)${size}(\\\\s|/|$)"))`
  ).first();
  const found = await target.isVisible({ timeout: 3_000 }).catch(() => false);
  if (!found) {
    log.warn('Size option not visible', { size });
    await page.keyboard.press('Escape').catch(() => null);
    return;
  }
  await target.click({ force: true });
  await page.waitForTimeout(500);
  await page.keyboard.press('Escape').catch(() => null);
  await page.waitForTimeout(300);
  const val = await trigger.inputValue().catch(() => '');
  if (val) log.info('Size selected', { size, actualValue: val });
  else log.warn('Size still empty after pick', { size });
}

async function selectMaterial(page: Page, material: string): Promise<void> {
  await pickInDropdown(page, LISTING_SELECTORS.materialButton, 'Material', { text: material });
}

async function fillPrice(page: Page, price: number): Promise<void> {
  const input = page.locator(LISTING_SELECTORS.priceInput).first();
  await input.waitFor({ state: 'visible', timeout: 5_000 });
  await input.clear();
  // Vinted uses comma as decimal separator in DE
  const priceStr = price.toFixed(2).replace('.', ',');
  await input.fill(priceStr);
  log.info('Price set', { price, priceStr });
}

async function dumpSubmitDiagnostic(page: Page, label: string): Promise<string> {
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const dir = `_diag/submit-${label}-${ts}`;
  try {
    const fs = await import('node:fs/promises');
    await fs.mkdir(dir, { recursive: true });
    await page.screenshot({ path: `${dir}/screenshot.png`, fullPage: true });
    const html = await page.content();
    await fs.writeFile(`${dir}/page.html`, html.slice(0, 500_000));

    // Sammle ALLE plausibel error-artigen Elemente mit ihrem sichtbaren Text
    const errs = await page.evaluate(() => {
      const sel = [
        '[data-testid$="-error"]',
        '[data-testid="form-error"]',
        '[data-testid="error-message"]',
        '[class*="ValidationError" i]',
        '[class*="FormError" i]',
        '[class*="field-error" i]',
        '[class*="InputError" i]',
        '[role="alert"]',
        '[aria-invalid="true"]',
        'label[class*="error" i]',
      ];
      const found: Array<{ sel: string; text: string; html: string }> = [];
      for (const s of sel) {
        document.querySelectorAll(s).forEach((el) => {
          const text = (el as HTMLElement).innerText?.trim() ?? '';
          if (text) found.push({ sel: s, text: text.slice(0, 200), html: el.outerHTML.slice(0, 300) });
        });
      }
      return found;
    });
    await fs.writeFile(`${dir}/errors.json`, JSON.stringify(errs, null, 2));
    log.error('Submit diagnostic dumped', { dir, errorElems: errs.length });
    return dir;
  } catch (err) {
    log.warn('Could not dump submit diagnostic', { err: String(err) });
    return dir;
  }
}

async function submitListing(page: Page): Promise<ListingResult> {
  const submitBtn = page.locator(LISTING_SELECTORS.submitButton).first();
  await submitBtn.waitFor({ state: 'visible', timeout: 5_000 });

  // Vor Submit: kurzer Pre-Check der Felder (nicht-blockierend, nur Logging)
  const preErrors = await page.locator(LISTING_SELECTORS.errorMessage).count();
  log.info('Pre-submit field validation', { errorElements: preErrors });

  log.info('Submitting listing…');
  await submitBtn.click();

  // Erst kurz auf Navigation warten — wenn das klappt, fertig.
  try {
    await page.waitForURL(LISTING_SELECTORS.successUrlPattern, { timeout: 45_000 });
    const url = page.url();
    const match = url.match(LISTING_SELECTORS.successUrlPattern);
    log.info('Listing published successfully!', { url, vintedItemId: match?.[1] });
    return { ok: true, vintedUrl: url, vintedItemId: match?.[1] };
  } catch {
    // Submission failed (Validation, Captcha, oder hängt) — Diagnose dumpen
    const currentUrl = page.url();
    if (currentUrl.includes('/items/') && !currentUrl.endsWith('/items/new')) {
      // URL hat sich auf eine Item-Page geändert — vermutlich Erfolg
      const id = currentUrl.match(/\/items\/(\d+)/)?.[1];
      log.info('Listing likely published (URL changed to item page)', { currentUrl });
      return { ok: true, vintedUrl: currentUrl, vintedItemId: id };
    }

    // Vinted (May 2026): success now keeps you on /member/{username} with a
    // "Artikel hochgeladen" modal. Detect that pattern as success and scrape
    // the most-recent item ID from the profile page.
    const successText = await page.evaluate(() => {
      const txt = document.body.innerText || '';
      return /Artikel hochgeladen|Glückwunsch zu deiner.*Anzeige|Artikel erstellt/i.test(txt);
    }).catch(() => false);
    if (successText || /\/member\//.test(currentUrl)) {
      // Wait for the profile's listings grid to render, then scrape the
      // newest item link. The profile page lists items newest-first so the
      // first /items/ link IS our just-published listing.
      let itemId: string | null = null;
      for (let attempt = 0; attempt < 6; attempt++) {
        await page.waitForTimeout(1000);
        itemId = await page.evaluate(() => {
          const links = Array.from(document.querySelectorAll('a[href*="/items/"]')) as HTMLAnchorElement[];
          for (const a of links) {
            const m = a.getAttribute('href')?.match(/\/items\/(\d+)/);
            if (m?.[1]) return m[1];
          }
          return null;
        }).catch(() => null);
        if (itemId) break;
      }
      const url = itemId ? `${new URL(currentUrl).origin}/items/${itemId}` : currentUrl;
      log.info('Listing published — success modal detected', { url, vintedItemId: itemId });
      return { ok: true, vintedUrl: url, vintedItemId: itemId ?? undefined };
    }

    // Block-Check nach Submit — Vinted serviert die Block-Page oft erst auf Submit
    const postBlock = await isBotBlocked(page);
    if (postBlock.blocked) {
      log.error('Vinted blocked AFTER submit', { reason: postBlock.reason });
      markBlocked('vinted', postBlock.reason ?? 'post-submit block', 45);
      const dir = await dumpSubmitDiagnostic(page, 'blocked');
      return { ok: false, error: `${postBlock.reason ?? 'BLOCKED'} — Cooldown 45min eingetragen (${dir})` };
    }

    // CAPTCHA AFTER submit — Vinted often gates the actual submission behind
    // a challenge that only appears after the click. Try to solve once.
    const cap2 = await detectAndSolveCaptcha(page);
    if (cap2.detected && cap2.solved) {
      log.info('Captcha solved after submit — clicking submit again');
      await page.waitForTimeout(1500);
      try {
        await submitBtn.click();
        await page.waitForTimeout(5000);
      } catch { /* ignore second-click failures */ }
    }
    if (cap2.detected && !cap2.solved) {
      const dir = await dumpSubmitDiagnostic(page, 'captcha-blocked');
      return { ok: false, error: `[captcha] post-submit ${cap2.error ?? 'unsolved'} (${dir})` };
    }

    // Still on form — sammle ALLE error-Texte (nicht nur den ersten)
    const errorTexts = await page.evaluate(() => {
      const sels = [
        '[data-testid$="-error"]',
        '[data-testid="form-error"]',
        '[class*="ValidationError" i]',
        '[class*="FormError" i]',
        '[class*="field-error" i]',
        '[class*="InputError" i]',
        '[aria-invalid="true"]',
      ];
      const out = new Set<string>();
      for (const s of sels) {
        document.querySelectorAll(s).forEach((el) => {
          const t = (el as HTMLElement).innerText?.trim();
          if (t && t.length > 3 && t.length < 200) out.add(t);
        });
      }
      return Array.from(out);
    }).catch(() => []);

    const dir = await dumpSubmitDiagnostic(page, 'fail');
    const summary = errorTexts.length > 0
      ? errorTexts.slice(0, 3).join(' · ')
      : 'unknown — check ' + dir;
    return {
      ok: false,
      error: `Form submission error: ${summary}`.slice(0, 500),
    };
  }
}
