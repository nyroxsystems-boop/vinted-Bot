// ──────────────────────────────────────────────────────────────────────────────
// Service Supervisor
//
// Spawns ALL Node backend services (orchestrator, 11 marketplace bots, CJ, temu)
// as child processes, pipes their stdout/stderr into Tauri events
// ("service-log"), and tracks their lifecycle state via "service-status"
// events. Kills all children on app shutdown.
//
// NOTE: The React dashboard is NOT started here anymore — it is the Tauri
// frontend itself, started by Tauri's `beforeDevCommand` in dev (or bundled
// via `frontendDist` in release). Keeping it out of the supervisor avoids
// double-starting the Vite dev server on port 5173.
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
use std::net::ToSocketAddrs;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
#[cfg(unix)]
use std::os::unix::process::CommandExt;
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
    pub port: u16,
    pub ready_marker: &'static str,
}

pub fn service_definitions() -> Vec<ServiceDef> {
    // In debug (= `tauri dev`) builds each Node service runs via its `dev`
    // script, which uses `tsx watch` and restarts on source-file changes.
    // In release builds we stick to `start` (plain `tsx`, no watcher) so the
    // shipped .app doesn't waste cycles scanning the source tree.
    let script = if cfg!(debug_assertions) { "dev" } else { "start" };
    vec![
        ServiceDef {
            name: "orchestrator",
            args: vec!["run", "-w", "@vinted-system/orchestrator", script],
            http_url: Some("http://localhost:4700"),
            port: 4700,
            ready_marker: "Orchestrator listening",
        },
        ServiceDef {
            name: "vinted-bot",
            args: vec!["run", "-w", "@vinted-system/vinted-bot", script],
            http_url: Some("http://localhost:4701"),
            port: 4701,
            ready_marker: "Vinted-bot API listening",
        },
        ServiceDef {
            name: "cj-service",
            args: vec!["run", "-w", "@vinted-system/cj-service", script],
            http_url: Some("http://localhost:4720"),
            port: 4720,
            ready_marker: "CJ Service running",
        },
        ServiceDef {
            name: "kleinanzeigen-bot",
            args: vec!["run", "-w", "@vinted-system/kleinanzeigen-bot", script],
            http_url: Some("http://localhost:4703"),
            port: 4703,
            ready_marker: "Kleinanzeigen-Bot listening",
        },
        ServiceDef {
            name: "mercari-bot",
            args: vec!["run", "-w", "@vinted-system/mercari-bot", script],
            http_url: Some("http://localhost:4704"),
            port: 4704,
            ready_marker: "Mercari-Bot listening",
        },
        ServiceDef {
            name: "depop-bot",
            args: vec!["run", "-w", "@vinted-system/depop-bot", script],
            http_url: Some("http://localhost:4705"),
            port: 4705,
            ready_marker: "Depop-Bot listening",
        },
        ServiceDef {
            name: "wallapop-bot",
            args: vec!["run", "-w", "@vinted-system/wallapop-bot", script],
            http_url: Some("http://localhost:4706"),
            port: 4706,
            ready_marker: "Wallapop-Bot listening",
        },
        ServiceDef {
            name: "ebay-bot",
            args: vec!["run", "-w", "@vinted-system/ebay-bot", script],
            http_url: Some("http://localhost:4707"),
            port: 4707,
            ready_marker: "eBay Bot listening",
        },
        // NOTE: ebay-uk runs in the same bot binary via `EBAY_MARKET=uk` env
        // var (see ecosystem.config.cjs). The Tauri-Supervisor doesn't yet
        // support per-service env-vars — eBay-UK is therefore a backlog item.
        // The dashboard's /api/home/status entry for it shows
        // `loggedIn=false` until that's wired up; no functional impact.
        ServiceDef {
            name: "etsy-bot",
            args: vec!["run", "-w", "@vinted-system/etsy-bot", script],
            http_url: Some("http://localhost:4709"),
            port: 4709,
            ready_marker: "Etsy Bot listening",
        },
        ServiceDef {
            name: "grailed-bot",
            args: vec!["run", "-w", "@vinted-system/grailed-bot", script],
            http_url: Some("http://localhost:4710"),
            port: 4710,
            ready_marker: "Grailed Bot listening",
        },
        ServiceDef {
            name: "fb-marketplace-bot",
            args: vec!["run", "-w", "@vinted-system/fb-marketplace-bot", script],
            http_url: Some("http://localhost:4711"),
            port: 4711,
            ready_marker: "FB-Marketplace Bot listening",
        },
        ServiceDef {
            name: "vestiaire-bot",
            args: vec!["run", "-w", "@vinted-system/vestiaire-bot", script],
            http_url: Some("http://localhost:4712"),
            port: 4712,
            ready_marker: "Vestiaire Bot listening",
        },
        ServiceDef {
            name: "whatnot-bot",
            args: vec!["run", "-w", "@vinted-system/whatnot-bot", script],
            http_url: Some("http://localhost:4713"),
            port: 4713,
            ready_marker: "Whatnot Bot listening",
        },
        ServiceDef {
            name: "leboncoin-bot",
            args: vec!["run", "-w", "@vinted-system/leboncoin-bot", script],
            http_url: Some("http://localhost:4714"),
            port: 4714,
            ready_marker: "Leboncoin-bot API listening",
        },
        ServiceDef {
            name: "marktplaats-bot",
            args: vec!["run", "-w", "@vinted-system/marktplaats-bot", script],
            http_url: Some("http://localhost:4715"),
            port: 4715,
            ready_marker: "Marktplaats-bot API listening",
        },
        ServiceDef {
            name: "willhaben-bot",
            args: vec!["run", "-w", "@vinted-system/willhaben-bot", script],
            http_url: Some("http://localhost:4716"),
            port: 4716,
            ready_marker: "Willhaben-bot API listening",
        },
        ServiceDef {
            name: "shopify-bot",
            args: vec!["run", "-w", "@vinted-system/shopify-bot", script],
            http_url: Some("http://localhost:4717"),
            port: 4717,
            ready_marker: "Shopify-bot API listening",
        },
        ServiceDef {
            name: "woocommerce-bot",
            args: vec!["run", "-w", "@vinted-system/woocommerce-bot", script],
            http_url: Some("http://localhost:4718"),
            port: 4718,
            ready_marker: "Woocommerce-bot API listening",
        },
        ServiceDef {
            name: "poshmark-bot",
            args: vec!["run", "-w", "@vinted-system/poshmark-bot", script],
            http_url: Some("http://localhost:4719"),
            port: 4719,
            ready_marker: "Poshmark-bot API listening",
        },
        // NOTE: dashboard is intentionally NOT here — Tauri starts it itself
        // via `beforeDevCommand` in tauri.conf.json (also on :5173).
    ]
}

