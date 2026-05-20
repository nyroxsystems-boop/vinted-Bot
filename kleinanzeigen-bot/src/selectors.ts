// ──────────────────────────────────────────────────────────────────────────────
// Kleinanzeigen Selector-Chains.
//
// Mehrstufige Fallback-Selektoren — wenn Position 1 nicht matched, fällt
// die Chain auf Position 2 etc. zurück und schreibt bei Total-Fail
// automatisch Screenshot + DOM-Snapshot nach _diag/.
//
// VERIFICATION: Vor Live-Betrieb mit `npm run kleinanzeigen:selftest` testen.
// ──────────────────────────────────────────────────────────────────────────────

import { chain } from '@vinted-system/shared';

// ── Login ────────────────────────────────────────────────────────────────────
export const SEL_EMAIL = chain('ka:email',
  '#login-email',
  'input[name="loginMail"]',
  'input[type="email"]',
);

export const SEL_PASSWORD = chain('ka:password',
  '#login-password',
  'input[name="password"]',
  'input[type="password"]',
);

export const SEL_LOGIN_SUBMIT = chain('ka:login-submit',
  '#login-submit',
  'button[type="submit"]',
  'button:has-text("Einloggen")',
);

export const SEL_LOGGED_IN_AVATAR = chain('ka:logged-in-avatar',
  // 2026 KA UI: header avatar is now a "Meins" dropdown button; the only
  // reliable logged-in markers are the Ausloggen link + Mitteilungen link.
  // Verified live 2026-05-15.
  'a[href*="/m-abmelden"]',
  'a[href*="/m-benachrichtigungen"]',
  'button:has-text("Meins")',
  '[data-testid="user-avatar"]',
  '#user-email',
  'a[href*="/m-meine-anzeigen.html"]',
);

// ── Anzeige aufgeben (Listing erstellen) ─────────────────────────────────────
export const SEL_NEW_AD_BTN = chain('ka:new-ad-btn',
  'a[href="/p-anzeige-aufgeben-schritt2.html"]',
  'a:has-text("Anzeige aufgeben")',
  '[data-testid="post-ad-button"]',
);

export const SEL_TITLE_INPUT = chain('ka:title',
  '#postad-title',
  'input[name="title"]',
  'input[id*="title" i]',
);

export const SEL_DESCRIPTION_TEXTAREA = chain('ka:description',
  '#pstad-descrptn',
  'textarea[name="description"]',
  'textarea#description',
);

export const SEL_PRICE_INPUT = chain('ka:price',
  '#ad-price-amount',           // verified 2026-05-12
  'input[name="priceAmount"]',
  '#pstad-price',                // legacy
  'input[name="price"]',
);

export const SEL_PRICE_TYPE_FIXED = chain('ka:price-type-fixed',
  'input[name="priceType"][value="FIXED"]',
  '#priceType_FIXED',
);

export const SEL_CATEGORY_BTN = chain('ka:category-btn',
  '#postad-category-link',
  'a:has-text("Kategorie wählen")',
);

export const SEL_PHOTO_INPUT = chain('ka:photo-input',
  'input[type="file"][accept*="image"]',
  'input.imagebox-fileinput',
);

export const SEL_SHIPPING_TOGGLE = chain('ka:shipping-toggle',
  // 2026 KA UI (per Kleidung-Kategorie): radio group with category-prefixed name
  '#ad-shipping-enabled-yes',
  'label[for="ad-shipping-enabled-yes"]',
  'input[name^="attributeMap"][name$=".versand"][value="ja"]',
  // legacy fallbacks
  'input[name="shippingMode"][value="SHIPPING"]',
  'input#shippingMode-SHIPPING',
);

export const SEL_PUBLISH_BTN = chain('ka:publish',
  '#pstad-submit',
  // KA renders the submit as <button type="button"> with text "Anzeige
  // aufgeben" (verified live 2026-05-15). Don't constrain by type=submit.
  // The header also has an <a> with the same text — we anchor in <main>
  // / <form> and prefer the last matching one.
  'main button:has-text("Anzeige aufgeben")',
  'form button:has-text("Anzeige aufgeben")',
  'button[type="submit"]:has-text("Anzeige aufgeben")',
  'button:has-text("Anzeige aufgeben"):not(a)',
);

