// ──────────────────────────────────────────────────────────────────────────────
// Conversion-Tracker Worker
//
// Nightly job: recompute `variant_conversion_stats` for every variant row.
// First run happens ~1h after boot so existing data populates without
// blocking startup. Then every 24h.
//
// Surfaces a Top-5 log per marketplace so the operator can spot which
// variant patterns are converting best. The variant-generator reads the
// same data on its own ticks via getTopVariants() and prepends them to
// the LLM prompt as exemplars.
// ──────────────────────────────────────────────────────────────────────────────

import {
  createLogger,
  isPaused,
  withLock,
  markWorkerAlive,
  recomputeAllVariantStats,
  getTopVariants,
} from '@vinted-system/shared';

const log = createLogger('conversion-tracker');

const POLL_INTERVAL_MS = 24 * 60 * 60 * 1000;   // 24h
const FIRST_RUN_DELAY_MS = 60 * 60 * 1000;       // 1h after boot

const MARKETPLACES_TO_REPORT = [
  'vinted', 'kleinanzeigen', 'ebay_de', 'depop', 'mercari',
  'wallapop', 'etsy', 'grailed', 'vestiaire', 'whatnot', 'fb_marketplace',
];

let timer: ReturnType<typeof setInterval> | null = null;
let firstTimer: ReturnType<typeof setTimeout> | null = null;

async function tickInner(): Promise<void> {
  const start = Date.now();
  log.info('Recomputing variant conversion stats…');
  const touched = recomputeAllVariantStats();
  log.info('Stats refresh complete', {
    touched, durationMs: Date.now() - start,
  });

  for (const mp of MARKETPLACES_TO_REPORT) {
    const top = getTopVariants(mp, 5);
    if (top.length === 0) continue;
    log.info(`Top-${top.length} ${mp}`, {
      variants: top.map(v => ({
        id: v.variant_id,
        sales: v.total_sales,
        listings: v.listings_count,
        conv: v.conversion_rate,
        msgRate: v.message_rate,
      })),
    });
  }
  markWorkerAlive('conversion-tracker');
}

async function tick(): Promise<void> {
  if (isPaused()) return;
  await withLock('conversion-tracker-tick', 1800, tickInner);
}

export function startConversionTracker(): void {
  if (timer) return;
  log.info('Conversion-Tracker started', {
    firstRunMs: FIRST_RUN_DELAY_MS,
    intervalMs: POLL_INTERVAL_MS,
  });
  firstTimer = setTimeout(() => { void tick(); }, FIRST_RUN_DELAY_MS);
  timer = setInterval(() => { void tick(); }, POLL_INTERVAL_MS);
}

export function stopConversionTracker(): void {
  if (firstTimer) { clearTimeout(firstTimer); firstTimer = null; }
  if (timer) {
    clearInterval(timer);
    timer = null;
    log.info('Conversion-Tracker stopped');
  }
}

export const _internal = { tickInner };
