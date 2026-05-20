// ──────────────────────────────────────────────────────────────────────────────
// Marketplace Adapter — Plattform-übergreifende Abstraktion
//
// Jeder Plattform-Bot (vinted-bot, kleinanzeigen-bot, mercari-bot, ...)
// implementiert MarketplaceAdapter. Orchestrator + Dashboard sprechen nur
// noch gegen dieses Interface — neue Plattformen sind dann 1-Tages-Jobs.
// ──────────────────────────────────────────────────────────────────────────────

export type MarketplaceId =
  | 'vinted'
  | 'kleinanzeigen'
  | 'mercari'
  | 'depop'
  | 'wallapop'
  | 'ebay_de'
  | 'ebay_uk'
  | 'etsy'
  | 'grailed'
  | 'fb_marketplace'
  | 'poshmark'
  | 'vestiaire'
  | 'whatnot'
  | 'shopify'
  | 'woocommerce'
  | 'leboncoin'
  | 'marktplaats'
  | 'willhaben'
  | 'subito'
  | 'ricardo';

export interface MarketplaceMeta {
  id: MarketplaceId;
  label: string;
  baseUrl: string;
  port: number;
  /** Country/locale primary market */
  primaryLocale: string;
}

/** Universelles Listing-Schema. Adapter mappen auf plattform-spezifische Felder. */
export interface ListingDraft {
  folderNum: number;
  title: string;
  description: string;
  /** Universelle Kategorie als 'Damen > Kleider > Minikleider' — Adapter mappen. */
  category: string;
  brand: string;
  size: string;
  condition: string;
  colors: string[];
  material: string;
  priceEur: number;
  shipping: string;
  photos: string[]; // absolute paths
}

export interface PublishResult {
  ok: boolean;
  externalId?: string; // Listing-ID auf der Plattform
  externalUrl?: string;
  warnings?: string[];
  error?: string;
  /** Bei Captcha/Block: zur Diagnose. */
  blockedBy?: 'captcha' | 'login' | 'rate-limit' | 'selector-drift' | 'cloudflare' | 'unknown';
}

export interface DeactivateResult {
  ok: boolean;
  error?: string;
}

export interface UpdatePriceResult {
  ok: boolean;
  newPriceEur?: number;
  error?: string;
}

export interface OfferAction {
  externalOfferId: string;
  action: 'accept' | 'decline' | 'counter';
  counterPriceEur?: number;
}

/** Plattform-Adapter. Bots implementieren das, exposen über HTTP-Routes. */
export interface MarketplaceAdapter {
  meta: MarketplaceMeta;

  /** Login-Status prüfen ohne Voll-Login-Flow. */
  isAuthenticated(accountId: number): Promise<boolean>;

  /** Voll-Login (typischerweise headful, einmalig manuell). */
  login(accountId: number): Promise<{ ok: boolean; error?: string }>;

  /** Neues Listing erstellen. */
  publish(accountId: number, draft: ListingDraft): Promise<PublishResult>;

  /** Listing deaktivieren (z.B. nach Cross-Platform-Sale). */
  deactivate(accountId: number, externalId: string): Promise<DeactivateResult>;

  /** Preis nachträglich anpassen. */
  updatePrice(accountId: number, externalId: string, newPriceEur: number): Promise<UpdatePriceResult>;

  /** Optional: Offers verarbeiten. Nicht jede Plattform hat das. */
  handleOffer?(accountId: number, action: OfferAction): Promise<{ ok: boolean; error?: string }>;
}

export const MARKETPLACE_REGISTRY: Record<MarketplaceId, MarketplaceMeta> = {
  vinted: {
    id: 'vinted',
    label: 'Vinted',
    baseUrl: 'https://www.vinted.de',
    port: 4701,
    primaryLocale: 'de-DE',
  },
  kleinanzeigen: {
    id: 'kleinanzeigen',
    label: 'Kleinanzeigen',
    baseUrl: 'https://www.kleinanzeigen.de',
    port: 4703,
    primaryLocale: 'de-DE',
  },
  mercari: {
    id: 'mercari',
    label: 'Mercari',
    baseUrl: 'https://www.mercari.com',
    port: 4704,
    primaryLocale: 'en-US',
  },
  depop: {
    id: 'depop',
    label: 'Depop',
    baseUrl: 'https://www.depop.com',
    port: 4705,
    primaryLocale: 'en-GB',
  },
  wallapop: {
    id: 'wallapop',
    label: 'Wallapop',
    baseUrl: 'https://es.wallapop.com',
    port: 4706,
    primaryLocale: 'es-ES',
  },
  ebay_de: {
    id: 'ebay_de',
    label: 'eBay DE',
    baseUrl: 'https://www.ebay.de',
    port: 4707,
    primaryLocale: 'de-DE',
  },
  ebay_uk: {
    id: 'ebay_uk',
    label: 'eBay UK',
    baseUrl: 'https://www.ebay.co.uk',
    port: 4708,
    primaryLocale: 'en-GB',
  },
  etsy: {
    id: 'etsy',
    label: 'Etsy',
    baseUrl: 'https://www.etsy.com',
    port: 4709,
    primaryLocale: 'en-US',
  },
  grailed: {
    id: 'grailed',
    label: 'Grailed',
    baseUrl: 'https://www.grailed.com',
    port: 4710,
    primaryLocale: 'en-US',
  },
  fb_marketplace: {
    id: 'fb_marketplace',
    label: 'FB Marketplace',
    baseUrl: 'https://www.facebook.com/marketplace',
    port: 4711,
    primaryLocale: 'de-DE',
  },
  poshmark: {
    id: 'poshmark',
    label: 'Poshmark',
    baseUrl: 'https://poshmark.com',
    port: 0, // Extension-based
    primaryLocale: 'en-US',
  },
  vestiaire: {
    id: 'vestiaire',
    label: 'Vestiaire Collective',
    baseUrl: 'https://www.vestiairecollective.com',
    port: 4712,
    primaryLocale: 'en-GB',
  },
  whatnot: {
    id: 'whatnot',
    label: 'Whatnot',
    baseUrl: 'https://www.whatnot.com',
    port: 4713,
    primaryLocale: 'en-US',
  },
  shopify: {
    id: 'shopify',
    label: 'Shopify',
    baseUrl: '',
    port: 0, // API-based
    primaryLocale: 'en-US',
  },
  woocommerce: {
    id: 'woocommerce',
    label: 'WooCommerce',
    baseUrl: '',
    port: 0, // API-based
    primaryLocale: 'en-US',
  },
  leboncoin: {
    id: 'leboncoin',
    label: 'Leboncoin',
    baseUrl: 'https://www.leboncoin.fr',
    port: 4714,
    primaryLocale: 'fr-FR',
  },
  marktplaats: {
    id: 'marktplaats',
    label: 'Marktplaats',
    baseUrl: 'https://www.marktplaats.nl',
    port: 4715,
    primaryLocale: 'nl-NL',
  },
  willhaben: {
    id: 'willhaben',
    label: 'Willhaben',
    baseUrl: 'https://www.willhaben.at',
    port: 4716,
    primaryLocale: 'de-AT',
  },
  subito: {
    id: 'subito',
    label: 'Subito',
    baseUrl: 'https://www.subito.it',
    port: 4717,
    primaryLocale: 'it-IT',
  },
  ricardo: {
    id: 'ricardo',
    label: 'Ricardo',
    baseUrl: 'https://www.ricardo.ch',
    port: 4718,
    primaryLocale: 'de-CH',
  },
};
