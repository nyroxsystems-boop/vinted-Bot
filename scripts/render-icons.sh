#!/usr/bin/env bash
# Render blackruby-icon.svg → all sizes needed by Tauri (Mac .icns + Win .ico + Linux PNGs)
# Requires: rsvg-convert (brew install librsvg) or magick (brew install imagemagick)
#
# Usage: ./scripts/render-icons.sh

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/app/src-tauri/icons/blackruby-icon.svg"
DST="$ROOT/app/src-tauri/icons"

if [[ ! -f "$SRC" ]]; then
  echo "✗ SVG not found: $SRC"
  exit 1
fi

# Pick rasterizer
RASTER=""
if command -v rsvg-convert >/dev/null 2>&1; then
  RASTER="rsvg-convert"
elif command -v magick >/dev/null 2>&1; then
  RASTER="magick"
elif command -v convert >/dev/null 2>&1; then
  RASTER="convert"
else
  echo "✗ Need rsvg-convert (brew install librsvg) or imagemagick"
  exit 1
fi

render() {
  local size=$1
  local out=$2
  echo "  → ${size}×${size}  $(basename "$out")"
  case "$RASTER" in
    rsvg-convert) rsvg-convert -w "$size" -h "$size" -o "$out" "$SRC" ;;
    magick)       magick -background none -density 600 "$SRC" -resize "${size}x${size}" "$out" ;;
    convert)      convert -background none -density 600 "$SRC" -resize "${size}x${size}" "$out" ;;
  esac
}

echo "▸ Rendering icons via $RASTER"

# Tauri-expected PNGs
render 32   "$DST/32x32.png"
render 128  "$DST/128x128.png"
render 256  "$DST/128x128@2x.png"
render 512  "$DST/icon.png"
render 1024 "$DST/icon-1024.png"

# Mac .icns set
ICONSET="$DST/icon.iconset"
mkdir -p "$ICONSET"
render 16   "$ICONSET/icon_16x16.png"
render 32   "$ICONSET/icon_16x16@2x.png"
render 32   "$ICONSET/icon_32x32.png"
render 64   "$ICONSET/icon_32x32@2x.png"
render 128  "$ICONSET/icon_128x128.png"
render 256  "$ICONSET/icon_128x128@2x.png"
render 256  "$ICONSET/icon_256x256.png"
render 512  "$ICONSET/icon_256x256@2x.png"
render 512  "$ICONSET/icon_512x512.png"
render 1024 "$ICONSET/icon_512x512@2x.png"

if command -v iconutil >/dev/null 2>&1; then
  iconutil -c icns "$ICONSET" -o "$DST/icon.icns"
  echo "✓ icon.icns generated"
fi

# Windows .ico — embed multiple sizes in one file
if command -v magick >/dev/null 2>&1; then
  magick "$DST/32x32.png" "$DST/128x128.png" "$DST/icon.png" "$DST/icon.ico"
  echo "✓ icon.ico generated"
elif command -v convert >/dev/null 2>&1; then
  convert "$DST/32x32.png" "$DST/128x128.png" "$DST/icon.png" "$DST/icon.ico"
  echo "✓ icon.ico generated"
else
  echo "ℹ  Skip .ico (install imagemagick to enable)"
fi

echo "✓ Done — all icon assets refreshed from blackruby-icon.svg"
