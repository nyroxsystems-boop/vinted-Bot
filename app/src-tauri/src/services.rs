// ──────────────────────────────────────────────────────────────────────────────
// Service Supervisor
//
// Spawns the four Node services (orchestrator, vinted-bot, temu-bot, dashboard)
// as child processes, pipes their stdout/stderr into Tauri events
// ("service-log"), and tracks their lifecycle state via "service-status"
// events. Kills all children on app shutdown.
//
// Late-frontend-join safety:
//   In Tauri v2 the Rust side can fire `emit` events before the webview has
//   had a chance to `listen`. To avoid losing early output we also KEEP a
//   rolling buffer of the last N log lines per service and the latest status.
//   The frontend calls `get_state` on mount to catch up, then listens to new
//   events as usual.
// ──────────────────────────────────────────────────────────────────────────────

use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, VecDeque};
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::thread;
use tauri::{AppHandle, Emitter};

const LOG_BUFFER_PER_SERVICE: usize = 500;

#[derive(Clone, Serialize, Deserialize)]
pub struct ServiceLogEvent {
    pub service: String,
    pub stream: String, // "stdout" | "stderr"
    pub line: String,
    pub ts: String,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct ServiceStatusEvent {
    pub service: String,
    pub state: String, // "starting" | "running" | "exited" | "failed"
    pub pid: Option<u32>,
    pub exit_code: Option<i32>,
    pub http_url: Option<String>,
}

#[derive(Clone, Serialize)]
pub struct InitialState {
    pub statuses: Vec<ServiceStatusEvent>,
    pub logs: Vec<ServiceLogEvent>,
    pub repo_root: String,
}

#[derive(Clone)]
pub struct ServiceDef {
    pub name: &'static str,
    pub args: Vec<&'static str>,
    pub http_url: Option<&'static str>,
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
    pub statuses: Mutex<HashMap<String, ServiceStatusEvent>>,
    pub log_buffer: Mutex<HashMap<String, VecDeque<ServiceLogEvent>>>,
    pub repo_root: PathBuf,
    pub npm_path: PathBuf,
    pub defs: Vec<ServiceDef>,
    pub started: Mutex<bool>,
}

impl Supervisor {
    pub fn new(repo_root: PathBuf) -> Arc<Self> {
        let npm_path = resolve_npm_path();
        let defs = service_definitions();

        let mut statuses = HashMap::new();
        let mut log_buffer = HashMap::new();
        for d in &defs {
            statuses.insert(
                d.name.to_string(),
                ServiceStatusEvent {
                    service: d.name.to_string(),
                    state: "starting".to_string(),
                    pid: None,
                    exit_code: None,
                    http_url: d.http_url.map(|s| s.to_string()),
                },
            );
            log_buffer.insert(d.name.to_string(), VecDeque::with_capacity(LOG_BUFFER_PER_SERVICE));
        }

        Arc::new(Self {
            children: Mutex::new(HashMap::new()),
            statuses: Mutex::new(statuses),
            log_buffer: Mutex::new(log_buffer),
            repo_root,
            npm_path,
            defs,
            started: Mutex::new(false),
        })
    }

    pub fn start_all_once(self: &Arc<Self>, app: &AppHandle) {
        {
            let mut guard = self.started.lock().unwrap();
            if *guard {
                return;
            }
            *guard = true;
        }
        self.record_log(app, "supervisor", "stdout", &format!(
            "Supervisor bootstrap — npm: {}  cwd: {}",
            self.npm_path.display(),
            self.repo_root.display()
        ));
        for def in self.defs.clone() {
            self.start_one(app, &def);
        }
    }

