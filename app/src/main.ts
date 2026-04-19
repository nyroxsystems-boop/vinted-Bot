// ──────────────────────────────────────────────────────────────────────────────
// Services-Konsole Frontend
//
// On mount:
//   1. Register listeners for live "service-status" / "service-log" events.
//   2. Invoke `frontend_ready` — Rust starts all services + returns snapshot.
//   3. Apply snapshot to local state (so we never miss early output).
// ──────────────────────────────────────────────────────────────────────────────

import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';

type ServiceName = 'orchestrator' | 'vinted-bot' | 'temu-bot' | 'dashboard' | 'supervisor';
type ServiceState = 'starting' | 'running' | 'exited' | 'failed';

interface StatusPayload {
  service: ServiceName;
  state: ServiceState;
  pid: number | null;
  exit_code: number | null;
  http_url: string | null;
}

interface LogPayload {
  service: ServiceName;
  stream: 'stdout' | 'stderr';
  line: string;
  ts: string;
}

interface InitialState {
  statuses: StatusPayload[];
  logs: LogPayload[];
  repo_root: string;
}

interface ServiceLocal {
  name: ServiceName;
  state: ServiceState;
  pid: number | null;
  exitCode: number | null;
  httpUrl: string | null;
  logs: LogPayload[];
}

const SERVICES: ServiceName[] = ['orchestrator', 'vinted-bot', 'temu-bot', 'dashboard'];
const MAX_LOG_LINES = 2000;

const state: Record<ServiceName, ServiceLocal> = {} as Record<ServiceName, ServiceLocal>;
for (const s of [...SERVICES, 'supervisor' as ServiceName]) {
  state[s] = {
    name: s,
    state: 'starting',
    pid: null,
    exitCode: null,
    httpUrl: null,
    logs: [],
  };
}

let activeService: ServiceName | 'all' = 'all';
let filterErrorsOnly = false;

// ── DOM ──────────────────────────────────────────────────────────────────────
const $services = document.getElementById('services')!;
const $logs = document.getElementById('logs')!;
const $logsTitle = document.getElementById('logs-title')!;
const $summary = document.getElementById('summary')!;
const $btnDashboard = document.getElementById('btn-open-dashboard') as HTMLButtonElement;
const $btnStartAll = document.getElementById('btn-start-all') as HTMLButtonElement;
const $btnStopAll = document.getElementById('btn-stop-all') as HTMLButtonElement;
const $btnRestartAll = document.getElementById('btn-restart-all') as HTMLButtonElement;
const $btnFilterAll = document.getElementById('btn-filter-all') as HTMLButtonElement;
const $btnFilterErr = document.getElementById('btn-filter-err') as HTMLButtonElement;
const $btnClear = document.getElementById('btn-clear') as HTMLButtonElement;

// ── Rendering ────────────────────────────────────────────────────────────────
function aggregateAllDot(): ServiceState {
  const s = SERVICES.map((n) => state[n].state);
  if (s.every((x) => x === 'running')) return 'running';
  if (s.some((x) => x === 'failed')) return 'failed';
  if (s.some((x) => x === 'starting')) return 'starting';
  return 'exited';
}

