// ──────────────────────────────────────────────────────────────────────────────
// MarketplaceBadge — branded chip used wherever a listing/sale/chat needs to
// be tagged with its marketplace. Sizes:
//   sm  → 18 px high, used inside table cells / list rows
//   md  → 22 px high, used on cards
//   lg  → 28 px high, used on detail headers
// ──────────────────────────────────────────────────────────────────────────────

import { getBrand } from '../lib/marketplace';

interface Props {
  id: string | null | undefined;
  size?: 'sm' | 'md' | 'lg';
  showIcon?: boolean;
  className?: string;
}

const sizeMap = {
  sm: { wrap: 'h-[18px] px-1.5 text-[10px] gap-1',  icon: 10 },
  md: { wrap: 'h-[22px] px-2 text-[11px] gap-1.5',  icon: 11 },
  lg: { wrap: 'h-[28px] px-2.5 text-xs gap-1.5',    icon: 13 },
};

export function MarketplaceBadge({ id, size = 'md', showIcon = true, className = '' }: Props) {
  const brand = getBrand(id);
  const cfg = sizeMap[size];
  const Icon = brand.icon;
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full font-semibold ${cfg.wrap} ${brand.chip} ${className}`}
      title={brand.label}
    >
      {showIcon && <Icon size={cfg.icon} strokeWidth={2.4} />}
      <span className="tracking-tight">{brand.label}</span>
    </span>
  );
}

/** Smaller variant — just the icon-dot, no label. Used in dense tables. */
export function MarketplaceDot({ id, className = '' }: { id: string | null | undefined; className?: string }) {
  const brand = getBrand(id);
  return (
    <span
      className={`inline-block h-2 w-2 rounded-full ${brand.dot} ${className}`}
      title={brand.label}
    />
  );
}
