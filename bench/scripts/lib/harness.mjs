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

  // Per-row config JSON stays in the .json (the reproducibility stamp) but
  // would swamp the markdown table — skip it there.
  const keys = (rows.length ? Object.keys(rows[0]) : []).filter((k) => k !== 'config');
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
