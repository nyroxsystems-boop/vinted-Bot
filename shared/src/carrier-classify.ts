// ──────────────────────────────────────────────────────────────────────────────
// Carrier Classification
//
// CJ returns a `logisticName` for every tracking-number it issues. When the
// package crosses the China→EU border CJ usually hands off to a local carrier
// (DHL, Hermes, DPD, …) — that hand-over moment is when the package becomes
// "looks like Privatverkauf" rather than "shipped from China".
//
// We classify each carrier name into one of three buckets so the fulfillment
// worker can decide whether to push the tracking number to the marketplace
// or hold it until a better one arrives.
//
//   `eu`       — local / final-mile carrier in the destination country.
//                Push to Vinted immediately — buyer sees a normal tracking.
//   `cn`       — Chinese / China-leaving carrier. Hold the number; wait
//                for hand-over to an EU carrier. Push only as fallback.
//   `unknown`  — name doesn't match either list. Treat as `cn` to be safe
//                (better to delay than to leak a Chinese-looking tracking).
//
// Matching is case-insensitive substring — CJ's names are messy ("DHL ePacket",
// "PostNL International Tracked", "China Post EMS-J", "CJPacket Std").
// Order matters: more specific names listed first.
// ──────────────────────────────────────────────────────────────────────────────

/** Local-/final-mile carriers in EU destinations. If any one of these names
 *  shows up in a tracking event, we treat the package as "in-country". */
const EU_CARRIERS = [
  // Germany
  'dhl', 'deutsche post', 'hermes', 'dpd', 'gls', 'ups deutschland',
  // Netherlands / Belgium / Luxembourg
  'postnl', 'post nl', 'bpost', 'b post',
  // UK
  'royal mail', 'parcelforce', 'evri', 'hermes uk', 'yodel',
  // France
  'colissimo', 'la poste', 'mondial relay', 'chronopost',
  // Austria / Switzerland
  'österreichische post', 'austrian post', 'die post', 'swiss post',
  // Spain / Italy
  'correos', 'poste italiane', 'sda',
  // Nordics
  'posten', 'postnord', 'bring',
  // Generic local
  'ups', 'fedex europe', 'tnt', 'aramex europe',
] as const;

/** Carriers that signal the package is still on the China→EU leg. We hold
 *  these numbers back from the marketplace as long as possible. */
const CN_CARRIERS = [
  'cjpacket', 'cj packet', 'cj logistics', 'cj-packet',
  'china post', 'china ems', 'china mail',
  'epacket', 'e-packet', 'e packet',
  'yunexpress', 'yun express',
  '4px', 'sf international', 'sfc-international',
  'yanwen', 'wnd',
  'sunyou', 'su express',
  'cainiao', 'tianhuixiangbao',
  // CJ private brand names
  'cj global', 'cj us special',
] as const;

export type CarrierBucket = 'eu' | 'cn' | 'unknown';

/**
 * Classify a CJ-reported `logisticName` into eu/cn/unknown.
 *
 * - Empty / null inputs return 'unknown'.
 * - CN match wins over EU when both substrings appear (e.g. "DHL eCommerce
 *   China") because the China leg is the one we're trying to hide.
 */
export function classifyCarrier(logisticName: string | null | undefined): CarrierBucket {
  if (!logisticName) return 'unknown';
  const n = logisticName.toLowerCase().trim();
  if (n.length === 0) return 'unknown';
  for (const c of CN_CARRIERS) if (n.includes(c)) return 'cn';
  for (const c of EU_CARRIERS) if (n.includes(c)) return 'eu';
  return 'unknown';
}

export interface TrackingClassification {
  bucket: CarrierBucket;
  /** True if the tracking number is safe to forward to the marketplace. */
  pushable: boolean;
  /** Human-readable reason in German for logs/UI. */
  reason: string;
}

/**
 * Decide whether a given tracking record is safe to push to the marketplace.
 * Takes the order's age into account so we don't hold tracking forever — at
 * `forcePushAfterDays` (default 9) we push whatever we've got rather than
 * incur Vinted's "kein Versand"-penalty after 14 days.
 */
export function classifyTracking(opts: {
  logisticName: string | null | undefined;
  orderAgeDays: number;
  forcePushAfterDays?: number;
  preferEu?: boolean;
}): TrackingClassification {
  const forcePushAfter = opts.forcePushAfterDays ?? 9;
  const preferEu = opts.preferEu ?? true;
  const bucket = classifyCarrier(opts.logisticName);

  if (bucket === 'eu') {
    return { bucket, pushable: true, reason: 'EU-Carrier erkannt — Tracking wird gepuscht' };
  }
  if (!preferEu) {
    return { bucket, pushable: true, reason: 'preferEu=false — Tracking wird sofort gepuscht' };
  }
  if (opts.orderAgeDays >= forcePushAfter) {
    return {
      bucket,
      pushable: true,
      reason: `Force-Push nach ${forcePushAfter} Tagen (${bucket}-Tracking) — Vinted-Frist sonst überschritten`,
    };
  }
  return {
    bucket,
    pushable: false,
    reason: bucket === 'cn'
      ? `China-Carrier (${opts.logisticName}) — warte auf EU-Übergabe`
      : `Unbekannter Carrier (${opts.logisticName}) — defensiv halten, warte auf klare EU-Übergabe`,
  };
}

/**
 * Scan a tracking history (multiple events from CJ) and return the most-recent
 * EU-carrier mention if any. Used when CJ reports one logistic-name on the
 * order level but the `trackDetails` history contains a hand-over event.
 *
 * Heuristic: any event whose `info` field mentions an EU-carrier substring
 * is treated as evidence the package has been handed over.
 */
export function findEuHandoverInHistory(
  trackDetails: Array<{ date: string; info: string }> | undefined | null,
): { date: string; info: string; carrier: string } | null {
  if (!trackDetails) return null;
  // Newest first — CJ's `trackDetails` is usually oldest first, so reverse.
  const reversed = [...trackDetails].reverse();
  for (const ev of reversed) {
    if (!ev.info) continue;
    const lower = ev.info.toLowerCase();
    for (const c of EU_CARRIERS) {
      if (lower.includes(c)) {
        // Skip false-positives where a CN-carrier is mentioned in the same line.
        const cnHit = CN_CARRIERS.find((cn) => lower.includes(cn));
        if (cnHit) continue;
        return { date: ev.date, info: ev.info, carrier: c };
      }
    }
  }
  return null;
}
