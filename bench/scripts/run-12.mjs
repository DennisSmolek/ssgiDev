// Demo 12 (distilled SSGI v0) acceptance runner (NEXTGEN P3, DELIVERABLE 2).
//
// For cells C-wide + S-hall (GRID_CAMS):
//   (a) fenced __bench12.total at default (half-res) AND marchScale=full,
//       min-of-3×40 (M3 onSubmittedWorkDone fence — GPU numbers under the live
//       rAF loop are contention-prone; treat as smoke unless run in isolation).
//   (b) screenshot MSE of demo 12's combined view vs its OWN converged reference
//       view (settle 8s main / 10s ref — same window + harnessQuirk as
//       run-quality.mjs: every applyConfig resets the oracle, so the ref capture
//       re-settles the full convergence window, not a short repaint wait).
//   (c) stability metric (6s settle / 2s gap, mean abs per-pixel diff).
//
// Acceptance targets (pass/fail recorded per row, misses NOT hidden), vs demo
// 03's recorded numbers read at runtime from trackB-budget.json + trackA-
// quality.json (quoted in meta):
//   - total(half) ≤ demo 03 total at the same cell (the half-res chain should beat it)
//   - MSE vs own reference in demo 03's ballpark (≤ 1.5× + 0.02 slack)
//   - stability ≤ demo 03 frame-count's 0.31-ish (≤ 0.40 with slack)
//
// Run: node scripts/run-12.mjs [--quick] [--out <name>]

import {
  launchBrowser, openDemo, applyConfig, exportConfig, settle, grabContent, mse,
  stabilityMetric, minOfBursts, writeResults, GRID_CAMS,
} from './lib/harness.mjs';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const argv = process.argv.slice(2);
const quick = argv.includes('--quick');
const outIdx = argv.indexOf('--out');
const outName = outIdx !== -1 ? argv[outIdx + 1] : 'demo12-acceptance';

const CELLS = ['C-wide', 'S-hall'];
const mainSettle = quick ? 4000 : 8000;
const refSettle = quick ? 5000 : 10000;
const stabSettle = quick ? 3000 : 6000;
const stabGap = quick ? 1000 : 2000;
const burstOpts = quick ? { bursts: 1, iters: 10 } : { bursts: 3, iters: 40 };

// --- demo 03 recorded comparison numbers (read at runtime) -------------------
function readJSON(p) {
  return JSON.parse(readFileSync(resolve(REPO_ROOT, p), 'utf8'));
}
const budget = readJSON('bench/results/trackB-budget.json');
const quality = readJSON('bench/results/trackA-quality.json');
// demo 03 total ms per cell (default config).
const demo03Total = {};
for (const r of budget.rows) {
  if (r.demo === '03' && r.cfg === 'default' && r.pass === 'total') demo03Total[r.cell] = r.ms;
}
// demo 03 MSE (combined vs oracle) per cell.
const demo03Mse = {};
for (const r of quality.rows) {
  if (r.demo === '03-ssrt3') demo03Mse[r.cell] = r.mse;
}
const DEMO03_STABILITY_FRAMECOUNT = 0.31; // trackE / trackC recorded frame-count still stability

function shotPath(cell, view) {
  return resolve(REPO_ROOT, `bench/results/shots/demo12/${cell}-${view}.png`);
}

const browser = await launchBrowser();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const rows = [];

