// ──────────────────────────────────────────────────────────────────────────────
// Command palette — Cmd/Ctrl+K opens a searchable launcher with quick nav and
// power-user actions (pause, resume, run auto-publisher). Designed to make the
// app feel like a tool you live in, not click through.
//
// Bindings:
//   ⌘K / Ctrl+K  — open
//   Esc          — close
//   ↑/↓          — move
//   Enter        — execute
//   ⌘1..⌘4       — jump to Home / Listings / Verkauf / Settings (globally)
// ──────────────────────────────────────────────────────────────────────────────

import { useEffect, useState, useRef, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Home, Package, ShoppingBag, Settings as SettingsIcon, Pause, Play,
  Rocket, Wallet, KeyRound, Activity, RefreshCw, MessageSquare, ShoppingCart,
  type LucideIcon,
} from 'lucide-react';
import { api } from '../api/client';
import { toast } from './Toast';

interface Command {
  id: string;
  label: string;
  hint?: string;
  group: 'Navigation' | 'Aktionen' | 'Tools';
  icon: LucideIcon;
  shortcut?: string;
  run: () => void | Promise<void>;
}

export function CommandPalette() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const commands: Command[] = useMemo(() => [
    // Navigation
    { id: 'nav.home',     label: 'Home',          group: 'Navigation', icon: Home,        shortcut: '⌘1', run: () => navigate('/') },
    { id: 'nav.list',     label: 'Listings',      group: 'Navigation', icon: Package,     shortcut: '⌘2', run: () => navigate('/listings') },
    { id: 'nav.sales',    label: 'Verkauf',       group: 'Navigation', icon: ShoppingBag, shortcut: '⌘3', run: () => navigate('/verkauf') },
    { id: 'nav.settings', label: 'Einstellungen', group: 'Navigation', icon: SettingsIcon, shortcut: '⌘4', run: () => navigate('/settings') },
    { id: 'nav.chats',    label: 'Chats',         group: 'Navigation', icon: MessageSquare, run: () => navigate('/chats') },
    { id: 'nav.offers',   label: 'Angebote',      group: 'Navigation', icon: ShoppingCart, run: () => navigate('/offers') },
    { id: 'nav.profit',   label: 'Profit-Dashboard', group: 'Navigation', icon: Wallet, run: () => navigate('/profit') },

    // Aktionen
    {
      id: 'act.start', label: 'Alles listen jetzt', hint: 'Auto-Publisher manuell starten', group: 'Aktionen', icon: Rocket,
      run: async () => {
        try { await api.post('/home/start-bulk', {}); toast.success('Auto-Publisher gestartet'); }
        catch (e) { toast.error('Start fehlgeschlagen', { detail: e instanceof Error ? e.message : String(e) }); }
      },
    },
    {
      id: 'act.pause', label: 'System pausieren', group: 'Aktionen', icon: Pause,
      run: async () => {
        try { await api.post('/home/pause', { paused: true }); toast.warn('System pausiert'); }
        catch (e) { toast.error('Pause fehlgeschlagen', { detail: e instanceof Error ? e.message : String(e) }); }
      },
    },
    {
      id: 'act.resume', label: 'System fortsetzen', group: 'Aktionen', icon: Play,
      run: async () => {
        try { await api.post('/home/pause', { paused: false }); toast.success('System läuft wieder'); }
        catch (e) { toast.error('Resume fehlgeschlagen', { detail: e instanceof Error ? e.message : String(e) }); }
      },
    },
    {
      id: 'act.reload', label: 'Dashboard neu laden', hint: 'Frische Daten holen', group: 'Aktionen', icon: RefreshCw,
      run: () => window.location.reload(),
    },

    // Tools
    { id: 'tool.health',  label: 'Bot-Health prüfen', group: 'Tools', icon: Activity, run: () => navigate('/services') },
    { id: 'tool.license', label: 'Lizenz-Status',     group: 'Tools', icon: KeyRound, run: () => navigate('/settings') },
  ], [navigate]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands;
    return commands.filter((c) =>
      c.label.toLowerCase().includes(q) || (c.hint?.toLowerCase().includes(q) ?? false),
    );
  }, [commands, query]);

  const close = useCallback(() => {
    setOpen(false);
    setQuery('');
    setCursor(0);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const cmd = e.metaKey || e.ctrlKey;
      if (cmd && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((o) => !o);
        return;
      }
      if (cmd && ['1', '2', '3', '4', '5', '6'].includes(e.key)) {
        const map: Record<string, string> = {
          '1': '/', '2': '/pipeline', '3': '/studio',
          '4': '/listings', '5': '/verkauf', '6': '/settings',
        };
        const target = map[e.key] ?? '/';
        e.preventDefault();
        navigate(target);
        return;
      }
      if (!open) return;
      if (e.key === 'Escape') { e.preventDefault(); close(); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); setCursor((c) => Math.min(c + 1, filtered.length - 1)); }
      else if (e.key === 'ArrowUp')   { e.preventDefault(); setCursor((c) => Math.max(c - 1, 0)); }
      else if (e.key === 'Enter') {
        e.preventDefault();
        const c = filtered[cursor];
        if (c) { void c.run(); close(); }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, filtered, cursor, navigate, close]);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 10);
  }, [open]);

  useEffect(() => { setCursor(0); }, [query]);

  if (!open) return null;

  // Group commands for rendering.
  const groups = filtered.reduce<Record<Command['group'], Command[]>>((acc, c) => {
    (acc[c.group] ??= []).push(c);
    return acc;
  }, { Navigation: [], Aktionen: [], Tools: [] });

  return (
    <div
      className="fixed inset-0 z-[90] flex justify-center bg-zinc-950/70 px-4 pt-[12vh] backdrop-blur-sm"
      onClick={close}
    >
      <div
        className="w-full max-w-xl overflow-hidden rounded-2xl border border-white/10 bg-zinc-950 shadow-2xl shadow-black/60"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-white/5 px-4 py-3">
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Befehl oder Seite suchen…"
            className="w-full bg-transparent text-sm text-white placeholder-zinc-500 outline-none"
          />
        </div>
        <div className="max-h-[55vh] overflow-y-auto p-2">
          {filtered.length === 0 ? (
            <div className="py-10 text-center text-sm text-zinc-500">Nichts gefunden.</div>
          ) : (
            (['Navigation', 'Aktionen', 'Tools'] as const).map((g) =>
              groups[g].length > 0 && (
                <div key={g} className="mb-1.5">
                  <div className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">{g}</div>
                  {groups[g].map((c) => {
                    const idx = filtered.indexOf(c);
                    const active = idx === cursor;
                    return (
                      <button
                        key={c.id}
                        type="button"
                        onMouseEnter={() => setCursor(idx)}
                        onClick={() => { void c.run(); close(); }}
                        className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm transition ${
                          active ? 'bg-rose-500/15 text-rose-100 ring-1 ring-rose-500/30' : 'text-zinc-300 hover:bg-white/[0.04]'
                        }`}
                      >
                        <c.icon size={15} className={active ? 'text-rose-300' : 'text-zinc-500'} />
                        <span className="flex-1">
                          {c.label}
                          {c.hint && <span className="ml-2 text-xs text-zinc-500">{c.hint}</span>}
                        </span>
                        {c.shortcut && (
                          <kbd className="rounded border border-white/10 bg-zinc-900 px-1.5 py-0.5 text-[10px] font-medium text-zinc-500">
                            {c.shortcut}
                          </kbd>
                        )}
                      </button>
                    );
                  })}
                </div>
              ),
            )
          )}
        </div>
        <div className="flex items-center justify-between border-t border-white/5 px-4 py-2 text-[10px] text-zinc-600">
          <div className="flex gap-3">
            <span><kbd className="kbd">↑</kbd><kbd className="kbd">↓</kbd> wählen</span>
            <span><kbd className="kbd">↵</kbd> ausführen</span>
            <span><kbd className="kbd">Esc</kbd> schließen</span>
          </div>
          <span>Blackruby</span>
        </div>
      </div>
    </div>
  );
}