/// Kill anything holding `port`. Runs `lsof -ti :PORT` + `kill -9`.
/// Best effort — errors are logged but not fatal.
fn free_port(port: u16) -> Vec<u32> {
    #[cfg(unix)]
    let pids: Vec<u32> = {
        let out = match Command::new("/usr/sbin/lsof").arg("-ti").arg(format!(":{}", port)).output() {
            Ok(o) if o.status.success() => o,
            _ => return Vec::new(),
        };
        String::from_utf8_lossy(&out.stdout)
            .lines()
            .filter_map(|l| l.trim().parse().ok())
            .collect()
    };
    #[cfg(windows)]
    let pids: Vec<u32> = {
        // `netstat -ano` lists all sockets with PID. Filter for our port +
        // LISTENING state. The PID is the last whitespace-separated token.
        let out = match Command::new("netstat").args(["-ano"]).output() {
            Ok(o) if o.status.success() => o,
            _ => return Vec::new(),
        };
        let needle_a = format!(":{} ", port);   // port followed by space
        let needle_b = format!(":{}\r", port);  // …or CRLF (Windows)
        String::from_utf8_lossy(&out.stdout)
            .lines()
            .filter(|l| (l.contains(&needle_a) || l.contains(&needle_b)) && l.contains("LISTENING"))
            .filter_map(|l| l.split_whitespace().last().and_then(|tok| tok.parse::<u32>().ok()))
            .collect()
    };

    for pid in &pids {
        #[cfg(unix)]
        let _ = Command::new("/bin/kill").arg("-9").arg(pid.to_string()).output();
        #[cfg(windows)]
        let _ = Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/F", "/T"])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    }
    if !pids.is_empty() {
        // Give OS a moment to release the port.
        std::thread::sleep(std::time::Duration::from_millis(500));
    }
    pids
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
        // If the installer included a bundled payload, prefer the extracted
        // system + npm over the host-machine versions. The caller passed in
        // a repo_root from find_repo_root() but for a "fat install" that's
        // the read-only resources dir — we want the user-writable extract.
        let (repo_root, npm_path) = if let Some((sys, npm, browsers)) = prepare_bundled_payload() {
            // Make the bundled Playwright browsers discoverable for all
            // child processes — set the env var globally so node + Playwright
            // pick it up. Done in our own process so spawned children inherit.
            std::env::set_var("PLAYWRIGHT_BROWSERS_PATH", &browsers);
            // Also expose the bundled-system root for any tooling that reads it.
            std::env::set_var("VINTED_SYSTEM_ROOT", &sys);
            std::env::set_var("VINTED_SYSTEM_NPM", &npm);
            eprintln!("[supervisor] Using bundled payload: system={} npm={}", sys.display(), npm.display());
            (sys, npm)
        } else {
            (repo_root, resolve_npm_path())
        };
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
            "Supervisor bootstrap (staged) — npm: {}  cwd: {}",
            self.npm_path.display(),
            self.repo_root.display()
        ));

        // ── Staged boot ───────────────────────────────────────────────────
        // Starting 10+ npm processes at once spikes CPU, races on port
        // binding, and made earlier versions look "stuck". We boot in three
        // phases, each in its own thread so setup() returns immediately and
        // the webview can show the soft "Orchestrator startet…"-banner.
        //
        // Phase 1 — Core (immediate):
        //   orchestrator, cj-service. Without these nothing else is useful.
        //
        // Phase 2 — Primary marketplace (after Phase 1 health-OK):
        //   vinted-bot.
        //
        // Phase 3 — Secondary marketplaces (3 s apart, parallel to nothing):
        //   kleinanzeigen, depop, ebay-de.
        //
        // Skipped at boot — high-risk / rarely-used bots stay dormant until
        // the user explicitly starts them from the dashboard:
        //   mercari, wallapop, ebay-uk, etsy, grailed, fb-marketplace,
        //   vestiaire, whatnot.
        const PHASE_1: &[&str] = &["orchestrator", "cj-service"];
        const PHASE_2: &[&str] = &["vinted-bot"];
        const PHASE_3: &[&str] = &["kleinanzeigen-bot", "depop-bot", "ebay-bot"];

        // Phase 1 fires immediately, sequential within phase (small set).
        for name in PHASE_1 {
            if let Some(def) = self.defs.iter().find(|d| d.name == *name).cloned() {
                self.start_one(app, &def);
            }
        }

        // Phases 2 + 3 run in a background thread so the setup() handler
        // doesn't block. Webview stays responsive throughout.
        let this = self.clone();
        let app2 = app.clone();
        thread::spawn(move || {
            // Wait for orchestrator to bind its port before we add load.
            this.record_log(&app2, "supervisor", "stdout", "Waiting for orchestrator readiness (max 30 s)…");
            for _ in 0..30 {
                std::thread::sleep(std::time::Duration::from_secs(1));
                if probe_health("http://localhost:4700/health") {
                    this.record_log(&app2, "supervisor", "stdout", "Orchestrator ready → starting Phase 2 (Vinted)");
                    break;
                }
            }

            for name in PHASE_2 {
                if let Some(def) = this.defs.iter().find(|d| d.name == *name).cloned() {
                    this.start_one(&app2, &def);
                }
            }

            // Stagger Phase 3 so we don't fork 3 npm processes at the same
            // instant — saves ~30% peak CPU on cold boot.
            std::thread::sleep(std::time::Duration::from_secs(3));
            this.record_log(&app2, "supervisor", "stdout", "Starting Phase 3 (KA + Depop + eBay-DE, 3 s apart)");
            for name in PHASE_3 {
                if let Some(def) = this.defs.iter().find(|d| d.name == *name).cloned() {
                    this.start_one(&app2, &def);
                    std::thread::sleep(std::time::Duration::from_secs(3));
                }
            }
            this.record_log(&app2, "supervisor", "stdout",
                "Staged boot complete. Optional bots (mercari/wallapop/etsy/grailed/fb/vestiaire/whatnot) NOT auto-started — start them from the dashboard when needed.");
        });
    }

    pub fn start_one(self: &Arc<Self>, app: &AppHandle, def: &ServiceDef) {
        self.update_status(app, def.name, "starting", None, None, def.http_url);

        // Pre-flight: kill any stale process still holding the port.
        let killed = free_port(def.port);
        if !killed.is_empty() {
            self.record_log(
                app,
                def.name,
                "stdout",
                &format!("Freed port {}: killed stale pid(s) {:?}", def.port, killed),
            );
        }

        let mut cmd = Command::new(&self.npm_path);
        cmd.args(&def.args)
            .current_dir(&self.repo_root)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .env("FORCE_COLOR", "0")
            .env("CI", "1"); // make some tools less chatty / non-interactive

        // CRITICAL: When the .app/.exe is launched via the OS shell (Finder
        // on Mac, Explorer on Windows), it inherits a minimal PATH that does
        // NOT include Node.js install dirs. npm spawn appears to succeed but
        // every grandchild crashes because `node` isn't found. Symptom: app
        // shows 0 children, no orchestrator, no error visible to the user.
        //
        // Fix: explicitly add the common Node install dirs to PATH so
        // `tsx → node → orchestrator` chain can resolve.
        let existing_path = std::env::var("PATH").unwrap_or_default();
        let sep = if cfg!(windows) { ";" } else { ":" };
        #[cfg(unix)]
        let node_dirs: &[&str] = &[
            "/opt/homebrew/bin",                        // Apple Silicon Homebrew
            "/usr/local/bin",                           // Intel Homebrew + nodejs.org installer
            "/opt/homebrew/opt/node/bin",
            "/usr/local/opt/node/bin",
        ];
        #[cfg(windows)]
        let node_dirs: &[&str] = &[
            // Default install location of the nodejs.org MSI installer
            r"C:\Program Files\nodejs",
            r"C:\Program Files (x86)\nodejs",
            // nvm-windows default
            r"C:\Users\Public\nodejs",
        ];
        let augmented_path = node_dirs.iter()
            .filter(|p| !existing_path.contains(*p))
            .chain(std::iter::once(&existing_path.as_str()))
            .copied()
            .collect::<Vec<_>>()
            .join(sep);
        cmd.env("PATH", augmented_path);

        // Windows: hide the console window for each npm child so the user
        // doesn't see 6 black cmd.exe popups when the app boots. Without
        // CREATE_NO_WINDOW each spawned process renders its own conhost.
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x08000000;
            cmd.creation_flags(CREATE_NO_WINDOW);
        }

        // Put each spawned npm in its own process group so we can kill the
        // entire tree (npm → tsx → node) on shutdown via killpg(). Without
        // this, only npm dies and tsx/node grandchildren become orphans
        // holding their ports indefinitely.
        #[cfg(unix)]
        unsafe {
            cmd.pre_exec(|| {
                if libc::setpgid(0, 0) == -1 {
                    return Err(std::io::Error::last_os_error());
                }
                Ok(())
            });
        }

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

        // Exit watcher + auto-restart on crash. Without this, a single
        // service crash takes that marketplace offline until the user
        // restarts the whole app. Worse: the user often doesn't notice
        // (the dashboard still loads from orchestrator). With auto-restart
        // a crashed bot is back online in ~5 s.
        let this = self.clone();
        let app4 = app.clone();
        let key = def.name.to_string();
        let http_url_owned = http_url;
        let def_clone = def.clone();
        thread::spawn(move || {
            let mut child = match this.children.lock().unwrap().remove(&key) {
                Some(c) => c,
                None => return,
            };
            let exit = child.wait();
            let code = exit.ok().and_then(|s| s.code());

            // Code 0 = clean exit (e.g. user clicked Stop) → don't restart.
            // Non-zero / signal kill / OOM → restart with exponential backoff.
            // The user can still hit "Stop" in the dashboard to genuinely
            // halt a service (stop_one() removes it from children before
            // SIGKILL, so this watcher exits early via the None branch).
            match code {
                Some(0) => {
                    this.update_status(&app4, &key, "exited", Some(pid), code, http_url_owned);
                }
                _ => {
                    this.update_status(&app4, &key, "failed", Some(pid), code, http_url_owned);
                    this.record_log(&app4, &key, "stderr",
                        &format!("Service exited with code {:?} — restarting in 5s", code));
                    std::thread::sleep(std::time::Duration::from_secs(5));
                    // Only restart if the user hasn't manually stopped us in
                    // the meantime (stop_all clears `started`, which we'd
                    // honour by skipping the respawn).
                    if *this.started.lock().unwrap() {
                        this.start_one(&app4, &def_clone);
                    }
                }
            }
        });
    }

    pub fn stop_one(self: &Arc<Self>, name: &str) {
        // Resolve port BEFORE removing from children map so we have it.
        let port = self.def_for(name).map(|d| d.port);
        if let Some(mut child) = self.children.lock().unwrap().remove(name) {
            let pid = child.id();

            // Step 1: Kill the entire process tree. npm typically spawns
            // tsx, tsx spawns node, node spawns playwright/chromium. We
            // need ALL of them dead, not just npm.
            #[cfg(unix)]
            unsafe {
                // pre_exec(setpgid) put the child in its own process group
                // — killpg targets that group + every descendant.
                let pgid = pid as i32;
                if pgid > 0 {
                    libc::killpg(pgid, libc::SIGTERM);
                    std::thread::sleep(std::time::Duration::from_millis(300));
                    libc::killpg(pgid, libc::SIGKILL);
                }
            }
            #[cfg(windows)]
            {
                // Windows has no process groups in the Unix sense. The
                // canonical "kill the whole tree" idiom is `taskkill /T /F`.
                //   /T  → kill child processes as well
                //   /F  → force-terminate (equivalent to SIGKILL)
                let _ = Command::new("taskkill")
                    .args(["/PID", &pid.to_string(), "/T", "/F"])
                    .stdout(Stdio::null())
                    .stderr(Stdio::null())
                    .status();
            }
            let _ = child.kill();
            let _ = child.wait();
        }
        // Step 2: Belt-and-braces — kill anyone still holding the port.
        // `tsx watch` is notorious for double-forking; the tree-kill doesn't
        // always catch every descendant. free_port() catches the survivors.
        if let Some(p) = port {
            let _ = free_port(p);
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

    /// Used by the auto-updater after a successful git pull to bounce every
    /// service. Unlike `start_all_once` this is not guarded — it always fires.
    pub fn restart_all(self: &Arc<Self>, app: &AppHandle) {
        self.stop_all();
        std::thread::sleep(std::time::Duration::from_millis(500));
        for def in self.defs.clone() {
            self.start_one(app, &def);
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
/// Lightweight blocking health-probe used by the staged-boot waiter. Pure
/// blocking std::net so we don't pull in tokio for one TCP-connect check —
/// the boot thread is already on its own OS thread, blocking is fine.
fn probe_health(url: &str) -> bool {
    // Extract host:port from "http://localhost:PORT/path"
    let after_scheme = url.split("://").nth(1).unwrap_or(url);
    let host_port = after_scheme.split('/').next().unwrap_or(after_scheme);
    let addr = if host_port.contains(':') {
        host_port.to_string()
    } else {
        format!("{}:80", host_port)
    };
    match std::net::TcpStream::connect_timeout(
        &match addr.to_socket_addrs() {
            Ok(mut iter) => match iter.next() {
                Some(a) => a,
                None => return false,
            },
            Err(_) => return false,
        },
        std::time::Duration::from_secs(2),
    ) {
        Ok(_) => true,
        Err(_) => false,
    }
}

fn resolve_npm_path() -> PathBuf {
    if let Ok(v) = std::env::var("VINTED_SYSTEM_NPM") {
        let p = PathBuf::from(v);
        if p.exists() {
            return p;
        }
    }
    #[cfg(unix)]
    let candidates: &[&str] = &[
        "/opt/homebrew/bin/npm",
        "/usr/local/bin/npm",
        "/usr/bin/npm",
        "/opt/homebrew/opt/node/bin/npm",
    ];
    #[cfg(windows)]
    let candidates: &[&str] = &[
        // nodejs.org MSI installer
        r"C:\Program Files\nodejs\npm.cmd",
        r"C:\Program Files (x86)\nodejs\npm.cmd",
        // nvm-windows
        r"C:\Users\Public\nodejs\npm.cmd",
    ];
    for c in candidates {
        let p = PathBuf::from(c);
        if p.exists() {
            return p;
        }
    }
    // Try `which` / `where` to fall back to whatever shell-PATH resolves.
    #[cfg(unix)]
    if let Ok(out) = Command::new("/bin/sh").arg("-lc").arg("which npm").output() {
        if out.status.success() {
            let path = String::from_utf8_lossy(&out.stdout).trim().to_string();
            if !path.is_empty() {
                return PathBuf::from(path);
            }
        }
    }
    #[cfg(windows)]
    if let Ok(out) = Command::new("where").arg("npm.cmd").output() {
        if out.status.success() {
            // `where` can return multiple paths line-by-line — take the first.
            if let Some(first) = String::from_utf8_lossy(&out.stdout).lines().next() {
                let path = first.trim().to_string();
                if !path.is_empty() {
                    return PathBuf::from(path);
                }
            }
        }
    }
    PathBuf::from(if cfg!(windows) { "npm.cmd" } else { "npm" })
}

// ─────────────────────────────────────────────────────────────────────────────
// Bundled-payload extraction — "fat installer" support
//
// When the app is built with `scripts/stage-bundle.mjs` run on the CI runner
// before `tauri build`, the installer (.msi / .exe / .dmg) ships with three
// payload directories embedded as resources:
//
//   resources/system/            ← the Vinted-System monorepo source + node_modules
//   resources/node/              ← portable Node.js for the target OS
//   resources/playwright-browsers/← Playwright Chromium pre-downloaded
//
// On first launch we copy them out of the read-only resources directory into
// a user-writable location (`%LOCALAPPDATA%\Blackruby\` on Windows,
// `~/Library/Application Support/Blackruby/` on macOS), so node_modules can
// be updated by `npm install` later and Playwright can write its profile
// cache.
//
// `prepare_bundled_payload()` returns the path to the user-writable extract
// once it exists. On subsequent launches it's a no-op (returns the existing
// dir). In dev mode (no bundled resources) it returns None and the existing
// repo-root resolution kicks in.
// ─────────────────────────────────────────────────────────────────────────────

/// Where extracted payload lives on the user's machine.
fn user_install_dir() -> Option<PathBuf> {
    #[cfg(windows)]
    {
        std::env::var_os("LOCALAPPDATA").map(|d| PathBuf::from(d).join("Blackruby"))
    }
    #[cfg(unix)]
    {
        // ~/Library/Application Support/Blackruby on Mac.
        // ~/.local/share/Blackruby on Linux (XDG fallback).
        let home = std::env::var_os("HOME").map(PathBuf::from)?;
        if cfg!(target_os = "macos") {
            Some(home.join("Library").join("Application Support").join("Blackruby"))
        } else {
            Some(home.join(".local").join("share").join("Blackruby"))
        }
    }
}

/// Locate the read-only `resources/` directory shipped inside the installed
/// app bundle. Tauri places resources next to the executable on Windows and
/// inside `Contents/Resources/` on macOS.
fn bundled_resources_dir() -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    let exe_dir = exe.parent()?;
    #[cfg(windows)]
    {
        // Windows MSI/NSIS: <install-dir>\Blackruby.exe + <install-dir>\resources\
        let candidate = exe_dir.join("resources");
        if candidate.join("system").exists() { return Some(candidate); }
    }
    #[cfg(target_os = "macos")]
    {
        // <App>.app/Contents/MacOS/<exe> → ../Resources/
        let candidate = exe_dir.parent()?.join("Resources");
        if candidate.join("system").exists() { return Some(candidate); }
    }
    None
}

/// Copy a directory tree recursively. Skips if dest already exists with
/// roughly the right shape (idempotent on relaunch).
fn copy_dir_recursive(src: &Path, dest: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(dest)?;
    for entry in std::fs::read_dir(src)? {
        let entry = entry?;
        let src_path = entry.path();
        let dest_path = dest.join(entry.file_name());
        let ty = entry.file_type()?;
        if ty.is_dir() {
            copy_dir_recursive(&src_path, &dest_path)?;
        } else if ty.is_symlink() {
            // npm symlinks workspaces inside node_modules — re-create.
            #[cfg(unix)]
            {
                let target = std::fs::read_link(&src_path)?;
                if dest_path.exists() { std::fs::remove_file(&dest_path).ok(); }
                std::os::unix::fs::symlink(&target, &dest_path)?;
            }
            #[cfg(windows)]
            {
                // Windows: copy contents instead of recreating symlink (no
                // privileges needed for files).
                let target = std::fs::read_link(&src_path)?;
                if target.is_dir() { copy_dir_recursive(&target, &dest_path)?; }
                else { std::fs::copy(&target, &dest_path)?; }
            }
        } else {
            std::fs::copy(&src_path, &dest_path)?;
        }
    }
    Ok(())
}

/// Extract the bundled payload on first launch. Returns `(system_dir, npm_path,
/// browsers_dir)` if the app is a "fat install"; returns `None` otherwise so
/// the existing dev-mode + manual-repo-pick flow kicks in.
pub fn prepare_bundled_payload() -> Option<(PathBuf, PathBuf, PathBuf)> {
    let resources = bundled_resources_dir()?;
    let target = user_install_dir()?;
    std::fs::create_dir_all(&target).ok()?;

    // Marker file written after a successful extract — avoids re-copying
    // the ~1 GB tree on every launch.
    let marker = target.join(".extracted-v1");
    if !marker.exists() {
        eprintln!("[bundled-payload] First launch — extracting {} -> {}", resources.display(), target.display());
        for sub in &["system", "node", "playwright-browsers"] {
            let s = resources.join(sub);
            let d = target.join(sub);
            if d.exists() { std::fs::remove_dir_all(&d).ok(); }
            if let Err(e) = copy_dir_recursive(&s, &d) {
                eprintln!("[bundled-payload] copy failed for {}: {}", sub, e);
                return None;
            }
        }
        // Marker after all three are in place.
        std::fs::write(&marker, format!("extracted at {}", chrono::Utc::now())).ok();
        eprintln!("[bundled-payload] Extract complete");
    }

    let system_dir = target.join("system");
    #[cfg(windows)]
    let npm = target.join("node").join("npm.cmd");
    #[cfg(unix)]
    let npm = target.join("node").join("bin").join("npm");

    if !system_dir.exists() || !npm.exists() {
        eprintln!("[bundled-payload] post-extract files missing — falling back to dev mode");
        return None;
    }

    let browsers = target.join("playwright-browsers");
    Some((system_dir, npm, browsers))
}

/// Persistent config file — lets an installed .app remember where the repo
/// lives after the user locates it once (via the picker dialog).
fn config_path() -> Option<PathBuf> {
    let home = std::env::var_os("HOME").map(PathBuf::from)?;
    Some(home.join(".vinted-system").join("config.json"))
}

fn read_saved_root() -> Option<PathBuf> {
    let cfg = config_path()?;
    let raw = std::fs::read_to_string(&cfg).ok()?;
    // Tiny hand-rolled parser — avoids pulling serde_json just for one field.
    for line in raw.lines() {
        let trimmed = line.trim();
        if let Some(rest) = trimmed.strip_prefix("\"repo_root\":") {
            let value = rest.trim().trim_end_matches(',').trim();
            if value.starts_with('"') && value.ends_with('"') && value.len() >= 2 {
                let p = PathBuf::from(&value[1..value.len() - 1]);
                if is_repo_root(&p) {
                    return Some(p);
                }
            }
        }
    }
    None
}

pub fn save_saved_root(root: &Path) -> std::io::Result<()> {
    if let Some(cfg) = config_path() {
        if let Some(parent) = cfg.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let body = format!(
            "{{\n  \"repo_root\": \"{}\"\n}}\n",
            root.display().to_string().replace('"', "\\\"")
        );
        std::fs::write(cfg, body)?;
    }
    Ok(())
}

/// Attempt to locate the Vinted-System repo root. Order:
///   1. env var VINTED_SYSTEM_ROOT
///   2. saved config ~/.vinted-system/config.json (populated after first pick)
///   3. walk parents of current_exe — works when running from
///      target/release/bundle/macos/, not from /Applications
///   4. CARGO_MANIFEST_DIR (dev build only)
///   5. well-known default install location
pub fn find_repo_root() -> Option<PathBuf> {
    if let Ok(env) = std::env::var("VINTED_SYSTEM_ROOT") {
        let p = PathBuf::from(env);
        if is_repo_root(&p) {
            return Some(p);
        }
    }
    if let Some(saved) = read_saved_root() {
        return Some(saved);
    }
    if let Ok(exe) = std::env::current_exe() {
        let mut cur = exe.parent()?.to_path_buf();
        for _ in 0..12 {
            if is_repo_root(&cur) {
                let _ = save_saved_root(&cur);
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
            let canon = dev.canonicalize().ok()?;
            let _ = save_saved_root(&canon);
            return Some(canon);
        }
    }
    // Well-known default install location — the user's home is always known
    // when the app is GUI-launched, so this is a reliable last resort.
    if let Some(home) = std::env::var_os("HOME") {
        // Try known install locations
        for subpath in [
            "Desktop/Vinted/system",
            "Vinted/system",
            "Desktop/Blackruby/system",
        ] {
            let guess = PathBuf::from(&home).join(subpath);
            if is_repo_root(&guess) {
                let _ = save_saved_root(&guess);
                return Some(guess);
            }
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
