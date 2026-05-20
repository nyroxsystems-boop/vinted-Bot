// ──────────────────────────────────────────────────────────────────────────────
// Proxy-Health-Monitor
//
// At 20 active accounts each on its own residential proxy, a silently dead
// proxy translates into: the bot keeps trying to publish, every request
// times out, the account looks "stuck", and we waste hours before noticing.
//
// This worker probes every account that has a `proxy_url` configured every
// 10 minutes and records a `proxy_down` health-event when the probe fails.
// Account-Health (see `shared/src/account-health.ts`) decides what to do
// with that — auto-pause, surface in dashboard, etc.
//
// We don't use a heavyweight Playwright browser for this — too slow at
// 20×proxies. Instead we do an HTTP CONNECT through the proxy followed by
// a one-line GET request to ipify, all over a single Node `net.Socket`.
// This works for the standard `http://user:pass@host:port` residential
// proxies the system supports without pulling in a new dependency.
// ──────────────────────────────────────────────────────────────────────────────

import net from 'node:net';
import tls from 'node:tls';
import {
  createLogger,
  getDb,
  isPaused,
  markWorkerAlive,
  parseProxyUrl,
  recordHealthEvent,
  withLock,
} from '@vinted-system/shared';

const log = createLogger('proxy-health');

let timer: ReturnType<typeof setInterval> | null = null;
const INTERVAL_MS = 10 * 60 * 1000;     // 10 minutes
const PROBE_TIMEOUT_MS = 15_000;        // per-account probe

// Probe target — small payload, allows comparing egress IP if we want later.
const PROBE_HOST = 'api.ipify.org';
const PROBE_PATH = '/?format=text';

interface ProbeResult {
  ok: boolean;
  detail: string;
}

/** HTTP CONNECT through the proxy, then HTTPS GET to api.ipify.org. */
function probeProxy(proxyUrl: string): Promise<ProbeResult> {
  return new Promise((resolve) => {
    let settled = false;
    const done = (r: ProbeResult): void => {
      if (settled) return;
      settled = true;
      resolve(r);
    };

    // Parse the proxy URL into {server,username,password} — same parser the
    // browser-pool uses so the format expectations match. We then re-parse
    // `server` to peel off host/port for the raw socket.
    let server: string;
    let username: string | undefined;
    let password: string | undefined;
    try {
      const parsed = parseProxyUrl(proxyUrl, 'proxy-health');
      server = parsed.server;
      username = parsed.username;
      password = parsed.password;
    } catch (err) {
      done({ ok: false, detail: err instanceof Error ? err.message : String(err) });
      return;
    }

    let proxyHost: string;
    let proxyPort: number;
    try {
      const u = new URL(server);
      proxyHost = u.hostname;
      proxyPort = Number(u.port || (u.protocol === 'https:' ? 443 : 80));
    } catch (err) {
      done({ ok: false, detail: `bad proxy URL: ${err instanceof Error ? err.message : String(err)}` });
      return;
    }

    const sock = net.createConnection({ host: proxyHost, port: proxyPort });

    const onTimeout = (): void => {
      try { sock.destroy(); } catch { /* ignore */ }
      done({ ok: false, detail: `timeout after ${PROBE_TIMEOUT_MS}ms` });
    };
    sock.setTimeout(PROBE_TIMEOUT_MS, onTimeout);

    sock.once('error', (err) => done({ ok: false, detail: err.message }));

    sock.once('connect', () => {
      // Send HTTP CONNECT to set up a tunnel to api.ipify.org:443.
      const authHeader = username
        ? `Proxy-Authorization: Basic ${Buffer.from(`${username}:${password ?? ''}`).toString('base64')}\r\n`
        : '';
      const connectReq =
        `CONNECT ${PROBE_HOST}:443 HTTP/1.1\r\n` +
        `Host: ${PROBE_HOST}:443\r\n` +
        authHeader +
        `Proxy-Connection: close\r\n` +
        `\r\n`;
      sock.write(connectReq);

      // Read CONNECT response — proxy answers with "HTTP/1.1 200 …" before
      // the tunnel opens. Buffer until we see the header terminator.
      let connectBuf = Buffer.alloc(0);
      const onData = (chunk: Buffer): void => {
        connectBuf = Buffer.concat([connectBuf, chunk]);
        const headerEnd = connectBuf.indexOf('\r\n\r\n');
        if (headerEnd === -1) return;
        sock.off('data', onData);

        const header = connectBuf.subarray(0, headerEnd).toString('utf-8');
        const statusLine = header.split('\r\n', 1)[0] ?? '';
        const m = statusLine.match(/^HTTP\/\d\.\d\s+(\d+)/);
        const status = m ? Number(m[1]) : 0;
        if (status < 200 || status >= 300) {
          done({ ok: false, detail: `CONNECT failed: ${statusLine.slice(0, 80)}` });
          try { sock.destroy(); } catch { /* ignore */ }
          return;
        }

        // CONNECT succeeded → upgrade the socket to TLS and send the GET.
        const tlsSock = tls.connect({
          socket: sock,
          servername: PROBE_HOST,
        });
        tlsSock.setTimeout(PROBE_TIMEOUT_MS, () => {
          try { tlsSock.destroy(); } catch { /* ignore */ }
          done({ ok: false, detail: 'tls timeout' });
        });
        tlsSock.once('error', (err) => done({ ok: false, detail: `tls: ${err.message}` }));
        tlsSock.once('secureConnect', () => {
          tlsSock.write(
            `GET ${PROBE_PATH} HTTP/1.1\r\n` +
            `Host: ${PROBE_HOST}\r\n` +
            `User-Agent: vinted-system-proxy-health/1\r\n` +
            `Accept: */*\r\n` +
            `Connection: close\r\n` +
            `\r\n`,
          );
        });
        let bodyBuf = Buffer.alloc(0);
        tlsSock.on('data', (chunk) => { bodyBuf = Buffer.concat([bodyBuf, chunk]); });
        tlsSock.once('end', () => {
          const all = bodyBuf.toString('utf-8');
          const firstLine = all.split('\r\n', 1)[0] ?? '';
          const sm = firstLine.match(/^HTTP\/\d\.\d\s+(\d+)/);
          const httpStatus = sm ? Number(sm[1]) : 0;
          if (httpStatus >= 200 && httpStatus < 400) {
            // Body lives after the blank line. Trim chunked-encoding bytes
            // if present — we only care that we got *something* through.
            const bodyStart = all.indexOf('\r\n\r\n');
            const body = bodyStart >= 0 ? all.slice(bodyStart + 4) : '';
            // Pull what looks like an IPv4 / IPv6 token out, otherwise "ok"
            const ipMatch = body.match(/\b\d{1,3}(?:\.\d{1,3}){3}\b|[0-9a-fA-F:]{3,}/);
            done({ ok: true, detail: ipMatch ? ipMatch[0] : 'ok' });
          } else {
            done({ ok: false, detail: `probe HTTP ${httpStatus}` });
          }
        });
      };
      sock.on('data', onData);
    });
  });
}

