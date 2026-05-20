// Routes für Scene-Profiles (Vinted-Style Umgebungen)
//
//   GET   /api/scene/profiles                  → list
//   GET   /api/scene/profiles/active           → currently active profiles
//   GET   /api/scene/profiles/:id              → one profile
//   POST  /api/scene/profiles                  → create
//   PUT   /api/scene/profiles/:id              → update
//   POST  /api/scene/profiles/:id/activate     → mark active
//   POST  /api/scene/profiles/:id/deactivate   → mark inactive
//   DELETE /api/scene/profiles/:id             → delete
//   GET   /api/scene/pickers                   → picker option catalog
//   POST  /api/scene/preview                   → generate one preview image (live)

import { Router } from 'express';
import {
  createLogger, getDb,
  SCENE_PICKERS, DEFAULT_SCENE_ATTRIBUTES, buildSceneDescription, describeSceneShort,
  type SceneAttributes,
  buildModelDescription,
  type ModelAttributes,
  DEFAULT_ATTRIBUTES as DEFAULT_MODEL_ATTRIBUTES,
} from '@vinted-system/shared';
import { generateImageSet } from '@vinted-system/shared';

const log = createLogger('scene-route');
export const sceneRouter = Router();

interface SceneRow {
  id: number;
  name: string;
  attributes_json: string;
  active: number;
  created_at: string;
  updated_at: string;
}

function parseScene(row: SceneRow): Record<string, unknown> {
  let attributes: SceneAttributes = DEFAULT_SCENE_ATTRIBUTES;
  try {
    attributes = { ...DEFAULT_SCENE_ATTRIBUTES, ...JSON.parse(row.attributes_json) };
  } catch { /* keep defaults */ }
  return {
    id: row.id,
    name: row.name,
    attributes,
    active: row.active === 1,
    created_at: row.created_at,
    updated_at: row.updated_at,
    description: buildSceneDescription(attributes),
    short: describeSceneShort(attributes),
  };
}

// ── Pickers ──────────────────────────────────────────────────────────────────
sceneRouter.get('/pickers', (_req, res) => {
  res.json({ pickers: SCENE_PICKERS, defaults: DEFAULT_SCENE_ATTRIBUTES });
});

// ── List / read ──────────────────────────────────────────────────────────────
sceneRouter.get('/profiles', (_req, res) => {
  const rows = getDb().prepare(
    `SELECT * FROM scene_profiles ORDER BY active DESC, updated_at DESC`,
  ).all() as SceneRow[];
  res.json({ profiles: rows.map(parseScene) });
});

sceneRouter.get('/profiles/active', (_req, res) => {
  const rows = getDb().prepare(
    `SELECT * FROM scene_profiles WHERE active = 1 ORDER BY updated_at DESC`,
  ).all() as SceneRow[];
  res.json({ profiles: rows.map(parseScene) });
});

sceneRouter.get('/profiles/:id', (req, res) => {
  const id = parseInt(req.params.id ?? '', 10);
  const row = getDb().prepare(`SELECT * FROM scene_profiles WHERE id = ?`).get(id) as SceneRow | undefined;
  if (!row) return res.status(404).json({ error: 'not found' });
  res.json({ profile: parseScene(row) });
});

// ── Create / update ──────────────────────────────────────────────────────────
sceneRouter.post('/profiles', (req, res) => {
  const { name, attributes, activate } = req.body as { name?: string; attributes?: SceneAttributes; activate?: boolean };
  if (!name || !name.trim()) return res.status(400).json({ error: 'name required' });
  const merged = { ...DEFAULT_SCENE_ATTRIBUTES, ...(attributes ?? {}) };
  const r = getDb().prepare(
    `INSERT INTO scene_profiles (name, attributes_json, active) VALUES (?, ?, ?)`,
  ).run(name.trim(), JSON.stringify(merged), activate ? 1 : 0);
  const id = Number(r.lastInsertRowid);
  log.info('scene profile created', { id, name, activate });
  const row = getDb().prepare(`SELECT * FROM scene_profiles WHERE id = ?`).get(id) as SceneRow;
  res.json({ profile: parseScene(row) });
});

