// Render icon.svg to the full Tauri v2 icon set.
// Usage:  node render-icons.mjs
//
// Produces:
//   icon.png                  512x512 — Tauri v2 "meta" icon
//   32x32.png, 128x128.png, 128x128@2x.png  — legacy sizes still referenced
//   icon.icns                 macOS icns bundle (via iconutil)
//   icon.ico                  Windows ico (embedded PNG frames)
//
// Uses the repo's Playwright Chromium — no extra deps.

import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const svgPath = path.join(__dirname, 'icon.svg');
const svg = await fs.readFile(svgPath, 'utf-8');

// Every size we need to produce.
const targets = [
  // Tauri v2 + legacy top-level PNGs
  { size: 512, out: 'icon.png' },
  { size: 32, out: '32x32.png' },
  { size: 128, out: '128x128.png' },
  { size: 256, out: '128x128@2x.png' },
  // macOS .iconset inputs
  { size: 16, out: 'icon.iconset/icon_16x16.png' },
  { size: 32, out: 'icon.iconset/icon_16x16@2x.png' },
  { size: 32, out: 'icon.iconset/icon_32x32.png' },
  { size: 64, out: 'icon.iconset/icon_32x32@2x.png' },
  { size: 128, out: 'icon.iconset/icon_128x128.png' },
  { size: 256, out: 'icon.iconset/icon_128x128@2x.png' },
  { size: 256, out: 'icon.iconset/icon_256x256.png' },
  { size: 512, out: 'icon.iconset/icon_256x256@2x.png' },
  { size: 512, out: 'icon.iconset/icon_512x512.png' },
  { size: 1024, out: 'icon.iconset/icon_512x512@2x.png' },
  // Windows .ico frames (kept around so we can assemble icon.ico below)
  { size: 16, out: 'ico-frames/16.png' },
  { size: 24, out: 'ico-frames/24.png' },
  { size: 32, out: 'ico-frames/32.png' },
  { size: 48, out: 'ico-frames/48.png' },
  { size: 64, out: 'ico-frames/64.png' },
  { size: 128, out: 'ico-frames/128.png' },
  { size: 256, out: 'ico-frames/256.png' },
];

const browser = await chromium.launch();
const context = await browser.newContext({ deviceScaleFactor: 1 });

for (const { size, out } of targets) {
  const html = `<!doctype html><html><head><style>
    html,body{margin:0;padding:0;background:transparent;}
    svg{display:block;width:${size}px;height:${size}px;}
  </style></head><body>${svg}</body></html>`;
  const page = await context.newPage();
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(html, { waitUntil: 'domcontentloaded' });
  const buf = await page.locator('svg').screenshot({ omitBackground: true });
  const outPath = path.join(__dirname, out);
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, buf);
  console.log(`wrote ${out} (${size}px, ${buf.length}B)`);
  await page.close();
}

await browser.close();

// Build .icns from the .iconset folder (macOS only — iconutil is system bin).
try {
  execSync(`iconutil -c icns "${path.join(__dirname, 'icon.iconset')}" -o "${path.join(__dirname, 'icon.icns')}"`);
  console.log('wrote icon.icns');
} catch (err) {
  console.warn('iconutil failed (non-fatal on non-macOS):', err.message);
}

// Build .ico — concatenate the PNG frames into a single Windows icon.
// Format: 6-byte header + 16-byte directory entry per frame + PNG data.
const framePaths = [16, 24, 32, 48, 64, 128, 256].map((s) =>
  path.join(__dirname, 'ico-frames', `${s}.png`),
);
const frames = [];
for (const p of framePaths) {
  frames.push({ size: Number(path.basename(p, '.png')), data: await fs.readFile(p) });
}
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0); // reserved
header.writeUInt16LE(1, 2); // type: icon
header.writeUInt16LE(frames.length, 4); // count

const dirSize = 16 * frames.length;
let dataOffset = 6 + dirSize;
const dirEntries = [];
const dataBlobs = [];
for (const f of frames) {
  const entry = Buffer.alloc(16);
  entry.writeUInt8(f.size === 256 ? 0 : f.size, 0); // width (0 = 256)
  entry.writeUInt8(f.size === 256 ? 0 : f.size, 1); // height
  entry.writeUInt8(0, 2); // no color palette
  entry.writeUInt8(0, 3); // reserved
  entry.writeUInt16LE(1, 4); // color planes
  entry.writeUInt16LE(32, 6); // bpp
  entry.writeUInt32LE(f.data.length, 8);
  entry.writeUInt32LE(dataOffset, 12);
  dirEntries.push(entry);
  dataBlobs.push(f.data);
  dataOffset += f.data.length;
}

const icoPath = path.join(__dirname, 'icon.ico');
await fs.writeFile(icoPath, Buffer.concat([header, ...dirEntries, ...dataBlobs]));
console.log(`wrote icon.ico (${frames.length} frames)`);

// Clean up temp frames folder — the ico is a single file that contains them all.
await fs.rm(path.join(__dirname, 'ico-frames'), { recursive: true, force: true });

console.log('\ndone — icon set refreshed');
