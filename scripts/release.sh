#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────────
# Blackruby release builder.
#
# Builds:
#   * macOS universal (Apple Silicon + Intel) .dmg + .app
#   * Windows x86_64 .msi + .nsis (only when run on Windows or with a cross-
#     compile toolchain installed; otherwise skipped with a notice)
#
# Output is collected under  dist/release/<version>/  and a releases.json
# manifest is generated for the marketing API's /api/releases/latest endpoint.
#
# Requirements (Mac):
#   rustup target add aarch64-apple-darwin x86_64-apple-darwin
#   xcode-select --install
#   Optional for notarization: APPLE_ID, APPLE_PASSWORD, APPLE_TEAM_ID env vars.
#
# Requirements (Windows host or cross):
#   rustup target add x86_64-pc-windows-msvc
#   WiX Toolset 3.11 (cargo-tauri downloads automatically when missing)
# ──────────────────────────────────────────────────────────────────────────────

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

VERSION="$(node -p "require('./app/src-tauri/tauri.conf.json').version")"
OUT="$ROOT/dist/release/$VERSION"
mkdir -p "$OUT"

echo "── Building Blackruby v$VERSION → $OUT"
echo

# ── 1. Dashboard build (frontend) ─────────────────────────────────────────────
echo "▸ Building dashboard frontend"
npm run -w @vinted-system/dashboard build

# ── 2. Mac builds ─────────────────────────────────────────────────────────────
if [[ "$(uname)" == "Darwin" ]]; then
  echo
  echo "▸ Building macOS universal bundle (Apple Silicon + Intel)"
  npm run -w @vinted-system/app tauri:build:mac || {
    echo "  ! Universal build failed, falling back to native target"
    npm run -w @vinted-system/app tauri:build
  }

  TARGET_DIR="$ROOT/app/src-tauri/target"
  for variant in universal-apple-darwin aarch64-apple-darwin x86_64-apple-darwin release; do
    DMG_GLOB="$TARGET_DIR/$variant/release/bundle/dmg/*.dmg"
    for f in $DMG_GLOB; do
      if [[ -f "$f" ]]; then
        BASENAME="$(basename "$f")"
        cp -f "$f" "$OUT/$BASENAME"
        echo "  → $BASENAME"
      fi
    done
  done
else
  echo "▸ macOS build skipped (host is not Darwin)"
fi

# ── 3. Windows builds ─────────────────────────────────────────────────────────
if [[ "$(uname -s)" =~ MINGW|MSYS|CYGWIN ]] || [[ -n "${BLACKRUBY_BUILD_WIN:-}" ]]; then
  echo
  echo "▸ Building Windows x86_64 MSI + NSIS"
  npm run -w @vinted-system/app tauri:build:win

  TARGET_DIR="$ROOT/app/src-tauri/target/x86_64-pc-windows-msvc/release/bundle"
  for ext in msi nsis; do
    for f in "$TARGET_DIR/$ext"/*.{msi,exe}; do
      [[ -f "$f" ]] || continue
      BASENAME="$(basename "$f")"
      cp -f "$f" "$OUT/$BASENAME"
      echo "  → $BASENAME"
    done
  done
else
  echo "▸ Windows build skipped (host is not Windows and BLACKRUBY_BUILD_WIN not set)"
fi

# ── 4. SHA-256 + manifest ─────────────────────────────────────────────────────
echo
echo "▸ Computing SHA-256 and writing releases.json"
node "$ROOT/scripts/write-release-manifest.mjs" "$OUT" "$VERSION"

echo
echo "✓ Release artifacts ready: $OUT"
ls -lh "$OUT"
