// TESTING.md Track C — temporal behavior (stills + reconvergence-after-teleport).
// Demos 03 (both accumMode variants), 04, 05, 06, each at their default
// accumulation except demo 03's explicit ssrt3-ema / frame-count split.
//
// STILL: the established WORKLOG stability metric (harness.stabilityMetric),
// C-wide, main/combined view.
// RECONVERGENCE: teleport C-wide -> C-graze via the window.__cam.set(...) bench
// hook (a reproducible disocclusion event — no OrbitControls damping involved,
// the pose lands instantly), then sample every ~0.5s and find when the
// consecutive-frame diff settles back near the STILL baseline.
//
// Usage: node scripts/run-temporal.mjs [--quick] [--out <name>]

import {
  launchBrowser, openDemo, applyConfig, exportConfig, settle, grabContent,
  meanAbsDiff, stabilityMetric, writeResults, GRID_CAMS, DEMO_IDS,
} from './lib/harness.mjs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

const args = process.argv.slice(2);
const quick = args.includes('--quick');
const outIdx = args.indexOf('--out');
const outName = outIdx >= 0 ? args[outIdx + 1] : 'trackC-temporal';

const RUNS_FULL = [
  { demo: '03', mode: 'ssrt3-ema', accumMode: 'ssrt3-ema' },
  { demo: '03', mode: 'frame-count', accumMode: 'frame-count' },
  { demo: '04', mode: 'default', accumMode: null },
  { demo: '05', mode: 'default', accumMode: null },
  { demo: '06', mode: 'default', accumMode: null },
];
const RUNS_QUICK = [{ demo: '03', mode: 'ssrt3-ema', accumMode: 'ssrt3-ema' }];
const runs = quick ? RUNS_QUICK : RUNS_FULL;

const settleMs = quick ? 2000 : 6000; // stability methodology settle
const gapMs = quick ? 1000 : 2000; // stability methodology gap
const reconvWindowMs = quick ? 3000 : 8000;
const captureIntervalMs = 500;

const CAM_WIDE = GRID_CAMS['C-wide'].cam; // '0,2.4,8.8,0,2.6,0'
const CAM_GRAZE = GRID_CAMS['C-graze'].cam; // '1.4,3.6,4.6,0.95,1.3,0.7'
const GRAZE_NUMS = CAM_GRAZE.split(',').map(Number);

// Reconvergence rule (recorded here verbatim, also stamped into meta): the
// still-camera stability value establishes a noise floor; time-to-reconverge
// is the first interval whose consecutive mean-abs-diff drops to
// <= max(still * 1.5, still + 0.3) AND stays at-or-below that band for the
// following interval too (2 consecutive intervals), guarding against a single
// lucky low-diff frame pair mid-transient.
const RECONVERGE_RULE =
  'first interval index k where diff[k] <= threshold AND diff[k+1] <= threshold, ' +
  'threshold = max(still * 1.5, still + 0.3); reported time = frame[k+1].t (real ' +
  'elapsed ms since teleport, not nominal 0.5s slots).';

function tag(demo, mode) {
  return mode === 'default' ? demo : `${demo}-${mode}`;
}
function shotPath(name) {
  return resolve(REPO_ROOT, `bench/results/shots/trackC/${name}.png`);
}
function relPath(abs) {
  return abs.startsWith(REPO_ROOT) ? abs.slice(REPO_ROOT.length + 1) : abs;
}

async function main() {
  const browser = await launchBrowser();
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const rows = [];

  for (const { demo, mode, accumMode } of runs) {
    const demoFolder = DEMO_IDS[demo];
    const t = tag(demo, mode);

    await openDemo(page, { demo, scene: 'cornell', cam: CAM_WIDE, query: { view: 'combined' } });
    if (accumMode) await applyConfig(page, { accumMode });

    // STILL.
    const stillBase = resolve(REPO_ROOT, `bench/results/shots/trackC/${t}-still`);
    const still = await stabilityMetric(page, { settleMs, gapMs, saveAs: stillBase });
    console.log(`[trackC] demo=${demoFolder} mode=${mode} still=${still.toFixed(4)}`);

    // RECONVERGENCE: teleport C-wide -> C-graze in place (continues the same
    // accumulation state — this IS the disocclusion event under test).
    await page.evaluate(
      (nums) => window.__cam.set(nums[0], nums[1], nums[2], nums[3], nums[4], nums[5]),
      GRAZE_NUMS,
    );
    const t0 = Date.now();
    const frames = [];
    while (Date.now() - t0 < reconvWindowMs) {
      const elapsedS = (Date.now() - t0) / 1000;
      const path = shotPath(`${t}-reconv-${elapsedS.toFixed(2)}`);
      const img = await grabContent(page, path);
      frames.push({ t: elapsedS, file: relPath(path), img });
      await settle(captureIntervalMs);
    }

    const diffs = [];
    for (let i = 0; i < frames.length - 1; i++) {
      diffs.push({ t: frames[i + 1].t, diff: meanAbsDiff(frames[i].img, frames[i + 1].img) });
    }
    const threshold = Math.max(still * 1.5, still + 0.3);
    let reconvergeSeconds = null;
    for (let k = 0; k < diffs.length - 1; k++) {
      if (diffs[k].diff <= threshold && diffs[k + 1].diff <= threshold) {
        reconvergeSeconds = diffs[k + 1].t;
        break;
      }
    }
    console.log(
      `[trackC] demo=${demoFolder} mode=${mode} reconverge=${reconvergeSeconds ?? `>${(reconvWindowMs / 1000).toFixed(1)}s (not reached)`} ` +
        `threshold=${threshold.toFixed(4)}`,
    );

    // Teleport back to C-wide before the next run reuses this page (each run
    // re-navigates via openDemo anyway, but keep state tidy just in case).
    const config = await exportConfig(page);
    rows.push({
      demo: demoFolder,
      mode,
      still,
      reconvergeSeconds: reconvergeSeconds ?? '',
      reconverged: reconvergeSeconds !== null,
      threshold,
      frameCount: frames.length,
      diffsJson: JSON.stringify(diffs.map((d) => ({ t: +d.t.toFixed(3), diff: +d.diff.toFixed(4) }))),
      files: frames.map((f) => f.file).join(';'),
      config: JSON.stringify(config),
    });
  }

  await browser.close();

  const meta = {
    camWide: CAM_WIDE, camGraze: CAM_GRAZE,
    stillMethodology: `settleMs=${settleMs}, gapMs=${gapMs} (WORKLOG 2026-07-18 methodology${quick ? ', halved for --quick' : ''})`,
    reconvWindowMs, captureIntervalMs,
    reconvergeRule: RECONVERGE_RULE,
    timingNote:
      'consecutive captures use settle(500) between grabContent() calls; actual cadence ' +
      'drifts with screenshot cost, so each frame is timestamped with Date.now() and the ' +
      'reconvergence calc uses real elapsed seconds, not nominal 0.5s slots.',
    cameraNote:
      'window.__cam.set(...) calls controls.update() once with no OrbitControls damping — ' +
      'poses land instantly; no extra motion is injected around the teleport.',
    ghostingNote: 'Ghosting/smear is a visual judgment — frames are saved under bench/results/shots/trackC/ for human review, not scored here.',
    ...(quick ? { note: 'quick smoke run — not a recorded number' } : {}),
  };
  const { jsonPath, mdPath } = writeResults(outName, rows, meta);
  console.log(`[trackC] wrote ${jsonPath}`);
  console.log(`[trackC] wrote ${mdPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
