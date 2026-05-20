#!/usr/bin/env node
// Generates ONE chunk of N listings from /tmp/master_listings.json starting
// at the given offset. Used for the chunk-and-check workflow:
//   node run-chunk.mjs <offset> <size> [--concurrency=N]
// e.g. node run-chunk.mjs 0 10 --concurrency=3
//
// Each chunk produces 4 images per listing in <out_dir>.
// Skips listings whose 4_flatlay.jpg already exists.

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MASTER = '/tmp/master_listings.json';

// Reuse the per-variant generator via a small wrapper.
// We can't easily call generateForProduct directly (it iterates ALL variants
// of a product), so we replicate the same logic for one variant here.
import { ANCHORS, SHOT_PLAN, buildModelPrompt, buildFlatlayPrompt, pickPose, pickFootwear, pickFraming, pickFlatlayStyle, callGemini, loadEnv } from './nano-build-listing-photos.mjs';

async function generateOneVariant({ product_folder, product_id, color_slug, is_multi, garment, out_dir }) {
  await fs.mkdir(out_dir, { recursive: true });
  const doneMarker = path.join(out_dir, '4_flatlay.jpg');
  if (await fs.stat(doneMarker).catch(() => null)) {
    return { skipped: true };
  }
  const seed = is_multi ? `${product_id}::${color_slug}` : product_id;
  const garmentPath = path.join(product_folder, '_clean', garment);

  for (const shot of SHOT_PLAN) {
    const outFile = path.join(out_dir, `${shot.name}.jpg`);
    if (await fs.stat(outFile).catch(() => null)) continue;

    let prompt;
    let imagePaths;
    if (shot.name === "4_flatlay") {
      const styleDesc = pickFlatlayStyle(seed);
      prompt = buildFlatlayPrompt(styleDesc) + `\n\nCRITICAL: Output aspect ratio MUST be exactly ${shot.aspect}`;
      imagePaths = [ANCHORS.env, garmentPath];
    } else {
      const poseDesc = pickPose(shot.name, seed + "::" + shot.name);
      const footwear = pickFootwear(seed);
      const framing = pickFraming(seed);
      prompt = buildModelPrompt({ shotName: shot.name, poseDesc, footwear, framing })
             + `\n\nCRITICAL: Output aspect ratio MUST be exactly ${shot.aspect}`;
      imagePaths = [...shot.anchors.map(a => ANCHORS[a]), garmentPath];
    }
    const buf = await callGemini(prompt, imagePaths);
    await fs.writeFile(outFile, buf);
  }
  return { ok: true };
}

async function main() {
  await loadEnv();
  const args = process.argv.slice(2);
  const offset = parseInt(args[0], 10);
  const size = parseInt(args[1], 10);
  const concArg = args.find(a => a.startsWith('--concurrency='));
  const concurrency = concArg ? parseInt(concArg.split('=')[1], 10) : 3;
  if (Number.isNaN(offset) || Number.isNaN(size)) {
    console.error('Usage: node run-chunk.mjs <offset> <size> [--concurrency=N]');
    process.exit(1);
  }

  const master = JSON.parse(await fs.readFile(MASTER, 'utf8'));
  const slice = master.slice(offset, offset + size);
  if (slice.length === 0) {
    console.log(`No listings at offset ${offset} (master has ${master.length}).`);
    return;
  }

  console.log(`Chunk: listings ${offset + 1}..${offset + slice.length} of ${master.length}  (concurrency=${concurrency})`);
  const t0 = Date.now();
  let ok = 0, skip = 0, fail = 0;

  // Run in parallel pools of `concurrency`
  const queue = [...slice];
  const workers = [];
  for (let w = 0; w < concurrency; w++) {
    workers.push((async () => {
      while (queue.length > 0) {
        const item = queue.shift();
        if (!item) break;
        const tag = `${item.category}/${item.product_id}${item.is_multi ? '['+item.color_slug+']' : ''}`;
        try {
          const r = await generateOneVariant(item);
          if (r.skipped) { skip++; console.log(`  ⏭  ${tag}`); }
          else { ok++; console.log(`  ✓ ${tag}`); }
        } catch (err) {
          fail++;
          console.log(`  ✗ ${tag}  ${err.message}`);
        }
      }
    })());
  }
  await Promise.all(workers);

  const dt = ((Date.now() - t0) / 1000 / 60).toFixed(1);
  console.log(`\n=== CHUNK DONE === ${ok} ok, ${skip} skipped, ${fail} failed in ${dt} min`);
  console.log(`Outputs:`);
  for (const item of slice) console.log(`  ${path.join(item.out_dir, '1_front.jpg')}`);
}

main().catch(err => { console.error('FATAL:', err.message); process.exit(1); });
