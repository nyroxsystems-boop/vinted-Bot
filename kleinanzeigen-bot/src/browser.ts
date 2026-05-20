// ──────────────────────────────────────────────────────────────────────────────
// Kleinanzeigen-Bot Browser-Setup
//
// Nutzt fingerprintFor() aus shared für deterministische Per-Account-Profile,
// + persistent context für Cookie/Session-Erhalt.
// ──────────────────────────────────────────────────────────────────────────────

import { chromium, type BrowserContext } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import {
  createLogger,
  fingerprintFor,
  stealthInitScript,
  stealthIgnoreDefaultArgs,
  cloudflareLaunchArgs,
  getAccount,
  parseProxyUrl,
  type Fingerprint,
} from '@vinted-system/shared';

const log = createLogger('ka-browser');

export interface KaBrowserOptions {
  accountId: number;
  /** Account-Datenverzeichnis (parent für chromium-profile/). */
  storageDir: string;
  /** Default false (headful für Login-Validierung). */
  headless?: boolean;
  /** Optional Proxy URL — überschreibt Account-Proxy aus DB. */
  proxyUrl?: string;
}

export interface KaBrowser {
  context: BrowserContext;
  fingerprint: Fingerprint;
  close: () => Promise<void>;
}

export async function launchKaBrowser(opts: KaBrowserOptions): Promise<KaBrowser> {
  const fp = fingerprintFor(opts.accountId, 'kleinanzeigen');
  const userDataDir = path.join(opts.storageDir, 'chromium-profile');
  if (!fs.existsSync(userDataDir)) fs.mkdirSync(userDataDir, { recursive: true });

  // Proxy resolution: explicit opts.proxyUrl wins, else fall back to the
  // account's persisted proxy_url. NULL → direct connection.
  let effectiveProxyUrl = opts.proxyUrl;
  if (!effectiveProxyUrl) {
    const acc = getAccount(opts.accountId);
    effectiveProxyUrl = acc?.proxy_url ?? undefined;
  }
  const proxyOpt = effectiveProxyUrl
    ? parseProxyUrl(effectiveProxyUrl, `ka-bot-${opts.accountId}`)
    : undefined;

  log.info('Launching Kleinanzeigen browser', {
    accountId: opts.accountId,
    headless: opts.headless ?? (process.env.BOT_VISIBLE !== 'true'),
    fingerprint: { ua: fp.userAgent, viewport: fp.viewport, tz: fp.timezoneId },
    proxy: effectiveProxyUrl ? { server: new URL(effectiveProxyUrl).host, hasAuth: !!proxyOpt?.username } : false,
  });

  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: opts.headless ?? (process.env.BOT_VISIBLE !== 'true'),
    proxy: proxyOpt,
    userAgent: fp.userAgent,
    viewport: fp.viewport,
    locale: fp.locale,
    timezoneId: fp.timezoneId,
    ignoreDefaultArgs: stealthIgnoreDefaultArgs(),
    args: [
      ...cloudflareLaunchArgs(),
      '--disable-infobars',
      `--window-size=${fp.viewport.width},${fp.viewport.height}`,
    ],
    javaScriptEnabled: true,
    acceptDownloads: true,
  });

  await context.addInitScript(stealthInitScript(fp));

  return {
    context,
    fingerprint: fp,
    close: async () => {
      try { await context.close(); } catch { /* ignore */ }
    },
  };
}
