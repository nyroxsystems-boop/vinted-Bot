import type { Page } from 'playwright';
import { createLogger, isBotBlocked } from '@vinted-system/shared';
import { TEMU } from './selectors.js';

const log = createLogger('temu-auth');
const BASE_URL = process.env.TEMU_BASE_URL ?? 'https://www.temu.com';

export async function isLoggedIn(page: Page): Promise<boolean> {
  const block = await isBotBlocked(page);
  if (block.blocked) {
    log.warn('Blocked during login check', { reason: block.reason });
    return false;
  }
  const indicator = page.locator(TEMU.loggedInIndicator).first();
  return (await indicator.count()) > 0;
}

export async function ensureOnTemu(page: Page): Promise<void> {
  if (!page.url().startsWith(BASE_URL)) {
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  }
}

export async function requireLogin(page: Page): Promise<void> {
  await ensureOnTemu(page);
  if (!(await isLoggedIn(page))) {
    throw new Error(
      'Temu session not authenticated. Run `npm run temu:login` first to store a session.',
    );
  }
}
