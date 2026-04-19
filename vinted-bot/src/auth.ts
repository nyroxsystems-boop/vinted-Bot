import type { Page } from 'playwright';
import { createLogger, isBotBlocked } from '@vinted-system/shared';
import { VINTED } from './selectors.js';

const log = createLogger('vinted-auth');
const BASE_URL = process.env.VINTED_BASE_URL ?? 'https://www.vinted.de';

export async function isLoggedIn(page: Page): Promise<boolean> {
  const block = await isBotBlocked(page);
  if (block.blocked) {
    log.warn('Blocked during login check', { reason: block.reason });
    return false;
  }
  const indicator = page.locator(VINTED.loggedInIndicator).first();
  return (await indicator.count()) > 0;
}

export async function ensureOnVinted(page: Page): Promise<void> {
  if (!page.url().startsWith(BASE_URL)) {
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  }
}

export async function requireLogin(page: Page): Promise<void> {
  await ensureOnVinted(page);
  if (!(await isLoggedIn(page))) {
    throw new Error(
      'Vinted session not authenticated. Run `npm run vinted:login` first to store a session.',
    );
  }
}
