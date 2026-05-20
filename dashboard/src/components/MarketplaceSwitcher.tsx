// Sidebar marketplace switcher. Shown at the top — picks the data scope for
// Home, Listings, Verkauf pages. "All" aggregates across marketplaces.

import { useEffect, useRef, useState } from 'react';
import { Check, ChevronsUpDown, Globe } from 'lucide-react';
import { MARKETPLACES, useMarketplace } from './MarketplaceContext';
import { getBrand } from '../lib/marketplace';

export function MarketplaceSwitcher() {
  const { marketplace, setMarketplace } = useMarketplace();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const current = MARKETPLACES.find((m) => m.id === marketplace) ?? MARKETPLACES[0]!;
  // For "all" we render a globe; otherwise the marketplace brand icon.
  const CurrentIcon = current.id === 'all' ? Globe : getBrand(current.id).icon;

  return (
    <div ref={ref} className="relative mx-3 mb-2">
      <button
        onClick={() => setOpen((o) => !o)}
        className={`group flex w-full items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900/60 px-2.5 py-2 text-left text-[13px] text-zinc-200 transition hover:border-zinc-700 hover:bg-zinc-900 ring-1 ring-inset ${current.ringColor}`}
      >
        <CurrentIcon size={15} strokeWidth={2.2} className={current.color} />
        <div className="min-w-0 flex-1">
          <div className={`text-[10px] font-semibold uppercase tracking-wider ${current.color}`}>
            Marketplace
          </div>
          <div className="truncate text-[13.5px] font-bold text-zinc-100">{current.short}</div>
        </div>
        <ChevronsUpDown size={14} className="text-zinc-500" />
      </button>

      {open && (
        <div className="absolute left-0 right-0 top-full z-40 mt-1 overflow-hidden rounded-lg border border-zinc-800 bg-zinc-900 shadow-2xl">
          {MARKETPLACES.map((m) => {
            const Icon = m.id === 'all' ? Globe : getBrand(m.id).icon;
            return (
              <button
                key={m.id}
                onClick={() => { setMarketplace(m.id); setOpen(false); }}
                className={`flex w-full items-center gap-2.5 px-3 py-2.5 text-[13px] transition hover:bg-zinc-800 ${
                  m.id === marketplace ? 'bg-zinc-800/60' : ''
                }`}
              >
                <Icon size={14} strokeWidth={2.2} className={m.color} />
                <span className="flex-1 text-left text-zinc-200">{m.label}</span>
                {m.id === marketplace && <Check size={14} className="text-rose-400" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
