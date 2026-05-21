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

mod local_update;
mod services;
mod tarball_update;
mod updates;

use std::sync::Arc;
use tauri::{Manager, RunEvent, WindowEvent};

use crate::local_update::{plan_reload, rebuild_and_install, emit_progress, ReloadPlan};
use crate::services::{find_repo_root, prepare_bundled_payload, InitialState, Supervisor};
use crate::tarball_update::{
    apply_update as apply_tarball, check_update as check_tarball, version_info,
    TarballManifest, VersionInfo,
};
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

/// Stop & start every Node service. Does NOT touch the Tauri shell or pull
/// new code — just bounces the worker processes so they pick up settings
/// changes, recover from a stuck state, or release wedged ports. Used by the
/// "Services neu starten"-button in the Diagnose-Panel.
#[tauri::command]
fn restart_all_services(app: tauri::AppHandle, state: tauri::State<AppState>) -> Result<(), String> {
    state.supervisor.restart_all(&app);
    Ok(())
}

// ── Tarball update path — production end-user updates without git ──────────

#[tauri::command]
fn app_version(state: tauri::State<AppState>) -> VersionInfo {
    version_info(&state.supervisor.repo_root)
}

#[tauri::command]
fn check_tarball_update(state: tauri::State<AppState>) -> Result<TarballManifest, String> {
    let info = version_info(&state.supervisor.repo_root);
    check_tarball(&info.manifest_url, &info.version)
}

#[tauri::command]
fn apply_tarball_update(
    app: tauri::AppHandle,
    state: tauri::State<AppState>,
    manifest: TarballManifest,
) -> Result<(), String> {
    let sup = state.supervisor.clone();
    apply_tarball(&sup.repo_root, &sup.npm_path, &sup, &manifest, &app)
}

/// "Full restart": stop services, write a shell script with the exact
/// update-then-relaunch sequence, open it in a new Terminal window,
/// then quit the current app. The user ends up with a clean terminal
/// running the freshly-pulled code.
#[tauri::command]
fn full_restart(app: tauri::AppHandle, state: tauri::State<AppState>) -> Result<(), String> {
    let sup = state.supervisor.clone();
    sup.stop_all();

    let repo = sup.repo_root.display().to_string();

    // Platform-aware: write a shell script on Unix, a .bat on Windows, then
    // launch it in a fresh Terminal / cmd.exe window so the user sees the
    // update progress live.
    #[cfg(unix)]
    let (script_path, opened) = {
        let script = format!(
            "#!/bin/bash\n\
             set -e\n\
             echo '════════════════════════════════════════'\n\
             echo '  Vinted-System — Update + Neustart'\n\
             echo '════════════════════════════════════════'\n\
             cd \"{repo}\"\n\
             echo '▶ git pull'\n\
             git pull\n\
             echo '▶ npm install'\n\
             npm install\n\
             echo '▶ npm run app:dev'\n\
             exec npm run app:dev\n",
            repo = repo
        );
        let path = "/tmp/vinted-restart.command";
        std::fs::write(path, &script).map_err(|e| format!("write script: {}", e))?;
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o755));

        // Try `open -a Terminal` first; fall back to AppleScript.
        let mut ok = std::process::Command::new("/usr/bin/open")
            .arg("-a").arg("Terminal.app").arg(path).spawn().is_ok();
        if !ok {
            let apple = format!("tell application \"Terminal\" to do script \"{}\"", path);
            ok = std::process::Command::new("/usr/bin/osascript")
                .arg("-e").arg(apple).spawn().is_ok();
        }
        (path.to_string(), ok)
    };
    #[cfg(windows)]
    let (script_path, opened) = {
        // Use TEMP env-var; fall back to C:\Windows\Temp if not set.
        let temp = std::env::var("TEMP").unwrap_or_else(|_| String::from(r"C:\Windows\Temp"));
        let path = format!(r"{}\vinted-restart.bat", temp);
        let script = format!(
            "@echo off\r\n\
             echo ============================================\r\n\
             echo   Vinted-System -- Update + Neustart\r\n\
             echo ============================================\r\n\
             cd /d \"{repo}\"\r\n\
             echo Running: git pull\r\n\
             git pull\r\n\
             echo Running: npm install\r\n\
             call npm install\r\n\
             echo Running: npm run app:dev\r\n\
             call npm run app:dev\r\n\
             pause\r\n",
            repo = repo
        );
        std::fs::write(&path, &script).map_err(|e| format!("write script: {}", e))?;
        // Launch in a new cmd window. `cmd /c start ""` opens a detached window
        // and returns immediately so we can exit the current process cleanly.
        let ok = std::process::Command::new("cmd")
            .args(["/c", "start", "", "cmd", "/k", &path])
            .spawn()
            .is_ok();
        (path, ok)
    };

    if !opened {
        eprintln!(
            "[full_restart] failed to open shell (script at {} for repo {})",
            script_path, repo
        );
        return Err(
            "Konnte Terminal nicht öffnen. Bitte App neu starten oder Support kontaktieren."
                .to_string(),
        );
    }

    // Schedule the exit in a background thread so this IPC call returns
    // immediately — blocking the Tauri command thread prevents Terminal.app
    // from finishing its launch animation.
    let app_handle = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(2_500));
        app_handle.exit(0);
    });
    Ok(())
}

