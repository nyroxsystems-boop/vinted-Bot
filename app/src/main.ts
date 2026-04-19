// ──────────────────────────────────────────────────────────────────────────────
// Services-Konsole Frontend
//
// Listens for Rust-side service lifecycle events and renders:
//   • sidebar with per-service status dots
//   • main panel with live log stream for the selected service
//   • buttons: restart all, open dashboard, clear / filter logs
// ──────────────────────────────────────────────────────────────────────────────

import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';

type ServiceName = 'orchestrator' | 'vinted-bot' | 'temu-bot' | 'dashboard';
type ServiceState = 'starting' | 'running' | 'exited' | 'failed';

interface StatusPayload {
  service: ServiceName;
  state: ServiceState;
  pid: number | null;
  exit_code: number | null;
  http_url?: string | null;
}

interface LogPayload {
  service: ServiceName;
  stream: 'stdout' | 'stderr';
  line: string;
  ts: string;
}

interface ServiceState_ {
  name: ServiceName;
  state: ServiceState;
  pid: number | null;
  exitCode: number | null;
  httpUrl: string | null;
  logs: LogPayload[];
}

const SERVICES: ServiceName[] = ['orchestrator', 'vinted-bot', 'temu-bot', 'dashboard'];
const MAX_LOG_LINES = 2000;

const state: Record<ServiceName, ServiceState_> = Object.fromEntries(
  SERVICES.map((s) => [
    s,
    { name: s, state: 'starting', pid: null, exitCode: null, httpUrl: null, logs: [] } as ServiceState_,
  ]),
) as unknown as Record<ServiceName, ServiceState_>;

let activeService: ServiceName | 'all' = 'all';
let filterErrorsOnly = false;

// ── DOM ───────────────────────────────────────────────────────────────────────
const $services = document.getElementById('services')!;
const $logs = document.getElementById('logs')!;
const $logsTitle = document.getElementById('logs-title')!;
const $summary = document.getElementById('summary')!;
const $btnDashboard = document.getElementById('btn-open-dashboard') as HTMLButtonElement;
const $btnRestartAll = document.getElementById('btn-restart-all') as HTMLButtonElement;
const $btnFilterAll = document.getElementById('btn-filter-all') as HTMLButtonElement;
const $btnFilterErr = document.getElementById('btn-filter-err') as HTMLButtonElement;
const $btnClear = document.getElementById('btn-clear') as HTMLButtonElement;

