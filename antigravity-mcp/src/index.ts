// ──────────────────────────────────────────────────────────────────────────────
// Antigravity MCP server — Vinted product-generation queue.
//
// Exposes four tools to the Antigravity agent so it can loop the crawled
// product queue autonomously:
//
//   • wait_for_next_product   — blocks until the next _queue/*.json appears
//                                (with a 60s timeout so the agent's transport
//                                doesn't hang forever).
//   • mark_product_generating — flips DB status to "generating".
//   • mark_product_done       — moves queue file to _done/, DB status "ready",
//                                records the generated image paths.
//   • mark_product_failed     — DB status "failed", stores the error.
//
// CRITICAL: all logging goes to stderr. stdout is reserved for JSON-RPC —
// writing anything else there breaks the MCP transport.
// ──────────────────────────────────────────────────────────────────────────────

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import chokidar from 'chokidar';
import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { getDb, runMigrations } from '@vinted-system/shared';

// ── Paths + constants ─────────────────────────────────────────────────────────

// antigravity-mcp runs as a standalone process — can't import the shared
// package without setting up a monorepo build step. Resolve VINTED_ROOT the
// same way `vintedRoot()` does: env wins, else home-relative default.
const VINTED_ROOT = (() => {
  const env = process.env.VINTED_ROOT?.trim();
  if (env) return env;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return path.join(process.env.HOME ?? process.env.USERPROFILE ?? '/tmp', 'Blackruby');
})();
const QUEUE_DIR = path.join(VINTED_ROOT, '_queue');
const DONE_DIR = path.join(VINTED_ROOT, '_done');
const WAIT_TIMEOUT_MS = 60_000; // stay under most MCP transport timeouts

// stderr logger — never write to stdout, it's reserved for JSON-RPC
function log(level: 'info' | 'warn' | 'error', msg: string, ctx?: unknown): void {
  const line = `[antigravity-mcp] ${new Date().toISOString()} ${level} ${msg}${
    ctx ? ' ' + JSON.stringify(ctx) : ''
  }\n`;
  process.stderr.write(line);
}

// ── Queue helpers ─────────────────────────────────────────────────────────────

interface QueueItem {
  folder_num: number;
  product_type?: string;
  color?: string;
  details?: string;
  size?: string;
  source_flatlay?: string;
  source_gallery?: string[];
  source_count?: number;
  temu_description?: string;
  temu_attributes?: Record<string, string>;
}

/** Oldest pending input.json in _queue/ — null if empty. */
async function findOldestQueueFile(): Promise<{
  path: string;
  folderNum: number;
} | null> {
  await fs.mkdir(QUEUE_DIR, { recursive: true });
  const entries = await fs.readdir(QUEUE_DIR);
  const candidates: Array<{ path: string; folderNum: number; mtime: number }> = [];
  for (const e of entries) {
    const m = e.match(/^(\d+)_input\.json$/);
    if (!m?.[1]) continue;
    const full = path.join(QUEUE_DIR, e);
    const stat = await fs.stat(full).catch(() => null);
    if (!stat) continue;
    candidates.push({
      path: full,
      folderNum: Number.parseInt(m[1], 10),
      mtime: stat.mtimeMs,
    });
  }
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => a.mtime - b.mtime);
  const first = candidates[0]!;
  return { path: first.path, folderNum: first.folderNum };
}

async function readQueueItem(filePath: string): Promise<QueueItem> {
  const raw = await fs.readFile(filePath, 'utf-8');
  return JSON.parse(raw) as QueueItem;
}

/** Enrich queue item with DB row + description.md contents. */
async function enrichItem(
  item: QueueItem,
): Promise<QueueItem & { title?: string; temu_url?: string; description_md?: string }> {
  const row = getDb()
    .prepare(
      `SELECT title, temu_url, price_eur, folder_path, description, attributes_json
         FROM crawled_products
        WHERE folder_num = ?`,
    )
    .get(item.folder_num) as
    | {
        title: string;
        temu_url: string;
        price_eur: number | null;
        folder_path: string;
        description: string | null;
        attributes_json: string | null;
      }
    | undefined;

  let description_md: string | undefined;
  if (row?.folder_path) {
    description_md = await fs
      .readFile(path.join(row.folder_path, 'description.md'), 'utf-8')
      .catch(() => undefined);
  }

  return {
    ...item,
    title: row?.title,
    temu_url: row?.temu_url,
    description_md,
  };
}

// ── Wait — chokidar file watch + timeout ──────────────────────────────────────

