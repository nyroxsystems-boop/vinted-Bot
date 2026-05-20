// ──────────────────────────────────────────────────────────────────────────────
// Vinted listing creation selectors — VERIFIED against live Vinted UI
// (April 2026, logged-in DE account — re-verified via accessibility tree).
//
// Confirmed real placeholders (these go FIRST in every fallback chain):
//   • Title:       "Teile Käufern mit, was du verkaufst"
//   • Description: "Erzähle Käufern mehr darüber"
//   • Category:    "Wähle eine Kategorie"   ← main input (opens popup)
//   •   sub-search in popup: "Finde eine Kategorie"
//   • Price:       "0,00 €"
//   • Photo add:   button labeled "Fotos hinzufügen"
//   • Submit:      button labeled "Hochladen"   (no more "Artikel hinzufügen")
//   • Draft:       button labeled "Entwurf speichern"
//
// Flow quirks observed:
//   - The /items/new form starts MINIMAL — only the 5 fields above are
//     rendered. Brand / Size / Condition / Color / Material inputs are
//     injected lazily AFTER a category is chosen (cascade completes).
//     Our bot MUST wait for their DOM nodes to appear; selecting category
//     upfront is mandatory.
//   - The category selector is TWO elements: a readonly-ish text input
//     (opens popup on focus) + a chevron button. Inside the popup a
//     second text input `placeholder="Finde eine Kategorie"` accepts
//     live search. We prefer the search field for speed.
//
// The selectors below use fallback chains for resilience.
// ──────────────────────────────────────────────────────────────────────────────

