// SessionGate — login screen that replaces the old license-key gate.
//
// Customers no longer paste a 24-char key. They sign in with the same
// email + password they created at blackruby.de/login (or at checkout).
// The desktop app POSTs the credentials to /api/desktop/session and
// caches the signed payload + the credentials in localStorage. Future
// launches auto-login.
//
// reason='no_subscription' is shown when the credentials worked but the
// user has no active Stripe subscription — typically when an abo expired
// while the app was running. We give a one-tap link out to /members
// to renew.

import { useState } from 'react';
import {
  Mail, Lock, ArrowRight, AlertTriangle, ShieldCheck, ExternalLink, Loader2,
  KeyRound, ChevronDown, X,
} from 'lucide-react';
import { Logo } from '../components/Logo';

export type LoginResult =
  | { ok: true }
  | { ok: false; error: string; reason?: 'invalid_credentials' | 'no_subscription' | 'offline' | 'unknown' };

export interface BrowserLoginHandle {
  /** Promise that resolves to the final login result. */
  result: Promise<LoginResult>;
  /** Cancel the in-flight flow (e.g. user closed the modal). */
  cancel: () => void;
}

interface Props {
  onLogin: (email: string, password: string) => Promise<LoginResult>;
  /** Browser-OAuth path. Opens the user's default browser to blackruby.de,
   *  polls the link-poll endpoint, resolves with the eventual outcome. */
  onLoginWithBrowser?: () => BrowserLoginHandle;
  /** Manual code-entry fallback for very locked-down environments where
   *  the desktop can't open the browser. */
  onLoginWithCode?: (code: string) => Promise<LoginResult>;
  previousEmail?: string;
  reason?: 'expired' | 'no_subscription' | 'offline_stale';
}

