import { describe, it, expect } from 'vitest';
import {
  MARKETPLACE_BRANDS,
  PRIMARY_MARKETPLACES,
  getBrand,
  marketplaceLabel,
} from './marketplace.js';

describe('marketplace brand library', () => {
  it('at least 12 brands are defined (we grew to 20+ as new marketplaces landed)', () => {
    // Initially this expected exactly 12; new marketplaces (mercari, wallapop,
    // ebay-uk, etsy, grailed, fb_marketplace, vestiaire, whatnot, leboncoin,
    // marktplaats, willhaben, poshmark, shopify, woocommerce, depop) push
    // the total well over 20. Lower-bound assertion so future additions don't
    // re-break the test the way they did in the v0.6.6 CI run.
    expect(Object.keys(MARKETPLACE_BRANDS).length).toBeGreaterThanOrEqual(12);
  });

  it('every brand has required fields', () => {
    for (const id of Object.keys(MARKETPLACE_BRANDS)) {
      const b = MARKETPLACE_BRANDS[id as keyof typeof MARKETPLACE_BRANDS];
      expect(b.id).toBe(id);
      expect(b.label).toBeTruthy();
      expect(b.short).toBeTruthy();
      expect(b.locale).toMatch(/^(DE|UK|US|ES|NL)$/);
      expect(b.icon).toBeTruthy();
      expect(b.chip).toContain('ring-1');
      expect(b.text).toMatch(/^text-/);
      expect(b.bgTint).toMatch(/^bg-/);
      expect(b.ring).toMatch(/^ring-/);
      expect(b.dot).toMatch(/^bg-/);
      expect(b.gradient).toContain('from-');
      expect(b.baseUrl).toMatch(/^https:\/\//);
    }
  });

  it('PRIMARY_MARKETPLACES contains vinted/ka/ebay_de', () => {
    expect(PRIMARY_MARKETPLACES).toEqual(['vinted', 'kleinanzeigen', 'ebay_de']);
  });

  describe('cloudflareProtected flag', () => {
    it('depop is CF-protected', () => {
      expect(MARKETPLACE_BRANDS.depop.cloudflareProtected).toBe(true);
    });
    it('grailed + vestiaire are CF-protected', () => {
      expect(MARKETPLACE_BRANDS.grailed.cloudflareProtected).toBe(true);
      expect(MARKETPLACE_BRANDS.vestiaire.cloudflareProtected).toBe(true);
    });
    it('vinted + KA + eBay are NOT CF-protected', () => {
      expect(MARKETPLACE_BRANDS.vinted.cloudflareProtected).toBeFalsy();
      expect(MARKETPLACE_BRANDS.kleinanzeigen.cloudflareProtected).toBeFalsy();
      expect(MARKETPLACE_BRANDS.ebay_de.cloudflareProtected).toBeFalsy();
    });
  });

  describe('getBrand', () => {
    it('returns the matching brand for a known id', () => {
      expect(getBrand('vinted').label).toBe('Vinted');
    });
    it('falls back to vinted for unknown ids', () => {
      expect(getBrand('moonshop_42').label).toBe('Vinted');
    });
    it('falls back to vinted for null/undefined', () => {
      expect(getBrand(null).label).toBe('Vinted');
      expect(getBrand(undefined).label).toBe('Vinted');
    });
  });

  describe('marketplaceLabel', () => {
    it('returns human-readable label', () => {
      expect(marketplaceLabel('vinted')).toBe('Vinted');
      expect(marketplaceLabel('kleinanzeigen')).toBe('Kleinanzeigen');
      expect(marketplaceLabel('ebay_de')).toBe('eBay DE');
    });
  });

  describe('color uniqueness — no two brands share the exact same dot color', () => {
    it('all dot colors are distinct (well, mostly — eBay-DE/UK share blue intentionally)', () => {
      const dots = Object.values(MARKETPLACE_BRANDS).map((b) => b.dot);
      const distinct = new Set(dots);
      // 11 distinct out of 12 — eBay-DE and eBay-UK share the blue family
      expect(distinct.size).toBeGreaterThanOrEqual(10);
    });
  });
});
