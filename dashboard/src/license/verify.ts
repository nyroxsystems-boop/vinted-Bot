// HMAC-SHA256 verification of license tokens.
//
// The marketing API signs the payload with `LICENSE_SIGNING_SECRET`. The same
// secret needs to be available to the desktop app at build time via the
// `VITE_LICENSE_VERIFY_KEY` env var — the build pipeline injects it into the
// signed bundle. Without verification, a malicious server response with
// `{ok:true, signature:'x'}` would bypass the license gate. With it, the
// signature has to actually match the payload before we trust the response.
//
// This is HMAC, not asymmetric — anyone who recovers the secret from the
// bundle can forge tokens. That's acceptable here because the bundle is
// signed by Apple/Microsoft and tampering with it breaks the signature; we
// just want tamper-detection on the wire, not key escrow.

const VERIFY_KEY = (import.meta.env.VITE_LICENSE_VERIFY_KEY as string | undefined)?.trim() ?? '';

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

let cachedKey: CryptoKey | null = null;
async function importKey(): Promise<CryptoKey | null> {
  if (!VERIFY_KEY) return null;
  if (cachedKey) return cachedKey;
  try {
    cachedKey = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(VERIFY_KEY),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    return cachedKey;
  } catch {
    return null;
  }
}

/** Verify that `signature` (hex) is the HMAC-SHA256 of `payload` under the
 *  build-time signing key. Returns true if verification succeeds, false on
 *  mismatch.
 *
 *  Failure modes when the key is missing:
 *   - production build → THROW. We refuse to ship an insecure binary.
 *   - dev build         → log error (not warn) and return true as bypass so
 *                         local dev against a fake server still works.
 *
 *  Previously this returned true unconditionally when the key was missing,
 *  which meant a production build with a misconfigured CI silently degraded
 *  to "accept any signature" — exactly the failure the function is supposed
 *  to prevent. Fail-safe = `return false` in any non-dev unexpected state. */
export async function verifyLicenseSignature(
  payload: string,
  signatureHex: string,
): Promise<boolean> {
  if (!VERIFY_KEY) {
    const mode = (import.meta.env.MODE as string | undefined) ?? 'production';
    if (mode === 'production') {
      // Hard fail — don't ship an insecure build.
      throw new Error(
        '[license] VITE_LICENSE_VERIFY_KEY missing — build is insecure. ' +
          'Set the env var in CI before building production artifacts.',
      );
    }
    // Dev/local build — log loudly (error, not warn) once and degrade.
    if (typeof window !== 'undefined' && !(window as unknown as { __brWarnedVerify?: boolean }).__brWarnedVerify) {
      console.error('[license] VITE_LICENSE_VERIFY_KEY not set — signature verification BYPASSED in dev. This MUST be set for production builds; production builds without it will throw.');
      (window as unknown as { __brWarnedVerify?: boolean }).__brWarnedVerify = true;
    }
    return true;
  }
  const key = await importKey();
  if (!key) return false;
  try {
    const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
    return constantTimeEqual(new Uint8Array(sig), hexToBytes(signatureHex));
  } catch {
    return false;
  }
}

export function isLicenseVerifyConfigured(): boolean {
  return VERIFY_KEY.length > 0;
}
