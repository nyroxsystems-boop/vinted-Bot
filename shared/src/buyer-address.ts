// ──────────────────────────────────────────────────────────────────────────────
// Buyer address validator
//
// CJ Dropshipping rejects orders with empty/malformed addresses, but our
// best-effort Vinted parser sometimes produces incomplete output. This module
// validates before we hand an address to CJ — much better than a 48h stuck
// alert because the order was placed with `zip=''`.
// ──────────────────────────────────────────────────────────────────────────────

export interface BuyerAddressLike {
  name?: string;
  street?: string;
  city?: string;
  zip?: string;
  country?: string;
  phone?: string;
}

const ZIP_BY_COUNTRY: Record<string, RegExp> = {
  DE: /^\d{5}$/,
  AT: /^\d{4}$/,
  CH: /^\d{4}$/,
  FR: /^\d{5}$/,
  IT: /^\d{5}$/,
  ES: /^\d{5}$/,
  NL: /^\d{4}\s?[A-Z]{2}$/i,
  BE: /^\d{4}$/,
  LU: /^\d{4}$/,
  PL: /^\d{2}-\d{3}$/,
  CZ: /^\d{3}\s?\d{2}$/,
  DK: /^\d{4}$/,
  SE: /^\d{3}\s?\d{2}$/,
  UK: /^[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2}$/i,
  GB: /^[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2}$/i,
};

/** Returns null if the address is shippable, else a human-readable reason. */
export function validateBuyerAddress(addr: BuyerAddressLike): string | null {
  const name = (addr.name ?? '').trim();
  const street = (addr.street ?? '').trim();
  const city = (addr.city ?? '').trim();
  const zip = (addr.zip ?? '').trim();
  const country = (addr.country ?? 'DE').trim().toUpperCase();

  if (name.length < 2) return 'Buyer name missing';
  if (street.length < 3) return 'Street missing or too short';
  // Most German Vinted addresses look like "Straße 12" — require a digit.
  if (!/\d/.test(street)) return 'Street has no house number';
  if (city.length < 2) return 'City missing';
  if (!zip) return 'ZIP missing';

  const zipRe = ZIP_BY_COUNTRY[country];
  if (zipRe && !zipRe.test(zip)) {
    return `ZIP "${zip}" doesn't match ${country} format`;
  }
  if (country.length !== 2) return `Country code "${country}" not ISO-2`;

  return null;
}

/** Tolerant German-style "Straße 12\n12345 Stadt\nLand" parser. Returns partial result. */
export function parseGermanAddress(raw: string, fallbackName: string): BuyerAddressLike {
  const lines = (raw ?? '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return { name: fallbackName, country: 'DE' };

  let nameLine = '';
  let streetLine = '';
  let zipCityLine = '';
  let countryLine = '';

  // If first line looks like a name (no digits, no comma), accept it as name.
  const l0 = lines[0] ?? '';
  if (lines.length >= 3 && !/\d/.test(l0)) {
    nameLine = l0;
    streetLine = lines[1] ?? '';
    zipCityLine = lines[2] ?? '';
    countryLine = lines[3] ?? 'DE';
  } else {
    streetLine = lines[0] ?? '';
    zipCityLine = lines[1] ?? '';
    countryLine = lines[2] ?? 'DE';
  }

  // ZIP-City: try DE (5-digit) first, then NL (4-digit + 2-letter), generic fallback.
  let zip = '';
  let city = zipCityLine;
  const deMatch = zipCityLine.match(/^(\d{4,5})\s+(.+)$/);
  if (deMatch && deMatch[1] && deMatch[2]) {
    zip = deMatch[1]; city = deMatch[2];
  } else {
    const nlMatch = zipCityLine.match(/^(\d{4}\s?[A-Z]{2})\s+(.+)$/i);
    if (nlMatch && nlMatch[1] && nlMatch[2]) {
      zip = nlMatch[1].toUpperCase(); city = nlMatch[2];
    }
  }

  const country = countryLine.length === 2 ? countryLine.toUpperCase() : 'DE';

  return {
    name: nameLine || fallbackName,
    street: streetLine,
    city,
    zip,
    country,
  };
}
