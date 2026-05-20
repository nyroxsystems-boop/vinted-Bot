// ──────────────────────────────────────────────────────────────────────────────
// LLM-Abstraction
//
// Single entry point `callLLM()` that dispatches to Anthropic or Gemini based
// on the `llm_provider` setting (DB-first, env-fallback). Both providers
// accept a system prompt + user prompt and return plain text.
//
// Why an abstraction?
//   - Anthropic: high quality, paid
//   - Gemini 2.5 Flash: free up to 15 RPM / 1500 req-day, fast, good enough
//     for the kind of structured text we generate (variants, sale-classification)
//
// Caller pattern:
//   const text = await callLLM({ system: '...', user: '...', maxTokens: 700 });
//   if (!text) handleFailure();
//
// ──────────────────────────────────────────────────────────────────────────────

import { createLogger } from './logger.js';
import { getSetting } from './db.js';
import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

const log = createLogger('llm');

export type LLMProvider = 'anthropic' | 'gemini' | 'claude_cli';

export interface CallLLMOpts {
  /** Optional system prompt (Anthropic native, Gemini emulated via prefix) */
  system?: string;
  /** User prompt */
  user: string;
  /** Max output tokens */
  maxTokens?: number;
  /** Override provider per-call (e.g. force Anthropic for a critical task) */
  provider?: LLMProvider;
  /** Override model (else default per provider) */
  model?: string;
  /** Request timeout ms */
  timeoutMs?: number;
}

function getProvider(opts: CallLLMOpts): LLMProvider {
  if (opts.provider) return opts.provider;
  const s = getSetting('llm_provider') ?? process.env.LLM_PROVIDER ?? 'claude_cli';
  if (s === 'anthropic') return 'anthropic';
  if (s === 'gemini') return 'gemini';
  return 'claude_cli';  // default for the locally-hosted hustler setup
}

function getModel(provider: LLMProvider, opts: CallLLMOpts): string {
  if (opts.model) return opts.model;
  if (provider === 'gemini') {
    return getSetting('llm_model_gemini')
      ?? process.env.GEMINI_MODEL
      ?? 'gemini-2.5-flash';
  }
  return getSetting('llm_model_anthropic')
    ?? process.env.ANTHROPIC_MODEL
    ?? 'claude-sonnet-4-6';
}

/** Returns the raw text response or null on failure. Logs reason on null. */
export async function callLLM(opts: CallLLMOpts): Promise<string | null> {
  const provider = getProvider(opts);
  const model = getModel(provider, opts);
  const maxTokens = opts.maxTokens ?? 700;
  const timeoutMs = opts.timeoutMs ?? 45_000;

  if (provider === 'anthropic')  return callAnthropic(model, opts, maxTokens, timeoutMs);
  if (provider === 'claude_cli') return callClaudeCli(opts, timeoutMs);
  return callGemini(model, opts, maxTokens, timeoutMs);
}

/**
 * Spawn the Claude Code CLI (`claude -p`) as a subprocess. Uses the user's
 * existing local subscription — no API key, no usage cost on top of the
 * subscription. Ideal for fully local workflows.
 *
 * Latency: 3-15s per call (CLI startup + model latency). Slower than
 * API calls but free for the subscriber.
 *
 * Requirements: `claude` binary on PATH (Claude Code CLI installed).
 */
