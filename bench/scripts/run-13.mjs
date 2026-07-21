// Demo 13 (optimization lab) ALU-variant runner — NEXTGEN P5 phase 1.
//
// Paired A/B per variant vs `baseline`, back-to-back for thermal pairing. For
// cells C-wide + S-hall (GRID_CAMS), for each variant in the ALU family:
//   (a) fenced __bench13 march ms — measured back-to-back with a fresh baseline
//       march at the SAME pose/config (thermal pairing); ratio is the signal.
//   (b) screenshot MSE of the variant's converged combined view vs BASELINE's
//       combined view — the PRIMARY correctness gate (the variant must match its
//       own control; target MSE ≤ ~1e-4 at identical settings/noise).
//   (c) screenshot MSE of the variant's combined view vs the ORACLE reference —
//       the quality-unchanged check (must stay within noise of baseline's).
//   (d) stability metric (6s settle / 2s gap, mean-abs per-pixel diff).
//
// Acceptance per variant (recorded pass/fail, misses NOT hidden — a variant that
// measures SLOWER is a valid documented negative result, lab 09 model):
//   - pass_ms:       march_ms strictly < the paired baseline march_ms
//   - pass_baseline: MSE-vs-baseline ≤ MSE_BASELINE_MAX (variant matches control)
//   - pass_oracle:   MSE-vs-oracle within noise of baseline's MSE-vs-oracle
//
// GPU numbers are SMOKE under the live rAF loop (shared buffers) until the
// orchestrator's isolated run — same caveat as run-12.
//
// Run: node scripts/run-13.mjs [--quick] [--out <name>]

import {
  launchBrowser, openDemo, applyConfig, exportConfig, settle, grabContent, mse,
  stabilityMetric, minOfBursts, writeResults, GRID_CAMS,
} from './lib/harness.mjs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const argv = process.argv.slice(2);
const quick = argv.includes('--quick');
const outIdx = argv.indexOf('--out');
const outName = outIdx !== -1 ? argv[outIdx + 1] : 'demo13-alu';

const CELLS = ['C-wide', 'S-hall'];
const VARIANTS = ['trig', 'loop', 'precision', 'alu-all']; // baseline is the control
const mainSettle = quick ? 4000 : 8000;
const refSettle = quick ? 5000 : 10000;
const stabSettle = quick ? 3000 : 6000;
const stabGap = quick ? 1000 : 2000;
// quick uses 2 bursts (min filters a contended burst — a single rAF frame landing
// in a 1-burst window doubles the reading and manufactures a fake ratio); the
// recorded run uses lab-09's 3×40.
const burstOpts = quick ? { bursts: 2, iters: 15 } : { bursts: 3, iters: 40 };

// Correctness gates. Screenshot 8-bit MSE; two converged baseline captures differ
// by ~1e-6 (temporal cycle residual), so 1e-4 has comfortable margin for an
// exact-or-below-noise variant.
const MSE_BASELINE_MAX = 1e-4;
const MSE_ORACLE_SLACK = 0.01; // variant MSE-vs-oracle allowed above baseline's

function shotPath(cell, tag) {
  return resolve(REPO_ROOT, `bench/results/shots/demo13/${cell}-${tag}.png`);
}

const browser = await launchBrowser();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const rows = [];

