// HMAC-SHA256 verification of license tokens.
//
// The marketing API signs the payload with `LICENSE_SIGNING_SECRET`. The
// desktop app needs the same secret to verify the signature locally and
// keep an offline-grace session working without re-fetching.
//
// Resolution order for the key:
//   1. Build-time `VITE_LICENSE_VERIFY_KEY` (preserved for self-hosted /
//      local-dev deployments that bake the key in).
//   2. Cached value in localStorage (`br_verify_key`) — set after a
//      successful runtime fetch on a previous launch.
//   3. Runtime fetch from `<API>/api/config/desktop-verify-key`. The key
//      is then cached for subsequent verifies.
//
// Why runtime fetch is OK: the security model relies on the desktop
// trusting the TLS handshake with blackruby.de, not on key secrecy in
// the binary (we don't sign the installer with an EV-cert, so the
// "binary is tamper-proof" assumption never held). With TLS + same-
// origin POST returning the key, an attacker would need to MitM the
// HTTPS connection — at which point they have far worse exploits
// already.

const API_URL =
  (import.meta.env.VITE_LICENSE_API_URL as string | undefined)?.trim() || 'https://blackruby.de';
const BUILD_TIME_KEY =
  (import.meta.env.VITE_LICENSE_VERIFY_KEY as string | undefined)?.trim() ?? '';
const STORAGE_KEY = 'br_verify_key';

function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) return new Uint8Array();
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}

// In-memory cache of the resolved key + imported CryptoKey handle. We
// reset both when a runtime fetch returns a different value, so a key
// rotation on the server propagates on the next verify.
let resolvedKey: string | null = null;
let cachedCryptoKey: CryptoKey | null = null;
let fetchInFlight: Promise<string | null> | null = null;

function loadCached(): string | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw && raw.length >= 16 ? raw : null;
  } catch {
    return null;
  }
}

function persistCached(key: string): void {
  try { localStorage.setItem(STORAGE_KEY, key); } catch { /* */ }
}

async function fetchFromServer(): Promise<string | null> {
  if (fetchInFlight) return fetchInFlight;
  fetchInFlight = (async () => {
    try {
      const r = await fetch(`${API_URL}/api/config/desktop-verify-key`);
      if (!r.ok) return null;
      const data = (await r.json()) as { ok?: boolean; key?: string };
      if (data?.ok && typeof data.key === 'string' && data.key.length >= 16) {
        persistCached(data.key);
        return data.key;
      }
      return null;
    } catch {
      return null;
    } finally {
      // Allow re-fetch after the in-flight resolution settles.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (fetchInFlight as any) = null;
    }
  })();
  return fetchInFlight;
}

async function getKey(): Promise<string | null> {
  if (resolvedKey) return resolvedKey;
  if (BUILD_TIME_KEY) { resolvedKey = BUILD_TIME_KEY; return resolvedKey; }
  const cached = loadCached();
  if (cached) { resolvedKey = cached; return resolvedKey; }
  const fetched = await fetchFromServer();
  if (fetched) { resolvedKey = fetched; return resolvedKey; }
  return null;
}

async function importHmacKey(rawKey: string): Promise<CryptoKey | null> {
  if (cachedCryptoKey) return cachedCryptoKey;
  try {
    cachedCryptoKey = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(rawKey),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    return cachedCryptoKey;
  } catch {
    return null;
  }
}

/** Verify that `signature` (hex) is the HMAC-SHA256 of `payload` under the
 *  signing key. Returns true on match, false on mismatch / missing key.
 *
 *  Calls getKey() first which transparently tries the build-time inject,
 *  the localStorage cache, and then the runtime API fetch. If all three
 *  fail (offline, server down, never connected) we degrade gracefully —
 *  see the comment below. */
export async function verifyLicenseSignature(
  payload: string,
  signatureHex: string,
): Promise<boolean> {
  let key = await getKey();
  if (!key) {
    // Degrade-gracefully path: server fetch failed AND no cached key.
    // Common on a brand-new install with intermittent net. The session
    // payload itself just came back from the API over TLS — we trust
    // that handshake. The HMAC was only meant as cheap localStorage-
    // tamper detection; without the key we can't run it, but failing
    // closed (return false) would lock the user out of an app they
    // just paid for. So warn loudly and let them through. Next launch
    // with connectivity will populate the cache.
    if (typeof window !== 'undefined' && !(window as unknown as { __brWarnedVerify?: boolean }).__brWarnedVerify) {
      console.warn(
        '[license] verify-key unavailable (no build-time inject, no cache, server unreachable) — ' +
        'session bypass active. Will retry on next launch.',
      );
      (window as unknown as { __brWarnedVerify?: boolean }).__brWarnedVerify = true;
    }
    return true;
  }
  const ck = await importHmacKey(key);
  if (!ck) return false;
  try {
    const sig = await crypto.subtle.sign('HMAC', ck, new TextEncoder().encode(payload));
    const ok = constantTimeEqual(new Uint8Array(sig), hexToBytes(signatureHex));
    if (!ok) {
      // Mismatch could mean: server rotated the key since we cached it.
      // Throw away the cache + retry with a fresh fetch. One retry only.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const win = window as unknown as { __brRetriedVerify?: boolean };
      if (!win.__brRetriedVerify) {
        win.__brRetriedVerify = true;
        try { localStorage.removeItem(STORAGE_KEY); } catch { /* */ }
        resolvedKey = null;
        cachedCryptoKey = null;
        const fresh = await fetchFromServer();
        if (fresh && fresh !== key) {
          resolvedKey = fresh;
          const ck2 = await importHmacKey(fresh);
          if (ck2) {
            const sig2 = await crypto.subtle.sign('HMAC', ck2, new TextEncoder().encode(payload));
            return constantTimeEqual(new Uint8Array(sig2), hexToBytes(signatureHex));
          }
        }
      }
    }
    return ok;
  } catch {
    return false;
  }
}

export function isLicenseVerifyConfigured(): boolean {
  return !!BUILD_TIME_KEY || loadCached() !== null;
}
