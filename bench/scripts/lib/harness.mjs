// Shared harness for the committed lab runners (NEXTGEN P0).
//
// Methodology this lib pins down (do not re-derive in runners):
// - HEADED browser only. Headless chromium = software WebGPU adapter = black
//   canvas. Launch args: ['--enable-unsafe-webgpu']. No Vulkan flag on macOS.
// - Prefers the real installed Chrome (channel 'chrome' — matches the live
//   capability probe: subgroups/f16/timestamp-query); falls back to a bundled
//   chromium if present.
// - Config driving: window.__benchParams (harness params.ts hook), NOT the
//   clipboard — no permission grants, no flaky paste. Every recorded number is
//   stamped with the config JSON exported back FROM the page (ground truth,
//   not what we intended to set) + the git commit.
// - Stability metric (WORKLOG 2026-07-18): mean abs per-pixel diff (0..255
//   scale, RGB) of two screenshots 2 s apart after a settle, tweakpane column
//   excluded via clip. Reference points: demo 03 frame-count 0.83 vs ema 3.38.
// - Fenced bursts (lab 09): min of 3×40-iteration bursts ≈ least-throttled ≈
//   true GPU cost; paired variants measured back-to-back so they share thermal
//   state; ratios are the robust signal, absolutes drift ±15% with thermals.
// - GPU results are meaningless under contention: never run two measuring
//   pages at once. This lib is deliberately serial.

import { chromium } from 'playwright-core';
import { PNG } from 'pngjs';
import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const BASE_URL = process.env.BENCH_URL ?? 'http://localhost:5180/';
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

// Full registry ids (the URL `?demo=` param matches these exactly; a bare
// number like '03' silently falls back to the first demo — openDemo asserts).
export const DEMO_IDS = {
  '00': '00-gbuffer',
  '01': '01-stock-three',
  '02': '02-reference',
  '03': '03-ssrt3',
  '04': '04-gt-vbao',
  '05': '05-gt-vbgi',
  '06': '06-sshgi-mathis',
  '07': '07-ambient-lab',
  '08': '08-distant-light',
  '09': '09-bandwidth',
  '10': '10-denoise',
  '11': '11-sampling',
  '12': '12-distilled',
  '13': '13-optim',
  '14': '14-svgf',
  '16': '16-fsr',
  '17': '17-guides-ab',
  '18': '18-temporal',
};

// TESTING.md measurement grid — poses picked visually 2026-07-21 (candidate
// screenshots in the session scratchpad). Z-zoo uses the scene default (no cam).
export const GRID_CAMS = {
  'C-wide': { scene: 'cornell', cam: '0,2.4,8.8,0,2.6,0' },
  'C-graze': { scene: 'cornell', cam: '1.4,3.6,4.6,0.95,1.3,0.7' },
  'C-contact': { scene: 'cornell', cam: '3.0,1.6,3.6,0.3,0.5,0.1' },
  'S-hall': { scene: 'sponza', cam: '11,1.8,-0.3,-10,2.6,-0.3' },
  'S-column': { scene: 'sponza', cam: '2.0,1.6,0.0,3.4,1.4,-2.6' },
  'Z-zoo': { scene: 'artifact-zoo', cam: null },
};

// ---------------------------------------------------------------- browser ---

export async function launchBrowser() {
  const opts = { headless: false, args: ['--enable-unsafe-webgpu'] };
  try {
    return await chromium.launch({ ...opts, channel: 'chrome' });
  } catch {
    return await chromium.launch(opts); // bundled chromium (needs prior install)
  }
}

/**
 * Open a demo page and wait until the harness is actually rendering.
 * query: extra URL params (e.g. { view: 'gi', rc: '4', sc: '32', stack: 'ssrt3' }).
 */
