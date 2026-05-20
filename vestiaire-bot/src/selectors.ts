// Vestiaire Collective Selektoren — initial best-guess.
// Cloudflare-protected; verify in selftest before live use.
// ──────────────────────────────────────────────────────────────────────────────
import { chain } from '@vinted-system/shared';

// ── Auth ─────────────────────────────────────────────────────────────────────
export const SEL_LOGGED_IN = chain('vc:logged-in',
  '[data-testid="avatar"]',
  '[data-cy="header-account"]',
  'a[href*="/member/"]',
  'a[href*="/account/"]',
);

// ── Sell-Flow ────────────────────────────────────────────────────────────────
export const SEL_SELL_BTN = chain('vc:sell',
  'a[href="/sell/"]',
  'a[href*="/sell"]',
  'button:has-text("Sell")',
  '[data-testid="sell-cta"]',
);

export const SEL_PHOTO_INPUT = chain('vc:photo-input',
  'input[type="file"][accept*="image"]',
  'input[type="file"]',
);

export const SEL_TITLE = chain('vc:title',
  'input[name*="title" i]',
  'input[placeholder*="title" i]',
  'input[data-testid*="title"]',
);

export const SEL_DESCRIPTION = chain('vc:description',
  'textarea[name*="description" i]',
  'textarea[placeholder*="description" i]',
  'textarea[data-testid*="description"]',
);

export const SEL_PRICE = chain('vc:price',
  'input[name*="price" i]',
  'input[placeholder*="price" i]',
  'input[type="number"][data-testid*="price"]',
);

export const SEL_BRAND = chain('vc:brand',
  'input[name*="brand" i]',
  'input[placeholder*="designer" i]',
  'input[placeholder*="brand" i]',
);

export const SEL_PUBLISH = chain('vc:publish',
  'button[type="submit"]:has-text("Publish")',
  'button:has-text("Submit")',
  'button:has-text("List")',
  '[data-testid="submit-listing"]',
);

// ── Item-Page Actions ────────────────────────────────────────────────────────
export const SEL_ITEM_EDIT = chain('vc:item-edit',
  'a[href*="/edit"]',
  'button:has-text("Edit")',
  '[data-testid="edit-listing"]',
);

export const SEL_PRICE_EDIT_INPUT = chain('vc:price-edit-input',
  'input[name*="price" i]',
  'input[placeholder*="price" i]',
  'input[type="number"]',
);

export const SEL_SAVE_BTN = chain('vc:save',
  'button[type="submit"]:has-text("Save")',
  'button:has-text("Save changes")',
  'button:has-text("Update")',
);

export const SEL_ITEM_OFFLINE = chain('vc:offline',
  'button:has-text("Offline")',
  'button:has-text("Unpublish")',
  'button:has-text("Remove")',
  'button:has-text("Delete")',
  '[data-testid="unpublish"]',
);

export const SEL_CONFIRM_DELETE = chain('vc:confirm-delete',
  'button:has-text("Confirm")',
  'button:has-text("Yes")',
  'button:has-text("Delete")',
  '[data-testid="confirm"]',
);

// ── Chats / Messages ─────────────────────────────────────────────────────────
export const SEL_INBOX_URL = '/member/inbox';
export const SEL_CONVERSATION_ITEM = chain('vc:conv-item',
  'a[href*="/conversation/"]',
  'a[href*="/messages/"]',
  '[data-testid="conversation-item"]',
  '[class*="ConversationListItem" i]',
);

export const SEL_MESSAGE_BUBBLE = chain('vc:msg-bubble',
  '[data-testid="message-bubble"]',
  '[class*="MessageBubble" i]',
  '[class*="message-item" i]',
);

export const SEL_REPLY_TEXTAREA = chain('vc:reply-textarea',
  'textarea[placeholder*="message" i]',
  'textarea[name*="message" i]',
  '[data-testid="reply-input"]',
);

export const SEL_REPLY_SUBMIT = chain('vc:reply-submit',
  'button[type="submit"]:has-text("Send")',
  'button:has-text("Send")',
  '[data-testid="send-message"]',
);

// ── Offers (Vestiaire has "Make an offer" feature) ───────────────────────────
export const SEL_OFFER_ACCEPT = chain('vc:offer-accept',
  'button:has-text("Accept offer")',
  'button:has-text("Accept")',
  '[data-testid="accept-offer"]',
);

export const SEL_OFFER_DECLINE = chain('vc:offer-decline',
  'button:has-text("Decline offer")',
  'button:has-text("Decline")',
  '[data-testid="decline-offer"]',
);

// ── Sold-Items / Transactions ────────────────────────────────────────────────
export const SEL_SOLD_URL = '/member/sold/';
export const SEL_SOLD_ROW = chain('vc:sold-row',
  '[data-testid="sold-item"]',
  '[class*="SoldItem" i]',
  'a[href*="/item/"][data-status*="sold"]',
);

// ── Blocks / Cloudflare ──────────────────────────────────────────────────────
export const SEL_CAPTCHA = chain('vc:captcha',
  'iframe[src*="recaptcha"]',
  'iframe[src*="hcaptcha"]',
  'iframe[src*="challenges.cloudflare.com"]',
);

export const SEL_BLOCKED = chain('vc:blocked',
  'text=/access denied/i',
  'text=/too many requests/i',
);
