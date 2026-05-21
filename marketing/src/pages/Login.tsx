// Login / Register — single dual-mode page.
//
// Toggle between "Anmelden" and "Account erstellen" via a top-tab. After a
// successful submission redirect to /members (or to ?next=... if the visitor
// landed here from a gated checkout flow). All inputs match the dark
// marketing aesthetic — no separate auth shell.

import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowRight, Mail, Lock, Sparkles, ShieldCheck, Loader2, type LucideIcon } from 'lucide-react';
import { GoogleLogin, type CredentialResponse } from '@react-oauth/google';
import { Nav } from '../components/Nav';
import { Footer } from '../components/Footer';
import { useAuth } from '../lib/auth';

export function LoginPage() {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { user, ready, login, register } = useAuth();

  useEffect(() => {
    // If already logged in, redirect immediately.
    if (ready && user) {
      const next = params.get('next') || '/members';
      navigate(next, { replace: true });
    }
  }, [ready, user, navigate, params]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === 'login') await login(email, password);
      else                  await register(email, password);
      const next = params.get('next') || '/members';
      navigate(next, { replace: true });
    } catch (e) {
      const code = (e as Error).message;
      setError(
        {
          invalid_credentials: 'E-Mail oder Passwort falsch.',
          email_in_use:        'Diese E-Mail ist bereits registriert. Stattdessen anmelden?',
          invalid_input:       'Bitte E-Mail und Passwort (mind. 8 Zeichen) eingeben.',
        }[code] ?? 'Etwas ist schiefgelaufen. Bitte erneut versuchen.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen">
      <Nav />
      <section className="px-5 py-16 md:py-24">
        <div className="mx-auto w-full max-w-md">
          <div className="text-center">
            <span className="eyebrow">
              <Sparkles size={12} /> Member-Space
            </span>
            <h1 className="font-display mt-5 text-3xl font-bold tracking-tight text-white sm:text-4xl">
              {mode === 'login' ? 'Anmelden.' : 'Account erstellen.'}
            </h1>
            <p className="mt-3 text-sm text-zinc-400">
              {mode === 'login'
                ? 'Lizenz verwalten, Abo kündigen, Live-Chat — alles an einem Ort.'
                : 'Erst Account, dann Lizenz. So bleibt alles an einer E-Mail gebunden.'}
            </p>
          </div>

          {/* Tabs */}
          <div className="mt-8 flex rounded-xl border border-white/10 bg-white/[0.03] p-1">
            {(['login', 'register'] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => { setMode(m); setError(null); }}
                className={`flex-1 rounded-lg px-4 py-2 text-sm font-semibold transition ${
                  mode === m ? 'bg-white text-zinc-950' : 'text-zinc-400 hover:text-white'
                }`}
              >
                {m === 'login' ? 'Anmelden' : 'Registrieren'}
              </button>
            ))}
          </div>

          {/* Google Sign-In */}
          <GoogleAuthButton
            onSuccess={async (credential) => {
              setBusy(true);
              setError(null);
              try {
                const r = await fetch('/api/auth/google', {
                  method: 'POST',
                  credentials: 'include',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ credential }),
                });
                const data = await r.json();
                if (!data.ok) throw new Error(data.error ?? 'google_failed');
                // Hard reload triggers /api/auth/me revalidation cleanly.
                window.location.assign(params.get('next') || '/members');
              } catch (e) {
                setError(
                  (e as Error).message === 'google_login_disabled'
                    ? 'Google-Login ist auf diesem Deployment noch nicht konfiguriert.'
                    : 'Google-Login fehlgeschlagen. Versuche es mit E-Mail + Passwort.',
                );
                setBusy(false);
              }
            }}
            onError={() => setError('Google-Login abgebrochen.')}
          />

          {/* Divider */}
          <div className="my-5 flex items-center gap-3">
            <div className="h-px flex-1 bg-white/10" />
            <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-500">
              oder mit E-Mail
            </span>
            <div className="h-px flex-1 bg-white/10" />
          </div>

          <form onSubmit={onSubmit} className="space-y-3">
            <Field
              label="E-Mail"
              icon={Mail}
              type="email"
              autoComplete="email"
              value={email}
              onChange={setEmail}
              required
            />
            <Field
              label="Passwort"
              icon={Lock}
              type="password"
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              value={password}
              onChange={setPassword}
              required
              minLength={mode === 'register' ? 8 : undefined}
              hint={mode === 'register' ? 'Mindestens 8 Zeichen' : undefined}
            />

            {error && (
              <div className="rounded-lg border border-ruby-500/30 bg-ruby-500/[0.06] px-3 py-2 text-xs text-ruby-200">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={busy}
              className="btn-primary mt-2 w-full justify-center"
            >
              {busy ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <>
                  {mode === 'login' ? 'Anmelden' : 'Account erstellen'}
                  <ArrowRight size={14} />
                </>
              )}
            </button>

            <div className="flex items-center justify-center gap-2 pt-3 text-[11px] text-zinc-500">
              <ShieldCheck size={11} className="text-emerald-400" />
              <span>HTTP-only Session-Cookie · keine Drittanbieter-Tracker</span>
            </div>
          </form>

          {mode === 'register' && (
            <p className="mt-6 text-center text-xs text-zinc-500">
              Mit der Registrierung akzeptierst du unsere{' '}
              <Link to="/legal/agb" className="text-zinc-300 hover:text-white">AGB</Link>{' '}und{' '}
              <Link to="/legal/datenschutz" className="text-zinc-300 hover:text-white">Datenschutzerklärung</Link>.
            </p>
          )}
        </div>
      </section>
      <Footer />
    </div>
  );
}

function GoogleAuthButton({
  onSuccess,
  onError,
}: {
  onSuccess: (credential: string) => void | Promise<void>;
  onError: () => void;
}) {
  // The dark + pill variant blends with our zinc-950 background. The button
  // rendered by Google is iframe-embedded so we can't fully restyle, but
  // theme + shape props get us close.
  return (
    <div className="mt-6 flex justify-center">
      <GoogleLogin
        onSuccess={(resp: CredentialResponse) => {
          if (resp.credential) void onSuccess(resp.credential);
        }}
        onError={onError}
        theme="filled_black"
        size="large"
        shape="pill"
        text="continue_with"
        useOneTap={false}
      />
    </div>
  );
}

function Field({
  label, icon: Icon, type, value, onChange, required, autoComplete, minLength, hint,
}: {
  label: string;
  icon: LucideIcon;
  type: 'email' | 'password' | 'text';
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
  autoComplete?: string;
  minLength?: number;
  hint?: string;
}) {
  return (
    <label className="block">
      <div className="mb-1.5 flex items-center justify-between text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
        <span>{label}</span>
        {hint && <span className="text-zinc-600 normal-case tracking-normal">{hint}</span>}
      </div>
      <div className="relative">
        <Icon size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
        <input
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          required={required}
          autoComplete={autoComplete}
          minLength={minLength}
          className="w-full rounded-xl border border-white/10 bg-white/[0.03] py-3 pl-9 pr-3 text-sm text-white outline-none transition placeholder:text-zinc-600 focus:border-ruby-500/40 focus:bg-white/[0.05]"
        />
      </div>
    </label>
  );
}
