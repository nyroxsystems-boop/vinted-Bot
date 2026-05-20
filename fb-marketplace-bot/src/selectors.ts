// Facebook Marketplace Selektoren — aggressive anti-bot, dynamic class names.
// All selectors are best-guess based on aria-labels and stable text. The DOM
// class names are obfuscated and change frequently, so we lean on aria.
// ──────────────────────────────────────────────────────────────────────────────
import { chain } from '@vinted-system/shared';

// ── Auth ─────────────────────────────────────────────────────────────────────
export const SEL_LOGGED_IN = chain('fb:logged-in',
  '[aria-label="Dein Profil"]',
  '[aria-label="Your profile"]',
  'a[href*="/marketplace"]',
  'a[aria-label*="Account" i]',
);

// ── Sell-Flow ────────────────────────────────────────────────────────────────
export const SEL_CREATE_ITEM_URL = '/marketplace/create/item';

export const SEL_PHOTO_INPUT = chain('fb:photo-input',
  'input[type="file"][accept*="image"]',
  'input[type="file"]',
);

export const SEL_TITLE = chain('fb:title',
  'input[aria-label*="Title" i]',
  'input[aria-label*="Titel" i]',
  'input[placeholder*="What are you selling" i]',
  'input[placeholder*="Was verkaufst" i]',
);

export const SEL_PRICE = chain('fb:price',
  'input[aria-label*="Price" i]',
  'input[aria-label*="Preis" i]',
);

export const SEL_DESCRIPTION = chain('fb:description',
  'textarea[aria-label*="Description" i]',
  'textarea[aria-label*="Beschreibung" i]',
);

export const SEL_PUBLISH = chain('fb:publish',
  'div[aria-label="Veröffentlichen"][role="button"]',
  'div[aria-label="Publish"][role="button"]',
  'button:has-text("Veröffentlichen")',
  'button:has-text("Publish")',
);

// ── Item-Page Actions ────────────────────────────────────────────────────────
// FB Marketplace listings live at /marketplace/item/<id>.
export const SEL_EDIT_BTN = chain('fb:edit',
  'div[role="button"]:has-text("Eintrag bearbeiten")',
  'div[role="button"]:has-text("Edit listing")',
  'a[href*="/edit"]:has-text("Bearbeiten")',
);

export const SEL_PRICE_EDIT_INPUT = chain('fb:price-edit-input',
  'input[aria-label*="Price" i]',
  'input[aria-label*="Preis" i]',
);

export const SEL_SAVE_BTN = chain('fb:save',
  'div[aria-label="Speichern"][role="button"]',
  'div[aria-label="Save"][role="button"]',
  'button:has-text("Speichern")',
  'button:has-text("Save")',
);

// Mark-as-sold / Delete listing
export const SEL_MARK_SOLD = chain('fb:mark-sold',
  'div[role="button"]:has-text("Als verkauft markieren")',
  'div[role="button"]:has-text("Mark as sold")',
);

export const SEL_DELETE_BTN = chain('fb:delete',
  'div[role="button"]:has-text("Eintrag löschen")',
  'div[role="button"]:has-text("Delete listing")',
);

export const SEL_CONFIRM_DELETE = chain('fb:confirm-delete',
  'div[aria-label="Löschen"][role="button"]',
  'div[aria-label="Delete"][role="button"]',
  'button:has-text("Bestätigen")',
);

// ── Messaging (Marketplace messages, NOT general FB messenger) ───────────────
export const SEL_INBOX_URL = '/marketplace/inbox';

export const SEL_CONVERSATION_ITEM = chain('fb:conv-item',
  '[role="row"][aria-label*="conversation" i]',
  '[role="link"][aria-label*="Chat" i]',
  'a[href*="/marketplace/t/"]',
);

export const SEL_MESSAGE_BUBBLE = chain('fb:msg-bubble',
  '[data-testid="mwthreadview-message"]',
  '[role="row"] [data-scope="messages_table"]',
  '[aria-label*="Message from" i]',
  'div[role="row"]:not([aria-label*="conversation" i])',
);

export const SEL_REPLY_TEXTAREA = chain('fb:reply-textarea',
  'div[role="textbox"][aria-label*="Message" i]',
  'div[role="textbox"][aria-label*="Nachricht" i]',
  '[contenteditable="true"][aria-label*="message" i]',
);

export const SEL_REPLY_SUBMIT = chain('fb:reply-submit',
  'div[aria-label="Senden"][role="button"]',
  'div[aria-label="Send"][role="button"]',
  '[aria-label*="Press enter to send" i]',
);

// ── Offers (FB Marketplace has a "Make offer" feature) ───────────────────────
export const SEL_OFFER_ACCEPT = chain('fb:offer-accept',
  'div[role="button"]:has-text("Angebot annehmen")',
  'div[role="button"]:has-text("Accept offer")',
  'div[aria-label*="Accept" i][role="button"]',
);

export const SEL_OFFER_DECLINE = chain('fb:offer-decline',
  'div[role="button"]:has-text("Angebot ablehnen")',
  'div[role="button"]:has-text("Decline offer")',
  'div[aria-label*="Decline" i][role="button"]',
);

// ── Selling — verkaufte / aktive Listings ────────────────────────────────────
// /marketplace/you/selling
export const SEL_YOUR_LISTINGS_URL = '/marketplace/you/selling';

export const SEL_SOLD_ROW = chain('fb:sold-row',
  '[aria-label*="Sold" i]',
  '[aria-label*="Verkauft" i]',
  'a[href*="/marketplace/item/"][aria-label*="Sold" i]',
);

// ── Blocks ───────────────────────────────────────────────────────────────────
export const SEL_CAPTCHA = chain('fb:captcha',
  'iframe[src*="recaptcha"]',
  'iframe[src*="hcaptcha"]',
  'div[role="dialog"][aria-label*="security check" i]',
);

export const SEL_CHECKPOINT = chain('fb:checkpoint',
  'text=/checkpoint/i',
  'text=/sicherheitspr[üu]fung/i',
  'text=/security check/i',
);