for (const cell of CELLS) {
  const { scene, cam } = GRID_CAMS[cell];

  // Default config = half-res, combined view.
  await openDemo(page, { demo: '12', scene, cam, query: { view: 'combined', mscale: 'half' } });
  await settle(mainSettle);
  const combinedImg = await grabContent(page, shotPath(cell, 'combined'));

  // (c) stability on the static combined view.
  const stability = await stabilityMetric(page, { settleMs: stabSettle, gapMs: stabGap, saveAs: shotPath(cell, 'stab') });

  // (b) MSE vs own converged reference (full re-settle after the view switch).
  await applyConfig(page, { viewMode: 'reference' });
  await settle(refSettle);
  const refImg = await grabContent(page, shotPath(cell, 'reference'));
  const mseVal = mse(combinedImg, refImg);
  const cfgAtMse = await exportConfig(page);

  // (a) fenced total at default (half) and full. Switch OFF the reference view
  // first — else the expensive brute-force oracle keeps running every rAF frame
  // and competes with the fenced bench, inflating the total.
  await applyConfig(page, { viewMode: 'combined' });
  await settle(500);
  await page.evaluate((c) => window.__bench12.config(c), { scale: 'half' });
  await settle(300);
  const totalHalf = await minOfBursts((n) => page.evaluate((i) => window.__bench12.total(i), n), burstOpts);
  await settle(150);
  const totalFull = await (async () => {
    await page.evaluate((c) => window.__bench12.config(c), { scale: 'full' });
    await settle(300);
    return minOfBursts((n) => page.evaluate((i) => window.__bench12.total(i), n), burstOpts);
  })();
  // extra: march-only + chain at half, for context.
  await page.evaluate((c) => window.__bench12.config(c), { scale: 'half' });
  await settle(300);
  const marchHalf = await minOfBursts((n) => page.evaluate((i) => window.__bench12.march(i), n), burstOpts);
  await settle(150);
  const chainHalf = await minOfBursts((n) => page.evaluate((i) => window.__bench12.chain(i), n), burstOpts);

  const d03Total = demo03Total[cell] ?? null;
  const d03Mse = demo03Mse[cell] ?? null;
  const passTotal = d03Total != null ? totalHalf <= d03Total : null;
  const passMse = d03Mse != null ? mseVal <= d03Mse * 1.5 + 0.02 : null;
  const passStability = stability <= DEMO03_STABILITY_FRAMECOUNT * 1.3; // 0.40 with slack

  const row = {
    cell, scene,
    total_half_ms: totalHalf, total_full_ms: totalFull,
    march_half_ms: marchHalf, chain_half_ms: chainHalf,
    demo03_total_ms: d03Total,
    pass_total: passTotal,
    mse_vs_ref: mseVal, demo03_mse: d03Mse, pass_mse: passMse,
    stability, demo03_stability: DEMO03_STABILITY_FRAMECOUNT, pass_stability: passStability,
    config: JSON.stringify(cfgAtMse),
  };
  rows.push(row);
  console.log(
    `[12] ${cell}: total half ${totalHalf.toFixed(3)}ms (d03 ${d03Total}ms, pass=${passTotal}) full ${totalFull.toFixed(3)}ms | ` +
    `mse ${mseVal.toFixed(4)} (d03 ${d03Mse != null ? d03Mse.toFixed(4) : 'n/a'}, pass=${passMse}) | ` +
    `stability ${stability.toFixed(3)} (pass=${passStability})`,
  );
}

await browser.close();

const meta = {
  viewport: '1280x800',
  bursts: burstOpts.bursts,
  itersPerBurst: burstOpts.iters,
  mainSettleMs: mainSettle,
  refSettleMs: refSettle,
  stabilityMs: `${stabSettle}/${stabGap}`,
  demo03Reference: {
    source: 'bench/results/trackB-budget.json (total ms, default cfg) + trackA-quality.json (combined-vs-oracle MSE)',
    total_ms: demo03Total,
    mse: demo03Mse,
    stability_framecount: DEMO03_STABILITY_FRAMECOUNT,
    commitBudget: budget.meta?.commit,
    commitQuality: quality.meta?.commit,
  },
  acceptanceTargets: {
    total: 'total(half) ≤ demo 03 total at the same cell',
    mse: 'MSE vs own reference ≤ 1.5× demo 03 MSE + 0.02 slack',
    stability: 'stability ≤ 0.40 (demo 03 frame-count 0.31-ish + slack)',
  },
  caveat:
    'GPU ms measured under the live rAF loop (shared buffers) — contention-prone; ' +
    'treat totals as smoke unless run in isolation. MSE is screenshot-space ' +
    '(tonemapped 8-bit) combined-vs-oracle, same methodology as trackA-quality.',
  harnessQuirk:
    'buildParams().importJSON() notifies ALL schema keys per applyConfig; the ' +
    'viewMode->reference switch resets the oracle, so the ref capture re-settles ' +
    'the full convergence window (refSettleMs), not a short repaint wait.',
  ...(quick ? { note: 'quick smoke run — not a recorded number' } : {}),
};
const { jsonPath, mdPath } = writeResults(outName, rows, meta);
console.log(`wrote ${jsonPath}`);
console.log(`wrote ${mdPath}`);
