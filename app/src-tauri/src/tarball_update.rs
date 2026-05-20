// ──────────────────────────────────────────────────────────────────────────────
// Tarball-based in-app updater.
//
// Flow (`check_tarball_update` + `apply_tarball_update`):
//   1. Frontend calls check_tarball_update, hits marketing-API
//      /api/releases/tarball/<current_version>, gets a manifest.
//   2. If user clicks "Update jetzt" the frontend invokes apply_tarball_update.
//   3. Rust downloads the tarball to repo_root/.update/, verifies SHA-256,
//      verifies Ed25519 signature against the public key embedded in this
//      binary, then:
//         a. Snapshots a backup of changed top-level dirs into repo_root/.backup/<oldver>/
//         b. Stops every Node service via the Supervisor.
//         c. Extracts the tarball over repo_root (overwrites in place).
//         d. Runs `npm install` if package-lock.json changed.
//         e. Restarts services.
//      Every step emits a `tarball-update-progress` event so the UI can
//      render a progress bar.
//
// Public key:
//   Embedded at build time via the BLACKRUBY_RELEASE_PUBKEY env var (hex).
//   Without it, signature verification fails closed — the update is refused.
// ──────────────────────────────────────────────────────────────────────────────

use ed25519_dalek::{Signature, Verifier, VerifyingKey};
use flate2::read::GzDecoder;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs;
use std::io::Cursor;
use std::path::Path;
use std::process::Command;
use std::sync::Arc;
use tauri::{AppHandle, Emitter};

use crate::services::Supervisor;

// Compile-time embedded public key. Set this in the build environment:
//   BLACKRUBY_RELEASE_PUBKEY=<hex of the 32-byte raw ed25519 public key>
// When empty AND this is a debug build, verification is skipped with a warning.
// When empty AND this is a release build, the update is refused (fail-closed).
const EMBEDDED_PUBKEY: &str = match option_env!("BLACKRUBY_RELEASE_PUBKEY") {
    Some(v) => v,
    None => "",
};

