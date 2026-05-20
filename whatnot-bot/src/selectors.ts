// Whatnot Selektoren — Whatnot is a LIVE-STREAM marketplace, mostly auctions
// during shows. Static listings exist but are secondary. Many traditional
// marketplace features (update-price, offers) don't apply here.
// ──────────────────────────────────────────────────────────────────────────────
import { chain } from '@vinted-system/shared';

// ── Auth ─────────────────────────────────────────────────────────────────────
export const SEL_LOGGED_IN = chain('whatnot:logged-in',
  '[data-testid="avatar"]',
  '[data-testid="user-menu-button"]',
  'a[href*="/user/"]',
  'a[href*="/profile"]',
);

// ── Inbox / Chats (Whatnot has DMs) ──────────────────────────────────────────
export const SEL_INBOX_URL = '/messages';

export const SEL_REPLY_TEXTAREA = chain('whatnot:reply-textarea',
  'textarea[placeholder*="message" i]',
  'textarea[placeholder*="send" i]',
  '[contenteditable="true"][data-testid*="message"]',
  '[data-testid="message-input"]',
);

export const SEL_REPLY_SUBMIT = chain('whatnot:reply-submit',
  'button[type="submit"]:has-text("Send")',
  'button:has-text("Send")',
  '[data-testid="send-message"]',
);

// ── Sold / Orders ────────────────────────────────────────────────────────────
export const SEL_ORDERS_URL = '/sellhub/orders';

// ── Blocks ───────────────────────────────────────────────────────────────────
export const SEL_CAPTCHA = chain('whatnot:captcha',
  'iframe[src*="recaptcha"]',
  'iframe[src*="hcaptcha"]',
  'iframe[src*="challenges.cloudflare.com"]',
);

export const SEL_BLOCKED = chain('whatnot:blocked',
  'text=/access denied/i',
  'text=/too many requests/i',
);

// ── Sell-Form (rarely used — Whatnot lists during live shows) ────────────────
export const SEL_SELL_BTN = chain('whatnot:sell',
  'a[href="/sell"]',
  'a[href*="/sellhub"]',
  'button:has-text("Sell")',
);

export const SEL_PHOTO_INPUT = chain('whatnot:photo-input',
  'input[type="file"][accept*="image"]',
  'input[type="file"]',
);

export const SEL_TITLE = chain('whatnot:title',
  'input[name*="title" i]',
  'input[placeholder*="title" i]',
);

export const SEL_DESCRIPTION = chain('whatnot:description',
  'textarea[name*="description" i]',
  'textarea[placeholder*="description" i]',
);

export const SEL_PRICE = chain('whatnot:price',
  'input[name*="price" i]',
  'input[type="number"]',
);
