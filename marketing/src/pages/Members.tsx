import { useState } from 'react';
import { KeyRound, Copy, Check, Download, ExternalLink, Mail, ShieldCheck } from 'lucide-react';
import { Nav } from '../components/Nav';
import { Footer } from '../components/Footer';

interface LicenseInfo {
  ok: true;
  email: string;
  tier: 'starter' | 'hustler';
  key: string;
  expires_at: string | null;
  status: 'active' | 'cancelled' | 'expired';
}

export function MembersPage() {
  const [email, setEmail] = useState('');
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<LicenseInfo | null>(null);
  const [copied, setCopied] = useState(false);

  async function lookup(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await fetch('/api/license/lookup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), key: key.trim() }),
      });
      const data = await r.json();
      if (data.ok) {
        setInfo(data);
      } else {
        setError(data.error ?? 'Lizenz nicht gefunden. Bitte E-Mail und Key prüfen.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Netzwerkfehler');
    } finally {
      setBusy(false);
    }
  }

  async function resendByEmail() {
    if (!email.trim()) {
      setError('E-Mail eingeben, dann erneut klicken.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const r = await fetch('/api/license/resend', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim() }),
      });
      const data = await r.json();
      if (data.ok) {
        setError(null);
        alert('Lizenz-Key wurde an deine E-Mail gesendet.');
      } else {
        setError(data.error ?? 'Versand fehlgeschlagen.');
      }
    } finally {
      setBusy(false);
    }
  }

  function copyKey() {
    if (!info) return;
    void navigator.clipboard.writeText(info.key);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="min-h-screen">
      <Nav />

      <section className="py-20">
        <div className="container-mid">
          <div className="text-center">
            <span className="eyebrow">
              <ShieldCheck size={12} /> Mitglieder-Bereich
            </span>
            <h1 className="h-display mt-6">Deine <span className="gradient-text">Lizenz.</span></h1>
            <p className="mt-4 text-zinc-400">
              Gib E-Mail und Lizenz-Key ein, um deine aktive Lizenz zu sehen,
              die App neu zu laden oder den Key zurück an deine Inbox zu schicken.
            </p>
          </div>

          {!info && (
            <form onSubmit={lookup} className="card-glass mt-12 space-y-4">
              <div>
                <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
                  E-Mail (aus der Bestellung)
                </label>
                <div className="relative">
                  <Mail size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    className="w-full rounded-xl border border-white/10 bg-white/[0.04] py-3 pl-10 pr-4 text-sm text-white placeholder-zinc-500 transition focus:border-ruby-500 focus:outline-none focus:ring-1 focus:ring-ruby-500"
                  />
                </div>
              </div>

              <div>
                <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
                  Lizenz-Key
                </label>
                <div className="relative">
                  <KeyRound size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
                  <input
                    type="text"
                    required
                    value={key}
                    onChange={(e) => setKey(e.target.value.toUpperCase())}
                    placeholder="BRBY-XXXX-XXXX-XXXX-XXXX"
                    className="w-full rounded-xl border border-white/10 bg-white/[0.04] py-3 pl-10 pr-4 font-mono text-sm text-white placeholder-zinc-500 transition focus:border-ruby-500 focus:outline-none focus:ring-1 focus:ring-ruby-500"
                  />
                </div>
              </div>

              {error && <p className="text-sm text-rose-400">{error}</p>}

              <div className="flex flex-col gap-3 pt-2 sm:flex-row">
                <button type="submit" disabled={busy} className="btn-primary flex-1 justify-center">
                  {busy ? 'Prüfe…' : 'Lizenz anzeigen'}
                </button>
                <button
                  type="button"
                  onClick={() => void resendByEmail()}
                  disabled={busy}
                  className="btn-ghost flex-1 justify-center"
                >
                  Key per E-Mail senden
                </button>
              </div>
            </form>
          )}

          {info && (
            <div className="card-glass mt-12 space-y-6">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">Status</div>
                  <div className="mt-1 flex items-center gap-2">
                    <span className={`inline-block h-2 w-2 rounded-full ${
                      info.status === 'active' ? 'bg-emerald-400 shadow-[0_0_8px_rgba(74,222,128,0.6)]' : 'bg-zinc-500'
                    }`} />
                    <span className="text-lg font-bold capitalize text-white">{info.status}</span>
                    <span className="rounded-full border border-ruby-500/30 bg-ruby-500/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-ruby-300">
                      {info.tier}
                    </span>
                  </div>
                </div>
                <button onClick={() => setInfo(null)} className="btn-ghost text-xs">
                  Andere Lizenz prüfen
                </button>
              </div>

              <div>
                <div className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">Lizenz-Key</div>
                <div className="mt-2 flex items-center gap-2">
                  <code className="flex-1 rounded-lg border border-white/10 bg-zinc-950 px-3 py-2.5 font-mono text-sm text-white">
                    {info.key}
                  </code>
                  <button type="button" onClick={copyKey} className="btn-ghost">
                    {copied ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />}
                    {copied ? 'Kopiert' : 'Kopieren'}
                  </button>
                </div>
                <p className="mt-2 text-xs text-zinc-500">
                  Diesen Key trägst du in der App ein: <span className="font-mono">Einstellungen → Lizenz</span>.
                </p>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Info label="E-Mail" value={info.email} />
                <Info
                  label="Ablauf"
                  value={info.expires_at ? new Date(info.expires_at).toLocaleDateString('de-DE') : 'Lifetime'}
                />
              </div>

              <div className="border-t border-white/5 pt-5">
                <a href="/downloads" className="btn-primary">
                  <Download size={15} /> Zur Download-Seite
                </a>
                <a
                  href="mailto:support@blackruby.de"
                  className="btn-link ml-4"
                >
                  Support kontaktieren <ExternalLink size={12} />
                </a>
              </div>
            </div>
          )}
        </div>
      </section>

      <Footer />
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-white/5 bg-white/[0.02] p-3">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">{label}</div>
      <div className="mt-0.5 text-sm text-zinc-200">{value}</div>
    </div>
  );
}
