// Willhaben Selektoren — initiale Skizze, Multi-Stage-Fallbacks.
// Vor Live-Betrieb verifizieren — Selector-Chain dumped Diagnose nach _diag/
// wenn nichts matched.
import { chain } from '@vinted-system/shared';

// ── Auth ─────────────────────────────────────────────────────────────────────
export const SEL_LOGIN_EMAIL = chain('willhaben:email',
  'input[name="emailOrPhone"]',
  'input[type="email"]',
  'input[data-testid="email-input"]',
);

export const SEL_LOGIN_PASSWORD = chain('willhaben:password',
  'input[name="password"]',
  'input[type="password"]',
);

export const SEL_LOGIN_SUBMIT = chain('willhaben:login-submit',
  'button[data-testid="LoginButton"]',
  'button[type="submit"]',
);

export const SEL_LOGGED_IN = chain('willhaben:logged-in',
  '[data-testid="header-avatar"]',
  'a[href*="/mypage"]',
  '[data-testid="user-avatar-button"]',
);

// ── Sell-Flow Entry ──────────────────────────────────────────────────────────
export const SEL_SELL_BTN = chain('willhaben:sell',
  'a[href="/sell"]',
  'a[href="/sell/"]',
  'button:has-text("Sell")',
  '[data-testid="sell-button"]',
);

// ── Photos ───────────────────────────────────────────────────────────────────
export const SEL_PHOTO_INPUT = chain('willhaben:photo-input',
  'input[type="file"][accept*="image"]',
  'input[data-testid="ProductPhotoInput"]',
  'input[name="photos"]',
);

export const SEL_PHOTO_THUMB = chain('willhaben:photo-thumb',
  '[data-testid="PhotoUploadedThumbnail"]',
  '[class*="PhotoThumbnail" i]',
  'img[alt*="photo" i]',
);

// ── Form Fields ──────────────────────────────────────────────────────────────
export const SEL_TITLE = chain('willhaben:title',
  'input[name="title"]',
  'input[data-testid="ListingTitleInput"]',
  'input[id*="title" i]',
);

export const SEL_DESCRIPTION = chain('willhaben:description',
  'textarea[name="description"]',
  'textarea[data-testid="ListingDescriptionInput"]',
);

export const SEL_PRICE = chain('willhaben:price',
  'input[name="price"]',
  'input[data-testid="PriceInput"]',
  'input[type="number"][inputmode="numeric"]',
);

// ── Category (typische 3-Level-Auswahl: Department → Category → Subcategory)
export const SEL_CATEGORY_TRIGGER = chain('willhaben:category-trigger',
  'button[data-testid="CategoryFieldButton"]',
  'button:has-text("Category")',
  '[role="button"][aria-label*="category" i]',
);

export const SEL_CATEGORY_SEARCH = chain('willhaben:category-search',
  'input[data-testid="CategorySearch"]',
  'input[placeholder*="search" i]',
);

// ── Brand (Auto-Complete) ────────────────────────────────────────────────────
export const SEL_BRAND_INPUT = chain('willhaben:brand',
  'input[data-testid="BrandInput"]',
  'input[name="brand"]',
  'input[placeholder*="brand" i]',
);

export const SEL_BRAND_OPTION = chain('willhaben:brand-option',
  '[role="option"]',
  '[data-testid^="BrandOption"]',
  'li[role="option"]',
);

// ── Size, Condition, Color ───────────────────────────────────────────────────
export const SEL_SIZE_TRIGGER = chain('willhaben:size-trigger',
  'button[data-testid="SizeFieldButton"]',
  'button:has-text("Size")',
);

export const SEL_CONDITION_TRIGGER = chain('willhaben:condition-trigger',
  'button[data-testid="ConditionFieldButton"]',
  'button:has-text("Condition")',
);

export const SEL_COLOR_TRIGGER = chain('willhaben:color-trigger',
  'button[data-testid="ColorFieldButton"]',
  'button:has-text("Color")',
);

// Generic option from any opened drawer/modal
export const SEL_OPTION_BY_TEXT = (text: string) => chain(`willhaben:option-${text}`,
  `[role="option"]:has-text("${text}")`,
  `li:has-text("${text}")`,
  `button:has-text("${text}")`,
);

// ── Shipping ─────────────────────────────────────────────────────────────────
export const SEL_SHIPPING_TYPE_STANDARD = chain('willhaben:shipping-standard',
  'input[type="radio"][value*="STANDARD"]',
  'label:has-text("Standard")',
);

// ── Submit ───────────────────────────────────────────────────────────────────
export const SEL_PUBLISH = chain('willhaben:publish',
  'button[data-testid="ListingFormSubmitButton"]',
  'button:has-text("List")',
  'button:has-text("Submit")',
);

export const SEL_PUBLISHED_CONFIRM = chain('willhaben:published-confirm',
  '[data-testid="ListingSuccess"]',
  'h1:has-text("listed")',
  'text=/successfully listed/i',
);

