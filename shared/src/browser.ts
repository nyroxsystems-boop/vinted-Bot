// ──────────────────────────────────────────────────────────────────────────────
// Shared Playwright helper.
//
// Uses `chromium.launchPersistentContext(userDataDir)` — a full Chromium
// profile on disk — so the browser actually behaves like a real user's
// Chrome: Password Manager works, Autofill history is kept, Google-SSO
// "Continue with …" remembers accounts, session cookies + localStorage
// persist across restarts.
//
// Trade-off: the user-data-dir is not encrypted. Because this runs locally
// on the user's machine the security surface is the same as their own
// Chrome profile.
// ──────────────────────────────────────────────────────────────────────────────

import { chromium, type BrowserContext, type Page } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createLogger } from './logger.js';

export interface BrowserSetup {
  scope: string;
  storageDir: string; // parent dir; persistent profile lives inside
  headless?: boolean;
  /**
   * Optional residential/proxy URL. Format: `http://user:pass@host:port`,
   * `https://...`, `socks5://...`. Routes ALL traffic from this browser
   * context through the proxy. Auth credentials (if present) are URL-decoded
   * before being passed to Playwright.
   */
  proxyUrl?: string;
}

/**
 * Parse a proxy URL into Playwright's `proxy` option shape.
 * Throws with a clear message if the URL is malformed.
 */
