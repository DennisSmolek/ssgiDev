// Offline blue-noise atlas generator for demo 11 (sampling lab).
//
// Produces bench/src/demos/11-sampling/stbn-atlas.png — a 512x512 RGBA8 image
// laid out as a 4x4 grid of sixteen 128x128 tiles. Within each tile the R and G
// channels carry two mutually-decorrelated scalar blue-noise fields (R -> slice
// angle random, G -> march/horizon jitter random). B=0, A=255.
//
// Usage of the atlas at runtime (sampling.wgsl):
//   - "blue" mode           : reads tile 0, temporally advanced by golden-ratio
//                             value jitter per frame.
//   - "stbn" (approx) mode   : cycles tile = frameIndex % 16 per frame; the tiles
//                             are spatially blue and mutually decorrelated, which
//                             approximates a spatiotemporal blue-noise volume.
//
// Method: Georgiev & Fajardo "Blue-noise Dithered Sampling" (SIGGRAPH 2016
// talk) energy minimisation. Each field starts as a random permutation of the
// uniform ranks {0.5/N .. (N-0.5)/N} — so the value histogram is exactly uniform
// and STAYS uniform because we only ever swap values (Salm's requirement:
// "as long as it follows a uniform distribution"). We then minimise
//   E = sum_{i!=j} exp(-||pi-pj||^2 / sigma_s^2  -  |vi-vj|^(d/2) / sigma_v^2)
// (toroidal distance, d=1) by random value swaps, accepting any swap that
// lowers energy. This drives similar values apart -> blue-noise spectrum.
//
// This is a legitimate no-network generator; it is NOT the Wolfe et al. STBN
// optimiser — the per-tile decorrelation is an honest APPROXIMATION of STBN,
// documented as such in the demo README.
//
// Deterministic: fixed PRNG seed -> reproducible PNG. Run: `node scripts/gen-bluenoise.mjs`.

import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const TILE = 128; // tile edge
const GRID = 4; // 4x4 tiles
const TILES = GRID * GRID; // 16
const ATLAS = TILE * GRID; // 512
const N = TILE * TILE; // 16384 pixels per field

// energy kernel params
const SIGMA_S = 1.9; // spatial sigma (blue-ness radius)
const SIGMA_V = 1.0; // value sigma
const RADIUS = 6; // truncated kernel radius (~3 sigma_s)
const SWEEPS = 40; // swap attempts = SWEEPS * N per field (tuned: lag-1 corr ~ -0.20)

// --- deterministic PRNG (mulberry32) ---
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// precompute spatial gaussian weights for kernel offsets (dx,dy) in [-R,R]
const kernel = []; // { dx, dy, w }
for (let dy = -RADIUS; dy <= RADIUS; dy++) {
  for (let dx = -RADIUS; dx <= RADIUS; dx++) {
    if (dx === 0 && dy === 0) continue;
    const d2 = dx * dx + dy * dy;
    if (d2 > RADIUS * RADIUS) continue;
    kernel.push({ dx, dy, w: Math.exp(-d2 / (SIGMA_S * SIGMA_S)) });
  }
}

// energy contribution of pixel index p (at value v) with all kernel neighbours
function pixelEnergy(values, x, y, v) {
  let e = 0;
  for (const k of kernel) {
    const nx = (x + k.dx + TILE) & (TILE - 1);
    const ny = (y + k.dy + TILE) & (TILE - 1);
    const dv = Math.abs(v - values[ny * TILE + nx]);
    // d=1 value distance -> exponent d/2 = 0.5
    e += k.w * Math.exp(-Math.sqrt(dv) / (SIGMA_V * SIGMA_V));
  }
  return e;
}

function generateField(rng) {
  // uniform ranks, shuffled
  const values = new Float64Array(N);
  for (let i = 0; i < N; i++) values[i] = (i + 0.5) / N;
  for (let i = N - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const t = values[i];
    values[i] = values[j];
    values[j] = t;
  }

  const attempts = SWEEPS * N;
  for (let s = 0; s < attempts; s++) {
    const a = Math.floor(rng() * N);
    let b = Math.floor(rng() * N);
    if (b === a) b = (b + 1) % N;
    const ax = a & (TILE - 1);
    const ay = a >> 7;
    const bx = b & (TILE - 1);
    const by = b >> 7;
    const va = values[a];
    const vb = values[b];
    // energy before (pixels keep their own value)
    const before = pixelEnergy(values, ax, ay, va) + pixelEnergy(values, bx, by, vb);
    // energy after swap (a takes vb, b takes va). The (a,b) pair term is
    // invariant under the swap (|va-vb| unchanged) so no special handling.
    const after = pixelEnergy(values, ax, ay, vb) + pixelEnergy(values, bx, by, va);
    if (after < before) {
      values[a] = vb;
      values[b] = va;
    }
  }
  return values;
}

// --- build atlas RGBA8 ---
const rng = mulberry32(0x5eed1234);
const rgba = new Uint8Array(ATLAS * ATLAS * 4);
// init B=0, A=255
for (let i = 0; i < ATLAS * ATLAS; i++) {
  rgba[i * 4 + 2] = 0;
  rgba[i * 4 + 3] = 255;
}

for (let t = 0; t < TILES; t++) {
  const tcol = t % GRID;
  const trow = Math.floor(t / GRID);
  const fieldR = generateField(rng); // slice-angle field
  const fieldG = generateField(rng); // jitter field
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      const ax = tcol * TILE + x;
      const ay = trow * TILE + y;
      const o = (ay * ATLAS + ax) * 4;
      const idx = y * TILE + x;
      rgba[o + 0] = Math.min(255, Math.floor(fieldR[idx] * 256));
      rgba[o + 1] = Math.min(255, Math.floor(fieldG[idx] * 256));
    }
  }
  process.stdout.write(`  tile ${t + 1}/${TILES}\r`);
}
process.stdout.write('\n');

// --- minimal PNG encoder (RGBA8, no interlace) ---
function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'latin1');
  const body = Buffer.concat([typeBuf, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}
function encodePNG(width, height, rgbaBytes) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace
  // scanlines with filter byte 0
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    Buffer.from(rgbaBytes.buffer, rgbaBytes.byteOffset + y * stride, stride).copy(
      raw,
      y * (stride + 1) + 1,
    );
  }
  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const outDir = resolve(dirname(fileURLToPath(import.meta.url)), '../src/demos/11-sampling');
const outPath = resolve(outDir, 'stbn-atlas.png');
writeFileSync(outPath, encodePNG(ATLAS, ATLAS, rgba));
console.log(`wrote ${outPath} (${ATLAS}x${ATLAS}, ${TILES} tiles, RG blue-noise fields)`);
