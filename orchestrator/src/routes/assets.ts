// ──────────────────────────────────────────────────────────────────────────────
// Asset routes — read/write images stored in the convention-based layout under
// userAssetsRoot()/products/{folder_num}/{kind}/.
//
//   POST   /api/assets/upload                       upload one image (base64)
//   GET    /api/assets/folder/:folderNum            list all shots in a folder
//   POST   /api/assets/folder/:folderNum/use        copy paths into listing
//   DELETE /api/assets/folder/:folderNum/:kind/:f   delete one file
// ──────────────────────────────────────────────────────────────────────────────

import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import {
  createLogger,
  ensureProductLayout,
  getDb,
  productFolder,
  safeResolveAssetPath,
  shotFolder,
  type ShotKind,
} from '@vinted-system/shared';

const log = createLogger('assets-route');
export const assetsRouter = Router();

const VALID_KINDS: ReadonlyArray<ShotKind> = ['source', 'product', 'model', 'scene', 'final'];
// 10 MB ceiling per image — generous for retina JPEGs, blocks abuse.
const MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED_EXT: ReadonlyArray<string> = ['.jpg', '.jpeg', '.png', '.webp'];

function isShotKind(s: unknown): s is ShotKind {
  return typeof s === 'string' && (VALID_KINDS as readonly string[]).includes(s);
}

function safeFilename(name: string): string {
  const base = path.basename(name).replace(/[^a-zA-Z0-9._-]/g, '_');
  return base.length > 64 ? base.slice(-64) : base;
}

// ── POST /api/assets/upload ──────────────────────────────────────────────────
// Body: { folder_num: number, kind: ShotKind, filename: string, data_url: string }
// data_url is the standard "data:image/jpeg;base64,..." form.
assetsRouter.post('/upload', (req, res) => {
  try {
    const { folder_num, kind, filename, data_url } = req.body as {
      folder_num?: number;
      kind?: string;
      filename?: string;
      data_url?: string;
    };
    if (!Number.isInteger(folder_num) || folder_num! < 1) {
      return res.status(400).json({ ok: false, error: 'folder_num must be a positive integer' });
    }
    if (!isShotKind(kind)) {
      return res.status(400).json({ ok: false, error: `kind must be one of ${VALID_KINDS.join(', ')}` });
    }
    if (!filename || !data_url) {
      return res.status(400).json({ ok: false, error: 'filename and data_url required' });
    }
    const ext = path.extname(filename).toLowerCase();
    if (!ALLOWED_EXT.includes(ext)) {
      return res.status(400).json({ ok: false, error: `extension must be one of ${ALLOWED_EXT.join(', ')}` });
    }

    const m = /^data:image\/(jpeg|jpg|png|webp);base64,(.+)$/i.exec(data_url);
    if (!m) {
      return res.status(400).json({ ok: false, error: 'data_url must be an image base64 data URL' });
    }
    const buf = Buffer.from(m[2]!, 'base64');
    if (buf.length === 0 || buf.length > MAX_BYTES) {
      return res.status(400).json({ ok: false, error: `file too large or empty (${buf.length} bytes)` });
    }

    ensureProductLayout(folder_num!);
    const safeName = safeFilename(filename);
    const dest = path.join(shotFolder(folder_num!, kind), safeName);
    fs.writeFileSync(dest, buf);

    log.info('asset uploaded', { folder_num, kind, size: buf.length, dest });
    res.json({ ok: true, path: dest, size: buf.length });
  } catch (e) {
    log.error('upload failed', { err: e instanceof Error ? e.message : String(e) });
    res.status(500).json({ ok: false, error: e instanceof Error ? e.message : String(e) });
  }
});

