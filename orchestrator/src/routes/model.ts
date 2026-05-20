// Routes für Model-Profiles (Sims-Builder)
//
//   GET   /api/model/profiles                  → list
//   GET   /api/model/profiles/active           → current active profile
//   GET   /api/model/profiles/:id              → one profile
//   POST  /api/model/profiles                  → create
//   PUT   /api/model/profiles/:id              → update
//   POST  /api/model/profiles/:id/activate     → set active=1 (others 0)
//   DELETE /api/model/profiles/:id             → delete
//   POST  /api/model/profiles/:id/reference    → upload reference image
//   GET   /api/model/profiles/:id/reference    → serve reference image
//   GET   /api/model/pickers                   → catalog of all picker options
//   POST  /api/model/preview                   → generate one preview image (live)

import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { createLogger, getDb, MODEL_PICKERS, DEFAULT_ATTRIBUTES, buildModelDescription, type ModelAttributes, generateImageSetWithError, buildVintedFashionPrompt } from '@vinted-system/shared';

const log = createLogger('model-route');
export const modelRouter = Router();

const REFERENCE_DIR = process.env.MODEL_REFERENCE_DIR
  ?? path.resolve(process.cwd(), '../data/model-references');
fs.mkdirSync(REFERENCE_DIR, { recursive: true });

interface ProfileRow {
  id: number;
  name: string;
  attributes_json: string;
  reference_image_path: string | null;
  active: number;
  created_at: string;
  updated_at: string;
}

function parseProfile(row: ProfileRow): Record<string, unknown> {
  let attributes: ModelAttributes = DEFAULT_ATTRIBUTES;
  try {
    attributes = { ...DEFAULT_ATTRIBUTES, ...JSON.parse(row.attributes_json) };
  } catch { /* keep defaults */ }
  return {
    id: row.id,
    name: row.name,
    attributes,
    has_reference: !!row.reference_image_path,
    active: row.active === 1,
    created_at: row.created_at,
    updated_at: row.updated_at,
    description: buildModelDescription(attributes),
  };
}

// ── Pickers ──────────────────────────────────────────────────────────────────
modelRouter.get('/pickers', (_req, res) => {
  res.json({ pickers: MODEL_PICKERS, defaults: DEFAULT_ATTRIBUTES });
});

// ── List ──────────────────────────────────────────────────────────────────────
modelRouter.get('/profiles', (_req, res) => {
  const rows = getDb().prepare(
    `SELECT * FROM model_profiles ORDER BY active DESC, updated_at DESC`,
  ).all() as ProfileRow[];
  res.json({ profiles: rows.map(parseProfile) });
});

modelRouter.get('/profiles/active', (_req, res) => {
  const row = getDb().prepare(
    `SELECT * FROM model_profiles WHERE active = 1 LIMIT 1`,
  ).get() as ProfileRow | undefined;
  if (!row) return res.json({ profile: null });
  res.json({ profile: parseProfile(row) });
});

modelRouter.get('/profiles/:id', (req, res) => {
  const id = parseInt(req.params.id ?? '', 10);
  const row = getDb().prepare(`SELECT * FROM model_profiles WHERE id = ?`).get(id) as ProfileRow | undefined;
  if (!row) return res.status(404).json({ error: 'not found' });
  res.json({ profile: parseProfile(row) });
});

// ── Create ───────────────────────────────────────────────────────────────────
modelRouter.post('/profiles', (req, res) => {
  const { name, attributes, activate } = req.body as {
    name?: string;
    attributes?: Partial<ModelAttributes>;
    activate?: boolean;
  };
  if (!name?.trim()) return res.status(400).json({ error: 'name required' });

  const merged: ModelAttributes = { ...DEFAULT_ATTRIBUTES, ...(attributes ?? {}) };
  const db = getDb();
  const r = db.prepare(
    `INSERT INTO model_profiles (name, attributes_json, active)
     VALUES (?, ?, 0)`,
  ).run(name.trim(), JSON.stringify(merged));
  const id = Number(r.lastInsertRowid);

  if (activate) activateProfile(id);

  const row = db.prepare(`SELECT * FROM model_profiles WHERE id = ?`).get(id) as ProfileRow;
  log.info('Created model profile', { id, name });
  res.json({ profile: parseProfile(row) });
});

// ── Update ───────────────────────────────────────────────────────────────────
modelRouter.put('/profiles/:id', (req, res) => {
  const id = parseInt(req.params.id ?? '', 10);
  const { name, attributes } = req.body as { name?: string; attributes?: Partial<ModelAttributes> };

  const existing = getDb().prepare(`SELECT * FROM model_profiles WHERE id = ?`).get(id) as ProfileRow | undefined;
  if (!existing) return res.status(404).json({ error: 'not found' });

  const next: ModelAttributes = attributes
    ? { ...DEFAULT_ATTRIBUTES, ...JSON.parse(existing.attributes_json), ...attributes }
    : JSON.parse(existing.attributes_json);

  getDb().prepare(
    `UPDATE model_profiles SET name = COALESCE(?, name), attributes_json = ?, updated_at = datetime('now') WHERE id = ?`,
  ).run(name ?? null, JSON.stringify(next), id);

  const row = getDb().prepare(`SELECT * FROM model_profiles WHERE id = ?`).get(id) as ProfileRow;
  res.json({ profile: parseProfile(row) });
});

