// Lab 14 cost — the H5 measurement SVGF-SPEC §3 requires for the ship/kill
// decision: à-trous ×K + moments must stay within ~2× the 1-pass bilateral's
// compute cost. run-14.mjs records stability/MSE; this runner records fenced
// ms via demo 14's `window.__svgf14bench(n)` hook (compute-only: producer +
// guides-if-needed + active arm, fenced on onSubmittedWorkDone — same
// min-of-bursts methodology as run-bench-all / lab 09).
//
// Rows: (grid, stack, config) -> msPerIter (min of bursts) + msDelta vs the
// same-cell bilateral row (the hook includes the shared producer, so the
// delta isolates each arm's own cost).
//
// Usage: node scripts/run-14-cost.mjs [--quick] [--out <name>]

import {
  launchBrowser, openDemo, applyConfig, exportConfig, settle,
  minOfBursts, writeResults, GRID_CAMS,
} from './lib/harness.mjs';

const args = process.argv.slice(2);
const quick = args.includes('--quick');
const outIdx = args.indexOf('--out');
const outName = outIdx !== -1 ? args[outIdx + 1] : 'lab14-cost';

const STACKS = ['bilateral', 'svgf-lite', 'svgf', 'ssrt3-guides'];
const GRID_IDS = quick ? ['C-wide'] : ['C-wide', 'S-hall'];
// Demo 14's producer is compile-time fixed (rc1/sc8 experimental control), so
// there is no "heavy" producer config here. The second axis that matters for
// H5 is a-trous depth: default K=4 vs the K=2 fallback the spec's SVGF-lite
// discussion contemplates.
const CONFIGS = quick
  ? [{ name: 'default', patch: {} }]
  : [{ name: 'default', patch: {} }, { name: 'K2', patch: { atrousIterations: 2 } }];

const bursts = quick ? 1 : 3;
const iters = quick ? 10 : 40;

const browser = await launchBrowser();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const rows = [];

for (const gridId of GRID_IDS) {
  const cell = GRID_CAMS[gridId];
  for (const cfg of CONFIGS) {
    const bilateralMs = { value: null };
    for (const stack of STACKS) {
      await openDemo(page, { demo: '14', scene: cell.scene, cam: cell.cam });
      await applyConfig(page, { stack, ...cfg.patch });
      await settle(quick ? 1500 : 4000); // pipelines warm + history settles
      const ms = await minOfBursts(
        (n) => page.evaluate((iters2) => window.__svgf14bench(iters2), n),
        { bursts, iters },
      );
      if (stack === 'bilateral') bilateralMs.value = ms;
      const config = JSON.stringify(await exportConfig(page));
      rows.push({
        demo: '14-svgf', grid: gridId, stack, config: cfg.name,
        msPerIter: Number(ms.toFixed(4)),
        msDeltaVsBilateral:
          bilateralMs.value === null ? '' : Number((ms - bilateralMs.value).toFixed(4)),
        ratioVsBilateral:
          bilateralMs.value === null ? '' : Number((ms / bilateralMs.value).toFixed(3)),
        exported: config,
      });
      console.log(
        `[lab14-cost] ${gridId} ${cfg.name} ${stack}: ${ms.toFixed(3)} ms/iter` +
          (bilateralMs.value !== null && stack !== 'bilateral'
            ? ` (${(ms / bilateralMs.value).toFixed(2)}x bilateral)`
            : ''),
      );
    }
  }
}

const { jsonPath, mdPath } = writeResults(outName, rows, {
  hook: '__svgf14bench (fenced compute-only: producer + guides-if-needed + arm)',
  method: `min of ${bursts}x${iters} bursts`,
  h5: 'SVGF-SPEC §3 H5: svgf msPerIter <= ~2x bilateral msPerIter (same cell/config)',
  ...(quick ? { quickNote: 'quick smoke run — not a recorded number' } : {}),
});
console.log('wrote', jsonPath, mdPath);
await browser.close();