for (const cell of CELLS) {
  const { scene, cam } = GRID_CAMS[cell];

  // --- baseline: load, converge combined, capture, stability, oracle MSE -------
  await openDemo(page, { demo: '13', scene, cam, query: { view: 'combined', mscale: 'half', variant: 'baseline' } });
  const availList = await page.evaluate(() => window.__bench13.variants());
  const availMap = Object.fromEntries(availList.map((v) => [v.name, v]));

  await settle(mainSettle);
  const baselineImg = await grabContent(page, shotPath(cell, 'baseline-combined'));
  const baselineStability = await stabilityMetric(page, { settleMs: stabSettle, gapMs: stabGap, saveAs: shotPath(cell, 'baseline-stab') });

  // Oracle (variant-independent): switch to the reference view, full re-settle.
  await applyConfig(page, { viewMode: 'reference' });
  await settle(refSettle);
  const oracleImg = await grabContent(page, shotPath(cell, 'oracle'));
  const baselineMseOracle = mse(baselineImg, oracleImg);
  const cfgSnapshot = await exportConfig(page);

  // Baseline reference row.
  rows.push({
    cell, scene, variant: 'baseline', available: true,
    march_ms: null, baseline_march_ms: null, ms_ratio: null, pass_ms: null,
    mse_vs_baseline: 0, pass_baseline: null,
    mse_vs_oracle: baselineMseOracle, baseline_mse_oracle: baselineMseOracle, pass_oracle: null,
    stability: baselineStability,
    note: 'pristine demo-12 march (control)',
    config: JSON.stringify(cfgSnapshot),
  });
  console.log(`[13] ${cell} baseline: mse-vs-oracle ${baselineMseOracle.toFixed(4)} | stability ${baselineStability.toFixed(3)}`);

  // --- each variant ------------------------------------------------------------
  for (const variant of VARIANTS) {
    const info = availMap[variant] ?? { available: false, note: 'unknown' };
    if (!info.available) {
      rows.push({
        cell, scene, variant, available: false,
        march_ms: null, baseline_march_ms: null, ms_ratio: null, pass_ms: null,
        mse_vs_baseline: null, pass_baseline: null,
        mse_vs_oracle: null, baseline_mse_oracle: baselineMseOracle, pass_oracle: null,
        stability: null, note: info.note, config: '',
      });
      console.log(`[13] ${cell} ${variant}: UNAVAILABLE (${info.note})`);
      continue;
    }

    // (b/c/d) converge the variant's combined view, capture, compare, stability.
    await applyConfig(page, { viewMode: 'combined', variant });
    await settle(mainSettle);
    const varImg = await grabContent(page, shotPath(cell, `${variant}-combined`));
    const mseBaseline = mse(varImg, baselineImg);
    const mseOracle = mse(varImg, oracleImg);
    const stability = await stabilityMetric(page, { settleMs: stabSettle, gapMs: stabGap, saveAs: shotPath(cell, `${variant}-stab`) });
    const cfgAt = await exportConfig(page);

    // (a) paired fenced march ms — baseline then variant, back-to-back (thermal).
    // Ensure combined view (no oracle contention) before timing.
    await applyConfig(page, { viewMode: 'combined', variant: 'baseline' });
    await settle(400);
    await page.evaluate(() => window.__bench13.setVariant('baseline'));
    await page.evaluate((c) => window.__bench13.config(c), { scale: 'half' });
    await settle(300);
    await page.evaluate(() => window.__bench13.march(3)); // warm the baseline pipeline (JIT/cold-dispatch)
    const baseMarch = await minOfBursts((n) => page.evaluate((i) => window.__bench13.march(i), n), burstOpts);
    await page.evaluate((v) => window.__bench13.setVariant(v), variant);
    await settle(300);
    await page.evaluate(() => window.__bench13.march(3)); // warm the variant pipeline before timing
    const varMarch = await minOfBursts((n) => page.evaluate((i) => window.__bench13.march(i), n), burstOpts);

    const ratio = baseMarch / varMarch; // >1 = variant faster
    const passMs = varMarch < baseMarch;
    const passBaseline = mseBaseline <= MSE_BASELINE_MAX;
    const passOracle = mseOracle <= baselineMseOracle + MSE_ORACLE_SLACK;

    rows.push({
      cell, scene, variant, available: true,
      march_ms: varMarch, baseline_march_ms: baseMarch, ms_ratio: ratio, pass_ms: passMs,
      mse_vs_baseline: mseBaseline, pass_baseline: passBaseline,
      mse_vs_oracle: mseOracle, baseline_mse_oracle: baselineMseOracle, pass_oracle: passOracle,
      stability, note: info.note, config: JSON.stringify(cfgAt),
    });
    console.log(
      `[13] ${cell} ${variant}: march ${varMarch.toFixed(3)}ms vs base ${baseMarch.toFixed(3)}ms ` +
      `(${ratio.toFixed(2)}×, faster=${passMs}) | mse-vs-base ${mseBaseline.toExponential(2)} (pass=${passBaseline}) | ` +
      `mse-vs-oracle ${mseOracle.toFixed(4)} (base ${baselineMseOracle.toFixed(4)}, pass=${passOracle}) | ` +
      `stability ${stability.toFixed(3)}`,
    );
  }
}

await browser.close();

const meta = {
  viewport: '1280x800',
  bursts: burstOpts.bursts,
  itersPerBurst: burstOpts.iters,
  mainSettleMs: mainSettle,
  refSettleMs: refSettle,
  stabilityMs: `${stabSettle}/${stabGap}`,
  variantFamily: 'ALU (NEXTGEN P5 phase 1): trig, loop, precision, alu-all vs baseline',
  acceptance: {
    pass_ms: 'march_ms strictly < the paired (thermal-matched) baseline march_ms',
    pass_baseline: `MSE(variant combined, baseline combined) ≤ ${MSE_BASELINE_MAX} (variant matches its own control)`,
    pass_oracle: `MSE(variant, oracle) ≤ baseline's MSE(baseline, oracle) + ${MSE_ORACLE_SLACK} (quality unchanged)`,
  },
  pairing:
    'march ms is measured baseline-then-variant back-to-back per row so both share ' +
    'thermal state; ms_ratio = baseline_march_ms / march_ms (>1 = variant faster).',
  negativeResults:
    'A variant slower than baseline is a VALID recorded result (pass_ms=false), not ' +
    'hidden — NEXTGEN principle 5 predicts pure-ALU wins are small on a fetch-bound ' +
    'march; the measurement adjudicates.',
  caveat:
    'GPU ms measured under the live rAF loop (shared buffers) — contention-prone; ' +
    'treat as smoke unless run in isolation. MSE is screenshot-space (tonemapped 8-bit).',
  ...(quick ? { note: 'quick smoke run — not a recorded number' } : {}),
};
const { jsonPath, mdPath } = writeResults(outName, rows, meta);
console.log(`wrote ${jsonPath}`);
console.log(`wrote ${mdPath}`);
