// ──────────────────────────────────────────────────────────────────────────────
// Telemetry / Crash-Reporting Adapter
//
// Wraps the (eventually) Sentry SDK behind a Sentry-compatible-but-Sentry-free
// fallback. When `VITE_SENTRY_DSN` is set, we lazy-load `@sentry/browser` and
// initialise it. Otherwise we just log to console and POST to a local
// `/api/diagnostics/report-error` endpoint (best-effort, never throws).
//
// Pattern:
//   reportError(err, { context: 'license-activate', extra: { key } })
//
// React error boundaries call this; window onerror / unhandledrejection too.
// ──────────────────────────────────────────────────────────────────────────────

interface ReportOptions {
  context?: string;
  /** Extra structured data — DO NOT include user credentials. */
  extra?: Record<string, unknown>;
  /** 'info'|'warning'|'error'|'fatal' — default 'error' */
  level?: 'info' | 'warning' | 'error' | 'fatal';
}

let sentryReady = false;
let sentryAvailable = false;

async function lazyInitSentry(dsn: string): Promise<void> {
  if (sentryReady) return;
  try {
    // Dynamic import so users without Sentry don't pull the SDK.
    // String-variable form avoids the TS module-resolution check.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sentryModule = '@sentry/browser';
    // @ts-ignore — optional peer dep, may not be installed
    const Sentry = await import(/* @vite-ignore */ sentryModule).catch(() => null) as any;
    if (!Sentry) return;
    Sentry.init({
      dsn,
      tracesSampleRate: 0,  // performance off, only errors
      environment: import.meta.env.MODE,
      release: 'blackruby@0.5.0',
      autoSessionTracking: false,
      beforeSend(event: unknown, _hint: unknown) {
        // Scrub anything that looks like a license key or PII
        try {
          const ev = event as { message?: string; extra?: Record<string, unknown> };
          if (ev.message) ev.message = ev.message.replace(/BRBY(-[0-9A-Z]{4}){5}/g, 'BRBY-REDACTED');
          if (ev.extra?.key) ev.extra.key = 'REDACTED';
        } catch { /* */ }
        return event;
      },
    });
    sentryReady = true;
    sentryAvailable = true;
  } catch {
    sentryAvailable = false;
  }
}

const DSN = import.meta.env.VITE_SENTRY_DSN as string | undefined;
if (DSN) void lazyInitSentry(DSN);

export function reportError(err: unknown, opts: ReportOptions = {}): void {
  const message = err instanceof Error ? err.message : String(err);
  const stack = err instanceof Error ? err.stack : undefined;

  // Always log to console for local debugging
  // eslint-disable-next-line no-console
  console.error(`[telemetry] ${opts.context ?? 'unknown'}:`, message, opts.extra ?? {});

  if (sentryAvailable) {
    try {
      const sentryModule = '@sentry/browser';
      // @ts-ignore — optional peer dep, may not be installed
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      import(/* @vite-ignore */ sentryModule).then((S: any) => {
        S.captureException(err instanceof Error ? err : new Error(message), {
          level: opts.level ?? 'error',
          tags: { context: opts.context ?? 'unknown' },
          extra: opts.extra ?? {},
        });
      }).catch(() => undefined);
    } catch { /* */ }
  }

  // Best-effort POST to local diagnostics — never throws
  try {
    void fetch('/api/diagnostics/report-error', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message,
        stack,
        context: opts.context,
        extra: opts.extra,
        level: opts.level ?? 'error',
        ts: new Date().toISOString(),
        url: window.location.href,
        version: '0.5.0',
      }),
    }).catch(() => undefined);
  } catch { /* */ }
}

/** Install global handlers so unexpected errors / rejections get captured. */
export function installGlobalCrashHandlers(): void {
  if (typeof window === 'undefined') return;

  window.addEventListener('error', (e) => {
    reportError(e.error ?? new Error(e.message), {
      context: 'window.onerror',
      extra: { filename: e.filename, lineno: e.lineno, colno: e.colno },
    });
  });

  window.addEventListener('unhandledrejection', (e) => {
    reportError(e.reason, { context: 'unhandledrejection' });
  });
}