// ── Local reload commands (pick up code changes without git) ────────────────

#[tauri::command]
fn plan_local_reload(state: tauri::State<AppState>) -> ReloadPlan {
    plan_reload(&state.supervisor.repo_root)
}

/// The "Update jetzt"-button handler.
/// - If rebuild is needed: stops services, rebuilds the .app bundle, installs
///   it to /Applications, then quits so the user relaunches the fresh build.
/// - Otherwise: restarts the three Node services so they reload TS on boot.
#[tauri::command]
fn reload_all(
    app: tauri::AppHandle,
    state: tauri::State<AppState>,
) -> Result<ReloadPlan, String> {
    let sup = state.supervisor.clone();
    let plan = plan_reload(&sup.repo_root);

    emit_progress(&app, "stopping", "Stoppe Services…");
    sup.stop_all();
    std::thread::sleep(std::time::Duration::from_millis(600));

    if plan.needs_rebuild {
        // Rebuild blocks for 2–3 minutes. Rust code / dashboard bundle
        // changes require the shipped .app to be regenerated and the
        // running process (which IS the old binary) to exit.
        let repo_root = sup.repo_root.clone();
        let npm_path = sup.npm_path.clone();
        let app_handle = app.clone();
        std::thread::spawn(move || {
            match rebuild_and_install(&repo_root, &npm_path, &app_handle) {
                Ok(_) => {
                    emit_progress(
                        &app_handle,
                        "relaunching",
                        "Fertig gebaut — App wird in 3 s beendet, bitte neu starten.",
                    );
                    std::thread::sleep(std::time::Duration::from_secs(3));
                    app_handle.exit(0);
                }
                Err(e) => {
                    emit_progress(&app_handle, "error", &format!("Build fehlgeschlagen: {}", e));
                }
            }
        });
        return Ok(plan);
    }

    // Fast path: only Node services changed — tsx will pick up TS changes
    // when we respawn them.
    emit_progress(&app, "starting", "Starte Services mit neuem Code…");
    for def in sup.defs.clone() {
        sup.start_one(&app, &def);
    }
    emit_progress(&app, "done", "Services laufen mit aktuellem Code.");
    Ok(plan)
}

