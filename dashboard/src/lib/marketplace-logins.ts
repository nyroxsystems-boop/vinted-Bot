// ──────────────────────────────────────────────────────────────────────────────
// Shared marketplace-login catalog.
//
// Both `pages/Accounts.tsx` (multi-account view) and `components/AuthPanel.tsx`
// (current-account view in Settings → Logins) render the same set of 17 logins.
// Keeping the metadata in two places used to drift — this file is the single
// source of truth.
//
// What lives here:
//   - login route template (`/api/...`)
//   - auth-mode flags (apiOnly, cloudflare)
//   - human-readable hint shown to the user
//   - risk warnings (FB Marketplace)
//
// What does NOT live here:
//   - visual chip-styles → those come from `lib/marketplace.ts` (getBrand)
//   - per-account/session state → that comes from the orchestrator's
//     /api/auth/status endpoint
// ──────────────────────────────────────────────────────────────────────────────

export interface MarketplaceLoginEntry {
  /** Stable id matching BOT_ENDPOINTS keys + brand lib. */
  id: string;
  /** Human-readable label, e.g. "eBay DE". */
  label: string;
  /** Emoji fallback for grids without brand icons. */
  emoji: string;
  /**
   * Login path. `{id}` is replaced with the account id.
   * - For browser-login marketplaces: `/api/bot/<mp>/login?account={id}`
   * - For Vinted (legacy): `/api/accounts/{id}/login`
   * - For API-only (shopify, woocommerce): `/settings#api-auth` (UI nav, not POST)
   */
  loginPath: string;
  /** Cloudflare-fronted? Login may show Turnstile interstitial. */
  cloudflare?: boolean;
  /** API-only — no browser login. Click navigates to Settings → API-Anbindungen. */
  apiOnly?: boolean;
  /** Short hint shown next to the login row. */
  hint: string;
  /**
   * High-risk marketplace where automation is aggressively detected.
   * Shows a warning chip and a stronger disclaimer in the UI.
   */
  risk?: 'high' | 'medium';
  /** Inline tooltip for the auth mode shown on hover. */
  authNote?: string;
}

