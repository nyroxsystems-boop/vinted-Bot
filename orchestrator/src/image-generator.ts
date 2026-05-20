// ──────────────────────────────────────────────────────────────────────────────
// Image-Generator Worker
//
// Scans `crawled_products` with status = 'crawled' (= source images downloaded,
// no model shots yet) and produces the five `generated/*` images the
// listing-generator expects.
//
// Three back-ends, chosen by the `image_gen_mode` setting:
//
//   • 'copy_source'  — simply copy the Temu source images into generated/.
//                       Fast, zero-dependency, "looks like Temu" — but
//                       guarantees the pipeline never stalls waiting for a
//                       generative agent. Good default to get to listing
//                       quickly; can be upgraded later.
//
//   • 'antigravity'  — don't do anything here; the external Antigravity-MCP
//                       agent will pick up the queue file. Legacy path.
//
//   • 'gemini'       — call the Gemini image API directly (requires
//                       GEMINI_API_KEY in env). Not enabled by default —
//                       requires per-image quota + API cost.
//
// Runs every 60s, processes N folders per cycle (default 3), updates the
// DB status to 'ready' once `generated/` contains ≥ 3 images.
// ──────────────────────────────────────────────────────────────────────────────

import fs from 'node:fs/promises';
import path from 'node:path';
import {
  createLogger, getDb, getSetting, setSetting, isPaused,
  generateImageSet, buildVintedFashionPrompt,
  buildModelLockPrompt, DEFAULT_ATTRIBUTES, type ModelAttributes,
} from '@vinted-system/shared';

const log = createLogger('image-generator');

// ── Realism Mode ────────────────────────────────────────────────────────────
// `image_gen_realism_mode` decides HOW we use the source product photo:
//   • realistic — Source photo is the visual reference; Gemini composites
//     the EXACT garment onto a stylized model+background. New default —
//     buyers see what they'll receive, reduces dispute rate + Vinted's AI-
//     detection heuristics (synthetic models on every listing = flag).
//   • synthetic — Full LLM-generated lifestyle scene (legacy). Faster but
//     buyer-visible discrepancy when the listing photo and the shipped item
//     differ in cut/print/wash.
//   • copy_source — copy source images as-is, no AI.
type RealismMode = 'realistic' | 'synthetic' | 'copy_source';

function getRealismMode(): RealismMode {
  const v = (getSetting('image_gen_realism_mode') ?? 'realistic').toLowerCase();
  if (v === 'realistic' || v === 'synthetic' || v === 'copy_source') return v;
  return 'realistic';
}

// ── Daily cost cap (Gemini image-gen) ────────────────────────────────────────
// Gemini 2.5 Flash image-gen is ~$0.04 USD per image (rough estimate). We
// bump a per-day counter on every successful generation and skip the cycle
// entirely once we've burned through the configured EUR budget.
const IMAGE_COST_USD_PER_IMAGE = 0.04;

function todayKey(): string {
  return `image_gen_cost_${new Date().toISOString().slice(0, 10)}`;
}

function getTodayCostEur(): number {
  const raw = getSetting(todayKey()) ?? '0';
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}

function bumpTodayCostEur(deltaUsd: number): void {
  const eur = deltaUsd * 0.92; // USD→EUR rough
  const next = getTodayCostEur() + eur;
  setSetting(todayKey(), String(next));
}

function getDailyCapEur(): number {
  const n = Number(getSetting('image_gen_max_daily_eur') ?? '10');
  return Number.isFinite(n) ? n : 10;
}

function isOverDailyCap(): boolean {
  return getTodayCostEur() >= getDailyCapEur();
}

// Best-effort schema add — these columns let us back off retries instead of
// terminally failing on the first hiccup. SQLite ignores duplicate adds via
// try/catch on ALTER TABLE.
function ensureRetryColumns(): void {
  const db = getDb();
  const tryAdd = (sql: string) => {
    try { db.exec(sql); } catch { /* column already exists */ }
  };
  tryAdd(`ALTER TABLE crawled_products ADD COLUMN image_gen_retry_count INTEGER NOT NULL DEFAULT 0`);
  tryAdd(`ALTER TABLE crawled_products ADD COLUMN image_gen_next_retry_at TEXT`);
}
ensureRetryColumns();

