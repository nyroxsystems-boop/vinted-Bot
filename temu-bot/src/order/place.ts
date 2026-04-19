import type { Page } from 'playwright';
import { createLogger, getDb, getSetting, isBotBlocked } from '@vinted-system/shared';
import type { TemuPaymentMethod, TemuVariant } from '@vinted-system/shared';
import { TEMU } from '../selectors.js';
import { getTemuBrowser } from '../browser.js';
import { requireLogin } from '../auth.js';

const log = createLogger('temu-place');

export interface PlaceOrderInput {
  saleId: number;
  temuUrl: string;
  variant: TemuVariant | null;
}

export interface PlaceOrderResult {
  ok: boolean;
  temuOrderId?: string;
  amountEur?: number;
  error?: string;
}

const MAX_ORDER_EUR = Number.parseFloat(process.env.TEMU_MAX_ORDER_EUR ?? '50');

/**
 * Place a Temu order using the user's DEFAULT saved address + saved payment
 * method. The bot never types card numbers and never edits the address —
 * these must already be configured in the Temu account.
 *
 * Business model: packages ship to the USER, who then re-ships to the Vinted
 * buyer using the Vinted-generated shipping label.
 *
 * Flow:
 *   1. Open product URL (with ?spec_id=... for color pre-selected).
 *   2. Click the variant's size button if variant.size is set.
 *   3. Click "Jetzt kaufen" (or "In den Warenkorb" → cart → checkout).
 *   4. On checkout: verify default address + saved payment are present,
 *      verify total ≤ MAX_ORDER_EUR, click "Bestellen und bezahlen".
 *   5. Capture the order ID from the confirmation page.
 *
 * Guards:
 *   • Per-order €-cap (MAX_ORDER_EUR env) checked BEFORE clicking place.
 *   • Daily-order cap enforced at the API layer.
 *   • Idempotency via temu_orders.idempotency_key = "sale-<id>".
 *   • CAPTCHA / bot-block detection pauses instead of bypassing.
 */
