#!/usr/bin/env node
// Validate-Library — checkt alle Library-Kandidaten auf anatomische Issues.
//
// Pro Bild: Gemini Vision-Check auf:
//  - 3 Arme / extra Hände
//  - 6 Finger / fehlende Finger / verformte Hände
//  - Verschmolzene Gliedmaßen
//  - Verformtes Gesicht
//  - Persona-Drift (Gesicht/Body sieht nicht aus wie Reference)
//  - Bedroom-Drift (Möbel/Boden weicht ab)
//  - Phone-Anomalien (verschmolzen mit Gesicht etc.)
//
// Output: validation.json mit allen Ergebnissen + verschiebt FAIL nach _rejects/
//
// Usage:
//   node nano-validate-library.mjs              # alle in _candidates/
//   node nano-validate-library.mjs --auto-move  # FAIL automatisch nach _rejects/

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENV_PATH = path.join(__dirname, '..', '.env');
const ANCHOR_DIR = '/Users/home/Vinted/_anchors';
const CANDIDATES_DIR = path.join(ANCHOR_DIR, 'library', '_candidates');
const REJECTS_DIR = path.join(ANCHOR_DIR, 'library', '_rejects');
const REPORT_PATH = path.join(ANCHOR_DIR, 'library', 'validation.json');

async function loadEnv() {
  const raw = await fs.readFile(ENV_PATH, 'utf8');
  for (const line of raw.split('\n')) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

async function fetchWithRetry(url, opts = {}, retries = 4) {
  let lastErr;
  for (let i = 0; i < retries; i++) {
    try { return await fetch(url, opts); }
    catch (err) {
      lastErr = err;
      await new Promise(r => setTimeout(r, 3000 * (i + 1)));
    }
  }
  throw lastErr;
}

async function validateImage(imagePath, geminiKey) {
  const buf = await fs.readFile(imagePath);
  const mime = imagePath.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg';

  const checklist = `You are a strict QA reviewer for AI-generated mirror selfie photos.

Examine this image VERY CAREFULLY for anatomical and rendering errors.
Count carefully — AI often fails at hand/finger anatomy.

CHECK EACH:

A. ANATOMY:
1. Total visible arms = exactly 2 (NOT 3, NOT extra/floating arms anywhere in the image, NOT duplicated)
2. Each visible hand has exactly 5 fingers (NOT 4, NOT 6, NOT 7, NOT fused/melted fingers)
3. No extra/floating body parts anywhere (no extra leg, no extra foot, no extra hand in background)
4. Limbs are proportional and natural (NOT stretched, NOT shrunken, NOT distorted)
5. Face is properly formed (NOT melted, NOT split, NOT asymmetric beyond normal, NOT missing features)
6. No fused or merged body parts (no hand fused into body, no arm fused to phone unnaturally)

B. PHONE & HAND:
7. The phone she holds is a single clear iPhone (NOT 2 phones, NOT phone-blob, NOT distorted)
8. The hand holding the phone has 5 normal fingers wrapped around it (NOT extra fingers visible)
9. Phone size is reasonable (small palm-sized, NOT tablet/oversized)

C. CONSISTENCY:
10. The persona looks like a real young woman, NOT a horror-render or distorted figure
11. The bedroom shows: white wardrobe area + some natural decor + parquet floor

Reply ONLY with valid JSON in this exact format:
{"errors":["A1: 3 arms visible behind body", ...],"verdict":"PASS"}
or
{"errors":["B7: 2 phones merged"],"verdict":"FAIL"}

PASS = 0 errors. FAIL = any error.

Be strict. If there's any doubt about an extra arm or weird finger, mark it FAIL.`;

  const res = await fetchWithRetry('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent', {
    method: 'POST',
    headers: { 'x-goog-api-key': geminiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{
        parts: [
          { inline_data: { mime_type: mime, data: buf.toString('base64') } },
          { text: checklist },
        ],
      }],
      generationConfig: { temperature: 0, maxOutputTokens: 800, responseMimeType: 'application/json' },
    }),
  });
  if (!res.ok) {
    return { verdict: 'ERROR', errors: [`vision-api ${res.status}`] };
  }
  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
  try {
    return JSON.parse(text);
  } catch {
    return { verdict: 'ERROR', errors: ['could not parse response: ' + (text || '').slice(0, 100)] };
  }
}

