// ──────────────────────────────────────────────────────────────────────────────
// Service Supervisor
//
// Spawns the four Node services (orchestrator, vinted-bot, temu-bot, dashboard)
// as child processes, pipes their stdout/stderr into Tauri events
// ("service-log"), and tracks their lifecycle state via "service-status"
// events. Kills all children on app shutdown.
//
// Design notes:
//   • One thread per service reads stdout; one thread reads stderr.
//   • Children are stored in a Mutex<HashMap<String, Child>> so the Tauri
//     commands (restart_service, stop_service) can reach them.
//   • When a child exits unexpectedly we emit state='exited' with the code.
// ──────────────────────────────────────────────────────────────────────────────

use chrono::Utc;
use serde::Serialize;
use std::collections::HashMap;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::thread;
use tauri::{AppHandle, Emitter};

#[derive(Clone, Serialize)]
pub struct ServiceLogEvent {
    pub service: String,
    pub stream: String, // "stdout" | "stderr"
    pub line: String,
    pub ts: String,
}

#[derive(Clone, Serialize)]
pub struct ServiceStatusEvent {
    pub service: String,
    pub state: String, // "starting" | "running" | "exited" | "failed"
    pub pid: Option<u32>,
    pub exit_code: Option<i32>,
    pub http_url: Option<String>,
}

#[derive(Clone)]
pub struct ServiceDef {
    pub name: &'static str,
    pub args: Vec<&'static str>,
    pub http_url: Option<&'static str>,
    // A substring we scan for in stdout to decide the service is actually READY
    // (listening on its port). Until we see it, status stays "starting".
    pub ready_marker: &'static str,
}

pub fn service_definitions() -> Vec<ServiceDef> {
    vec![
        ServiceDef {
            name: "orchestrator",
            args: vec!["run", "-w", "@vinted-system/orchestrator", "start"],
            http_url: Some("http://localhost:4700"),
            ready_marker: "Orchestrator listening",
        },
        ServiceDef {
            name: "vinted-bot",
            args: vec!["run", "-w", "@vinted-system/vinted-bot", "start"],
            http_url: Some("http://localhost:4701"),
            ready_marker: "Vinted-bot API listening",
        },
        ServiceDef {
            name: "temu-bot",
            args: vec!["run", "-w", "@vinted-system/temu-bot", "start"],
            http_url: Some("http://localhost:4702"),
            ready_marker: "Temu-bot API listening",
        },
        ServiceDef {
            name: "dashboard",
            args: vec!["run", "-w", "@vinted-system/dashboard", "dev"],
            http_url: Some("http://localhost:5173"),
            ready_marker: "Local:",
        },
    ]
}

pub struct Supervisor {
    pub children: Mutex<HashMap<String, Child>>,
    pub repo_root: PathBuf,
    pub defs: Vec<ServiceDef>,
}

impl Supervisor {
    pub fn new(repo_root: PathBuf) -> Arc<Self> {
        Arc::new(Self {
            children: Mutex::new(HashMap::new()),
            repo_root,
            defs: service_definitions(),
        })
    }

    pub fn start_all(self: &Arc<Self>, app: &AppHandle) {
        for def in self.defs.clone() {
            self.start_one(app, &def);
        }
    }

