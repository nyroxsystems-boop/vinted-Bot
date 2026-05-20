// ──────────────────────────────────────────────────────────────────────────────
// eBay Bot — Selector definitions
//
// Fallback-chain pattern: data-testid first, then semantic, then text.
// Keep this file synced when eBay changes their DOM.
// ──────────────────────────────────────────────────────────────────────────────

import { SelectorChain } from '@vinted-system/shared';

// ── Auth state ──────────────────────────────────────────────────────────────
export const SEL_LOGGED_IN = new SelectorChain('ebay-logged-in', [
  '[data-testid="header-my-ebay"]',
  '#gh-ug',
  'a[href*="/myebay"]',
  'button:has-text("Mein eBay")',
  'button:has-text("My eBay")',
]);

// ── Sell / List item ────────────────────────────────────────────────────────
export const SEL_SELL_BUTTON = new SelectorChain('ebay-sell-btn', [
  'a[href*="/sell/create"]',
  'a[data-testid="gh-sell"]',
  '#gh-sell',
  'a:has-text("Verkaufen")',
  'a:has-text("Sell")',
]);

export const SEL_TITLE_INPUT = new SelectorChain('ebay-title', [
  '[data-testid="title-input"]',
  'input[name="title"]',
  '#title',
  'input[placeholder*="Titel"]',
  'input[placeholder*="Title"]',
]);

export const SEL_DESCRIPTION = new SelectorChain('ebay-desc', [
  '[data-testid="description-input"]',
  'textarea[name="description"]',
  '#description',
  'div[contenteditable="true"]',
]);

export const SEL_PRICE_INPUT = new SelectorChain('ebay-price', [
  '[data-testid="price-input"]',
  'input[name="price"]',
  'input[id*="price"]',
  'input[placeholder*="Preis"]',
  'input[placeholder*="Price"]',
]);

export const SEL_PHOTO_INPUT = new SelectorChain('ebay-photo', [
  'input[type="file"][accept*="image"]',
  '[data-testid="photo-upload"] input[type="file"]',
  '.photo-upload input[type="file"]',
]);

export const SEL_SUBMIT = new SelectorChain('ebay-submit', [
  '[data-testid="submit-listing"]',
  'button[type="submit"]:has-text("Angebot einstellen")',
  'button[type="submit"]:has-text("List it")',
  'button:has-text("Einstellen")',
]);

// ── Category ────────────────────────────────────────────────────────────────
export const SEL_CATEGORY_SELECT = new SelectorChain('ebay-category', [
  '[data-testid="category-selector"]',
  'button:has-text("Kategorie")',
  'button:has-text("Category")',
]);

// ── Condition ───────────────────────────────────────────────────────────────
export const SEL_CONDITION_SELECT = new SelectorChain('ebay-condition', [
  '[data-testid="condition-selector"]',
  'select[name="condition"]',
  'button:has-text("Zustand")',
  'button:has-text("Condition")',
]);
