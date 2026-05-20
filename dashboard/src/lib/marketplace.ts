// ──────────────────────────────────────────────────────────────────────────────
// Marketplace brand metadata — single source of truth for per-platform colors,
// labels and icons. Used by the Sidebar, Home-Marketplace-Cards, Marketplace
// deep-link pages, badges on the Listings/Sales grids, etc.
//
// Colors are chosen to be RECOGNISABLE (close to each brand's real palette) but
// readable on the zinc-950 dark surface. We expose:
//   * `accent` — the saturated brand hue, used for primary outlines + buttons
//   * `tint`   — the same hue at 8–12% opacity, for backgrounds
//   * `ring`   — ring-color utility (used in `ring-1 ring-{color}-500/30`)
// ──────────────────────────────────────────────────────────────────────────────

import {
  Shirt,
  Tag,
  Store,
  ShoppingBag,
  Shirt as ShirtMen,
  Globe,
  type LucideIcon,
} from 'lucide-react';

export type MarketplaceId =
  | 'vinted'
  | 'kleinanzeigen'
  | 'ebay_de'
  | 'ebay_uk'
  | 'depop'
  | 'mercari'
  | 'wallapop'
  | 'etsy'
  | 'grailed'
  | 'fb_marketplace'
  | 'poshmark'
  | 'shopify'
  | 'woocommerce'
  | 'leboncoin'
  | 'marktplaats'
  | 'willhaben'
  | 'subito'
  | 'ricardo'
  | 'vestiaire'
  | 'whatnot';

export interface MarketplaceBrand {
  id: MarketplaceId;
  label: string;       // "Vinted"
  short: string;       // "Vinted" (sidebar)
  locale: 'DE' | 'UK' | 'US' | 'ES' | 'NL';
  icon: LucideIcon;
  /** Tailwind class snippet for a filled "chip" — bg, text, ring */
  chip: string;
  /** Tailwind text color for the brand hue */
  text: string;
  /** Tailwind bg utility (semi-transparent) for backgrounds */
  bgTint: string;
  /** Tailwind ring utility (semi-transparent) */
  ring: string;
  /** Dot color for status indicators */
  dot: string;
  /** Gradient `from-x via-y to-z` for hero cards */
  gradient: string;
  /** Status of integration */
  ready: boolean;
  /** Listing host for external links */
  baseUrl: string;
  /** True if the site is fronted by Cloudflare and may show interstitials. */
  cloudflareProtected?: boolean;
}

