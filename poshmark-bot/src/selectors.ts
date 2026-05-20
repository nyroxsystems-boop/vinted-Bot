// Poshmark Selektoren — initiale Skizze, Multi-Stage-Fallbacks.
// Vor Live-Betrieb verifizieren — Selector-Chain dumped Diagnose nach _diag/
// wenn nichts matched.
import { chain } from '@vinted-system/shared';

// ── Auth ─────────────────────────────────────────────────────────────────────
export const SEL_LOGIN_EMAIL = chain('poshmark:email',
  'input[name="emailOrPhone"]',
  'input[type="email"]',
  'input[data-testid="email-input"]',
);

export const SEL_LOGIN_PASSWORD = chain('poshmark:password',
  'input[name="password"]',
  'input[type="password"]',
);

export const SEL_LOGIN_SUBMIT = chain('poshmark:login-submit',
  'button[data-testid="LoginButton"]',
  'button[type="submit"]',
);

export const SEL_LOGGED_IN = chain('poshmark:logged-in',
  '[data-testid="header-avatar"]',
  'a[href*="/mypage"]',
  '[data-testid="user-avatar-button"]',
);

// ── Sell-Flow Entry ──────────────────────────────────────────────────────────
export const SEL_SELL_BTN = chain('poshmark:sell',
  'a[href="/sell"]',
  'a[href="/sell/"]',
  'button:has-text("Sell")',
  '[data-testid="sell-button"]',
);

// ── Photos ───────────────────────────────────────────────────────────────────
export const SEL_PHOTO_INPUT = chain('poshmark:photo-input',
  'input[type="file"][accept*="image"]',
  'input[data-testid="ProductPhotoInput"]',
  'input[name="photos"]',
);

export const SEL_PHOTO_THUMB = chain('poshmark:photo-thumb',
  '[data-testid="PhotoUploadedThumbnail"]',
  '[class*="PhotoThumbnail" i]',
  'img[alt*="photo" i]',
);

// ── Form Fields ──────────────────────────────────────────────────────────────
export const SEL_TITLE = chain('poshmark:title',
  'input[name="title"]',
  'input[data-testid="ListingTitleInput"]',
  'input[id*="title" i]',
);

export const SEL_DESCRIPTION = chain('poshmark:description',
  'textarea[name="description"]',
  'textarea[data-testid="ListingDescriptionInput"]',
);

export const SEL_PRICE = chain('poshmark:price',
  'input[name="price"]',
  'input[data-testid="PriceInput"]',
  'input[type="number"][inputmode="numeric"]',
);

// ── Category (typische 3-Level-Auswahl: Department → Category → Subcategory)
export const SEL_CATEGORY_TRIGGER = chain('poshmark:category-trigger',
  'button[data-testid="CategoryFieldButton"]',
  'button:has-text("Category")',
  '[role="button"][aria-label*="category" i]',
);

export const SEL_CATEGORY_SEARCH = chain('poshmark:category-search',
  'input[data-testid="CategorySearch"]',
  'input[placeholder*="search" i]',
);

// ── Brand (Auto-Complete) ────────────────────────────────────────────────────
export const SEL_BRAND_INPUT = chain('poshmark:brand',
  'input[data-testid="BrandInput"]',
  'input[name="brand"]',
  'input[placeholder*="brand" i]',
);

export const SEL_BRAND_OPTION = chain('poshmark:brand-option',
  '[role="option"]',
  '[data-testid^="BrandOption"]',
  'li[role="option"]',
);

// ── Size, Condition, Color ───────────────────────────────────────────────────
export const SEL_SIZE_TRIGGER = chain('poshmark:size-trigger',
  'button[data-testid="SizeFieldButton"]',
  'button:has-text("Size")',
);

export const SEL_CONDITION_TRIGGER = chain('poshmark:condition-trigger',
  'button[data-testid="ConditionFieldButton"]',
  'button:has-text("Condition")',
);

export const SEL_COLOR_TRIGGER = chain('poshmark:color-trigger',
  'button[data-testid="ColorFieldButton"]',
  'button:has-text("Color")',
);

// Generic option from any opened drawer/modal
export const SEL_OPTION_BY_TEXT = (text: string) => chain(`poshmark:option-${text}`,
  `[role="option"]:has-text("${text}")`,
  `li:has-text("${text}")`,
  `button:has-text("${text}")`,
);

// ── Shipping ─────────────────────────────────────────────────────────────────
export const SEL_SHIPPING_TYPE_STANDARD = chain('poshmark:shipping-standard',
  'input[type="radio"][value*="STANDARD"]',
  'label:has-text("Standard")',
);

// ── Submit ───────────────────────────────────────────────────────────────────
export const SEL_PUBLISH = chain('poshmark:publish',
  'button[data-testid="ListingFormSubmitButton"]',
  'button:has-text("List")',
  'button:has-text("Submit")',
);

export const SEL_PUBLISHED_CONFIRM = chain('poshmark:published-confirm',
  '[data-testid="ListingSuccess"]',
  'h1:has-text("listed")',
  'text=/successfully listed/i',
);

