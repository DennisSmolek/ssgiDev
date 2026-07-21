// Demo 03 (SSRT3) compute bench (NEXTGEN P0). Drives window.__ssrt3bench(n) —
// the compute-only chain (lightmask + [mip pyramid] + main + temporal),
// fenced on queue.onSubmittedWorkDone, returns avg ms/iteration.
//
// Grid cells = TESTING.md's "Standard measurement grid" (GRID_CAMS in the
// shared lib; Z-zoo runs the scene-default camera).
// Config is driven live via window.__benchParams (applyConfig), not page
// reloads, so paired variants (mipOptimization on/off) share thermal state.
// rc/sc and mipOptimization are re-read from exportConfig after applying —
// the page's actual config is ground truth, not what we asked for.
//
// Run: node scripts/run-03bench.mjs [--quick] [--out <name>]

import { launchBrowser, openDemo, applyConfig, exportConfig, settle, minOfBursts, writeResults, GRID_CAMS } from './lib/harness.mjs';

const argv = process.argv.slice(2);
const quick = argv.includes('--quick');
const outIdx = argv.indexOf('--out');
const outName = outIdx !== -1 ? argv[outIdx + 1] : 'demo03-compute';

const CELLS = Object.entries(GRID_CAMS).map(([id, g]) => ({
  id,
  scene: g.scene,
  cam: g.cam ?? undefined,
}));
const cells = quick ? CELLS.slice(0, 1) : CELLS;

const CONFIGS = [
  { name: 'default', rc: 2, sc: 12 },
  { name: 'heavy', rc: 4, sc: 32 },
];
const MIP_STATES = [true, false]; // paired axis, measured back-to-back per config

const burstOpts = quick ? { bursts: 1, iters: 10 } : { bursts: 3, iters: 40 };

const browser = await launchBrowser();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

const rows = [];

for (const cell of cells) {
  await openDemo(page, { demo: '03', scene: cell.scene, cam: cell.cam });
  await settle(2000); // pipeline warm-up

  for (const cfg of CONFIGS) {
    // mipOptimization is the paired axis — back-to-back at fixed cell/config.
    for (const mip of MIP_STATES) {
      await applyConfig(page, { rotationCount: cfg.rc, stepCount: cfg.sc, mipOptimization: mip });
      await settle(300);
      const exported = await exportConfig(page); // ground truth, not the intent

      const ms = await minOfBursts(
        (n) => page.evaluate((iters) => window.__ssrt3bench(iters), n),
        burstOpts,
      );

      const row = {
        cell: cell.id,
        scene: cell.scene,
        cam: cell.cam ?? 'default',
        config: cfg.name,
        mipOptimization: mip,
        rotationCount: exported.rotationCount,
        stepCount: exported.stepCount,
        ms,
      };
      rows.push(row);
      console.log(
        `[03] ${cell.id}/${cfg.name} rc${exported.rotationCount}sc${exported.stepCount} mip=${mip} -> ${ms.toFixed(3)}ms`,
      );
    }
  }
}

await browser.close();

const meta = {
  viewport: '1280x800',
  bursts: burstOpts.bursts,
  itersPerBurst: burstOpts.iters,
  ...(quick ? { note: 'quick smoke run — not a recorded number' } : {}),
};
const { jsonPath, mdPath } = writeResults(outName, rows, meta);
console.log(`wrote ${jsonPath}`);
console.log(`wrote ${mdPath}`);
