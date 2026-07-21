// Lab 10 — denoise stack comparison (bench/src/demos/10-denoise).
// Stability metric (WORKLOG methodology) per stack, combined + gi views, plus
// two demo-03 cross-reference rows (accumMode ssrt3-ema / frame-count).
//
// Usage: node scripts/run-10.mjs [--quick] [--out <name>]

import {
  launchBrowser, openDemo, applyConfig, exportConfig, stabilityMetric,
  settle, grabContent, meanAbsDiff, writeResults, GRID_CAMS, BASE_URL,
} from './lib/harness.mjs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

const args = process.argv.slice(2);
const quick = args.includes('--quick');
const outIdx = args.indexOf('--out');
const outName = outIdx >= 0 ? args[outIdx + 1] : 'lab10-stability';

// ssrt3-guides is the NEXTGEN P2 A/B: same EMA temporal, history validity fed by
// the shared TemporalGuidesPass instead of the ema fork's private world-pos test.
const STACKS = ['none', 'ssrt3', 'ssrt3-guides', 'mathis', 'xegtao', 'denoise-node'];
const CAM = '0,2.4,8.8,0,2.6,0';
const settleMs = quick ? 2000 : 6000;
const gapMs = quick ? 1000 : 2000;
const stacksToRun = quick ? STACKS.slice(0, 1) : STACKS;

// Teleport reconvergence A/B (ssrt3 vs ssrt3-guides ONLY): still-camera baseline,
// then a C-wide -> C-graze pose jump (a reproducible disocclusion event, no
// OrbitControls damping) via window.__cam.set, then time-to-reconverge. The
// claim under test: (1) ssrt3-guides still-stability <= ssrt3; (2) after the
// teleport ssrt3-guides reconverges without the ghost-trail the private
// world-pos test allows — visual frames saved for human judgment.
const RECONVERGE_STACKS = ['ssrt3', 'ssrt3-guides'];
const CAM_WIDE = GRID_CAMS['C-wide'].cam;   // '0,2.4,8.8,0,2.6,0'
const CAM_GRAZE = GRID_CAMS['C-graze'].cam; // '1.4,3.6,4.6,0.95,1.3,0.7'
const GRAZE_NUMS = CAM_GRAZE.split(',').map(Number);
const reconvWindowMs = quick ? 3000 : 8000;
const captureIntervalMs = 500;
// Same rule as run-temporal.mjs: first interval k where diff[k] and diff[k+1]
// both drop to <= max(still*1.5, still+0.3) (2 consecutive, guards a lucky pair).
const RECONVERGE_RULE =
  'first k where diff[k] <= threshold AND diff[k+1] <= threshold, ' +
  'threshold = max(still*1.5, still+0.3); reported = frame[k+1].t (real elapsed s).';