// ── Item-Page Actions (deactivate) ───────────────────────────────────────────
export const SEL_ITEM_EDIT_BTN = chain('poshmark:item-edit',
  'button[data-testid="ItemEditButton"]',
  'a:has-text("Edit listing")',
);

export const SEL_ITEM_DELETE_BTN = chain('poshmark:item-delete',
  'button[data-testid="ItemDeleteButton"]',
  'button:has-text("Delete")',
);

export const SEL_ITEM_KEEP_BTN = chain('poshmark:item-keep-private',
  'button[data-testid="KeepPrivateButton"]',
  'button:has-text("Keep private")',
  'button:has-text("Hide")',
);

export const SEL_CONFIRM_DELETE = chain('poshmark:confirm-delete',
  'button[data-testid="ConfirmDeleteButton"]',
  'button:has-text("Yes, delete")',
);

// ── Bot blocks ───────────────────────────────────────────────────────────────
export const SEL_CAPTCHA = chain('poshmark:captcha',
  'iframe[src*="recaptcha"]',
  'iframe[src*="hcaptcha"]',
  '[data-testid="captcha-frame"]',
);

// ── Edit page (Update Price) ─────────────────────────────────────────────────
// TODO: validate against live poshmark.com edit page DOM.
export const SEL_EDIT_PRICE_INPUT = chain('poshmark:edit-price',
  'input[name="price"]',
  'input[data-testid="PriceInput"]',
  'input[data-testid*="price" i]',
  'input[type="number"][inputmode="numeric"]',
);

export const SEL_EDIT_SAVE_BTN = chain('poshmark:edit-save',
  'button[data-testid="ListingFormSubmitButton"]',
  'button:has-text("Update")',
  'button:has-text("Save changes")',
  'button:has-text("Save")',
  'button[type="submit"]',
);

// ── Inbox / Chats ────────────────────────────────────────────────────────────
// TODO: validate against live poshmark.com messages DOM.
// Poshmark inbox: https://www.poshmark.com/mypage/messages/  or  /inbox/
export const SEL_INBOX_ITEM = chain('poshmark:inbox-item',
  'a[href*="/messages/"]',
  'a[href*="/inbox/"]',
  '[data-testid^="conversation-"]',
  '[data-testid*="MessageThread" i]',
);

export const SEL_CHAT_HEADER_BUYER = chain('poshmark:chat-buyer',
  '[data-testid="chat-buyer-name"]',
  'header h1',
  'header [class*="username" i]',
  '[class*="ConversationHeader" i] [class*="username" i]',
);

export const SEL_CHAT_LISTING_LINK = chain('poshmark:chat-item-link',
  'a[href*="/item/"]',
  '[data-testid="chat-item-link"]',
);

export const SEL_CHAT_MESSAGE_BUBBLE = chain('poshmark:chat-msg',
  '[data-testid^="message-"]',
  '[class*="MessageBubble" i]',
  '[class*="message-bubble" i]',
  '[role="listitem"][class*="Message" i]',
);

export const SEL_CHAT_REPLY_BOX = chain('poshmark:chat-reply',
  'textarea[name="message"]',
  'textarea[placeholder*="message" i]',
  '[data-testid="MessageInput"]',
  'div[contenteditable="true"]',
);

export const SEL_CHAT_SEND_BTN = chain('poshmark:chat-send',
  'button[data-testid="SendMessageButton"]',
  'button[aria-label*="send" i]',
  'button:has-text("Send")',
);

// ── Offers ───────────────────────────────────────────────────────────────────
// Poshmark has buyer "Make Offer" workflows; seller can accept/decline.
// TODO: validate selectors against live offer messages.
export const SEL_OFFER_ACCEPT_BTN = chain('poshmark:offer-accept',
  'button[data-testid="OfferAcceptButton"]',
  'button:has-text("Accept offer")',
  'button:has-text("Accept")',
);

export const SEL_OFFER_DECLINE_BTN = chain('poshmark:offer-decline',
  'button[data-testid="OfferDeclineButton"]',
  'button:has-text("Decline offer")',
  'button:has-text("Decline")',
);

export const SEL_OFFER_CONFIRM = chain('poshmark:offer-confirm',
  'button[data-testid="ConfirmOfferButton"]',
  'button:has-text("Yes, accept")',
  'button:has-text("Yes, decline")',
  'button:has-text("Confirm")',
);

// ── Sold items ───────────────────────────────────────────────────────────────
// Poshmark profile sold tab: https://www.poshmark.com/u/<username>/?status=sold
// or /mypage/listings/?status=sold
// TODO: validate against live poshmark.com profile.
export const SEL_SOLD_LIST_ITEM = chain('poshmark:sold-item',
  'a[href*="/item/"][data-status="sold"]',
  '[data-testid="sold-item-card"] a[href*="/item/"]',
  '[class*="ItemCard" i] a[href*="/item/"]',
  'a[href*="/item/"]',
);
