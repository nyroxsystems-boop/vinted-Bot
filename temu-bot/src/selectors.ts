// ──────────────────────────────────────────────────────────────────────────────
// Temu selectors — VERIFIED against live logged-in UI (April 2026).
//
// VERIFIED URL patterns:
//   • Homepage:      https://www.temu.com/  (language in /de prefix)
//   • Product:       https://www.temu.com/de/{slug}-g-{goodsId}.html?spec_id={colorId}
//                    — goods_id is the numeric after "-g-"
//                    — spec_id in query pre-selects color / primary variant
//   • Checkout:      https://www.temu.com/bgt_order_checkout.html?...
//   • Cart header:   link aria-label="Zum Warenkorb" (relative /cart.html)
//   • Orders:        link aria-label="Bestellungen und Konto"
//
// VERIFIED selectors (checkout flow):
//   • Size buttons:       plain <button> with exact text "XS"/"S"/"M"/"L"/"XL"
//   • Quantity input:     <input type="number" aria-label="Menge wählen">
//                         (on checkout: aria-label="Menge")
//   • Buy-Now-Disabled:   button text "Wählen Sie eine Option aus"
//                         → becomes clickable once a size is selected, text
//                         typically changes to "Jetzt kaufen" or
//                         "In den Warenkorb"
//   • Place-order:        button text pattern "Bestellen und bezahlen (N)"
//                         where N = number of items
//   • Edit address btn:   button text "Adresse bearbeiten"
//   • Shipping options:   3 radio groups, each containing a link describing
//                         delivery time + carrier (Hermes/DHL/GLS)
//
// UNVERIFIED (need completed-order state):
//   • Exact placement of the saved-payment-method selector
//   • Post-order confirmation page selectors (order ID, tracking)
//   • Order-history row structure for tracking polling
//
// Re-shipping business model (verified with user):
//   Temu ships TO THE USER (default saved address). User re-ships to the
//   Vinted buyer using Vinted's auto-generated shipping label. The Temu bot
//   therefore does NOT fill any address form — it trusts the default
//   saved address + default saved payment method.
// ──────────────────────────────────────────────────────────────────────────────

