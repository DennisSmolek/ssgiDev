// Demo 13 (optimization lab) variant runner — NEXTGEN P5 (ALU phase 1 +
// BANDWIDTH phase 2). Paired A/B per variant vs `baseline`, back-to-back for
// thermal pairing. For cells C-wide + S-hall (GRID_CAMS), for each variant in the
// selected family:
//   (a) fenced __bench13 march ms — measured back-to-back with a fresh baseline
//       march at the SAME pose/config (thermal pairing); ratio is the signal.
//   (b) screenshot MSE of the variant's CONVERGED combined view vs BASELINE's —
//       the PRIMARY correctness gate. ALU + light-mips + hiz-skip must match the
//       baseline image (hiz-skip is CONSERVATIVE ⇒ bit-identical, gate 1e-4). The
//       lossy-in-motion variants (checkerboard, adaptive, bandwidth-all) legiti-
//       mately differ under motion, so their gate is the CONVERGED-only image at
//       a relaxed ≤1e-3 (a still camera lets the temporal accumulator converge).
//   (c) screenshot MSE of the variant's combined view vs the ORACLE reference —
//       the quality-unchanged check (must stay within noise of baseline's).
//   (d) stability metric + stability DELTA vs baseline (checkerboard's ~2×-march
//       cost shows up here; a positive delta = less stable than baseline).
//
// BANDWIDTH-family extras:
//   - adaptive / bandwidth-all measure march ms at BOTH effort endpoints: converged
//     (still, guides say N high ⇒ pixels coast) and fresh (post-teleport worst case,
//     full effort). Deterministic via __bench13.setEffortMode(); plus a REAL camera
//     teleport (window.__cam.set) then an immediate burst while the live guides read
//     'fresh' — the honest motion cost. The still ratio is the headline; fresh≈base.
//
// Acceptance per variant (recorded pass/fail, misses NOT hidden — a variant that
// measures SLOWER is a valid documented negative result, lab 09 model):
//   - pass_ms:       march_ms strictly < the paired baseline march_ms
//   - pass_baseline: MSE-vs-baseline ≤ the variant's gate (1e-4 exact / 1e-3 relaxed)
//   - pass_oracle:   MSE-vs-oracle within noise of baseline's MSE-vs-oracle
//
// GPU numbers are SMOKE under the live rAF loop (shared buffers) until the
// orchestrator's isolated run — same caveat as run-12.
//
// Run: node scripts/run-13.mjs [--quick] [--family alu|bandwidth|all] [--out <name>]

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
const famIdx = argv.indexOf('--family');
const family = famIdx !== -1 ? argv[famIdx + 1] : 'all';

const ALU_VARIANTS = ['trig', 'loop', 'precision', 'alu-all'];
const BW_VARIANTS = ['light-mips', 'hiz-skip', 'checkerboard', 'adaptive', 'bandwidth-all'];
// P5.3 scheduled heirs: CACAO-style phase-bucket marching + the subgroup experiment
// (feature-gated; baseline is its documented fallback pair).
const P3_VARIANTS = ['deinterleave', 'subgroups'];
const FAMILIES = {
  alu: ALU_VARIANTS, bandwidth: BW_VARIANTS, phase3: P3_VARIANTS,
  all: [...ALU_VARIANTS, ...BW_VARIANTS, ...P3_VARIANTS],
};
const VARIANTS = FAMILIES[family] ?? FAMILIES.all; // baseline is the control (not looped)
const defaultOut = family === 'alu' ? 'demo13-alu'
  : family === 'bandwidth' ? 'demo13-bandwidth'
    : family === 'phase3' ? 'demo13-phase3' : 'demo13-all';
const outName = outIdx !== -1 ? argv[outIdx + 1] : defaultOut;
// P5.3 deinterleave reports march ms (4 compact dispatches) AND chain ms (incl. the
// deinterleave/interleave passes) — the de/interleave overhead only shows in the chain.
const measuresChain = (v) => v === 'deinterleave';