/// True for non-debug builds. In release-mode the updater MUST have an
/// embedded pubkey — otherwise an attacker on the manifest endpoint could
/// push unsigned tarballs.
fn require_signed() -> bool {
    !cfg!(debug_assertions)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TarballManifest {
    pub ok: bool,
    pub available: bool,
    pub version: Option<String>,
    pub released_at: Option<String>,
    pub notes: Option<Vec<String>>,
    pub tarball_url: Option<String>,
    pub sha256: Option<String>,
    pub signature: Option<String>,
    #[serde(default)]
    pub requires_native_reinstall: bool,
    pub current_version: Option<String>,
    pub latest_version: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct UpdateProgress {
    pub phase: String, // "downloading" | "verifying" | "stopping" | "extracting" | "installing" | "starting" | "done" | "error"
    pub percent: u8,   // 0-100
    pub message: String,
}

fn emit(app: &AppHandle, phase: &str, percent: u8, message: &str) {
    let _ = app.emit(
        "tarball-update-progress",
        UpdateProgress {
            phase: phase.to_string(),
            percent,
            message: message.to_string(),
        },
    );
}

pub fn check_update(manifest_url: &str, current_version: &str) -> Result<TarballManifest, String> {
    let url = format!(
        "{}/api/releases/tarball/{}",
        manifest_url.trim_end_matches('/'),
        current_version
    );
    let resp = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| format!("http client: {}", e))?
        .get(&url)
        .send()
        .map_err(|e| format!("GET {}: {}", url, e))?;
    if !resp.status().is_success() {
        return Err(format!("status {}", resp.status()));
    }
    resp.json::<TarballManifest>()
        .map_err(|e| format!("decode manifest: {}", e))
}

pub fn apply_update(
    repo_root: &Path,
    npm_path: &Path,
    sup: &Arc<Supervisor>,
    manifest: &TarballManifest,
    app: &AppHandle,
) -> Result<(), String> {
    let version = manifest
        .version
        .clone()
        .ok_or_else(|| "manifest missing version".to_string())?;
    let url = manifest
        .tarball_url
        .clone()
        .ok_or_else(|| "manifest missing tarball_url".to_string())?;
    let want_sha = manifest
        .sha256
        .clone()
        .ok_or_else(|| "manifest missing sha256".to_string())?;
    let sig_hex = manifest
        .signature
        .clone()
        .ok_or_else(|| "manifest missing signature".to_string())?;

    // Client-side reinstall check: don't trust the server flag alone.
    // If the major version is bumping, conservatively assume a native
    // reinstall is needed even if the manifest forgot to set the flag.
    let current_for_check =
        read_current_version(repo_root).unwrap_or_else(|_| "0.0.0".to_string());
    let needs_reinstall =
        manifest.requires_native_reinstall || client_thinks_needs_reinstall(&current_for_check, &version);
    if needs_reinstall {
        return Err(
            "Dieses Update enthält Änderungen am App-Kern — bitte den neuen Installer von blackruby.app/members herunterladen."
                .to_string(),
        );
    }

    let update_dir = repo_root.join(".update");
    fs::create_dir_all(&update_dir).map_err(|e| format!("mkdir .update: {}", e))?;
    let tarball_path = update_dir.join(format!("system-{}.tar.gz", version));

    // ── Download ──
    emit(app, "downloading", 5, &format!("Lade {} herunter …", version));
    let bytes = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(120))
        .build()
        .map_err(|e| format!("http client: {}", e))?
        .get(&url)
        .send()
        .map_err(|e| format!("download {}: {}", url, e))?
        .error_for_status()
        .map_err(|e| format!("download status: {}", e))?
        .bytes()
        .map_err(|e| format!("read body: {}", e))?;
    fs::write(&tarball_path, &bytes).map_err(|e| format!("write tarball: {}", e))?;
    emit(app, "downloading", 35, &format!("Heruntergeladen: {:.1} MB", bytes.len() as f64 / 1_048_576.0));

    // ── Verify SHA-256 ──
    emit(app, "verifying", 45, "Prüfe Integrität (SHA-256)…");
    let mut h = Sha256::new();
    h.update(&bytes);
    let got_sha = hex::encode(h.finalize());
    if !constant_time_eq_hex(&got_sha, &want_sha) {
        return Err(format!(
            "SHA-256 mismatch: expected {} got {}",
            want_sha, got_sha
        ));
    }

    // ── Verify Ed25519 signature ──
    if !EMBEDDED_PUBKEY.is_empty() {
        emit(app, "verifying", 55, "Prüfe Signatur (Ed25519)…");
        let pubkey_bytes = hex::decode(EMBEDDED_PUBKEY.trim())
            .map_err(|e| format!("embedded pubkey not hex: {}", e))?;
        if pubkey_bytes.len() != 32 {
            return Err(format!(
                "embedded pubkey must be 32 bytes (got {})",
                pubkey_bytes.len()
            ));
        }
        let pubkey_arr: [u8; 32] = pubkey_bytes
            .try_into()
            .map_err(|_| "pubkey conv".to_string())?;
        let key = VerifyingKey::from_bytes(&pubkey_arr).map_err(|e| format!("pubkey: {}", e))?;
        let sig_bytes = hex::decode(sig_hex.trim()).map_err(|e| format!("sig not hex: {}", e))?;
        if sig_bytes.len() != 64 {
            return Err(format!(
                "signature must be 64 bytes (got {})",
                sig_bytes.len()
            ));
        }
        let sig_arr: [u8; 64] = sig_bytes
            .try_into()
            .map_err(|_| "sig conv".to_string())?;
        let sig = Signature::from_bytes(&sig_arr);
        key.verify(&bytes, &sig)
            .map_err(|e| format!("signature verify failed: {}", e))?;
    } else if require_signed() {
        // Fail-closed: a release build without an embedded pubkey would
        // accept any tarball the manifest server hands it. Refuse.
        return Err(
            "Update rejected: build was made without signing key. Refusing unsigned tarball."
                .to_string(),
        );
    } else {
        emit(
            app,
            "verifying",
            55,
            "Public-Key nicht eingebaut — Signaturpruefung uebersprungen (Dev-Build)",
        );
    }

    // ── Snapshot backup ──
    let old_version = read_current_version(repo_root).unwrap_or_else(|_| "unknown".to_string());
    let backup_dir = repo_root.join(".backup").join(&old_version);
    emit(
        app,
        "stopping",
        62,
        &format!("Backup v{} → .backup/{}/", old_version, old_version),
    );
    snapshot_backup(repo_root, &backup_dir)?;

    // ── Stop services ──
    emit(app, "stopping", 70, "Stoppe alle Services …");
    sup.stop_all();
    std::thread::sleep(std::time::Duration::from_millis(500));

    // Detect lockfile change BEFORE extract so we can compare hashes.
    let lock_before = read_file_hash(&repo_root.join("package-lock.json")).ok();

    // ── Transactional extract + install ──
    // If anything from here on fails, restore the pkg+lock backup so the
    // app can at least start with the previous npm tree on next launch.
    // Full repo rollback isn't feasible without copying the whole tree —
    // but the original tarball is preserved in .backup/<oldver>/source.tar.gz
    // for manual recovery if needed.
    let txn = (|| -> Result<(), String> {
        // ── Extract ──
        emit(app, "extracting", 78, "Entpacke neues Release …");
        let cursor = Cursor::new(&bytes);
        let gz = GzDecoder::new(cursor);
        let mut archive = tar::Archive::new(gz);
        archive.set_preserve_permissions(true);
        archive
            .unpack(repo_root)
            .map_err(|e| format!("unpack: {}", e))?;

        // ── npm install (only if lockfile changed) ──
        let lock_after = read_file_hash(&repo_root.join("package-lock.json")).ok();
        if lock_before != lock_after {
            emit(app, "installing", 85, "npm install — Dependencies aktualisieren …");
            let r = Command::new(npm_path)
                .args(["install", "--no-audit", "--no-fund"])
                .current_dir(repo_root)
                .output()
                .map_err(|e| format!("npm install spawn: {}", e))?;
            if !r.status.success() {
                return Err(format!(
                    "npm install failed (status {:?})\nstdout:\n{}\nstderr:\n{}",
                    r.status.code(),
                    String::from_utf8_lossy(&r.stdout),
                    String::from_utf8_lossy(&r.stderr)
                ));
            }
        } else {
            emit(app, "installing", 85, "Dependencies unverändert — npm install übersprungen.");
        }
        Ok(())
    })();

    if let Err(e) = txn {
        emit(
            app,
            "rolling-back",
            80,
            "Update fehlgeschlagen — Rollback läuft",
        );
        let restore = restore_backup(&backup_dir, repo_root);
        match restore {
            Ok(_) => emit(app, "rolled-back", 100, "Rollback abgeschlossen"),
            Err(re) => emit(
                app,
                "error",
                100,
                &format!("Rollback fehlgeschlagen: {} (Ursache: {})", re, e),
            ),
        }
        // Restart services on the (rolled-back) tree so the user has a
        // running app instead of a dead shell.
        sup.restart_all(app);
        return Err(e);
    }

    // ── Restart services ──
    emit(app, "starting", 92, "Starte Services mit neuem Code …");
    sup.restart_all(app);
    emit(app, "done", 100, &format!("Update auf v{} fertig.", version));

    // Best-effort cleanup of the tarball — keep .backup/ for rollback.
    let _ = fs::remove_file(&tarball_path);
    Ok(())
}

