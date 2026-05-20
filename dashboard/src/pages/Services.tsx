// ──────────────────────────────────────────────────────────────────────────────
// Services — live view of the Node backend processes supervised by Tauri.
//
// Replaces the standalone HTML "Services-Konsole" that used to live in app/.
// When opened in a plain browser (not the Tauri shell), renders a friendly
// "only available in the app" banner.
// ──────────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Circle,
  Loader2,
  Play,
  RefreshCw,
  RotateCw,
  Square,
  Terminal,
  Trash2,
} from 'lucide-react';
import {
  isTauri,
  listen,
  tauri,
  type InitialState,
  type ServiceLog,
  type ServiceName,
  type ServiceState,
  type ServiceStatus,
  type UpdateInfo,
} from '../api/tauri';
import { UpdatePanel } from '../components/UpdatePanel';
import { toast } from '../components/Toast';

const SERVICES: ServiceName[] = ['orchestrator', 'vinted-bot', 'temu-bot'];
const MAX_LOG_LINES = 2000;

type FilterMode = 'all' | 'errors';

interface ServiceSlice {
  state: ServiceState;
  pid: number | null;
  httpUrl: string | null;
  exitCode: number | null;
}

const initialSlice = (): ServiceSlice => ({
  state: 'starting',
  pid: null,
  httpUrl: null,
  exitCode: null,
});

