#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// stage-bundle.mjs — prepare a self-contained "fat installer" payload
//
// What it does (in order):
//   1. Wipes a clean `app/src-tauri/payload/` directory
//   2. Copies the system source tree into `payload/system/` (filtered: no .git,
//      no data/, no node_modules, no _logs, no _diag)
//   3. Downloads a portable Node.js for the target OS into `payload/node/`
//   4. Runs `npm install --omit=dev` inside `payload/system/` so node_modules
//      ships pre-installed (production deps only; dev tooling stays out)
//   5. Downloads Playwright's Chromium build for the target OS into
//      `payload/playwright-browsers/`
//
// The resulting `payload/` directory is then included via Tauri's
// `bundle.resources` so the MSI/DMG contains everything a fresh machine
// needs. The Rust supervisor on first launch extracts payload/* to
// `%LOCALAPPDATA%/Blackruby/` (Win) or `~/Library/Application Support/Blackruby/`
// (Mac) and uses the bundled node + extracted system code from there. No
// manual install steps for the customer.
//
// Run on the CI runner — uses host's npm to install (so native bindings get
// compiled for that OS).
//
// Usage:
//   node scripts/stage-bundle.mjs           # auto-detect host OS
//   node scripts/stage-bundle.mjs --os=win  # cross-target
// ─────────────────────────────────────────────────────────────────────────────

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { execSync, spawnSync } from 'node:child_process';
import https from 'node:https';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const PAYLOAD_DIR = path.join(REPO_ROOT, 'app', 'src-tauri', 'payload');
const SYSTEM_DEST = path.join(PAYLOAD_DIR, 'system');
const NODE_DEST = path.join(PAYLOAD_DIR, 'node');
const BROWSERS_DEST = path.join(PAYLOAD_DIR, 'playwright-browsers');

// ── OS detection ────────────────────────────────────────────────────────────
const argOs = process.argv.find(a => a.startsWith('--os='))?.split('=')[1];
const targetOs = argOs ?? (process.platform === 'win32' ? 'win' :
                            process.platform === 'darwin' ? 'mac' : 'linux');

// Pin Node.js 24.11.1 (matches engines.node + the CI workflow).
const NODE_VERSION = '24.11.1';

const NODE_URLS = {
  win:   `https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-win-x64.zip`,
  mac:   `https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-darwin-arm64.tar.gz`,
  linux: `https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-x64.tar.gz`,
};

const log = (msg) => console.log(`[stage-bundle] ${msg}`);

// ── 1. Wipe + create payload dir ────────────────────────────────────────────
log(`Target OS: ${targetOs}`);
log(`Payload dir: ${PAYLOAD_DIR}`);
await fsp.rm(PAYLOAD_DIR, { recursive: true, force: true });
await fsp.mkdir(PAYLOAD_DIR, { recursive: true });

// ── 2. Copy source tree ─────────────────────────────────────────────────────
log('Copying system source (filtered)…');

const EXCLUDE_DIRS = new Set([
  'node_modules', '.git', 'data', '_logs', '_diag', '.backup',
  'app/src-tauri/target', 'app/src-tauri/payload', 'dist', 'venv',
  '.claude', '_push_queue', '_queue', '_anchors', '_config', '_done',
  '_smoke_test', '_crawler', 'tmp', 'playwright-data',
]);
const EXCLUDE_FILES = new Set([
  // SECRETS — never ship .env files. Customer extracts payload locally,
  // would see your Stripe/Gemini/OAuth keys in plain text.
  '.env', '.env.local', '.env.tmp', '.env.production', '.env.development',
  '.DS_Store',
  // Common credential file names — defense in depth.
  'credentials.json', 'secrets.json', 'service-account.json',
]);
// Same patterns but for files matched anywhere in the tree (the Set above
// only matches by basename).
function shouldExcludeFile(name) {
  if (EXCLUDE_FILES.has(name)) return true;
  // Catch `.env.anything` variants.
  if (name.startsWith('.env.') || name === '.env') return true;
  return false;
}

async function copyFiltered(src, dest, baseRelPath = '') {
  // Top-level: ensure dest exists before any copy lands here. Subdirs get
  // mkdir'd inside the loop. Without this the very first file copy fails
  // because system/ doesn't exist yet.
  await fsp.mkdir(dest, { recursive: true });
  const entries = await fsp.readdir(src, { withFileTypes: true });
  for (const e of entries) {
    if (e.name.startsWith('._')) continue;  // mac resource forks
    const rel = baseRelPath ? `${baseRelPath}/${e.name}` : e.name;
    if (EXCLUDE_DIRS.has(e.name) || EXCLUDE_DIRS.has(rel)) continue;
    if (shouldExcludeFile(e.name)) continue;
    const srcPath = path.join(src, e.name);
    const destPath = path.join(dest, e.name);
    if (e.isDirectory()) {
      await fsp.mkdir(destPath, { recursive: true });
      await copyFiltered(srcPath, destPath, rel);
    } else if (e.isFile()) {
      await fsp.copyFile(srcPath, destPath);
    }
  }
}

