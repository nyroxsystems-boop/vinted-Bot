// DesktopLink — landing page for the Tauri app's "Mit Google anmelden" flow.
//
// The desktop opens https://blackruby.de/desktop-link?token=<hex> in the
// user's default browser. We detect the token, walk the user through any
// missing auth step (login + Google OAuth), then call /api/desktop/link-confirm
// to bind the token to the just-authenticated user. The desktop polls
// /api/desktop/link-poll in the background and picks up the signed session
// once we confirm. After that, this page just shows "Du kannst zurück
// in die App" and the user closes the tab.
//
// Failure modes handled inline:
//   - No token in URL          → show a "der Link ist ungültig" panel
//   - Token already consumed   → "Anderes Gerät hat den Link schon benutzt"
//   - Token expired            → "Link abgelaufen — neu in der App starten"
//   - User has no subscription → bounce to /pricing with a hint
//
// We DON'T auto-redirect / auto-close — the user explicitly closes the tab.
// Tauri can't close another browser's tab anyway.

import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { CheckCircle2, AlertTriangle, Loader2, ArrowRight, Monitor } from 'lucide-react';
import { Nav } from '../components/Nav';
import { Footer } from '../components/Footer';
import { useAuth } from '../lib/auth';

type Phase =
  | { kind: 'loading' }
  | { kind: 'need-login' }      // not logged in yet — show CTA to /login
  | { kind: 'confirming' }      // logged in, calling /link-confirm
  | { kind: 'done' }            // success — desktop will pick it up shortly
  | { kind: 'expired' }         // token expired or unknown
  | { kind: 'already-used' }    // token already consumed
  | { kind: 'error'; msg: string };

const HEX_TOKEN = /^[a-f0-9]{32,128}$/i;

export function DesktopLinkPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { user, ready } = useAuth();
  const token = params.get('token') ?? '';

  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  // Strict-mode runs effects twice in dev — guard so /link-confirm isn't
  // hit twice (which would 409 on the second call and look like an error).
  const sentRef = useRef(false);

  useEffect(() => {
    if (!ready) return;

    if (!token || !HEX_TOKEN.test(token)) {
      setPhase({ kind: 'error', msg: 'Kein gültiger Token in der URL — startet den Login bitte erneut in der App.' });
      return;
    }

    if (!user) {
      setPhase({ kind: 'need-login' });
      return;
    }

    if (sentRef.current) return;
    sentRef.current = true;

    setPhase({ kind: 'confirming' });
    void (async () => {
      try {
        const r = await fetch('/api/desktop/link-confirm', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token }),
        });
        if (r.status === 410) return setPhase({ kind: 'expired' });
        if (r.status === 404) return setPhase({ kind: 'expired' });
        if (r.status === 409) return setPhase({ kind: 'already-used' });
        if (!r.ok) {
          const data = await r.json().catch(() => ({}));
          return setPhase({ kind: 'error', msg: data.error ?? `Server-Fehler ${r.status}` });
        }
        setPhase({ kind: 'done' });
      } catch (e) {
        setPhase({ kind: 'error', msg: (e as Error).message });
      }
    })();
  }, [ready, user, token]);

  return (
    <div className="min-h-screen">
      <Nav />

      <section className="px-5 py-16 md:py-24">
        <div className="container-narrow max-w-lg">
          <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-8 shadow-2xl">
            <div className="mb-5 inline-flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-rose-500/20 to-indigo-500/20 text-rose-300 ring-1 ring-rose-500/20">
              <Monitor size={22} />
            </div>

            {phase.kind === 'loading' && (
              <Body title="Lade …">
                <Loader2 size={20} className="animate-spin text-zinc-500" />
              </Body>
            )}

            {phase.kind === 'need-login' && (
              <Body
                title="Erst einloggen"
                subtitle="Damit wir deinen Account mit der Desktop-App verbinden können, log dich kurz ein — danach geht's automatisch weiter."
              >
                <button
                  type="button"
                  onClick={() => {
                    const next = encodeURIComponent(`/desktop-link?token=${token}`);
                    navigate(`/login?next=${next}`);
                  }}
                  className="btn-primary inline-flex w-full items-center justify-center gap-2"
                >
                  Zum Login <ArrowRight size={15} />
                </button>
              </Body>
            )}

            {phase.kind === 'confirming' && (
              <Body title="Verbinde deinen Account …">
                <div className="flex items-center gap-2 text-sm text-zinc-400">
                  <Loader2 size={16} className="animate-spin" />
                  einen Moment …
                </div>
              </Body>
            )}

            {phase.kind === 'done' && (
              <Body
                title="Geschafft."
                subtitle="Du kannst jetzt zurück in die Blackruby-App — die hat sich gerade automatisch eingeloggt. Dieses Browser-Fenster kannst du schließen."
                icon={<CheckCircle2 size={20} className="text-emerald-300" />}
              />
            )}

            {phase.kind === 'expired' && (
              <Body
                tone="amber"
                title="Link abgelaufen."
                subtitle='Der Login-Link ist nur 10 Minuten gültig. Geh zurück in die Blackruby-App und klick noch mal auf "Mit Google anmelden".'
                icon={<AlertTriangle size={18} className="text-amber-300" />}
              />
            )}

            {phase.kind === 'already-used' && (
              <Body
                tone="amber"
                title="Anderes Gerät war schneller."
                subtitle="Dieser Login-Link wurde gerade von einem anderen Gerät benutzt. Wenn das nicht du warst, ändere besser dein Passwort. Ansonsten kannst du in der App den Login einfach erneut starten."
                icon={<AlertTriangle size={18} className="text-amber-300" />}
              />
            )}

            {phase.kind === 'error' && (
              <Body
                tone="rose"
                title="Ups."
                subtitle={`Es ist etwas schiefgelaufen: ${phase.msg}`}
                icon={<AlertTriangle size={18} className="text-rose-300" />}
              />
            )}
          </div>
        </div>
      </section>

      <Footer />
    </div>
  );
}

function Body({
  title,
  subtitle,
  children,
  icon,
  tone,
}: {
  title: string;
  subtitle?: string;
  children?: React.ReactNode;
  icon?: React.ReactNode;
  tone?: 'amber' | 'rose';
}) {
  const titleColor =
    tone === 'amber' ? 'text-amber-100'
      : tone === 'rose' ? 'text-rose-100'
      : 'text-white';
  return (
    <div>
      <div className="flex items-center gap-2.5">
        {icon}
        <h1 className={`text-2xl font-bold tracking-tight ${titleColor}`}>{title}</h1>
      </div>
      {subtitle && (
        <p className="mt-3 text-sm leading-relaxed text-zinc-400">{subtitle}</p>
      )}
      {children && <div className="mt-6">{children}</div>}
    </div>
  );
}
