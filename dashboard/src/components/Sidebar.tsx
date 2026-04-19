import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard,
  Package,
  MessageSquareDashed,
  HandCoins,
  ShoppingCart,
  BarChart3,
  Radio,
  Settings as SettingsIcon,
  type LucideIcon,
} from 'lucide-react';

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
}

const ITEMS: NavItem[] = [
  { to: '/overview',    label: 'Übersicht',    icon: LayoutDashboard },
  { to: '/fulfillment', label: 'Fulfillment',  icon: ShoppingCart },
  { to: '/listings',    label: 'Listings',     icon: Package },
  { to: '/offers',      label: 'Angebote',     icon: HandCoins },
  { to: '/chats',       label: 'Chats',        icon: MessageSquareDashed },
  { to: '/analytics',   label: 'Analytics',    icon: BarChart3 },
  { to: '/logs',        label: 'Live-Logs',    icon: Radio },
  { to: '/settings',    label: 'Einstellungen', icon: SettingsIcon },
];

export function Sidebar() {
  return (
    <aside className="flex h-screen w-56 flex-col border-r border-slate-200 bg-white">
      <div className="flex items-center gap-2 border-b border-slate-200 px-4 py-4">
        <div className="h-7 w-7 rounded bg-brand-600" />
        <div className="flex flex-col leading-tight">
          <span className="text-sm font-semibold">Vinted-System</span>
          <span className="text-[10px] uppercase tracking-wider text-slate-400">Batch-Cart</span>
        </div>
      </div>
      <nav className="flex-1 space-y-0.5 p-2">
        {ITEMS.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              `flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition ${
                isActive
                  ? 'bg-brand-50 text-brand-700'
                  : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
              }`
            }
          >
            <item.icon size={16} strokeWidth={2} />
            {item.label}
          </NavLink>
        ))}
      </nav>
      <div className="border-t border-slate-200 p-3 text-[10px] text-slate-400">
        lokal • v0.2.0
      </div>
    </aside>
  );
}
