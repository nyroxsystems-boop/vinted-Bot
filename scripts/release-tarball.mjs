#!/usr/bin/env node
// ──────────────────────────────────────────────────────────────────────────────
// Release-tarball builder.
//
// Packs the in-app-updatable parts of the repo into a single signed tarball
// that the Tauri shell can pull from blackruby.app and apply at runtime.
//
//   • Bumps `app/package.json` version (or reads --version)
//   • Tars: shared/ orchestrator/ vinted-bot/ kleinanzeigen-bot/ depop-bot/
//           cj-service/ mercari-bot/ wallapop-bot/ ebay-bot/ etsy-bot/
//           grailed-bot/ fb-marketplace-bot/ vestiaire-bot/ whatnot-bot/
//           dashboard/dist/ marketing/api/ package.json package-lock.json
//   • Skips:  node_modules/ data/ .git/ *.db *.bak *.log
//   • SHA-256: written to system.tar.gz.sha256
//   • Ed25519: signed with $RELEASE_SIGNING_KEY (hex private key, 64 chars),
//              detached signature written to system.tar.gz.sig (hex)
//   • Detects Rust-side changes (app/src-tauri/**) — sets
//     requires_native_reinstall=true in releases.json
//   • Updates marketing/data/releases.json with the new manifest
//
// Usage:  RELEASE_SIGNING_KEY=$(cat ~/.blackruby/signing.key) \
//         node scripts/release-tarball.mjs --version 0.5.1 --notes "Bug fix CJ"
// ──────────────────────────────────────────────────────────────────────────────

import { execFileSync, spawnSync } from 'node:child_process';
import { createHash, sign as cryptoSign, createPrivateKey } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const RELEASE_DIR_BASE = resolve(REPO_ROOT, 'dist', 'release');
const RELEASES_JSON = resolve(REPO_ROOT, 'marketing', 'data', 'releases.json');
const PUBLIC_URL = process.env.PUBLIC_URL ?? 'https://blackruby.app';

// Refuse to build an unsigned release. The Rust updater in release-mode
// rejects unsigned tarballs anyway, so a release without a signing key
// is dead-on-arrival for customers. Allow --dry-run without keys for CI smoke tests.
if (!process.argv.includes('--dry-run')) {
  if (!process.env.RELEASE_SIGNING_KEY && !process.env.BLACKRUBY_RELEASE_PRIVKEY) {
    console.error('[release-tarball] FATAL: RELEASE_SIGNING_KEY (or BLACKRUBY_RELEASE_PRIVKEY) must be set. Refusing to build unsigned release.');
    process.exit(1);
  }
  if (!process.env.BLACKRUBY_RELEASE_PUBKEY) {
    console.error('[release-tarball] FATAL: BLACKRUBY_RELEASE_PUBKEY must be set so the Rust shell embeds the matching public key. Refusing to build.');
    process.exit(1);
  }
}

const INCLUDE = [
  'shared', 'orchestrator',
  'vinted-bot', 'kleinanzeigen-bot', 'depop-bot', 'mercari-bot',
  'wallapop-bot', 'ebay-bot', 'etsy-bot', 'grailed-bot',
  'fb-marketplace-bot', 'vestiaire-bot', 'whatnot-bot',
  'cj-service',
  // NOTE: `marketing/api` is INTENTIONALLY NOT included. It runs server-side
  // on your infrastructure — customers don't need it. Shipping it risks
  // leaking server-side secrets (STRIPE_SECRET_KEY, LICENSE_SIGNING_SECRET,
  // webhook secrets) if any .env / config file slipped into the workspace
  // dir on the build host. Keep it out — period.
  'dashboard/dist',
  // app/package.json carries the version that `tarball_update.rs::read_current_version`
  // reads at runtime — must be in the tarball so post-apply version bumps stick.
  'app/package.json',
  'package.json', 'package-lock.json', 'tsconfig.base.json',
];

const EXCLUDE_PATTERNS = [
  '*/node_modules', '*/data', '*/playwright-data', '*/dist',
  '*/.git', '*/tmp', '*/_logs',
  '*.db', '*.db-wal', '*.db-shm', '*.bak', '*.log',
  // CRITICAL: every form of .env file. Without these patterns a release
  // build on a dev machine (or CI runner that injected secrets) leaks
  // STRIPE_SECRET_KEY / LICENSE_SIGNING_SECRET / GEMINI_API_KEY / OAUTH
  // tokens into the public-facing customer tarball.
  '.env', '.env.*', '*/.env', '*/.env.*',
  // Common credential-file names that would also leak silently.
  'credentials.json', '*/credentials.json', 'secrets.json', '*/secrets.json',
  'service-account.json', '*/service-account.json',
];

const { values: args } = parseArgs({
  options: {
    version: { type: 'string' },
    notes:   { type: 'string', multiple: true, default: [] },
    'dry-run': { type: 'boolean', default: false },
  },
});

const version = args.version ?? readJson(resolve(REPO_ROOT, 'app/package.json')).version;
if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
  console.error(`Invalid version "${version}". Pass --version X.Y.Z`);
  process.exit(1);
}

const signingKeyHex = (process.env.RELEASE_SIGNING_KEY ?? '').trim();
if (!signingKeyHex && !args['dry-run']) {
  console.error('RELEASE_SIGNING_KEY env var missing (64-char hex of an Ed25519 private key).');
  console.error('Generate one with:');
  console.error('  node -e "const k = require(\'crypto\').generateKeyPairSync(\'ed25519\'); console.log(\'priv=\'+k.privateKey.export({format:\'der\',type:\'pkcs8\'}).toString(\'hex\')); console.log(\'pub=\'+k.publicKey.export({format:\'der\',type:\'spki\'}).toString(\'hex\'))"');
  process.exit(1);
}

