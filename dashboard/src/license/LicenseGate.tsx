import { useState } from 'react';
import { KeyRound, ShieldCheck, ArrowRight, AlertTriangle, ExternalLink } from 'lucide-react';
import { Logo } from '../components/Logo';

interface Props {
  onActivate: (key: string) => Promise<{ ok: true } | { ok: false; error: string }>;
  previousKey?: string;
  reason?: 'expired' | 'offline_stale';
}

export function LicenseGate({ onActivate, previousKey, reason }: Props) {
  const [key, setKey] = useState(previousKey ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await onActivate(key);
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
          <h1 className="text-2xl font-bold tracking-tight text-white">Lizenz aktivieren</h1>
          <p className="mt-1.5 text-sm text-zinc-400">
            Gib den Key ein, den du nach dem Kauf per E-Mail erhalten hast.
          </p>

          {reason === 'expired' && (
            <div className="mt-5 flex items-start gap-2.5 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-200">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" />
              <span>
                Deine Lizenz ist abgelaufen. Verlängere sie unter{' '}
                <a
                  href="https://blackruby.app/members"
                  target="_blank"
                  rel="noreferrer"
                  className="underline hover:text-amber-100"
                >
                  blackruby.app/members
                </a>{' '}
                und gib den neuen Key hier ein.
              </span>
            </div>
          )}

          {reason === 'offline_stale' && (
            <div className="mt-5 flex items-start gap-2.5 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-200">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" />
              <span>
                Lizenz konnte länger als 96 h nicht mit dem Server abgeglichen werden.
                Geh kurz online und aktiviere erneut — danach läuft alles wie gewohnt.
              </span>
            </div>
          )}

          <form onSubmit={submit} className="mt-6 space-y-4">
            <div>
              <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
                Lizenz-Key
              </label>
              <div className="relative">
                <KeyRound size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
                <input
                  type="text"
                  required
                  autoFocus
                  value={key}
                  onChange={(e) => setKey(e.target.value.toUpperCase())}
                  placeholder="BRBY-XXXX-XXXX-XXXX-XXXX-XXXX"
                  className="w-full rounded-xl border border-white/10 bg-zinc-900/60 py-3 pl-10 pr-4 font-mono text-sm text-white placeholder-zinc-600 transition focus:border-rose-500 focus:outline-none focus:ring-1 focus:ring-rose-500"
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
              disabled={busy || key.length < 6}
              className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-rose-500 via-rose-500 to-rose-500 px-5 py-3 text-sm font-bold text-white shadow-2xl shadow-rose-700/40 transition active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {busy ? 'Aktiviere…' : 'Aktivieren'}
              <ArrowRight size={15} />
            </button>
          </form>

          <div className="mt-6 flex flex-col items-center gap-2 border-t border-white/5 pt-5 text-xs text-zinc-500">
            <span className="flex items-center gap-1.5">
              <ShieldCheck size={12} className="text-rose-400" /> Validierung über blackruby.app — funktioniert offline nach 1. Aktivierung
            </span>
            <a
              href="https://blackruby.app/members"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 hover:text-zinc-300"
            >
              Key vergessen? Recovery <ExternalLink size={11} />
            </a>
          </div>
        </div>

        <p className="mt-4 text-center text-xs text-zinc-600">
          Noch keine Lizenz?{' '}
          <a
            href="https://blackruby.app/pricing"
            target="_blank"
            rel="noreferrer"
            className="font-semibold text-zinc-400 hover:text-white"
          >
            blackruby.app/pricing
          </a>
        </p>
      </div>
    </div>
  );
}
