import { ShieldCheck, KeyRound, Copy, Check, ExternalLink, LogOut } from 'lucide-react';
import { useState } from 'react';
import { useLicense } from '../session/SessionProvider';

export function LicensePanel() {
  const { license, deactivate } = useLicense();
  const [copied, setCopied] = useState(false);

  if (!license) {
    return (
      <div className="card space-y-2">
        <h2 className="font-semibold text-zinc-100">Lizenz</h2>
        <p className="text-sm text-zinc-400">
          Du bist im Dev-Modus ohne Lizenz-Gate. In Production-Builds erscheint hier dein Lizenz-Key.
        </p>
      </div>
    );
  }

  const tierLabel = license.tier === 'starter' ? 'Starter' : license.tier === 'hustler' ? 'Pro' : 'Lifetime';

  return (
    <div className="card space-y-4">
      <div className="flex items-center gap-2">
        <div className="flex h-7 w-7 items-center justify-center rounded-md bg-rose-500/15 text-rose-300">
          <ShieldCheck size={15} />
        </div>
        <h2 className="font-semibold text-zinc-100">Lizenz</h2>
        <span className="ml-auto rounded-full border border-rose-500/30 bg-rose-500/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-rose-300">
          {tierLabel}
        </span>
      </div>

      <div>
        <div className="label flex items-center gap-2">
          <KeyRound size={11} /> Aktiver Key
        </div>
        <div className="flex items-center gap-2">
          <code className="flex-1 rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 font-mono text-sm text-zinc-100">
            {license.key}
          </code>
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard.writeText(license.key);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
            className="btn-secondary"
          >
            {copied ? <Check size={13} className="text-rose-400" /> : <Copy size={13} />}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Info label="E-Mail" value={license.email || '—'} />
        <Info
          label="Ablauf"
          value={
            license.expires_at
              ? new Date(license.expires_at).toLocaleDateString('de-DE')
              : 'Lifetime — kein Ablauf'
          }
        />
        <Info
          label="Zuletzt validiert"
          value={new Date(license.last_validated_at).toLocaleString('de-DE')}
        />
        <Info label="Tier" value={tierLabel} />
      </div>

      <div className="flex flex-wrap items-center gap-3 border-t border-zinc-800 pt-4 text-sm">
        <a
          href="https://blackruby.de/members"
          target="_blank"
          rel="noreferrer"
          className="btn-ghost"
        >
          Online-Mitgliederbereich <ExternalLink size={13} />
        </a>
        <button onClick={deactivate} className="btn-ghost text-rose-300 hover:bg-rose-500/10">
          <LogOut size={13} /> Lizenz abmelden
        </button>
      </div>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3">
      <div className="kpi-label">{label}</div>
      <div className="mt-0.5 truncate text-sm text-zinc-200">{value}</div>
    </div>
  );
}
