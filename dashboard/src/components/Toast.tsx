// ──────────────────────────────────────────────────────────────────────────────
// Toast system — replaces every alert() call in the app.
//
// Usage:
//   import { toast } from '@/components/Toast';
//   toast.success('Lizenz aktiviert');
//   toast.error('Validierung fehlgeschlagen', { detail: err.message });
//   toast.info('Polling pausiert');
//
// The provider mounts once in App.tsx via <ToastViewport />. The API is a
// plain event-emitter — no React context needed at call-sites.
// ──────────────────────────────────────────────────────────────────────────────

import { useEffect, useState, useCallback } from 'react';
import { CheckCircle2, AlertTriangle, Info, XCircle, X } from 'lucide-react';

export type ToastKind = 'success' | 'error' | 'warn' | 'info';

interface Toast {
  id: number;
  kind: ToastKind;
  title: string;
  detail?: string;
  duration?: number;
  action?: { label: string; href?: string; onClick?: () => void };
}

type Listener = (toasts: Toast[]) => void;

const listeners = new Set<Listener>();
let toasts: Toast[] = [];
let nextId = 1;

function emit() {
  for (const l of listeners) l(toasts);
}

function add(t: Omit<Toast, 'id'>): number {
  const id = nextId++;
  toasts = [...toasts, { ...t, id }];
  emit();
  // Errors stay up until the user dismisses them — they usually need action
  // (retry, copy stack-trace, contact support). Warns get a generous window;
  // success/info defaults stay short.
  const duration = t.duration ?? (t.kind === 'error' ? 0 : t.kind === 'warn' ? 5000 : 3500);
  if (duration > 0) setTimeout(() => dismiss(id), duration);
  return id;
}

function dismiss(id: number) {
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}

export const toast = {
  success: (title: string, opts: { detail?: string; duration?: number; action?: Toast['action'] } = {}) =>
    add({ kind: 'success', title, ...opts }),
  error: (title: string, opts: { detail?: string; duration?: number; action?: Toast['action'] } = {}) =>
    add({ kind: 'error', title, ...opts }),
  warn: (title: string, opts: { detail?: string; duration?: number; action?: Toast['action'] } = {}) =>
    add({ kind: 'warn', title, ...opts }),
  info: (title: string, opts: { detail?: string; duration?: number; action?: Toast['action'] } = {}) =>
    add({ kind: 'info', title, ...opts }),
  dismiss,
};

export function ToastViewport() {
  const [items, setItems] = useState<Toast[]>([]);

  const onChange = useCallback((next: Toast[]) => setItems(next), []);

  useEffect(() => {
    listeners.add(onChange);
    setItems(toasts);
    return () => {
      listeners.delete(onChange);
    };
  }, [onChange]);

  return (
    <div className="pointer-events-none fixed bottom-5 right-5 z-[100] flex w-full max-w-sm flex-col gap-2.5">
      {items.map((t) => (
        <ToastCard key={t.id} t={t} onClose={() => dismiss(t.id)} />
      ))}
    </div>
  );
}

function ToastCard({ t, onClose }: { t: Toast; onClose: () => void }) {
  const config = {
    success: { Icon: CheckCircle2, ring: 'ring-rose-500/40 bg-rose-500/10', icon: 'text-rose-300' },
    error:   { Icon: XCircle,       ring: 'ring-rose-500/40 bg-rose-500/10',       icon: 'text-rose-300' },
    warn:    { Icon: AlertTriangle, ring: 'ring-amber-500/40 bg-amber-500/10',     icon: 'text-amber-300' },
    info:    { Icon: Info,          ring: 'ring-rose-500/40 bg-rose-500/10',   icon: 'text-rose-300' },
  }[t.kind];

  return (
    <div
      className={`pointer-events-auto flex items-start gap-3 rounded-xl border border-zinc-800 bg-zinc-950/95 p-3.5 shadow-2xl shadow-black/50 backdrop-blur ring-1 ${config.ring} fade-in`}
      role="status"
    >
      <config.Icon size={18} className={`mt-0.5 shrink-0 ${config.icon}`} />
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold text-zinc-50">{t.title}</div>
        {t.detail && <div className="mt-0.5 text-xs leading-relaxed text-zinc-400">{t.detail}</div>}
        {t.action && (
          <div className="mt-2">
            {t.action.href ? (
              <a
                href={t.action.href}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 rounded-md bg-white/10 px-2.5 py-1 text-xs font-semibold text-white hover:bg-white/15"
              >
                {t.action.label}
              </a>
            ) : (
              <button
                type="button"
                onClick={() => { t.action?.onClick?.(); onClose(); }}
                className="inline-flex items-center gap-1.5 rounded-md bg-white/10 px-2.5 py-1 text-xs font-semibold text-white hover:bg-white/15"
              >
                {t.action.label}
              </button>
            )}
          </div>
        )}
      </div>
      <button
        type="button"
        onClick={onClose}
        className="ml-1 text-zinc-500 transition hover:text-zinc-200"
        aria-label="Schließen"
      >
        <X size={14} />
      </button>
    </div>
  );
}