export const LISTING_SELECTORS = {
  // ── URLs ─────────────────────────────────────────────────────────────────
  newListingUrl: '/items/new',

  // ── Photo upload ─────────────────────────────────────────────────────────
  // VERIFIED (April 2026): Vinted renders a drop-zone with a "Fotos hinzufügen"
  // button and a hidden <input type="file" multiple>. We drive the hidden
  // input directly with setInputFiles() — no need to click the visible button.
  photoFileInput: [
    'input[data-testid="add-photos-input"]',          // verifiziert 2026-04-30
    'input[type="file"][name="photos"]',
    'input[type="file"][accept*="image"]',
    'input[type="file"][multiple]',
    'input[type="file"][data-testid*="photo"]',
    'input[type="file"]',
  ].join(', '),

  photoAddButton: [
    'button:has-text("Fotos hinzufügen")',
    'button:has-text("Add photos")',
  ].join(', '),

  // Uploaded photo thumbnails (to verify upload success)
  uploadedPhotoThumb: [
    // Verifiziert 2026-04-30 gegen vinted.de/items/new live:
    // Hochgeladene Fotos rendern als <img alt="Hochgeladenes Foto X von Y..."
    // src="https://images1.vinted.net/t/.../f800/...">
    'img[alt^="Hochgeladenes Foto"]',                 // ← bester Anker (deutsch)
    'img[alt^="Uploaded photo"]',                     // englischer Fallback
    'img[alt*="Foto " i][alt*=" von "]',              // robust gegen Wording-Drift
    'main img[src*="images1.vinted.net/t/"][src*="/f800/"]',  // Format f800 = uploads
    'main img[src^="blob:"]',                         // blob-preview während upload
    // Container-basiert (Vinted nutzt utility-Klassen, daher als Fallback):
    'main div[draggable="true"] img',
    'main [class*="upload" i] img',
  ].join(', '),

  // Sichtbarer Indikator für laufende Uploads (Spinner/Progress)
  uploadInProgress: [
    '[role="progressbar"]',
    '[class*="uploading" i]',
    '[class*="upload-progress" i]',
    '[data-testid*="loading"]',
  ].join(', '),

  // ── Title ────────────────────────────────────────────────────────────────
  // VERIFIED placeholder (April 2026): "Teile Käufern mit, was du verkaufst"
  titleInput: [
    'input[placeholder="Teile Käufern mit, was du verkaufst"]',
    'input[data-testid="title-input"]',
    '#title',
    'input[name="title"]',
    'input[placeholder*="Titel" i]',
    'input[placeholder*="Was verkaufst du?" i]',
  ].join(', '),

  // ── Description ──────────────────────────────────────────────────────────
  // VERIFIED placeholder (April 2026): "Erzähle Käufern mehr darüber"
  descriptionInput: [
    'textarea[placeholder="Erzähle Käufern mehr darüber"]',
    'textarea[data-testid="description-input"]',
    '#description',
    'textarea[name="description"]',
    'textarea[placeholder*="Beschreibe" i]',
    'textarea[placeholder*="z.B. nur einmal getragen" i]',
    'textarea',
  ].join(', '),

  // ── Category ─────────────────────────────────────────────────────────────
  // VERIFIED (April 2026): category is a text input (not a button). Clicking/
  // focussing it opens a popup; inside the popup a SECOND text input with
  // placeholder "Finde eine Kategorie" does live search. Cascade buttons
  // (Damen, Herren, Kinder, …) are <button> elements inside an <ul>.
  categoryButton: [
    'input[data-testid="catalog-select-dropdown-input"]',  // verified 2026-05-12
    'input[placeholder="Wähle eine Kategorie"]',
    'input[name="category"]',
    '[data-testid="category-select"]',
    'button:has-text("Kategorie")',
  ].join(', '),

  // Fast-path: type into the popup's search input instead of clicking
  // through the whole cascade. Callers should try this first and fall
  // back to categoryOption clicks when the searchable input is missing.
  categorySearchInput: [
    'input[placeholder="Finde eine Kategorie"]',
    '[role="dialog"] input[type="text"]',
  ].join(', '),

  // Inside the category popup, items are clickable <button>s inside <li>s.
  categoryOption: (text: string) => [
    `li button:has-text("${text}")`,
    `button:has-text("${text}")`,
    `a:has-text("${text}")`,
    `div[role="option"]:has-text("${text}")`,
    `li:has-text("${text}")`,
  ].join(', '),

  // ── Dynamic attribute fields (appear AFTER category is chosen) ────────
  //
  // VERIFIED (April 2026, category = "Damen > Kleider > Minikleider"):
  // every attribute field is a DROPDOWN, not a bare input. The clickable
  // trigger row contains a placeholder like "Wähle eine Marke", and opens
  // an overlay with radio-buttons (single-select) or checkboxes (multi-select
  // only for Farbe, max 2).
  //
  // Strategy: match the trigger by its placeholder text, then pick options
  // by radio-label text once the overlay is open.

  // ── Brand (dropdown) ────────────────────────────────────────────────────
  // Placeholder: "Wähle eine Marke".
  // Overlay shows "Beliebte Marken" list first (Zara, Shein, H&M, C&A, …).
  // Typing a query filters the list — we try typing first, fall back to
  // scrolling the popular list. Default value for our flow: "Ohne Marke".
  brandInput: [
    'input[placeholder="Wähle eine Marke"]',
    '[aria-label="Wähle eine Marke"]',
    'input[data-testid="brand-input"]',
    '#brand',
    'input[name="brand"]',
  ].join(', '),
  brandTrigger: [
    'input[placeholder="Wähle eine Marke"]',
    'button:has-text("Wähle eine Marke")',
    '[role="button"]:has-text("Wähle eine Marke")',
    'div:has(> span:has-text("Marke")) + div',
  ].join(', '),
  brandSuggestion: (text: string) => [
    `label:has-text("${text}")`,
    `[role="radio"]:has-text("${text}")`,
    `[data-testid="brand-suggestion"]:has-text("${text}")`,
    `li:has-text("${text}")`,
    `div[role="option"]:has-text("${text}")`,
  ].join(', '),

  // ── Condition (dropdown) ───────────────────────────────────────────────
  // Placeholder: "Wähle einen Zustand".
  // Options (each with description):
  //   • "Neu, mit Etikett"
  //   • "Neu"
  //   • "Sehr gut"
  //   • "Gut"
  //   • "Zufriedenstellend"
  conditionButton: [
    'input[placeholder="Wähle einen Zustand"]',
    '[aria-label="Wähle einen Zustand"]',
    'button:has-text("Wähle einen Zustand")',
    '[data-testid="condition-select"]',
    'button:has-text("Zustand")',
  ].join(', '),
  conditionOption: (text: string) => [
    // Radio label inside the opened overlay
    `label:has-text("${text}")`,
    `[role="radio"]:has-text("${text}")`,
    `div[role="option"]:has-text("${text}")`,
    `button:has-text("${text}")`,
    `li:has-text("${text}")`,
  ].join(', '),

  // ── Color (dropdown — MULTI-SELECT, max 2) ─────────────────────────────
  // Placeholder: "Wähle bis zu 2 Farben".
  // Options are CHECKBOXES with a color swatch + label (Schwarz, Grau,
  // Weiß, Creme, …). After selecting, user clicks outside / "Fertig" to
  // close the overlay.
  colorButton: [
    'input[placeholder="Wähle bis zu 2 Farben"]',
    '[aria-label="Wähle bis zu 2 Farben"]',
    'button:has-text("Wähle bis zu 2 Farben")',
    '[data-testid="color-select"]',
    'button:has-text("Farbe")',
  ].join(', '),
  colorOption: (text: string) => [
    // Checkbox label — exact match preferred so "Weiß" doesn't hit "Weißrot"
    `label:has-text("${text}")`,
    `[role="checkbox"]:has-text("${text}")`,
    `div[role="option"]:has-text("${text}")`,
    `button:has-text("${text}")`,
    `span:has-text("${text}")`,
  ].join(', '),
  colorMultiSelectDone: [
    'button:has-text("Fertig")',
    'button:has-text("Bestätigen")',
    'button:has-text("Done")',
  ].join(', '),

  // ── Size (dropdown) ────────────────────────────────────────────────────
  // Placeholder: "Wähle eine Größe".
  // Options are formatted as "LETTER / EU / US", e.g. "XXXS / 30 / 2",
  // "XXS / 32 / 4", "XS / 34 / 6", "S / 36 / 8", "M / 38 / 10", …
  // Our sizeOption() helper matches by SUBSTRING so callers can pass "S",
  // "36", or the full label — Playwright :has-text() does substring match.
  sizeButton: [
    'input[placeholder="Wähle eine Größe"]',
    '[aria-label="Wähle eine Größe"]',
    'button:has-text("Wähle eine Größe")',
    '[data-testid="size-select"]',
    'button:has-text("Größe")',
  ].join(', '),
  sizeOption: (text: string) => [
    // Substring match so caller can pass "S" and hit "S / 36 / 8".
    `label:has-text("${text}")`,
    `[role="radio"]:has-text("${text}")`,
    `div[role="option"]:has-text("${text}")`,
    `button:has-text("${text}")`,
    `span:has-text("${text}")`,
  ].join(', '),

  // ── Material (dropdown, recommended — not required) ───────────────────
  // Placeholder: "Wähle ein Material"
  materialButton: [
    'input[placeholder="Wähle ein Material"]',
    '[aria-label="Wähle ein Material"]',
    'button:has-text("Wähle ein Material")',
  ].join(', '),
  materialOption: (text: string) => [
    `label:has-text("${text}")`,
    `[role="radio"]:has-text("${text}")`,
    `div[role="option"]:has-text("${text}")`,
    `button:has-text("${text}")`,
  ].join(', '),

  // ── Price ────────────────────────────────────────────────────────────────
  // VERIFIED placeholder (April 2026): "0,00 €"
  priceInput: [
    'input[placeholder="0,00 €"]',
    'input[data-testid="price-input"]',
    '#price',
    'input[name="price"]',
    'input[placeholder*="Preis" i]',
    'input[type="number"]',
  ].join(', '),

  // ── Shipping ─────────────────────────────────────────────────────────────
  // Vinted DE defaults to "Paketversand" — the user toggles methods.
  shippingOption: (text: string) => [
    `label:has-text("${text}")`,
    `button:has-text("${text}")`,
    `div[role="option"]:has-text("${text}")`,
  ].join(', '),

  // ── Submit ───────────────────────────────────────────────────────────────
  // VERIFIED (April 2026): button text is "Hochladen". Draft variant is
  // "Entwurf speichern" — exposed separately so auto-publisher can choose.
  submitButton: [
    'button:has-text("Hochladen")',
    'button[data-testid="submit-button"]',
    'button:has-text("Artikel hinzufügen")',
    'button:has-text("Veröffentlichen")',
    'button[type="submit"]',
  ].join(', '),

  draftButton: [
    'button:has-text("Entwurf speichern")',
    'button:has-text("Save draft")',
  ].join(', '),

  // ── Success detection ────────────────────────────────────────────────────
  // After successful submission, Vinted redirects to /items/{id}-{slug}
  // ── Error detection ──────────────────────────────────────────────────────
  // Eng halten — sonst matched Vinted's gesamtes Form (das viele "error"-
  // Klassen-Hilfstexte hat) und der Bot meldet false-positive "Form-Error".
  errorMessage: [
    '[data-testid="form-error"]',
    '[data-testid$="-error"]',                    // z.B. title-error, price-error
    '[data-testid="error-message"]',
    '[class*="ValidationError" i]',
    '[class*="FormError" i]',
    '[class*="field-error" i]',
    '[class*="form-validation-error" i]',
    'main [role="alert"]',                         // role=alert nur im Form-Kontext
    '[class*="InputError" i]',
    'span[class*="error" i][class*="text" i]',
  ].join(', '),

  // Pattern für Erfolgs-URL nach Submit — etwas großzügiger
  successUrlPattern: /\/items\/(\d+)(?:-|$|\?)/,
} as const;
