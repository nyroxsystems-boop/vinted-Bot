// ──────────────────────────────────────────────────────────────────────────────
// LicenseProvider — gates the app behind a valid license key.
//
// First-run:
//   1. Show LicenseGate component asking for the key from the customer's
//      Stripe purchase email.
//   2. POST to the Blackruby license server (LICENSE_API_URL) → returns a
//      signed payload (HMAC-SHA256) + tier + expiry.
//   3. Persist {payload, signature, key, tier, expires_at} in localStorage.
//   4. On future launches verify the timestamp/expiry locally — no network
//      round-trip required. Re-validate every 24h in the background.
//
// Offline-tolerant: a stored, non-expired license keeps working even if the
// validation server is unreachable.
// ──────────────────────────────────────────────────────────────────────────────

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { LicenseGate } from './LicenseGate';
import { verifyLicenseSignature } from './verify';

const LICENSE_API_URL =
  (import.meta.env.VITE_LICENSE_API_URL as string | undefined) ?? 'https://blackruby.de';
const LS_KEY = 'br_license_v1';

// Re-check the subscription every hour while the app is open. Cheap call,
// makes cancellations stick within an hour instead of 24h.
const RECHECK_INTERVAL_MS = 60 * 60 * 1000;
// After this long without a successful server validation, lock the app even
// if expires_at is still in the future. Protects against the customer simply
// staying offline forever to keep a cancelled subscription alive.
// Raised from 72h to 96h to give a more generous buffer for short Stripe /
// blackruby.de outages — short outages no longer kick paying users out.
const OFFLINE_GRACE_MS = 96 * 60 * 60 * 1000;
// After this long offline we start surfacing a soft "license is being
// re-checked" banner inside the app, but we still allow continued use until
// OFFLINE_GRACE_MS is hit. Lifetime licenses never see this.
const SOFT_STALE_MS = 24 * 60 * 60 * 1000;

export interface License {
  key: string;
  email: string;
  tier: 'starter' | 'hustler' | 'lifetime';
  cadence?: 'monthly' | 'yearly' | 'lifetime';
  expires_at: string | null;     // ISO or null for lifetime
  payload: string;               // signed payload as returned by the server
  signature: string;             // HMAC signature
  last_validated_at: string;     // ISO
}

interface LicenseCtx {
  license: License | null;
  activate: (key: string) => Promise<{ ok: true } | { ok: false; error: string }>;
  deactivate: () => void;
  /** True when the license is still valid but we haven't been able to reach
   *  the validation server for > SOFT_STALE_MS. UI can surface a soft banner
   *  instead of hard-gating the app. */
  softStale: boolean;
}

const Ctx = createContext<LicenseCtx>({
  license: null,
  activate: async () => ({ ok: false, error: 'not initialised' }),
  deactivate: () => undefined,
  softStale: false,
});

export function useLicense(): LicenseCtx {
  return useContext(Ctx);
}

export function LicenseProvider({ children, bypass = false }: { children: ReactNode; bypass?: boolean }) {
  const [license, setLicense] = useState<License | null>(() => loadStored());
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setHydrated(true);
    if (!license) return;

    let cancelled = false;
    const runCheck = () => {
      if (cancelled || !license) return;
      void revalidate(license.key).then((res) => {
        if (cancelled) return;
        if (res.ok) {
          persist(res.license);
        } else if (res.fatal) {
          deactivate();
        }
        // Non-fatal failure (network/server down) → keep existing license.
        // The OFFLINE_GRACE_MS check below will eventually force a re-auth.
      });
    };

    // Immediate check if last validation is older than the recheck interval.
    const last = new Date(license.last_validated_at).getTime();
    if (Date.now() - last >= RECHECK_INTERVAL_MS) runCheck();

    // Continuous hourly re-check while the app is open.
    const timer = setInterval(runCheck, RECHECK_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [license?.key]);

  function persist(lic: License) {
    setLicense(lic);
    localStorage.setItem(LS_KEY, JSON.stringify(lic));
  }

  function deactivate() {
    setLicense(null);
    localStorage.removeItem(LS_KEY);
  }

  async function activate(key: string) {
    const k = key.trim().toUpperCase();
    if (!/^BRBY(-[0-9A-Z]{4}){5}$/.test(k)) {
      return { ok: false as const, error: 'Format ungültig. Erwartet: BRBY-XXXX-XXXX-XXXX-XXXX-XXXX.' };
    }
    const res = await revalidate(k);
    if (res.ok) {
      persist(res.license);
      return { ok: true as const };
    }
    return { ok: false as const, error: res.error };
  }

  if (!hydrated) return null;

  if (!bypass && (!license || licenseExpired(license) || licenseOfflineStale(license))) {
    return (
      <LicenseGate
        onActivate={activate}
        previousKey={license?.key}
        reason={
          !license
            ? undefined
            : licenseExpired(license)
            ? 'expired'
            : licenseOfflineStale(license)
            ? 'offline_stale'
            : undefined
        }
      />
    );
  }

  const softStale = !!license && licenseSoftStale(license);

  return (
    <Ctx.Provider value={{ license, activate, deactivate, softStale }}>
      {softStale && <LicenseSoftStaleBanner />}
      {children}
    </Ctx.Provider>
  );
}