async function callClaudeCli(opts: CallLLMOpts, timeoutMs: number): Promise<string | null> {
  // Kill-switch: the operator can disable the Claude-CLI fallback entirely
  // (e.g. to force the cheaper/faster Gemini path on a customer machine
  // where `claude` may be installed but not authorised for billing).
  if (process.env.LLM_DISABLE_CLAUDE_CLI === 'true') {
    throw new Error('claude-cli disabled via LLM_DISABLE_CLAUDE_CLI=true');
  }
  return new Promise((resolve) => {
    // Resolve binary: env override → common install locations → PATH fallback
    const candidates = [
      process.env.CLAUDE_CLI_PATH ?? '',
      path.join(process.env.HOME ?? '', '.npm-global/bin/claude'),
      '/usr/local/bin/claude',
      '/opt/homebrew/bin/claude',
      'claude',
    ].filter(Boolean);
    const binary = candidates.find(p => p === 'claude' || fs.existsSync(p)) ?? 'claude';

    // Prepend an anti-preamble nudge so the CLI doesn't burn tokens on
    // "thinking..." prose before the JSON. The Claude Code CLI doesn't
    // expose a --thinking-budget flag, so we steer via the prompt itself.
    const userPrompt = `Respond with raw JSON only, no preamble, no thinking.\n\n${opts.user}`;
    // `--max-turns 1` (supported by claude-code CLI) prevents the agent
    // from spawning tool calls / multi-turn reasoning, which both costs
    // tokens and slows down the response.
    //
    // Auth mode toggle:
    //   * Default (no flag): CLI reads OAuth/Keychain — works when the user
    //     ran `claude /login` once interactively (uses Claude-Plan, no
    //     per-token cost).
    //   * `--bare` (LLM_CLAUDE_BARE=true): CLI ignores OAuth and uses
    //     ANTHROPIC_API_KEY strictly. Needed in headless setups but
    //     bills against the API account (which must have credits).
    const args: string[] = [];
    if (process.env.LLM_CLAUDE_BARE === 'true') args.push('--bare');
    args.push('-p', userPrompt, '--max-turns', '1');
    if (opts.system) args.push('--append-system-prompt', opts.system);
    if (opts.model && /sonnet|opus|haiku/i.test(opts.model)) args.push('--model', opts.model.toLowerCase());

    // Forward env explicitly so ANTHROPIC_API_KEY survives pm2's env scrub.
    const childEnv = { ...process.env };
    let stdout = '';
    let stderr = '';
    let resolved = false;
    const done = (text: string | null, reason?: string) => {
      if (resolved) return;
      resolved = true;
      if (reason) log.warn('Claude CLI', { reason, binary, stderr: stderr.slice(0, 200) });
      resolve(text);
    };
    let child;
    try {
      child = spawn(binary, args, { stdio: ['ignore', 'pipe', 'pipe'], env: childEnv });
    } catch (err) {
      done(null, `spawn failed: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }
    const killer = setTimeout(() => {
      child.kill('SIGTERM');
      done(null, `timeout after ${timeoutMs}ms`);
    }, timeoutMs);
    child.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
    child.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
    child.on('error', (err) => {
      clearTimeout(killer);
      done(null, `process error: ${err.message}`);
    });
    child.on('close', (code) => {
      clearTimeout(killer);
      if (code === 0 && stdout.trim()) {
        done(stdout.trim());
      } else {
        done(null, `exit code ${code}, stdout=${stdout.length}b stderr=${stderr.length}b`);
      }
    });
  });
}

async function callAnthropic(model: string, opts: CallLLMOpts, maxTokens: number, timeoutMs: number): Promise<string | null> {
  const key = process.env.ANTHROPIC_API_KEY ?? '';
  if (!key) { log.warn('Anthropic API key missing'); return null; }
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        ...(opts.system ? { system: opts.system } : {}),
        messages: [{ role: 'user', content: opts.user }],
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!r.ok) {
      const body = await r.text();
      log.warn('Anthropic non-2xx', { status: r.status, body: body.slice(0, 200) });
      return null;
    }
    const data = await r.json() as { content?: Array<{ type: string; text?: string }> };
    return data.content?.find(c => c.type === 'text')?.text?.trim() ?? null;
  } catch (err) {
    log.warn('Anthropic call failed', { error: err instanceof Error ? err.message : String(err) });
    return null;
  }
}

async function callGemini(model: string, opts: CallLLMOpts, maxTokens: number, timeoutMs: number): Promise<string | null> {
  const key = process.env.GEMINI_API_KEY ?? '';
  if (!key) { log.warn('Gemini API key missing'); return null; }
  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${key}`;
    // Gemini takes systemInstruction separately from contents.
    const body: Record<string, unknown> = {
      contents: [{ role: 'user', parts: [{ text: opts.user }] }],
      generationConfig: {
        maxOutputTokens: maxTokens,
        temperature: 0.7,
        // Gemini 2.5 spends tokens on internal "thinking" before answering,
        // which can consume the whole maxOutputTokens budget and leave 1
        // token for the answer. We disable it for structured-output tasks.
        thinkingConfig: { thinkingBudget: 0 },
      },
    };
    if (opts.system) {
      body.systemInstruction = { parts: [{ text: opts.system }] };
    }
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!r.ok) {
      const text = await r.text();
      log.warn('Gemini non-2xx', { status: r.status, body: text.slice(0, 200) });
      return null;
    }
    const data = await r.json() as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const text = data.candidates?.[0]?.content?.parts?.map(p => p.text ?? '').join('').trim();
    return text || null;
  } catch (err) {
    log.warn('Gemini call failed', { error: err instanceof Error ? err.message : String(err) });
    return null;
  }
}

/** Convenience: parse the raw text as JSON (strips ```json fences if present). */
export function parseLLMJson<T = unknown>(text: string | null): T | null {
  if (!text) return null;
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
  try { return JSON.parse(cleaned) as T; } catch { return null; }
}