    pub fn start_one(self: &Arc<Self>, app: &AppHandle, def: &ServiceDef) {
        emit_status(app, def.name, "starting", None, None, def.http_url);

        let mut cmd = Command::new("npm");
        cmd.args(&def.args)
            .current_dir(&self.repo_root)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .env("FORCE_COLOR", "0"); // prevent ANSI escapes in logs

        let mut child = match cmd.spawn() {
            Ok(c) => c,
            Err(e) => {
                emit_log(
                    app,
                    def.name,
                    "stderr",
                    &format!("Failed to spawn: {}", e),
                );
                emit_status(app, def.name, "failed", None, None, def.http_url);
                return;
            }
        };
        let pid = child.id();
        emit_log(
            app,
            def.name,
            "stdout",
            &format!("Spawned pid {} — cmd: npm {}", pid, def.args.join(" ")),
        );

        let stdout = child.stdout.take();
        let stderr = child.stderr.take();
        self.children.lock().unwrap().insert(def.name.to_string(), child);

        let name = def.name;
        let ready_marker = def.ready_marker;
        let http_url = def.http_url;

        // stdout reader — watches for ready_marker to flip state to "running".
        if let Some(out) = stdout {
            let app2 = app.clone();
            thread::spawn(move || {
                let reader = BufReader::new(out);
                let mut announced_running = false;
                for line in reader.lines().flatten() {
                    emit_log(&app2, name, "stdout", &line);
                    if !announced_running && line.contains(ready_marker) {
                        emit_status(&app2, name, "running", Some(pid), None, http_url);
                        announced_running = true;
                    }
                }
                // stdout closed → usually means the process exited. We mark
                // "running" false only if we never saw ready.
                if !announced_running {
                    emit_status(&app2, name, "exited", Some(pid), None, http_url);
                }
            });
        }

        if let Some(err) = stderr {
            let app3 = app.clone();
            thread::spawn(move || {
                let reader = BufReader::new(err);
                for line in reader.lines().flatten() {
                    emit_log(&app3, name, "stderr", &line);
                }
            });
        }

        // Exit watcher — waits for process to finish, emits final status.
        let sup = self.clone();
        let app4 = app.clone();
        let key = def.name.to_string();
        let http_url_owned = http_url;
        thread::spawn(move || {
            // Wait() consumes the Child, so we take it OUT of the map first.
            let mut child = match sup.children.lock().unwrap().remove(&key) {
                Some(c) => c,
                None => return,
            };
            let exit = child.wait();
            let code = exit.ok().and_then(|s| s.code());
            let state = match code {
                Some(0) => "exited",
                _ => "failed",
            };
            emit_status(&app4, &key, state, Some(pid), code, http_url_owned);
        });
    }

    pub fn stop_one(self: &Arc<Self>, name: &str) {
        if let Some(mut child) = self.children.lock().unwrap().remove(name) {
            let _ = child.kill();
            let _ = child.wait();
        }
    }

    pub fn stop_all(self: &Arc<Self>) {
        let names: Vec<String> = {
            let map = self.children.lock().unwrap();
            map.keys().cloned().collect()
        };
        for name in names {
            self.stop_one(&name);
        }
    }

    pub fn def_for(&self, name: &str) -> Option<&ServiceDef> {
        self.defs.iter().find(|d| d.name == name)
    }
}

fn emit_log(app: &AppHandle, service: &str, stream: &str, line: &str) {
    let _ = app.emit(
        "service-log",
        ServiceLogEvent {
            service: service.to_string(),
            stream: stream.to_string(),
            line: line.to_string(),
            ts: Utc::now().to_rfc3339(),
        },
    );
}

fn emit_status(
    app: &AppHandle,
    service: &str,
    state: &str,
    pid: Option<u32>,
    exit_code: Option<i32>,
    http_url: Option<&str>,
) {
    let _ = app.emit(
        "service-status",
        ServiceStatusEvent {
            service: service.to_string(),
            state: state.to_string(),
            pid,
            exit_code,
            http_url: http_url.map(|s| s.to_string()),
        },
    );
}

/// Attempt to locate the Vinted-System repo root so the services can be
/// launched with the correct CWD.
///
/// Search order (first hit wins):
///   1. `$VINTED_SYSTEM_ROOT` env var.
///   2. Walking up from the executable's directory looking for a
///      `package.json` containing `"name": "vinted-system"`.
///   3. `$CARGO_MANIFEST_DIR/../..` (dev mode).
pub fn find_repo_root() -> Option<PathBuf> {
    if let Ok(env) = std::env::var("VINTED_SYSTEM_ROOT") {
        let p = PathBuf::from(env);
        if p.exists() {
            return Some(p);
        }
    }

    if let Ok(exe) = std::env::current_exe() {
        let mut cur = exe.parent()?.to_path_buf();
        for _ in 0..8 {
            if is_repo_root(&cur) {
                return Some(cur);
            }
            cur = match cur.parent() {
                Some(p) => p.to_path_buf(),
                None => break,
            };
        }
    }

    // Dev fallback — CARGO_MANIFEST_DIR is app/src-tauri, root is ../..
    if let Some(manifest) = option_env!("CARGO_MANIFEST_DIR") {
        let dev = Path::new(manifest).join("..").join("..");
        if is_repo_root(&dev) {
            return Some(dev.canonicalize().ok()?);
        }
    }

    None
}

fn is_repo_root(p: &Path) -> bool {
    let pkg = p.join("package.json");
    if !pkg.exists() {
        return false;
    }
    let Ok(s) = std::fs::read_to_string(&pkg) else {
        return false;
    };
    s.contains("\"vinted-system\"")
}
