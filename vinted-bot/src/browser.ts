// ──────────────────────────────────────────────────────────────────────────────
// Account-scoped Playwright browser management.
//
// Every Vinted account gets its OWN ManagedBrowser (persistent context)
// stored under `<data>/accounts/<id>/chromium-profile/`. We cache one
// ManagedBrowser per account so repeated API calls re-use the warm session.
// ──────────────────────────────────────────────────────────────────────────────

import {
  launchManagedBrowser,
  accountBrowserDir,
  getCurrentAccountId,
  requireAccount,
  getAccount,
  type ManagedBrowser,
} from '@vinted-system/shared';

// Cache resolves to the ManagedBrowser. We store the in-flight Promise so
// two concurrent getVintedBrowser(id) calls share the same launch instead
// of racing past a cache-miss and spawning two Chromium processes (one of
// which would then leak).
const managedByAccount = new Map<number, Promise<ManagedBrowser>>();

// Visibility decision: bots run INVISIBLE by default.
//
//   BOT_VISIBLE=true → headful + visible (used by login-flow scripts that
//                       need the user to see the CAPTCHA)
//   (anything else)  → fully headless (NO window ever appears on screen)
//
// Legacy `HEADLESS=false` in the repo-root .env is intentionally IGNORED
// here — that flag predates the OFFSCREEN/BOT_VISIBLE refactor and was
// causing bots to pop windows on every account scrape.
function wantHeadless(): boolean | undefined {
  if (process.env.BOT_VISIBLE === 'true') return false;
  return undefined;  // let shared lib decide (default: headless)
}

/**
 * Get (or lazily create) the Playwright context for the given account.
 * If accountId is omitted the current-active account is used.
 *
 * Auto-recovery: if the cached context is dead (Chromium crashed / OOM /
 * timeout), we close it, clear the cache, and relaunch. Without this, a
 * single browser crash would brick ALL bot operations until manual restart.
 */
export async function getVintedBrowser(accountId?: number): Promise<ManagedBrowser> {
  const id = accountId ?? getCurrentAccountId();
  requireAccount(id);
  const cachedPromise = managedByAccount.get(id);

  if (cachedPromise) {
    let cached: ManagedBrowser;
    try {
      cached = await cachedPromise;
    } catch {
      // Prior launch failed — drop the poisoned promise and fall through
      // to a fresh launch below.
      managedByAccount.delete(id);
      return getVintedBrowser(id);
    }
    // Health probe: open a page, then close it. Both calls are real
    // failure signals — a dead context throws on newPage AND on close, so
    // unconditionally bubble the close error too. The previous version
    // swallowed close-failures with `.catch(() => null)` and returned a
    // corrupt browser to the caller.
    let healthy = false;
    try {
      const probe = await cached.context.newPage();
      await probe.close();
      healthy = true;
    } catch (err) {
      console.warn(`[vinted-bot-${id}] Browser health probe failed: ${err instanceof Error ? err.message : String(err)} — auto-recovering`);
    }
    if (healthy) return cached;
    await cached.close().catch((err) => {
      console.warn(`[vinted-bot-${id}] close() of dead browser failed: ${err instanceof Error ? err.message : String(err)}`);
    });
    managedByAccount.delete(id);
  }

  // Single-flight: store the in-flight Promise BEFORE awaiting so a
  // concurrent caller for the same account reuses it instead of launching
  // a second Chromium process.
  const storageDir = accountBrowserDir(id);
  const account = getAccount(id);
  const proxyUrl = account?.proxy_url ?? undefined;
  const launchPromise = launchManagedBrowser({
    scope: `vinted-bot-${id}`,
    storageDir,
    headless: wantHeadless(),
    proxyUrl,
  });
  managedByAccount.set(id, launchPromise);
  try {
    return await launchPromise;
  } catch (err) {
    // Don't leave a rejected promise in the cache — clear so retries can
    // start fresh.
    managedByAccount.delete(id);
    throw err;
  }
}

export async function closeVintedBrowser(accountId?: number): Promise<void> {
  if (accountId === undefined) {
    // close all — resolve each promise, log close failures (don't suppress
    // them; close errors usually mean Chromium crashed mid-shutdown).
    for (const [id, promise] of managedByAccount) {
      try {
        const mb = await promise;
        await mb.close().catch((err) => {
          console.warn(`[vinted-bot-${id}] close failed: ${err instanceof Error ? err.message : String(err)}`);
        });
      } catch {
        /* the launch itself failed — nothing to close */
      }
    }
    managedByAccount.clear();
    return;
  }
  const promise = managedByAccount.get(accountId);
  if (promise) {
    try {
      const mb = await promise;
      await mb.close().catch((err) => {
        console.warn(`[vinted-bot-${accountId}] close failed: ${err instanceof Error ? err.message : String(err)}`);
      });
    } catch {
      /* launch failed */
    }
    managedByAccount.delete(accountId);
  }
}

/**
 * Reset Profile: schließt Browser, löscht chromium-profile/, setzt logged_in=0.
 * Danach muss der User sich neu einloggen — aber Vinted's Bot-Block-Cookies
 * sind weg. Nicht reversibel!
 */
export async function resetVintedProfile(accountId: number): Promise<{ ok: boolean; error?: string }> {
  try {
    requireAccount(accountId);
    await closeVintedBrowser(accountId);
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const profileDir = path.join(accountBrowserDir(accountId), 'chromium-profile');
    await fs.rm(profileDir, { recursive: true, force: true });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