export async function openDemo(page, { demo, scene = 'cornell', cam, query = {} }) {
  const demoId = DEMO_IDS[String(demo)] ?? String(demo);
  const p = new URLSearchParams({ demo: demoId, scene, ...query });
  if (cam) p.set('cam', cam);
  await page.goto(`${BASE_URL}?${p.toString()}`, { waitUntil: 'domcontentloaded' });
  // Init is done when the params hook exists and a canvas is mounted.
  await page.waitForFunction(
    () => (window.__benchParams?.length ?? 0) > 0 && !!document.querySelector('#app canvas'),
    undefined,
    { timeout: 30_000 },
  );
  const err = await page.evaluate(
    () => document.getElementById('error')?.classList.contains('show') ?? false,
  );
  if (err) {
    const msg = await page.evaluate(() => document.getElementById('error-msg')?.textContent ?? '');
    throw new Error(`bench error overlay shown: ${msg}`);
  }
  // The registry falls back silently on unknown ids — assert what resolved.
  const resolved = await page.evaluate(() => window.__resolved);
  if (resolved && (resolved.demo !== demoId || resolved.scene !== scene)) {
    throw new Error(
      `wrong demo/scene resolved: wanted ${demoId}/${scene}, got ${resolved.demo}/${resolved.scene}`,
    );
  }
}

/** Apply a config JSON (object or string) via the last-registered params group. */
export async function applyConfig(page, config) {
  const json = typeof config === 'string' ? config : JSON.stringify(config);
  await page.evaluate((j) => window.__benchParams.at(-1).import(j), json);
}

/** Read back the page's ACTUAL current config — this is what gets stamped. */
export async function exportConfig(page) {
  return JSON.parse(await page.evaluate(() => window.__benchParams.at(-1).export()));
}

export const settle = (ms) => new Promise((r) => setTimeout(r, ms));

// ------------------------------------------------------------ screenshots ---

/** Clip rect covering the canvas but excluding the tweakpane column (right). */
async function contentClip(page) {
  const vp = page.viewportSize() ?? { width: 1280, height: 800 };
  const pane = await page.evaluate(() => {
    const el = document.querySelector('.tp-dfwv');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  });
  // Pane is fixed top-right; exclude its full column width, with margin.
  const w = pane ? Math.max(64, Math.floor(pane.x) - 8) : vp.width;
  return { x: 0, y: 0, width: w, height: vp.height };
}

/** Screenshot the content area (pane excluded) → decoded PNG {width,height,data}. */
export async function grabContent(page, savePath = null) {
  const clip = await contentClip(page);
  const buf = await page.screenshot({ clip });
  if (savePath) {
    mkdirSync(dirname(savePath), { recursive: true });
    writeFileSync(savePath, buf);
  }
  return PNG.sync.read(buf);
}

// ---------------------------------------------------------------- metrics ---

/** Mean abs per-pixel diff over RGB, 0..255 scale. Images must match in size. */
export function meanAbsDiff(a, b) {
  if (a.width !== b.width || a.height !== b.height)
    throw new Error(`size mismatch ${a.width}x${a.height} vs ${b.width}x${b.height}`);
  let sum = 0;
  const n = a.width * a.height;
  for (let i = 0; i < n * 4; i += 4) {
    sum +=
      Math.abs(a.data[i] - b.data[i]) +
      Math.abs(a.data[i + 1] - b.data[i + 1]) +
      Math.abs(a.data[i + 2] - b.data[i + 2]);
  }
  return sum / (n * 3);
}

/** Screenshot-space MSE over RGB, normalized to [0,1] values. */
export function mse(a, b) {
  if (a.width !== b.width || a.height !== b.height)
    throw new Error(`size mismatch ${a.width}x${a.height} vs ${b.width}x${b.height}`);
  let sum = 0;
  const n = a.width * a.height;
  for (let i = 0; i < n * 4; i += 4) {
    for (let c = 0; c < 3; c++) {
      const d = (a.data[i + c] - b.data[i + c]) / 255;
      sum += d * d;
    }
  }
  return sum / (n * 3);
}

/**
 * The WORKLOG stability metric: settle, shot A, wait gap, shot B, mean abs
 * diff with the pane excluded. Defaults = the recorded methodology (6 s / 2 s).
 */
export async function stabilityMetric(page, { settleMs = 6000, gapMs = 2000, saveAs = null } = {}) {
  await settle(settleMs);
  const a = await grabContent(page, saveAs ? `${saveAs}-a.png` : null);
  await settle(gapMs);
  const b = await grabContent(page, saveAs ? `${saveAs}-b.png` : null);
  return meanAbsDiff(a, b);
}

/**
 * Lab 09 fence methodology: `run(iters)` must resolve to average-ms-per-iter
 * (the in-page hooks already fence on onSubmittedWorkDone). Returns the min
 * across bursts. Keep paired variants back-to-back in the caller.
 */
export async function minOfBursts(run, { bursts = 3, iters = 40 } = {}) {
  let best = Infinity;
  for (let i = 0; i < bursts; i++) best = Math.min(best, await run(iters));
  return best;
}