// ── Activate ─────────────────────────────────────────────────────────────────
function activateProfile(id: number): void {
  const db = getDb();
  db.transaction(() => {
    db.prepare(`UPDATE model_profiles SET active = 0`).run();
    db.prepare(`UPDATE model_profiles SET active = 1, updated_at = datetime('now') WHERE id = ?`).run(id);
  })();
}

modelRouter.post('/profiles/:id/activate', (req, res) => {
  const id = parseInt(req.params.id ?? '', 10);
  activateProfile(id);
  const row = getDb().prepare(`SELECT * FROM model_profiles WHERE id = ?`).get(id) as ProfileRow | undefined;
  if (!row) return res.status(404).json({ error: 'not found' });
  log.info('Activated model profile', { id });
  res.json({ profile: parseProfile(row) });
});

// ── Delete ───────────────────────────────────────────────────────────────────
modelRouter.delete('/profiles/:id', (req, res) => {
  const id = parseInt(req.params.id ?? '', 10);
  const row = getDb().prepare(`SELECT reference_image_path FROM model_profiles WHERE id = ?`).get(id) as { reference_image_path: string | null } | undefined;
  if (row?.reference_image_path) {
    try { fs.unlinkSync(row.reference_image_path); } catch { /* */ }
  }
  getDb().prepare(`DELETE FROM model_profiles WHERE id = ?`).run(id);
  res.json({ ok: true });
});

// ── Reference image ──────────────────────────────────────────────────────────
// Body is base64-encoded image data (data:image/...;base64,...).
modelRouter.post('/profiles/:id/reference', (req, res) => {
  const id = parseInt(req.params.id ?? '', 10);
  const { dataUrl } = req.body as { dataUrl?: string };
  if (!dataUrl) return res.status(400).json({ error: 'dataUrl required' });
  const m = dataUrl.match(/^data:(image\/[a-z+]+);base64,(.+)$/);
  if (!m) return res.status(400).json({ error: 'invalid dataUrl' });
  const mime = m[1] ?? 'image/png';
  const data = m[2] ?? '';
  const ext = mime.split('/')[1]?.split('+')[0] ?? 'png';
  const dst = path.join(REFERENCE_DIR, `${id}.${ext}`);
  fs.writeFileSync(dst, Buffer.from(data, 'base64'));
  getDb().prepare(`UPDATE model_profiles SET reference_image_path = ?, updated_at = datetime('now') WHERE id = ?`).run(dst, id);
  res.json({ ok: true, path: dst });
});

modelRouter.get('/profiles/:id/reference', (req, res) => {
  const id = parseInt(req.params.id ?? '', 10);
  const row = getDb().prepare(`SELECT reference_image_path FROM model_profiles WHERE id = ?`).get(id) as { reference_image_path: string | null } | undefined;
  if (!row?.reference_image_path || !fs.existsSync(row.reference_image_path)) return res.status(404).end();
  res.sendFile(row.reference_image_path);
});

// ── Preview generation ───────────────────────────────────────────────────────
// One-shot: takes attributes (not necessarily saved), generates a single
// preview image so the user can iterate the picker without committing.
modelRouter.post('/preview', async (req, res) => {
  try {
    const { attributes } = req.body as { attributes?: Partial<ModelAttributes> };
    const merged: ModelAttributes = { ...DEFAULT_ATTRIBUTES, ...(attributes ?? {}) };

    const modelDesc = buildModelDescription(merged);
    const scenePrompt = buildVintedFashionPrompt({
      productType: 'simple white t-shirt and jeans',
      scene: 'studio',
    });
    const fullPrompt = `${modelDesc}\n\n${scenePrompt}\n\nThis is a portrait reference shot — full body visible, neutral studio background. Capture the model's identity clearly: face, hair, body proportions. Output: portrait orientation, 3:4.`;

    const { images: imgs, error: imgErr } = await generateImageSetWithError({
      prompt: fullPrompt,
      count: 1,
      aspectRatio: '3:4',
      timeoutMs: 90_000,
    });
    if (imgs.length === 0) {
      const err = imgErr;
      // Map common Gemini failure modes to actionable messages so the
      // dashboard toast tells the user what to actually do.
      let hint = 'check GEMINI_API_KEY';
      if (err?.status === 429) hint = 'Gemini-Quota erschöpft — Billing aktivieren oder warten';
      else if (err?.status === 404) hint = `Modell nicht gefunden — GEMINI_IMAGE_MODEL prüfen (${err.message.slice(0, 80)})`;
      else if (err?.status === 403) hint = 'API-Key ungültig oder ohne Permissions';
      else if (err?.message) hint = err.message.slice(0, 200);
      return res.status(500).json({ ok: false, error: `Image-Generation fehlgeschlagen: ${hint}` });
    }
    const img = imgs[0]!;
    res.json({
      ok: true,
      dataUrl: `data:${img.mimeType};base64,${img.buffer.toString('base64')}`,
      description: modelDesc,
    });
  } catch (e) {
    log.warn('Preview failed', { err: e instanceof Error ? e.message : String(e) });
    res.status(500).json({ ok: false, error: e instanceof Error ? e.message : String(e) });
  }
});
