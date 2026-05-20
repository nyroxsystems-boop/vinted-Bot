#!/usr/bin/env node
// Copies the 4 user-provided reference images into the canonical anchor slots.
//
// Expected source files (drop them here):
//   /Users/home/Vinted/_anchors/_user_uploads/1_front.jpg
//   /Users/home/Vinted/_anchors/_user_uploads/2_side.jpg     (optional, used as front backup)
//   /Users/home/Vinted/_anchors/_user_uploads/3_back.jpg
//   /Users/home/Vinted/_anchors/_user_uploads/4_face.jpg
//
// Targets:
//   anchor_persona_front.jpg  ← 1_front.jpg
//   anchor_persona_back.jpg   ← 3_back.jpg
//   anchor_persona_face.jpg   ← 4_face.jpg
//
// Side image (2) and product flatlay (5) are NOT used as anchors.

import fs from 'node:fs/promises';
import path from 'node:path';

const UPLOADS = '/Users/home/Vinted/_anchors/_user_uploads';
const ANCHORS = '/Users/home/Vinted/_anchors';

const MAP = [
  { src: '1_front.jpg', dst: 'anchor_persona_front.jpg', required: true },
  { src: '3_back.jpg',  dst: 'anchor_persona_back.jpg',  required: true },
  { src: '4_face.jpg',  dst: 'anchor_persona_face.jpg',  required: true },
];

async function main() {
  let allOk = true;
  for (const { src, dst, required } of MAP) {
    const srcPath = path.join(UPLOADS, src);
    const dstPath = path.join(ANCHORS, dst);
    const exists = await fs.stat(srcPath).then(() => true).catch(() => false);
    if (!exists) {
      console.log(`  ✗ missing: ${srcPath}`);
      if (required) allOk = false;
      continue;
    }
    await fs.copyFile(srcPath, dstPath);
    console.log(`  ✓ ${src} → ${dst}`);
  }
  if (!allOk) {
    console.log(`\nDrop the missing files into ${UPLOADS} and re-run.`);
    process.exit(2);
  }
  console.log(`\nAll persona anchors set. Run the environment builder next:`);
  console.log(`  node /Users/home/Vinted/system/scripts/nano-build-env-anchor.mjs --force`);
}

main().catch(err => { console.error('FAIL:', err.message); process.exit(1); });