// Per-variant correctness gate. `mse` is the MSE-vs-baseline ceiling; `relaxed`
// flags the CONVERGED-only comparison for variants that legitimately differ in
// motion (checkerboard, adaptive, bandwidth-all) — the still image must still
// converge to the baseline. hiz-skip is conservative ⇒ held to the exact 1e-4.
const GATE = {
  trig: { mse: 1e-4 }, loop: { mse: 1e-4 }, precision: { mse: 1e-4 }, 'alu-all': { mse: 1e-4 },
  'light-mips': { mse: 1e-3 },
  'hiz-skip': { mse: 1e-4 },
  checkerboard: { mse: 1e-3, relaxed: true },
  adaptive: { mse: 1e-3, relaxed: true },
  'bandwidth-all': { mse: 1e-3, relaxed: true },
  // P5.3: deinterleave legitimately differs from baseline (per-bucket depth
  // decimation + noise-phase regrouping + mipOpt-off on the compact pass), so it
  // uses the relaxed CONVERGED-only gate. subgroups shares only provably-identical
  // fetches ⇒ bit-exact, held to the exact 1e-4.
  deinterleave: { mse: 1e-3, relaxed: true },
  subgroups: { mse: 1e-4 },
};
const isAdaptive = (v) => v === 'adaptive' || v === 'bandwidth-all';

const CELLS = ['C-wide', 'S-hall'];
const mainSettle = quick ? 4000 : 8000;
const refSettle = quick ? 5000 : 10000;
const stabSettle = quick ? 3000 : 6000;
const stabGap = quick ? 1000 : 2000;
// quick uses 2 bursts (min filters a contended burst); the recorded run uses
// lab-09's 3×40. Teleport bursts are lighter (the fresh window is short-lived).
const burstOpts = quick ? { bursts: 2, iters: 15 } : { bursts: 3, iters: 40 };
const teleBurst = quick ? { bursts: 2, iters: 12 } : { bursts: 3, iters: 25 };

const MSE_ORACLE_SLACK = 0.01; // variant MSE-vs-oracle allowed above baseline's

function shotPath(cell, tag) {
  return resolve(REPO_ROOT, `bench/results/shots/demo13/${cell}-${tag}.png`);
}
const marchOnActive = (page, n) => page.evaluate((i) => window.__bench13.march(i), n);
const chainOnActive = (page, n) => page.evaluate((i) => window.__bench13.chain(i), n);

// A flat row template so every row shares the same keys (writeResults derives the
// columns from the first row).
function makeRow(over) {
  return {
    cell: '', scene: '', variant: '', available: true,
    march_ms: null, baseline_march_ms: null, ms_ratio: null, pass_ms: null,
    chain_ms: null, baseline_chain_ms: null, chain_ratio: null,
    march_ms_converged: null, march_ms_fresh: null, march_ms_teleport: null,
    mse_vs_baseline: null, gate_mse: null, pass_baseline: null,
    mse_vs_oracle: null, baseline_mse_oracle: null, pass_oracle: null,
    stability: null, stability_delta: null,
    note: '', config: '',
    ...over,
  };
}

const browser = await launchBrowser();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const rows = [];

