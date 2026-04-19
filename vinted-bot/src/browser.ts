import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchManagedBrowser, type ManagedBrowser } from '@vinted-system/shared';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STORAGE_DIR = path.resolve(__dirname, '..', 'playwright-data');

let managed: ManagedBrowser | null = null;

// Default to HEADLESS (background) — the Vinted window only pops up when
// the login-flow explicitly sets HEADLESS=false for its own session.
function wantHeadless(): boolean {
  return process.env.HEADLESS !== 'false';
}

export async function getVintedBrowser(): Promise<ManagedBrowser> {
  if (managed) return managed;
  managed = await launchManagedBrowser({
    scope: 'vinted-bot',
    storageDir: STORAGE_DIR,
    headless: wantHeadless(),
  });
  return managed;
}

export async function closeVintedBrowser(): Promise<void> {
  if (managed) {
    await managed.close();
    managed = null;
  }
}
