// Demo 18 — temporal lab (bench/src/demos/18-temporal). Verifies the lab's
// core claims:
//   1. Boot: demo 18 loads with no WGSL/console errors (all three aa modes).
//   2. Still-camera convergence: with accumMode=oneOverN (+ jitter) the
//      per-interval churn (mean abs diff of consecutive 1 s screenshots)
//      DECREASES over ~12 s and ends well below the capped@64 arm's floor —
//      the capped arm's EMA floor is the bug being diagnosed; if oneOverN
//      does not converge the jitter/disocclusion interaction is broken
//      (rolling accumAge — the demo-14 jitter bug).
//   3. Edge AA: saves a box-edge crop at t~1 s vs t~10 s (jitter on) — the
//      late crop should be visibly anti-aliased (human eyeball artifact).
//   4. Demo 14 still renders after the display-dither port.
//
// Usage: node scripts/run-18.mjs [--quick] [--shots <dir>] [--out <name>]
// (BENCH_URL selects the dev server, e.g. BENCH_URL=http://localhost:5299/.)
//
// DO NOT run this against a busy GPU — see TESTING.md / harness.mjs header.

import {
  launchBrowser, openDemo, exportConfig, settle, grabContent, meanAbsDiff,
  writeResults, GRID_CAMS,
} from './lib/harness.mjs';
import { PNG } from 'pngjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

const args = process.argv.slice(2);
const quick = args.includes('--quick');
const outIdx = args.indexOf('--out');
const outName = outIdx >= 0 ? args[outIdx + 1] : 'lab18-temporal';
const shotsIdx = args.indexOf('--shots');
const SHOTS = shotsIdx >= 0 ? args[shotsIdx + 1] : resolve(REPO_ROOT, 'bench/results/shots/lab18');

const CAM = GRID_CAMS['C-wide'].cam;
const settleMs = quick ? 1000 : 2000;
const windowMs = quick ? 6000 : 12000;
const stepMs = 1000;

// Convergence arms. capped@64 = demo 12's shipped accumulation (the EMA floor);
// oneOverN arms must end below it. jitterClamp is expected to sit near the
// capped floor (the clamp re-injects noise — measured, not fought).
const ARMS = [
  { name: 'capped64-jitter', query: { accum: 'capped', aa: 'jitter' } },
  { name: 'oneOverN-jitter', query: { accum: 'oneOverN', aa: 'jitter' } },
  { name: 'oneOverN-off', query: { accum: 'oneOverN', aa: 'off' } },
  { name: 'oneOverN-jitterClamp', query: { accum: 'oneOverN', aa: 'jitterClamp' } },
];

// Box-edge crop (fraction of the content area): the cornell C-wide pose puts
// the tall-box top edge in this window. Saved for the t1-vs-t10 AA eyeball.
const CROP = { x: 0.28, y: 0.38, w: 0.34, h: 0.28 };

function saveCrop(img, path) {
  const cx = Math.floor(img.width * CROP.x);
  const cy = Math.floor(img.height * CROP.y);
  const cw = Math.floor(img.width * CROP.w);
  const ch = Math.floor(img.height * CROP.h);
  const out = new PNG({ width: cw, height: ch });
  PNG.bitblt(img, out, cx, cy, cw, ch, 0, 0);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, PNG.sync.write(out));
}

function watchErrors(page, sink) {
  page.on('console', (msg) => {
    const t = msg.type();
    if (t === 'error' || t === 'warning') {
      const text = msg.text();
      // WGSL / WebGPU validation failures surface here (invisible to tsc).
      if (/error|wgsl|validation|pipeline|shader/i.test(text)) sink.push(`[console.${t}] ${text}`);
    }
  });
  page.on('pageerror', (err) => sink.push(`[pageerror] ${err.message}`));
}

