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

const VINTED_ROOT = process.env.VINTED_ROOT ?? '/Users/home/Desktop/Vinted';
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
      'Block until the next Temu product appears in the Vinted queue (/Users/home/Desktop/Vinted/_queue/). Returns the full queue-item payload including source_flatlay, source_gallery, description, and attributes. Has a 60-second internal timeout — if no item appears, returns { pending: false } and the agent should simply call this tool again (poll loop). When an item is returned, immediately call mark_product_generating(folder_num) before starting work.',
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
      'Mark a product as fully generated. Moves _queue/{N}_input.json to _done/, updates DB status to "ready", and stores the list of generated image paths for the dashboard.',
    inputSchema: {
      type: 'object',
      properties: {
        folder_num: { type: 'number' },
        generated_image_paths: {
          type: 'array',
          items: { type: 'string' },
          description: 'Absolute paths to the generated model/lifestyle images.',
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
    name: 'queue_status',
    description:
      'Summary counters: how many items are queued, generating, ready, failed. Useful for end-of-run summaries.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
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
        // Move queue file to _done/
        const src = path.join(QUEUE_DIR, `${a.folder_num}_input.json`);
        const dst = path.join(DONE_DIR, `${a.folder_num}_input.json`);
        await fs.mkdir(DONE_DIR, { recursive: true });
        await fs.rename(src, dst).catch((err) => {
          log('warn', 'rename queue→done failed', { folder_num: a.folder_num, error: String(err) });
        });
        setStatus(a.folder_num, 'ready');
        log('info', 'status → ready', {
          folder_num: a.folder_num,
          images: a.generated_image_paths.length,
        });
        // Also stash the paths on the product row via description append (cheap)
        // so the dashboard can show them without a schema change.
        const gen = JSON.stringify(a.generated_image_paths);
        getDb()
          .prepare(
            `UPDATE crawled_products SET attributes_json = COALESCE(attributes_json, '{}')
             WHERE folder_num = ?`,
          )
          .run(a.folder_num);
        // Minimal write of generated_image_paths into a sidecar file
        const folderPath = getDb()
          .prepare(`SELECT folder_path FROM crawled_products WHERE folder_num = ?`)
          .get(a.folder_num) as { folder_path: string } | undefined;
        if (folderPath?.folder_path) {
          await fs.writeFile(
            path.join(folderPath.folder_path, 'generated_images.json'),
            gen,
          );
        }
        return {
          content: [{ type: 'text', text: JSON.stringify({ ok: true }) }],
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
