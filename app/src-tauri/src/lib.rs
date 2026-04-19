// ──────────────────────────────────────────────────────────────────────────────
// Vinted-System native app (Tauri v2).
//
// Behaviour:
//   • Main window: the services console (splash + live logs per service).
//   • On setup: Supervisor spawns orchestrator / vinted-bot / temu-bot /
//     dashboard as child processes.
//   • When the user clicks "Dashboard öffnen", a SECOND window opens with
//     the running Vite dev server (http://localhost:5173).
//   • On window close or app quit: all child processes are killed.
// ──────────────────────────────────────────────────────────────────────────────

mod services;

use std::sync::Arc;
use tauri::{Manager, RunEvent, WebviewUrl, WebviewWindowBuilder, WindowEvent};

use crate::services::{find_repo_root, Supervisor};

struct AppState {
    supervisor: Arc<Supervisor>,
}

#[tauri::command]
fn open_dashboard(app: tauri::AppHandle) -> Result<(), String> {
    // If it's already open, just focus it.
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
    // Short grace then re-spawn.
    std::thread::sleep(std::time::Duration::from_millis(500));
    let def = sup.def_for(&name).ok_or_else(|| format!("unknown service: {}", name))?.clone();
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
    let def = sup.def_for(&name).ok_or_else(|| format!("unknown service: {}", name))?.clone();
    sup.start_one(&app, &def);
    Ok(())
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
            open_dashboard,
            restart_service,
            stop_service,
            start_service
        ])
        .setup(move |app| {
            #[cfg(debug_assertions)]
            if let Some(w) = app.get_webview_window("main") {
                w.open_devtools();
            }
            supervisor.start_all(&app.handle());
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { .. } = event {
                // Closing the main window = quit the app.
                if window.label() == "main" {
                    window.app_handle().exit(0);
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("error building Vinted-System app")
        .run(move |app_handle, event| {
            if let RunEvent::ExitRequested { .. } | RunEvent::Exit = event {
                // Kill child processes on app termination.
                if let Some(state) = app_handle.try_state::<AppState>() {
                    state.supervisor.stop_all();
                }
            }
        });
}