function renderServices(): void {
  const allDot = aggregateAllDot();
  const rows = [
    { key: 'all' as const, label: 'Alle Services', dot: allDot, meta: '' },
    ...SERVICES.map((s) => ({ key: s, label: s, dot: state[s].state, meta: '' })),
  ];
  $services.innerHTML = rows
    .map((r) => {
      if (r.key === 'all') {
        const running = SERVICES.filter((s) => state[s].state === 'running').length;
        return `
          <div class="service ${activeService === 'all' ? 'active' : ''}" data-service="all">
            <div class="title"><span class="dot ${r.dot}"></span> ${r.label}</div>
            <div class="meta">${running}/${SERVICES.length} laufen</div>
          </div>`;
      }
      const s = state[r.key as ServiceName];
      const canStart = s.state !== 'running' && s.state !== 'starting';
      const canStop = s.state === 'running' || s.state === 'starting';
      return `
        <div class="service ${activeService === r.key ? 'active' : ''}" data-service="${r.key}">
          <div class="title"><span class="dot ${s.state}"></span> ${r.label}</div>
          <div class="meta">
            ${s.state}
            ${s.pid ? ` · pid ${s.pid}` : ''}
            ${s.httpUrl ? ` · ${s.httpUrl.replace(/^https?:\/\//, '')}` : ''}
            ${s.exitCode !== null ? ` · exit ${s.exitCode}` : ''}
          </div>
          <div class="service-actions" data-actions="${r.key}">
            <button class="start" data-action="start" ${canStart ? '' : 'disabled'}>▶ Start</button>
            <button class="stop" data-action="stop" ${canStop ? '' : 'disabled'}>■ Stop</button>
            <button data-action="restart">↻ Restart</button>
          </div>
        </div>`;
    })
    .join('');

  $services.querySelectorAll('.service').forEach((el) => {
    el.addEventListener('click', (ev) => {
      // Action buttons: don't change activeService.
      const target = ev.target as HTMLElement;
      if (target.tagName === 'BUTTON' && target.dataset.action) {
        ev.stopPropagation();
        const serviceName = (el as HTMLElement).dataset.service as ServiceName | 'all';
        if (serviceName === 'all') return;
        const action = target.dataset.action;
        if (action === 'start') void invoke('start_service', { name: serviceName });
        if (action === 'stop') void invoke('stop_service', { name: serviceName });
        if (action === 'restart') void invoke('restart_service', { name: serviceName });
        return;
      }
      activeService = (el as HTMLElement).dataset.service as ServiceName | 'all';
      renderServices();
      renderLogs();
    });
  });
}

function renderLogs(): void {
  $logsTitle.textContent =
    activeService === 'all' ? 'Alle Logs' : `Logs: ${activeService}`;

  const all: LogPayload[] =
    activeService === 'all'
      ? [...SERVICES, 'supervisor' as ServiceName]
          .flatMap((s) => state[s].logs)
          .sort((a, b) => a.ts.localeCompare(b.ts))
      : state[activeService as ServiceName].logs;

  const filtered = filterErrorsOnly
    ? all.filter(
        (l) => l.stream === 'stderr' || /error|exception|failed|warn/i.test(l.line),
      )
    : all;

  if (filtered.length === 0) {
    $logs.innerHTML = '<div class="empty">Warte auf Log-Output…</div>';
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
  const anyStopped = SERVICES.some(
    (s) => state[s].state === 'exited' || state[s].state === 'failed' || state[s].state === 'unknown' as ServiceState,
  );
  const anyRunning = SERVICES.some(
    (s) => state[s].state === 'running' || state[s].state === 'starting',
  );
  const parts: string[] = [`${running}/${SERVICES.length} laufen`];
  if (failed > 0) parts.push(`${failed} fehlgeschlagen`);
  $summary.textContent = parts.join(' · ');
  $btnDashboard.disabled = running < 2;
  $btnStartAll.disabled = !anyStopped;
  $btnStopAll.disabled = !anyRunning;
  $btnRestartAll.disabled = !anyRunning;
}

function applyStatus(p: StatusPayload): void {
  const s = state[p.service];
  if (!s) return;
  s.state = p.state;
  s.pid = p.pid;
  s.exitCode = p.exit_code;
  if (p.http_url !== undefined) s.httpUrl = p.http_url;
}

function applyLog(l: LogPayload): void {
  const s = state[l.service];
  if (!s) return;
  s.logs.push(l);
  if (s.logs.length > MAX_LOG_LINES * 2) {
    s.logs.splice(0, s.logs.length - MAX_LOG_LINES);
  }
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
  applyStatus(e.payload);
  renderServices();
  renderSummary();
});

listen<LogPayload>('service-log', (e) => {
  applyLog(e.payload);
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

$btnStartAll.addEventListener('click', async () => {
  for (const s of SERVICES) {
    if (state[s].state !== 'running' && state[s].state !== 'starting') {
      await invoke('start_service', { name: s }).catch(() => null);
    }
  }
});

$btnStopAll.addEventListener('click', async () => {
  if (!confirm('Alle Services stoppen? Polling hört auf bis du neu startest.')) return;
  for (const s of SERVICES) {
    await invoke('stop_service', { name: s }).catch(() => null);
  }
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
  if (activeService === 'all') {
    [...SERVICES, 'supervisor' as ServiceName].forEach((s) => (state[s].logs = []));
  } else {
    state[activeService as ServiceName].logs = [];
  }
  renderLogs();
});

// ── Auto-update ──────────────────────────────────────────────────────────────
interface UpdateInfo {
  available: boolean;
  commits_behind: number;
  current_sha: string;
  remote_sha: string;
  messages: string[];
  has_uncommitted: boolean;
  has_rust_changes: boolean;
  last_checked: string;
}

const $btnUpdate = document.getElementById('btn-update') as HTMLButtonElement;
const $modal = document.getElementById('update-modal') as HTMLDialogElement;
const $updSummary = document.getElementById('update-summary')!;
const $updCommits = document.getElementById('update-commits')!;
const $updRustWarn = document.getElementById('update-rust-warn')!;
const $updUncommittedWarn = document.getElementById('update-uncommitted-warn')!;
const $updProgress = document.getElementById('update-progress')!;
const $btnUpdateApply = document.getElementById('btn-update-apply') as HTMLButtonElement;
const $btnUpdateCancel = document.getElementById('btn-update-cancel') as HTMLButtonElement;

let latestUpdate: UpdateInfo | null = null;

function renderUpdateBadge(info: UpdateInfo | null): void {
  if (info?.available) {
    $btnUpdate.style.display = '';
    $btnUpdate.textContent = `⬇ Update (${info.commits_behind})`;
  } else {
    $btnUpdate.style.display = 'none';
  }
}

function openUpdateModal(info: UpdateInfo): void {
  $updSummary.textContent = `${info.commits_behind} neue Commits auf origin/main. Lokal: ${info.current_sha.slice(0, 7)} → remote: ${info.remote_sha.slice(0, 7)}`;
  $updCommits.innerHTML = info.messages.map((m) => `• ${m}`).join('<br>') || '(keine)';
  $updRustWarn.style.display = info.has_rust_changes ? '' : 'none';
  $updUncommittedWarn.style.display = info.has_uncommitted ? '' : 'none';
  $btnUpdateApply.disabled = info.has_uncommitted;
  $updProgress.style.display = 'none';
  $modal.showModal();
}

async function checkForUpdates(): Promise<void> {
  try {
    const info = await invoke<UpdateInfo>('check_updates');
    latestUpdate = info;
    renderUpdateBadge(info);
  } catch (e) {
    console.warn('check_updates failed', e);
  }
}

listen<{ state: string; message: string }>('update-status', (e) => {
  $updProgress.style.display = '';
  $updProgress.textContent = e.payload.message;
  if (e.payload.state === 'done' || e.payload.state === 'rust-changed') {
    $btnUpdateApply.disabled = true;
    $btnUpdateCancel.textContent = 'Schließen';
  }
});

$btnUpdate.addEventListener('click', () => {
  if (latestUpdate?.available) openUpdateModal(latestUpdate);
});
$btnUpdateCancel.addEventListener('click', () => {
  $modal.close();
  $btnUpdateApply.disabled = false;
  $btnUpdateCancel.textContent = 'Später';
  void checkForUpdates();
});
$btnUpdateApply.addEventListener('click', async () => {
  $btnUpdateApply.disabled = true;
  $updProgress.style.display = '';
  $updProgress.textContent = 'Update wird angewendet…';
  try {
    const fresh = await invoke<UpdateInfo>('apply_updates');
    latestUpdate = fresh;
    renderUpdateBadge(fresh);
    $updProgress.textContent = fresh.has_rust_changes
      ? '✓ Update angewendet. Bitte App neu starten (Cmd+Q + npm run app:dev).'
      : '✓ Update angewendet. Services werden neu gestartet.';
    $btnUpdateCancel.textContent = 'Schließen';
  } catch (e) {
    $updProgress.textContent = `✗ Fehler: ${e}`;
    $btnUpdateApply.disabled = false;
  }
});

// ── Bootstrap ────────────────────────────────────────────────────────────────
renderServices();
renderSummary();

(async () => {
  try {
    // Tell Rust we're mounted and listening; Rust will start services + return
    // the snapshot we might have otherwise missed (no events lost to race).
    const snap = await invoke<InitialState>('frontend_ready');
    snap.statuses.forEach(applyStatus);
    snap.logs.forEach(applyLog);
    renderServices();
    renderSummary();
    renderLogs();

    // First update check immediately + every 10 minutes afterwards.
    void checkForUpdates();
    setInterval(() => void checkForUpdates(), 10 * 60 * 1000);
  } catch (e) {
    console.error('frontend_ready failed', e);
    // Still show something so the UI isn't frozen on "starting".
    const el = document.createElement('div');
    el.style.cssText = 'padding:20px;color:#fca5a5';
    el.textContent = `Rust-Seite nicht erreichbar: ${e}`;
    document.body.prepend(el);
  }
})();
