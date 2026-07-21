// TESTING.md Track A — quality vs ground truth (demos 03/04/05 direct via the
// shared ReferencePass; demos 01/06 cross-referenced against demo 02's own
// converged accumulation, since they have no wired reference/split/diff view).
//
// HARNESS QUIRK (verified empirically, scratchpad diag-reset.mjs, 2026-07-21):
// buildParams().importJSON() (bench/src/harness/params.ts) notifies ALL schema
// keys on every applyConfig() call, not just the ones actually changed. Demos
// 03/04/05 react to a notified 'refRays'/'refSteps'/'refRadius' key by calling
// refPass.reset() unconditionally — so EVERY applyConfig() call while a
// reference/split/diff view is active (or transitions into one) throws away
// the oracle's accumulated samples, confirmed via meanAbsDiff ~97/255 between
// a diff-view capture taken immediately after such a call vs one taken after
// a further 9.7s settle. Consequence: switching reference -> diff (to set
// diffAmp, which has no URL override) resets the oracle a second time, and
// switching the A/B channel resets it a third time. This script therefore
// re-settles the FULL reference convergence window after every such
// transition, not a short "just let the comparator repaint" wait. This is a
// script-side workaround, not a demo/harness fix (out of scope this phase).
//
// Usage: node scripts/run-quality.mjs [--quick] [--out <name>]

import {
  launchBrowser, openDemo, applyConfig, exportConfig, settle, grabContent, mse,
  writeResults, GRID_CAMS, DEMO_IDS,
} from './lib/harness.mjs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

const args = process.argv.slice(2);
const quick = args.includes('--quick');
const outIdx = args.indexOf('--out');
const outName = outIdx >= 0 ? args[outIdx + 1] : 'trackA-quality';

// Per-demo view/param names, read from each demo's index.ts schema (VIEW_MODES
// + the 'reference' group keys). All three share 'diffAmp'; only 03/05 expose
// an A/B channel selector (04's comparator is hardcoded to the AO/alpha
// channel — GT-VBAO has no GI term to compare).
const DEMO_CFG = {
  '03': { mainView: 'combined', channelKey: 'compareChannel', defaultChannel: 'alpha', altChannel: 'rgb' },
  '04': { mainView: 'combined', channelKey: null },
  '05': { mainView: 'combined', channelKey: 'compareChannel', defaultChannel: 'rgb', altChannel: 'alpha' },
};
const REF_VIEW = 'reference';
const DIFF_VIEW = 'diff';
const DIFF_AMP = 2;

const DIRECT_DEMOS = quick ? ['03', '04'] : ['03', '04', '05'];
const CELLS = quick ? ['C-wide'] : Object.keys(GRID_CAMS);
const CROSS_DEMOS = ['01', '06']; // no wired reference view
const CROSS_CELLS = ['C-wide', 'S-hall'];

// mainSettle: natural convergence, no applyConfig involved -> the settle the
// task specifies (8s / halved). refSettle: used for EVERY ref-view-related
// capture (reference, diff, alt-channel) because each is its own applyConfig
// transition and each resets the oracle per the quirk above.
const mainSettle = quick ? 4000 : 8000;
const refSettle = quick ? 5000 : 10000;
const crossRefSettle = 12000; // demo 02 converged reference — not shortened even in --quick (quick skips this path)

function shotPath(demoFolder, cell, view) {
  return resolve(REPO_ROOT, `bench/results/shots/trackA/${demoFolder}/${cell}-${view}.png`);
}
function relPath(abs) {
  return abs.startsWith(REPO_ROOT) ? abs.slice(REPO_ROOT.length + 1) : abs;
}