async function convergenceRun(page, arm) {
  await openDemo(page, {
    demo: '18', scene: 'cornell', cam: CAM,
    query: { view: 'combined', ...arm.query },
  });
  await settle(settleMs);
  const frames = [];
  const t0 = Date.now();
  while (Date.now() - t0 <= windowMs) {
    const t = (Date.now() - t0) / 1000;
    const img = await grabContent(page);
    frames.push({ t, img });
    if (arm.name === 'oneOverN-jitter' && frames.length === 1) {
      saveCrop(img, resolve(SHOTS, 'edge-crop-t1.png'));
      writeFileSync(resolve(SHOTS, 'full-t1.png'), PNG.sync.write(img));
    }
    await settle(stepMs);
  }
  const last = frames[frames.length - 1].img;
  mkdirSync(SHOTS, { recursive: true });
  writeFileSync(resolve(SHOTS, `${arm.name}-final.png`), PNG.sync.write(last));
  if (arm.name === 'oneOverN-jitter') {
    saveCrop(last, resolve(SHOTS, 'edge-crop-t10.png'));
    writeFileSync(resolve(SHOTS, 'full-t10.png'), PNG.sync.write(last));
  }
  const diffs = [];
  for (let i = 0; i < frames.length - 1; i++) {
    diffs.push({ t: frames[i + 1].t, churn: meanAbsDiff(frames[i].img, frames[i + 1].img) });
  }
  const early = diffs.slice(0, 3).reduce((s, d) => s + d.churn, 0) / Math.min(3, diffs.length);
  const late = diffs.slice(-3).reduce((s, d) => s + d.churn, 0) / Math.min(3, diffs.length);
  const config = await exportConfig(page);
  return { diffs, early, late, config };
}

async function main() {
  const browser = await launchBrowser();
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  watchErrors(page, errors);
  const rows = [];

  // 1. Boot smoke: all three aa modes come up clean.
  for (const aa of ['off', 'jitter', 'jitterClamp']) {
    await openDemo(page, { demo: '18', scene: 'cornell', cam: CAM, query: { view: 'combined', aa } });
    await settle(settleMs);
    await grabContent(page, resolve(SHOTS, `boot-${aa}.png`));
    console.log(`[lab18] boot aa=${aa} ok (${errors.length} errors so far)`);
  }

  // 2. Convergence arms.
  const results = {};
  for (const arm of ARMS) {
    const r = await convergenceRun(page, arm);
    results[arm.name] = r;
    rows.push({
      demo: '18-temporal', arm: arm.name, view: 'combined',
      churnEarly: r.early, churnLate: r.late,
      diffsJson: JSON.stringify(r.diffs.map((d) => ({ t: +d.t.toFixed(2), churn: +d.churn.toFixed(4) }))),
      config: JSON.stringify(r.config),
    });
    console.log(`[lab18] arm=${arm.name} churn early=${r.early.toFixed(4)} late=${r.late.toFixed(4)}`);
  }

  // 3. Demo 14 still renders after the dither port.
  await openDemo(page, { demo: '14', scene: 'cornell' });
  await settle(settleMs);
  await grabContent(page, resolve(SHOTS, 'demo14-post-dither.png'));
  console.log('[lab18] demo 14 renders post-dither-port');

  await browser.close();

  // Assertions (reported, and fail the process so CI/agent runs notice).
  const failures = [];
  const oj = results['oneOverN-jitter'];
  const cap = results['capped64-jitter'];
  if (oj.late >= oj.early) failures.push(`oneOverN-jitter churn did not decrease (${oj.early.toFixed(3)} -> ${oj.late.toFixed(3)})`);
  if (oj.late >= cap.late * 0.5) failures.push(`oneOverN-jitter late churn ${oj.late.toFixed(3)} not well below capped@64 floor ${cap.late.toFixed(3)}`);
  if (errors.length) failures.push(`console errors: ${errors.slice(0, 5).join(' | ')}`);

  const meta = {
    cam: CAM, scene: 'cornell', settleMs, windowMs, stepMs, shots: SHOTS,
    rule: 'churnEarly/churnLate = mean of first/last 3 consecutive-frame meanAbsDiffs (1 s apart). Pass: oneOverN-jitter late < early AND late < 0.5 * capped64 late.',
    failures,
    ...(quick ? { note: 'quick smoke run — not a recorded number' } : {}),
  };
  const { jsonPath, mdPath } = writeResults(outName, rows, meta);
  console.log(`[lab18] wrote ${jsonPath}`);
  console.log(`[lab18] wrote ${mdPath}`);
  if (failures.length) {
    console.error(`[lab18] FAILURES:\n  ${failures.join('\n  ')}`);
    process.exitCode = 1;
  } else {
    console.log('[lab18] all assertions passed');
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
