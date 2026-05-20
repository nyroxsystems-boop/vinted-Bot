# Blackruby — Build & Release Guide

Build the desktop app for macOS and Windows. Outputs land in
`dist/release/<version>/` alongside a signed `releases.json` manifest that the
marketing API serves at `/api/releases/latest`.

---

## One-Liner

```bash
./scripts/release.sh
```

That produces installers for whichever host you're on (Mac → `.dmg`, Windows → `.msi` + `.exe`). The script then:
1. Builds the React dashboard (`npm run -w @vinted-system/dashboard build`)
2. Calls Tauri to compile the Rust shell + bundle
3. Copies artifacts into `dist/release/<version>/`
4. Computes SHA-256 and writes `releases.json` for the API

---

## macOS

### Prerequisites
```bash
xcode-select --install
rustup target add aarch64-apple-darwin x86_64-apple-darwin
```

### Universal Build (Apple Silicon + Intel)
```bash
npm run -w @vinted-system/app tauri:build:mac
```
Output: `app/src-tauri/target/universal-apple-darwin/release/bundle/dmg/Blackruby_<version>_universal.dmg`

### Native-only (faster)
```bash
npm run -w @vinted-system/app tauri:build
```

### Notarization (optional, removes Gatekeeper warning)
Set before building:
```bash
export APPLE_ID="you@example.com"
export APPLE_PASSWORD="<app-specific-password>"  # generate at appleid.apple.com
export APPLE_TEAM_ID="ABCD12EFGH"
```
Tauri 2 picks these up automatically. Without them the build still produces a working `.dmg`, just with the Gatekeeper "unidentified developer" warning on first launch (user can right-click → Open to bypass once).

---

## Windows

### Prerequisites (on Windows)
```powershell
rustup target add x86_64-pc-windows-msvc
# WiX Toolset 3.11 — cargo-tauri downloads automatically when missing
```

### Build
```bash
npm run -w @vinted-system/app tauri:build:win
```
Output:
- MSI: `app/src-tauri/target/x86_64-pc-windows-msvc/release/bundle/msi/Blackruby_<version>_x64_en-US.msi`
- NSIS: `app/src-tauri/target/x86_64-pc-windows-msvc/release/bundle/nsis/Blackruby_<version>_x64-setup.exe`

### Cross-compile from Mac (experimental)
```bash
BLACKRUBY_BUILD_WIN=1 ./scripts/release.sh
```
Requires `cargo-xwin` + Windows SDK. The CI path is more reliable.

### Code-signing (optional, removes SmartScreen warning)
Set before building:
```bash
export TAURI_SIGNING_PRIVATE_KEY=<base64-key>
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD=<password>
```
Or configure an EV-cert thumbprint in `tauri.conf.json` under `bundle.windows.certificateThumbprint`.

---

## Releases JSON

After `./scripts/release.sh` finishes, `marketing/data/releases.json` is updated. The marketing API immediately serves:
- `GET /api/releases/latest` → metadata for the downloads page
- `GET /downloads/<version>/<file>` → actual installer download (whitelist-gated)
- `GET /api/releases/<target>/<current_version>` → Tauri auto-updater endpoint

### Auto-Updater Signing
For signed updates (clients verify the signature with the embedded public key in `tauri.conf.json`):
```bash
# Generate keypair once
tauri signer generate -w ~/.tauri/blackruby.key

# Sign each artifact
tauri signer sign -k ~/.tauri/blackruby.key -p <pwd> dist/release/0.5.0/Blackruby_0.5.0_universal.dmg
# → produces a .sig file. Add the contents to releases.json's `assets[].signature` field.
```

Set the public key in `app/src-tauri/tauri.conf.json` under `plugins.updater.pubkey` before the first build.

---

## CI: Release via Git Tag

The real CI is `.github/workflows/ci.yml`. On every push to main it runs
typecheck + tests. On a tag push matching `v*` it ALSO builds the macOS
DMG **and** the Windows MSI + NSIS, then attaches everything to a
GitHub Release.

### Cut a new release in 30 seconds

```bash
# 1. Bump version in both files (one source of truth ideally — script TBD).
node -e "['app/src-tauri/tauri.conf.json','app/package.json'].forEach(p=>{const j=require('./'+p);j.version='0.6.7';require('fs').writeFileSync(p,JSON.stringify(j,null,2)+'\n')})"

# 2. Commit + push.
git add app/src-tauri/tauri.conf.json app/package.json
git commit -m "chore(release): bump to v0.6.7"
git push

# 3. Tag + push the tag — this is what fires the build-mac + build-windows jobs.
git tag v0.6.7
git push origin v0.6.7
```

After ~15–20 min:
- macOS-arm + macOS-x64 + Windows-MSI + Windows-NSIS land on
  https://github.com/nyroxsystems-boop/vinted-Bot/releases/tag/v0.6.7
- Auto-updater clients (after `releases.json` is regenerated) see the
  new version and prompt the user

### Re-trigger manually without re-tagging

If you fix CI itself, push to main + go to the **Actions** tab → pick the
workflow → **Run workflow** → main. That uses `workflow_dispatch` which
runs typecheck-and-test. To force a full build, delete + re-push the tag:

```bash
git tag -d v0.6.7              # local
git push origin :v0.6.7        # remote
git tag v0.6.7                  # recreate at current HEAD
git push origin v0.6.7
```

### Why the runner is on node-24

The local dev environment uses node 24 (npm 11) which generates a
lockfile-version-3 format with subtle features npm 10 (node 20) chokes
on. The CI matrix runs node 24 across all three jobs to match local.