// ── Rendering ─────────────────────────────────────────────────────────────────
function renderServices(): void {
  const rows = [
    { key: 'all' as const, label: 'Alle Services' },
    ...SERVICES.map((s) => ({ key: s, label: s })),
  ];
  $services.innerHTML = rows
    .map((r) => {
      if (r.key === 'all') {
        const running = SERVICES.filter((s) => state[s].state === 'running').length;
        return `
          <div class="service ${activeService === 'all' ? 'active' : ''}" data-service="all">
            <div class="title"><span class="dot running"></span> ${r.label}</div>
            <div class="meta">${running}/${SERVICES.length} laufen</div>
          </div>`;
      }
      const s = state[r.key as ServiceName];
      const stateCls = s.state;
      return `
        <div class="service ${activeService === r.key ? 'active' : ''}" data-service="${r.key}">
          <div class="title"><span class="dot ${stateCls}"></span> ${r.label}</div>
          <div class="meta">
            ${s.state}
            ${s.pid ? ` · pid ${s.pid}` : ''}
            ${s.httpUrl ? ` · <a href="${s.httpUrl}" target="_blank" style="color:inherit">${s.httpUrl.replace(/^https?:\/\//, '')}</a>` : ''}
            ${s.exitCode !== null ? ` · exit ${s.exitCode}` : ''}
          </div>
        </div>`;
    })
    .join('');

  $services.querySelectorAll('.service').forEach((el) => {
    el.addEventListener('click', () => {
      activeService = (el as HTMLElement).dataset.service as ServiceName | 'all';
      renderServices();
      renderLogs();
    });
  });
}

function renderLogs(): void {
  $logsTitle.textContent = activeService === 'all' ? 'Alle Logs' : `Logs: ${activeService}`;
  const all: LogPayload[] =
    activeService === 'all'
      ? SERVICES.flatMap((s) => state[s].logs).sort((a, b) => a.ts.localeCompare(b.ts))
      : state[activeService as ServiceName].logs;

  const filtered = filterErrorsOnly
    ? all.filter((l) => l.stream === 'stderr' || /error|exception|failed|warn/i.test(l.line))
    : all;

  if (filtered.length === 0) {
    $logs.innerHTML = '<div class="empty">Keine Logs (noch).</div>';
    return;
  }

  const near = nearBottom($logs);
  $logs.innerHTML = filtered
    .slice(-MAX_LOG_LINES)
    .map((l) => {
      const level = detectLevel(l);
      const tag = activeService === 'all' ? `<span class="ts">[${l.service}]</span>` : '';
      const time = l.ts.slice(11, 19);
      return `<div class="log-line ${level}"><span class="ts">${time}</span>${tag}${escapeHtml(l.line)}</div>`;
    })
    .join('');
  if (near) $logs.scrollTop = $logs.scrollHeight;
}

function renderSummary(): void {
  const running = SERVICES.filter((s) => state[s].state === 'running').length;
  const failed = SERVICES.filter((s) => state[s].state === 'failed').length;
  const parts: string[] = [`${running}/${SERVICES.length} laufen`];
  if (failed > 0) parts.push(`${failed} fehlgeschlagen`);
  $summary.textContent = parts.join(' · ');
  $btnDashboard.disabled = running < 2; // orchestrator + dashboard minimum
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function nearBottom(el: HTMLElement): boolean {
  return el.scrollHeight - el.scrollTop - el.clientHeight < 80;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c] ?? c));
}

function detectLevel(l: LogPayload): string {
  if (l.stream === 'stderr') return 'stderr';
  if (/\berror\b/i.test(l.line)) return 'error';
  if (/\bwarn/i.test(l.line)) return 'warn';
  if (/\binfo\b/i.test(l.line)) return 'info';
  return '';
}

// ── Events from Rust ─────────────────────────────────────────────────────────
listen<StatusPayload>('service-status', (e) => {
  const p = e.payload;
  const s = state[p.service];
  s.state = p.state;
  s.pid = p.pid;
  s.exitCode = p.exit_code;
  if (p.http_url !== undefined) s.httpUrl = p.http_url;
  renderServices();
  renderSummary();
});

listen<LogPayload>('service-log', (e) => {
  const s = state[e.payload.service];
  if (!s) return;
  s.logs.push(e.payload);
  if (s.logs.length > MAX_LOG_LINES * 2) s.logs.splice(0, s.logs.length - MAX_LOG_LINES);
  if (activeService === 'all' || activeService === e.payload.service) {
    renderLogs();
  }
});

// ── Buttons ──────────────────────────────────────────────────────────────────
$btnDashboard.addEventListener('click', async () => {
  await invoke('open_dashboard').catch((err) => {
    console.error('open_dashboard failed', err);
  });
});

$btnRestartAll.addEventListener('click', async () => {
  if (!confirm('Alle Services neu starten?')) return;
  for (const s of SERVICES) {
    await invoke('restart_service', { name: s }).catch(() => null);
  }
});

$btnFilterAll.addEventListener('click', () => {
  filterErrorsOnly = false;
  renderLogs();
});
$btnFilterErr.addEventListener('click', () => {
  filterErrorsOnly = true;
  renderLogs();
});
$btnClear.addEventListener('click', () => {
  if (activeService === 'all') SERVICES.forEach((s) => (state[s].logs = []));
  else state[activeService as ServiceName].logs = [];
  renderLogs();
});

// Initial render.
renderServices();
renderSummary();
