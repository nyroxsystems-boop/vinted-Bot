#!/usr/bin/env node
// Writes a releases.json next to the built artifacts and to
// marketing/data/releases.json so the marketing API can serve it.
//
// Usage: node write-release-manifest.mjs <out-dir> <version>

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, readdirSync, statSync, mkdirSync } from 'node:fs';
import { resolve, dirname, basename, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const outDir = process.argv[2];
const version = process.argv[3] ?? '0.0.0';

if (!outDir) {
  console.error('usage: write-release-manifest.mjs <out-dir> <version>');
  process.exit(1);
}

const PLATFORM_RULES = [
  { pattern: /aarch64.*\.dmg$/i,        platform: 'mac-arm64' },
  { pattern: /apple-darwin.*\.dmg$/i,   platform: 'mac-arm64' },
  { pattern: /universal.*\.dmg$/i,      platform: 'mac-arm64' },
  { pattern: /x86_64.*\.dmg$/i,         platform: 'mac-x64' },
  { pattern: /\.dmg$/i,                 platform: 'mac-arm64' },
  { pattern: /_x64.*\.msi$/i,           platform: 'windows-x64' },
  { pattern: /\.msi$/i,                 platform: 'windows-x64' },
  { pattern: /_x64.*\.exe$/i,           platform: 'windows-x64' },
  { pattern: /-setup\.exe$/i,           platform: 'windows-x64' },
];

function classify(name) {
  for (const r of PLATFORM_RULES) {
    if (r.pattern.test(name)) return r.platform;
  }
  return null;
}

function bytesHuman(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

function sha256(file) {
  const hash = createHash('sha256');
  hash.update(readFileSync(file));
  return hash.digest('hex');
}

const assets = [];
for (const name of readdirSync(outDir)) {
  const full = resolve(outDir, name);
  const ext = extname(name).toLowerCase();
  if (!['.dmg', '.msi', '.exe'].includes(ext)) continue;
  const platform = classify(name);
  if (!platform) continue;
  const stat = statSync(full);
  assets.push({
    name,
    url: `/downloads/${version}/${name}`,
    size: bytesHuman(stat.size),
    bytes: stat.size,
    platform,
    sha256: sha256(full),
  });
}

const notes = [
  `Release v${version}`,
  ...readNotesFromChangelog(version),
];

const release = {
  version,
  released_at: new Date().toISOString(),
  notes,
  assets,
};

writeFileSync(resolve(outDir, 'releases.json'), JSON.stringify(release, null, 2));

const marketingDataDir = resolve(ROOT, 'marketing/data');
mkdirSync(marketingDataDir, { recursive: true });
writeFileSync(resolve(marketingDataDir, 'releases.json'), JSON.stringify(release, null, 2));

console.log(`✓ releases.json written for ${assets.length} asset(s)`);
for (const a of assets) {
  console.log(`  · ${a.platform.padEnd(11)} ${a.size.padStart(8)}  ${a.name}`);
}

function readNotesFromChangelog(v) {
  try {
    const raw = readFileSync(resolve(ROOT, 'CHANGELOG.md'), 'utf8');
    const blocks = raw.split(/\n##\s+/);
    for (const block of blocks) {
      if (block.startsWith(`v${v}`) || block.startsWith(`[v${v}]`) || block.includes(v)) {
        return block
          .split('\n')
          .filter((l) => l.trim().startsWith('-'))
          .map((l) => l.replace(/^-\s*/, '').trim())
          .filter(Boolean);
      }
    }
  } catch { /* CHANGELOG.md optional */ }
  return [];
}
