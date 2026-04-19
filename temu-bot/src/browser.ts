import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchManagedBrowser, type ManagedBrowser } from '@vinted-system/shared';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STORAGE_DIR = path.resolve(__dirname, '..', 'playwright-data');

let managed: ManagedBrowser | null = null;

export async function getTemuBrowser(): Promise<ManagedBrowser> {
  if (managed) return managed;
  managed = await launchManagedBrowser({
    scope: 'temu-bot',
    storageDir: STORAGE_DIR,
    headless: process.env.HEADLESS === 'true',
  });
  return managed;
}

export async function closeTemuBrowser(): Promise<void> {
  if (managed) {
    await managed.close();
    managed = null;
  }
}