export function SessionGate({
  onLogin,
  onLoginWithBrowser,
  onLoginWithCode,
  previousEmail,
  reason,
}: Props) {
  const [email, setEmail] = useState(previousEmail ?? '');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Browser-OAuth state — shows a "Warte auf Browser …" modal while
  // polling the server. Stored as a Handle so we can cancel mid-flight
  // if the user clicks "abbrechen" (closes the tab in their head).
  const [browserHandle, setBrowserHandle] = useState<BrowserLoginHandle | null>(null);
  const [browserError, setBrowserError] = useState<string | null>(null);

  // Code-login UI (collapsed by default — most users come back to the
  // password path on subsequent logins; the code is for the rare case
  // where the desktop can't open the browser).
  const [codeOpen, setCodeOpen] = useState(false);
  const [code, setCode] = useState('');
  const [codeBusy, setCodeBusy] = useState(false);
  const [codeError, setCodeError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await onLogin(email.trim().toLowerCase(), password);
    if (!res.ok) setError(res.error);
    setBusy(false);
  }

  async function startBrowserLogin() {
    if (!onLoginWithBrowser || browserHandle) return;
    setBrowserError(null);
    const handle = onLoginWithBrowser();
    setBrowserHandle(handle);
    try {
      const res = await handle.result;
      if (!res.ok) setBrowserError(res.error);
    } catch (e) {
      setBrowserError((e as Error).message);
    } finally {
      setBrowserHandle(null);
    }
  }

  function cancelBrowserLogin() {
    browserHandle?.cancel();
    setBrowserHandle(null);
  }

  async function submitCode(e: React.FormEvent) {
    e.preventDefault();
    if (!onLoginWithCode) return;
    setCodeBusy(true);
    setCodeError(null);
    const res = await onLoginWithCode(code.trim());
    if (!res.ok) setCodeError(res.error);
    setCodeBusy(false);
  }

  return (
    <div className="grid min-h-screen place-items-center bg-zinc-950 px-4">
      <div className="pointer-events-none absolute inset-0 -z-10 opacity-50">
        <div className="absolute left-1/2 top-1/3 h-[400px] w-[700px] -translate-x-1/2 rounded-full bg-rose-500/20 blur-[140px]" />
        <div className="absolute left-1/3 top-2/3 h-[300px] w-[600px] rounded-full bg-rose-500/15 blur-[120px]" />
      </div>

      {/* Browser-OAuth waiting modal — shown while the user does Google OAuth
          in their default browser. Auto-dismisses when the link-poll succeeds. */}
      {browserHandle && (
        <BrowserWaitModal onCancel={cancelBrowserLogin} />
      )}

      <div className="w-full max-w-md">
        <div className="mb-8 flex items-center gap-3">
          <Logo size={36} />
          <div>
            <div className="font-display text-xl font-bold tracking-tight text-white">Blackruby</div>
            <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-500">
              Hustle Engine
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-7 shadow-2xl backdrop-blur-xl">
          <h1 className="text-2xl font-bold tracking-tight text-white">Anmelden</h1>
          <p className="mt-1.5 text-sm text-zinc-400">
            Mit deinen Blackruby-Account-Daten. Solange dein Abo aktiv ist, läuft die App.
          </p>

          {reason === 'expired' && (
            <ReasonBox tone="amber">
              Dein Abo ist abgelaufen. Reaktivier es unter{' '}
              <a href="https://blackruby.de/members" target="_blank" rel="noreferrer" className="underline hover:text-amber-100">
                blackruby.de/members
              </a>{' '}— danach hier neu einloggen.
            </ReasonBox>
          )}

          {reason === 'no_subscription' && (
            <ReasonBox tone="amber">
              Account gefunden, aber kein aktives Abo. Hol dir einen Plan unter{' '}
              <a href="https://blackruby.de/pricing" target="_blank" rel="noreferrer" className="underline hover:text-amber-100">
                blackruby.de/pricing
              </a>.
            </ReasonBox>
          )}

          {reason === 'offline_stale' && (
            <ReasonBox tone="amber">
              Letzte Server-Validierung war vor mehr als 96 h. Geh online + log dich neu ein —
              danach läuft alles wie gewohnt.
            </ReasonBox>
          )}

          {/* Primary: Google sign-in (the path every user expects). Opens
              the user's default browser to blackruby.de/desktop-link?token=...,
              completes the OAuth flow there, then the desktop polls the
              server and finishes silently. */}
          {onLoginWithBrowser && (
            <div className="mt-6">
              <button
                type="button"
                onClick={startBrowserLogin}
                disabled={!!browserHandle}
                className="inline-flex w-full items-center justify-center gap-3 rounded-xl border border-white/15 bg-white/[0.05] px-5 py-3 text-sm font-semibold text-white transition hover:bg-white/[0.08] active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed"
              >
                <GoogleIcon size={18} />
                Mit Google anmelden
              </button>

              {browserError && (
                <div className="mt-2 flex items-start gap-2 text-xs text-rose-300">
                  <AlertTriangle size={12} className="mt-0.5 shrink-0" />
                  <span>{browserError}</span>
                </div>
              )}

              <div className="my-5 flex items-center gap-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-600">
                <div className="h-px flex-1 bg-white/10" />
                oder mit E-Mail
                <div className="h-px flex-1 bg-white/10" />
              </div>
            </div>
          )}

          <form onSubmit={submit} className="mt-6 space-y-4">
            <div>
              <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
                E-Mail
              </label>
              <div className="relative">
                <Mail size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
                <input
                  type="email"
                  required
                  autoFocus={!previousEmail}
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="w-full rounded-xl border border-white/10 bg-zinc-900/60 py-3 pl-10 pr-4 text-sm text-white placeholder-zinc-600 transition focus:border-rose-500 focus:outline-none focus:ring-1 focus:ring-rose-500"
                />
              </div>
            </div>

            <div>
              <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
                Passwort
              </label>
              <div className="relative">
                <Lock size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
                <input
                  type="password"
                  required
                  autoFocus={!!previousEmail}
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full rounded-xl border border-white/10 bg-zinc-900/60 py-3 pl-10 pr-4 text-sm text-white placeholder-zinc-600 transition focus:border-rose-500 focus:outline-none focus:ring-1 focus:ring-rose-500"
                />
              </div>
            </div>

            {error && (
              <div className="flex items-start gap-2 text-sm text-rose-300">
                <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={busy || !email || !password}
              className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-rose-500 to-rose-500 px-5 py-3 text-sm font-bold text-white shadow-2xl shadow-rose-700/40 transition active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {busy ? (
                <Loader2 size={15} className="animate-spin" />
              ) : (
                <>
                  Anmelden <ArrowRight size={15} />
                </>
              )}
            </button>
          </form>

          {/* Code-login (collapsed by default). For Google-signed-up users
              who never set a password — they generate a one-time code at
              blackruby.de/members and type it here. */}
          {onLoginWithCode && (
            <div className="mt-5 border-t border-white/5 pt-5">
              <button
                type="button"
                onClick={() => setCodeOpen((v) => !v)}
                className="flex w-full items-center justify-between gap-2 text-left text-xs font-semibold uppercase tracking-wider text-zinc-400 transition hover:text-zinc-200"
              >
                <span className="flex items-center gap-2">
                  <KeyRound size={12} className="text-rose-400" />
                  Mit Code aus Browser einloggen
                </span>
                <ChevronDown
                  size={14}
                  className={`transition-transform ${codeOpen ? 'rotate-180' : ''}`}
                />
              </button>

              {codeOpen && (
                <form onSubmit={submitCode} className="mt-3 space-y-3">
                  <p className="text-[11px] leading-relaxed text-zinc-500">
                    Mit Google angemeldet? Geh auf{' '}
                    <a
                      href="https://blackruby.de/members"
                      target="_blank"
                      rel="noreferrer"
                      className="text-zinc-300 underline hover:text-white"
                    >
                      blackruby.de/members
                    </a>{' '}
                    → „Desktop-App verbinden" → Code generieren, dann hier eintippen.
                  </p>
                  <input
                    type="text"
                    inputMode="text"
                    autoCapitalize="characters"
                    autoComplete="off"
                    spellCheck={false}
                    maxLength={6}
                    value={code}
                    onChange={(e) => setCode(e.target.value.toUpperCase())}
                    placeholder="AB3F7K"
                    className="w-full rounded-xl border border-white/10 bg-zinc-900/60 px-4 py-3 text-center font-mono text-lg font-bold uppercase tracking-[0.35em] text-white placeholder-zinc-700 transition focus:border-rose-500 focus:outline-none focus:ring-1 focus:ring-rose-500"
                  />
                  {codeError && (
                    <div className="flex items-start gap-2 text-xs text-rose-300">
                      <AlertTriangle size={12} className="mt-0.5 shrink-0" />
                      <span>{codeError}</span>
                    </div>
                  )}
                  <button
                    type="submit"
                    disabled={codeBusy || code.length < 4}
                    className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-rose-500/40 bg-rose-500/10 px-5 py-2.5 text-sm font-bold text-rose-100 transition hover:bg-rose-500/20 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {codeBusy ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : (
                      <>
                        Mit Code anmelden <ArrowRight size={14} />
                      </>
                    )}
                  </button>
                </form>
              )}
            </div>
          )}

          <div className="mt-6 flex flex-col items-center gap-2 border-t border-white/5 pt-5 text-xs text-zinc-500">
            <span className="flex items-center gap-1.5">
              <ShieldCheck size={12} className="text-rose-400" />
              Validierung via blackruby.de — offline-tolerant für 96 h
            </span>
            <a
              href="https://blackruby.de/login"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 hover:text-zinc-300"
            >
              Passwort vergessen? <ExternalLink size={11} />
            </a>
          </div>
        </div>

        <p className="mt-4 text-center text-xs text-zinc-600">
          Noch keinen Account?{' '}
          <a
            href="https://blackruby.de/pricing"
            target="_blank"
            rel="noreferrer"
            className="font-semibold text-zinc-400 hover:text-white"
          >
            blackruby.de/pricing
          </a>
        </p>
      </div>
    </div>
  );
}

function ReasonBox({ children, tone }: { children: React.ReactNode; tone: 'amber' | 'rose' }) {
  const cls = tone === 'amber'
    ? 'border-amber-500/30 bg-amber-500/5 text-amber-200'
    : 'border-rose-500/30 bg-rose-500/5 text-rose-200';
  return (
    <div className={`mt-5 flex items-start gap-2.5 rounded-lg border ${cls} p-3 text-xs`}>
      <AlertTriangle size={14} className="mt-0.5 shrink-0" />
      <span>{children}</span>
    </div>
  );
}

/**
 * Modal shown while the user does Google OAuth in their default browser.
 * Provides a cancel button (in case the user closed the tab without
 * completing) and the obvious copy-paste fallback URL (rare edge case
 * where Tauri couldn't shell-open the browser).
 */
function BrowserWaitModal({ onCancel }: { onCancel: () => void }) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 px-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-zinc-950 p-6 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-bold text-white">Bestätige im Browser</h2>
            <p className="mt-1.5 text-sm leading-relaxed text-zinc-400">
              Wir haben deinen Browser geöffnet. Log dich dort mit Google ein —
              sobald du fertig bist, melden wir dich hier automatisch an.
            </p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg p-1.5 text-zinc-500 transition hover:bg-white/5 hover:text-white"
            title="Abbrechen"
          >
            <X size={16} />
          </button>
        </div>

        <div className="mt-5 flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.02] p-4">
          <Loader2 size={18} className="shrink-0 animate-spin text-rose-400" />
          <span className="text-xs text-zinc-400">
            Warte auf Bestätigung … (bis zu 10 Min)
          </span>
        </div>

        <button
          type="button"
          onClick={onCancel}
          className="mt-4 w-full rounded-xl border border-white/10 px-4 py-2 text-xs text-zinc-400 transition hover:bg-white/5 hover:text-white"
        >
          Abbrechen
        </button>
      </div>
    </div>
  );
}

/**
 * Brand-true Google "G" logo. We render the SVG inline rather than pulling
 * in a 30 KB icon-set just for this — Google's own asset guidelines allow
 * the multi-colour G provided we don't recolour it.
 */
function GoogleIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden>
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3c-1.6 4.7-6.1 8-11.3 8-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.1 7.9 3l5.6-5.6C33.8 6.1 29.2 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.3-.4-3.5z"/>
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.6 16 18.9 13 24 13c3.1 0 5.8 1.1 7.9 3l5.6-5.6C33.8 6.1 29.2 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/>
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.4 26.7 36 24 36c-5.2 0-9.6-3.3-11.2-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/>
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.3-2.3 4.3-4.2 5.6l6.2 5.2C39 35.5 44 30.3 44 24c0-1.3-.1-2.3-.4-3.5z"/>
    </svg>
  );
}