// ── GET /api/assets/folder/:folderNum ────────────────────────────────────────
// Lists every shot in the convention layout, grouped by kind.
assetsRouter.get('/folder/:folderNum', (req, res) => {
  try {
    const folderNum = Number.parseInt(req.params.folderNum, 10);
    if (!Number.isInteger(folderNum)) return res.status(400).json({ ok: false, error: 'invalid folderNum' });

    const out: Record<ShotKind, Array<{ filename: string; path: string; size: number; mtime: string }>> = {
      source: [], product: [], model: [], scene: [], final: [],
    };

    for (const kind of VALID_KINDS) {
      const dir = shotFolder(folderNum, kind);
      if (!fs.existsSync(dir)) continue;
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const e of entries) {
        if (!e.isFile()) continue;
        const ext = path.extname(e.name).toLowerCase();
        if (!ALLOWED_EXT.includes(ext)) continue;
        const full = path.join(dir, e.name);
        const stat = fs.statSync(full);
        out[kind].push({
          filename: e.name,
          path: full,
          size: stat.size,
          mtime: stat.mtime.toISOString(),
        });
      }
      out[kind].sort((a, b) => a.filename.localeCompare(b.filename));
    }

    res.json({ ok: true, folder_num: folderNum, root: productFolder(folderNum), shots: out });
  } catch (e) {
    res.status(500).json({ ok: false, error: e instanceof Error ? e.message : String(e) });
  }
});

// ── POST /api/assets/folder/:folderNum/use ───────────────────────────────────
// Body: { kinds: ShotKind[] } — replaces the listing's photo_paths_json with
// the union of files from the requested kinds, in `final → model → scene →
// product → source` priority order. No-op if the auto_listing row is missing.
assetsRouter.post('/folder/:folderNum/use', (req, res) => {
  try {
    const folderNum = Number.parseInt(req.params.folderNum, 10);
    if (!Number.isInteger(folderNum)) return res.status(400).json({ ok: false, error: 'invalid folderNum' });

    const requested = ((req.body as { kinds?: unknown })?.kinds ?? []) as unknown[];
    const kinds = requested.filter(isShotKind);
    if (kinds.length === 0) return res.status(400).json({ ok: false, error: 'kinds must be a non-empty array' });

    const collected: string[] = [];
    const priority: ShotKind[] = ['final', 'model', 'scene', 'product', 'source'];
    for (const k of priority) {
      if (!kinds.includes(k)) continue;
      const dir = shotFolder(folderNum, k);
      if (!fs.existsSync(dir)) continue;
      for (const f of fs.readdirSync(dir).sort()) {
        const ext = path.extname(f).toLowerCase();
        if (!ALLOWED_EXT.includes(ext)) continue;
        collected.push(path.join(dir, f));
      }
    }
    if (collected.length === 0) return res.status(404).json({ ok: false, error: 'no images found in the requested kinds' });

    const db = getDb();
    const result = db
      .prepare(`UPDATE auto_listings SET photo_paths_json = ?, updated_at = datetime('now') WHERE folder_num = ?`)
      .run(JSON.stringify(collected), folderNum);
    res.json({ ok: true, photos: collected.length, updated: result.changes > 0 });
  } catch (e) {
    res.status(500).json({ ok: false, error: e instanceof Error ? e.message : String(e) });
  }
});

// ── DELETE /api/assets/folder/:folderNum/:kind/:filename ────────────────────
assetsRouter.delete('/folder/:folderNum/:kind/:filename', (req, res) => {
  try {
    const folderNum = Number.parseInt(req.params.folderNum, 10);
    const { kind, filename } = req.params;
    if (!Number.isInteger(folderNum)) return res.status(400).json({ ok: false, error: 'invalid folderNum' });
    if (!isShotKind(kind)) return res.status(400).json({ ok: false, error: 'invalid kind' });
    if (!filename || filename.includes('/') || filename.includes('..')) {
      return res.status(400).json({ ok: false, error: 'invalid filename' });
    }
    const target = path.join(shotFolder(folderNum, kind), filename);
    const safe = safeResolveAssetPath(target);
    if (!safe) return res.status(400).json({ ok: false, error: 'path outside allowed roots' });
    if (!fs.existsSync(safe)) return res.status(404).json({ ok: false, error: 'not found' });
    fs.unlinkSync(safe);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e instanceof Error ? e.message : String(e) });
  }
});
