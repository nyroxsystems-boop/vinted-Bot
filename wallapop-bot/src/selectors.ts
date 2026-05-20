// Wallapop Selektoren — initiale Skizze, Multi-Stage-Fallbacks.
// Selector-Chain dumped Diagnose nach _diag/ wenn nichts matched.
import { chain } from '@vinted-system/shared';

// ── Auth ─────────────────────────────────────────────────────────────────────
export const SEL_LOGIN_EMAIL = chain('wp:email',
  'input[name="email"]',
  'input[type="email"]',
  '[data-testid="email-input"]',
);

export const SEL_LOGIN_PASSWORD = chain('wp:password',
  'input[name="password"]',
  'input[type="password"]',
);

export const SEL_LOGIN_SUBMIT = chain('wp:login-submit',
  '[data-testid="login-submit-button"]',
  'button[type="submit"]:has-text("Iniciar")',
  'button:has-text("Entrar")',
);

export const SEL_LOGGED_IN = chain('wp:logged-in',
  '[data-testid="header-avatar"]',
  'a[href*="/profile"]',
  '[data-testid="user-menu-button"]',
);

// ── Sell-Flow ────────────────────────────────────────────────────────────────
export const SEL_SELL_BTN = chain('wp:sell',
  'a[href="/app/upload"]',
  'a[href*="/upload"]',
  'button:has-text("Sube tu producto")',
  '[data-testid="sell-button"]',
);

// ── Photos ───────────────────────────────────────────────────────────────────
export const SEL_PHOTO_INPUT = chain('wp:photo-input',
  'input[type="file"][accept*="image"]',
  'input[name="photos"]',
);

export const SEL_PHOTO_THUMB = chain('wp:photo-thumb',
  '[data-testid="image-preview"]',
  'img[alt*="Imagen" i]',
  '[class*="ImagePreview" i] img',
);

// ── Form Fields ──────────────────────────────────────────────────────────────
export const SEL_TITLE = chain('wp:title',
  'input[name="title"]',
  'input[id*="title" i]',
  'input[placeholder*="título" i]',
);

export const SEL_DESCRIPTION = chain('wp:description',
  'textarea[name="description"]',
  'textarea[placeholder*="descripción" i]',
  'textarea[placeholder*="describe" i]',
);

export const SEL_PRICE = chain('wp:price',
  'input[name="price"]',
  'input[type="number"][name*="price" i]',
  'input[placeholder*="precio" i]',
);

// Category — Wallapop hat einen multi-step Wizard, oft als <select>
export const SEL_CATEGORY_DROPDOWN = chain('wp:category',
  'select[name="categoryId"]',
  '[data-testid="category-select"]',
  'button:has-text("Categoría")',
);

export const SEL_SUBCATEGORY_DROPDOWN = chain('wp:subcategory',
  'select[name="subCategoryId"]',
  '[data-testid="subcategory-select"]',
);

// Marca (Brand)
export const SEL_BRAND_INPUT = chain('wp:brand',
  'input[name="brand"]',
  'input[placeholder*="marca" i]',
);

// Talla (Size)
export const SEL_SIZE_DROPDOWN = chain('wp:size',
  'select[name="size"]',
  '[data-testid="size-select"]',
  'button:has-text("Talla")',
);

// Estado (Condition)
export const SEL_CONDITION_DROPDOWN = chain('wp:condition',
  'select[name="condition"]',
  '[data-testid="condition-select"]',
  'button:has-text("Estado")',
);

// Color
export const SEL_COLOR_DROPDOWN = chain('wp:color',
  'select[name="color"]',
  '[data-testid="color-select"]',
  'button:has-text("Color")',
);

// Generic option-by-text picker (für button/role drawers)
export const SEL_OPTION_BY_TEXT = (text: string) => chain(`wp:option-${text}`,
  `[role="option"]:has-text("${text}")`,
  `li:has-text("${text}")`,
  `button:has-text("${text}")`,
);

// Envío (Shipping toggle)
export const SEL_SHIPPING_TOGGLE = chain('wp:shipping',
  'input[name="shippingAllowed"]',
  '[data-testid="shipping-toggle"]',
  'label:has-text("Envío")',
);

// Submit
export const SEL_PUBLISH = chain('wp:publish',
  '[data-testid="upload-submit"]',
  'button[type="submit"]:has-text("Subir")',
  'button:has-text("Publicar")',
);

export const SEL_PUBLISHED_CONFIRM = chain('wp:published-confirm',
  '[data-testid="upload-success"]',
  'h1:has-text("publicado")',
  'text=/se ha publicado/i',
);

