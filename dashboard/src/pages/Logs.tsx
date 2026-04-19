import { useEventLog } from '../api/stream';

export function LogsPage() {
  const { events, clear } = useEventLog(200);
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Live-Events</h1>
        <button className="btn-secondary" onClick={clear}>
          Leeren
        </button>
      </div>
      <div className="card max-h-[70vh] overflow-y-auto font-mono text-xs">
        {events.length === 0 && <div className="text-slate-400">Noch keine Events.</div>}
        {events
          .slice()
          .reverse()
          .map((e, i) => (
            <div key={i} className="border-b border-slate-100 py-1">
              <span className="mr-2 text-slate-400">{String(e._at ?? '')}</span>
              <span className="mr-2 font-semibold text-brand-700">{e.type}</span>
              <span className="text-slate-700">
                {JSON.stringify(
                  Object.fromEntries(
                    Object.entries(e).filter(([k]) => k !== 'type' && k !== '_at'),
                  ),
                )}
              </span>
            </div>
          ))}
      </div>
    </div>
  );
}
