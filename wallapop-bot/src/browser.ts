import type { BrowserContext } from 'playwright';
import {
  launchMarketplaceBrowser,
  fingerprintFor,
  type Fingerprint,
} from '@vinted-system/shared';

export interface WpBrowserOptions {
  accountId: number;
  storageDir: string;
  headless?: boolean;
  proxyUrl?: string;
}

export interface WpBrowser {
  context: BrowserContext;
  fingerprint: Fingerprint;
  close: () => Promise<void>;
}

export async function launchWpBrowser(opts: WpBrowserOptions): Promise<WpBrowser> {
  // Delegate to the shared launcher — gives us Real Chrome + bundled-Chromium
  // fallback + visible-window-on-headful + WALLAPOP_PROXY env support, all
  // consistent with the other marketplace bots.
  const context = await launchMarketplaceBrowser({
    marketplace: 'wallapop',
    accountId: opts.accountId,
    // `storageDir` already includes the `<accountId>/` segment in the legacy
    // wallapop adapter — but the shared launcher expects DATA_ROOT (without
    // account-id) and adds the segment itself. Detect + normalize.
    dataRoot: opts.storageDir.replace(/\/(\d+)\/?$/, ''),
    headless: opts.headless ?? false,
    proxyUrl: opts.proxyUrl,
  });
  return {
    context,
    fingerprint: fingerprintFor(opts.accountId, 'wallapop'),
    close: async () => { try { await context.close(); } catch { /* ignore */ } },
  };
}
