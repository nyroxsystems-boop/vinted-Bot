import { useEffect, useRef, useState } from 'react';

// Live SSE feed from the orchestrator. Each message is a JSON-encoded SystemEvent.
// We type this loosely here to avoid coupling the dashboard to shared's type
// exports (which would require workspace resolution in Vite).
export type LiveEvent = { type: string; [key: string]: unknown };

export function useLiveEvents(onEvent: (e: LiveEvent) => void): void {
  // Keep latest callback in a ref so the EventSource isn't torn down on rerenders.
  const cbRef = useRef(onEvent);
  cbRef.current = onEvent;

  useEffect(() => {
    const es = new EventSource('/stream');
    es.onmessage = (msg) => {
      try {
        const parsed = JSON.parse(msg.data) as LiveEvent;
        cbRef.current(parsed);
      } catch {
        /* ignore malformed */
      }
    };
    es.onerror = () => {
      // Browsers auto-reconnect; nothing to do here besides log.
      console.warn('SSE error — browser will auto-reconnect');
    };
    return () => es.close();
  }, []);
}

// Minimal ring buffer of recent events — useful for a live log panel.
export function useEventLog(max = 100): { events: LiveEvent[]; clear: () => void } {
  const [events, setEvents] = useState<LiveEvent[]>([]);
  useLiveEvents((e) => {
    setEvents((prev) => {
      const next = [...prev, { ...e, _at: new Date().toISOString() }];
      return next.length > max ? next.slice(-max) : next;
    });
  });
  return { events, clear: () => setEvents([]) };
}