export const MARKETPLACE_BRANDS: Record<MarketplaceId, MarketplaceBrand> = {
  vinted: {
    id: 'vinted',
    label: 'Vinted',
    short: 'Vinted',
    locale: 'DE',
    icon: Shirt,
    chip: 'bg-teal-500/15 text-teal-200 ring-1 ring-teal-500/30',
    text: 'text-teal-300',
    bgTint: 'bg-teal-500/10',
    ring: 'ring-teal-500/30',
    dot: 'bg-teal-400',
    gradient: 'from-teal-500/15 via-cyan-500/10 to-emerald-500/15',
    ready: true,
    baseUrl: 'https://www.vinted.de',
  },
  kleinanzeigen: {
    id: 'kleinanzeigen',
    label: 'Kleinanzeigen',
    short: 'Kleinanzeigen',
    locale: 'DE',
    icon: Tag,
    chip: 'bg-lime-500/15 text-lime-200 ring-1 ring-lime-500/30',
    text: 'text-lime-300',
    bgTint: 'bg-lime-500/10',
    ring: 'ring-lime-500/30',
    dot: 'bg-lime-400',
    gradient: 'from-lime-500/15 via-emerald-500/10 to-green-500/15',
    ready: true,
    baseUrl: 'https://www.kleinanzeigen.de',
  },
  ebay_de: {
    id: 'ebay_de',
    label: 'eBay DE',
    short: 'eBay-DE',
    locale: 'DE',
    icon: Store,
    chip: 'bg-blue-500/15 text-blue-200 ring-1 ring-blue-500/30',
    text: 'text-blue-300',
    bgTint: 'bg-blue-500/10',
    ring: 'ring-blue-500/30',
    dot: 'bg-blue-400',
    gradient: 'from-blue-500/15 via-red-500/10 to-yellow-500/15',
    ready: true,
    baseUrl: 'https://www.ebay.de',
  },
  ebay_uk: {
    id: 'ebay_uk',
    label: 'eBay UK',
    short: 'eBay-UK',
    locale: 'UK',
    icon: Store,
    chip: 'bg-blue-500/15 text-blue-200 ring-1 ring-blue-500/30',
    text: 'text-blue-300',
    bgTint: 'bg-blue-500/10',
    ring: 'ring-blue-500/30',
    dot: 'bg-blue-400',
    gradient: 'from-blue-500/15 via-red-500/10 to-yellow-500/15',
    ready: true,
    baseUrl: 'https://www.ebay.co.uk',
  },
  depop: {
    id: 'depop',
    label: 'Depop',
    short: 'Depop',
    locale: 'UK',
    icon: ShoppingBag,
    chip: 'bg-rose-500/15 text-rose-200 ring-1 ring-rose-500/30',
    text: 'text-rose-300',
    bgTint: 'bg-rose-500/10',
    ring: 'ring-rose-500/30',
    dot: 'bg-rose-400',
    gradient: 'from-rose-500/15 via-pink-500/10 to-red-500/15',
    ready: true,
    baseUrl: 'https://www.depop.com',
    cloudflareProtected: true,
  },
  mercari: {
    id: 'mercari',
    label: 'Mercari',
    short: 'Mercari',
    locale: 'US',
    icon: ShoppingBag,
    chip: 'bg-orange-500/15 text-orange-200 ring-1 ring-orange-500/30',
    text: 'text-orange-300',
    bgTint: 'bg-orange-500/10',
    ring: 'ring-orange-500/30',
    dot: 'bg-orange-400',
    gradient: 'from-orange-500/15 via-amber-500/10 to-red-500/15',
    ready: true,
    baseUrl: 'https://www.mercari.com',
  },
  wallapop: {
    id: 'wallapop',
    label: 'Wallapop',
    short: 'Wallapop',
    locale: 'ES',
    icon: ShoppingBag,
    chip: 'bg-cyan-500/15 text-cyan-200 ring-1 ring-cyan-500/30',
    text: 'text-cyan-300',
    bgTint: 'bg-cyan-500/10',
    ring: 'ring-cyan-500/30',
    dot: 'bg-cyan-400',
    gradient: 'from-cyan-500/15 via-sky-500/10 to-teal-500/15',
    ready: true,
    baseUrl: 'https://es.wallapop.com',
  },
  etsy: {
    id: 'etsy',
    label: 'Etsy',
    short: 'Etsy',
    locale: 'US',
    icon: ShoppingBag,
    chip: 'bg-amber-500/15 text-amber-200 ring-1 ring-amber-500/30',
    text: 'text-amber-300',
    bgTint: 'bg-amber-500/10',
    ring: 'ring-amber-500/30',
    dot: 'bg-amber-400',
    gradient: 'from-amber-500/15 via-orange-500/10 to-yellow-500/15',
    ready: true,
    baseUrl: 'https://www.etsy.com',
  },
  grailed: {
    id: 'grailed',
    label: 'Grailed',
    short: 'Grailed',
    locale: 'US',
    icon: ShirtMen,
    chip: 'bg-zinc-500/15 text-zinc-200 ring-1 ring-zinc-500/30',
    text: 'text-zinc-300',
    bgTint: 'bg-zinc-700/40',
    ring: 'ring-zinc-500/30',
    dot: 'bg-zinc-400',
    gradient: 'from-zinc-700/30 via-zinc-800/20 to-zinc-900/30',
    ready: true,
    baseUrl: 'https://www.grailed.com',
    cloudflareProtected: true,
  },
  fb_marketplace: {
    id: 'fb_marketplace',
    label: 'FB Marketplace',
    short: 'Facebook',
    locale: 'DE',
    icon: Globe,
    chip: 'bg-indigo-500/15 text-indigo-200 ring-1 ring-indigo-500/30',
    text: 'text-indigo-300',
    bgTint: 'bg-indigo-500/10',
    ring: 'ring-indigo-500/30',
    dot: 'bg-indigo-400',
    gradient: 'from-indigo-500/15 via-blue-500/10 to-violet-500/15',
    ready: true,
    baseUrl: 'https://www.facebook.com/marketplace',
  },
  vestiaire: {
    id: 'vestiaire',
    label: 'Vestiaire Collective',
    short: 'Vestiaire',
    locale: 'NL',
    icon: ShoppingBag,
    chip: 'bg-fuchsia-500/15 text-fuchsia-200 ring-1 ring-fuchsia-500/30',
    text: 'text-fuchsia-300',
    bgTint: 'bg-fuchsia-500/10',
    ring: 'ring-fuchsia-500/30',
    dot: 'bg-fuchsia-400',
    gradient: 'from-fuchsia-500/15 via-purple-500/10 to-pink-500/15',
    ready: true,
    baseUrl: 'https://www.vestiairecollective.com',
    cloudflareProtected: true,
  },
  whatnot: {
    id: 'whatnot',
    label: 'Whatnot',
    short: 'Whatnot',
    locale: 'US',
    icon: Store,
    chip: 'bg-violet-500/15 text-violet-200 ring-1 ring-violet-500/30',
    text: 'text-violet-300',
    bgTint: 'bg-violet-500/10',
    ring: 'ring-violet-500/30',
    dot: 'bg-violet-400',
    gradient: 'from-violet-500/15 via-purple-500/10 to-fuchsia-500/15',
    ready: true,
    baseUrl: 'https://www.whatnot.com',
  },
  poshmark: {
    id: 'poshmark',
    label: 'Poshmark',
    short: 'Poshmark',
    locale: 'US',
    icon: ShoppingBag,
    chip: 'bg-pink-500/15 text-pink-200 ring-1 ring-pink-500/30',
    text: 'text-pink-300',
    bgTint: 'bg-pink-500/10',
    ring: 'ring-pink-500/30',
    dot: 'bg-pink-400',
    gradient: 'from-pink-500/15 via-rose-500/10 to-fuchsia-500/15',
    ready: true,
    baseUrl: 'https://poshmark.com',
  },
  leboncoin: {
    id: 'leboncoin',
    label: 'Leboncoin',
    short: 'Leboncoin',
    locale: 'ES',
    icon: Tag,
    chip: 'bg-orange-500/15 text-orange-200 ring-1 ring-orange-500/30',
    text: 'text-orange-300',
    bgTint: 'bg-orange-500/10',
    ring: 'ring-orange-500/30',
    dot: 'bg-orange-400',
    gradient: 'from-orange-500/15 via-amber-500/10 to-yellow-500/15',
    ready: true,
    baseUrl: 'https://www.leboncoin.fr',
    cloudflareProtected: true,
  },
  marktplaats: {
    id: 'marktplaats',
    label: 'Marktplaats',
    short: 'Marktplaats',
    locale: 'NL',
    icon: Tag,
    chip: 'bg-cyan-500/15 text-cyan-200 ring-1 ring-cyan-500/30',
    text: 'text-cyan-300',
    bgTint: 'bg-cyan-500/10',
    ring: 'ring-cyan-500/30',
    dot: 'bg-cyan-400',
    gradient: 'from-cyan-500/15 via-sky-500/10 to-blue-500/15',
    ready: true,
    baseUrl: 'https://www.marktplaats.nl',
  },
  willhaben: {
    id: 'willhaben',
    label: 'Willhaben',
    short: 'Willhaben',
    locale: 'DE',
    icon: Tag,
    chip: 'bg-yellow-500/15 text-yellow-200 ring-1 ring-yellow-500/30',
    text: 'text-yellow-300',
    bgTint: 'bg-yellow-500/10',
    ring: 'ring-yellow-500/30',
    dot: 'bg-yellow-400',
    gradient: 'from-yellow-500/15 via-amber-500/10 to-orange-500/15',
    ready: true,
    baseUrl: 'https://www.willhaben.at',
  },
  shopify: {
    id: 'shopify',
    label: 'Shopify',
    short: 'Shopify',
    locale: 'US',
    icon: Store,
    chip: 'bg-emerald-500/15 text-emerald-200 ring-1 ring-emerald-500/30',
    text: 'text-emerald-300',
    bgTint: 'bg-emerald-500/10',
    ring: 'ring-emerald-500/30',
    dot: 'bg-emerald-400',
    gradient: 'from-emerald-500/15 via-green-500/10 to-lime-500/15',
    ready: true,
    baseUrl: 'https://admin.shopify.com',
  },
  woocommerce: {
    id: 'woocommerce',
    label: 'WooCommerce',
    short: 'WooCommerce',
    locale: 'US',
    icon: Store,
    chip: 'bg-purple-500/15 text-purple-200 ring-1 ring-purple-500/30',
    text: 'text-purple-300',
    bgTint: 'bg-purple-500/10',
    ring: 'ring-purple-500/30',
    dot: 'bg-purple-400',
    gradient: 'from-purple-500/15 via-violet-500/10 to-indigo-500/15',
    ready: true,
    baseUrl: 'https://woocommerce.com',
  },
  subito: {
    id: 'subito',
    label: 'Subito',
    short: 'Subito',
    locale: 'NL',
    icon: Tag,
    chip: 'bg-red-500/15 text-red-200 ring-1 ring-red-500/30',
    text: 'text-red-300',
    bgTint: 'bg-red-500/10',
    ring: 'ring-red-500/30',
    dot: 'bg-red-400',
    gradient: 'from-red-500/15 via-rose-500/10 to-pink-500/15',
    ready: false,
    baseUrl: 'https://www.subito.it',
  },
  ricardo: {
    id: 'ricardo',
    label: 'Ricardo',
    short: 'Ricardo',
    locale: 'DE',
    icon: Tag,
    chip: 'bg-teal-500/15 text-teal-200 ring-1 ring-teal-500/30',
    text: 'text-teal-300',
    bgTint: 'bg-teal-500/10',
    ring: 'ring-teal-500/30',
    dot: 'bg-teal-400',
    gradient: 'from-teal-500/15 via-cyan-500/10 to-sky-500/15',
    ready: false,
    baseUrl: 'https://www.ricardo.ch',
  },
};

export const PRIMARY_MARKETPLACES: MarketplaceId[] = ['vinted', 'kleinanzeigen', 'ebay_de'];

export function getBrand(id: string | null | undefined): MarketplaceBrand {
  if (!id) return MARKETPLACE_BRANDS.vinted;
  const b = MARKETPLACE_BRANDS[id as MarketplaceId];
  return b ?? MARKETPLACE_BRANDS.vinted;
}

/** Stylized marketplace badge — use to tag listings, sales, chats, offers. */
export function marketplaceLabel(id: string): string {
  return getBrand(id).label;
}