const RETRY_BACKOFFS = ['+30 minutes', '+2 hours', '+6 hours'];
const MAX_RETRIES = RETRY_BACKOFFS.length;

let timer: ReturnType<typeof setInterval> | null = null;
let isRunning = false;

const POLL_INTERVAL_MS = 60_000; // 1 min
const MIN_IMAGES = 3;
const TARGET_IMAGES = 5;

interface CrawledRow {
  id: number;
  folder_num: number;
  folder_path: string | null;
  title: string | null;
}

async function tick(): Promise<void> {
  if (isRunning) return;
  if (isPaused()) return;
  const mode = getSetting('image_gen_mode') ?? 'copy_source';
  if (mode === 'antigravity') return; // hand control to the external agent
  isRunning = true;
  try {
    await generateBatch(mode);
  } catch (err) {
    log.error('Image generator crashed', {
      error: err instanceof Error ? err.message : String(err),
    });
  } finally {
    isRunning = false;
  }
}

async function generateBatch(mode: string): Promise<void> {
  // Hard daily cost cap — if Gemini has already burned through the budget,
  // skip the whole cycle (only matters for `gemini` mode, but cheap to check
  // unconditionally so we keep the safety net even if the operator toggles
  // modes mid-day).
  if (mode === 'gemini' && isOverDailyCap()) {
    log.warn(`[image-gen] daily cost cap reached — skipping cycle`, {
      capEur: getDailyCapEur(), spentEur: getTodayCostEur(),
    });
    setSetting('image_gen_cost_blocked', '1');
    return;
  }
  // Clear the blocked flag if we're back under cap (e.g. new day).
  if (getSetting('image_gen_cost_blocked') === '1' && !isOverDailyCap()) {
    setSetting('image_gen_cost_blocked', '0');
  }

  const maxPerCycle = Math.max(
    1,
    Number.parseInt(getSetting('image_gen_max_per_cycle') ?? '3', 10),
  );

  // Skip rows that are still in their retry-cooldown window.
  const rows = getDb()
    .prepare(
      `SELECT id, folder_num, folder_path, title
         FROM crawled_products
        WHERE status = 'crawled'
          AND folder_path IS NOT NULL
          AND (image_gen_next_retry_at IS NULL
               OR image_gen_next_retry_at <= datetime('now'))
        ORDER BY crawled_at ASC
        LIMIT ?`,
    )
    .all(maxPerCycle) as CrawledRow[];

  if (rows.length === 0) return;
  log.info('Processing crawled products', { count: rows.length, mode });

  for (const row of rows) {
    if (!row.folder_path) continue;
    try {
      getDb()
        .prepare(`UPDATE crawled_products SET status = 'generating', updated_at = datetime('now') WHERE id = ?`)
        .run(row.id);

      const paths = await produceImages(row.folder_path, mode);

      if (paths.length < MIN_IMAGES) {
        scheduleRetryOrFail(row.id, `Only produced ${paths.length} images (min ${MIN_IMAGES})`);
        continue;
      }

      await fs.writeFile(
        path.join(row.folder_path, 'generated_images.json'),
        JSON.stringify(paths, null, 2),
      );

      getDb()
        .prepare(
          `UPDATE crawled_products
              SET status = 'ready',
                  last_error = NULL,
                  image_gen_next_retry_at = NULL,
                  updated_at = datetime('now')
            WHERE id = ?`,
        )
        .run(row.id);

      log.info('Images produced', {
        folderNum: row.folder_num,
        title: row.title,
        count: paths.length,
        mode,
      });
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      log.warn('Image gen failed', { folderNum: row.folder_num, error });
      scheduleRetryOrFail(row.id, error);
    }
  }
}