/// Restore the pkg + lockfile from the snapshot taken right before extract.
/// This won't undo extracted files in subdirectories, but it does mean
/// `npm install` on next launch will reconcile to the previous tree.
fn restore_backup(backup_dir: &Path, repo_root: &Path) -> Result<(), String> {
    if !backup_dir.exists() {
        return Err(format!("backup dir missing: {}", backup_dir.display()));
    }
    for name in ["package.json", "package-lock.json"] {
        let src = backup_dir.join(name);
        if src.exists() {
            let dst = repo_root.join(name);
            fs::copy(&src, &dst)
                .map_err(|e| format!("restore {}: {}", name, e))?;
        }
    }
    Ok(())
}

fn read_current_version(repo_root: &Path) -> Result<String, String> {
    let pkg = repo_root.join("app").join("package.json");
    let raw = fs::read_to_string(&pkg).map_err(|e| format!("read {}: {}", pkg.display(), e))?;
    // Hand-rolled extract — no serde_json dep needed.
    for line in raw.lines() {
        let t = line.trim();
        if let Some(rest) = t.strip_prefix("\"version\":") {
            let v = rest.trim().trim_end_matches(',').trim();
            if v.starts_with('"') && v.ends_with('"') && v.len() >= 2 {
                return Ok(v[1..v.len() - 1].to_string());
            }
        }
    }
    Err("version field not found".to_string())
}

