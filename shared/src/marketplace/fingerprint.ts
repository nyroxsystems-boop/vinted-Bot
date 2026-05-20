// ──────────────────────────────────────────────────────────────────────────────
// Deterministisches Per-Account Browser-Fingerprint
//
// Ein Account → immer derselbe Fingerprint (UA/Viewport/Timezone/Locale/
// HW-Concurrency/DeviceMemory). Aber zwischen Accounts unterschiedlich.
// → Multi-Account auf einem Host wirkt nicht wie EIN Bot.
//
// Determinismus = wichtig: würde der Fingerprint pro Session wechseln,
// wäre das selbst ein Erkennungsmuster.
// ──────────────────────────────────────────────────────────────────────────────

import crypto from 'node:crypto';

export interface Fingerprint {
  userAgent: string;
  viewport: { width: number; height: number };
  locale: string;
  timezoneId: string;
  hardwareConcurrency: number;
  deviceMemory: number;
  platform: 'MacIntel' | 'Win32' | 'Linux x86_64';
  webglVendor: string;
  webglRenderer: string;
  /** Plattform-Land hint (für Adapter, nicht für Browser direkt). */
  primaryCountry: string;
}

// Realistische UA-Pool: aktuelle Chrome-Versionen auf Mac/Win.
const UA_POOL: Array<{ ua: string; platform: Fingerprint['platform']; webglVendor: string; webglRenderer: string }> = [
  {
    ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    platform: 'MacIntel',
    webglVendor: 'Apple Inc.',
    webglRenderer: 'Apple M1',
  },
  {
    ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
    platform: 'MacIntel',
    webglVendor: 'Apple Inc.',
    webglRenderer: 'Apple M2',
  },
  {
    ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    platform: 'Win32',
    webglVendor: 'Google Inc. (Intel)',
    webglRenderer: 'ANGLE (Intel, Intel(R) UHD Graphics 630 Direct3D11 vs_5_0 ps_5_0, D3D11)',
  },
  {
    ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
    platform: 'Win32',
    webglVendor: 'Google Inc. (NVIDIA)',
    webglRenderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)',
  },
];

const VIEWPORTS: Array<{ width: number; height: number }> = [
  { width: 1440, height: 900 },
  { width: 1536, height: 864 },
  { width: 1280, height: 800 },
  { width: 1680, height: 1050 },
  { width: 1920, height: 1080 },
  { width: 1366, height: 768 },
];

const HW_CORES = [4, 8, 8, 8, 12, 16];
const DEV_MEM = [4, 8, 8, 8, 16, 16];

interface LocaleProfile {
  locale: string;
  timezone: string;
  country: string;
}

const LOCALE_BY_MARKETPLACE: Record<string, LocaleProfile> = {
  vinted:        { locale: 'de-DE', timezone: 'Europe/Berlin',  country: 'DE' },
  kleinanzeigen: { locale: 'de-DE', timezone: 'Europe/Berlin',  country: 'DE' },
  mercari:       { locale: 'en-US', timezone: 'America/New_York', country: 'US' },
  depop:         { locale: 'en-GB', timezone: 'Europe/London',  country: 'GB' },
  wallapop:      { locale: 'es-ES', timezone: 'Europe/Madrid',  country: 'ES' },
};

function seedHash(seed: string): number[] {
  const h = crypto.createHash('sha256').update(seed).digest();
  return Array.from(h);
}

function pickFromHash<T>(arr: T[], hash: number[], offset: number): T {
  const idx = (hash[offset] ?? 0) % arr.length;
  return arr[idx]!;
}

export function fingerprintFor(accountId: number, marketplace: string): Fingerprint {
  const hash = seedHash(`${marketplace}::${accountId}`);
  const ua = pickFromHash(UA_POOL, hash, 0);
  const viewport = pickFromHash(VIEWPORTS, hash, 1);
  const cores = pickFromHash(HW_CORES, hash, 2);
  const mem = pickFromHash(DEV_MEM, hash, 3);
  const loc = LOCALE_BY_MARKETPLACE[marketplace] ?? LOCALE_BY_MARKETPLACE.vinted!;
  return {
    userAgent: ua.ua,
    viewport,
    locale: loc.locale,
    timezoneId: loc.timezone,
    hardwareConcurrency: cores,
    deviceMemory: mem,
    platform: ua.platform,
    webglVendor: ua.webglVendor,
    webglRenderer: ua.webglRenderer,
    primaryCountry: loc.country,
  };
}

/** Stealth-Init-Skript, das zum Fingerprint passt — als String für addInitScript. */
export function stealthInitScript(fp: Fingerprint): string {
  return `
    (() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
      Object.defineProperty(navigator, 'platform', { get: () => ${JSON.stringify(fp.platform)} });
      Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => ${fp.hardwareConcurrency} });
      Object.defineProperty(navigator, 'deviceMemory', { get: () => ${fp.deviceMemory} });
      Object.defineProperty(navigator, 'languages', { get: () => ${JSON.stringify([fp.locale, fp.locale.split('-')[0], 'en-US', 'en'])} });

      const fakePlugins = [
        { name: 'PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
        { name: 'Chrome PDF Viewer', filename: 'internal-pdf-viewer', description: '' },
        { name: 'Chromium PDF Viewer', filename: 'internal-pdf-viewer', description: '' },
      ];
      Object.defineProperty(navigator, 'plugins', {
        get: () => {
          const arr = fakePlugins.slice();
          arr.item = (i) => arr[i];
          arr.namedItem = (n) => arr.find((p) => p.name === n);
          arr.refresh = () => undefined;
          return arr;
        },
      });

      if (!window.chrome) {
        window.chrome = { runtime: {}, loadTimes: () => ({}), csi: () => ({}), app: { isInstalled: false } };
      }

      const origQuery = navigator.permissions && navigator.permissions.query
        ? navigator.permissions.query.bind(navigator.permissions) : null;
      if (origQuery) {
        navigator.permissions.query = (params) =>
          params && params.name === 'notifications'
            ? Promise.resolve({ state: Notification.permission })
            : origQuery(params);
      }

      const getParameter = WebGLRenderingContext.prototype.getParameter;
      WebGLRenderingContext.prototype.getParameter = function (param) {
        if (param === 37445) return ${JSON.stringify(fp.webglVendor)};
        if (param === 37446) return ${JSON.stringify(fp.webglRenderer)};
        return getParameter.call(this, param);
      };
    })();
  `;
}