// ── Retry / failure book-keeping ─────────────────────────────────────────────
// Increment retry_count; if we still have retries left, keep status='crawled'
// but push next_retry_at into the future so the SELECT skips this row.
// Only after MAX_RETRIES do we mark the row terminally 'failed'.
function scheduleRetryOrFail(rowId: number, errorMsg: string): void {
  const db = getDb();
  const current = db.prepare(
    `SELECT image_gen_retry_count AS c FROM crawled_products WHERE id = ?`,
  ).get(rowId) as { c: number | null } | undefined;
  const used = current?.c ?? 0;
  const nextCount = used + 1;
  if (used < MAX_RETRIES) {
    const backoff = RETRY_BACKOFFS[used]!;
    db.prepare(
      `UPDATE crawled_products
          SET status = 'crawled',
              last_error = ?,
              image_gen_retry_count = ?,
              image_gen_next_retry_at = datetime('now', ?),
              updated_at = datetime('now')
        WHERE id = ?`,
    ).run(errorMsg, nextCount, backoff, rowId);
    log.info('Image-gen retry scheduled', { rowId, attempt: nextCount, backoff });
  } else {
    db.prepare(
      `UPDATE crawled_products
          SET status = 'failed',
              last_error = ?,
              image_gen_retry_count = ?,
              image_gen_next_retry_at = NULL,
              updated_at = datetime('now')
        WHERE id = ?`,
    ).run(errorMsg, nextCount, rowId);
    log.warn('Image-gen terminally failed after retries', { rowId, attempts: nextCount });
  }
}

async function produceImages(folderPath: string, mode: string): Promise<string[]> {
  const generatedDir = path.join(folderPath, 'generated');
  await fs.mkdir(generatedDir, { recursive: true });

  // Fast-path: if generated/ already has enough images, reuse them.
  const existing = await listImages(generatedDir);
  if (existing.length >= MIN_IMAGES) return existing;

  switch (mode) {
    case 'gemini':
      // Gemini back-end is a placeholder — without an API key the worker
      // falls back to copy_source so the pipeline keeps moving.
      if (process.env.GEMINI_API_KEY) {
        const viaGemini = await generateViaGemini(folderPath, generatedDir);
        if (viaGemini.length >= MIN_IMAGES) return viaGemini;
        log.warn('Gemini produced too few images — falling back to copy_source');
      }
    // fallthrough
    case 'copy_source':
    default:
      return copyFromSource(folderPath, generatedDir);
  }
}

// ── Back-end: copy source → generated ────────────────────────────────────────
async function copyFromSource(
  folderPath: string,
  generatedDir: string,
): Promise<string[]> {
  const sourceDir = path.join(folderPath, 'source');
  const sourceFiles = await listImages(sourceDir);
  if (sourceFiles.length === 0) {
    throw new Error('No source images — nothing to copy');
  }

  const out: string[] = [];
  // Prefer .jpg over .avif since Vinted sometimes rejects avif.
  const ordered = [...sourceFiles].sort((a, b) => {
    const prefer = (f: string) => (f.endsWith('.jpg') || f.endsWith('.jpeg') ? 0 : 1);
    return prefer(a) - prefer(b);
  });

  for (let i = 0; i < Math.min(TARGET_IMAGES, ordered.length); i++) {
    const src = ordered[i]!;
    const ext = path.extname(src) || '.jpg';
    const dst = path.join(generatedDir, `image_${i + 1}${ext}`);
    await fs.copyFile(src, dst);
    out.push(dst);
  }

  // If we had fewer unique sources than TARGET_IMAGES, re-duplicate the
  // first source so Vinted still sees ≥3 thumbnails.
  let i = out.length;
  while (out.length < MIN_IMAGES && ordered.length > 0) {
    const src = ordered[i % ordered.length]!;
    const ext = path.extname(src) || '.jpg';
    const dst = path.join(generatedDir, `image_${i + 1}${ext}`);
    await fs.copyFile(src, dst);
    out.push(dst);
    i++;
  }
  return out;
}

