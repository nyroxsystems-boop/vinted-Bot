// Depop Selektoren — initiale Skizze. Selector-Chain dumped Diagnose
// nach _diag/ wenn nichts matched.
import { chain } from '@vinted-system/shared';

// ── Auth ─────────────────────────────────────────────────────────────────────
export const SEL_LOGGED_IN = chain('depop:logged-in',
  '[data-testid="user-avatar"]',
  'a[href^="/profile/"]',
  '[data-testid="header-avatar"]',
);

// ── Sell-Flow ────────────────────────────────────────────────────────────────
export const SEL_SELL_BTN = chain('depop:sell',
  'a[href="/sell/"]',
  'a[href="/sell"]',
  '[data-testid="sell-button"]',
);

// ── Photos ───────────────────────────────────────────────────────────────────
export const SEL_PHOTO_INPUT = chain('depop:photo-input',
  'input[type="file"][accept*="image"]',
  'input[name="photos"]',
  'input[data-testid="photo-upload-input"]',
);

export const SEL_PHOTO_THUMB = chain('depop:photo-thumb',
  '[data-testid^="photo-tile"]',
  'img[alt*="Photo" i]',
  '[class*="PhotoTile" i] img',
);

// ── Form Fields ──────────────────────────────────────────────────────────────
export const SEL_DESCRIPTION = chain('depop:description',
  'textarea[name="description"]',
  'textarea[id*="description" i]',
  'textarea[placeholder*="Describe" i]',
);

export const SEL_HASHTAGS = chain('depop:hashtags',
  'input[name="hashtags"]',
  'input[placeholder*="hashtag" i]',
);

export const SEL_PRICE = chain('depop:price',
  'input[name="price"]',
  'input[id*="price" i]',
  'input[type="number"][step]',
);

// Depop Category & Sub-Category Tabs
export const SEL_CATEGORY_DROPDOWN = chain('depop:category',
  'select[name="categoryId"]',
  '[data-testid="category-dropdown"]',
  'button:has-text("Category")',
);

export const SEL_SUBCATEGORY_DROPDOWN = chain('depop:subcategory',
  'select[name="subCategoryId"]',
  '[data-testid="subcategory-dropdown"]',
);

// Brand
export const SEL_BRAND_INPUT = chain('depop:brand',
  'input[name="brandName"]',
  'input[name="brand"]',
  'input[placeholder*="brand" i]',
);

export const SEL_BRAND_OPTION = chain('depop:brand-option',
  '[role="option"]',
  '[data-testid^="brand-option"]',
  'li[role="option"]',
);

// Size
export const SEL_SIZE_DROPDOWN = chain('depop:size',
  'select[name="sizeId"]',
  '[data-testid="size-dropdown"]',
  'button:has-text("Size")',
);

// Condition (radio buttons)
export const SEL_CONDITION_RADIO = (text: string) => chain(`depop:condition-${text}`,
  `label:has-text("${text}") input[type="radio"]`,
  `input[type="radio"][value*="${text.toLowerCase()}" i]`,
);

// Color (multi-select)
export const SEL_COLOR_TRIGGER = chain('depop:color-trigger',
  '[data-testid="color-picker"]',
  'button:has-text("Colour")',
  'button:has-text("Color")',
);

export const SEL_COLOR_OPTION = (color: string) => chain(`depop:color-${color}`,
  `[data-testid="color-${color.toLowerCase()}"]`,
  `[aria-label="${color}" i]`,
  `button:has-text("${color}")`,
);

// Shipping
export const SEL_SHIPPING_DOMESTIC = chain('depop:shipping-domestic',
  'input[type="radio"][value*="DOMESTIC" i]',
  'label:has-text("Ship") input[type="radio"]',
);

// Submit
export const SEL_PUBLISH = chain('depop:publish',
  'button[type="submit"][data-testid="post-listing"]',
  'button:has-text("Post listing")',
  'button:has-text("Post")',
);

export const SEL_PUBLISHED_CONFIRM = chain('depop:published-confirm',
  '[data-testid="listing-success"]',
  'h1:has-text("Listed")',
  'text=/successfully posted/i',
);

// ── Item-Page (deactivate) ───────────────────────────────────────────────────
export const SEL_ITEM_DELETE_BTN = chain('depop:item-delete',
  '[data-testid="delete-listing"]',
  'button:has-text("Delete listing")',
);

export const SEL_CONFIRM_DELETE = chain('depop:confirm-delete',
  'button:has-text("Yes, delete")',
  '[data-testid="confirm-delete"]',
);

// Bot blocks
export const SEL_CAPTCHA = chain('depop:captcha',
  'iframe[src*="recaptcha"]',
  'iframe[src*="hcaptcha"]',
);

// ── Inbox / Messages ────────────────────────────────────────────────────────
// Depop's inbox lives at /messages/. Each conversation card has the buyer's
// avatar, last-message snippet, unread-dot, timestamp.
export const SEL_INBOX_LIST = chain('depop:inbox-list',
  '[data-testid="conversation-list"]',
  'main [class*="ConversationList" i]',
  'ul[role="list"]',
);

export const SEL_INBOX_ITEM = chain('depop:inbox-item',
  '[data-testid="conversation-item"]',
  'a[href^="/messages/"]',
  'li[role="listitem"] a',
);

export const SEL_INBOX_UNREAD_DOT = chain('depop:inbox-unread',
  '[data-testid="unread-indicator"]',
  '[class*="UnreadDot" i]',
  '[aria-label*="unread" i]',
);

// On a conversation page
export const SEL_CHAT_HEADER_BUYER = chain('depop:chat-buyer',
  '[data-testid="conversation-header-username"]',
  'header a[href^="/"]',
  'h1',
);

export const SEL_CHAT_LISTING_LINK = chain('depop:chat-listing',
  '[data-testid="conversation-product-link"]',
  'a[href^="/products/"]',
);

export const SEL_CHAT_MESSAGE_ITEM = chain('depop:chat-message',
  '[data-testid^="message-"]',
  '[class*="MessageBubble" i]',
  'li[class*="message" i]',
);

export const SEL_CHAT_REPLY_BOX = chain('depop:chat-reply',
  'textarea[data-testid="message-input"]',
  'textarea[placeholder*="Message" i]',
  'div[contenteditable="true"][role="textbox"]',
);

export const SEL_CHAT_SEND_BTN = chain('depop:chat-send',
  'button[data-testid="send-button"]',
  'button[type="submit"][aria-label*="send" i]',
  'button:has(svg[aria-label*="send" i])',
);

// Offers — Depop has a "Make an offer" flow. Buyer offers appear as a special
// message bubble with Accept/Decline buttons.
export const SEL_OFFER_BUBBLE = chain('depop:offer-bubble',
  '[data-testid="offer-message"]',
  '[class*="OfferMessage" i]',
);

export const SEL_OFFER_ACCEPT = chain('depop:offer-accept',
  'button[data-testid="accept-offer"]',
  'button:has-text("Accept offer")',
  'button:has-text("Accept")',
);

export const SEL_OFFER_DECLINE = chain('depop:offer-decline',
  'button[data-testid="decline-offer"]',
  'button:has-text("Decline offer")',
  'button:has-text("Decline")',
);

// ── Sold-Items page ──────────────────────────────────────────────────────────
// /my-shop/sold/ — list of items the seller has marked sold (or that buyers
// have completed). Used by sale-detection worker.
export const SEL_SOLD_ITEM = chain('depop:sold-item',
  '[data-testid="sold-item"]',
  'a[href^="/products/"][class*="sold" i]',
  'li[class*="sold" i] a[href^="/products/"]',
);