export const TEMU = {
  // ── URLs ──────────────────────────────────────────────────────────────────
  homeUrl: 'https://www.temu.com/de',
  cartUrl: 'https://www.temu.com/cart.html',
  ordersUrl: 'https://www.temu.com/orders.html',
  checkoutUrlPrefix: 'https://www.temu.com/bgt_order_checkout.html',

  // ── Auth ──────────────────────────────────────────────────────────────────
  loggedInIndicator: [
    'a[aria-label="Bestellungen und Konto"]',
    'a[aria-label*="Account"]',
    'a[href*="/orders"]',
  ].join(', '),

  // ── Product page ──────────────────────────────────────────────────────────
  // Size buttons are plain <button> with the size text as innerText.
  // Exact-match regex to avoid matching "XS" inside longer strings.
  sizeButton: (size: string) =>
    `button:text-is("${size.toUpperCase()}"), button:text-is("${size.toLowerCase()}")`,

  // Selected-size state uses aria-pressed or a specific class — the fallback
  // here relies on visual inspection AFTER click.
  sizeButtonSelected: 'button[aria-pressed="true"]',

  // Variant options container.
  variantOptionAny: 'button[aria-label^="Farbe"], button[aria-label^="Color"], button[role="option"]',

  // Quantity inputs.
  quantityProductPage: 'input[type="number"][aria-label="Menge wählen"]',
  quantityCheckout: 'input[type="number"][aria-label="Menge"]',

  // Call-to-action buttons on product page.
  // VERIFIED text variants (German): "Wählen Sie eine Option aus" (disabled
  // until size selected), then "Jetzt kaufen" or "In den Warenkorb".
  addToCartButton: [
    'button:has-text("Jetzt kaufen")',
    'button:has-text("In den Warenkorb")',
    'button:has-text("Zum Warenkorb")',
    'button:has-text("Add to cart")',
  ].join(', '),

  buyNowButton: [
    'button:has-text("Jetzt kaufen")',
    'button:has-text("Buy now")',
  ].join(', '),

  disabledVariantButton: 'button:has-text("Wählen Sie eine Option aus")',

  // ── Checkout ──────────────────────────────────────────────────────────────
  // VERIFIED: Temu's checkout shows the user's DEFAULT saved address at the
  // top with an "Adresse bearbeiten" button. The bot does NOT click this —
  // it trusts the pre-selected default.
  editAddressButton: 'button:has-text("Adresse bearbeiten")',

  // Shipping method: 3 radio options shown. Bot picks the CHEAPEST
  // (Standard — usually pre-selected by default).
  shippingOptionStandard:
    'button:has-text("Standard"), label:has-text("Standard") input[type="radio"]',

  // ── Payment methods ───────────────────────────────────────────────────────
  // VERIFIED from live checkout (April 2026): Temu does NOT have a
  // "default-payment-method" concept. The user picks one each time. The
  // bot therefore must ACTIVELY click the configured payment-method option
  // before clicking Bestellen-und-bezahlen.
  //
  // Available methods (in order shown at Temu checkout):
  //   • PayPal
  //   • Bezahlen Nach 30 Tagen  (BNPL, Klarna-powered)
  //   • Rechnung                 (pay within 30 days, no interest)
  //   • Sofort bezahlen          (SEPA / Sofortüberweisung / Lastschrift / Karte)
  //   • Karte                    (direct card payment, may trigger 3DS)
  //   • Apple Pay                ← device-biometric, cannot be automated
  //   • Google Pay               ← device-biometric, cannot be automated
  //   • Pay By Bank              ← bank-login redirect, cannot be automated
  //
  // Bot-compatible methods (after one-time manual first login):
  //   • paypal    — session cookie persists; subsequent orders auto-confirm
  //   • bnpl30    — "Bezahlen Nach 30 Tagen"; click-through only
  //   • rechnung  — "Rechnung"; click-through, may ask for birthday once
  //   • karte     — direct card if saved in Temu profile (NO 3DS)
  //
  // Section heading is "Zahlungsarten".
  paymentSectionHeading: 'text=/Zahlungsarten/i',

  // Each payment option in the list is a clickable option (role=radio,
  // button, or a container wrapping both). Text-match is the most stable
  // anchor because Temu doesn't emit data-testids here.
  paymentOptions: {
    paypal: [
      'label:has-text("PayPal")',
      '[role="radio"]:has-text("PayPal")',
      'button:has-text("PayPal")',
    ].join(', '),
    bnpl30: [
      'label:has-text("Bezahlen Nach 30 Tagen")',
      '[role="radio"]:has-text("Bezahlen Nach 30 Tagen")',
      'button:has-text("Bezahlen Nach 30 Tagen")',
    ].join(', '),
    rechnung: [
      'label:has-text("Rechnung"):not(:has-text("Bezahlen"))',
      '[role="radio"]:has-text("Rechnung"):not(:has-text("Bezahlen"))',
      'button:has-text("Rechnung"):not(:has-text("Bezahlen"))',
    ].join(', '),
    sofort: [
      'label:has-text("Sofort bezahlen")',
      '[role="radio"]:has-text("Sofort bezahlen")',
      'button:has-text("Sofort bezahlen")',
    ].join(', '),
    karte: [
      'label:text-is("Karte")',
      '[role="radio"][aria-label="Karte"]',
    ].join(', '),
  },

  // After picking PayPal, Temu renders a confirmation popup / iframe. If
  // the browser is not PayPal-logged-in, this opens a PayPal login page.
  // Bot detects that and aborts with a clear error.
  paypalLoginRequired: [
    'input[type="email"][name*="login"]',
    'input#email',
    'text=/Mit Ihrem PayPal-Konto einloggen/i',
  ].join(', '),

  // Generic check — any payment option must be visibly SELECTED before
  // clicking Bestellen. Temu marks the chosen option with aria-checked="true"
  // or with a CSS state that includes the word "selected" / "active".
  paymentOptionSelected: [
    '[aria-checked="true"]',
    '[aria-pressed="true"]',
    '[class*="selected"]:has-text("€")',
  ].join(', '),

  // Tree-donation checkbox — bot should leave it UNCHECKED to not add
  // €0.30 donation to each order.
  treeDonationRadio:
    'button:has-text("Wir laden dich ein, 0,30€ für einen Baum zu spenden") input[type="radio"], button[aria-label*="Baum"] input[type="radio"]',

  // The place-order button text is "Bestellen und bezahlen (N)" where N
  // is the item count. We match the prefix.
  placeOrderButton: [
    'button:has-text("Bestellen und bezahlen")',
    'button:has-text("Place order and pay")',
  ].join(', '),

  // Order total shown on checkout page.
  orderTotal: [
    'text=/Gesamtsumme[^0-9]*€?\\s*\\d/i',
    'text=/Total[^0-9]*€?\\s*\\d/i',
  ].join(', '),

  // ── Confirmation / order pages ────────────────────────────────────────────
  // UNVERIFIED — pattern is an educated guess. Temu typically redirects to
  // /orders/{id} or shows an in-page confirmation with the order-id.
  orderConfirmationId: [
    '[data-testid="order-id"]',
    '[data-testid="order-number"]',
    'text=/Bestellnummer\\s*[:#]\\s*([A-Z0-9-]{6,})/i',
    'text=/Order\\s*#?\\s*([A-Z0-9-]{6,})/i',
  ].join(', '),

  // ── Orders list (tracking) ────────────────────────────────────────────────
  orderRow: [
    '[data-testid^="order-row"]',
    '[data-order-id]',
  ].join(', '),
  orderStatus: [
    '[data-testid="order-status"]',
    '.order-status',
  ].join(', '),
  trackingNumber: [
    '[data-testid="tracking"]',
    '[data-testid="tracking-number"]',
    'text=/Tracking[:#\\s]+([A-Z0-9]{8,})/i',
  ].join(', '),
} as const;