// ── Git-based update commands (origin/main pull) ────────────────────────────

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
    // Resolution order:
    //   1. Bundled payload (fat-installer) — installer shipped the source as
    //      a Tauri resource; extract + use the user-writable copy.
    //   2. find_repo_root() — env var / saved config / parent-walk / well-known
    //      default. Works for dev installs.
    //   3. Show a real OS dialog (so the user doesn't see "double-click does
    //      nothing"); then exit. Previously a silent exit(1) left users
    //      thinking the app was broken with no diagnostic info.
    let repo_root = if let Some((sys_dir, _npm, _browsers)) = prepare_bundled_payload() {
        eprintln!("✓ Using bundled-installer payload at {}", sys_dir.display());
        sys_dir
    } else {
        match find_repo_root() {
            Some(p) => {
                eprintln!("✓ Using repo root: {}", p.display());
                p
            }
            None => {
                let msg = "Blackruby kann den System-Ordner nicht finden.\n\n\
                           Setup: Repo nach %USERPROFILE%\\vinted-Bot\\ klonen und Blackruby \
                           neu starten, oder die Umgebungsvariable VINTED_SYSTEM_ROOT auf den \
                           absoluten Pfad zum Repo setzen.\n\n\
                           Falls du den Fat-Installer (v0.7.0+) erwartet hast: der Build \
                           war evtl. unvollständig. Bitte neueste Release-Version laden.";
                eprintln!("❌ {}", msg);
                #[cfg(windows)]
                {
                    // Show a Windows message box so the user actually sees WHY
                    // nothing happens — previous behaviour was silent exit.
                    let wide: Vec<u16> = msg.encode_utf16().chain(std::iter::once(0)).collect();
                    let title: Vec<u16> = "Blackruby — Setup unvollständig"
                        .encode_utf16().chain(std::iter::once(0)).collect();
                    unsafe {
                        extern "system" {
                            fn MessageBoxW(hwnd: *mut u8, text: *const u16, caption: *const u16, type_: u32) -> i32;
                        }
                        MessageBoxW(std::ptr::null_mut(), wide.as_ptr(), title.as_ptr(), 0x10);
                    }
                }
                #[cfg(target_os = "macos")]
                {
                    // osascript dialog — same intent on Mac.
                    let _ = std::process::Command::new("/usr/bin/osascript")
                        .args(["-e", &format!("display dialog \"{}\" with title \"Blackruby\" buttons {{\"OK\"}}", msg.replace('"', "'"))])
                        .status();
                }
                std::process::exit(1);
            }
        }
    };

    let supervisor = Supervisor::new(repo_root);

    // Install a Unix-signal handler so that SIGINT/SIGTERM/SIGHUP from the
    // CLI (Ctrl-C, `kill <pid>`, terminal-close) cleanly stops every spawned
    // child instead of orphaning them. Without this the Tauri main process
    // dies but the npm/tsx subprocesses keep running and hold their ports.
    //
    // The GUI close-button still flows through `on_window_event` →
    // `app.exit(0)` → `RunEvent::Exit` → `stop_all()`. This handler is a
    // belt-and-braces backup for non-GUI termination paths.
    #[cfg(unix)]
    {
        let sup_for_signals = supervisor.clone();
        std::thread::spawn(move || {
            use std::sync::atomic::{AtomicBool, Ordering};
            static HANDLED: AtomicBool = AtomicBool::new(false);
            // Use a simple polling approach with libc::signal — the `signal`
            // crate would be cleaner but we want zero extra dependencies.
            // SAFETY: signal() is async-signal-safe; the handler only sets a
            // flag and writes to a self-pipe via std::process::exit().
            extern "C" fn handle_term(_sig: i32) {
                // Re-entrant guard — multiple signals shouldn't crash us.
                static IN_HANDLER: AtomicBool = AtomicBool::new(false);
                if IN_HANDLER.swap(true, Ordering::SeqCst) { return; }
                // Trigger normal exit-flow which Rust runtime will translate
                // to the global Drop / atexit chain. We piggy-back via a
                // shared flag that the polling thread observes.
                HANDLED.store(true, Ordering::SeqCst);
            }
            unsafe {
                libc::signal(libc::SIGINT, handle_term as libc::sighandler_t);
                libc::signal(libc::SIGTERM, handle_term as libc::sighandler_t);
                libc::signal(libc::SIGHUP, handle_term as libc::sighandler_t);
            }
            // Poll for the flag — when set, stop every child and exit.
            loop {
                std::thread::sleep(std::time::Duration::from_millis(200));
                if HANDLED.load(Ordering::SeqCst) {
                    eprintln!("[signal] termination signal received — stopping all services");
                    sup_for_signals.stop_all();
                    std::process::exit(0);
                }
            }
        });
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(AppState {
            supervisor: supervisor.clone(),
        })
        .invoke_handler(tauri::generate_handler![
            frontend_ready,
            get_state,
            restart_service,
            stop_service,
            start_service,
            restart_all_services,
            full_restart,
            check_updates,
            apply_updates,
            plan_local_reload,
            reload_all,
            app_version,
            check_tarball_update,
            apply_tarball_update
        ])
        .setup(|app| {
            eprintln!("[setup] entered");
            // Kick off the supervisor IMMEDIATELY so Node services start
            // booting in parallel with the frontend.
            match app.try_state::<AppState>() {
                Some(state) => {
                    eprintln!("[setup] starting supervisor");
                    state.supervisor.start_all_once(&app.handle());
                    eprintln!("[setup] supervisor kicked off");
                }
                None => eprintln!("[setup] ERROR: AppState not available"),
            }
            #[cfg(debug_assertions)]
            if let Some(w) = app.get_webview_window("main") {
                w.open_devtools();
            }
            eprintln!("[setup] done");
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
