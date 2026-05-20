#!/usr/bin/env node
// Render blackruby-icon.svg → all sizes via `sharp` (already in the monorepo).
// Run:  node scripts/render-icons.mjs
//
// Produces:
//   app/src-tauri/icons/{32x32,128x128,128x128@2x,icon,icon-1024}.png
//   app/src-tauri/icons/icon.iconset/* + icon.icns (on macOS only)
//   app/src-tauri/icons/icon.ico   (requires `to-ico` package; skipped if absent)
//
// Then commit + rebuild the Tauri DMG to pick up the new icon.

import { execSync } from 'node:child_process';
import { mkdirSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC  = resolve(ROOT, 'app/src-tauri/icons/blackruby-icon.svg');
const DST  = resolve(ROOT, 'app/src-tauri/icons');

if (!existsSync(SRC)) {
  console.error('Missing SVG:', SRC);
  process.exit(1);
}

let sharp;
try {
  sharp = (await import('sharp')).default;
} catch {
  console.error('sharp not installed. Run: npm install -D sharp');
  process.exit(1);
}

const svg = readFileSync(SRC);

async function render(size, out) {
  await sharp(svg, { density: 600 }).resize(size, size).png({ compressionLevel: 9 }).toFile(out);
  console.log(`  → ${size}×${size}  ${out.replace(ROOT + '/', '')}`);
}

console.log(`▸ Rendering icons from blackruby-icon.svg`);

// Tauri-expected paths
await render(32,   resolve(DST, '32x32.png'));
await render(128,  resolve(DST, '128x128.png'));
await render(256,  resolve(DST, '128x128@2x.png'));
await render(512,  resolve(DST, 'icon.png'));
await render(1024, resolve(DST, 'icon-1024.png'));

// Mac .iconset (icnsutil expects this folder layout)
const iconset = resolve(DST, 'icon.iconset');
mkdirSync(iconset, { recursive: true });
const macSizes = [
  [16,  'icon_16x16.png'],
  [32,  'icon_16x16@2x.png'],
  [32,  'icon_32x32.png'],
  [64,  'icon_32x32@2x.png'],
  [128, 'icon_128x128.png'],
  [256, 'icon_128x128@2x.png'],
  [256, 'icon_256x256.png'],
  [512, 'icon_256x256@2x.png'],
  [512, 'icon_512x512.png'],
  [1024,'icon_512x512@2x.png'],
];
for (const [size, name] of macSizes) {
  await render(size, resolve(iconset, name));
}

// Generate .icns on macOS
if (process.platform === 'darwin') {
  try {
    execSync(`iconutil -c icns "${iconset}" -o "${resolve(DST, 'icon.icns')}"`);
    console.log('✓ icon.icns generated');
  } catch (e) {
    console.warn('⚠ iconutil failed:', String(e));
  }
}

// .ico — Windows max-per-frame is 256×256, so we omit the 512/1024 PNGs.
try {
  const mod = await import('to-ico');
  const toIco = mod.default ?? mod;
  // Make sure we have a 256 PNG for the ICO highest frame
  const png256 = resolve(DST, 'icon-256.png');
  await render(256, png256);
  const ico = await toIco([
    readFileSync(resolve(DST, '32x32.png')),
    readFileSync(resolve(DST, '128x128.png')),
    readFileSync(png256),
  ]);
  writeFileSync(resolve(DST, 'icon.ico'), ico);
  console.log('✓ icon.ico generated (32/128/256)');
} catch (e) {
  console.log('ℹ icon.ico skipped:', e instanceof Error ? e.message : String(e));
}

console.log('✓ Done — all icon assets refreshed.');