for (const cell of CELLS) {
  const { scene, cam } = GRID_CAMS[cell];
  const camNums = cam.split(',').map(Number);
  // A reproducible teleport pose: shove the camera off its pose (disocclusion).
  const teleCam = [camNums[0] + 3.0, camNums[1] + 1.0, camNums[2] + 2.5, camNums[3], camNums[4], camNums[5]];

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

  rows.push(makeRow({
    cell, scene, variant: 'baseline',
    mse_vs_baseline: 0, mse_vs_oracle: baselineMseOracle, baseline_mse_oracle: baselineMseOracle,
    stability: baselineStability, stability_delta: 0,
    note: 'pristine demo-12 march (control)', config: JSON.stringify(cfgSnapshot),
  }));
  console.log(`[13] ${cell} baseline: mse-vs-oracle ${baselineMseOracle.toFixed(4)} | stability ${baselineStability.toFixed(3)}`);

  // --- each variant ------------------------------------------------------------
  for (const variant of VARIANTS) {
    const info = availMap[variant] ?? { available: false, note: 'unknown' };
    const gate = GATE[variant] ?? { mse: 1e-4 };
    if (!info.available) {
      rows.push(makeRow({
        cell, scene, variant, available: false,
        baseline_mse_oracle: baselineMseOracle, gate_mse: gate.mse,
        note: info.note,
      }));
      console.log(`[13] ${cell} ${variant}: UNAVAILABLE (${info.note})`);
      continue;
    }

    // (b/c/d) converge the variant's combined view (auto effort), capture, compare.
    await applyConfig(page, { viewMode: 'combined', variant });
    await page.evaluate(() => window.__bench13.setEffortMode('auto'));
    await settle(mainSettle);
    const varImg = await grabContent(page, shotPath(cell, `${variant}-combined`));
    const mseBaseline = mse(varImg, baselineImg);
    const mseOracle = mse(varImg, oracleImg);
    const stability = await stabilityMetric(page, { settleMs: stabSettle, gapMs: stabGap, saveAs: shotPath(cell, `${variant}-stab`) });
    const cfgAt = await exportConfig(page);

    // (a) paired fenced march ms — baseline then variant, back-to-back (thermal).
    await applyConfig(page, { viewMode: 'combined', variant: 'baseline' });
    await settle(400);
    await page.evaluate(() => window.__bench13.setVariant('baseline'));
    await page.evaluate((c) => window.__bench13.config(c), { scale: 'half' });
    await settle(300);
    await marchOnActive(page, 3); // warm the baseline pipeline (JIT/cold-dispatch)
    const baseMarch = await minOfBursts((n) => marchOnActive(page, n), burstOpts);

    await page.evaluate((v) => window.__bench13.setVariant(v), variant);
    await settle(300);

    let varMarch, extra = {};
    if (isAdaptive(variant)) {
      // Converged (still) endpoint — the headline win: guides say N high ⇒ coast.
      await page.evaluate(() => window.__bench13.setEffortMode('converged'));
      await settle(200); await marchOnActive(page, 3);
      const varConverged = await minOfBursts((n) => marchOnActive(page, n), burstOpts);
      // Fresh endpoint (deterministic full effort — post-teleport worst case).
      await page.evaluate(() => window.__bench13.setEffortMode('fresh'));
      await settle(200); await marchOnActive(page, 3);
      const varFresh = await minOfBursts((n) => marchOnActive(page, n), burstOpts);
      // REAL teleport → live guides read 'fresh'; burst immediately.
      await page.evaluate(() => window.__bench13.setEffortMode('auto'));
      await page.evaluate((c) => window.__cam.set(...c), teleCam);
      await settle(150); await marchOnActive(page, 1);
      const varTeleport = await minOfBursts((n) => marchOnActive(page, n), teleBurst);
      await page.evaluate((c) => window.__cam.set(...c), camNums); // restore pose
      await page.evaluate(() => window.__bench13.setEffortMode('auto'));
      varMarch = varConverged; // ratio reflects the still (converged) win
      extra = { march_ms_converged: varConverged, march_ms_fresh: varFresh, march_ms_teleport: varTeleport };
    } else {
      await marchOnActive(page, 3); // warm the variant pipeline before timing
      varMarch = await minOfBursts((n) => marchOnActive(page, n), burstOpts);
    }

    // (a2) P5.3 deinterleave: also measure the CHAIN (incl. de/interleave passes),
    // baseline then variant back-to-back (thermal-paired), same min-of-bursts.
    let chainExtra = {};
    if (measuresChain(variant)) {
      await page.evaluate(() => window.__bench13.setVariant('baseline'));
      await settle(250); await chainOnActive(page, 3);
      const baseChain = await minOfBursts((n) => chainOnActive(page, n), burstOpts);
      await page.evaluate((vv) => window.__bench13.setVariant(vv), variant);
      await settle(250); await chainOnActive(page, 3);
      const varChain = await minOfBursts((n) => chainOnActive(page, n), burstOpts);
      chainExtra = { chain_ms: varChain, baseline_chain_ms: baseChain, chain_ratio: baseChain / varChain };
    }

    const ratio = baseMarch / varMarch;
    const passMs = varMarch < baseMarch;
    const passBaseline = mseBaseline <= gate.mse;
    const passOracle = mseOracle <= baselineMseOracle + MSE_ORACLE_SLACK;

    rows.push(makeRow({
      cell, scene, variant,
      march_ms: varMarch, baseline_march_ms: baseMarch, ms_ratio: ratio, pass_ms: passMs,
      ...extra,
      ...chainExtra,
      mse_vs_baseline: mseBaseline, gate_mse: gate.mse, pass_baseline: passBaseline,
      mse_vs_oracle: mseOracle, baseline_mse_oracle: baselineMseOracle, pass_oracle: passOracle,
      stability, stability_delta: stability - baselineStability,
      note: (gate.relaxed ? 'CONVERGED-only gate; ' : '') + info.note,
      config: JSON.stringify(cfgAt),
    }));
    const adaptStr = isAdaptive(variant)
      ? ` | conv ${extra.march_ms_converged.toFixed(3)} fresh ${extra.march_ms_fresh.toFixed(3)} tele ${extra.march_ms_teleport.toFixed(3)}` : '';
    const chainStr = chainExtra.chain_ms != null
      ? ` | chain ${chainExtra.chain_ms.toFixed(3)}ms vs base ${chainExtra.baseline_chain_ms.toFixed(3)}ms (${chainExtra.chain_ratio.toFixed(2)}×)` : '';
    console.log(
      `[13] ${cell} ${variant}: march ${varMarch.toFixed(3)}ms vs base ${baseMarch.toFixed(3)}ms ` +
      `(${ratio.toFixed(2)}×, faster=${passMs})${adaptStr} | mse-vs-base ${mseBaseline.toExponential(2)} ` +
      `(≤${gate.mse}, pass=${passBaseline}) | mse-vs-oracle ${mseOracle.toFixed(4)} (base ${baselineMseOracle.toFixed(4)}, pass=${passOracle}) | ` +
      `stability ${stability.toFixed(3)} (Δ ${(stability - baselineStability).toFixed(3)})` + chainStr,
    );
  }
}

