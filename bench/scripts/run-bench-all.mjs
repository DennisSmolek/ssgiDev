// TESTING.md Track B — the cross-demo perf BUDGET MAP.
//
// For each demo in [01,02,03,04,05,06] x grid cell {C-wide, S-hall} x config
// {default, heavy}, drives the demo's fenced GPU bench hook and emits one row
// per pass entry. The hooks (installed at demo init) all share the shape
//   window.__benchNN = { [passName]: (n) => Promise<avgMsPerIter> }
// and fence internally on queue.onSubmittedWorkDone (lab 09 methodology: min of
// paired bursts ~= least-throttled ~= true GPU cost; ratios are the robust
// signal, absolutes drift +-15% with thermals). Demo 03 predates the object
// shape and exposes a single function window.__ssrt3bench(n) — used here as its
// `total` (that hook is the compute chain only: lightmask+[pyramid]+main+
// temporal+copydepth+denoise, G-buffer/display excluded).
//
// `total` semantics differ by demo (documented in meta.totalSemantics):
//   01      = full TSL pipeline render (G-buffer+SSGI+SSR+post+composite) — the
//             stock-three graph can't be split, so total is the only entry.
//   02/04/05= the raw SSGI pass only (== accumFrame / march; G-buffer cost
//             belongs to demo 00, display is TSL and skips under render-list
//             caching — see __bench01's comment).
//   03      = compute chain only (grandfathered __ssrt3bench).
//   06      = the source->march->accum->gcopy->compose pass chain.
//
// Burst policy: default 3x40. Any entry measuring slower than ~20 ms/iter on a
// probe burst drops to 3x10 to keep wall-time sane (demo 02's accumFrame is the
// usual trigger). Actual bursts+iters are recorded per row. --quick = first
// cell, default config only, 1x10 bursts, and a meta.note flagging it as a
// non-recorded smoke run.
//
// Run: node scripts/run-bench-all.mjs [--quick] [--out <name>]

import {
  launchBrowser,
  openDemo,
  applyConfig,
  exportConfig,
  settle,
  minOfBursts,
  writeResults,
  GRID_CAMS,
} from './lib/harness.mjs';

const argv = process.argv.slice(2);
const quick = argv.includes('--quick');
const outIdx = argv.indexOf('--out');
const outName = outIdx !== -1 ? argv[outIdx + 1] : 'trackB-budget';

// Budget-map grid: C-wide (overall GI/AO) + S-hall (long-range/bandwidth).
const CELL_IDS = ['C-wide', 'S-hall'];
const cells = (quick ? CELL_IDS.slice(0, 1) : CELL_IDS).map((id) => ({ id, ...GRID_CAMS[id] }));

// Per-demo bench-hook global + heavy-config knobs. Heavy raises the analogous
// quality-raising knobs per demo:
//   03: rotationCount 4 / stepCount 32 (the TESTING.md-specified rc4/sc32).
//   04/05: slicesPerFrame 4 / stepsPerSlice 64 — the slice/step knobs are the
//          direct analogues of rc/sc (total march samples ~ slices*steps).
//   06: slices 8 / steps 64 — SSHGI's horizon-slice + steps-per-horizon knobs.
//   01/02: no meaningful heavy knob for the SSGI cost we measure (01 is the
//          fixed stock pipeline; 02 is the brute-force oracle whose rays/steps
//          are a convergence-speed dial, not a per-frame-cost quality tier), so
//          default-only.
const DEMOS = {
  '01': { hook: '__bench01', single: false, heavy: null },
  '02': { hook: '__bench02', single: false, heavy: null },
  '03': { hook: '__ssrt3bench', single: true, heavy: { rotationCount: 4, stepCount: 32 } },
  '04': { hook: '__bench04', single: false, heavy: { slicesPerFrame: 4, stepsPerSlice: 64 } },
  '05': { hook: '__bench05', single: false, heavy: { slicesPerFrame: 4, stepsPerSlice: 64 } },
  '06': { hook: '__bench06', single: false, heavy: { slices: 8, steps: 64 } },
};
const DEMO_ORDER = ['01', '02', '03', '04', '05', '06'];

// Runs one hook entry for `iters` iterations (avg ms/iter) inside the page.
function makeRunEntry(page, hook, pass, single) {
  return (iters) =>
    page.evaluate(
      ([h, p, s, n]) => {
        const fn = s ? window[h] : window[h]?.[p];
        return fn(n);
      },
      [hook, pass, single, iters],
    );
}