async function main() {
  await loadEnv();
  const geminiKey = process.env.GEMINI_API_KEY;
  if (!geminiKey) throw new Error('GEMINI_API_KEY missing');

  const args = process.argv.slice(2);
  const autoMove = args.includes('--auto-move');

  // List all candidates
  const files = await fs.readdir(CANDIDATES_DIR).catch(() => []);
  const poses = files.filter(f => /^pose_\d+\.jpg$/.test(f)).sort();
  if (poses.length === 0) {
    console.error('No pose candidates found.');
    process.exit(1);
  }

  console.log(`Validate-Library`);
  console.log(`  Candidates: ${poses.length}`);
  console.log(`  Auto-move FAIL → _rejects/: ${autoMove ? 'YES' : 'no'}\n`);

  await fs.mkdir(REJECTS_DIR, { recursive: true });

  // Validate in batches of 4 parallel
  const results = [];
  const t0 = Date.now();

  async function processOne(filename) {
    const imgPath = path.join(CANDIDATES_DIR, filename);
    const tStart = Date.now();
    const result = await validateImage(imgPath, geminiKey);
    const dt = ((Date.now() - tStart) / 1000).toFixed(1);
    const rec = { filename, ...result, dt };

    const errsStr = result.errors?.length ? ` [${result.errors.length} errors]` : '';
    const sym = result.verdict === 'PASS' ? '✓' : (result.verdict === 'ERROR' ? '?' : '✗');
    console.log(`  ${sym} ${filename}  ${result.verdict}${errsStr}  (${dt}s)`);
    if (result.errors?.length) {
      for (const e of result.errors) console.log(`      - ${e}`);
    }

    // Auto-move FAIL
    if (autoMove && result.verdict === 'FAIL') {
      try {
        await fs.rename(imgPath, path.join(REJECTS_DIR, filename));
      } catch (err) {
        console.log(`      (rename failed: ${err.message})`);
      }
    }
    return rec;
  }

  // Run with concurrency 4
  const queue = [...poses];
  const workers = [];
  for (let w = 0; w < 4; w++) {
    workers.push((async () => {
      while (queue.length > 0) {
        const f = queue.shift();
        if (!f) break;
        results.push(await processOne(f));
      }
    })());
  }
  await Promise.all(workers);

  results.sort((a, b) => a.filename.localeCompare(b.filename));

  // Write report
  await fs.writeFile(REPORT_PATH, JSON.stringify({
    generated_at: new Date().toISOString(),
    total: results.length,
    pass: results.filter(r => r.verdict === 'PASS').length,
    fail: results.filter(r => r.verdict === 'FAIL').length,
    error: results.filter(r => r.verdict === 'ERROR').length,
    auto_moved: autoMove,
    results,
  }, null, 2));

  const dt = ((Date.now() - t0) / 1000).toFixed(1);
  const pass = results.filter(r => r.verdict === 'PASS').length;
  const fail = results.filter(r => r.verdict === 'FAIL').length;
  const err = results.filter(r => r.verdict === 'ERROR').length;

  console.log(`\n=== DONE in ${dt}s ===`);
  console.log(`  ✓ PASS:  ${pass}`);
  console.log(`  ✗ FAIL:  ${fail}${autoMove ? ' (auto-moved to _rejects/)' : ''}`);
  console.log(`  ? ERROR: ${err}`);
  console.log(`  Report:  ${REPORT_PATH}`);
}

main().catch(err => { console.error('FATAL:', err.message); process.exit(1); });