async function main() {
  const browser = await launchBrowser();
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const rows = [];

  // --- Direct: demos 03/04/05 vs their own wired ReferencePass ---
  for (const d of DIRECT_DEMOS) {
    const cfg = DEMO_CFG[d];
    const demoFolder = DEMO_IDS[d];
    for (const cell of CELLS) {
      const { scene, cam } = GRID_CAMS[cell];

      await openDemo(page, { demo: d, scene, cam, query: {} });
      await settle(mainSettle);
      const mainFile = shotPath(demoFolder, cell, cfg.mainView);
      const mainImg = await grabContent(page, mainFile);

      await applyConfig(page, { viewMode: REF_VIEW });
      await settle(refSettle);
      const refFile = shotPath(demoFolder, cell, REF_VIEW);
      const refImg = await grabContent(page, refFile);

      await applyConfig(page, { viewMode: DIFF_VIEW, diffAmp: DIFF_AMP });
      await settle(refSettle); // full resettle — the view switch reset the oracle
      const diffFile = shotPath(demoFolder, cell, DIFF_VIEW);
      await grabContent(page, diffFile);

      let diffAltFile = '';
      if (cfg.channelKey) {
        await applyConfig(page, { [cfg.channelKey]: cfg.altChannel });
        await settle(refSettle); // full resettle again — channel change is also an applyConfig call
        const altPath = shotPath(demoFolder, cell, `${DIFF_VIEW}-${cfg.altChannel}`);
        await grabContent(page, altPath);
        diffAltFile = altPath;
      }

      const m = mse(mainImg, refImg);
      const config = await exportConfig(page);
      const comparedViews = cfg.channelKey
        ? `${cfg.mainView} (full composite) vs ${REF_VIEW} (oracle, ${cfg.defaultChannel}-scale default) — screenshot MSE; diff amp=${DIFF_AMP} at default channel=${cfg.defaultChannel}, plus a second diff capture at channel=${cfg.altChannel}`
        : `${cfg.mainView} (full composite) vs ${REF_VIEW} (oracle, AO-only) — screenshot MSE; diff amp=${DIFF_AMP}, comparator hardcoded to the AO/alpha channel (no channel param on this demo)`;

      const row = {
        demo: demoFolder, cell, mainView: cfg.mainView, mainFile: relPath(mainFile),
        refView: REF_VIEW, refFile: relPath(refFile), diffView: DIFF_VIEW, diffFile: relPath(diffFile),
        diffAltFile: diffAltFile ? relPath(diffAltFile) : '', mse: m, comparedViews,
        crossDemo: false, config: JSON.stringify(config),
      };
      rows.push(row);
      console.log(`[trackA] demo=${demoFolder} cell=${cell} mse=${m.toFixed(6)}`);
    }
  }

  // --- Cross-demo: demos 01/06 (no wired reference view) vs demo 02's own
  // converged accumulation at the same cell. Demo 02's 'combined' view IS its
  // ground-truth composite once the camera has been static long enough to
  // converge — it's the reference marcher itself, not a separate oracle. ---
  if (!quick) {
    for (const cell of CROSS_CELLS) {
      const { scene, cam } = GRID_CAMS[cell];

      await openDemo(page, { demo: '02', scene, cam, query: { view: 'combined' } });
      await settle(crossRefSettle);
      const refFile = shotPath(DEMO_IDS['02'], cell, 'combined');
      const refImg = await grabContent(page, refFile);

      for (const d of CROSS_DEMOS) {
        const demoFolder = DEMO_IDS[d];
        const mainViewName = d === '01' ? 'final' : 'combined'; // demo 01's VIEW_MODES uses 'final', not 'combined'
        await openDemo(page, { demo: d, scene, cam, query: { view: mainViewName } });
        await settle(mainSettle);
        const mainFile = shotPath(demoFolder, cell, mainViewName);
        const mainImg = await grabContent(page, mainFile);
        const m = mse(mainImg, refImg);
        const config = await exportConfig(page);
        const row = {
          demo: demoFolder, cell, mainView: mainViewName, mainFile: relPath(mainFile),
          refView: 'demo02-combined', refFile: relPath(refFile), diffView: '', diffFile: '',
          diffAltFile: '', mse: m,
          comparedViews: `${mainViewName} (own combined view) vs demo 02 combined (converged, ${crossRefSettle / 1000}s settle) — cross-demo screenshot comparison, no wired reference view on this demo`,
          crossDemo: true, config: JSON.stringify(config),
        };
        rows.push(row);
        console.log(`[trackA] CROSS demo=${demoFolder} cell=${cell} mse=${m.toFixed(6)}`);
      }
    }
  }

  await browser.close();

  const meta = {
    grid: CELLS, directDemos: DIRECT_DEMOS, crossDemos: quick ? [] : CROSS_DEMOS,
    mainSettleMs: mainSettle, refSettleMs: refSettle,
    crossRefSettleMs: quick ? null : crossRefSettle,
    caveat:
      'MSE is screenshot-space (tonemapped 8-bit RGB, [0,1]-normalized) between two ' +
      'view-mode captures of the same cam — a comparative signal across demos/cells, ' +
      'not absolute radiometric error. The main/reference views frequently render ' +
      'different quantities at different scales (reference views show the oracle ' +
      "alone — pure AO or pure GI×giExposure — while the main view is the demo's " +
      'full beauty+AO+GI composite); see comparedViews per row. diffAmp fixed at ' +
      `${DIFF_AMP} per TESTING.md.`,
    harnessQuirk:
      "buildParams().importJSON() notifies ALL schema keys on every applyConfig() " +
      "call (not just changed ones); demos 03/04/05 react to the notified " +
      "refRays/refSteps/refRadius keys by unconditionally calling refPass.reset(). " +
      "Every reference/diff/channel transition below therefore re-settles the full " +
      "reference convergence window, not a short repaint wait — see header comment.",
    ...(quick ? { note: 'quick smoke run — not a recorded number' } : {}),
  };
  const { jsonPath, mdPath } = writeResults(outName, rows, meta);
  console.log(`[trackA] wrote ${jsonPath}`);
  console.log(`[trackA] wrote ${mdPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
