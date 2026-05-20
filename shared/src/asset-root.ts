// ──────────────────────────────────────────────────────────────────────────────
// Asset Root Resolution
//
// Single source of truth for "where can the system store and serve images?".
// Anything under one of these roots is safe to read via /api/products/image.
// Everything else is rejected to prevent path-traversal.
//
// Layout convention for new-style listings (user-upload + multi-shot pipeline):
//
//   $USER_ASSETS_ROOT/products/{folder_num}/
//     source/    ← uploaded by user or imported from CJ
//     product/   ← solo product shot on white (AI-generated)
//     model/     ← model wearing the product (AI-generated)
//     scene/     ← lifestyle / environment (AI-generated)
//     final/     ← curated, ready-to-publish set
//
// Legacy folders under VINTED_ROOT/Vinted/{Cat}/{N}/ keep working — they are
// still in the whitelist.
// ──────────────────────────────────────────────────────────────────────────────

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function expandHome(p: string): string {
  if (p.startsWith('~/')) return path.join(os.homedir(), p.slice(2));
  return p;
}

// macOS default: ~/Library/Application Support/Blackruby/assets
function defaultUserAssetsRoot(): string {
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'Blackruby', 'assets');
  }
  if (process.platform === 'win32') {
    const appData = process.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming');
    return path.join(appData, 'Blackruby', 'assets');
  }
  return path.join(os.homedir(), '.local', 'share', 'blackruby', 'assets');
}

// macOS default: ~/Blackruby — same on every platform, lives in the user's
// home so the app works without env vars after install.
function defaultVintedRoot(): string {
  return path.join(os.homedir(), 'Blackruby');
}

// Returns the configured Vinted root. The legacy default `/Users/home/Vinted`
// only kicks in for the dev machine where it actually exists — everywhere
// else we fall back to `~/Blackruby`. Auto-creates the directory so callers
// never have to worry about it.
let vintedRootCache: string | null = null;
export function vintedRoot(): string {
  if (vintedRootCache) return vintedRootCache;
  const fromEnv = process.env.VINTED_ROOT;
  let resolved: string;
  if (fromEnv && fromEnv.trim().length > 0) {
    resolved = expandHome(fromEnv);
  } else if (fs.existsSync('/Users/home/Vinted')) {
    // Dev-machine convenience: keep the legacy path working without env vars.
    resolved = '/Users/home/Vinted';
  } else {
    resolved = defaultVintedRoot();
  }
  try {
    fs.mkdirSync(resolved, { recursive: true });
  } catch {
    // If we can't create it we still return the path — callers may handle.
  }
  vintedRootCache = resolved;
  return resolved;
}

export function userAssetsRoot(): string {
  return expandHome(process.env.BLACKRUBY_USER_ASSETS ?? defaultUserAssetsRoot());
}

// Folder layout helpers — caller is responsible for ensuring the directory
// exists (call `ensureProductLayout` first).
export type ShotKind = 'source' | 'product' | 'model' | 'scene' | 'final';

export function productFolder(folderNum: number): string {
  return path.join(userAssetsRoot(), 'products', String(folderNum));
}

export function shotFolder(folderNum: number, kind: ShotKind): string {
  return path.join(productFolder(folderNum), kind);
}

export function ensureProductLayout(folderNum: number): void {
  const kinds: ShotKind[] = ['source', 'product', 'model', 'scene', 'final'];
  for (const k of kinds) {
    const dir = shotFolder(folderNum, k);
    fs.mkdirSync(dir, { recursive: true });
  }
}

// All directory trees the orchestrator is allowed to serve images from.
// Resolved to canonical absolute paths so a symlink can't sneak past the check.
export function allowedAssetRoots(): string[] {
  const roots = [vintedRoot(), userAssetsRoot()];
  return roots
    .map((r) => {
      try {
        // realpath fails if the path doesn't exist yet — fall back to absolute
        return fs.existsSync(r) ? fs.realpathSync(r) : path.resolve(r);
      } catch {
        return path.resolve(r);
      }
    })
    .filter((r, i, arr) => arr.indexOf(r) === i);
}

// Return the canonical absolute path if the requested path lives inside one
// of the allowed roots, else null. Resolves symlinks first to defeat
// `..` / symlink escapes.
export function safeResolveAssetPath(requested: string): string | null {
  if (!requested) return null;
  let resolved: string;
  try {
    const abs = path.resolve(expandHome(requested));
    resolved = fs.existsSync(abs) ? fs.realpathSync(abs) : abs;
  } catch {
    return null;
  }
  const roots = allowedAssetRoots();
  const inside = roots.some((root) => {
    const rootWithSep = root.endsWith(path.sep) ? root : root + path.sep;
    return resolved === root || resolved.startsWith(rootWithSep);
  });
  return inside ? resolved : null;
}