export function ServicesPage() {
  const tauriOn = isTauri();

  const [slices, setSlices] = useState<Record<string, ServiceSlice>>(() => {
    const seed: Record<string, ServiceSlice> = {};
    for (const name of [...SERVICES, 'supervisor' as ServiceName]) {
      seed[name] = initialSlice();
    }
    return seed;
  });
  const [logs, setLogs] = useState<ServiceLog[]>([]);
  const logsRef = useRef<ServiceLog[]>([]);
  const [active, setActive] = useState<ServiceName | 'all'>('all');
  const [filter, setFilter] = useState<FilterMode>('all');
  const [update, setUpdate] = useState<UpdateInfo | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const applyStatus = useCallback((s: ServiceStatus) => {
    setSlices((prev) => ({
      ...prev,
      [s.service]: {
        state: s.state,
        pid: s.pid,
        httpUrl: s.http_url,
        exitCode: s.exit_code,
      },
    }));
  }, []);

  const appendLog = useCallback((l: ServiceLog) => {
    // Deduplicate: the Rust side very occasionally emits the same event twice
    // on resubscribe; easier to dedupe at the consumer than to chase every
    // double-emit path. Key = ts+service+line — exact collision means same
    // log entry.
    const key = `${l.ts}|${l.service}|${l.line}`;
    const last = logsRef.current[logsRef.current.length - 1];
    if (last && `${last.ts}|${last.service}|${last.line}` === key) return;
    const next = [...logsRef.current, l];
    if (next.length > MAX_LOG_LINES * 1.2) {
      next.splice(0, next.length - MAX_LOG_LINES);
    }
    logsRef.current = next;
    setLogs(next);
  }, []);

  // Bootstrap on mount.
  useEffect(() => {
    if (!tauriOn) return;
    let cancel: Array<() => void> = [];
    (async () => {
      try {
        const snap: InitialState = await tauri.frontendReady();
        snap.statuses.forEach(applyStatus);
        logsRef.current = snap.logs;
        setLogs(snap.logs);

        const unStatus = await listen<ServiceStatus>('service-status', applyStatus);
        const unLog = await listen<ServiceLog>('service-log', appendLog);
        cancel = [unStatus, unLog];

        const u = await tauri.checkUpdates().catch(() => null);
        if (u) setUpdate(u);
      } catch (err) {
        console.warn('frontend_ready failed', err);
      }
    })();
    return () => cancel.forEach((f) => f());
  }, [tauriOn, applyStatus, appendLog]);

  // Auto-scroll stays OFF — logs are now rendered newest-first so the
  // latest line is always the topmost one (no scrolling needed to read it).

  const runningCount = SERVICES.filter((s) => slices[s]?.state === 'running').length;
  const anyFailed = SERVICES.some((s) => slices[s]?.state === 'failed');
  const anyStarting = SERVICES.some((s) => slices[s]?.state === 'starting');

  const filteredLogs = useMemo(() => {
    const base =
      active === 'all'
        ? logs
        : logs.filter((l) => l.service === active);
    const withFilter =
      filter === 'errors'
        ? base.filter(
            (l) =>
              l.stream === 'stderr' ||
              /error|exception|failed|warn/i.test(l.line),
          )
        : base;
    // Newest first — latest line is at the top of the panel so the user
    // doesn't have to scroll to see what just happened.
    return withFilter.slice(-MAX_LOG_LINES).slice().reverse();
  }, [logs, active, filter]);

  const doAction = async (
    action: 'start' | 'stop' | 'restart',
    name: ServiceName,
  ): Promise<void> => {
    const key = `${action}:${name}`;
    setBusy(key);
    try {
      if (action === 'start') await tauri.startService(name);
      else if (action === 'stop') await tauri.stopService(name);
      else await tauri.restartService(name);
    } catch (err) {
      console.warn(key, err);
    } finally {
      setBusy(null);
    }
  };

  const startAll = async (): Promise<void> => {
    setBusy('start-all');
    for (const s of SERVICES) {
      const cur = slices[s]?.state;
      if (cur !== 'running' && cur !== 'starting') {
        await tauri.startService(s).catch(() => null);
      }
    }
    setBusy(null);
  };

  const stopAll = async (): Promise<void> => {
    if (!confirm('Alle Services stoppen? Bots reagieren dann nicht mehr.')) return;
    setBusy('stop-all');
    for (const s of SERVICES) await tauri.stopService(s).catch(() => null);
    setBusy(null);
  };

  const restartAll = async (): Promise<void> => {
    setBusy('restart-all');
    for (const s of SERVICES) await tauri.restartService(s).catch(() => null);
    setBusy(null);
  };

  const fullRestart = async (): Promise<void> => {
    if (
      !confirm(
        'App komplett neu starten?\n\n' +
          '1. Alle Services stoppen\n' +
          '2. git pull\n' +
          '3. npm install\n' +
          '4. npm run app:dev\n\n' +
          'Ein neues Terminal öffnet sich automatisch.',
      )
    )
      return;
    setBusy('full-restart');
    try {
      await tauri.fullRestart();
    } catch (err) {
      toast.error('Neustart fehlgeschlagen', { detail: String(err) });
      setBusy(null);
    }
  };

  if (!tauriOn) {
    return (
      <div className="space-y-4">
        <PageHeader running={0} total={SERVICES.length} />
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-6 text-sm text-amber-900">
          <div className="mb-2 flex items-center gap-2 font-semibold">
            <AlertTriangle size={16} /> Services-Steuerung nur in der App
          </div>
          <p>
            Du hast das Dashboard im Browser geöffnet. Die Prozess-Kontrolle
            (Start / Stop / Logs der Node-Services) ist nur verfügbar, wenn
            du die native Vinted-System App startest.
          </p>
          <p className="mt-2 font-mono text-xs">npm run app:dev</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <PageHeader
        running={runningCount}
        total={SERVICES.length}
        failed={anyFailed}
        starting={anyStarting}
        update={update}
      />

      <UpdatePanel />

      <div className="flex flex-wrap items-center gap-2">
        <button
          className="btn-primary"
          onClick={startAll}
          disabled={busy !== null || runningCount === SERVICES.length}
        >
          <Play size={14} /> Alle starten
        </button>
        <button
          className="btn-danger"
          onClick={stopAll}
          disabled={busy !== null || runningCount === 0}
        >
          <Square size={14} /> Alle stoppen
        </button>
        <button
          className="btn-secondary"
          onClick={restartAll}
          disabled={busy !== null || runningCount === 0}
        >
          <RotateCw size={14} /> Services neustarten
        </button>
        <button
          className="btn-secondary"
          onClick={fullRestart}
          disabled={busy !== null}
          title="git pull + npm install + npm run app:dev"
        >
          <RefreshCw size={14} /> Update &amp; Neustart
        </button>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[320px_1fr]">
        {/* Service cards */}
        <div className="space-y-2">
          <ServiceRow
            name="Alle Services"
            state={
              runningCount === SERVICES.length
                ? 'running'
                : anyFailed
                  ? 'failed'
                  : anyStarting
                    ? 'starting'
                    : 'exited'
            }
            meta={`${runningCount}/${SERVICES.length} laufen`}
            active={active === 'all'}
            onClick={() => setActive('all')}
          />
          {SERVICES.map((s) => {
            const slice = slices[s] ?? initialSlice();
            return (
              <ServiceRow
                key={s}
                name={s}
                state={slice.state}
                meta={[
                  slice.state,
                  slice.pid ? `pid ${slice.pid}` : null,
                  slice.httpUrl
                    ? slice.httpUrl.replace(/^https?:\/\//, '')
                    : null,
                  slice.exitCode !== null ? `exit ${slice.exitCode}` : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
                active={active === s}
                onClick={() => setActive(s)}
                actions={
                  <div className="mt-2 flex gap-1.5">
                    <ActionBtn
                      onClick={() => doAction('start', s)}
                      disabled={
                        busy !== null ||
                        slice.state === 'running' ||
                        slice.state === 'starting'
                      }
                      tone="green"
                    >
                      <Play size={10} /> Start
                    </ActionBtn>
                    <ActionBtn
                      onClick={() => doAction('stop', s)}
                      disabled={
                        busy !== null ||
                        (slice.state !== 'running' && slice.state !== 'starting')
                      }
                      tone="red"
                    >
                      <Square size={10} /> Stop
                    </ActionBtn>
                    <ActionBtn
                      onClick={() => doAction('restart', s)}
                      disabled={busy !== null}
                    >
                      <RotateCw size={10} /> Restart
                    </ActionBtn>
                  </div>
                }
              />
            );
          })}
        </div>

        {/* Logs panel */}
        <div className="flex min-h-[520px] flex-col rounded-lg border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-2.5">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
              <Terminal size={14} />
              {active === 'all' ? 'Alle Logs' : `Logs: ${active}`}
            </div>
            <div className="flex items-center gap-1.5">
              <PillBtn
                active={filter === 'all'}
                onClick={() => setFilter('all')}
              >
                Alle
              </PillBtn>
              <PillBtn
                active={filter === 'errors'}
                onClick={() => setFilter('errors')}
              >
                Nur Fehler
              </PillBtn>
              <button
                onClick={() => {
                  logsRef.current = [];
                  setLogs([]);
                }}
                className="rounded-md px-2 py-1 text-xs text-slate-500 hover:bg-slate-100"
                title="Log-Puffer leeren"
              >
                <Trash2 size={12} />
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto bg-slate-950 px-4 py-3 font-mono text-[11.5px] leading-relaxed text-slate-200">
            {filteredLogs.length === 0 ? (
              <div className="py-8 text-center text-slate-500">
                Warte auf Log-Output…
              </div>
            ) : (
              filteredLogs.map((l, idx) => (
                <LogLine key={idx} log={l} showService={active === 'all'} />
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Sub-components ──────────────────────────────────────────────────────────

interface PageHeaderProps {
  running: number;
  total: number;
  failed?: boolean;
  starting?: boolean;
  update?: UpdateInfo | null;
}

function PageHeader({ running, total, failed, starting, update }: PageHeaderProps) {
  const badge = failed
    ? { color: 'text-red-600 bg-red-50 ring-red-200', label: 'Fehler' }
    : running === total && total > 0
      ? { color: 'text-rose-700 bg-rose-50 ring-rose-200', label: 'Alles läuft' }
      : starting
        ? { color: 'text-amber-700 bg-amber-50 ring-amber-200', label: 'Startet…' }
        : { color: 'text-slate-600 bg-slate-100 ring-slate-200', label: 'Gestoppt' };

  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            Services
          </h1>
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${badge.color}`}
          >
            <Activity size={11} />
            {badge.label}
          </span>
        </div>
        <p className="mt-1 text-sm text-slate-500">
          {running}/{total} Backend-Services laufen lokal.
        </p>
      </div>
      {update?.available ? (
        <div className="rounded-md border border-brand-200 bg-brand-50 px-3 py-1.5 text-xs font-medium text-brand-700">
          ⬇ {update.commits_behind} neue Commits
        </div>
      ) : null}
    </div>
  );
}

interface ServiceRowProps {
  name: string;
  state: ServiceState;
  meta: string;
  active: boolean;
  onClick: () => void;
  actions?: React.ReactNode;
}

function ServiceRow({ name, state, meta, active, onClick, actions }: ServiceRowProps) {
  return (
    <div
      onClick={onClick}
      className={`group cursor-pointer rounded-lg border p-3 transition ${
        active
          ? 'border-brand-300 bg-brand-50/50 shadow-sm'
          : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'
      }`}
    >
      <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
        <StateIcon state={state} />
        <span>{name}</span>
      </div>
      <div className="ml-6 mt-0.5 text-xs text-slate-500">{meta}</div>
      {actions}
    </div>
  );
}

function StateIcon({ state }: { state: ServiceState }) {
  switch (state) {
    case 'running':
      return <CheckCircle2 size={14} className="text-rose-500" />;
    case 'starting':
      return <Loader2 size={14} className="animate-spin text-amber-500" />;
    case 'failed':
      return <AlertTriangle size={14} className="text-red-500" />;
    case 'exited':
      return <Circle size={14} className="text-slate-400" />;
  }
}

interface ActionBtnProps {
  onClick: () => void;
  disabled?: boolean;
  tone?: 'green' | 'red' | 'default';
  children: React.ReactNode;
}

function ActionBtn({ onClick, disabled, tone = 'default', children }: ActionBtnProps) {
  const toneCls =
    tone === 'green'
      ? 'border-rose-200 text-rose-700 hover:bg-rose-50'
      : tone === 'red'
        ? 'border-red-200 text-red-700 hover:bg-red-50'
        : 'border-slate-200 text-slate-600 hover:bg-slate-50';
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      disabled={disabled}
      className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[10px] font-medium transition disabled:opacity-40 disabled:hover:bg-transparent ${toneCls}`}
    >
      {children}
    </button>
  );
}

function PillBtn({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-md px-2 py-1 text-xs font-medium transition ${
        active
          ? 'bg-slate-800 text-white'
          : 'text-slate-500 hover:bg-slate-100'
      }`}
    >
      {children}
    </button>
  );
}

function LogLine({ log, showService }: { log: ServiceLog; showService: boolean }) {
  const level =
    log.stream === 'stderr'
      ? 'error'
      : /\berror\b/i.test(log.line)
        ? 'error'
        : /\bwarn/i.test(log.line)
          ? 'warn'
          : /\binfo\b/i.test(log.line)
            ? 'info'
            : '';
  const color =
    level === 'error'
      ? 'text-red-300'
      : level === 'warn'
        ? 'text-amber-300'
        : level === 'info'
          ? 'text-rose-300'
          : 'text-slate-200';
  const time = log.ts.slice(11, 19);
  return (
    <div className={`whitespace-pre-wrap break-all ${color}`}>
      <span className="mr-2 text-slate-500">{time}</span>
      {showService ? (
        <span className="mr-2 text-slate-500">[{log.service}]</span>
      ) : null}
      {log.line}
    </div>
  );
}