async function main() {
  const browser = await launchBrowser();
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const rows = [];

  for (const stack of stacksToRun) {
    await openDemo(page, {
      demo: '10', scene: 'cornell', cam: CAM,
      query: { view: 'combined', stack },
    });
    const shotBase = resolve(REPO_ROOT, `bench/results/shots/lab10/${stack}/combined`);
    const stability = await stabilityMetric(page, { settleMs, gapMs, saveAs: shotBase });
    const config = await exportConfig(page);
    rows.push({ demo: '10-denoise', stack, view: 'combined', stability, config: JSON.stringify(config) });
    console.log(`[lab10] stack=${stack} view=combined stability=${stability.toFixed(4)}`);

    // Second screenshot pair for the gi view (per DELIVERABLE 1).
    await openDemo(page, {
      demo: '10', scene: 'cornell', cam: CAM,
      query: { view: 'gi', stack },
    });
    const giShotBase = resolve(REPO_ROOT, `bench/results/shots/lab10/${stack}/gi`);
    const giStability = await stabilityMetric(page, { settleMs, gapMs, saveAs: giShotBase });
    const giConfig = await exportConfig(page);
    rows.push({ demo: '10-denoise', stack, view: 'gi', stability: giStability, config: JSON.stringify(giConfig) });
    console.log(`[lab10] stack=${stack} view=gi stability=${giStability.toFixed(4)}`);
  }

  // Cross-reference rows: demo 03, view=gi, same cam, accumMode ssrt3-ema / frame-count.
  // Expected ballpark (WORKLOG): ssrt3-ema ~3.38, frame-count ~0.83.
  const accumModes = quick ? ['ssrt3-ema'] : ['ssrt3-ema', 'frame-count'];
  const offRatios = [];
  for (const accumMode of accumModes) {
    await openDemo(page, { demo: '03', scene: 'cornell', cam: CAM, query: { view: 'gi' } });
    await applyConfig(page, { accumMode });
    const stability = await stabilityMetric(page, { settleMs, gapMs });
    const config = await exportConfig(page);
    rows.push({ demo: '03-ssrt3', stack: `accumMode=${accumMode}`, view: 'gi', stability, config: JSON.stringify(config) });
    console.log(`[lab10] demo03 accumMode=${accumMode} view=gi stability=${stability.toFixed(4)}`);
    const expected = accumMode === 'ssrt3-ema' ? 3.38 : 0.83;
    const ratio = stability / expected;
    if (ratio > 3 || ratio < 1 / 3) {
      offRatios.push(`accumMode=${accumMode}: measured ${stability.toFixed(4)} vs expected ~${expected} (${ratio.toFixed(2)}x)`);
    }
  }

  // Teleport reconvergence A/B: ssrt3 vs ssrt3-guides (the P2 acceptance test).
  const reconvRows = [];
  for (const stack of RECONVERGE_STACKS) {
    await openDemo(page, {
      demo: '10', scene: 'cornell', cam: CAM_WIDE, query: { view: 'combined', stack },
    });
    const stillBase = resolve(REPO_ROOT, `bench/results/shots/lab10/${stack}/reconv-still`);
    const still = await stabilityMetric(page, { settleMs, gapMs, saveAs: stillBase });

    // Teleport in place — continues the same accumulation state (the disocclusion
    // event under test), no extra motion injected.
    await page.evaluate(
      (nums) => window.__cam.set(nums[0], nums[1], nums[2], nums[3], nums[4], nums[5]),
      GRAZE_NUMS,
    );
    const t0 = Date.now();
    const frames = [];
    while (Date.now() - t0 < reconvWindowMs) {
      const elapsedS = (Date.now() - t0) / 1000;
      const shot = resolve(REPO_ROOT, `bench/results/shots/lab10/${stack}/reconv-${elapsedS.toFixed(2)}.png`);
      const img = await grabContent(page, shot);
      frames.push({ t: elapsedS, img });
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
    const config = await exportConfig(page);
    reconvRows.push({
      demo: '10-denoise', stack, view: 'reconv', stability: still,
      reconvergeSeconds: reconvergeSeconds ?? '',
      reconverged: reconvergeSeconds !== null, threshold,
      diffsJson: JSON.stringify(diffs.map((d) => ({ t: +d.t.toFixed(3), diff: +d.diff.toFixed(4) }))),
      config: JSON.stringify(config),
    });
    console.log(
      `[lab10] reconv stack=${stack} still=${still.toFixed(4)} ` +
        `reconverge=${reconvergeSeconds ?? `>${(reconvWindowMs / 1000).toFixed(1)}s (not reached)`} threshold=${threshold.toFixed(4)}`,
    );
  }
  rows.push(...reconvRows);

  await browser.close();

  const meta = {
    settleMs, gapMs, cam: CAM, scene: 'cornell',
    reconvergence: {
      stacks: RECONVERGE_STACKS, camWide: CAM_WIDE, camGraze: CAM_GRAZE,
      reconvWindowMs, captureIntervalMs, rule: RECONVERGE_RULE,
      note: 'ghosting/smear is a visual judgment — reconv frames saved under bench/results/shots/lab10/<stack>/ for human review, not scored here.',
    },
    ...(quick ? { note: 'quick smoke run — not a recorded number' } : {}),
    ...(offRatios.length ? { crossRefWarning: offRatios } : {}),
  };
  const { jsonPath, mdPath } = writeResults(outName, rows, meta);
  console.log(`[lab10] wrote ${jsonPath}`);
  console.log(`[lab10] wrote ${mdPath}`);
  if (offRatios.length) {
    console.warn(`[lab10] WARNING cross-reference numbers off from WORKLOG ballpark:\n  ${offRatios.join('\n  ')}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
