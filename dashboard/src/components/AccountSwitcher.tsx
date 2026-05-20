// ──────────────────────────────────────────────────────────────────────────────
// Account-Switcher — sits in the sidebar right below the logo, shows the
// currently active marketplace account and opens a popover with all others.
// Switching calls POST /api/accounts/select and reloads the page so every
// query refetches scoped to the new account.
//
// Multi-marketplace: accounts are grouped by their `marketplace` column
// (Vinted, eBay-DE, eBay-UK, Kleinanzeigen, …) so users with both Vinted
// and eBay identities can tell them apart at a glance.
// ──────────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronsUpDown, Circle, Loader2, Plus, UserCircle2, KeyRound, AlertTriangle } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { toast } from './Toast';
import { getBrand } from '../lib/marketplace';

interface Account {
  id: number;
  label: string;
  username: string | null;
  logged_in: number;
  active: number;
  marketplace?: string | null;
}

interface ListResponse {
  items: Account[];
  currentId: number;
}

// Display order for the grouped popover. Listed first = top group.
const GROUP_ORDER = [
  'vinted',
  'ebay_de',
  'ebay_uk',
  'kleinanzeigen',
  'depop',
  'mercari',
  'wallapop',
  'etsy',
] as const;

export function AccountSwitcher() {
  const [open, setOpen] = useState(false);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [currentId, setCurrentId] = useState<number>(1);
  const [busy, setBusy] = useState(false);
  const popoverRef = useRef<HTMLDivElement | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await api.get<ListResponse>('/accounts');
      setAccounts(data.items);
      setCurrentId(data.currentId);
    } catch {
      /* ignore — banner on the accounts page will show the real error */
    }
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 10_000);
    return () => clearInterval(t);
  }, [load]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const current = accounts.find((a) => a.id === currentId);

  // Group accounts by marketplace for the popover. Falls back to 'vinted'
  // for legacy rows that never got the marketplace column written. Only
  // shows groups that have at least one account.
  const grouped = useMemo(() => {
    const buckets = new Map<string, Account[]>();
    for (const a of accounts) {
      const mp = (a.marketplace ?? 'vinted') || 'vinted';
      const list = buckets.get(mp) ?? [];
      list.push(a);
      buckets.set(mp, list);
    }
    // Sort: known platforms in declared order first, unknown alphabetically last.
    const ordered: Array<{ marketplace: string; accounts: Account[] }> = [];
    for (const mp of GROUP_ORDER) {
      const list = buckets.get(mp);
      if (list && list.length > 0) ordered.push({ marketplace: mp, accounts: list });
      buckets.delete(mp);
    }
    for (const [mp, list] of [...buckets.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      ordered.push({ marketplace: mp, accounts: list });
    }
    return ordered;
  }, [accounts]);

  const showGroupHeaders = grouped.length > 1;
  const currentBrand = current ? getBrand(current.marketplace ?? 'vinted') : null;

  const select = async (id: number): Promise<void> => {
    if (id === currentId) {
      setOpen(false);
      return;
    }
    setBusy(true);
    try {
      await api.post('/accounts/select', { id });
      // Reload so every page's data refetches scoped to the new account.
      window.location.reload();
    } catch {
      /* ignored — toast handled at caller level */
    } finally {
      setBusy(false);
    }
  };

  return (
    <div ref={popoverRef} className="relative mx-3 mb-3">
      <button
        onClick={() => setOpen((o) => !o)}
        className="group flex w-full items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900/60 px-2.5 py-2 text-left text-[13px] text-zinc-200 transition hover:border-zinc-700 hover:bg-zinc-900"
      >
        <UserCircle2
          size={22}
          className={current?.logged_in ? 'text-rose-400' : 'text-zinc-600'}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate font-semibold text-zinc-100">
              {current?.label ?? 'Account…'}
            </span>
            {currentBrand && (
              <span
                className={`shrink-0 rounded-full px-1.5 py-0 text-[9px] font-semibold leading-[14px] ${currentBrand.chip}`}
                title={currentBrand.label}
              >
                {currentBrand.short}
              </span>
            )}
          </div>
          <div className="truncate text-[10px] text-zinc-500">
            {current?.username ? `@${current.username}` : 'Nicht eingeloggt'}
          </div>
        </div>
        {busy ? (
          <Loader2 size={14} className="animate-spin text-zinc-500" />
        ) : (
          <ChevronsUpDown size={14} className="text-zinc-500" />
        )}
      </button>

      {open && (
        <div className="absolute left-0 right-0 top-full z-40 mt-1 overflow-hidden rounded-lg border border-zinc-800 bg-zinc-900 shadow-2xl">
          <div className="max-h-72 overflow-y-auto py-1">
            {grouped.map((group, gi) => {
              const brand = getBrand(group.marketplace);
              return (
                <div key={group.marketplace} className={gi > 0 ? 'mt-0.5 border-t border-zinc-800 pt-0.5' : ''}>
                  {showGroupHeaders && (
                    <div className="flex items-center gap-1.5 px-2.5 pb-0.5 pt-1.5 text-[9px] font-semibold uppercase tracking-wider text-zinc-500">
                      <span className={`h-1.5 w-1.5 rounded-full ${brand.dot}`} />
                      {brand.label}
                    </div>
                  )}
                  {group.accounts.map((a) => (
                    <button
                      key={a.id}
                      onClick={() => void select(a.id)}
                      className={`flex w-full items-center gap-2 px-2.5 py-2 text-[13px] transition hover:bg-zinc-800 ${
                        a.id === currentId ? 'bg-rose-500/10' : ''
                      }`}
                    >
                      <Circle
                        size={8}
                        className={
                          a.logged_in
                            ? 'fill-rose-400 text-rose-400'
                            : 'fill-amber-400 text-amber-400'
                        }
                      />
                      <span className="flex-1 truncate text-left font-medium text-zinc-200">
                        {a.label}
                      </span>
                      {!showGroupHeaders && (
                        <span
                          className={`shrink-0 rounded-full px-1.5 py-0 text-[9px] font-semibold leading-[14px] ${brand.chip}`}
                          title={brand.label}
                        >
                          {brand.short}
                        </span>
                      )}
                      {!a.logged_in && (
                        <span className="text-[9px] font-semibold uppercase text-amber-300">Login</span>
                      )}
                      {a.id === currentId && (
                        <span className="text-[10px] font-semibold text-rose-400">aktiv</span>
                      )}
                    </button>
                  ))}
                </div>
              );
            })}
          </div>
          {current && !current.logged_in && (
            <button
              type="button"
              onClick={async () => {
                try {
                  await api.post(`/accounts/${current.id}/login`);
                  toast.info('Browser öffnet sich', { detail: 'Logge dich bei Vinted ein — Status erscheint hier.' });
                  setOpen(false);
                } catch (e) {
                  toast.error('Login-Start fehlgeschlagen', {
                    detail: e instanceof Error ? e.message : String(e),
                  });
                }
              }}
              className="flex w-full items-center gap-2 border-t border-zinc-800 px-2.5 py-2 text-[13px] font-semibold text-rose-300 hover:bg-zinc-800"
            >
              <KeyRound size={13} /> Bei Vinted einloggen
            </button>
          )}
          <Link
            to="/settings"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2 border-t border-zinc-800 px-2.5 py-2 text-[13px] font-medium text-rose-400 hover:bg-zinc-800"
          >
            <Plus size={13} /> Accounts verwalten
          </Link>
        </div>
      )}

      {/* Inline warning under the switcher button when the current account
          has no session — only the most critical signal, all detail in the
          popover or Settings → Logins. */}
      {current && current.logged_in === 0 && !open && (
        <div className="mt-1.5 flex items-center gap-1.5 px-1 text-[10px] text-amber-300">
          <AlertTriangle size={10} />
          <span>Nicht eingeloggt — klick zum Einloggen</span>
        </div>
      )}
    </div>
  );
}