// ---------------------------------------------------------------- results ---

// ---------------------------------------------------------------- Phase α ---
// Testing infrastructure: convergence curves, ghosting detection, edge metrics,
// temporal heatmaps.

/**
 * Convergence curve: generalized from run-18.
 * Opens demo, measures per-frame churn over duration, returns diff array + stats.
 */
export async function convergenceCurve(page, demoParams, { duration = 12000, sampleMs = 1000 } = {}) {
  await openDemo(page, demoParams);
  await settle(2000); // settle before measuring

  const frames = [];
  const t0 = Date.now();
  while (Date.now() - t0 <= duration) {
    const t = (Date.now() - t0) / 1000;
    const img = await grabContent(page);
    frames.push({ t, img });
    await settle(sampleMs);
  }

  // Per-frame churn (mean abs diff between consecutive frames)
  const diffs = [];
  for (let i = 0; i < frames.length - 1; i++) {
    const churn = meanAbsDiff(frames[i].img, frames[i + 1].img);
    diffs.push({ t: frames[i + 1].t, churn });
  }

  // Early (first 3 frames) and late (last 3 frames) averages
  const early = diffs.slice(0, 3).reduce((s, d) => s + d.churn, 0) / Math.min(3, diffs.length);
  const late = diffs.slice(-3).reduce((s, d) => s + d.churn, 0) / Math.min(3, diffs.length);

  return { diffs, early, late, frames: frames.map(f => f.img) };
}

/**
 * Geometric ghosting detector: per-pixel temporal variance as a ghosting proxy.
 * High-variance clusters = stale GI in wrong locations.
 * Returns score in [0, 1] where 0 = no ghosting, 1 = severe.
 */
export function geometricGhostingDetector(frames) {
  if (frames.length < 2) return 0;

  const width = frames[0].width;
  const height = frames[0].height;
  const pixelCount = width * height;

  // Sample every 4th pixel to avoid stack overflow on large images
  let highChurnCount = 0;
  const sampleRate = 4;

  for (let i = 0; i < pixelCount; i += sampleRate) {
    const idx = i * 4;
    let sum = 0;
    let sumSq = 0;

    for (const frame of frames) {
      const lum = (frame.data[idx] + frame.data[idx + 1] + frame.data[idx + 2]) / 3;
      sum += lum;
      sumSq += lum * lum;
    }

    const n = frames.length;
    const mean = sum / n;
    const variance = (sumSq / n) - (mean * mean);
    const stddev = Math.sqrt(Math.max(0, variance));

    // Threshold: stale GI shows luminance variance > 20 units
    if (stddev > 20) highChurnCount++;
  }

  const sampledPixels = Math.ceil(pixelCount / sampleRate);
  const ratio = highChurnCount / sampledPixels;

  // Normalize: >10% of sampled pixels = ghosting signal
  return Math.min(1, ratio * 10);
}

/**
 * Edge sharpness: Laplacian-based high-frequency energy.
 * High values = sharp edges, low = blurry/jagged.
 * Returns scalar in [0, 1].
 */
export function edgeSharpness(frame) {
  const width = frame.width;
  const height = frame.height;
  let edgeEnergy = 0;
  let count = 0;

  // 3×3 Laplacian: high response on edges
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = (y * width + x) * 4;
      const center = frame.data[idx];

      const neighbors = [
        frame.data[((y - 1) * width + (x - 1)) * 4],
        frame.data[((y - 1) * width + x) * 4],
        frame.data[((y - 1) * width + (x + 1)) * 4],
        frame.data[(y * width + (x - 1)) * 4],
        frame.data[(y * width + (x + 1)) * 4],
        frame.data[((y + 1) * width + (x - 1)) * 4],
        frame.data[((y + 1) * width + x) * 4],
        frame.data[((y + 1) * width + (x + 1)) * 4],
      ];

      const lap = 8 * center - neighbors.reduce((a, b) => a + b, 0);
      edgeEnergy += Math.abs(lap);
      count++;
    }
  }

  const avgEdgeEnergy = edgeEnergy / count;
  // Normalize: typical edge ~600 max
  return Math.min(1, avgEdgeEnergy / 600);
}

/**
 * Temporal churn heatmap: per-pixel mean diff over frame sequence.
 * Red = high churn (artifacts), blue = low (converged).
 * Writes PNG, returns path.
 */
