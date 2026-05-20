import { useEffect, useState } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';

interface ConfigCheck {
  id: string;
  ok: boolean;
  severity: 'critical' | 'info' | 'optional';
  label: string;
  hint: string;
}

interface ConfigResponse {
  ok: boolean;
  checks: ConfigCheck[];
}

const DISMISS_KEY = 'br_config_banner_dismissed_until';

// Surfaces missing critical config (LLM keys etc.) in a banner the user can't
// miss. The Orchestrator-health banner above it handles the "backend dead"
// case; this one handles "backend works but you forgot to set a key".
export function ConfigHealthBanner() {
  const [data, setData] = useState<ConfigResponse | null>(null);

  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      try {
        const r = await api.get<ConfigResponse>('/status/config');
        if (!cancelled) setData(r);
      } catch {
        if (!cancelled) setData(null);
      }
    };
    void check();
    const t = setInterval(check, 30_000);
    return () => { cancelled = true; clearInterval(t); };
  }, []);

  if (!data || data.ok) return null;
  const missing = data.checks.filter((c) => c.severity === 'critical' && !c.ok);
  if (missing.length === 0) return null;

  // Respect a temporary dismissal (1h) so the user can work without nagging.
  const dismissedUntil = Number(localStorage.getItem(DISMISS_KEY) ?? '0');
  if (Date.now() < dismissedUntil) return null;

  return (
    <div className="z-40 border-b border-amber-500/30 bg-amber-500/[0.08] backdrop-blur-md">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 text-sm text-amber-100">
        <div className="flex items-center gap-3 min-w-0">
          <AlertTriangle size={15} className="shrink-0 text-amber-300" />
          <div className="min-w-0">
            <span className="font-bold">Konfiguration unvollständig.</span>
            <span className="ml-1 text-amber-200/85">
              {missing.map((c) => c.label).join(', ')} fehlt — {missing[0]?.hint}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Link
            to="/settings#keys"
            className="rounded border border-amber-500/40 px-2.5 py-1 text-xs font-semibold text-amber-100 hover:bg-amber-500/10"
          >
            In Einstellungen öffnen
          </Link>
          <button
            type="button"
            onClick={() => {
              localStorage.setItem(DISMISS_KEY, String(Date.now() + 60 * 60 * 1000));
              // Force re-render by mutating state
              setData(null);
            }}
            className="rounded p-1 text-amber-300 hover:bg-amber-500/10"
            title="Für 1 h ausblenden"
          >
            <X size={13} />
          </button>
        </div>
      </div>
    </div>
  );
}