    pub fn start_one(self: &Arc<Self>, app: &AppHandle, def: &ServiceDef) {
        self.update_status(app, def.name, "starting", None, None, def.http_url);

        let mut cmd = Command::new(&self.npm_path);
        cmd.args(&def.args)
            .current_dir(&self.repo_root)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .env("FORCE_COLOR", "0")
            .env("CI", "1"); // make some tools less chatty / non-interactive

        let mut child = match cmd.spawn() {
            Ok(c) => c,
            Err(e) => {
                self.record_log(
                    app,
                    def.name,
                    "stderr",
                    &format!("Failed to spawn ({} {:?}): {}", self.npm_path.display(), def.args, e),
                );
                self.update_status(app, def.name, "failed", None, None, def.http_url);
                return;
            }
        };
        let pid = child.id();
        self.record_log(
            app,
            def.name,
            "stdout",
            &format!("Spawned pid {} — {} {}", pid, self.npm_path.display(), def.args.join(" ")),
        );

        let stdout = child.stdout.take();
        let stderr = child.stderr.take();
        self.children.lock().unwrap().insert(def.name.to_string(), child);

        let name = def.name;
        let ready_marker = def.ready_marker;
        let http_url = def.http_url;

        if let Some(out) = stdout {
            let this = self.clone();
            let app2 = app.clone();
            thread::spawn(move || {
                let reader = BufReader::new(out);
                let mut announced_running = false;
                for line in reader.lines().flatten() {
                    this.record_log(&app2, name, "stdout", &line);
                    if !announced_running && line.contains(ready_marker) {
                        this.update_status(&app2, name, "running", Some(pid), None, http_url);
                        announced_running = true;
                    }
                }
            });
        }

        if let Some(err) = stderr {
            let this = self.clone();
            let app3 = app.clone();
            thread::spawn(move || {
                let reader = BufReader::new(err);
                for line in reader.lines().flatten() {
                    this.record_log(&app3, name, "stderr", &line);
                }
            });
        }

        // Exit watcher.
        let this = self.clone();
        let app4 = app.clone();
        let key = def.name.to_string();
        let http_url_owned = http_url;
        thread::spawn(move || {
            let mut child = match this.children.lock().unwrap().remove(&key) {
                Some(c) => c,
                None => return,
            };
            let exit = child.wait();
            let code = exit.ok().and_then(|s| s.code());
            let state = match code {
                Some(0) => "exited",
                _ => "failed",
            };
            this.update_status(&app4, &key, state, Some(pid), code, http_url_owned);
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

    pub fn snapshot(&self) -> InitialState {
        let statuses = self
            .statuses
            .lock()
            .unwrap()
            .values()
            .cloned()
            .collect::<Vec<_>>();
        let mut logs: Vec<ServiceLogEvent> = self
            .log_buffer
            .lock()
            .unwrap()
            .values()
            .flat_map(|v| v.iter().cloned().collect::<Vec<_>>())
            .collect();
        logs.sort_by(|a, b| a.ts.cmp(&b.ts));
        InitialState {
            statuses,
            logs,
            repo_root: self.repo_root.display().to_string(),
        }
    }

    // ── Internal helpers — always update cache THEN emit ──────────────────────

    fn record_log(&self, app: &AppHandle, service: &str, stream: &str, line: &str) {
        let event = ServiceLogEvent {
            service: service.to_string(),
            stream: stream.to_string(),
            line: line.to_string(),
            ts: Utc::now().to_rfc3339(),
        };
        {
            let mut buf = self.log_buffer.lock().unwrap();
            let q = buf.entry(service.to_string()).or_insert_with(VecDeque::new);
            if q.len() >= LOG_BUFFER_PER_SERVICE {
                q.pop_front();
            }
            q.push_back(event.clone());
        }
        let _ = app.emit("service-log", event);
    }

    fn update_status(
        &self,
        app: &AppHandle,
        service: &str,
        state: &str,
        pid: Option<u32>,
        exit_code: Option<i32>,
        http_url: Option<&str>,
    ) {
        let event = ServiceStatusEvent {
            service: service.to_string(),
            state: state.to_string(),
            pid,
            exit_code,
            http_url: http_url.map(|s| s.to_string()),
        };
        self.statuses
            .lock()
            .unwrap()
            .insert(service.to_string(), event.clone());
        let _ = app.emit("service-status", event);
    }
}

/// Resolve an absolute path to `npm`.
/// GUI-launched macOS apps don't inherit the login-shell PATH, so relying on
/// `Command::new("npm")` alone can fail once we bundle to a .app. Try common
/// locations and fall back to the bare name.
fn resolve_npm_path() -> PathBuf {
    if let Ok(v) = std::env::var("VINTED_SYSTEM_NPM") {
        let p = PathBuf::from(v);
        if p.exists() {
            return p;
        }
    }
    let candidates = [
        "/opt/homebrew/bin/npm",
        "/usr/local/bin/npm",
        "/usr/bin/npm",
        "/opt/homebrew/opt/node/bin/npm",
    ];
    for c in candidates {
        let p = PathBuf::from(c);
        if p.exists() {
            return p;
        }
    }
    // Try which.
    if let Ok(out) = Command::new("/bin/sh").arg("-lc").arg("which npm").output() {
        if out.status.success() {
            let path = String::from_utf8_lossy(&out.stdout).trim().to_string();
            if !path.is_empty() {
                return PathBuf::from(path);
            }
        }
    }
    PathBuf::from("npm")
}

/// Attempt to locate the Vinted-System repo root.
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