// ── Back-end: Gemini image generation (real) ──────────────────────────────────
// For each crawled product, use the first source image as visual reference and
// generate 4 lifestyle variants on different scenes (mirror selfie, café,
// outdoor, studio). Cover image (image_1) gets `mirror_selfie` because that's
// the most-clicked Vinted thumbnail style.
async function generateViaGemini(
  folderPath: string,
  generatedDir: string,
): Promise<string[]> {
  const sourceDir = path.join(folderPath, 'source');
  const sourceFiles = (await listImages(sourceDir));
  if (sourceFiles.length === 0) {
    log.warn('Gemini gen aborted: no source image as reference');
    return [];
  }
  const referenceImage = sourceFiles[0]!;

  // Infer product type from folder name or row metadata; fall back generically.
  const segments = folderPath.split(path.sep).filter(Boolean);
  const categoryRaw = segments[segments.length - 3] ?? 'Damen-Kleidung';
  const productType = categoryToProductType(categoryRaw);
  const folderNum = inferFolderNum(folderPath);

  // Model rotation: pick a different model per folder so Vinted's image-hash
  // / face-similarity detection doesn't flag 200 listings with the same face.
  // pickRotatedModelProfile is built by a parallel agent — fall back to the
  // legacy active-only lookup if it's not exported yet.
  let activeModel = getActiveModelAttributes();
  let modelReference = getActiveModelReferencePath();
  try {
    const shared = await import('@vinted-system/shared') as Record<string, unknown>;
    const pick = shared['pickRotatedModelProfile'] as
      | undefined
      | ((folder: number) => { attributes: ModelAttributes; reference_image_path?: string | null });
    if (typeof pick === 'function') {
      const profile = pick(folderNum);
      if (profile?.attributes) {
        activeModel = { ...DEFAULT_ATTRIBUTES, ...profile.attributes };
      }
      if (profile?.reference_image_path) {
        modelReference = profile.reference_image_path;
      }
    }
  } catch {
    // shared module didn't ship pickRotatedModelProfile yet — silent fall-through
    // to the single active profile is the correct behavior.
  }

  const modelLock = capModelLockPrompt(buildModelLockPrompt(activeModel));
  const realism = getRealismMode();

  const scenes: Array<'mirror_selfie' | 'café' | 'outdoor' | 'studio'> = [
    'mirror_selfie', 'café', 'outdoor', 'studio',
  ];

  const out: string[] = [];
  for (let i = 0; i < scenes.length; i++) {
    const scene = scenes[i]!;
    const scenePrompt = buildVintedFashionPrompt({ productType, scene });

    // In realistic mode we LOCK the garment to the source photo. The prompt
    // tells Gemini the source image is the ground-truth garment that must
    // be preserved pixel-faithful. The model/scene is composed AROUND it.
    //
    // In synthetic mode we tell Gemini to use the model reference as the
    // visual anchor and produce a from-scratch lifestyle photo.
    const prompt = realism === 'realistic'
      ? [
          'GARMENT LOCK: The first reference image shows the EXACT garment that must appear in the output.',
          'Preserve the garment\'s shape, color, print, neckline, hem, sleeves, and any visible logo/branding EXACTLY as shown in the reference.',
          'Do NOT redesign, restyle, or recolor the garment. Treat it as photographic ground truth.',
          'Now place this exact garment on the following model in the following scene:',
          '',
          modelLock,
          '',
          scenePrompt,
          '',
          'Output: a single photorealistic lifestyle photo where the garment is identical to the reference but worn by the described model in the described scene.',
        ].join('\n')
      : `${modelLock}\n\n${scenePrompt}`;

    // Reference image choice:
    //   realistic → ALWAYS use the source photo (so the garment is locked).
    //   synthetic → prefer model-reference photo (consistent face across
    //               listings); fall back to source if no reference uploaded.
    const sourceImagePath = realism === 'realistic'
      ? referenceImage
      : (modelReference ?? referenceImage);

    log.info('Gemini generating', {
      folderPath, scene, idx: i + 1, modelLocked: true,
      realism, folderNum,
    });
    const results = await generateImageSet({
      sourceImagePath,
      prompt,
      count: 1,
      aspectRatio: '3:4',
      timeoutMs: 120_000,
    });
    if (results.length === 0) {
      log.warn('Gemini returned no image for scene', { scene });
      continue;
    }
    const ext = results[0]!.mimeType === 'image/png' ? '.png' : '.jpg';
    const dst = path.join(generatedDir, `image_${i + 1}${ext}`);
    await fs.writeFile(dst, results[0]!.buffer);
    out.push(dst);
    // Cost accounting — only on successful generation. Each successful
    // Gemini image generation gets charged once to the daily counter so
    // the cap kicks in across cycles, not just within one tick.
    bumpTodayCostEur(IMAGE_COST_USD_PER_IMAGE);
    // Mid-loop cap-check: if this single product blows through the budget,
    // stop generating further scenes for it (saves money on the remaining
    // 1-3 scenes when we're right at the cap).
    if (isOverDailyCap()) {
      log.warn('[image-gen] daily cap hit mid-loop — stopping further scenes', {
        completed: out.length, planned: scenes.length,
      });
      setSetting('image_gen_cost_blocked', '1');
      break;
    }
  }

  return out;
}