// ── Item-Page (deactivate) ───────────────────────────────────────────────────
export const SEL_ITEM_RESERVE_BTN = chain('wp:item-reserve',
  '[data-testid="item-reserve-button"]',
  'button:has-text("Reservar")',
);

export const SEL_ITEM_DELETE_BTN = chain('wp:item-delete',
  '[data-testid="item-delete-button"]',
  'button:has-text("Eliminar")',
);

export const SEL_CONFIRM_DELETE = chain('wp:confirm-delete',
  '[data-testid="confirm-delete"]',
  'button:has-text("Sí, eliminar")',
);

// Bot blocks
export const SEL_CAPTCHA = chain('wp:captcha',
  'iframe[src*="recaptcha"]',
  'iframe[src*="hcaptcha"]',
  '[data-testid="captcha-frame"]',
);

export const SEL_BLOCKED = chain('wp:blocked',
  'text=/demasiadas solicitudes/i',
  'text=/acceso bloqueado/i',
);

// ── Edit Listing (update price) ──────────────────────────────────────────────
// TODO: validate against live es.wallapop.com edit page DOM.
// Wallapop's seller-area uses /app/catalog or /upload/edit/<id> patterns.
export const SEL_EDIT_PRICE_INPUT = chain('wp:edit-price',
  'input[name="price"]',
  'input[name="sale_price"]',
  'input[placeholder*="precio" i]',
  'input[type="number"][name*="price" i]',
);

export const SEL_EDIT_SAVE_BTN = chain('wp:edit-save',
  '[data-testid="upload-edit-submit"]',
  'button[type="submit"]:has-text("Guardar")',
  'button:has-text("Guardar cambios")',
  'button:has-text("Guardar")',
  'button:has-text("Actualizar")',
);

// ── Inbox ────────────────────────────────────────────────────────────────────
// Wallapop chat URL pattern: /chat or /app/chat with conversation id.
// TODO: validate against live es.wallapop.com inbox DOM.
export const SEL_INBOX_ITEM = chain('wp:inbox-item',
  'a[href*="/chat/"]',
  'a[href*="/conversation"]',
  '[data-testid^="conversation-item"]',
  '[class*="ConversationItem" i]',
  '[role="listitem"][class*="chat" i]',
);

export const SEL_CHAT_HEADER_BUYER = chain('wp:chat-buyer',
  '[data-testid="chat-header-user"]',
  '[class*="ChatHeader" i] [class*="username" i]',
  'header h1',
);

export const SEL_CHAT_LISTING_LINK = chain('wp:chat-item-link',
  'a[href*="/item/"]',
  '[data-testid="chat-item-link"]',
);

export const SEL_CHAT_MESSAGE_BUBBLE = chain('wp:chat-msg',
  '[data-testid^="message-"]',
  '[class*="MessageBubble" i]',
  '[class*="message-bubble" i]',
  '[role="listitem"][class*="Message" i]',
);

export const SEL_CHAT_REPLY_BOX = chain('wp:chat-reply',
  'textarea[name="message"]',
  'textarea[placeholder*="mensaje" i]',
  '[data-testid="message-input"]',
  'div[contenteditable="true"]',
);

export const SEL_CHAT_SEND_BTN = chain('wp:chat-send',
  'button[data-testid="send-message-button"]',
  'button[aria-label*="enviar" i]',
  'button:has-text("Enviar")',
);

// ── Offers ───────────────────────────────────────────────────────────────────
// Wallapop has a counter-offer flow; sellers see "Aceptar" / "Rechazar".
// TODO: validate selectors against live offer message DOM.
export const SEL_OFFER_ACCEPT_BTN = chain('wp:offer-accept',
  'button[data-testid="offer-accept-button"]',
  'button:has-text("Aceptar oferta")',
  'button:has-text("Aceptar")',
);

export const SEL_OFFER_DECLINE_BTN = chain('wp:offer-decline',
  'button[data-testid="offer-decline-button"]',
  'button:has-text("Rechazar oferta")',
  'button:has-text("Rechazar")',
);

export const SEL_OFFER_CONFIRM = chain('wp:offer-confirm',
  'button[data-testid="confirm-offer-button"]',
  'button:has-text("Sí, aceptar")',
  'button:has-text("Sí, rechazar")',
  'button:has-text("Confirmar")',
);

// ── Sold items ───────────────────────────────────────────────────────────────
// Wallapop sold tab: /app/catalog/sold  (TODO: validate).
export const SEL_SOLD_LIST_ITEM = chain('wp:sold-item',
  '[data-testid="sold-item-card"] a[href*="/item/"]',
  'a[href*="/item/"][data-status="sold"]',
  '[class*="ItemCard" i] a[href*="/item/"]',
  'a[href*="/item/"]',
);
