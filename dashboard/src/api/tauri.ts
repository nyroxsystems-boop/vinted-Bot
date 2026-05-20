// ──────────────────────────────────────────────────────────────────────────────
// Tauri IPC wrapper — thin, safe-guarded bridge so the dashboard can talk
// to the Rust service supervisor when running inside the native shell, but
// still works (read-only for services) when opened in a plain browser.
//
// We detect Tauri via the injected `__TAURI_INTERNALS__` global. If it's
// missing, every function returns a stub response so components can render
// a "Services steuerbar nur im App-Modus" banner instead of crashing.
// ──────────────────────────────────────────────────────────────────────────────

export type ServiceName =
  | 'orchestrator'
  | 'vinted-bot'
  | 'temu-bot'
  | 'supervisor';

export type ServiceState = 'starting' | 'running' | 'exited' | 'failed';

export interface ServiceStatus {
  service: ServiceName;
  state: ServiceState;
  pid: number | null;
  exit_code: number | null;
  http_url: string | null;
}

export interface ServiceLog {
  service: ServiceName;
  stream: 'stdout' | 'stderr';
  line: string;
  ts: string;
}

export interface InitialState {
  statuses: ServiceStatus[];
  logs: ServiceLog[];
  repo_root: string;
}

export interface UpdateInfo {
  available: boolean;
  commits_behind: number;
  current_sha: string;
  remote_sha: string;
  messages: string[];
  has_uncommitted: boolean;
  has_rust_changes: boolean;
  last_checked: string;
}

export interface ReloadPlan {
  needs_rebuild: boolean;
  needs_services_restart: boolean;
  changed: string[];
  bundle_age_seconds: number;
}

export interface ReloadProgress {
  state:
    | 'stopping'
    | 'building'
    | 'installing'
    | 'relaunching'
    | 'starting'
    | 'done'
    | 'error';
  message: string;
}

export interface VersionInfo {
  version: string;
  manifest_url: string;
}

export interface TarballManifest {
  ok: boolean;
  available: boolean;
  version: string | null;
  released_at: string | null;
  notes: string[] | null;
  tarball_url: string | null;
  sha256: string | null;
  signature: string | null;
  requires_native_reinstall: boolean;
  current_version: string | null;
  latest_version: string | null;
}

export interface TarballUpdateProgress {
  phase:
    | 'downloading'
    | 'verifying'
    | 'stopping'
    | 'extracting'
    | 'installing'
    | 'starting'
    | 'done'
    | 'error';
  percent: number;
  message: string;
}

export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

// ── Lazy imports so the vanilla dev-server build doesn't explode if the
//    @tauri-apps/api module isn't present (it will be, but belt + braces).

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauri()) {
    throw new Error(`invoke(${cmd}): not running inside the Tauri shell`);
  }
  const mod = await import('@tauri-apps/api/core');
  return mod.invoke<T>(cmd, args);
}

export async function listen<T>(
  event: string,
  handler: (payload: T) => void,
): Promise<() => void> {
  if (!isTauri()) return () => undefined;
  const mod = await import('@tauri-apps/api/event');
  const unlisten = await mod.listen<T>(event, (e) => handler(e.payload));
  return unlisten;
}

export const tauri = {
  available: isTauri,

  frontendReady: () => invoke<InitialState>('frontend_ready'),
  getState: () => invoke<InitialState>('get_state'),

  startService: (name: ServiceName) => invoke<void>('start_service', { name }),
  stopService: (name: ServiceName) => invoke<void>('stop_service', { name }),
  restartService: (name: ServiceName) => invoke<void>('restart_service', { name }),

  /** Stop & start every Node service. No git, no rebuild — just bounce
   *  the workers. Used by the Diagnose-Panel restart button. */
  restartAllServices: () => invoke<void>('restart_all_services'),

  // ── In-app tarball updates ──────────────────────────────────────────────
  appVersion: () => invoke<VersionInfo>('app_version'),
  checkTarballUpdate: () => invoke<TarballManifest>('check_tarball_update'),
  applyTarballUpdate: (manifest: TarballManifest) =>
    invoke<void>('apply_tarball_update', { manifest }),

  fullRestart: () => invoke<void>('full_restart'),

  checkUpdates: () => invoke<UpdateInfo>('check_updates'),
  applyUpdates: () => invoke<UpdateInfo>('apply_updates'),

  // Local-reload (no git) — picks up code changes the user edited locally.
  planLocalReload: () => invoke<ReloadPlan>('plan_local_reload'),
  reloadAll: () => invoke<ReloadPlan>('reload_all'),
};
