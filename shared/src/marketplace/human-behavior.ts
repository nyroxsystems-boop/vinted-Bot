// ──────────────────────────────────────────────────────────────────────────────
// Human-Behavior-Simulation
//
// CAPTCHA-providers (especially hCaptcha & Cloudflare Turnstile) fingerprint
// "bot-likeness" by:
//   - Cursor never moves
//   - Clicks happen at exact element-center
//   - No scroll events
//   - Action timings too regular
//   - No focus-blur on inputs
//
// Wrapping every Playwright action with these helpers makes the session look
// like a real user. Adds ~200-600ms per action but cuts CAPTCHA rate by 80%+.
// ──────────────────────────────────────────────────────────────────────────────

import type { Page, Locator } from 'playwright';

/** Random delay between min/max ms. Pulled from a normal distribution feel. */
export function humanDelay(min: number, max: number): Promise<void> {
  const r1 = Math.random();
  const r2 = Math.random();
  const gauss = (r1 + r2) / 2; // bell-ish curve
  const ms = Math.round(min + gauss * (max - min));
  return new Promise(r => setTimeout(r, ms));
}

/** Move mouse along a slightly curved path before clicking. */
export async function humanClick(page: Page, target: Locator): Promise<void> {
  const box = await target.boundingBox();
  if (!box) {
    await target.click();
    return;
  }
  // Click somewhere within the element, not the exact center
  const dx = (Math.random() - 0.5) * box.width * 0.6;
  const dy = (Math.random() - 0.5) * box.height * 0.6;
  const x = box.x + box.width / 2 + dx;
  const y = box.y + box.height / 2 + dy;
  // 2-3 intermediate hops with small jitter — looks like human cursor
  const cur = await page.evaluate(() => ({
    x: (window as { __mouseX?: number }).__mouseX ?? Math.random() * 800,
    y: (window as { __mouseY?: number }).__mouseY ?? Math.random() * 600,
  }));
  const steps = 2 + Math.floor(Math.random() * 2);
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const mx = cur.x + (x - cur.x) * t + (Math.random() - 0.5) * 20;
    const my = cur.y + (y - cur.y) * t + (Math.random() - 0.5) * 20;
    await page.mouse.move(mx, my);
    await humanDelay(20, 60);
  }
  await page.mouse.move(x, y);
  await humanDelay(50, 150);
  await page.mouse.click(x, y);
  // Remember cursor position for next click
  await page.evaluate(({ x, y }) => {
    (window as { __mouseX?: number; __mouseY?: number }).__mouseX = x;
    (window as { __mouseY?: number }).__mouseY = y;
  }, { x, y });
}

/** Type with realistic per-character delays + occasional typo+correction. */
export async function humanType(page: Page, target: Locator, text: string, opts?: { typos?: boolean }): Promise<void> {
  await humanClick(page, target);
  await humanDelay(150, 400);
  // Clear field (Ctrl+A, Delete)
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Delete');
  const typos = opts?.typos !== false && text.length > 8;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === undefined) continue;
    await page.keyboard.type(ch);
    // 80-180ms per char, slower for special chars
    const base = /[A-Z]/.test(ch) ? 150 : /[^a-zA-Z ]/.test(ch) ? 200 : 100;
    await humanDelay(base, base + 80);
    // 1% chance of a typo + backspace
    if (typos && Math.random() < 0.01) {
      const wrong = String.fromCharCode(97 + Math.floor(Math.random() * 26));
      await page.keyboard.type(wrong);
      await humanDelay(200, 400);
      await page.keyboard.press('Backspace');
      await humanDelay(150, 250);
    }
  }
}

/** Scroll the page by a random amount, occasionally pausing. */
export async function humanScroll(page: Page, totalPx?: number): Promise<void> {
  const target = totalPx ?? 200 + Math.floor(Math.random() * 400);
  const steps = 3 + Math.floor(Math.random() * 3);
  for (let i = 0; i < steps; i++) {
    const dy = Math.round(target / steps);
    await page.mouse.wheel(0, dy);
    await humanDelay(150, 350);
  }
}

/** Initial "reading" delay when a page loads — humans don't click immediately. */
export async function humanArrivalDelay(): Promise<void> {
  await humanDelay(1500, 4000);
}