export const SEL_PUBLISHED_CONFIRM = chain('ka:published-confirm',
  // 2026 KA: success page lives at /p-anzeige-aufgeben-bestaetigung.html OR
  // shows the new ad on /meine-anzeigen. We detect by URL or text.
  'h1:has-text("erfolgreich")',
  'h1:has-text("aufgegeben")',
  'h1:has-text("veröffentlicht")',
  'text=/Deine.*Anzeige.*ist.*(online|live|aktiv)/i',
  'text=/Anzeige.*aktiviert/i',
  '[data-testid="ad-success"]',
  '[data-testid="post-ad-success"]',
  'a[href*="/s-anzeige/"]',  // success page typically links to the new live ad
);

// ── Eigene Anzeigen verwalten ────────────────────────────────────────────────
export const SEL_MY_ADS = chain('ka:my-ads',
  'a[href="/m-meine-anzeigen.html"]',
  'a:has-text("Meine Anzeigen")',
);

// Fallback-Kette für den Deaktivieren-Button. Falls KA das Markup ändert
// (Button → Link → data-testid → aria-label), darf cross-sync NICHT stillschweigend
// scheitern. Reihenfolge: spezifischste/zuverlässigste Anker zuerst.
export const SEL_AD_DEACTIVATE_BTN = chain('ka:deactivate',
  '[data-testid="deactivate-btn"]',
  '[data-testid="ad-deactivate-button"]',
  'button[aria-label*="eaktivier" i]',
  'a[href*="deactivate"]',
  'button:has-text("Deaktivieren")',
  'a:has-text("Deaktivieren")',
  'button:has-text("Anzeige beenden")',
  'a:has-text("Anzeige beenden")',
  'button:has-text("Anzeige deaktivieren")',
  'a:has-text("Anzeige deaktivieren")',
);

// Bestätigung dass die Deaktivierung tatsächlich durchging — entweder
// Success-Toast/-Heading oder URL-Pfad auf "deactivated".
export const SEL_DEACTIVATED_CONFIRM = chain('ka:deactivated-confirm',
  '[data-testid="deactivation-success"]',
  'text=/Anzeige.*deaktiviert/i',
  'text=/erfolgreich deaktiviert/i',
  'text=/Anzeige.*beendet/i',
  '[role="status"]:has-text("deaktiviert")',
  '[role="alert"]:has-text("deaktiviert")',
);

// ── Inbox / Conversations ────────────────────────────────────────────────────
// Postfach-URL: https://www.kleinanzeigen.de/m-postfach.html
export const SEL_INBOX_LINK = chain('ka:inbox-link',
  'a[href="/m-postfach.html"]',
  'a[href*="/m-postfach"]',
  'a:has-text("Postfach")',
  'a:has-text("Nachrichten")',
);

// Liste der Conversations im Postfach
export const SEL_CONV_LIST_ITEM = chain('ka:conv-list-item',
  'a[href*="/m-postfach-nachrichten.html"]',
  '[data-testid="conversation-item"]',
  '[class*="conversation-item" i]',
  'a[href*="/conversations/"]',
);

// Innerhalb einer Conversation:
export const SEL_CONV_PARTNER_NAME = chain('ka:conv-partner',
  '[data-testid="conversation-partner"]',
  '[class*="ConversationPartner" i]',
  'h2',
);

export const SEL_CONV_AD_TITLE = chain('ka:conv-ad-title',
  '[data-testid="conversation-ad-title"]',
  'a[href*="/s-anzeige/"]',
  '[class*="ad-title" i]',
);

export const SEL_CONV_AD_LINK = chain('ka:conv-ad-link',
  'a[href*="/s-anzeige/"]',
);

export const SEL_MSG_BUBBLES = chain('ka:msg-bubbles',
  '[data-testid="message-item"]',
  '[class*="message-item" i]',
  '[role="article"]',
);

// Reply-Form
export const SEL_REPLY_TEXTAREA = chain('ka:reply-textarea',
  'textarea[name="message"]',
  'textarea[placeholder*="Nachricht" i]',
  'textarea[id*="message" i]',
);

export const SEL_REPLY_SUBMIT = chain('ka:reply-submit',
  'button[type="submit"]:has-text("Senden")',
  '[data-testid="send-message-button"]',
  'button:has-text("Antwort senden")',
);

// ── Bot-Block-Detection ──────────────────────────────────────────────────────
export const SEL_CAPTCHA = chain('ka:captcha',
  'iframe[src*="hcaptcha"]',
  'iframe[src*="recaptcha"]',
  '[data-testid="captcha"]',
);

export const SEL_BLOCKED = chain('ka:blocked',
  'text=/zu viele Anfragen/i',
  'text=/automatisierte Zugriffe/i',
  '#error-page',
);
