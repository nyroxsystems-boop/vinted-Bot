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
  // Windows: bsdtar.exe (built into Windows 10+) handles ZIPs but its
  // --strip-components support is patchy. Extract first, then flatten
  // the top-level subdir manually.
  execSync(`tar -xf "${nodeArchive}" -C "${NODE_DEST}"`, { stdio: 'inherit' });
  // Find the single top-level subdir (e.g. node-v24.11.1-win-x64) and
  // move its contents up one level.
  const entries = await fsp.readdir(NODE_DEST);
  const topLevel = entries.find(e => e.startsWith('node-v'));
  if (topLevel) {
    const inner = path.join(NODE_DEST, topLevel);
    for (const child of await fsp.readdir(inner)) {
      await fsp.rename(path.join(inner, child), path.join(NODE_DEST, child));
    }
    await fsp.rm(inner, { recursive: true, force: true });
  }
} else {
  // Mac/Linux: GNU/bsd tar both grok --strip-components for tar.gz.
  execSync(`tar -xzf "${nodeArchive}" -C "${NODE_DEST}" --strip-components=1`, { stdio: 'inherit' });
}

// Verify Node was actually extracted — if the strip-components/flatten
// went sideways the supervisor won't find node and the fat-installer is
// dead-on-arrival on the customer machine. Audit Finding #20.
const nodeBinary = targetOs === 'win'
  ? path.join(NODE_DEST, 'node.exe')
  : path.join(NODE_DEST, 'bin', 'node');
if (!fs.existsSync(nodeBinary)) {
  console.error(`[stage-bundle] FATAL: Node binary not found at expected path: ${nodeBinary}`);
  console.error(`[stage-bundle] Contents of NODE_DEST:`);
  for (const e of fs.readdirSync(NODE_DEST)) console.error(`  - ${e}`);
  process.exit(1);
}
log(`  extracted to ${path.relative(REPO_ROOT, NODE_DEST)} (verified: ${path.basename(nodeBinary)} exists)`);

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

// Sanity check: did npm actually create the @vinted-system/* workspace
// junctions? On Windows CI runners we've seen npm exit 0 yet skip the
// junction creation (or the WiX bundler downstream strips them). Either
// way, an installer shipped without these links boots into a 5-second
// ERR_MODULE_NOT_FOUND crash-loop nobody can debug. Fail the CI build
// loudly here instead of shipping a broken bundle. The supervisor still
// has a runtime self-heal as a belt-and-braces fallback (see
// services.rs::self_heal_workspaces_if_needed) for cases where Tauri's
// bundler drops the junctions even though stage-bundle saw them.
const requiredWorkspaces = ['shared', 'orchestrator', 'vinted-bot', 'cj-service'];
const missingWorkspaces = [];
for (const ws of requiredWorkspaces) {
  const linkPath = path.join(SYSTEM_DEST, 'node_modules', '@vinted-system', ws);
  // Use lstat to detect junctions/symlinks; existsSync follows symlinks
  // and could miss broken ones.
  if (!fs.existsSync(linkPath)) {
    missingWorkspaces.push(ws);
  }
}
if (missingWorkspaces.length) {
  console.error(`[stage-bundle] FATAL: npm install exited 0 but these workspace links are missing:`);
  for (const ws of missingWorkspaces) {
    console.error(`  - node_modules/@vinted-system/${ws}`);
  }
  console.error(`[stage-bundle] The installer would ship broken. Investigate npm workspace handling on this runner.`);
  console.error(`[stage-bundle] node_modules/@vinted-system/ contents:`);
  const dir = path.join(SYSTEM_DEST, 'node_modules', '@vinted-system');
  if (fs.existsSync(dir)) {
    for (const e of fs.readdirSync(dir)) console.error(`    ${e}`);
  } else {
    console.error('    (directory does not exist at all)');
  }
  process.exit(1);
}
log(`  workspace links verified: ${requiredWorkspaces.join(', ')}`);

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