export async function placeTemuOrder(input: PlaceOrderInput): Promise<PlaceOrderResult> {
  const idempotencyKey = `sale-${input.saleId}`;

  const existing = getDb()
    .prepare("SELECT * FROM temu_orders WHERE idempotency_key = ? AND state != 'failed'")
    .get(idempotencyKey);
  if (existing) {
    log.warn('Temu order already exists — refusing duplicate', { idempotencyKey });
    return { ok: false, error: 'Duplicate — temu_order already placed for this sale' };
  }

  getDb()
    .prepare(
      `INSERT INTO temu_orders (sale_id, state, idempotency_key)
       VALUES (?, 'draft', ?)`,
    )
    .run(input.saleId, idempotencyKey);

  const mb = await getTemuBrowser();
  const page = await mb.context.newPage();

  try {
    await requireLogin(page);

    // ── 1. Product page ─────────────────────────────────────────────────────
    await page.goto(input.temuUrl, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    if (await handleBlock(page, input.saleId)) return finishFailed(input.saleId, 'Bot blocked');

    // Pick size if configured. Size is an explicit UI click; color is expected
    // to already be baked into the URL via ?spec_id=... (product-setup step
    // asked user to paste the URL with the color-variant query param).
    if (input.variant?.size) {
      const sizeOk = await clickSize(page, input.variant.size);
      if (!sizeOk) return finishFailed(input.saleId, `Size "${input.variant.size}" not available`);
    }

    // ── 2. Buy-Now / Add-to-Cart ────────────────────────────────────────────
    // Prefer "Jetzt kaufen"; fall back to add-to-cart + cart-checkout.
    const buyNow = page.locator(TEMU.buyNowButton).first();
    if ((await buyNow.count()) > 0) {
      await buyNow.click({ timeout: 10_000 });
    } else {
      const addCart = page.locator(TEMU.addToCartButton).first();
      if ((await addCart.count()) === 0) {
        return finishFailed(input.saleId, 'No Buy-Now and no Add-to-Cart button found');
      }
      await addCart.click({ timeout: 10_000 });
      await page.waitForTimeout(1_500);
      await page.goto(TEMU.cartUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      const checkout = page.locator('button:has-text("Zur Kasse"), button:has-text("Checkout")').first();
      if ((await checkout.count()) > 0) {
        await checkout.click({ timeout: 10_000 });
      }
    }

    // Wait for the checkout page URL.
    await page.waitForURL(/\/bgt_order_checkout\.html/, { timeout: 30_000 }).catch(() => null);
    await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {
      /* Temu pages may never reach idle */
    });

    if (await handleBlock(page, input.saleId)) return finishFailed(input.saleId, 'Bot blocked on checkout');

    // ── 3. Verify address + payment ─────────────────────────────────────────
    // Default address: we REQUIRE an edit-address button to be present, which
    // only appears when an address is already on file. If not present, user
    // hasn't set up a default address yet — abort.
    const hasAddress = await page.locator(TEMU.editAddressButton).first().count();
    if (hasAddress === 0) {
      return finishFailed(
        input.saleId,
        'No default address found. Set up a saved address in Temu before running the bot.',
      );
    }

    // Payment: Temu has no "default payment" — the bot must actively pick
    // the configured method every time.
    const paymentMethod = (getSetting('temu_payment_method') ?? 'paypal') as TemuPaymentMethod;
    const paymentResult = await selectPaymentMethod(page, paymentMethod);
    if (!paymentResult.ok) {
      return finishFailed(input.saleId, paymentResult.error ?? 'Payment method selection failed');
    }

    // ── 4. Safety cap ───────────────────────────────────────────────────────
    const totalText = (await page
      .locator(TEMU.orderTotal)
      .first()
      .innerText({ timeout: 5_000 })
      .catch(() => '')) || '';
    const totalEur = parseEuroAmount(totalText);
    if (totalEur !== null && totalEur > MAX_ORDER_EUR) {
      return finishFailed(
        input.saleId,
        `Order total €${totalEur} exceeds cap €${MAX_ORDER_EUR} — refusing to place`,
      );
    }

    // ── 5. Place order ──────────────────────────────────────────────────────
    const placeBtn = page.locator(TEMU.placeOrderButton).first();
    if ((await placeBtn.count()) === 0) {
      return finishFailed(input.saleId, 'Place-order button not found');
    }

    log.info('Placing Temu order', { saleId: input.saleId, totalEur });
    await placeBtn.click({ timeout: 15_000 });

    // ── 6. Capture confirmation ─────────────────────────────────────────────
    // Temu may redirect to /orders or show an in-page confirmation.
    await page.waitForURL(/(order|confirm)/i, { timeout: 45_000 }).catch(() => null);
    await page.waitForTimeout(3_000);

    if (await handleBlock(page, input.saleId)) {
      // If blocked AFTER clicking, the order may or may not have gone through.
      // Mark as unknown and leave for manual reconciliation.
      getDb()
        .prepare(
          `UPDATE temu_orders
             SET state = 'failed',
                 last_error = 'Challenge/captcha after place-click — MANUAL CHECK REQUIRED'
           WHERE idempotency_key = ?`,
        )
        .run(idempotencyKey);
      return { ok: false, error: 'Challenge after placing — check Temu orders manually' };
    }

    const temuOrderId = await extractOrderId(page);
    const finalTotal =
      totalEur ??
      parseEuroAmount(
        (await page.locator(TEMU.orderTotal).first().innerText({ timeout: 2_000 }).catch(() => '')) ||
          '',
      );

    getDb()
      .prepare(
        `UPDATE temu_orders
           SET temu_order_id = ?, state = 'placed', amount_eur = ?,
               placed_at = datetime('now'), last_error = NULL
         WHERE idempotency_key = ?`,
      )
      .run(temuOrderId, finalTotal, idempotencyKey);

    log.info('Temu order placed', { saleId: input.saleId, temuOrderId, amountEur: finalTotal });
    return { ok: true, temuOrderId: temuOrderId ?? undefined, amountEur: finalTotal ?? undefined };
  } catch (err) {
    return finishFailed(input.saleId, err instanceof Error ? err.message : String(err));
  } finally {
    await page.close();
  }
}

async function clickSize(page: Page, size: string): Promise<boolean> {
  const selector = TEMU.sizeButton(size);
  const btn = page.locator(selector).first();
  if ((await btn.count()) === 0) return false;
  await btn.click({ timeout: 5_000 });
  await page.waitForTimeout(500);
  return true;
}

/**
 * Click the configured payment method's option at Temu checkout.
 *
 * Temu does not have a "default payment" concept — the bot must select
 * explicitly each time. If the method isn't on the page (e.g. Temu A/B-tested
 * it away for this account) we fail loudly rather than guessing.
 *
 * If the method is PayPal and the PayPal session has expired, the bot will
 * see a login form and abort (user must re-authenticate via `npm run
 * temu:login`, which persists PayPal's cookies alongside Temu's).
 */
async function selectPaymentMethod(
  page: Page,
  method: TemuPaymentMethod,
): Promise<{ ok: boolean; error?: string }> {
  const selector = TEMU.paymentOptions[method];
  if (!selector) {
    return { ok: false, error: `Unknown payment method "${method}"` };
  }

  // Scroll payment section into view (Temu lazy-renders below the fold).
  const heading = page.locator(TEMU.paymentSectionHeading).first();
  if ((await heading.count()) > 0) {
    await heading.scrollIntoViewIfNeeded({ timeout: 3_000 }).catch(() => {
      /* non-fatal */
    });
    await page.waitForTimeout(500);
  }

  const option = page.locator(selector).first();
  if ((await option.count()) === 0) {
    return { ok: false, error: `Payment method "${method}" not found on checkout` };
  }

  await option.click({ timeout: 5_000 });
  await page.waitForTimeout(1_200);

  // PayPal-specific: if this reveals a login form, the session is dead.
  if (method === 'paypal') {
    const login = page.locator(TEMU.paypalLoginRequired).first();
    if ((await login.count()) > 0) {
      return {
        ok: false,
        error:
          'PayPal session expired. Run `npm run temu:login` and sign in to PayPal manually.',
      };
    }
  }

  return { ok: true };
}

async function handleBlock(page: Page, _saleId: number): Promise<boolean> {
  const block = await isBotBlocked(page);
  if (block.blocked) {
    log.warn('Temu bot-block detected', { reason: block.reason });
    return true;
  }
  return false;
}

async function extractOrderId(page: Page): Promise<string | null> {
  // Try selector patterns, then regex over page text.
  const direct = await page.locator(TEMU.orderConfirmationId).first()
    .innerText({ timeout: 3_000 }).catch(() => '');
  if (direct) {
    const m = direct.match(/([A-Z0-9-]{6,})/);
    if (m?.[1]) return m[1];
  }
  // URL-based fallback (if redirected to /orders/{id}).
  const urlMatch = page.url().match(/\/orders?\/([A-Z0-9-]{6,})/i);
  if (urlMatch?.[1]) return urlMatch[1];
  return null;
}

function parseEuroAmount(text: string): number | null {
  // Accept "€16.14", "16,14 €", "€ 16,14", "Gesamtsumme: €16.14".
  const m = text.match(/€?\s*(\d{1,4}(?:[.,]\d{1,2})?)/);
  if (!m?.[1]) return null;
  const n = Number.parseFloat(m[1].replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

function finishFailed(saleId: number, error: string): PlaceOrderResult {
  getDb()
    .prepare(
      `UPDATE temu_orders
         SET state = 'failed', last_error = ?
       WHERE idempotency_key = ?`,
    )
    .run(error, `sale-${saleId}`);
  log.error('Temu order failed', { saleId, error });
  return { ok: false, error };
}