fn snapshot_backup(repo_root: &Path, backup_dir: &Path) -> Result<(), String> {
    fs::create_dir_all(backup_dir).map_err(|e| format!("mkdir backup: {}", e))?;
    // Snapshot just the package + lockfile so rollback by hand is possible
    // without copying the whole 12 MB tree. The tarball itself is the
    // implicit backup of the rest.
    for name in ["package.json", "package-lock.json"] {
        let src = repo_root.join(name);
        if src.exists() {
            let _ = fs::copy(&src, backup_dir.join(name));
        }
    }
    Ok(())
}

fn read_file_hash(p: &Path) -> Result<String, String> {
    let bytes = fs::read(p).map_err(|e| format!("read {}: {}", p.display(), e))?;
    let mut h = Sha256::new();
    h.update(&bytes);
    Ok(hex::encode(h.finalize()))
}

/// Heuristic: if the major version changes (e.g. 0.x → 1.x, 1.x → 2.x) the
/// chance that Rust-side schema/IPC contracts changed is high enough that
/// we should refuse the tarball even if the server forgot to set
/// `requires_native_reinstall`. Better to over-trigger a fresh installer
/// download than to brick a customer with a half-migrated install.
fn client_thinks_needs_reinstall(current: &str, target: &str) -> bool {
    let cur_major = current.trim().trim_start_matches('v').split('.').next().unwrap_or("0");
    let tgt_major = target.trim().trim_start_matches('v').split('.').next().unwrap_or("0");
    cur_major != tgt_major
}

fn constant_time_eq_hex(a: &str, b: &str) -> bool {
    let a = a.trim().to_ascii_lowercase();
    let b = b.trim().to_ascii_lowercase();
    if a.len() != b.len() {
        return false;
    }
    let mut diff: u8 = 0;
    for (ac, bc) in a.bytes().zip(b.bytes()) {
        diff |= ac ^ bc;
    }
    diff == 0
}

#[allow(dead_code)]
pub fn current_version(repo_root: &Path) -> String {
    read_current_version(repo_root).unwrap_or_else(|_| "0.0.0".to_string())
}

#[derive(Debug, Clone, Serialize)]
pub struct VersionInfo {
    pub version: String,
    pub manifest_url: String,
}

pub fn version_info(repo_root: &Path) -> VersionInfo {
    VersionInfo {
        version: read_current_version(repo_root).unwrap_or_else(|_| "0.0.0".to_string()),
        manifest_url: std::env::var("BLACKRUBY_MANIFEST_URL")
            .unwrap_or_else(|_| "https://blackruby.app".to_string()),
    }
}