sceneRouter.put('/profiles/:id', (req, res) => {
  const id = parseInt(req.params.id ?? '', 10);
  const { name, attributes } = req.body as { name?: string; attributes?: SceneAttributes };
  const existing = getDb().prepare(`SELECT * FROM scene_profiles WHERE id = ?`).get(id) as SceneRow | undefined;
  if (!existing) return res.status(404).json({ error: 'not found' });
  const merged = { ...DEFAULT_SCENE_ATTRIBUTES, ...JSON.parse(existing.attributes_json), ...(attributes ?? {}) };
  getDb().prepare(
    `UPDATE scene_profiles SET name = COALESCE(?, name), attributes_json = ?, updated_at = datetime('now') WHERE id = ?`,
  ).run(name?.trim() ?? null, JSON.stringify(merged), id);
  const row = getDb().prepare(`SELECT * FROM scene_profiles WHERE id = ?`).get(id) as SceneRow;
  res.json({ profile: parseScene(row) });
});

sceneRouter.post('/profiles/:id/activate', (req, res) => {
  const id = parseInt(req.params.id ?? '', 10);
  getDb().prepare(`UPDATE scene_profiles SET active = 1, updated_at = datetime('now') WHERE id = ?`).run(id);
  log.info('scene profile activated', { id });
  res.json({ ok: true });
});

sceneRouter.post('/profiles/:id/deactivate', (req, res) => {
  const id = parseInt(req.params.id ?? '', 10);
  getDb().prepare(`UPDATE scene_profiles SET active = 0, updated_at = datetime('now') WHERE id = ?`).run(id);
  res.json({ ok: true });
});

sceneRouter.delete('/profiles/:id', (req, res) => {
  const id = parseInt(req.params.id ?? '', 10);
  getDb().prepare(`DELETE FROM scene_profiles WHERE id = ?`).run(id);
  res.json({ ok: true });
});

// ── Live preview ─────────────────────────────────────────────────────────────
sceneRouter.post('/preview', async (req, res) => {
  try {
    const { attributes } = req.body as { attributes?: SceneAttributes };
    const sceneAttrs = { ...DEFAULT_SCENE_ATTRIBUTES, ...(attributes ?? {}) };

    // Pull the active model so the preview shows scene + model combined.
    const modelRow = getDb().prepare(`SELECT attributes_json FROM model_profiles WHERE active = 1 LIMIT 1`)
      .get() as { attributes_json: string } | undefined;
    let modelAttrs: ModelAttributes = DEFAULT_MODEL_ATTRIBUTES;
    if (modelRow) {
      try {
        modelAttrs = { ...DEFAULT_MODEL_ATTRIBUTES, ...JSON.parse(modelRow.attributes_json) };
      } catch { /* */ }
    }
    const modelDesc = buildModelDescription(modelAttrs);
    const sceneDesc = buildSceneDescription(sceneAttrs);
    const prompt = `Photo of a ${modelDesc}, ${sceneDesc}. Realistic Vinted-seller iPhone photo, no text or logos. Output: portrait orientation, 3:4.`;

    const imgs = await generateImageSet({
      prompt,
      count: 1,
      aspectRatio: '3:4',
      timeoutMs: 90_000,
    });
    if (imgs.length === 0) {
      return res.status(500).json({ ok: false, error: 'image generation returned no results — check GEMINI_API_KEY' });
    }
    const img = imgs[0]!;
    res.json({
      ok: true,
      dataUrl: `data:${img.mimeType};base64,${img.buffer.toString('base64')}`,
      description: sceneDesc,
    });
  } catch (e) {
    log.error('scene preview failed', { err: e instanceof Error ? e.message : String(e) });
    res.json({ ok: false, error: e instanceof Error ? e.message : String(e) });
  }
});