interface AccountWithProxy {
  id: number;
  label: string;
  proxy_url: string;
}

function listAccountsWithProxy(): AccountWithProxy[] {
  return getDb()
    .prepare(
      `SELECT id, label, proxy_url
         FROM vinted_accounts
        WHERE active = 1
          AND proxy_url IS NOT NULL
          AND TRIM(proxy_url) <> ''`,
    )
    .all() as AccountWithProxy[];
}

async function tickInner(): Promise<void> {
  const accounts = listAccountsWithProxy();
  if (accounts.length === 0) {
    log.debug('No accounts with proxy_url — skipping probe cycle');
    return;
  }

  let okCount = 0;
  let downCount = 0;
  for (const acc of accounts) {
    try {
      const result = await probeProxy(acc.proxy_url);
      if (result.ok) {
        log.debug('proxy ok', { accountId: acc.id, label: acc.label, detail: result.detail });
        okCount++;
        // Don't spam `proxy_ok` events — we only care about transitions to-bad.
      } else {
        log.warn('proxy down', { accountId: acc.id, label: acc.label, detail: result.detail });
        try {
          recordHealthEvent(
            acc.id,
            'proxy_down',
            'critical',
            `Proxy unreachable: ${result.detail}`,
            { proxy_url_host: maskProxy(acc.proxy_url) },
          );
        } catch (err) {
          // Fallback: agent-E's helper missing for some reason — write raw SQL.
          try {
            getDb()
              .prepare(
                `INSERT INTO account_health_events (account_id, event_type, severity, message)
                 VALUES (?, 'proxy_down', 'critical', ?)`,
              )
              .run(acc.id, `Proxy unreachable: ${result.detail}`);
          } catch (e2) {
            log.warn('Failed to record health event', { err: e2 instanceof Error ? e2.message : String(e2) });
          }
        }
        downCount++;
      }
    } catch (err) {
      log.warn('probe error', { accountId: acc.id, err: err instanceof Error ? err.message : String(err) });
    }
  }

  log.info('proxy-health cycle complete', { total: accounts.length, ok: okCount, down: downCount });
}

function maskProxy(url: string): string {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.hostname}:${u.port || (u.protocol === 'https:' ? '443' : '80')}`;
  } catch {
    return '***';
  }
}

async function tick(): Promise<void> {
  if (isPaused()) return;
  try {
    await withLock('proxy-health-tick', 240, tickInner);
  } catch (err) {
    log.warn('tick failed', { err: err instanceof Error ? err.message : String(err) });
  } finally {
    markWorkerAlive('proxy-health-monitor');
  }
}

export function startProxyHealthMonitor(): void {
  if (timer) return;
  log.info('proxy-health-monitor started', { intervalMs: INTERVAL_MS });
  // Delay first tick so it doesn't run on the same second as everything else
  // during a boot stampede.
  setTimeout(() => void tick(), 45_000);
  timer = setInterval(() => void tick(), INTERVAL_MS);
}

export function stopProxyHealthMonitor(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
    log.info('proxy-health-monitor stopped');
  }
}
