#!/usr/bin/env node
//
// fetch-assets.mjs — download the Sponza test scene + stage the KTX2/Draco decoders.
//
// Cross-platform (macOS/Linux/Windows) — needs only Node 18+, no bash/curl.
// Idempotent: skips anything already present. Safe to re-run.
//
// What it does:
//   1. Downloads toji/sponza-optimized `Sponza-KTX-Draco.glb` (~9.7 MB, 100% standard
//      glTF: KHR_draco_mesh_compression + KHR_texture_basisu/KTX2) into bench/assets/.
//      (Asset choice + URL: research/sponza-asset-comparison.md.)
//   2. Copies the Draco + Basis/KTX2 decoder blobs OUT OF the installed three package
//      (node_modules/three/examples/jsm/libs/{draco,basis}) into bench/public/decoders/
//      so Vite serves them at /decoders/... at runtime. We copy from node_modules rather
//      than fetch from a CDN so the decoder version always matches the pinned three
//      (a mismatched transcoder silently corrupts textures). CSP/offline-friendly too.
//
// bench/assets/ and bench/public/decoders/ are BOTH gitignored (derived artifacts).

import { cpSync, existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const BENCH_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const ASSETS_DIR = join(BENCH_DIR, 'assets');
const DECODERS_DIR = join(BENCH_DIR, 'public', 'decoders');
const THREE_LIBS = join(BENCH_DIR, 'node_modules', 'three', 'examples', 'jsm', 'libs');

const SPONZA_URL = 'https://github.com/toji/sponza-optimized/raw/main/Sponza-KTX-Draco.glb';
const SPONZA_OUT = join(ASSETS_DIR, 'Sponza-KTX-Draco.glb');

const mb = (path) => `${(statSync(path).size / 1024 / 1024).toFixed(1)}M`;

console.log('==> SSGI bench asset fetch');

// --- 1. Sponza glb -----------------------------------------------------------
mkdirSync(ASSETS_DIR, { recursive: true });
if (existsSync(SPONZA_OUT)) {
  console.log(`  [skip] ${SPONZA_OUT} already present (${mb(SPONZA_OUT)})`);
} else {
  console.log(`  [get ] ${SPONZA_URL}`);
  let res;
  for (let attempt = 1; ; attempt++) {
    res = await fetch(SPONZA_URL, { redirect: 'follow' }).catch(() => null);
    if (res?.ok) break;
    if (attempt >= 3) {
      console.error(`  [err ] download failed (${res ? `HTTP ${res.status}` : 'network error'})`);
      process.exit(1);
    }
  }
  writeFileSync(SPONZA_OUT, Buffer.from(await res.arrayBuffer()));
  console.log(`  [ ok ] ${SPONZA_OUT} (${mb(SPONZA_OUT)})`);
}

// --- 2. Decoders from the installed three package ----------------------------
if (!existsSync(THREE_LIBS)) {
  console.error(`  [err ] ${THREE_LIBS} not found — run 'pnpm install' first.`);
  process.exit(1);
}

mkdirSync(DECODERS_DIR, { recursive: true });

for (const name of ['draco', 'basis']) {
  const dest = join(DECODERS_DIR, name);
  if (existsSync(dest)) {
    console.log(`  [skip] decoders/${name} already staged`);
  } else {
    console.log(`  [copy] ${name} decoder -> public/decoders/${name}`);
    cpSync(join(THREE_LIBS, name), dest, { recursive: true, dereference: true });
  }
}

console.log('==> done.');
