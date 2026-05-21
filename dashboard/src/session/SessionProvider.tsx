// ──────────────────────────────────────────────────────────────────────────────
// SessionProvider — gates the app behind an email+password account login.
//
// First-run:
//   1. Show SessionGate (login screen).
//   2. POST credentials to /api/desktop/session → returns a signed payload
//      (HMAC-SHA256(payload, LICENSE_SIGNING_SECRET)) describing the user's
//      Stripe subscription state: { user_id, email, tier, status, member,
//      expires_at, issued_at }.
//   3. Persist {payload, signature, email, password} in localStorage.
//      Note: in a future iteration the password should move to the OS
//      keychain via @tauri-apps/plugin-keyring — for now localStorage is
//      'good enough' since the Tauri sandbox isolates per-app storage.
//   4. Re-validate every hour against /api/desktop/refresh so a cancelled
//      Stripe subscription kicks the user out within an hour.
//
// Offline-tolerant: a recently-validated session keeps working for up to
// 96 h without network — but the payload's expires_at still gates monthly
// subscriptions (cancelled-but-paid-through subs stay active until then).
//
// Compatibility: kept the `useLicense()` export name so existing components
// (LicensePanel, status banners, etc.) keep working without a sweep.
// ──────────────────────────────────────────────────────────────────────────────

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { SessionGate, type LoginResult } from './SessionGate';
import { verifyLicenseSignature } from '../license/verify';

const SESSION_API_URL =
  (import.meta.env.VITE_LICENSE_API_URL as string | undefined) ?? 'https://blackruby.de';
const LS_KEY = 'br_session_v1';

const RECHECK_INTERVAL_MS = 60 * 60 * 1000;   // hourly background re-validate
const OFFLINE_GRACE_MS    = 96 * 60 * 60 * 1000; // 96 h offline tolerance
const SOFT_STALE_MS       = 24 * 60 * 60 * 1000; // soft banner after 24 h

interface StoredSession {
  email: string;
  password: string;            // TODO: move to OS keychain
  payload: string;             // raw JSON string signed by server
  signature: string;           // hex HMAC-SHA256
  tier: 'starter' | 'hustler';
  status: 'active' | 'cancelled' | 'expired';
  expires_at: string | null;
  last_validated_at: string;
}

// What components consume — kept compatible with the old License shape so
// LicensePanel + status banners don't need to be rewritten today.
export interface Session {
  key: string;                 // legacy alias: the user's email
  email: string;
  tier: StoredSession['tier'];
  cadence: 'monthly';
  expires_at: string | null;
  payload: string;
  signature: string;
  last_validated_at: string;
  member: boolean;
}

interface SessionCtx {
  license: Session | null;
  activate: (key: string, password?: string) => Promise<LoginResult>;
  deactivate: () => void;
  softStale: boolean;
}

const Ctx = createContext<SessionCtx>({
  license: null,
  activate: async () => ({ ok: false, error: 'not initialised' }),
  deactivate: () => undefined,
  softStale: false,
});

export function useLicense(): SessionCtx {
  return useContext(Ctx);
}
export const useSession = useLicense;

export function SessionProvider({
  children,
  bypass = false,
}: {
  children: ReactNode;
  bypass?: boolean;
}) {
  const [stored, setStored] = useState<StoredSession | null>(() => loadStored());
  const [hydrated, setHydrated] = useState(false);
  const [gateReason, setGateReason] = useState<'expired' | 'no_subscription' | 'offline_stale' | undefined>(undefined);

  useEffect(() => {
    setHydrated(true);
    if (!stored) return;

    let cancelled = false;
    const runCheck = () => {
      if (cancelled || !stored) return;
      void revalidate(stored.email, stored.password).then((res) => {
        if (cancelled) return;
        if (res.ok) {
          persist(res.session);
        } else if (res.fatal) {
          // Credentials wrong, or no active subscription — kick to the gate.
          // Map the API reason to the gate's display state.
          setGateReason(res.reason === 'no_subscription' ? 'no_subscription' : 'expired');
          deactivate();
        }
        // Non-fatal (network/server down) → keep existing session.
      });
    };

    const last = new Date(stored.last_validated_at).getTime();
    if (Date.now() - last >= RECHECK_INTERVAL_MS) runCheck();

    const timer = setInterval(runCheck, RECHECK_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stored?.email]);

  function persist(s: StoredSession) {
    setStored(s);
    setGateReason(undefined);
    localStorage.setItem(LS_KEY, JSON.stringify(s));
  }

  function deactivate() {
    setStored(null);
    localStorage.removeItem(LS_KEY);
  }

  // `key` arg name kept for backwards compat with useLicense() callers; in
  // the new model the first arg is the email, second is password.
  async function activate(emailOrKey: string, password?: string): Promise<LoginResult> {
    if (!password) {
      return { ok: false, error: 'Passwort fehlt.', reason: 'invalid_credentials' };
    }
    const res = await revalidate(emailOrKey, password);
    if (res.ok) {
      persist(res.session);
      return { ok: true };
    }
    return { ok: false, error: res.error, reason: res.reason };
  }

  if (!hydrated) return null;

  const expired = stored ? sessionExpired(stored) : false;
  const offlineStale = stored ? sessionOfflineStale(stored) : false;

  if (!bypass && (!stored || expired || offlineStale)) {
    const reason = gateReason ?? (expired ? 'expired' : offlineStale ? 'offline_stale' : undefined);
    return (
      <SessionGate
        onLogin={activate}
        previousEmail={stored?.email}
        reason={reason}
      />
    );
  }

  const softStale = !!stored && sessionSoftStale(stored);

  const ctx: SessionCtx = {
    license: stored ? toSession(stored) : null,
    activate,
    deactivate,
    softStale,
  };

  return (
    <Ctx.Provider value={ctx}>
      {softStale && <SoftStaleBanner />}
      {children}
    </Ctx.Provider>
  );
}

function SoftStaleBanner() {
  return (
    <div className="sticky top-0 z-40 flex items-center justify-center gap-2 border-b border-amber-500/30 bg-amber-500/10 px-4 py-1.5 text-[11px] font-semibold text-amber-200">
      Session wird neu geprüft (Server nicht erreichbar). Bis zu 96 h Grace.
    </div>
  );
}

function toSession(s: StoredSession): Session {
  return {
    key: s.email,
    email: s.email,
    tier: s.tier,
    cadence: 'monthly',
    expires_at: s.expires_at,
    payload: s.payload,
    signature: s.signature,
    last_validated_at: s.last_validated_at,
    member: s.status === 'active' || (s.status === 'cancelled' && !!s.expires_at && new Date(s.expires_at) > new Date()),
  };
}

function loadStored(): StoredSession | null {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredSession;
    if (!parsed.email || !parsed.password || !parsed.signature) return null;
    return parsed;
  } catch {
    return null;
  }
}

