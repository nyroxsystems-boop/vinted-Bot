// ──────────────────────────────────────────────────────────────────────────────
// Auto-Feedback — gives the buyer a 5-star review with the configured
// template, so our seller reputation keeps growing without manual work.
//
// Vinted exposes the "Bewertung abgeben" button on the sale's transaction
// page once the buyer has left their own review OR the grace period has
// passed. If no button is visible, we skip silently — the scheduler will
// retry on the next pass.
// ──────────────────────────────────────────────────────────────────────────────

import { createLogger, getDb, getSetting } from '@vinted-system/shared';
import type { Sale } from '@vinted-system/shared';
import { VINTED } from '../selectors.js';
import { getVintedBrowser } from '../browser.js';
import { requireLogin } from '../auth.js';

const log = createLogger('vinted-feedback');
const BASE_URL = process.env.VINTED_BASE_URL ?? 'https://www.vinted.de';

// Selectors for the feedback dialog — kept local because they're not part
// of the verified set in selectors.ts. Loose fallback chain on purpose.
const FEEDBACK = {
  openButton: [
    'button:has-text("Bewertung abgeben")',
    'button:has-text("Leave feedback")',
    'a:has-text("Bewertung")',
  ].join(', '),
  fiveStarButton: [
    '[data-testid="feedback-star-5"]',
    'button[aria-label*="5 Sterne" i]',
    'button[aria-label*="5 stars" i]',
    'svg[data-rating="5"]',
  ].join(', '),
  commentTextarea: 'textarea[name="feedback"], textarea[placeholder*="Bewertung" i], textarea',
  submitButton: [
    'button[type="submit"]:has-text("Senden")',
    'button:has-text("Absenden")',
    'button:has-text("Submit")',
  ].join(', '),
};

export interface LeaveFeedbackResult {
  ok: boolean;
  skipped?: boolean;
  error?: string;
}

export async function leaveFeedbackForSale(
  saleId: number,
  accountId: number,
): Promise<LeaveFeedbackResult> {
  const db = getDb();
  const sale = db
    .prepare('SELECT * FROM sales WHERE id = ?')
    .get(saleId) as Sale | undefined;
  if (!sale) return { ok: false, error: `Sale ${saleId} not found` };
  if (sale.feedback_left_at) return { ok: true, skipped: true };

  const template = getSetting('auto_feedback_template')
    ?? 'Super Käufer:in, alles reibungslos! Gerne wieder 💕';

  const mb = await getVintedBrowser(accountId);
  const page = await mb.context.newPage();

  try {
    await requireLogin(page, accountId);
    await page.goto(`${BASE_URL}${VINTED.soldItemsUrl}`, {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => null);

    // Find sale row by buyer name.
    const row = page
      .locator(`main :has-text(${JSON.stringify(sale.buyer_name)})`)
      .first();
    await row.waitFor({ state: 'visible', timeout: 8_000 }).catch(() => null);

    const openBtn = page.locator(FEEDBACK.openButton).first();
    if ((await openBtn.count()) === 0) {
      return { ok: false, skipped: true, error: 'No feedback button available yet' };
    }
    await openBtn.click({ timeout: 5_000 });
    await page.waitForTimeout(800);

    const star = page.locator(FEEDBACK.fiveStarButton).first();
    await star.waitFor({ state: 'visible', timeout: 5_000 });
    await star.click();
    await page.waitForTimeout(300);

    const textarea = page.locator(FEEDBACK.commentTextarea).first();
    if (await textarea.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await textarea.fill(template);
    }

    const submit = page.locator(FEEDBACK.submitButton).first();
    await submit.click({ timeout: 5_000 });
    await page.waitForTimeout(1_500);

    db.prepare(
      `UPDATE sales SET feedback_left_at = datetime('now') WHERE id = ?`,
    ).run(saleId);

    log.info('Feedback left', { saleId });
    return { ok: true };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    log.warn('Feedback failed', { saleId, error });
    return { ok: false, error };
  } finally {
    await page.close().catch(() => null);
  }
}
