// Lab 14 — SVGF lab stability + MSE-vs-reference sweep (SVGF-SPEC.md §4 test
// plan). Clones run-10.mjs's shape: per-arm stability metric (WORKLOG
// methodology) across the TESTING.md grid, plus MSE-vs-oracle rows.
//
// NOT RUN for recorded numbers in this build — the GPU was in active use
// elsewhere when this demo was built (see WORKLOG 2026-07-22). Ship the
// runner, defer the run to a quiet-GPU window, per this lib's own
// methodology note: "GPU results are meaningless under contention."
//
// Usage: node scripts/run-14.mjs [--quick] [--out <name>]

import {
  launchBrowser, openDemo, applyConfig, exportConfig, stabilityMetric,
  settle, grabContent, meanAbsDiff, mse, writeResults, GRID_CAMS, BASE_URL,
} from './lib/harness.mjs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

const args = process.argv.slice(2);
const quick = args.includes('--quick');
const outIdx = args.indexOf('--out');
const outName = outIdx >= 0 ? args[outIdx + 1] : 'lab14-svgf';

const STACKS = ['bilateral', 'svgf-lite', 'svgf', 'ssrt3-guides', 'mathis'];
// SVGF-SPEC §4 grid: C-wide, C-graze, C-contact (H1 primary), S-hall,
// S-column (H4 primary), Z-zoo.
const GRID_IDS = quick ? ['C-wide'] : ['C-wide', 'C-graze', 'C-contact', 'S-hall', 'S-column', 'Z-zoo'];
const settleMs = quick ? 2000 : 6000;
const gapMs = quick ? 1000 : 2000;
const stacksToRun = quick ? STACKS.slice(0, 1) : STACKS;

async function main() {
  const browser = await launchBrowser();
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const rows = [];

  for (const gridId of GRID_IDS) {
    const { scene, cam } = GRID_CAMS[gridId];
    for (const stack of stacksToRun) {
      // Stability (combined view).
      await openDemo(page, {
        demo: '14', scene, cam: cam ?? undefined,
        query: { view: 'combined', stack },
      });
      const shotBase = resolve(REPO_ROOT, `bench/results/shots/lab14/${gridId}/${stack}/combined`);
      const stability = await stabilityMetric(page, { settleMs, gapMs, saveAs: shotBase });
      const config = await exportConfig(page);
      rows.push({
        demo: '14-svgf', grid: gridId, stack, view: 'combined', stability,
        config: JSON.stringify(config),
      });
      console.log(`[lab14] grid=${gridId} stack=${stack} view=combined stability=${stability.toFixed(4)}`);

      // MSE vs the converged reference (the demo's own oracle — SVGF-SPEC §4
      // caveat: this ranks denoisers against EACH OTHER on this producer's
      // biased mean, not against unbiased GI; see README/spec for why).
      await settle(500);
      const activeShot = await grabContent(page);
      await openDemo(page, {
        demo: '14', scene, cam: cam ?? undefined,
        query: { view: 'reference', stack },
      });
      await settle(300);
      const refShot = await grabContent(page);
      const mseVal = mse(activeShot, refShot);
      rows.push({
        demo: '14-svgf', grid: gridId, stack, view: 'mse-vs-reference', mse: mseVal,
        config: JSON.stringify(config),
      });
      console.log(`[lab14] grid=${gridId} stack=${stack} mse-vs-reference=${mseVal.toFixed(6)}`);
    }
  }

  await browser.close();

  const meta = {
    settleMs, gapMs, grids: GRID_IDS, stacks: stacksToRun,
    note: 'SVGF-SPEC §4: MSE ranks denoisers against the demo\'s own biased-producer oracle, not unbiased GI — see README caveat.',
    ...(quick ? { quickNote: 'quick smoke run — not a recorded number' } : {}),
    notRunForRecordedNumbers: true,
  };
  const { jsonPath, mdPath } = writeResults(outName, rows, meta);
  console.log(`[lab14] wrote ${jsonPath}`);
  console.log(`[lab14] wrote ${mdPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