function sessionExpired(s: StoredSession): boolean {
  if (!s.expires_at) return false;
  if (s.status === 'active') return false;
  return new Date(s.expires_at) < new Date();
}

function sessionOfflineStale(s: StoredSession): boolean {
  const last = new Date(s.last_validated_at).getTime();
  if (Number.isNaN(last)) return true;
  return Date.now() - last > OFFLINE_GRACE_MS;
}

function sessionSoftStale(s: StoredSession): boolean {
  const last = new Date(s.last_validated_at).getTime();
  if (Number.isNaN(last)) return false;
  const age = Date.now() - last;
  return age > SOFT_STALE_MS && age <= OFFLINE_GRACE_MS;
}

type LoginFailReason = 'invalid_credentials' | 'no_subscription' | 'offline' | 'unknown';

async function revalidate(
  email: string,
  password: string,
): Promise<
  | { ok: true; session: StoredSession }
  | { ok: false; error: string; fatal?: boolean; reason?: LoginFailReason }
> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 10_000);
    const r = await fetch(`${SESSION_API_URL}/api/desktop/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, machine_id: getMachineId() }),
      signal: ctrl.signal,
    }).finally(() => clearTimeout(t));

    if (r.status === 401) {
      return { ok: false, error: 'E-Mail oder Passwort falsch.', fatal: true, reason: 'invalid_credentials' };
    }
    if (r.status === 403) {
      return { ok: false, error: 'Kein aktives Abo auf diesem Account.', fatal: true, reason: 'no_subscription' };
    }
    if (r.status === 429) {
      return { ok: false, error: 'Zu viele Login-Versuche — bitte 5 Min warten.' };
    }
    if (r.status >= 500) {
      return { ok: false, error: `Server-Fehler ${r.status}.` };
    }
    if (!r.ok) {
      return { ok: false, error: `Server-Fehler ${r.status}.` };
    }

    const data = (await r.json()) as {
      ok: boolean;
      payload?: string;
      signature?: string;
      error?: string;
    };
    if (!data.ok || !data.payload || !data.signature) {
      return { ok: false, error: data.error ?? 'Ungültige Server-Antwort.' };
    }
    const sigOk = await verifyLicenseSignature(data.payload, data.signature);
    if (!sigOk) {
      return { ok: false, error: 'Signaturprüfung fehlgeschlagen.', fatal: true };
    }
    let payloadObj: {
      email?: string;
      tier?: 'starter' | 'hustler';
      status?: 'active' | 'cancelled' | 'expired';
      member?: boolean;
      expires_at?: string | null;
    } = {};
    try { payloadObj = JSON.parse(data.payload); } catch { /* */ }

    if (payloadObj.member === false) {
      return { ok: false, error: 'Kein aktives Abo auf diesem Account.', fatal: true, reason: 'no_subscription' };
    }

    return {
      ok: true,
      session: {
        email,
        password,
        payload: data.payload,
        signature: data.signature,
        tier: payloadObj.tier ?? 'hustler',
        status: payloadObj.status ?? 'active',
        expires_at: payloadObj.expires_at ?? null,
        last_validated_at: new Date().toISOString(),
      },
    };
  } catch (e) {
    if (e instanceof Error && (e.name === 'AbortError' || e.message === 'aborted')) {
      return { ok: false, error: `${SESSION_API_URL} antwortet nicht. Bestehende Session bleibt 96 h gültig.` };
    }
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.toLowerCase().includes('failed to fetch') || msg.toLowerCase().includes('network')) {
      return { ok: false, error: `Keine Verbindung zu ${SESSION_API_URL}. Offline 96 h Grace.` };
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