/** Best-effort folder_num lookup from filesystem path. The CJ folder layout
 *  is `…/products/<n>/` — extract `<n>` so model rotation is deterministic
 *  per product. Falls back to a hash so we still get rotation if the path
 *  format changes. */
function inferFolderNum(folderPath: string): number {
  const segments = folderPath.split(path.sep).filter(Boolean);
  for (let i = segments.length - 1; i >= 0; i--) {
    const n = Number.parseInt(segments[i]!, 10);
    if (Number.isFinite(n) && n > 0 && n < 1_000_000) return n;
  }
  // Stable fallback hash so the same folder still maps to the same model
  // even when we can't parse a numeric id.
  let h = 0;
  for (let i = 0; i < folderPath.length; i++) h = (h * 31 + folderPath.charCodeAt(i)) | 0;
  return Math.abs(h) % 100_000;
}

function categoryToProductType(category: string): string {
  const c = category.toLowerCase();
  if (/kleid|dress/.test(c)) return 'summer mini dress';
  if (/crop|top/.test(c))    return 'crop top';
  if (/jeans|hose|pant/.test(c)) return 'high-waist jeans';
  if (/rock|skirt/.test(c))  return 'mini skirt';
  if (/blus|shirt/.test(c))  return 'blouse';
  if (/jacke|jacket/.test(c)) return 'transitional jacket';
  if (/hoodie/.test(c))      return 'oversized hoodie';
  return 'fashion item';
}

// ── Prompt-budget guard ──────────────────────────────────────────────────────
// Gemini image-gen prompts are billed per input token. A runaway model-lock
// prompt (e.g. a Studio profile with paragraphs of freeform text) can blow up
// the prompt cost AND degrade output quality. Cap roughly to 200 tokens
// (~800 chars) and append a marker so we can spot truncation in logs.
const MODEL_LOCK_CHAR_CAP = 800;
function capModelLockPrompt(prompt: string): string {
  if (prompt.length <= MODEL_LOCK_CHAR_CAP) return prompt;
  log.warn('model lock prompt truncated', {
    origLen: prompt.length, cappedTo: MODEL_LOCK_CHAR_CAP,
  });
  return `${prompt.slice(0, MODEL_LOCK_CHAR_CAP)} [...]`;
}

// ── Model-Profile helpers ────────────────────────────────────────────────────
function getActiveModelAttributes(): ModelAttributes {
  try {
    const row = getDb().prepare(
      `SELECT attributes_json FROM model_profiles WHERE active = 1 LIMIT 1`,
    ).get() as { attributes_json: string } | undefined;
    if (!row) return DEFAULT_ATTRIBUTES;
    return { ...DEFAULT_ATTRIBUTES, ...JSON.parse(row.attributes_json) };
  } catch {
    return DEFAULT_ATTRIBUTES;
  }
}

function getActiveModelReferencePath(): string | undefined {
  try {
    const row = getDb().prepare(
      `SELECT reference_image_path FROM model_profiles WHERE active = 1 LIMIT 1`,
    ).get() as { reference_image_path: string | null } | undefined;
    return row?.reference_image_path ?? undefined;
  } catch {
    return undefined;
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────
async function listImages(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir).catch(() => []);
  return entries
    .filter((f) => /\.(jpe?g|png|webp|avif)$/i.test(f))
    .sort()
    .map((f) => path.join(dir, f));
}

export function startImageGenerator(): void {
  if (timer) return;
  log.info('Image generator started', { intervalMs: POLL_INTERVAL_MS });
  setTimeout(() => void tick(), 10_000);
  timer = setInterval(() => void tick(), POLL_INTERVAL_MS);
}

export function stopImageGenerator(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
    log.info('Image generator stopped');
  }
}
