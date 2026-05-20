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

## CI Recipe (GitHub Actions)

```yaml
jobs:
  build:
    strategy:
      matrix:
        os: [macos-latest, windows-latest]
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - uses: dtolnay/rust-toolchain@stable
      - run: npm ci
      - run: ./scripts/release.sh
        shell: bash
      - uses: actions/upload-artifact@v4
        with:
          name: blackruby-${{ matrix.os }}
          path: dist/release/
```

Then a release-publish step uploads to your CDN of choice (S3/CloudFront, Cloudflare R2, Vercel Blob, etc.) under the URL pattern referenced by `releases.json`.