// ── Item-Page Actions (deactivate) ───────────────────────────────────────────
export const SEL_ITEM_EDIT_BTN = chain('willhaben:item-edit',
  'button[data-testid="ItemEditButton"]',
  'a:has-text("Edit listing")',
);

export const SEL_ITEM_DELETE_BTN = chain('willhaben:item-delete',
  'button[data-testid="ItemDeleteButton"]',
  'button:has-text("Delete")',
);

export const SEL_ITEM_KEEP_BTN = chain('willhaben:item-keep-private',
  'button[data-testid="KeepPrivateButton"]',
  'button:has-text("Keep private")',
  'button:has-text("Hide")',
);

export const SEL_CONFIRM_DELETE = chain('willhaben:confirm-delete',
  'button[data-testid="ConfirmDeleteButton"]',
  'button:has-text("Yes, delete")',
);

// ── Bot blocks ───────────────────────────────────────────────────────────────
export const SEL_CAPTCHA = chain('willhaben:captcha',
  'iframe[src*="recaptcha"]',
  'iframe[src*="hcaptcha"]',
  '[data-testid="captcha-frame"]',
);

// ── Edit page (Update Price) ─────────────────────────────────────────────────
// TODO: validate against live willhaben.com edit page DOM.
export const SEL_EDIT_PRICE_INPUT = chain('willhaben:edit-price',
  'input[name="price"]',
  'input[data-testid="PriceInput"]',
  'input[data-testid*="price" i]',
  'input[type="number"][inputmode="numeric"]',
);

export const SEL_EDIT_SAVE_BTN = chain('willhaben:edit-save',
  'button[data-testid="ListingFormSubmitButton"]',
  'button:has-text("Update")',
  'button:has-text("Save changes")',
  'button:has-text("Save")',
  'button[type="submit"]',
);

// ── Inbox / Chats ────────────────────────────────────────────────────────────
// TODO: validate against live willhaben.com messages DOM.
// Willhaben inbox: https://www.willhaben.com/mypage/messages/  or  /inbox/
export const SEL_INBOX_ITEM = chain('willhaben:inbox-item',
  'a[href*="/messages/"]',
  'a[href*="/inbox/"]',
  '[data-testid^="conversation-"]',
  '[data-testid*="MessageThread" i]',
);

export const SEL_CHAT_HEADER_BUYER = chain('willhaben:chat-buyer',
  '[data-testid="chat-buyer-name"]',
  'header h1',
  'header [class*="username" i]',
  '[class*="ConversationHeader" i] [class*="username" i]',
);

export const SEL_CHAT_LISTING_LINK = chain('willhaben:chat-item-link',
  'a[href*="/item/"]',
  '[data-testid="chat-item-link"]',
);

export const SEL_CHAT_MESSAGE_BUBBLE = chain('willhaben:chat-msg',
  '[data-testid^="message-"]',
  '[class*="MessageBubble" i]',
  '[class*="message-bubble" i]',
  '[role="listitem"][class*="Message" i]',
);

export const SEL_CHAT_REPLY_BOX = chain('willhaben:chat-reply',
  'textarea[name="message"]',
  'textarea[placeholder*="message" i]',
  '[data-testid="MessageInput"]',
  'div[contenteditable="true"]',
);

export const SEL_CHAT_SEND_BTN = chain('willhaben:chat-send',
  'button[data-testid="SendMessageButton"]',
  'button[aria-label*="send" i]',
  'button:has-text("Send")',
);

// ── Offers ───────────────────────────────────────────────────────────────────
// Willhaben has buyer "Make Offer" workflows; seller can accept/decline.
// TODO: validate selectors against live offer messages.
export const SEL_OFFER_ACCEPT_BTN = chain('willhaben:offer-accept',
  'button[data-testid="OfferAcceptButton"]',
  'button:has-text("Accept offer")',
  'button:has-text("Accept")',
);

export const SEL_OFFER_DECLINE_BTN = chain('willhaben:offer-decline',
  'button[data-testid="OfferDeclineButton"]',
  'button:has-text("Decline offer")',
  'button:has-text("Decline")',
);

export const SEL_OFFER_CONFIRM = chain('willhaben:offer-confirm',
  'button[data-testid="ConfirmOfferButton"]',
  'button:has-text("Yes, accept")',
  'button:has-text("Yes, decline")',
  'button:has-text("Confirm")',
);

// ── Sold items ───────────────────────────────────────────────────────────────
// Willhaben profile sold tab: https://www.willhaben.com/u/<username>/?status=sold
// or /mypage/listings/?status=sold
// TODO: validate against live willhaben.com profile.
export const SEL_SOLD_LIST_ITEM = chain('willhaben:sold-item',
  'a[href*="/item/"][data-status="sold"]',
  '[data-testid="sold-item-card"] a[href*="/item/"]',
  '[class*="ItemCard" i] a[href*="/item/"]',
  'a[href*="/item/"]',
);
