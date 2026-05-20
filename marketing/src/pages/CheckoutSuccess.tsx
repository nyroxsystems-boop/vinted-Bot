import { useEffect, useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { CheckCircle2, Copy, Check, Download, Mail } from 'lucide-react';
import { Nav } from '../components/Nav';
import { Footer } from '../components/Footer';

export function CheckoutSuccessPage() {
  const [params] = useSearchParams();
  const sessionId = params.get('session_id');
  const [state, setState] = useState<
    | { stage: 'loading' }
    | { stage: 'ready'; key: string; email: string; tier: string }
    | { stage: 'error'; message: string }
  >({ stage: 'loading' });
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!sessionId) {
      setState({ stage: 'error', message: 'Keine Session-ID. Falls du gerade gekauft hast, prüfe deine E-Mail.' });
      return;
    }
    void (async () => {
      try {
        const r = await fetch(`/api/checkout/result?session_id=${encodeURIComponent(sessionId)}`);
        const data = await r.json();
        if (data.ok) {
          setState({ stage: 'ready', key: data.key, email: data.email, tier: data.tier });
        } else {
          setState({ stage: 'error', message: data.error ?? 'Konnte Lizenz nicht abrufen.' });
        }
      } catch (e) {
        setState({ stage: 'error', message: e instanceof Error ? e.message : 'Netzwerkfehler' });
      }
    })();
  }, [sessionId]);

  return (
    <div className="min-h-screen">
      <Nav />

      <section className="py-20">
        <div className="container-mid">
          <div className="card-glass relative overflow-hidden">
            <div className="pointer-events-none absolute inset-0 bg-grid opacity-20" />
            <div className="relative">
              <div className="mb-6 inline-flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500/15 ring-1 ring-emerald-500/30">
                <CheckCircle2 size={26} className="text-emerald-400" />
              </div>

              <h1 className="font-display text-3xl font-extrabold tracking-tight text-white sm:text-4xl">
                Willkommen im <span className="gradient-text">Hustle.</span>
              </h1>
              <p className="mt-3 max-w-xl text-zinc-400">
                Deine Zahlung war erfolgreich. Dein Lizenz-Key ist unten — kopiere ihn jetzt
                oder hol ihn dir später aus deinem Postfach.
              </p>

              {state.stage === 'loading' && (
                <div className="mt-10 animate-pulse rounded-xl border border-white/10 bg-white/[0.04] p-6">
                  <div className="h-3 w-24 rounded bg-white/10" />
                  <div className="mt-3 h-10 w-full rounded bg-white/10" />
                </div>
              )}

              {state.stage === 'error' && (
                <div className="mt-8 rounded-xl border border-amber-500/30 bg-amber-500/5 p-5 text-sm text-amber-200">
                  <p className="font-semibold text-amber-100">{state.message}</p>
                  <p className="mt-2">
                    Schau in deine E-Mail — wir haben den Key direkt versendet. Sollte sie nicht
                    ankommen, nutze die{' '}
                    <Link to="/members" className="underline">
                      Lizenz-Recovery
                    </Link>.
                  </p>
                </div>
              )}

              {state.stage === 'ready' && (
                <>
                  <div className="mt-8 rounded-xl border border-white/10 bg-zinc-950 p-5">
                    <div className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
                      Dein Lizenz-Key — Tier {state.tier}
                    </div>
                    <div className="mt-3 flex items-center gap-3">
                      <code className="flex-1 break-all font-mono text-lg font-bold text-white">
                        {state.key}
                      </code>
                      <button
                        type="button"
                        onClick={() => {
                          void navigator.clipboard.writeText(state.key);
                          setCopied(true);
                          setTimeout(() => setCopied(false), 1500);
                        }}
                        className="btn-ghost"
                      >
                        {copied ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />}
                        {copied ? 'Kopiert' : 'Kopieren'}
                      </button>
                    </div>
                  </div>

                  <div className="mt-6 flex items-center gap-2 text-sm text-zinc-400">
                    <Mail size={14} className="text-zinc-500" />
                    Eine Kopie wurde an <span className="font-semibold text-white">{state.email}</span> gesendet.
                  </div>

                  <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                    <Link to="/downloads" className="btn-primary">
                      <Download size={15} /> App herunterladen
                    </Link>
                    <Link to="/members" className="btn-ghost">
                      Zur Mitglieder-Seite
                    </Link>
                  </div>

                  <div className="mt-10 rounded-xl border border-white/5 bg-white/[0.02] p-5 text-sm text-zinc-400">
                    <p className="font-semibold text-white">Nächste Schritte:</p>
                    <ol className="mt-2 list-decimal space-y-1.5 pl-5">
                      <li>Lade Blackruby für Mac oder Windows herunter.</li>
                      <li>Beim ersten Start: Key oben einkleben.</li>
                      <li>Wizard führt dich durch Vinted-Login und CJ-API-Key.</li>
                      <li>Erste Listings importieren und „Alles listen jetzt" klicken.</li>
                    </ol>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </section>

      <Footer />
    </div>
  );
}
