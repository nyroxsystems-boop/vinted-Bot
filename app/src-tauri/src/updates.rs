// ──────────────────────────────────────────────────────────────────────────────
// Auto-update via git.
//
// Pragmatic: the app itself IS the git repo (it lives inside Vinted-System/).
// Updates = `git pull --ff-only origin main` + `npm install` + restart services.
//
// Limitations:
//   • Does not handle merge conflicts: if the user has uncommitted local
//     changes, the updater refuses to touch anything.
//   • If `app/src-tauri/**` changed, the Rust binary itself is stale. The
//     app tells the user to restart manually (Cmd+Q + npm run app:dev).
// ──────────────────────────────────────────────────────────────────────────────

use serde::Serialize;
use std::path::Path;
use std::process::Command;
use tauri::{AppHandle, Emitter};

#[derive(Clone, Serialize)]
pub struct UpdateInfo {
    pub available: bool,
    pub commits_behind: u32,
    pub current_sha: String,
    pub remote_sha: String,
    pub messages: Vec<String>,
    pub has_uncommitted: bool,
    pub has_rust_changes: bool,
    pub last_checked: String,
}

pub fn check_for_updates(repo_root: &Path) -> Result<UpdateInfo, String> {
    run_git(repo_root, &["fetch", "origin", "main", "--quiet"])?;

    let current = git_rev(repo_root, "HEAD")?;
    let remote = git_rev(repo_root, "origin/main")?;

    let behind_out = run_git(repo_root, &["rev-list", "--count", "HEAD..origin/main"])?;
    let commits_behind: u32 = behind_out.trim().parse().unwrap_or(0);

    let messages = if commits_behind > 0 {
        run_git(
            repo_root,
            &["log", "--format=%h %s", "-n", "10", "HEAD..origin/main"],
        )?
        .lines()
        .map(|s| s.to_string())
        .collect()
    } else {
        Vec::new()
    };

    let has_uncommitted = !run_git(repo_root, &["status", "--porcelain"])?
        .trim()
        .is_empty();

    let has_rust_changes = if commits_behind > 0 {
        let changed = run_git(repo_root, &["diff", "--name-only", "HEAD..origin/main"])?;
        changed
            .lines()
            .any(|l| l.starts_with("app/src-tauri/") || l == "Cargo.lock")
    } else {
        false
    };

    Ok(UpdateInfo {
        available: commits_behind > 0,
        commits_behind,
        current_sha: current,
        remote_sha: remote,
        messages,
        has_uncommitted,
        has_rust_changes,
        last_checked: chrono::Utc::now().to_rfc3339(),
    })
}

pub fn apply_update(repo_root: &Path, npm_path: &Path, app: &AppHandle) -> Result<UpdateInfo, String> {
    // Re-check to get a fresh view + fail fast on uncommitted changes.
    let info = check_for_updates(repo_root)?;
    if !info.available {
        emit_update(app, "noop", "Keine Updates verfügbar.");
        return Ok(info);
    }
    if info.has_uncommitted {
        return Err("Lokale, uncommittete Änderungen im Repo — Update abgebrochen.".to_string());
    }

    emit_update(app, "pulling", "Lade neue Commits von GitHub…");
    run_git(repo_root, &["pull", "--ff-only", "origin", "main"])?;

    emit_update(app, "npm-install", "Installiere aktualisierte Dependencies (npm install)…");
    let mut npm_cmd = Command::new(npm_path);
    npm_cmd.arg("install").current_dir(repo_root);
    // Suppress conhost flash on Windows for the long-running npm install.
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        npm_cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    let npm_status = npm_cmd
        .status()
        .map_err(|e| format!("npm install failed to spawn: {}", e))?;
    if !npm_status.success() {
        return Err(format!("npm install failed with status {}", npm_status));
    }

    emit_update(
        app,
        if info.has_rust_changes { "rust-changed" } else { "done" },
        if info.has_rust_changes {
            "Update angewendet. Rust-Code hat sich geändert — App bitte manuell neu starten (Cmd+Q + npm run app:dev)."
        } else {
            "Update angewendet. Services werden neu gestartet…"
        },
    );

    // Return a fresh info snapshot after pull.
    check_for_updates(repo_root)
}

fn run_git(cwd: &Path, args: &[&str]) -> Result<String, String> {
    let mut cmd = Command::new("git");
    cmd.args(args).current_dir(cwd);
    #[cfg(windows)]
    {
        // Hide the conhost window on Windows so git fetches don't blink
        // a black square every time the update-checker polls.
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    let out = cmd
        .output()
        .map_err(|e| format!("git spawn failed: {}", e))?;
    if !out.status.success() {
        return Err(format!(
            "git {:?} → {}",
            args,
            String::from_utf8_lossy(&out.stderr).trim()
        ));
    }
    Ok(String::from_utf8_lossy(&out.stdout).to_string())
}

fn git_rev(cwd: &Path, refspec: &str) -> Result<String, String> {
    Ok(run_git(cwd, &["rev-parse", refspec])?.trim().to_string())
}

fn emit_update(app: &AppHandle, state: &str, message: &str) {
    let _ = app.emit(
        "update-status",
        serde_json::json!({
            "state": state,
            "message": message,
        }),
    );
}

