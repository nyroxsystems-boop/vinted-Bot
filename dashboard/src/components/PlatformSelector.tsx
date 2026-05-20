import { useState, useEffect } from 'react';
import { ChevronDown } from 'lucide-react';
import { useNavigate, useLocation } from 'react-router-dom';

export type Platform =
  | 'vinted'
  | 'kleinanzeigen'
  | 'mercari'
  | 'depop'
  | 'wallapop'
  | 'marktde'
  | 'marktplaats'
  | 'olx';

interface PlatformInfo {
  id: Platform;
  label: string;
  country: string;
  color: string;
  bgColor: string;
  ready: boolean;
}

const PLATFORMS: PlatformInfo[] = [
  { id: 'vinted',        label: 'Vinted',             country: '🇩🇪 DE', color: 'text-rose-700', bgColor: 'bg-rose-50 border-rose-200', ready: true },
  { id: 'kleinanzeigen', label: 'eBay Kleinanzeigen', country: '🇩🇪 DE', color: 'text-blue-700',    bgColor: 'bg-blue-50 border-blue-200',       ready: true },
  { id: 'mercari',       label: 'Mercari',            country: '🇺🇸 US', color: 'text-rose-700',    bgColor: 'bg-rose-50 border-rose-200',       ready: true },
  { id: 'depop',         label: 'Depop',              country: '🇬🇧 UK', color: 'text-rose-700',  bgColor: 'bg-rose-50 border-rose-200',   ready: true },
  { id: 'wallapop',      label: 'Wallapop',           country: '🇪🇸 ES', color: 'text-amber-700',   bgColor: 'bg-amber-50 border-amber-200',     ready: true },
  { id: 'marktde',       label: 'Markt.de',           country: '🇩🇪 DE', color: 'text-orange-700',  bgColor: 'bg-orange-50 border-orange-200',   ready: false },
  { id: 'marktplaats',   label: 'Marktplaats',        country: '🇳🇱 NL', color: 'text-rose-700',  bgColor: 'bg-rose-50 border-rose-200',   ready: false },
  { id: 'olx',           label: 'OLX.pl',             country: '🇵🇱 PL', color: 'text-rose-700',    bgColor: 'bg-rose-50 border-rose-200',       ready: false },
];

interface Props {
  value: Platform;
  onChange: (p: Platform) => void;
}

export function PlatformSelector({ value, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();

  // Sync den ausgewählten Wert mit der aktuellen Route
  useEffect(() => {
    const m = location.pathname.match(/^\/marketplace\/([^/]+)/);
    if (m && m[1]) {
      const id = m[1] as Platform;
      if (PLATFORMS.some((p) => p.id === id) && id !== value) {
        onChange(id);
      }
    }
  }, [location.pathname, onChange, value]);

  const current = PLATFORMS.find((p) => p.id === value) ?? PLATFORMS[0]!;

  const select = (p: PlatformInfo) => {
    if (!p.ready) return;
    onChange(p.id);
    setOpen(false);
    navigate(`/marketplace/${p.id}`);
  };

  return (
    <div className="relative px-3 pb-3">
      <button
        onClick={() => setOpen(!open)}
        className={`flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left text-sm font-medium transition ${current.bgColor} ${current.color}`}
      >
        <div className="flex items-center gap-2">
          <span className="text-base">{current.country.split(' ')[0]}</span>
          <span>{current.label}</span>
        </div>
        <ChevronDown size={14} className={`transition ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute left-3 right-3 z-50 mt-1 rounded-lg border border-slate-200 bg-white shadow-lg">
          {PLATFORMS.map((p) => (
            <button
              key={p.id}
              onClick={() => select(p)}
              disabled={!p.ready}
              className={`flex w-full items-center justify-between px-3 py-2.5 text-left text-sm transition first:rounded-t-lg last:rounded-b-lg ${
                p.id === value ? `${p.bgColor} ${p.color} font-medium` : 'hover:bg-slate-50'
              } ${!p.ready ? 'cursor-not-allowed opacity-40' : ''}`}
            >
              <div className="flex items-center gap-2">
                <span className="text-base">{p.country.split(' ')[0]}</span>
                <span>{p.label}</span>
              </div>
              {!p.ready ? (
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                  Soon
                </span>
              ) : p.id === value ? (
                <span className="h-2 w-2 rounded-full bg-rose-500" />
              ) : null}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
