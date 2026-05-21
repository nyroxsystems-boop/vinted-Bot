import { useEffect, useRef, useState } from 'react';
import { AlertOctagon, Loader2 } from 'lucide-react';
import { currentApiOrigin, pingOrchestrator, setOrchestratorOriginOverride } from '../api/base';

// Banner that surfaces when the orchestrator backend can't be reached. Without
// this, every page renders blank/error and the customer has no idea why —
// 5 minutes of confusion before they file a support ticket.
//
// Cold-start grace: when launched inside the Tauri app, the orchestrator
// needs ~10–25 s to bind its port (npm → tsx → express). We must NOT show
// the alarming "Orchestrator nicht erreichbar"-banner during that window —
// instead show a soft "Bootet…"-Hinweis. Only after 30 s OR after we've
// seen the orchestrator at least once and lost it, do we surface the
// alarm.
const STARTUP_GRACE_MS = 30_000;
const PING_INTERVAL_MS = 3_000;          // tighter than before so cold-start completes fast
const ALARM_AFTER_FAILURES = 3;
// Cap the rate-of-polling when the backend is genuinely down. Without
// this, an overnight outage spams 28,800 fetch() calls per browser tab.
// Audit Finding #13 (Batch 3).
const MAX_PING_INTERVAL_MS = 30_000;

export function OrchestratorHealthBanner() {
  const [reachable, setReachable] = useState<boolean | null>(null);
  const [override, setOverride] = useState('');
  const [editing, setEditing] = useState(false);
  const [startedAt] = useState(() => Date.now());
  const failuresRef = useRef(0);
  const everSucceededRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const nextDelay = (): number => {
      // 3s, 3s, 6s, 12s, 24s, then cap at 30s. Recovery resets failure count.
      const fails = failuresRef.current;
      if (fails < 2) return PING_INTERVAL_MS;
      const exp = Math.min(PING_INTERVAL_MS * Math.pow(2, fails - 1), MAX_PING_INTERVAL_MS);
      return exp;
    };
    const check = async () => {
      if (cancelled) return;
      const ok = await pingOrchestrator();
      if (cancelled) return;
      if (ok) {
        everSucceededRef.current = true;
        failuresRef.current = 0;
        setReachable(true);
      } else {
        failuresRef.current++;
        const ageMs = Date.now() - startedAt;
        const grace = ageMs < STARTUP_GRACE_MS && !everSucceededRef.current;
        if (grace) {
          setReachable(null);
        } else if (failuresRef.current >= ALARM_AFTER_FAILURES) {
          setReachable(false);
        }
      }
      if (!cancelled) {
        timer = setTimeout(check, nextDelay());
      }
    };
    void check();
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [startedAt]);

  // Reachable or unknown without alarm → no banner
  if (reachable === true) return null;

  // null + we've never seen success: cold-start in progress → soft banner
  if (reachable === null && !everSucceededRef.current) {
    const ageMs = Date.now() - startedAt;
    if (ageMs < STARTUP_GRACE_MS) {
      return (
        <div className="z-40 border-b border-amber-500/30 bg-amber-500/[0.07] backdrop-blur-md">
          <div className="flex items-center gap-3 px-4 py-2.5 text-sm text-amber-200">
            <Loader2 size={14} className="animate-spin shrink-0 text-amber-300" />
            <div>
              <span className="font-semibold">Orchestrator startet…</span>
              <span className="ml-1 text-amber-300/80">
                Bots booten — kann beim ersten Start bis ~30 s dauern.
              </span>
            </div>
          </div>
        </div>
      );
    }
  }

  if (reachable !== false) return null;

  const origin = currentApiOrigin() || window.location.origin;

  return (
    <div className="z-40 border-b border-rose-500/30 bg-rose-500/[0.07] backdrop-blur-md">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 text-sm text-rose-200">
        <div className="flex items-center gap-3 min-w-0">
          <AlertOctagon size={16} className="shrink-0 text-rose-300" />
          <div className="min-w-0">
            <span className="font-bold">Orchestrator nicht erreichbar.</span>
            <span className="ml-1 text-rose-300/80">
              Backend antwortet nicht unter{' '}
              <code className="rounded bg-rose-950/40 px-1.5 py-0.5 font-mono text-[11px]">{origin || '(same-origin)'}</code>.
              Starte den Orchestrator-Dienst oder ändere die Adresse.
            </span>
          </div>
        </div>
        {!editing ? (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="rounded border border-rose-500/40 px-2.5 py-1 text-xs font-semibold text-rose-100 hover:bg-rose-500/10"
          >
            Adresse ändern
          </button>
        ) : (
          <form
            onSubmit={(e) => { e.preventDefault(); setOrchestratorOriginOverride(override); }}
            className="flex items-center gap-2"
          >
            <input
              type="url"
              autoFocus
              value={override}
              onChange={(e) => setOverride(e.target.value)}
              placeholder="http://127.0.0.1:4700"
              className="rounded border border-rose-500/40 bg-rose-950/30 px-2 py-1 text-xs text-rose-100 placeholder-rose-300/40 focus:outline-none focus:ring-1 focus:ring-rose-500/50"
            />
            <button
              type="submit"
              className="rounded bg-rose-500 px-2.5 py-1 text-xs font-bold text-white hover:bg-rose-400"
            >
              Speichern
            </button>
            <button
              type="button"
              onClick={() => { setOrchestratorOriginOverride(''); }}
              className="rounded border border-rose-500/30 px-2 py-1 text-xs text-rose-200 hover:bg-rose-500/10"
              title="Override entfernen und Default wiederherstellen"
            >
              Reset
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