// Soft banner: shown when we couldn't reach the validation server for > 24h
// but we're still inside the 96h grace. Stays in-flow at the top so the user
// keeps working but knows the recheck is pending.
function LicenseSoftStaleBanner() {
  return (
    <div className="sticky top-0 z-40 flex items-center justify-center gap-2 border-b border-amber-500/30 bg-amber-500/10 px-4 py-1.5 text-[11px] font-semibold text-amber-200">
      Lizenz wird neu geprüft (Server nicht erreichbar). Du kannst weiterarbeiten — bis zu 96 h Grace.
    </div>
  );
}

function loadStored(): License | null {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as License;
    if (!parsed.key || !parsed.signature) return null;
    return parsed;
  } catch {
    return null;
  }
}

function licenseExpired(lic: License): boolean {
  if (!lic.expires_at) return false; // lifetime
  return new Date(lic.expires_at) < new Date();
}

// True if we haven't successfully revalidated with the server for too long,
// regardless of expires_at. Lifetime keys are exempt — they don't need
// recurring proof of payment.
function licenseOfflineStale(lic: License): boolean {
  if (lic.cadence === 'lifetime' || !lic.expires_at) return false;
  const last = new Date(lic.last_validated_at).getTime();
  if (Number.isNaN(last)) return true;
  return Date.now() - last > OFFLINE_GRACE_MS;
}

// Soft-stale: we tried to revalidate, server didn't answer, but we're still
// inside the grace window. Surface a banner but don't gate. Lifetime exempt.
function licenseSoftStale(lic: License): boolean {
  if (lic.cadence === 'lifetime' || !lic.expires_at) return false;
  const last = new Date(lic.last_validated_at).getTime();
  if (Number.isNaN(last)) return false;
  const age = Date.now() - last;
  return age > SOFT_STALE_MS && age <= OFFLINE_GRACE_MS;
}

async function revalidate(
  key: string,
): Promise<
  | { ok: true; license: License }
  | { ok: false; error: string; fatal?: boolean }
> {
  try {
    // 10s timeout so a hanging server doesn't make the UI feel dead.
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 10_000);
    const r = await fetch(`${LICENSE_API_URL}/api/license/validate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, machine_id: getMachineId() }),
      signal: ctrl.signal,
    }).finally(() => clearTimeout(t));
    if (r.status === 404) {
      return { ok: false, error: 'Lizenz unbekannt — bitte prüfe den Key in der Kauf-E-Mail.', fatal: true };
    }
    if (r.status === 403) {
      return { ok: false, error: 'Lizenz nicht aktiv (abgelaufen oder storniert). Verlängere unter blackruby.de/members.', fatal: true };
    }
    if (r.status === 429) {
      return { ok: false, error: 'Zu viele Validierungs-Versuche — bitte 5 Min warten.' };
    }
    if (r.status >= 500) {
      return { ok: false, error: `Lizenz-Server hat ein Problem (HTTP ${r.status}). Versuch's gleich noch mal.` };
    }
    if (!r.ok) {
      return { ok: false, error: `Server-Fehler ${r.status}.` };
    }
    const data = (await r.json()) as {
      ok: boolean;
      payload?: string;
      signature?: string;
      tier?: License['tier'];
      cadence?: License['cadence'];
      expires_at?: string | null;
      error?: string;
    };
    if (!data.ok || !data.payload || !data.signature) {
      return { ok: false, error: data.error ?? 'Ungültige Server-Antwort.' };
    }
    // Verify HMAC — without this a malicious response can bypass the gate.
    const sigOk = await verifyLicenseSignature(data.payload, data.signature);
    if (!sigOk) {
      return { ok: false, error: 'Signaturprüfung fehlgeschlagen — Lizenz nicht vertrauenswürdig.', fatal: true };
    }
    let payloadObj: { email?: string; cadence?: License['cadence'] } = {};
    try { payloadObj = JSON.parse(data.payload); } catch { /* */ }
    return {
      ok: true,
      license: {
        key,
        email: payloadObj.email ?? '',
        tier: data.tier ?? 'hustler',
        cadence: data.cadence ?? payloadObj.cadence,
        expires_at: data.expires_at ?? null,
        payload: data.payload,
        signature: data.signature,
        last_validated_at: new Date().toISOString(),
      },
    };
  } catch (e) {
    // AbortError → timeout. Network error → server unreachable. Both are
    // non-fatal: keep the existing license (if any) and show a clear message.
    if (e instanceof Error && (e.name === 'AbortError' || e.message === 'aborted')) {
      return { ok: false, error: `Lizenz-Server (${LICENSE_API_URL}) antwortet nicht — versuch's gleich noch mal. Falls offline: bestehende Lizenz bleibt 96 h gültig.` };
    }
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.toLowerCase().includes('failed to fetch') || msg.toLowerCase().includes('network')) {
      return { ok: false, error: `Keine Verbindung zu ${LICENSE_API_URL}. Checke Internet — bestehende Lizenz bleibt 96 h offline gültig.` };
    }
    return { ok: false, error: msg };
  }
}

function getMachineId(): string {
  let id = localStorage.getItem('br_machine_id');
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem('br_machine_id', id);
  }
  return id;
}
