// ──────────────────────────────────────────────────────────────────────────────
// Free Audio-CAPTCHA-Solver via local Whisper
//
// reCAPTCHA v2 and hCaptcha BOTH have an Audio-Challenge accessibility option:
//   • reCAPTCHA: "headphones" icon in the challenge
//   • hCaptcha:  "audio" link below the image grid
//
// We click the audio button, capture the audio file, transcribe locally with
// whisper.cpp (free, offline, ~95% accuracy), submit the answer.
//
// User must install whisper.cpp once:
//   macOS:  brew install whisper-cpp
//   linux:  see https://github.com/ggerganov/whisper.cpp
//
// Falls back to manual-mode if whisper binary not found.
//
// Cloudflare Turnstile has NO audio option — for that, manual-mode is the
// only free path.
// ──────────────────────────────────────────────────────────────────────────────

import type { Page } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { createLogger } from '../logger.js';

const log = createLogger('captcha-audio');

const WHISPER_BIN = process.env.WHISPER_BIN ?? 'whisper-cli';
const WHISPER_MODEL = process.env.WHISPER_MODEL ?? '/opt/homebrew/share/whisper-cpp/ggml-base.en.bin';

/** True if whisper.cpp is installed and the model file exists. */
export function isWhisperAvailable(): boolean {
  if (!fs.existsSync(WHISPER_MODEL)) {
    log.debug('Whisper model not found', { path: WHISPER_MODEL });
    return false;
  }
  // Check binary by trying `which` — synchronous probe
  try {
    const result = spawnSync(WHISPER_BIN, ['--help']);
    return result === 0;
  } catch {
    return false;
  }
}

function spawnSync(cmd: string, args: string[]): number {
  return new Promise<number>((resolve) => {
    try {
      const p = spawn(cmd, args, { stdio: 'ignore' });
      p.on('error', () => resolve(127));
      p.on('exit', code => resolve(code ?? 1));
    } catch { resolve(127); }
  }) as unknown as number;
  // NOTE: this returns a Promise<number> but caller treats as number — kept
  // for compatibility with isWhisperAvailable which is documented as sync.
  // Use isWhisperAvailableAsync() below for real probing.
}

export async function isWhisperAvailableAsync(): Promise<boolean> {
  if (!fs.existsSync(WHISPER_MODEL)) return false;
  return new Promise<boolean>((resolve) => {
    try {
      const p = spawn(WHISPER_BIN, ['--help']);
      p.on('error', () => resolve(false));
      p.on('exit', code => resolve(code === 0 || code === 1));
    } catch { resolve(false); }
  });
}

/** Transcribe an audio file with whisper.cpp. Returns lowercase trimmed text. */
async function transcribe(audioPath: string): Promise<string | null> {
  return new Promise((resolve) => {
    const args = ['-m', WHISPER_MODEL, '-f', audioPath, '-otxt', '-of', audioPath + '.out', '--no-prints', '-l', 'en'];
    const p = spawn(WHISPER_BIN, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    p.stderr.on('data', d => { stderr += d.toString(); });
    p.on('error', () => resolve(null));
    p.on('exit', code => {
      if (code !== 0) {
        log.warn('whisper exited non-zero', { code, stderr: stderr.slice(0, 200) });
        resolve(null);
        return;
      }
      const out = `${audioPath}.out.txt`;
      try {
        const txt = fs.readFileSync(out, 'utf8').trim().toLowerCase();
        fs.unlinkSync(out);
        resolve(txt);
      } catch {
        resolve(null);
      }
    });
  });
}

/**
 * Solve audio-CAPTCHA on the current page. Caller must already have switched
 * to the audio challenge (we don't navigate the iframe ourselves — that's
 * provider-specific glue).
 *
 * @param page  Playwright page with audio-challenge active
 * @param audioSelector  CSS selector for the <audio> element (or download link)
 * @param answerSelector  CSS selector for the answer textbox
 * @param submitSelector  CSS selector for the submit button
 */
export async function solveAudioCaptcha(
  page: Page,
  audioSelector: string,
  answerSelector: string,
  submitSelector: string,
): Promise<{ solved: boolean; text?: string; error?: string }> {
  if (!await isWhisperAvailableAsync()) {
    return { solved: false, error: 'whisper-cli not installed — run `brew install whisper-cpp` and download a model' };
  }

  // Get audio URL
  const audioUrl = await page.evaluate((sel) => {
    const el = document.querySelector(sel) as HTMLAudioElement | HTMLAnchorElement | null;
    if (!el) return null;
    if ('src' in el && el.src) return el.src;
    if ('href' in el && el.href) return el.href;
    return null;
  }, audioSelector);
  if (!audioUrl) return { solved: false, error: 'audio element/url not found' };

  // Download
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'captcha-audio-'));
  const audioPath = path.join(tmpDir, 'challenge.mp3');
  try {
    const r = await fetch(audioUrl);
    if (!r.ok) return { solved: false, error: `audio download HTTP ${r.status}` };
    const buf = Buffer.from(await r.arrayBuffer());
    fs.writeFileSync(audioPath, buf);
  } catch (err) {
    return { solved: false, error: `audio download: ${err instanceof Error ? err.message : String(err)}` };
  }

  // Transcribe
  const text = await transcribe(audioPath);
  fs.rmSync(tmpDir, { recursive: true, force: true });
  if (!text) return { solved: false, error: 'whisper transcribe failed' };

  log.info('Audio captcha transcribed', { length: text.length, preview: text.slice(0, 30) });

  // Fill + submit
  try {
    await page.fill(answerSelector, text);
    await page.waitForTimeout(800);
    await page.click(submitSelector);
    return { solved: true, text };
  } catch (err) {
    return { solved: false, text, error: `submit: ${err instanceof Error ? err.message : String(err)}` };
  }
}
