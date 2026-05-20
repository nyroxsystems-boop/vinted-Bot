// ──────────────────────────────────────────────────────────────────────────────
// Update Checker — replaces the (disabled) Tauri auto-updater.
//
// Polls blackruby.app/api/releases/latest once per day. If the latest version
// differs from APP_VERSION, surfaces a toast that links to the download page
// instead of doing an in-app silent update. Honest + works without code-signing.
// ──────────────────────────────────────────────────────────────────────────────

import { useEffect } from 'react';
import { toast } from './Toast';

const APP_VERSION = '0.5.0';
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const LAST_CHECK_KEY = 'br_update_last_check_v1';
const SKIP_VERSION_KEY = 'br_update_skip_version';

// Defence-in-depth: even though VITE_LICENSE_API_URL is set at build time,
// keep an explicit whitelist so a tampered/typo'd env can't point the update
// fetch at a random host. Anything off-list falls back to the canonical URL.
const ALLOWED_HOSTS = ['blackruby.app', 'staging.blackruby.app', 'localhost', '127.0.0.1'];

function safeApiUrl(): string {
  const raw = (import.meta.env.VITE_LICENSE_API_URL as string | undefined) ?? 'https://blackruby.app';
  try {
    const u = new URL(raw);
    if (!ALLOWED_HOSTS.includes(u.hostname)) {
      console.error('[UpdateChecker] disallowed VITE_LICENSE_API_URL host:', u.hostname);
      return 'https://blackruby.app';
    }
    return raw;
  } catch {
    return 'https://blackruby.app';
  }
}

const API_URL = safeApiUrl();
const RELEASES_URL = API_URL;

export function UpdateChecker() {
  useEffect(() => {
    let cancelled = false;

    async function check() {
      try {
        const last = Number(localStorage.getItem(LAST_CHECK_KEY) ?? '0');
        if (Date.now() - last < CHECK_INTERVAL_MS) return;

        const r = await fetch(`${RELEASES_URL}/api/releases/latest`);
        if (!r.ok) return;
        const data = (await r.json()) as {
          ok: boolean;
          release?: { version?: string; notes?: string[] };
        };
        if (cancelled) return;

        const latest = data.release?.version;
        if (!latest || latest === APP_VERSION) {
          localStorage.setItem(LAST_CHECK_KEY, String(Date.now()));
          return;
        }
        if (localStorage.getItem(SKIP_VERSION_KEY) === latest) return;

        // Compare loosely — only show toast if string-greater (works for x.y.z)
        if (latest <= APP_VERSION) return;

        toast.info(`Update verfügbar: v${latest}`, {
          detail: `Du nutzt v${APP_VERSION}. Hol dir den neuen Build mit einem Klick.`,
          duration: 20_000,
          action: {
            label: 'Update herunterladen',
            href: `${RELEASES_URL}/members`,
          },
        });
        localStorage.setItem(LAST_CHECK_KEY, String(Date.now()));
      } catch {
        /* offline — fail silently */
      }
    }

    // First check after 8 s (don't jam startup), then every hour wake check
    const initial = setTimeout(check, 8_000);
    const interval = setInterval(check, 3_600_000);
    return () => {
      cancelled = true;
      clearTimeout(initial);
      clearInterval(interval);
    };
  }, []);

  return null;
}
