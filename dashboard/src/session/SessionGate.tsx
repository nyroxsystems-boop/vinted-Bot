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
} from 'lucide-react';
import { Logo } from '../components/Logo';

export type LoginResult =
  | { ok: true }
  | { ok: false; error: string; reason?: 'invalid_credentials' | 'no_subscription' | 'offline' | 'unknown' };

interface Props {
  onLogin: (email: string, password: string) => Promise<LoginResult>;
  previousEmail?: string;
  reason?: 'expired' | 'no_subscription' | 'offline_stale';
}

export function SessionGate({ onLogin, previousEmail, reason }: Props) {
  const [email, setEmail] = useState(previousEmail ?? '');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await onLogin(email.trim().toLowerCase(), password);
    if (!res.ok) setError(res.error);
    setBusy(false);
  }

  return (
    <div className="grid min-h-screen place-items-center bg-zinc-950 px-4">
      <div className="pointer-events-none absolute inset-0 -z-10 opacity-50">
        <div className="absolute left-1/2 top-1/3 h-[400px] w-[700px] -translate-x-1/2 rounded-full bg-rose-500/20 blur-[140px]" />
        <div className="absolute left-1/3 top-2/3 h-[300px] w-[600px] rounded-full bg-rose-500/15 blur-[120px]" />
      </div>

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
