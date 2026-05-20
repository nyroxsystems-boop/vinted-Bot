import { useState, useEffect, useCallback } from 'react';
import { NavLink } from 'react-router-dom';
import {
  Home,
  Package,
  ShoppingBag,
  Settings as SettingsIcon,
  Wallet,
  Sparkles,
  User,
  Image as ImageIcon,
  TrendingUp,
  PackageX,
  Power,
  type LucideIcon,
} from 'lucide-react';
import { Logo } from './Logo';
import { AccountSwitcher } from './AccountSwitcher';
import { MarketplaceSwitcher } from './MarketplaceSwitcher';
import { api } from '../api/client';
import { fmtEurCompact } from '../lib/format';
import { useMarketplace } from './MarketplaceContext';

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  shortcut?: string;
}

// Slim 4-item nav. Power-user pages still routed (deep links work) but
// not surfaced in the sidebar to avoid clutter. Listings/Offers/Orders/Chats
// all live under the "Verkauf" page via tabs.
const NAV: NavItem[] = [
  { to: '/',         label: 'Home',          icon: Home,         shortcut: '1' },
  { to: '/pipeline', label: 'Pipeline',      icon: Sparkles,     shortcut: '2' },
  { to: '/trends',   label: 'Trends',        icon: TrendingUp,   shortcut: '3' },
  { to: '/studio',   label: 'Model-Studio',  icon: User,         shortcut: '4' },
  { to: '/scenes',   label: 'Szenen-Studio', icon: ImageIcon,    shortcut: '5' },
  { to: '/listings', label: 'Listings',      icon: Package,      shortcut: '6' },
  { to: '/verkauf',  label: 'Verkauf',       icon: ShoppingBag,  shortcut: '7' },
  { to: '/refunds',  label: 'Refunds',       icon: PackageX,     shortcut: '8' },
  { to: '/operations', label: 'Operations',  icon: Power,        shortcut: '0' },
  { to: '/settings', label: 'Einstellungen', icon: SettingsIcon, shortcut: '9' },
];

interface Profit {
  today: { profit_eur: number; sales: number };
}

interface StatusInfo {
  pendingOffers: number;
  unreadChats: number;
  soldNotShipped: number;
}