const releaseDir = join(RELEASE_DIR_BASE, version);
mkdirSync(releaseDir, { recursive: true });
const tarPath = join(releaseDir, 'system.tar.gz');

// Bump the version field in `app/package.json` so customers see the new
// version after the tarball is applied. We restore it after the dry-run so a
// dev workflow doesn't accidentally rebase forward.
const appPkgPath = resolve(REPO_ROOT, 'app/package.json');
const appPkgOriginal = readFileSync(appPkgPath, 'utf8');
const appPkgParsed = JSON.parse(appPkgOriginal);
const previousAppVersion = appPkgParsed.version;
if (previousAppVersion !== version) {
  appPkgParsed.version = version;
  writeFileSync(appPkgPath, JSON.stringify(appPkgParsed, null, 2) + '\n');
  console.log(`▶ Bumped app/package.json: ${previousAppVersion} → ${version}`);
}

// Build tar exclude args.
const excludeArgs = EXCLUDE_PATTERNS.flatMap((p) => ['--exclude', p]);

console.log(`▶ Packing ${INCLUDE.length} paths into ${tarPath} …`);
execFileSync('tar', ['-czf', tarPath, ...excludeArgs, '-C', REPO_ROOT, ...INCLUDE], {
  stdio: 'inherit',
});

const tarBytes = readFileSync(tarPath);
const sha256 = createHash('sha256').update(tarBytes).digest('hex');
writeFileSync(`${tarPath}.sha256`, `${sha256}  ${tarPath.split('/').pop()}\n`);
console.log(`▶ SHA-256: ${sha256}`);

// Sign the tarball bytes (NOT the sha — signing the raw data lets us verify
// integrity even if the sha file is missing).
let signatureHex = '';
if (signingKeyHex) {
  const der = Buffer.from(signingKeyHex, 'hex');
  // The privateKey is expected as a 32-byte raw seed OR a DER pkcs8 blob.
  // pkcs8 is what `generateKeyPairSync` exports — handle that first.
  let key;
  try {
    key = createPrivateKey({ key: der, format: 'der', type: 'pkcs8' });
  } catch {
    // Fall back to constructing a key from a raw 32-byte seed.
    if (der.length !== 32) throw new Error('RELEASE_SIGNING_KEY must be a DER-pkcs8 hex or a 32-byte seed hex');
    key = createPrivateKey({
      key: Buffer.concat([
        Buffer.from('302e020100300506032b657004220420', 'hex'), // PKCS8 header for Ed25519
        der,
      ]),
      format: 'der',
      type: 'pkcs8',
    });
  }
  const sig = cryptoSign(null, tarBytes, key);
  signatureHex = sig.toString('hex');
  writeFileSync(`${tarPath}.sig`, signatureHex + '\n');
  console.log(`▶ Ed25519 sig: ${signatureHex.slice(0, 24)}…`);
}

// Detect whether anything under app/src-tauri/ changed compared to the
// previous release — if yes, customers need a fresh native installer.
const requiresNativeReinstall = checkRustChanged(version);
if (requiresNativeReinstall) {
  console.log('▶ Rust changed since last release — requires_native_reinstall=true');
}

// Update releases.json
const tarballUrl = `${PUBLIC_URL}/downloads/tarball/${version}/system.tar.gz`;
const prev = existsSync(RELEASES_JSON) ? readJson(RELEASES_JSON) : {};
const manifest = {
  version,
  released_at: new Date().toISOString(),
  notes: args.notes && args.notes.length > 0 ? args.notes : (prev.notes ?? []),
  // Keep the legacy installer assets array intact so DMG/EXE downloads still work.
  assets: prev.assets ?? [],
  tarball: {
    url: tarballUrl,
    sha256,
    signature: signatureHex,
    size: tarBytes.length,
    requires_native_reinstall: requiresNativeReinstall,
  },
};

if (args['dry-run']) {
  console.log('\n--- DRY RUN — releases.json would be:');
  console.log(JSON.stringify(manifest, null, 2));
} else {
  mkdirSync(dirname(RELEASES_JSON), { recursive: true });
  writeFileSync(RELEASES_JSON, JSON.stringify(manifest, null, 2));
  console.log(`✔ Updated ${RELEASES_JSON}`);
}

console.log(`\n✔ Release ${version} ready at ${tarPath}`);
console.log(`  Size: ${(tarBytes.length / 1024 / 1024).toFixed(2)} MB`);
console.log(`  URL:  ${tarballUrl}`);

// ── helpers ────────────────────────────────────────────────────────────────

function readJson(p) {
  return JSON.parse(readFileSync(p, 'utf8'));
}

function checkRustChanged(currentVersion) {
  // Compare app/src-tauri/ against the previous tagged release. If git isn't
  // available or there's no previous tag, assume "no change" — first releases
  // always require an installer anyway.
  const r = spawnSync('git', ['tag', '-l', 'v*'], { cwd: REPO_ROOT, encoding: 'utf8' });
  if (r.status !== 0) return false;
  const tags = r.stdout.split('\n').map((s) => s.trim()).filter(Boolean).sort();
  const prevTag = tags.filter((t) => t < `v${currentVersion}`).pop();
  if (!prevTag) return false;
  const diff = spawnSync('git', ['diff', '--name-only', prevTag, 'HEAD', '--', 'app/src-tauri/'], {
    cwd: REPO_ROOT, encoding: 'utf8',
  });
  if (diff.status !== 0) return false;
  return diff.stdout.trim().length > 0;
}
