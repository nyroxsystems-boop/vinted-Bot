// ──────────────────────────────────────────────────────────────────────────────
// Vinted-System native app (Tauri v2).
//
// Lifecycle:
//   1. App boot → setup() registers the Supervisor but does NOT start services.
//   2. Frontend mounts, registers its `listen()` handlers, then invokes
//      `frontend_ready`. Rust now spawns all services.
//   3. Frontend can call `get_state` at any time to re-sync (e.g. on window
//      reload) from the Rust-side snapshot (last N log lines + current status).
// ──────────────────────────────────────────────────────────────────────────────

mod services;
mod updates;

use std::sync::Arc;
use tauri::{Manager, RunEvent, WebviewUrl, WebviewWindowBuilder, WindowEvent};

use crate::services::{find_repo_root, InitialState, Supervisor};
use crate::updates::{apply_update, check_for_updates, UpdateInfo};

struct AppState {
    supervisor: Arc<Supervisor>,
}

#[tauri::command]
fn frontend_ready(app: tauri::AppHandle, state: tauri::State<AppState>) -> InitialState {
    state.supervisor.start_all_once(&app);
    state.supervisor.snapshot()
}

#[tauri::command]
fn get_state(state: tauri::State<AppState>) -> InitialState {
    state.supervisor.snapshot()
}

#[tauri::command]
fn open_dashboard(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(win) = app.get_webview_window("dashboard") {
        let _ = win.show();
        let _ = win.set_focus();
        return Ok(());
    }
    let url = tauri::Url::parse("http://localhost:5173").map_err(|e| e.to_string())?;
    WebviewWindowBuilder::new(&app, "dashboard", WebviewUrl::External(url))
        .title("Vinted-System · Dashboard")
        .inner_size(1440.0, 900.0)
        .min_inner_size(1200.0, 720.0)
        .center()
        .resizable(true)
        .build()
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn restart_service(
    app: tauri::AppHandle,
    state: tauri::State<AppState>,
    name: String,
) -> Result<(), String> {
    let sup = state.supervisor.clone();
    sup.stop_one(&name);
    std::thread::sleep(std::time::Duration::from_millis(500));
    let def = sup
        .def_for(&name)
        .ok_or_else(|| format!("unknown service: {}", name))?
        .clone();
    sup.start_one(&app, &def);
    Ok(())
}

#[tauri::command]
fn stop_service(state: tauri::State<AppState>, name: String) -> Result<(), String> {
    state.supervisor.stop_one(&name);
    Ok(())
}

#[tauri::command]
fn start_service(
    app: tauri::AppHandle,
    state: tauri::State<AppState>,
    name: String,
) -> Result<(), String> {
    let sup = state.supervisor.clone();
    let def = sup
        .def_for(&name)
        .ok_or_else(|| format!("unknown service: {}", name))?
        .clone();
    sup.start_one(&app, &def);
    Ok(())
}

// ── Auto-update commands ────────────────────────────────────────────────────

#[tauri::command]
fn check_updates(state: tauri::State<AppState>) -> Result<UpdateInfo, String> {
    check_for_updates(&state.supervisor.repo_root)
}

#[tauri::command]
fn apply_updates(
    app: tauri::AppHandle,
    state: tauri::State<AppState>,
) -> Result<UpdateInfo, String> {
    let sup = state.supervisor.clone();
    // Stop services BEFORE git pull to release npm/tsx locks cleanly.
    sup.stop_all();
    let result = apply_update(&sup.repo_root, &sup.npm_path, &app)?;
    // If Rust code changed, DON'T restart — user must Cmd+Q and re-run
    // npm run app:dev, since the current process is the stale binary.
    if !result.has_rust_changes {
        sup.restart_all(&app);
    }
    Ok(result)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let repo_root = match find_repo_root() {
        Some(p) => p,
        None => {
            eprintln!(
                "❌ Could not locate Vinted-System repo root. Set VINTED_SYSTEM_ROOT env var \
                 to the absolute path of your Vinted-System folder."
            );
            std::process::exit(1);
        }
    };
    eprintln!("✓ Using repo root: {}", repo_root.display());

    let supervisor = Supervisor::new(repo_root);

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(AppState {
            supervisor: supervisor.clone(),
        })
        .invoke_handler(tauri::generate_handler![
            frontend_ready,
            get_state,
            open_dashboard,
            restart_service,
            stop_service,
            start_service,
            check_updates,
            apply_updates
        ])
        .setup(|app| {
            #[cfg(debug_assertions)]
            if let Some(w) = app.get_webview_window("main") {
                w.open_devtools();
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { .. } = event {
                if window.label() == "main" {
                    window.app_handle().exit(0);
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("error building Vinted-System app")
        .run(move |app_handle, event| {
            if let RunEvent::ExitRequested { .. } | RunEvent::Exit = event {
                if let Some(state) = app_handle.try_state::<AppState>() {
                    state.supervisor.stop_all();
                }
            }
        });
}