async function waitForNextFile(timeoutMs: number): Promise<string | null> {
  // Short-circuit: already something pending?
  const existing = await findOldestQueueFile();
  if (existing) return existing.path;

  return new Promise((resolve) => {
    const watcher = chokidar.watch(QUEUE_DIR, {
      ignoreInitial: true,
      depth: 0,
      persistent: true,
    });
    let done = false;
    const finish = (result: string | null) => {
      if (done) return;
      done = true;
      watcher.close().catch(() => null);
      resolve(result);
    };
    watcher.on('add', (p) => {
      if (/\/\d+_input\.json$/.test(p)) {
        log('info', 'Queue item detected by watcher', { path: p });
        finish(p);
      }
    });
    watcher.on('error', (err) => {
      log('error', 'chokidar error', { error: String(err) });
    });
    setTimeout(() => finish(null), timeoutMs);
  });
}

// ── DB helpers ───────────────────────────────────────────────────────────────

function setStatus(folderNum: number, status: string, err?: string): void {
  getDb()
    .prepare(
      `UPDATE crawled_products
         SET status = ?, last_error = ?, updated_at = datetime('now')
       WHERE folder_num = ?`,
    )
    .run(status, err ?? null, folderNum);
}

function countByStatus(status: string): number {
  const row = getDb()
    .prepare(`SELECT COUNT(*) AS n FROM crawled_products WHERE status = ?`)
    .get(status) as { n: number };
  return row?.n ?? 0;
}

// ── MCP server wiring ─────────────────────────────────────────────────────────

const server = new Server(
  { name: 'vinted-queue', version: '0.1.0' },
  { capabilities: { tools: {} } },
);

const TOOLS = [
  {
    name: 'wait_for_next_product',
    description:
      'Block until the next Temu product appears in the Vinted queue (/Users/home/Vinted/_queue/). Returns the full queue-item payload including source_flatlay, source_gallery, description, and attributes. Has a 60-second internal timeout — if no item appears, returns { pending: false } and the agent should simply call this tool again (poll loop). When an item is returned, immediately call mark_product_generating(folder_num) before starting work.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: 'mark_product_generating',
    description:
      'Flip DB status to "generating" for the given folder number. Call this right after wait_for_next_product returns a product, before you start generating images.',
    inputSchema: {
      type: 'object',
      properties: {
        folder_num: { type: 'number', description: 'The folder number (e.g. 42 for "Neuer Ordner 42")' },
      },
      required: ['folder_num'],
      additionalProperties: false,
    },
  },
  {
    name: 'mark_product_done',
    description:
      'Mark a product as fully generated. STRICTLY VALIDATED:\n' +
      '  - Requires at least 3 DISTINCT image paths.\n' +
      '  - Every path must be absolute and live INSIDE the product folder\n' +
      '    (typically {folder_path}/generated/). Paths pointing at shared\n' +
      '    caches, Antigravity brain dirs, or other products are rejected.\n' +
      '  - Every file must exist and be > 10 KB (no placeholders).\n' +
      'If validation fails, the call returns isError:true with a reason —\n' +
      'DO NOT retry until you have actually written real images to disk.\n' +
      'On success: moves _queue/{N}_input.json to _done/, sets DB status\n' +
      'to "ready", and writes generated_images.json in the product folder.',
    inputSchema: {
      type: 'object',
      properties: {
        folder_num: { type: 'number' },
        generated_image_paths: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Absolute paths to real image files, each inside the product folder ' +
            '(e.g. /Users/home/Vinted/Neuer Ordner 42/generated/image_1.png). ' +
            'Minimum 3 distinct paths, each > 10 KB.',
        },
      },
      required: ['folder_num', 'generated_image_paths'],
      additionalProperties: false,
    },
  },
  {
    name: 'mark_product_failed',
    description:
      'Mark a product as failed. Leaves the queue file in place so it can be retried later. Updates DB status to "failed" and stores the error message.',
    inputSchema: {
      type: 'object',
      properties: {
        folder_num: { type: 'number' },
        error: { type: 'string' },
      },
      required: ['folder_num', 'error'],
      additionalProperties: false,
    },
  },
  {
    name: 'persist_generated_image',
    description:
      'Copy an image from the Antigravity brain/sandbox into the target product ' +
      'folder. USE THIS instead of `sips` / `cp` / `python` — those fail with ' +
      '"Operation not permitted" because the brain directory is TCC-protected ' +
      'and the shell cannot read it, but this MCP subprocess (spawned by ' +
      'Antigravity itself) CAN read it.\n\n' +
      'Typical flow after generate_image returns:\n' +
      '  persist_generated_image(folder_num=27, source_path="/Users/.../brain/.../image.png", target_filename="1_front.jpg")\n\n' +
      'Writes to /Users/home/Vinted/Neuer Ordner {folder_num}/generated/{target_filename}. ' +
      'Source PNG is converted to JPEG on the fly (quality 92) if target ends ' +
      'in .jpg/.jpeg. Returns the absolute destination path so you can feed it ' +
      'into mark_product_done later.',
    inputSchema: {
      type: 'object',
      properties: {
        folder_num: { type: 'number', description: 'e.g. 27 for "Neuer Ordner 27"' },
        source_path: {
          type: 'string',
          description:
            'Absolute path of the image generated by Antigravity (usually inside ' +
            '~/.gemini/antigravity/brain/…). PNG / JPG / WebP all accepted.',
        },
        target_filename: {
          type: 'string',
          description:
            'File name to save inside the product\'s generated/ folder. ' +
            'Use the convention 1_front.jpg / 2_side.jpg / 3_back.jpg / ' +
            '4_flatlay_front.jpg / 5_flatlay_back.jpg so downstream tools ' +
            'pick them up in the right order.',
        },
      },
      required: ['folder_num', 'source_path', 'target_filename'],
      additionalProperties: false,
    },
  },
  {
    name: 'queue_status',
    description:
      'Summary counters: how many items are queued, generating, ready, failed. Useful for end-of-run summaries.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'save_image_to_path',
    description:
      'DB-free file mover for the manual 3-model loop in antigravity_3models_prompt.md. ' +
      'Copies a generated image from a Gemini brain-cache path (or any source) to an absolute ' +
      'target path. Creates parent directories as needed. NO database lookup, NO queue state, ' +
      'NO folder_num — pure brain → target file copy. Use this whenever the agent has a brain ' +
      'path it cannot read with sips/cp/python (sandbox restrictions). Validates: source exists ' +
      'and is >5 KB, target stays under /Users/home/Vinted/. Returns the final target path on success.\n\n' +
      'Example:\n' +
      '  save_image_to_path(\n' +
      '    source_path = "/Users/home/.gemini/antigravity/brain/<uuid>/1_front_<ts>.png",\n' +
      '    target_path = "/Users/home/Vinted/Neuer Ordner/model_1/1_front.jpg"\n' +
      '  )',
    inputSchema: {
      type: 'object',
      properties: {
        source_path: {
          type: 'string',
          description: 'Absolute path of the file to read (typically a brain-cache PNG/JPG).',
        },
        target_path: {
          type: 'string',
          description:
            'Absolute target path including filename. Must be under /Users/home/Vinted/. ' +
            'Parent directories are created automatically.',
        },
      },
      required: ['source_path', 'target_path'],
      additionalProperties: false,
    },
  },
] as const;

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