export function Sidebar() {
  const [onlineCount, setOnlineCount] = useState<number>(0);
  const [totalBots, setTotalBots] = useState<number>(0);
  const [profit, setProfit] = useState<Profit | null>(null);
  const [info, setInfo] = useState<StatusInfo | null>(null);
  const { query } = useMarketplace();

  const fetchHealth = useCallback(async () => {
    try {
      const r = await api.get<{ marketplaces: Array<{ marketplace: string; online: boolean }> }>(
        '/products/marketplaces/health',
      );
      const arr = r.marketplaces ?? [];
      setOnlineCount(arr.filter((m) => m.online).length);
      setTotalBots(arr.length);
    } catch { /* */ }
  }, []);

  const fetchProfit = useCallback(async () => {
    try {
      const p = await api.get<Profit>(`/home/profit${query}`);
      setProfit(p);
    } catch { /* endpoint optional */ }
  }, [query]);

  const fetchInfo = useCallback(async () => {
    try {
      const s = await api.get<StatusInfo>(`/home/status${query}`);
      setInfo(s);
    } catch { /* */ }
  }, [query]);

  useEffect(() => {
    void fetchHealth();
    void fetchProfit();
    void fetchInfo();
    const t1 = setInterval(() => void fetchHealth(), 30_000);
    const t2 = setInterval(() => void fetchProfit(), 15_000);
    const t3 = setInterval(() => void fetchInfo(), 20_000);
    return () => { clearInterval(t1); clearInterval(t2); clearInterval(t3); };
  }, [fetchHealth, fetchProfit, fetchInfo]);

  const verkaufUnread = (info?.pendingOffers ?? 0) + (info?.unreadChats ?? 0);

  const todayProfit = profit?.today?.profit_eur ?? 0;
  const todaySales  = profit?.today?.sales ?? 0;

  return (
    <aside className="relative flex h-screen w-56 flex-col border-r border-white/5 bg-[var(--surface-1)] backdrop-blur-xl">
      {/* subtle brand glow at top */}
      <div
        className="pointer-events-none absolute left-0 right-0 top-0 h-44 opacity-60"
        style={{
          background:
            'radial-gradient(circle at 30% 0%, rgba(244,63,94,0.10), transparent 65%), radial-gradient(circle at 80% 0%, rgba(99,102,241,0.10), transparent 70%)',
        }}
      />
      {/* Logo */}
      <div className="relative px-5 pb-4 pt-6">
        <div className="flex items-center gap-3">
          <Logo size={32} />
          <div className="flex flex-col leading-tight">
            <span className="text-[14px] font-bold tracking-tight text-zinc-100">Blackruby</span>
            <span className="text-[9px] font-medium uppercase tracking-[0.18em] text-zinc-500">
              Hustle Engine
            </span>
          </div>
        </div>
      </div>

      <MarketplaceSwitcher />
      <AccountSwitcher />

      <nav className="relative flex-1 px-3 pt-2">
        <div className="space-y-1">
          {NAV.map((item) => {
            const unread = item.to === '/verkauf' ? verkaufUnread : 0;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/'}
                className={({ isActive }) =>
                  `group relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-[13.5px] font-semibold transition-all duration-200 ${
                    isActive
                      ? 'text-white'
                      : 'text-zinc-400 hover:bg-white/[0.03] hover:text-zinc-100'
                  }`
                }
              >
                {({ isActive }) => (
                  <>
                    {isActive && (
                      <>
                        <span
                          className="pointer-events-none absolute inset-0 rounded-lg opacity-100"
                          style={{
                            background:
                              'linear-gradient(120deg, rgba(244,63,94,0.18), rgba(168,85,247,0.16) 50%, rgba(99,102,241,0.18))',
                            boxShadow:
                              '0 0 0 1px rgba(168,85,247,0.30) inset, 0 6px 20px -8px rgba(168,85,247,0.5)',
                          }}
                        />
                        <span className="pointer-events-none absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-gradient-to-b from-rose-400 to-rose-400" />
                      </>
                    )}
                    <item.icon size={16} strokeWidth={2.2} className="relative" />
                    <span className="relative flex-1">{item.label}</span>
                    {unread > 0 && (
                      <span className="relative inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1.5 text-[10px] font-bold tabular text-white"
                        style={{ background: 'linear-gradient(120deg, #f43f5e, #be123c)', boxShadow: '0 0 12px rgba(244,63,94,0.5)' }}>
                        {unread > 99 ? '99+' : unread}
                      </span>
                    )}
                    {item.shortcut && unread === 0 && (
                      <kbd className="kbd relative hidden sm:inline-block">⌘{item.shortcut}</kbd>
                    )}
                  </>
                )}
              </NavLink>
            );
          })}
        </div>
      </nav>

      {/* Cash ticker — the most important number, always in view */}
      <div
        className="relative mx-3 mb-3 overflow-hidden rounded-xl border border-rose-500/25 p-3"
        style={{
          background:
            'linear-gradient(135deg, rgba(16,185,129,0.10), rgba(20,184,166,0.04)), var(--surface-2)',
          boxShadow: '0 8px 24px -12px rgba(16,185,129,0.35)',
        }}
      >
        <div
          className="pointer-events-none absolute -right-8 -top-8 h-20 w-20 rounded-full"
          style={{ background: 'rgba(16,185,129,0.18)', filter: 'blur(20px)' }}
        />
        <div className="relative flex items-center justify-between">
          <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-rose-300/90">
            <Wallet size={10} /> Heute
          </span>
          <span className="dot-good dot-pulse" />
        </div>
        <div className="relative mt-1 display tabular text-xl font-extrabold text-rose-100">
          {profit ? fmtEurCompact(todayProfit) : '—'}
        </div>
        <div className="relative mt-0.5 text-[10px] text-zinc-500">
          {todaySales} Sale{todaySales === 1 ? '' : 's'}
        </div>
      </div>

      {/* Footer: bot health + version */}
      <div className="relative mx-3 mb-3 rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2.5">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-medium uppercase tracking-wider text-zinc-500">
            Bots
          </span>
          <span className="flex items-center gap-1.5 text-[11px] font-semibold text-zinc-300 tabular">
            <span className={onlineCount > 0 ? 'dot-good dot-pulse' : 'dot-muted'} />
            {onlineCount}/{totalBots}
          </span>
        </div>
        <div className="mt-1 flex items-center justify-between">
          <span className="text-[10px] font-medium uppercase tracking-wider text-zinc-600">
            v0.5
          </span>
          <span className="text-[10px] font-medium text-zinc-600">⌘K</span>
        </div>
      </div>
    </aside>
  );
}
