// ──────────────────────────────────────────────────────────────────────────────
// Local-repo reload flow.
//
// Unlike updates.rs which pulls from git, this module handles the common
// "Claude just edited my code locally, how do I see it?" case:
//
//   • TypeScript changes in orchestrator/ vinted-bot/ temu-bot/ shared/
//       → only the Node services need to be restarted; `tsx` reads the new
//         TS on boot. Fast (~5 s).
//
//   • Changes in dashboard/src/** or app/src-tauri/src/**
//       → the shipped bundle is stale. Must run `npm run app:build`, copy
//         the new .app to /Applications, then relaunch. Slow (~2–3 min).
//
// Detection: compare latest mtime inside each watched folder against the
// bundle's build time (we read the executable's mtime — it's rewritten on
// every build).
// ──────────────────────────────────────────────────────────────────────────────

use serde::Serialize;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::SystemTime;
use tauri::{AppHandle, Emitter};

#[derive(Clone, Serialize)]
pub struct ReloadPlan {
    /// True when reload_all would need to rebuild the bundle.
    pub needs_rebuild: bool,
    /// True when only the Node services need bouncing.
    pub needs_services_restart: bool,
    /// Files detected as newer than the bundle. Capped at 20 entries.
    pub changed: Vec<String>,
    /// Seconds since the bundle was built.
    pub bundle_age_seconds: u64,
}

/// Scan the repo and figure out what kind of reload is needed.
pub fn plan_reload(repo_root: &Path) -> ReloadPlan {
    let bundle_mtime = bundle_built_at();
    let mut changed: Vec<(String, SystemTime)> = Vec::new();

    // Directories whose changes require a full .app rebuild.
    let rebuild_watch = ["dashboard/src", "app/src-tauri/src", "app/src-tauri/icons"];
    // Directories whose changes only require a Node-service restart.
    let services_watch = [
        "orchestrator/src",
        "vinted-bot/src",
        "temu-bot/src",
        "shared/src",
    ];

    let mut needs_rebuild = false;
    let mut needs_services_restart = false;

    for rel in rebuild_watch {
        let newer = collect_newer(repo_root.join(rel), bundle_mtime);
        if !newer.is_empty() {
            needs_rebuild = true;
            for (p, t) in newer {
                changed.push((format!("🔨 {}", p), t));
            }
        }
    }
    for rel in services_watch {
        let newer = collect_newer(repo_root.join(rel), bundle_mtime);
        if !newer.is_empty() {
            needs_services_restart = true;
            for (p, t) in newer {
                changed.push((format!("🔁 {}", p), t));
            }
        }
    }

    // Most-recent first, capped.
    changed.sort_by(|a, b| b.1.cmp(&a.1));
    changed.truncate(20);

    let bundle_age_seconds = bundle_mtime
        .and_then(|t| SystemTime::now().duration_since(t).ok())
        .map(|d| d.as_secs())
        .unwrap_or(u64::MAX);

    ReloadPlan {
        needs_rebuild,
        needs_services_restart,
        changed: changed.into_iter().map(|(p, _)| p).collect(),
        bundle_age_seconds,
    }
}

fn bundle_built_at() -> Option<SystemTime> {
    // Prefer the installed .app in /Applications — that's what the user
    // actually launches. Fall back to the target/release build dir.
    let candidates = [
        PathBuf::from("/Applications/Vinted-System.app/Contents/MacOS/vinted-system-app"),
    ];
    for p in &candidates {
        if let Ok(meta) = std::fs::metadata(p) {
            if let Ok(t) = meta.modified() {
                return Some(t);
            }
        }
    }
    None
}

fn collect_newer(dir: PathBuf, cutoff: Option<SystemTime>) -> Vec<(String, SystemTime)> {
    let Some(cutoff) = cutoff else { return Vec::new() };
    let mut out = Vec::new();
    walk_dir(&dir, &mut |path, mtime| {
        if mtime > cutoff {
            let rel = path
                .strip_prefix(std::env::current_dir().unwrap_or_default())
                .unwrap_or(path)
                .display()
                .to_string();
            out.push((rel, mtime));
        }
    });
    out
}

fn walk_dir(dir: &Path, cb: &mut dyn FnMut(&Path, SystemTime)) {
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        let path = entry.path();
        let name = entry.file_name();
        let name_str = name.to_string_lossy();
        if name_str == "node_modules" || name_str == "target" || name_str == "dist" {
            continue;
        }
        if path.is_dir() {
            walk_dir(&path, cb);
        } else if let Ok(meta) = entry.metadata() {
            if let Ok(mtime) = meta.modified() {
                cb(&path, mtime);
            }
        }
    }
}

/// Emit a single progress event the dashboard can render.
pub fn emit_progress(app: &AppHandle, state: &str, message: &str) {
    let _ = app.emit(
        "reload-progress",
        serde_json::json!({
            "state": state,
            "message": message,
        }),
    );
}

/// Run `npm run app:build`, copy the result into /Applications, and re-register
/// with LaunchServices. Blocks until done. Returns the path to the installed
/// bundle on success.
pub fn rebuild_and_install(
    repo_root: &Path,
    npm_path: &Path,
    app: &AppHandle,
) -> Result<PathBuf, String> {
    emit_progress(app, "building", "App wird neu gebaut (dauert 2–3 Min)…");
    let status = Command::new(npm_path)
        .args(["run", "app:build"])
        .current_dir(repo_root)
        .env("CI", "1")
        .status()
        .map_err(|e| format!("npm app:build spawn failed: {}", e))?;
    if !status.success() {
        return Err(format!("npm run app:build failed with status {}", status));
    }

    let built = repo_root
        .join("app/src-tauri/target/release/bundle/macos/Vinted-System.app");
    if !built.exists() {
        return Err(format!("build succeeded but {} missing", built.display()));
    }

    emit_progress(app, "installing", "Installiere frische App in /Applications…");
    let target = PathBuf::from("/Applications/Vinted-System.app");
    // Remove old (ignore errors — it may not exist).
    let _ = std::process::Command::new("/bin/rm")
        .args(["-rf", target.to_str().unwrap()])
        .status();
    let cp = std::process::Command::new("/bin/cp")
        .args(["-R", built.to_str().unwrap(), "/Applications/"])
        .status()
        .map_err(|e| format!("cp failed: {}", e))?;
    if !cp.success() {
        return Err(format!("cp -R failed with status {}", cp));
    }

    // Re-register with LaunchServices so the Dock picks up the new icon/version.
    let _ = std::process::Command::new(
        "/System/Library/Frameworks/CoreServices.framework/Versions/A/Frameworks/LaunchServices.framework/Versions/A/Support/lsregister",
    )
    .arg("-f")
    .arg(target.to_str().unwrap())
    .output();

    Ok(target)
}
