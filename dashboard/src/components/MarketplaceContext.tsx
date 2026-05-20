// ──────────────────────────────────────────────────────────────────────────────
// Marketplace selector context.
//
// Top-left of the sidebar lets the user pick which marketplace to view.
// "all" aggregates KPIs across every platform; specific values scope the
// dashboard to that one marketplace (Vinted, Kleinanzeigen, eBay-DE, …).
//
// API endpoints read the `marketplace` query param. UI components read from
// this context via `useMarketplace()`.
// ──────────────────────────────────────────────────────────────────────────────

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

export type Marketplace = 'all' | 'vinted' | 'kleinanzeigen' | 'ebay_de';

export const MARKETPLACES: Array<{
  id: Marketplace;
  label: string;
  short: string;
  dot: string;          // tailwind bg-* class for the indicator dot
  color: string;
  ringColor: string;
}> = [
  { id: 'all',           label: 'Alle Marketplaces',  short: 'Overall',       dot: 'bg-rose-400',   color: 'text-rose-300', ringColor: 'ring-rose-500/40' },
  { id: 'vinted',        label: 'Vinted',             short: 'Vinted',        dot: 'bg-rose-400',     color: 'text-rose-300',   ringColor: 'ring-rose-500/40' },
  { id: 'kleinanzeigen', label: 'Kleinanzeigen',      short: 'Kleinanzeigen', dot: 'bg-rose-400',     color: 'text-rose-300',   ringColor: 'ring-rose-500/40' },
  { id: 'ebay_de',       label: 'eBay-DE',            short: 'eBay-DE',       dot: 'bg-blue-400',     color: 'text-blue-300',   ringColor: 'ring-blue-500/40' },
];

interface MarketplaceCtx {
  marketplace: Marketplace;
  setMarketplace: (m: Marketplace) => void;
  query: string;  // "" for all, "?marketplace=vinted" otherwise
}

const Context = createContext<MarketplaceCtx>({
  marketplace: 'all',
  setMarketplace: () => undefined,
  query: '',
});

const LS_KEY = 'br_marketplace';

export function MarketplaceProvider({ children }: { children: ReactNode }) {
  const [marketplace, setMarketplaceState] = useState<Marketplace>(() => {
    const v = localStorage.getItem(LS_KEY);
    if (v === 'vinted' || v === 'kleinanzeigen' || v === 'ebay_de' || v === 'all') return v;
    return 'all';
  });

  useEffect(() => {
    localStorage.setItem(LS_KEY, marketplace);
  }, [marketplace]);

  const query = marketplace === 'all' ? '' : `?marketplace=${marketplace}`;

  return (
    <Context.Provider value={{ marketplace, setMarketplace: setMarketplaceState, query }}>
      {children}
    </Context.Provider>
  );
}

export function useMarketplace(): MarketplaceCtx {
  return useContext(Context);
}