// Adaptive burst measurement. quick -> single 1x10. Otherwise probe one 10-iter
// burst to classify fast/slow, then min of 3 bursts at 40 (fast) or 10 (slow).
async function measure(runEntry) {
  if (quick) {
    const ms = await runEntry(10);
    return { ms, bursts: 1, iters: 10 };
  }
  const probe = await runEntry(10); // classify, then discard
  const iters = probe > 20 ? 10 : 40;
  await settle(60);
  const ms = await minOfBursts((n) => runEntry(n), { bursts: 3, iters });
  return { ms, bursts: 3, iters };
}

const browser = await launchBrowser();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on('pageerror', (e) => console.error(`[pageerror] ${e.message}`));

const rows = [];

for (const demoKey of DEMO_ORDER) {
  const spec = DEMOS[demoKey];
  for (const cell of cells) {
    await openDemo(page, { demo: demoKey, scene: cell.scene, cam: cell.cam ?? undefined });
    await settle(2000); // pipeline warm-up + a few accumulation frames

    const entryNames = await page.evaluate(
      ([h, s]) => {
        if (s) return ['total'];
        const obj = window[h];
        return obj ? Object.keys(obj) : [];
      },
      [spec.hook, spec.single],
    );
    if (entryNames.length === 0) {
      console.error(`[${demoKey}] ${cell.id}: no bench hook found on window.${spec.hook}`);
      continue;
    }

    const configList = [{ name: 'default', knobs: null }];
    if (spec.heavy && !quick) configList.push({ name: 'heavy', knobs: spec.heavy });

    for (const cfg of configList) {
      if (cfg.knobs) {
        await applyConfig(page, cfg.knobs);
        await settle(500); // let the param change + accumulation reset settle
      }
      const exported = await exportConfig(page); // ground truth, not the intent
      const configJSON = JSON.stringify(exported);

      for (const pass of entryNames) {
        const runEntry = makeRunEntry(page, spec.hook, pass, spec.single);
        const { ms, bursts, iters } = await measure(runEntry);
        await settle(80);

        const row = {
          demo: demoKey,
          cell: cell.id,
          scene: cell.scene,
          cfg: cfg.name,
          pass,
          ms,
          bursts,
          iters,
          config: configJSON, // repro stamp (kept in .json, stripped from .md)
        };
        rows.push(row);
        console.log(
          `[${demoKey}] ${cell.id}/${cfg.name} ${pass} -> ${ms.toFixed(3)}ms (${bursts}x${iters})`,
        );
      }
    }
  }
}

await browser.close();

const meta = {
  viewport: '1280x800',
  cells: cells.map((c) => c.id).join(', '),
  demos: DEMO_ORDER.join(', '),
  heavyConfigs: {
    '01': 'default-only (fixed stock TSL pipeline)',
    '02': 'default-only (brute-force oracle; rays/steps are a convergence dial)',
    '03': 'rotationCount 4 / stepCount 32 (rc4/sc32)',
    '04': 'slicesPerFrame 4 / stepsPerSlice 64',
    '05': 'slicesPerFrame 4 / stepsPerSlice 64',
    '06': 'slices 8 / steps 64',
  },
  totalSemantics: {
    '01': 'full TSL pipeline render (Gbuffer+SSGI+SSR+post+composite) — UNDER-REPORTS: TSL FRAME-node render-list caching under the live rAF loop means extra same-frame renders skip the gated effect passes; read the live gpu-ms for demo 01 (see __bench01 comment)',
    '02': 'single reference march pass (== accumFrame; the demo\'s whole SSGI work)',
    '03': 'compute chain only (grandfathered __ssrt3bench)',
    '04': 'single VBAO march pass (== march; the demo\'s whole SSGI work)',
    '05': 'single VBGI march pass (== march; the demo\'s whole SSGI work)',
    '06': 'source->march->accum->gcopy->compose raw-pass chain',
  },
  burstPolicy: 'default 3x40; entries slower than ~20ms/iter drop to 3x10 (per-row iters recorded)',
  ...(quick ? { note: 'quick smoke run — not a recorded number' } : {}),
};
const { jsonPath, mdPath } = writeResults(outName, rows, meta);
console.log(`wrote ${jsonPath}`);
console.log(`wrote ${mdPath}`);