await copyFiltered(REPO_ROOT, SYSTEM_DEST);
log(`  source copied to ${path.relative(REPO_ROOT, SYSTEM_DEST)}`);

// ── 3. Download portable Node.js ────────────────────────────────────────────
const nodeUrl = NODE_URLS[targetOs];
if (!nodeUrl) throw new Error(`Unsupported OS: ${targetOs}`);
log(`Downloading Node.js ${NODE_VERSION} for ${targetOs}…`);

const nodeArchive = path.join(os.tmpdir(), `node-${NODE_VERSION}-${targetOs}` + (targetOs === 'win' ? '.zip' : '.tar.gz'));

await downloadFile(nodeUrl, nodeArchive);
log(`  downloaded ${formatBytes((await fsp.stat(nodeArchive)).size)}`);

await fsp.mkdir(NODE_DEST, { recursive: true });
if (targetOs === 'win') {
  // Windows: unzip via tar.exe (ships with Windows 10+)
  execSync(`tar -xf "${nodeArchive}" -C "${NODE_DEST}" --strip-components=1`, { stdio: 'inherit' });
} else {
  // Mac/Linux: tar
  execSync(`tar -xzf "${nodeArchive}" -C "${NODE_DEST}" --strip-components=1`, { stdio: 'inherit' });
}
log(`  extracted to ${path.relative(REPO_ROOT, NODE_DEST)}`);

// ── 4. npm install in staged system/ ────────────────────────────────────────
log('Running npm install (production only) in payload/system…');

// Use the HOST's npm (faster, already on PATH on CI runners). The result
// is platform-specific native bindings that match the target OS, which is
// fine because we always run stage-bundle on the same OS we're building
// the installer for.
const npmCmd = targetOs === 'win' ? 'npm.cmd' : 'npm';
const installResult = spawnSync(npmCmd, [
  'install', '--no-audit', '--no-fund', '--omit=dev',
], {
  cwd: SYSTEM_DEST,
  stdio: 'inherit',
  shell: true,
});
if (installResult.status !== 0) {
  throw new Error(`npm install failed with status ${installResult.status}`);
}
log('  npm install complete');

// ── 5. Download Playwright Chromium ─────────────────────────────────────────
log('Downloading Playwright Chromium…');
await fsp.mkdir(BROWSERS_DEST, { recursive: true });
const playwrightEnv = {
  ...process.env,
  PLAYWRIGHT_BROWSERS_PATH: BROWSERS_DEST,
};
const pwResult = spawnSync(npmCmd, ['exec', '--', 'playwright', 'install', 'chromium', '--with-deps'], {
  cwd: SYSTEM_DEST,
  env: playwrightEnv,
  stdio: 'inherit',
  shell: true,
});
if (pwResult.status !== 0) {
  // --with-deps fails on non-admin Linux runners; try without
  log('  --with-deps failed, retrying without…');
  const retry = spawnSync(npmCmd, ['exec', '--', 'playwright', 'install', 'chromium'], {
    cwd: SYSTEM_DEST,
    env: playwrightEnv,
    stdio: 'inherit',
    shell: true,
  });
  if (retry.status !== 0) throw new Error(`Playwright install failed with status ${retry.status}`);
}
log(`  browsers in ${path.relative(REPO_ROOT, BROWSERS_DEST)}`);

// ── Summary ─────────────────────────────────────────────────────────────────
const sizeOf = (p) => {
  let total = 0;
  for (const e of fs.readdirSync(p, { withFileTypes: true })) {
    const f = path.join(p, e.name);
    if (e.isDirectory()) total += sizeOf(f);
    else total += fs.statSync(f).size;
  }
  return total;
};

console.log('\n[stage-bundle] DONE');
console.log(`  payload/system:              ${formatBytes(sizeOf(SYSTEM_DEST))}`);
console.log(`  payload/node:                ${formatBytes(sizeOf(NODE_DEST))}`);
console.log(`  payload/playwright-browsers: ${formatBytes(sizeOf(BROWSERS_DEST))}`);
console.log(`  TOTAL:                       ${formatBytes(sizeOf(PAYLOAD_DIR))}`);

// ── Helpers ─────────────────────────────────────────────────────────────────
function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    const req = https.get(url, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        file.close(); fs.unlinkSync(dest);
        return downloadFile(res.headers.location, dest).then(resolve, reject);
      }
      if (res.statusCode !== 200) {
        file.close(); fs.unlinkSync(dest);
        return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      }
      res.pipe(file);
      file.on('finish', () => file.close(resolve));
    });
    req.on('error', (err) => {
      file.close(); fs.unlink(dest, () => {});
      reject(err);
    });
  });
}

function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}