export const MARKETPLACE_LOGINS: MarketplaceLoginEntry[] = [
  {
    id: 'vinted',
    label: 'Vinted',
    emoji: '👗',
    loginPath: '/accounts/{id}/login',
    hint: 'Login mit E-Mail/Passwort (+SMS-Code). Session hält ~2–4 Wochen.',
  },
  {
    id: 'kleinanzeigen',
    label: 'Kleinanzeigen',
    emoji: '🏷️',
    loginPath: '/bot/kleinanzeigen/login?account={id}',
    hint: 'Login mit E-Mail/Passwort. Cookie-Session wird gespeichert.',
  },
  {
    id: 'depop',
    label: 'Depop',
    emoji: '🛍️',
    loginPath: '/bot/depop/login?account={id}',
    cloudflare: true,
    hint: 'Login über Apple/Google oder E-Mail/Passwort. ☁ Cloudflare — Turnstile lösen.',
    authNote: 'Cloudflare — bei Turnstile bitte solven',
  },
  {
    id: 'mercari',
    label: 'Mercari',
    emoji: '🇺🇸',
    loginPath: '/bot/mercari/login?account={id}',
    hint: 'Login mit US-Account (E-Mail/Passwort).',
  },
  {
    id: 'wallapop',
    label: 'Wallapop',
    emoji: '🇪🇸',
    loginPath: '/bot/wallapop/login?account={id}',
    hint: 'Login mit Wallapop-Account (E-Mail/Passwort).',
  },
  {
    id: 'ebay_de',
    label: 'eBay DE',
    emoji: '🛒',
    loginPath: '/settings#api-auth',
    apiOnly: true,
    hint: 'OAuth-Token (Client-ID + Secret + Refresh-Token) statt Browser-Login. Klick → API-Anbindungen.',
    authNote: 'OAuth — Refresh-Token via developer.ebay.com → API-Anbindungen',
  },
  {
    id: 'ebay_uk',
    label: 'eBay UK',
    emoji: '🇬🇧',
    loginPath: '/settings#api-auth',
    apiOnly: true,
    hint: 'OAuth — UK Marketplace, separater Refresh-Token. Klick → API-Anbindungen.',
    authNote: 'OAuth UK — separater Token unter API-Anbindungen',
  },
  {
    id: 'etsy',
    label: 'Etsy',
    emoji: '🎨',
    loginPath: '/bot/etsy/login?account={id}',
    hint: 'Login mit Etsy-Account.',
  },
  {
    id: 'grailed',
    label: 'Grailed',
    emoji: '👔',
    loginPath: '/bot/grailed/login?account={id}',
    cloudflare: true,
    hint: 'Login mit Grailed-Account. ☁ Cloudflare-fronted.',
    authNote: 'Cloudflare-fronted',
  },
  {
    id: 'fb_marketplace',
    label: 'FB Marketplace',
    emoji: '📘',
    loginPath: '/bot/fb_marketplace/login?account={id}',
    risk: 'high',
    hint: 'FB blockiert aggressiv — oft SMS-2FA. Bann-Risiko. Eigener Account empfohlen.',
    authNote: 'HIGH-RISK — Meta bannt aggressiv, oft SMS-2FA',
  },
  {
    id: 'vestiaire',
    label: 'Vestiaire',
    emoji: '👜',
    loginPath: '/bot/vestiaire/login?account={id}',
    cloudflare: true,
    hint: 'Login mit Vestiaire Collective Account. ☁ Cloudflare-fronted.',
    authNote: 'Cloudflare-fronted',
  },
  {
    id: 'whatnot',
    label: 'Whatnot',
    emoji: '🎙️',
    loginPath: '/bot/whatnot/login?account={id}',
    hint: 'Live-Stream-Marketplace. Login mit Whatnot-Account.',
  },
  {
    id: 'poshmark',
    label: 'Poshmark',
    emoji: '👛',
    loginPath: '/bot/poshmark/login?account={id}',
    hint: 'US closet-style resale. Login mit Poshmark-Account.',
  },
  {
    id: 'leboncoin',
    label: 'Leboncoin',
    emoji: '🇫🇷',
    loginPath: '/bot/leboncoin/login?account={id}',
    cloudflare: true,
    hint: 'Französisch eBay-Klon. ☁ Cloudflare.',
    authNote: 'Cloudflare-fronted (FR)',
  },
  {
    id: 'marktplaats',
    label: 'Marktplaats',
    emoji: '🇳🇱',
    loginPath: '/bot/marktplaats/login?account={id}',
    hint: 'Niederländischer eBay-Klon (Adevinta-Familie).',
  },
  {
    id: 'willhaben',
    label: 'Willhaben',
    emoji: '🇦🇹',
    loginPath: '/bot/willhaben/login?account={id}',
    hint: 'Österreichischer Premium-Marktplatz.',
  },
  {
    id: 'shopify',
    label: 'Shopify',
    emoji: '🛒',
    loginPath: '/settings#api-auth',
    apiOnly: true,
    hint: 'API-Token (Custom App) statt Browser-Login. Klick → API-Anbindungen.',
    authNote: 'API-Token (Custom App) — kein Browser-Login',
  },
  {
    id: 'woocommerce',
    label: 'WooCommerce',
    emoji: '🛍️',
    loginPath: '/settings#api-auth',
    apiOnly: true,
    hint: 'Consumer Key/Secret statt Browser-Login. Klick → API-Anbindungen.',
    authNote: 'Consumer Key/Secret — kein Browser-Login',
  },
];

/** Lookup by id — returns undefined if not in catalog. */
export function findLogin(id: string): MarketplaceLoginEntry | undefined {
  return MARKETPLACE_LOGINS.find((m) => m.id === id);
}
