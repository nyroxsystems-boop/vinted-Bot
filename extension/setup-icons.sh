#!/bin/bash
# Blackruby Crosslister Extension — Icon Setup
# Run this script to generate the extension icons from the source PNG.
#
# Usage: bash setup-icons.sh [path_to_source_png]
# If no source is provided, creates placeholder colored PNGs.

ICONS_DIR="$(dirname "$0")/icons"
mkdir -p "$ICONS_DIR"

SOURCE="${1:-}"

if [ -n "$SOURCE" ] && [ -f "$SOURCE" ]; then
  echo "Generating icons from: $SOURCE"
  sips -z 128 128 "$SOURCE" --out "$ICONS_DIR/icon128.png"
  sips -z 48 48 "$SOURCE" --out "$ICONS_DIR/icon48.png"
  sips -z 16 16 "$SOURCE" --out "$ICONS_DIR/icon16.png"
  echo "✅ Icons created in $ICONS_DIR"
else
  echo "No source image provided. Creating placeholder icons..."
  # Create simple colored PNG placeholders using Python
  python3 -c "
import struct, zlib

def create_png(size, filename):
    # Simple red-black gradient PNG
    pixels = []
    for y in range(size):
        row = [0]  # filter byte
        for x in range(size):
            r = int(255 * (1 - y/size) * 0.8)
            g = int(20 * x/size)
            b = int(20 * x/size)
            a = 255
            row.extend([r, g, b, a])
        pixels.append(bytes(row))
    
    raw = b''.join(pixels)
    
    def chunk(ctype, data):
        c = ctype + data
        return struct.pack('>I', len(data)) + c + struct.pack('>I', zlib.crc32(c) & 0xFFFFFFFF)
    
    sig = b'\\x89PNG\\r\\n\\x1a\\n'
    ihdr = struct.pack('>IIBBBBB', size, size, 8, 6, 0, 0, 0)
    idat = zlib.compress(raw)
    
    with open(filename, 'wb') as f:
        f.write(sig)
        f.write(chunk(b'IHDR', ihdr))
        f.write(chunk(b'IDAT', idat))
        f.write(chunk(b'IEND', b''))

create_png(128, '$ICONS_DIR/icon128.png')
create_png(48, '$ICONS_DIR/icon48.png')
create_png(16, '$ICONS_DIR/icon16.png')
print('✅ Placeholder icons created')
"
fi

echo ""
echo "Extension ready to load in Chrome:"
echo "  1. Open chrome://extensions"
echo "  2. Enable Developer mode"
echo "  3. Click 'Load unpacked'"
echo "  4. Select: $(cd "$(dirname "$0")" && pwd)"
