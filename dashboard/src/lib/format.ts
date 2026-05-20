// ──────────────────────────────────────────────────────────────────────────────
// Formatting helpers — single source of truth for currency, numbers and dates
// across the dashboard. Using Intl directly everywhere produces inconsistent
// output (some places use de-DE, others fall back to en-US). Centralise here.
// ──────────────────────────────────────────────────────────────────────────────

const EUR = new Intl.NumberFormat('de-DE', {
  style: 'currency',
  currency: 'EUR',
  maximumFractionDigits: 2,
});

const EUR_COMPACT = new Intl.NumberFormat('de-DE', {
  style: 'currency',
  currency: 'EUR',
  notation: 'compact',
  maximumFractionDigits: 1,
});

const NUM = new Intl.NumberFormat('de-DE');

const DATE_SHORT = new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit' });
const TIME_HM    = new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit' });
const DATETIME   = new Intl.DateTimeFormat('de-DE', {
  day: '2-digit', month: '2-digit', year: '2-digit',
  hour: '2-digit', minute: '2-digit',
});

export function fmtEur(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return EUR.format(value);
}

export function fmtEurCompact(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  if (Math.abs(value) < 1000) return EUR.format(value);
  return EUR_COMPACT.format(value);
}

export function fmtNum(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return NUM.format(value);
}

export function fmtPct(value: number | null | undefined, opts: { digits?: number } = {}): string {
  if (value == null || !Number.isFinite(value)) return '—';
  const digits = opts.digits ?? 1;
  // Use Intl so the decimal separator matches de-DE (comma, not point).
  const fmt = new Intl.NumberFormat('de-DE', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  return `${fmt.format(value)} %`;
}

export function fmtDate(input: string | Date | null | undefined): string {
  if (!input) return '—';
  try { return DATE_SHORT.format(new Date(input)); } catch { return String(input); }
}

export function fmtTime(input: string | Date | null | undefined): string {
  if (!input) return '—';
  try { return TIME_HM.format(new Date(input)); } catch { return String(input); }
}

export function fmtDateTime(input: string | Date | null | undefined): string {
  if (!input) return '—';
  try { return DATETIME.format(new Date(input)); } catch { return String(input); }
}

/** "vor 3 min", "vor 2 h", "vor 4 d". German relative time. */
export function fmtRelative(input: string | Date | null | undefined, now: Date = new Date()): string {
  if (!input) return '—';
  const d = new Date(input);
  if (Number.isNaN(d.getTime())) return '—';
  const diff = (now.getTime() - d.getTime()) / 1000;
  if (diff < 30) return 'gerade eben';
  if (diff < 90) return 'vor 1 min';
  if (diff < 3600) return `vor ${Math.floor(diff / 60)} min`;
  if (diff < 7200) return 'vor 1 h';
  if (diff < 86_400) return `vor ${Math.floor(diff / 3600)} h`;
  if (diff < 172_800) return 'gestern';
  if (diff < 7 * 86_400) return `vor ${Math.floor(diff / 86_400)} d`;
  return fmtDate(d);
}