export function parseProxyUrl(proxyUrl: string, scope: string): {
  server: string;
  username?: string;
  password?: string;
} {
  try {
    const u = new URL(proxyUrl);
    return {
      server: `${u.protocol}//${u.host}`,
      username: u.username ? decodeURIComponent(u.username) : undefined,
      password: u.password ? decodeURIComponent(u.password) : undefined,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Proxy-URL ungültig für ${scope}: ${msg}`);
  }
}

export interface ManagedBrowser {
  context: BrowserContext;
  /** Persistent context auto-saves — kept for back-compat as a no-op. */
  saveState: () => Promise<void>;
  close: () => Promise<void>;
}

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

export async function launchManagedBrowser(opts: BrowserSetup): Promise<ManagedBrowser> {
  const log = createLogger(opts.scope);

  // Chromium profile directory (everything lives here: cookies, localStorage,
  // password manager DB, autofill, cache).
  const userDataDir = path.join(opts.storageDir, 'chromium-profile');
  if (!fs.existsSync(userDataDir)) {
    fs.mkdirSync(userDataDir, { recursive: true });
  }
  const hadProfile = fs.existsSync(path.join(userDataDir, 'Default'));

  // ── Use REAL Chrome if available ─────────────────────────────────────────
  // Cloudflare can fingerprint Playwright's bundled Chromium via:
  //   - Binary signature differences (Chromium ≠ Chrome)
  //   - Missing Chrome-specific APIs & internal pages
  //   - CDP connection metadata
  //   - navigator.userAgentData.brands missing "Google Chrome"
  // Using the actual Chrome binary bypasses ALL of these because it IS Chrome.
  const CHROME_PATHS = [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',           // macOS
    '/usr/bin/google-chrome-stable',                                          // Linux
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',             // Windows
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  ];
  const realChrome = CHROME_PATHS.find((p) => fs.existsSync(p));

  // Visibility mode:
  //   OFFSCREEN=false      → headful + visible (used by login-flow so user
  //                           can see the CAPTCHA + complete the login)
  //   OFFSCREEN=minimized  → headful + CDP-minimized (window briefly flashes
  //                           on launch, then docks; useful for debugging)
  //   OFFSCREEN=stealth    → headful + macOS `set visible to false` → Chrome
  //                           runs as a real visible browser (DataDome-friendly)
  //                           but the app is HIDDEN from the desktop (no
  //                           window, no Dock-bounce, just a tiny dot in the
  //                           Dock). RECOMMENDED for anti-bot-protected sites.
  //   OFFSCREEN=true       → fully HEADLESS via Real Chrome `--headless=new`
  //                           — fastest + no UI process at all (DEFAULT)
  //
  // Caller can also pass `opts.headless` explicitly (e.g. selftest scripts
  // that need to see what's happening); that takes precedence.
  const offscreenMode = process.env.OFFSCREEN ?? 'true';
  const wantsVisible = offscreenMode === 'false';
  const wantsMinimized = offscreenMode === 'minimized';
  const wantsStealth = offscreenMode === 'stealth';
  // Stealth needs a real (headful) Chrome process to defeat DataDome's
  // fingerprinting — only after launch do we hide the window via AppleScript.
  const wantsHeadless = !wantsVisible && !wantsMinimized && !wantsStealth;
  const headless = opts.headless ?? wantsHeadless;
  const offscreen = !wantsVisible; // legacy var name kept for downstream conditionals

  log.info('Launching persistent browser context', {
    mode: wantsVisible ? 'visible'
      : wantsMinimized ? 'minimized'
      : wantsStealth ? 'stealth'
      : 'headless',
    headless,
    userDataDir,
    existing: hadProfile,
    engine: realChrome ? 'REAL Chrome' : 'Playwright Chromium (fallback)',
    chromePath: realChrome ?? 'bundled',
  });

  // Stale SingletonLock cleanup. Chromium leaves three "Singleton*" symlinks
  // in the profile dir when it crashes hard (OOM-kill, SIGKILL, power-loss).
  // On next launch it refuses with "Failed to create a ProcessSingleton …
  // File exists (17)". The end-user sees a wall of error text and the bot
  // can't recover. We detect this case and clean it up — but only if the
  // owning process is actually dead, otherwise we'd corrupt a live session.
  const tryCleanStaleSingletons = (): boolean => {
    const lockPath = path.join(userDataDir, 'SingletonLock');
    if (!fs.existsSync(lockPath)) return false;
    let target = '';
    try { target = fs.readlinkSync(lockPath); } catch { /* not a symlink */ }
    // Symlink target is "<hostname>-<pid>". If we can't parse it, treat as stale.
    const pidMatch = target.match(/-(\d+)$/);
    const ownerPid = pidMatch ? Number(pidMatch[1]) : NaN;
    if (Number.isFinite(ownerPid)) {
      try {
        process.kill(ownerPid, 0); // signal 0 = existence check, no actual signal
        // Owner is alive — do NOT delete. Caller has to decide.
        return false;
      } catch {
        // ESRCH = no such process; lock is stale.
      }
    }
    for (const name of ['SingletonLock', 'SingletonCookie', 'SingletonSocket']) {
      try { fs.unlinkSync(path.join(userDataDir, name)); } catch { /* ignore */ }
    }
    log.warn('Cleaned stale Chromium SingletonLock', { userDataDir, ownerPid });
    return true;
  };

  // Parse proxy URL (if provided) into Playwright's proxy-option shape.
  // We log only host+auth-presence; never the password.
  let proxyOpt: { server: string; username?: string; password?: string } | undefined;
  if (opts.proxyUrl) {
    proxyOpt = parseProxyUrl(opts.proxyUrl, opts.scope);
    log.info('Proxy configured', {
      server: new URL(opts.proxyUrl).host,
      hasAuth: !!proxyOpt.username,
    });
  }

  const launchOpts = {
    headless,
    // Use real Chrome if available — this is the critical Cloudflare bypass
    ...(realChrome ? { executablePath: realChrome } : {}),
    ...(proxyOpt ? { proxy: proxyOpt } : {}),
    // CRITICAL: Strip Playwright's default `--enable-automation` flag — it
    // sets navigator.webdriver=true and adds Chrome's "controlled by
    // automated test software" infobar which Vinted's anti-bot detects on
    // first navigation. With this strip, the browser looks like a normal
    // user-launched Chrome session.
    ignoreDefaultArgs: ['--enable-automation', '--enable-blink-features=IdleDetection'],
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-blink-features=AutomationControlled',
      '--disable-infobars',
      '--window-size=1440,900',
      // Disable Chrome's automation-controlled extension surface. Combined
      // with --disable-blink-features=AutomationControlled this strips the
      // remaining JS-detectable bits Vinted scrapes via the session-refresh
      // probe before the login form mounts.
      '--exclude-switches=enable-automation',
      // Single disable-features list (avoid Chrome overriding earlier flag).
      '--disable-features=AutomationControlled,IsolateOrigins,site-per-process,ScriptStreaming',
      // Enable Chrome's built-in password manager inside the managed profile.
      '--enable-features=PasswordManagerEnable',
      '--flag-switches-begin', '--flag-switches-end',
      // Anti-throttling so the bot can run silently in the background even
      // when this app is not focused.
      ...(offscreen ? [
        '--disable-renderer-backgrounding',
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
      ] : []),
      // Headful-but-out-of-the-way: shove the window way off any plausible
      // display; macOS still clamps it, so we ALSO minimize it via CDP
      // right after launch (see below).
      ...(wantsMinimized ? ['--window-position=-32000,-32000'] : []),
      // True headless via Real Chrome: --headless=new is the modern impl
      // (Chrome 109+) — far harder to fingerprint than the old --headless.
      // Playwright sets this automatically when headless:true, but we add
      // the explicit flag in case executablePath bypasses Playwright's
      // arg-injection.
      ...(headless ? ['--headless=new', '--hide-scrollbars', '--mute-audio'] : []),
    ],
    // Don't override userAgent when using real Chrome — let it use its own
    ...(realChrome ? {} : { userAgent: USER_AGENT }),
    viewport: { width: 1440, height: 900 },
    locale: 'de-DE',
    timezoneId: 'Europe/Berlin',
    javaScriptEnabled: true,
    acceptDownloads: true,
    // Ignore HTTPS errors from localhost dev servers
    ignoreHTTPSErrors: true,
  };

  let context: BrowserContext;

  // Build a fallback launchOpts that uses bundled Chromium. We need this for
  // two cases:
  //   1. The user's real Chrome is already running with their normal profile,
  //      and macOS Launch Services consolidates our launch into that process
  //      (Chrome prints "Wird in einer aktuellen Browsersitzung geöffnet" and
  //      our spawned PID exits immediately → "browser has been closed").
  //   2. No real Chrome is installed at all (CHROME_PATHS check failed).
  // In both cases Playwright's bundled Chromium gives us full isolation.
  const fallbackOpts = { ...launchOpts };
  delete (fallbackOpts as { executablePath?: string }).executablePath;
  (fallbackOpts as { userAgent?: string }).userAgent = USER_AGENT;

  const launchWithFallback = async (): Promise<BrowserContext> => {
    try {
      return await chromium.launchPersistentContext(userDataDir, launchOpts);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // macOS Launch-Services consolidation: real-Chrome path was used but
      // the spawned PID died immediately because Chrome merged into an
      // existing session. Re-try with bundled Chromium for full isolation.
      const isLaunchServicesMerge =
        realChrome &&
        /Target page, context or browser has been closed|browser has been closed/i.test(msg);
      if (isLaunchServicesMerge) {
        log.warn(
          'Real Chrome launch failed (existing session conflict) — falling back to bundled Chromium',
          { err: msg.slice(0, 200) },
        );
        return await chromium.launchPersistentContext(userDataDir, fallbackOpts);
      }
      throw err;
    }
  };

  try {
    context = await launchWithFallback();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const isSingletonErr = /ProcessSingleton|SingletonLock|File exists \(17\)/i.test(msg);
    if (!isSingletonErr) throw err;
    // Try to clean it up automatically. Returns false if the owning PID is
    // still alive — in that case we surface a clear user-facing message
    // instead of dumping the Chromium error wall on the dashboard.
    if (!tryCleanStaleSingletons()) {
      throw new Error(
        `Dieses Chrome-Profil wird gerade von einer anderen Instanz benutzt ` +
        `(${userDataDir}). Schließe das andere Fenster und versuche es erneut.`,
      );
    }
    context = await launchWithFallback();
  }

  // Full stealth init — Temu's anti-bot checks several JS fingerprints
  // beyond just navigator.webdriver. We patch each of them before any page
  // script runs. Runs in isolated world = survives page reloads + SPA navs.
  await context.addInitScript(() => {
    // 1. navigator.webdriver (the big one — everything checks this)
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });

    // 2. navigator.plugins — headless Chrome has an empty PluginArray
    //    which is a dead giveaway. Fake 3 realistic Chrome plugins.
    const fakePlugins = [
      { name: 'PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
      { name: 'Chrome PDF Viewer', filename: 'internal-pdf-viewer', description: '' },
      { name: 'Chromium PDF Viewer', filename: 'internal-pdf-viewer', description: '' },
    ];
    Object.defineProperty(navigator, 'plugins', {
      get: () => {
        const arr: any = fakePlugins.slice();
        arr.item = (i: number) => arr[i];
        arr.namedItem = (n: string) => arr.find((p: any) => p.name === n);
        arr.refresh = () => undefined;
        return arr as PluginArray;
      },
    });

    // 3. navigator.languages — empty in headless; real Chrome has at least 2.
    Object.defineProperty(navigator, 'languages', {
      get: () => ['de-DE', 'de', 'en-US', 'en'],
    });

    // 4. window.chrome — missing in headless entirely
    if (!(window as any).chrome) {
      (window as any).chrome = {
        runtime: {},
        loadTimes: () => ({}),
        csi: () => ({}),
        app: { isInstalled: false },
      };
    }

    // 5. Permissions query for 'notifications' returns "denied" in headless
    //    even when Notification.permission says "default" — fix that.
    const origQuery = navigator.permissions?.query?.bind(navigator.permissions);
    if (origQuery) {
      navigator.permissions.query = (params: any) =>
        params?.name === 'notifications'
          ? Promise.resolve({ state: Notification.permission } as PermissionStatus)
          : origQuery(params);
    }

    // 6. WebGL vendor + renderer — headless reports "SwiftShader". Spoof
    //    to Apple GPU values typical on macOS.
    const getParameter = WebGLRenderingContext.prototype.getParameter;
    WebGLRenderingContext.prototype.getParameter = function (param: number) {
      if (param === 37445) return 'Apple Inc.'; // UNMASKED_VENDOR_WEBGL
      if (param === 37446) return 'Apple M1'; // UNMASKED_RENDERER_WEBGL
      return getParameter.call(this, param);
    };

    // 7. navigator.platform vs userAgent consistency
    Object.defineProperty(navigator, 'platform', { get: () => 'MacIntel' });

    // 8. navigator.hardwareConcurrency — a real machine has 4+ cores.
    Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8 });

    // 9. navigator.deviceMemory — same idea.
    Object.defineProperty(navigator, 'deviceMemory', { get: () => 8 });
  });

  if (hadProfile) {
    log.info('Restored Chromium user profile — passwords + autofill available');
  } else {
    log.info('Created fresh Chromium user profile');
  }

  // ── Proxy validation ──────────────────────────────────────────────────
  // When a proxy is configured, do a fast probe to google.com. Failures are
  // logged but NEVER thrown — a broken proxy must not block the orchestrator
  // boot. The user can see the warning in logs and fix the proxy config.
  if (opts.proxyUrl) {
    void (async () => {
      try {
        const probe = await context.newPage();
        try {
          await probe.goto('https://www.google.com', {
            waitUntil: 'domcontentloaded',
            timeout: 15_000,
          });
          log.info('Proxy probe OK', { scope: opts.scope });
        } finally {
          await probe.close().catch(() => null);
        }
      } catch (err) {
        log.error('Proxy probe failed — Browser läuft trotzdem weiter', {
          scope: opts.scope,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    })();
  }

  // Stealth mode (OFFSCREEN=stealth, macOS): after launch, hide the entire
  // Chrome instance with AppleScript `set visible to false`. Window keeps
  // rendering + executing JS in the background, Chrome looks like a real
  // headful browser to DataDome/Cloudflare fingerprinting, but the app is
  // GONE from the user's desktop (no window, no Dock-bounce, just a tiny
  // dot in the Dock).
  //
  // Scoped to the spawned Chrome's PID — never touches the user's own
  // Chrome instance. PID is read from the profile's SingletonLock symlink
  // (target format: "<hostname>-<pid>").
  if (wantsStealth) {
    if (process.platform === 'darwin') {
      void (async () => {
        // Brief wait so the lock file is in place + the app has registered.
        await new Promise((r) => setTimeout(r, 800));
        let browserPid: number | null = null;
        try {
          const lockTarget = fs.readlinkSync(path.join(userDataDir, 'SingletonLock'));
          const m = lockTarget.match(/-(\d+)$/);
          if (m) browserPid = Number(m[1]);
        } catch { /* lock missing — give up, no-op */ }
        if (!browserPid) {
          log.warn('Stealth: could not resolve browser PID — window may stay visible');
          return;
        }
        const script = `tell application "System Events"
          try
            set visible of (first process whose unix id is ${browserPid}) to false
          on error errMsg
            return "stealth-hide failed: " & errMsg
          end try
        end tell`;
        spawn('osascript', ['-e', script], { stdio: 'ignore', detached: true }).unref();
        log.info('Stealth-Mode aktiv — Bot-Chrome ist hidden vom Desktop', {
          scope: opts.scope,
          browserPid,
        });
      })();
    } else {
      log.warn('Stealth mode is macOS-only — falling back to visible mode on this platform');
    }
  }

  // Headful-and-minimized mode (OFFSCREEN=minimized): cooperate with macOS
  // window-clamping by minimizing the bot's window via CDP right after
  // launch. Bot-scoped (only OUR Playwright-launched Chrome, never the
  // user's), survives macOS window-position clamping, keeps the page fully
  // active for scraping (CDP-minimized windows still render + execute JS).
  //
  // Headless mode skips this entirely — there's no window to minimize.
  if (wantsMinimized) {
    void (async () => {
      try {
        // Wait a tick for the initial page to attach.
        await new Promise((r) => setTimeout(r, 400));
        const pages = context.pages();
        const page = pages[0] ?? (await context.newPage());
        const cdp = await context.newCDPSession(page);
        const win = (await cdp.send('Browser.getWindowForTarget')) as { windowId: number };
        await cdp.send('Browser.setWindowBounds', {
          windowId: win.windowId,
          bounds: { windowState: 'minimized' },
        });
        log.info('Bot-Browser minimiert (CDP)', { scope: opts.scope, windowId: win.windowId });
      } catch (err) {
        log.debug('CDP minimize failed — falling back to AppleScript', {
          err: err instanceof Error ? err.message : String(err),
        });
        // macOS AppleScript fallback. CRITICAL: scope to the SPECIFIC Chrome
        // process that's running with our user-data-dir, NEVER the user's
        // own Chrome. Persistent contexts don't expose `.browser()` so we
        // identify the owning PID by reading the profile's SingletonLock
        // symlink (target format: "<hostname>-<pid>"). Falls back to a no-op
        // if we can't identify it cleanly — far better than killing the
        // user's editor windows.
        if (process.platform === 'darwin') {
          let browserPid: number | null = null;
          try {
            const lockTarget = fs.readlinkSync(path.join(userDataDir, 'SingletonLock'));
            const m = lockTarget.match(/-(\d+)$/);
            if (m) browserPid = Number(m[1]);
          } catch { /* lock missing — give up, no-op */ }
          if (browserPid) {
            const script = `tell application "System Events"
              tell (first process whose unix id is ${browserPid})
                repeat with w in windows
                  try
                    set value of attribute "AXMinimized" of w to true
                  end try
                end repeat
              end tell
            end tell`;
            spawn('osascript', ['-e', script], { stdio: 'ignore', detached: true }).unref();
          }
        }
      }
    })();
  }

  // Legacy migration: if an old state.json exists from before the
  // persistent-context switch, import its cookies into the fresh profile.
  const legacyPath = path.join(opts.storageDir, 'state.json');
  if (!hadProfile && fs.existsSync(legacyPath)) {
    try {
      const state = JSON.parse(fs.readFileSync(legacyPath, 'utf-8')) as {
        cookies?: Parameters<BrowserContext['addCookies']>[0];
      };
      if (state.cookies?.length) {
        await context.addCookies(state.cookies);
        log.info(`Migrated ${state.cookies.length} cookies from legacy state.json`);
      }
    } catch (err) {
      log.warn('Legacy state.json migration failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return {
    context,
    async saveState() {
      // Persistent context auto-persists; this remains for API back-compat.
    },
    async close() {
      await context.close();
      log.info('Browser closed (profile persisted)');
    },
  };
}

/**
 * Dismiss any cookie-consent banner the page might be showing.
 *
 * Covers OneTrust (Vinted), Temu's own consent dialog, and a long list of
 * generic patterns. The order tries the least-intrusive approaches first
 * (click a proper "reject" button) before escalating to removing the
 * overlay from the DOM.
 *
 * Safe to call on every page load — returns quickly when no banner exists.
 * Returns `true` if something was actually dismissed.
 */
export async function dismissOneTrust(page: import('playwright').Page): Promise<boolean> {
  // ── Strategy 1: OneTrust API (Vinted + many other sites) ─────────────
  const oneTrustDone = await page
    .evaluate(() => {
      const w = window as unknown as { OneTrust?: { RejectAll?: () => void } };
      if (w.OneTrust?.RejectAll) {
        try {
          w.OneTrust.RejectAll();
          return true;
        } catch {
          return false;
        }
      }
      return false;
    })
    .catch(() => false);
  if (oneTrustDone) {
    await page.waitForTimeout(400);
    return true;
  }

  // ── Strategy 2: Click a visible reject/accept button by text ─────────
  // Works on Temu (Datenschutz- & Cookie-Einstellung dialog) and most
  // generic banners. Searches the ENTIRE document INCLUDING shadow roots —
  // buttons below the fold still match because we look at .innerText
  // regardless of visibility.
  const textClicked = await page
    .evaluate(() => {
      const preferences = [
        // German
        'Alle ablehnen', 'Nur notwendige', 'Nur Notwendige zulassen',
        'Notwendige auswählen', 'Notwendige Cookies', 'Ablehnen',
        'Alle akzeptieren', 'Akzeptieren',
        // English
        'Reject all', 'Only necessary', 'Only essential',
        'Accept all', 'Accept',
      ];

      // Walk the main DOM plus any shadow roots we find.
      function collectClickables(root: Document | ShadowRoot): HTMLElement[] {
        const out: HTMLElement[] = [];
        const all = root.querySelectorAll<HTMLElement>('button, [role="button"], a');
        all.forEach((el) => out.push(el));
        // Descend into shadow roots
        root.querySelectorAll<HTMLElement>('*').forEach((el) => {
          const sr = (el as HTMLElement & { shadowRoot?: ShadowRoot }).shadowRoot;
          if (sr) out.push(...collectClickables(sr));
        });
        return out;
      }

      const all = collectClickables(document);
      const foundTexts: string[] = [];
      for (const target of preferences) {
        const hit = all.find((el) => {
          const t = (el.innerText || el.textContent || '').trim();
          return t === target || t.startsWith(target);
        });
        if (hit) {
          try {
            hit.scrollIntoView({ block: 'center' });
            (hit as HTMLButtonElement).click();
            return { clicked: true, label: target, totalClickables: all.length };
          } catch {
            /* keep trying next preference */
          }
        }
      }
      // No hit. Return a snapshot for diagnostics.
      for (const el of all.slice(0, 40)) {
        const t = (el.innerText || el.textContent || '').trim().slice(0, 50);
        if (t) foundTexts.push(t);
      }
      return { clicked: false, totalClickables: all.length, sampleTexts: foundTexts };
    })
    .catch(() => ({ clicked: false } as { clicked: boolean; label?: string }));
  if ('clicked' in textClicked && textClicked.clicked) {
    await page.waitForTimeout(600);
    return true;
  }
  // Log diagnostic so we can see what buttons WERE on the page.
  // (Only logs if no strategy worked and we reach Strategy 3.)
  if ('sampleTexts' in textClicked) {
    const d = textClicked as { clicked: false; totalClickables: number; sampleTexts: string[] };
    console.warn('[dismissOneTrust] text strategy failed', {
      totalClickables: d.totalClickables,
      sampleTexts: d.sampleTexts.slice(0, 15),
    });
  }

  // ── Strategy 2b: Press Escape — some dialogs listen for it ───────────
  await page.keyboard.press('Escape').catch(() => null);
  await page.waitForTimeout(200);

  // ── Strategy 3: Fixed overlay / dialog nuke ──────────────────────────
  // If still stuck, remove any fixed-position full-screen overlay and any
  // role=dialog element that appears to be a cookie notice.
  const nuked = await page
    .evaluate(() => {
      let removed = 0;

      const killSelectors = [
        '#onetrust-banner-sdk',
        '.onetrust-pc-dark-filter',
        '[id*="cookie" i][id*="banner" i]',
        '[class*="cookie" i][class*="banner" i]',
        '[id*="consent" i]',
        '[class*="consent-banner" i]',
      ];
      for (const s of killSelectors) {
        document.querySelectorAll(s).forEach((el) => {
          el.remove();
          removed++;
        });
      }

      // Dialogs whose text contains "Cookie" or "Datenschutz"
      document.querySelectorAll<HTMLElement>('[role="dialog"]').forEach((d) => {
        const t = (d.innerText || '').slice(0, 200).toLowerCase();
        if (/cookie|datenschutz|consent|privacy/.test(t)) {
          d.remove();
          removed++;
        }
      });

      // Any fixed-position full-width element near top/bottom with cookie text
      document.querySelectorAll<HTMLElement>('*').forEach((el) => {
        const style = window.getComputedStyle(el);
        if (style.position !== 'fixed' && style.position !== 'sticky') return;
        const rect = el.getBoundingClientRect();
        if (rect.width < window.innerWidth * 0.6) return;
        if (rect.height < 40 || rect.height > window.innerHeight) return;
        const t = (el.innerText || '').slice(0, 200).toLowerCase();
        if (/cookie|datenschutz|consent|privacy/.test(t)) {
          el.remove();
          removed++;
        }
      });

      // Restore scroll in case overlay froze body
      document.body.style.overflow = '';
      document.documentElement.style.overflow = '';
      return removed;
    })
    .catch(() => 0);

  return nuked > 0;
}

/**
 * Check if the current page is showing a CAPTCHA / bot-block page.
 * Bots MUST pause (not bypass) when this returns true.
 */
export async function isBotBlocked(page: Page): Promise<{ blocked: boolean; reason?: string }> {
  try {
    const bodyText = await page.locator('body').innerText({ timeout: 5000 }).catch(() => '');
    const lower = bodyText.toLowerCase();
    // Vinted-spezifischer Session-Block (verifiziert 2026-04-30)
    if (lower.includes('sitzung wurde blockiert') ||
        lower.includes('session has been blocked') ||
        lower.includes('ungewöhnliche aktivitäten') ||
        lower.includes('unusual activity')) {
      return { blocked: true, reason: 'VINTED_SESSION_BLOCKED — IP-Cooldown 15-60min nötig, danach Profile reset' };
    }
    if (lower.includes('zu viele anfragen') || lower.includes('too many requests')) {
      return { blocked: true, reason: 'RATE_LIMITED' };
    }
    if (lower.includes('captcha') || lower.includes('recaptcha') || lower.includes('hcaptcha')) {
      return { blocked: true, reason: 'CAPTCHA detected' };
    }
    if (lower.includes('access denied') || lower.includes('zugriff verweigert')) {
      return { blocked: true, reason: 'Access denied' };
    }
    const url = page.url();
    if (url.includes('/captcha') || url.includes('/challenge')) {
      return { blocked: true, reason: 'Challenge URL' };
    }
    return { blocked: false };
  } catch {
    return { blocked: false };
  }
}