await browser.close();

const meta = {
  viewport: '1280x800',
  family,
  bursts: burstOpts.bursts,
  itersPerBurst: burstOpts.iters,
  mainSettleMs: mainSettle,
  refSettleMs: refSettle,
  stabilityMs: `${stabSettle}/${stabGap}`,
  variantFamily:
    family === 'alu' ? 'ALU (P5.1): trig, loop, precision, alu-all vs baseline'
      : family === 'bandwidth' ? 'BANDWIDTH (P5.2): light-mips, hiz-skip, checkerboard, adaptive, bandwidth-all vs baseline'
        : family === 'phase3' ? 'PHASE3 (P5.3): deinterleave (CACAO-style, march + chain), subgroups (feature-gated pair) vs baseline'
          : 'ALU (P5.1) + BANDWIDTH (P5.2) + PHASE3 (P5.3) vs baseline',
  acceptance: {
    pass_ms: 'march_ms strictly < the paired (thermal-matched) baseline march_ms',
    pass_baseline: 'MSE(variant combined, baseline combined) ≤ gate_mse — 1e-4 for exact/conservative variants (incl. hiz-skip), 1e-3 CONVERGED-only for the in-motion-lossy variants (checkerboard, adaptive, bandwidth-all)',
    pass_oracle: `MSE(variant, oracle) ≤ baseline's MSE(baseline, oracle) + ${MSE_ORACLE_SLACK} (quality unchanged)`,
  },
  pairing:
    'march ms is measured baseline-then-variant back-to-back per row so both share ' +
    'thermal state; ms_ratio = baseline_march_ms / march_ms (>1 = variant faster). ' +
    'For adaptive/bandwidth-all ms_ratio reflects the CONVERGED (still) effort; ' +
    'march_ms_converged / march_ms_fresh are the deterministic effort endpoints and ' +
    'march_ms_teleport is a live post-teleport burst (the honest motion cost).',
  negativeResults:
    'A variant slower than baseline is a VALID recorded result (pass_ms=false), not ' +
    'hidden — NEXTGEN principle 5 says the wins live in bandwidth; the measurement ' +
    'adjudicates which of these actually bank on this fetch-bound march.',
  caveat:
    'GPU ms measured under the live rAF loop (shared buffers) — contention-prone; ' +
    'treat as smoke unless run in isolation. MSE is screenshot-space (tonemapped 8-bit).',
  ...(quick ? { note: 'quick smoke run — not a recorded number' } : {}),
};
const { jsonPath, mdPath } = writeResults(outName, rows, meta);
console.log(`wrote ${jsonPath}`);
console.log(`wrote ${mdPath}`);
