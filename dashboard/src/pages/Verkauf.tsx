import { useEffect, useState } from 'react';
import { HandCoins, MessageSquareDashed, ShoppingBag } from 'lucide-react';
import { OffersPage } from './Offers';
import { ChatsPage } from './Chats';
import { SalesGridPage } from './SalesGrid';

type Tab = 'sales' | 'offers' | 'chats';

const TABS: Array<{ id: Tab; label: string; icon: typeof ShoppingBag; shortcut: string }> = [
  { id: 'sales',   label: 'Verkäufe',  icon: ShoppingBag,         shortcut: '1' },
  { id: 'offers',  label: 'Angebote',  icon: HandCoins,           shortcut: '2' },
  { id: 'chats',   label: 'Chats',     icon: MessageSquareDashed, shortcut: '3' },
];

export function VerkaufPage() {
  const [tab, setTab] = useState<Tab>('sales');

  // Local sub-tab shortcuts: Shift+1/2/3 jumps between Verkäufe / Offers / Chats.
  // (Cmd+1..4 is reserved for global page navigation.)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.shiftKey || e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      const t = TABS.find((x) => x.shortcut === e.key);
      if (t) { e.preventDefault(); setTab(t.id); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="page-title">Verkauf</h1>
        <p className="page-subtitle">Was rausgegangen ist · offene Angebote · Chats</p>
      </div>

      <div className="flex gap-1 border-b border-zinc-800">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`-mb-px flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-semibold transition ${
              tab === t.id
                ? 'border-rose-500 text-rose-300'
                : 'border-transparent text-zinc-500 hover:text-zinc-300'
            }`}
          >
            <t.icon size={15} />
            <span>{t.label}</span>
            <kbd className="kbd ml-1 hidden sm:inline-block">⇧{t.shortcut}</kbd>
          </button>
        ))}
      </div>

      <div className="fade-in" key={tab}>
        {tab === 'sales' && <SalesGridPage />}
        {tab === 'offers' && <OffersPage />}
        {tab === 'chats' && <ChatsPage />}
      </div>
    </div>
  );
}