export async function churnHeatmap(frames, savePath) {
  if (frames.length < 2) throw new Error('need ≥2 frames for heatmap');

  const width = frames[0].width;
  const height = frames[0].height;
  const pixelCount = width * height;

  // Sample down to 64×64 to avoid memory overhead
  const heatWidth = 64;
  const heatHeight = 64;
  const heatmap = new PNG({ width: heatWidth, height: heatHeight });
  const xStep = width / heatWidth;
  const yStep = height / heatHeight;

  let maxChurn = 0;
  const churnData = new Uint8Array(heatWidth * heatHeight);

  // Sample-based heatmap
  for (let hy = 0; hy < heatHeight; hy++) {
    for (let hx = 0; hx < heatWidth; hx++) {
      const y = Math.floor(hy * yStep);
      const x = Math.floor(hx * xStep);
      const idx = (y * width + x) * 4;

      let totalChurn = 0;
      for (let i = 0; i < frames.length - 1; i++) {
        const a = frames[i];
        const b = frames[i + 1];
        const diff =
          (Math.abs(a.data[idx] - b.data[idx]) +
            Math.abs(a.data[idx + 1] - b.data[idx + 1]) +
            Math.abs(a.data[idx + 2] - b.data[idx + 2])) / 3;
        totalChurn += diff;
      }

      const churn = totalChurn / (frames.length - 1);
      churnData[hy * heatWidth + hx] = churn;
      maxChurn = Math.max(maxChurn, churn);
    }
  }

  // Render false-color: red = high, blue = low
  for (let i = 0; i < heatWidth * heatHeight; i++) {
    const normalized = churnData[i] / Math.max(1, maxChurn);
    const idx = i * 4;

    heatmap.data[idx] = Math.floor(normalized * 255); // R
    heatmap.data[idx + 1] = 0; // G
    heatmap.data[idx + 2] = Math.floor((1 - normalized) * 255); // B
    heatmap.data[idx + 3] = 255; // A
  }

  mkdirSync(dirname(savePath), { recursive: true });
  writeFileSync(savePath, PNG.sync.write(heatmap));

  return savePath;
}

export function gitInfo() {
  const commit = execSync('git rev-parse --short HEAD', { cwd: REPO_ROOT }).toString().trim();
  const dirty = execSync('git status --porcelain', { cwd: REPO_ROOT }).toString().trim().length > 0;
  return { commit: dirty ? `${commit}-dirty` : commit };
}

/**
 * Write results as JSON + a markdown table, stamped with commit + timestamp.
 * rows: array of flat objects (same keys). Extra context goes in `meta`.
 * Writes bench/results/<name>.json and .md; returns the paths.
 */
export function writeResults(name, rows, meta = {}) {
  const outDir = resolve(REPO_ROOT, 'bench/results');
  mkdirSync(outDir, { recursive: true });
  const stamp = { ...gitInfo(), date: new Date().toISOString(), baseUrl: BASE_URL, ...meta };
  const jsonPath = resolve(outDir, `${name}.json`);
  writeFileSync(jsonPath, JSON.stringify({ meta: stamp, rows }, null, 2));

  // Per-row config/diff blobs stay in the .json (the reproducibility stamp)
  // but would swamp the markdown table — skip them there. Columns are the
  // UNION of row keys in first-seen order: rows of different shapes (e.g.
  // lab14's stability vs mse rows) must all render (first-row-only keys
  // silently dropped lab14's whole mse column, caught 2026-07-23).
  const SKIP_MD_KEYS = new Set(['config', 'diffsJson', 'exported']);
  const keys = [...new Set(rows.flatMap((r) => Object.keys(r)))].filter((k) => !SKIP_MD_KEYS.has(k));
  const fmt = (v) => (typeof v === 'number' ? +v.toFixed(4) : v);
  const md = [
    `# ${name}`,
    '',
    ...Object.entries(stamp).map(([k, v]) => `- ${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`),
    '',
    `| ${keys.join(' | ')} |`,
    `|${keys.map(() => '---').join('|')}|`,
    ...rows.map((r) => `| ${keys.map((k) => fmt(r[k])).join(' | ')} |`),
    '',
  ].join('\n');
  const mdPath = resolve(outDir, `${name}.md`);
  writeFileSync(mdPath, md);
  return { jsonPath, mdPath };
}