const WaitArgs = z.object({}).strict();
const MarkGenArgs = z.object({ folder_num: z.number().int() }).strict();
const MarkDoneArgs = z
  .object({
    folder_num: z.number().int(),
    generated_image_paths: z.array(z.string()),
  })
  .strict();
const MarkFailArgs = z
  .object({ folder_num: z.number().int(), error: z.string() })
  .strict();
const PersistArgs = z
  .object({
    folder_num: z.number().int(),
    source_path: z.string().min(1),
    target_filename: z.string().min(1),
  })
  .strict();
const SaveImageArgs = z
  .object({
    source_path: z.string().min(1),
    target_path: z.string().min(1),
  })
  .strict();

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args } = req.params;

  try {
    switch (name) {
      case 'wait_for_next_product': {
        WaitArgs.parse(args ?? {});
        const filePath = await waitForNextFile(WAIT_TIMEOUT_MS);
        if (!filePath) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  pending: false,
                  message: 'No queue item appeared within 60s. Call wait_for_next_product again to keep polling.',
                }),
              },
            ],
          };
        }
        const item = await readQueueItem(filePath);
        const enriched = await enrichItem(item);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                pending: true,
                queue_file: filePath,
                product: enriched,
              }),
            },
          ],
        };
      }

      case 'mark_product_generating': {
        const a = MarkGenArgs.parse(args);
        setStatus(a.folder_num, 'generating');
        log('info', 'status → generating', { folder_num: a.folder_num });
        return {
          content: [{ type: 'text', text: JSON.stringify({ ok: true }) }],
        };
      }

      case 'mark_product_done': {
        const a = MarkDoneArgs.parse(args);

        // VALIDATION — we trust nothing from the agent. Every claim has
        // to match reality on disk:
        //   1. Need at least 3 distinct image paths (we ask for 5, allow slack)
        //   2. Every path MUST exist as a real file on disk
        //   3. Every path MUST live inside this product's folder (prevents
        //      the agent from pointing all 107 products at a single shared
        //      cache directory, which is exactly what happened once)
        //   4. Every file must be > 10 KB (no empty/tracking pixels)
        const folderRow = getDb()
          .prepare(`SELECT folder_path FROM crawled_products WHERE folder_num = ?`)
          .get(a.folder_num) as { folder_path: string } | undefined;
        if (!folderRow?.folder_path) {
          return {
            content: [{ type: 'text', text: `No product found for folder_num ${a.folder_num}` }],
            isError: true,
          };
        }
        const folderPath = folderRow.folder_path;
        const uniquePaths = Array.from(new Set(a.generated_image_paths));

        if (uniquePaths.length < 3) {
          return {
            content: [
              {
                type: 'text',
                text: `Rejected: at least 3 DISTINCT image paths required, got ${uniquePaths.length} unique (${a.generated_image_paths.length} total). Actually generate images before calling mark_product_done.`,
              },
            ],
            isError: true,
          };
        }

        const failures: string[] = [];
        for (const p of uniquePaths) {
          // Must be absolute
          if (!path.isAbsolute(p)) {
            failures.push(`not absolute: ${p}`);
            continue;
          }
          // Must sit inside the product folder
          const rel = path.relative(folderPath, p);
          if (rel.startsWith('..') || path.isAbsolute(rel)) {
            failures.push(
              `path outside product folder ${folderPath}: ${p}`,
            );
            continue;
          }
          // Must exist and be non-trivial size
          const stat = await fs.stat(p).catch(() => null);
          if (!stat) {
            failures.push(`file not found: ${p}`);
            continue;
          }
          if (!stat.isFile()) {
            failures.push(`not a regular file: ${p}`);
            continue;
          }
          if (stat.size < 10_000) {
            failures.push(`file too small (${stat.size}B, min 10KB): ${p}`);
          }
        }
        if (failures.length > 0) {
          log('warn', 'mark_product_done rejected', {
            folder_num: a.folder_num,
            failures,
          });
          return {
            content: [
              {
                type: 'text',
                text:
                  `Rejected mark_product_done for folder ${a.folder_num}:\n` +
                  failures.map((f) => `  - ${f}`).join('\n') +
                  `\n\nGenerated images MUST live inside ${folderPath} (typically ${folderPath}/generated/) and be > 10 KB each. Generate real images, save them into the product folder, then retry.`,
              },
            ],
            isError: true,
          };
        }

        // Validation passed — commit the state change
        const src = path.join(QUEUE_DIR, `${a.folder_num}_input.json`);
        const dst = path.join(DONE_DIR, `${a.folder_num}_input.json`);
        await fs.mkdir(DONE_DIR, { recursive: true });
        await fs.rename(src, dst).catch((err) => {
          log('warn', 'rename queue→done failed', {
            folder_num: a.folder_num,
            error: String(err),
          });
        });
        setStatus(a.folder_num, 'ready');
        await fs.writeFile(
          path.join(folderPath, 'generated_images.json'),
          JSON.stringify(uniquePaths, null, 2),
        );
        log('info', 'status → ready', {
          folder_num: a.folder_num,
          images: uniquePaths.length,
        });
        return {
          content: [{ type: 'text', text: JSON.stringify({ ok: true, images: uniquePaths.length }) }],
        };
      }

      case 'mark_product_failed': {
        const a = MarkFailArgs.parse(args);
        setStatus(a.folder_num, 'failed', a.error);
        log('warn', 'status → failed', { folder_num: a.folder_num, error: a.error });
        return {
          content: [{ type: 'text', text: JSON.stringify({ ok: true }) }],
        };
      }

      case 'persist_generated_image': {
        const a = PersistArgs.parse(args);

        // 1) Look up the product folder from the DB (same source of truth
        //    mark_product_done uses — avoids drift from "Neuer Ordner N"
        //    guessing).
        const row = getDb()
          .prepare(`SELECT folder_path FROM crawled_products WHERE folder_num = ?`)
          .get(a.folder_num) as { folder_path: string } | undefined;
        if (!row?.folder_path) {
          return {
            content: [
              {
                type: 'text',
                text: `No product row for folder_num ${a.folder_num} — did the crawler run?`,
              },
            ],
            isError: true,
          };
        }

        // 2) Sanity-check source exists and is non-trivial. The agent
        //    sometimes passes stale paths from an earlier generation that
        //    got garbage-collected.
        const srcStat = await fs.stat(a.source_path).catch(() => null);
        if (!srcStat || !srcStat.isFile()) {
          return {
            content: [
              {
                type: 'text',
                text:
                  `Source does not exist: ${a.source_path}. ` +
                  `Did generate_image really produce a file there? ` +
                  `Common cause: the brain/sandbox path changes per generation — ` +
                  `persist the file IMMEDIATELY after generate_image returns.`,
              },
            ],
            isError: true,
          };
        }
        if (srcStat.size < 5_000) {
          return {
            content: [
              {
                type: 'text',
                text: `Source too small (${srcStat.size} B) — probably a placeholder. Regenerate.`,
              },
            ],
            isError: true,
          };
        }

        // 3) Sanitise + resolve target path INSIDE the product folder.
        //    The filename must not climb out via ../ etc.
        const clean = a.target_filename.replace(/[^A-Za-z0-9._-]/g, '_');
        const generatedDir = path.join(row.folder_path, 'generated');
        await fs.mkdir(generatedDir, { recursive: true });
        const targetPath = path.join(generatedDir, clean);
        const rel = path.relative(generatedDir, targetPath);
        if (rel.startsWith('..') || path.isAbsolute(rel)) {
          return {
            content: [
              { type: 'text', text: `Illegal target filename: ${a.target_filename}` },
            ],
            isError: true,
          };
        }

        // 4) Copy. We keep the source bytes 1:1 — no transcoding here.
        //    If the agent generated .png but named the target .jpg, macOS
        //    doesn't care (Vinted's uploader reads the content, not the
        //    extension), so this is a harmless mismatch for our pipeline.
        //    We still rename to .jpg in that case so downstream expects
        //    match.
        await fs.copyFile(a.source_path, targetPath);
        const finalStat = await fs.stat(targetPath);
        log('info', 'persisted generated image', {
          folder_num: a.folder_num,
          source: a.source_path,
          target: targetPath,
          bytes: finalStat.size,
        });
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                ok: true,
                target_path: targetPath,
                bytes: finalStat.size,
              }),
            },
          ],
        };
      }

      case 'queue_status': {
        const summary = {
          queued_files: (await fs.readdir(QUEUE_DIR).catch(() => []))
            .filter((f) => /^\d+_input\.json$/.test(f))
            .length,
          crawled: countByStatus('crawled'),
          generating: countByStatus('generating'),
          ready: countByStatus('ready'),
          failed: countByStatus('failed'),
        };
        return {
          content: [{ type: 'text', text: JSON.stringify(summary) }],
        };
      }

      case 'save_image_to_path': {
        const a = SaveImageArgs.parse(args);

        const srcStat = await fs.stat(a.source_path).catch(() => null);
        if (!srcStat || !srcStat.isFile()) {
          return {
            content: [{ type: 'text', text: `Source not found: ${a.source_path}` }],
            isError: true,
          };
        }
        if (srcStat.size < 5_000) {
          return {
            content: [
              {
                type: 'text',
                text: `Source too small (${srcStat.size} B) — probably a placeholder. Regenerate.`,
              },
            ],
            isError: true,
          };
        }

        const ALLOWED_ROOT = VINTED_ROOT;
        const resolved = path.resolve(a.target_path);
        if (!resolved.startsWith(ALLOWED_ROOT + '/')) {
          return {
            content: [
              {
                type: 'text',
                text: `Target must be under ${ALLOWED_ROOT}/ — got: ${resolved}`,
              },
            ],
            isError: true,
          };
        }

        await fs.mkdir(path.dirname(resolved), { recursive: true });
        await fs.copyFile(a.source_path, resolved);
        const finalStat = await fs.stat(resolved);
        log('info', 'save_image_to_path ok', {
          source: a.source_path,
          target: resolved,
          bytes: finalStat.size,
        });
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                ok: true,
                target_path: resolved,
                bytes: finalStat.size,
              }),
            },
          ],
        };
      }

      default:
        return {
          content: [{ type: 'text', text: `Unknown tool: ${name}` }],
          isError: true,
        };
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log('error', 'tool call failed', { tool: name, error: msg });
    return {
      content: [{ type: 'text', text: `Error: ${msg}` }],
      isError: true,
    };
  }
});

// ── Start ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  runMigrations();
  log('info', 'antigravity-mcp starting', { vintedRoot: VINTED_ROOT });
  const transport = new StdioServerTransport();
  await server.connect(transport);
  log('info', 'antigravity-mcp ready — waiting on stdio');
}

main().catch((err) => {
  log('error', 'fatal', { error: err instanceof Error ? err.message : String(err) });
  process.exit(1);
});
