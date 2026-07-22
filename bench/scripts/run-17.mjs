// Demo 17 — guides-source A/B lab (bench/src/demos/17-guides-ab). The FSR3
// upscaler M6 exit criterion: the SAME SSGI temporal stack fed by (A) the
// bench's private TemporalGuidesPass vs (B) the FSR3 upscaler's guides bundle.
// Stability metric (WORKLOG methodology) per arm, combined view, plus a
// teleport reconvergence A/B — cloned from run-10.mjs's protocol for the
// analogous ssrt3 vs ssrt3-guides comparison.
//
// Usage: node scripts/run-17.mjs [--quick] [--out <name>]
//
// DO NOT run this against a busy GPU — see TESTING.md / harness.mjs header.
// Recorded numbers from a contended GPU are meaningless.

import {
  launchBrowser, openDemo, applyConfig, exportConfig, stabilityMetric,
  settle, grabContent, meanAbsDiff, writeResults, GRID_CAMS,
} from './lib/harness.mjs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

const args = process.argv.slice(2);
const quick = args.includes('--quick');
const outIdx = args.indexOf('--out');
const outName = outIdx >= 0 ? args[outIdx + 1] : 'lab17-guides-ab';

// The M6 A/B: same guides-ab-temporal.wgsl + bilateral, history validity fed
// by the private TemporalGuidesPass vs the FSR3 upscaler's guides bundle.
const STACKS = ['private-guides', 'fsr-guides'];
const CAM = '0,2.4,8.8,0,2.6,0';
const settleMs = quick ? 2000 : 6000;
const gapMs = quick ? 1000 : 2000;
const stacksToRun = quick ? STACKS.slice(0, 1) : STACKS;

// Teleport reconvergence A/B: still-camera baseline, then a C-wide -> C-graze
// pose jump (a reproducible disocclusion event, no OrbitControls damping) via
// window.__cam.set, then time-to-reconverge. The claim under test: the FSR
// guides arm reconverges at least as fast as the private-guides arm, with no
// worse ghost-trail (visual judgment from the saved frames) — the M6 bar.
const CAM_WIDE = GRID_CAMS['C-wide'].cam; // '0,2.4,8.8,0,2.6,0'
const CAM_GRAZE = GRID_CAMS['C-graze'].cam; // '1.4,3.6,4.6,0.95,1.3,0.7'
const GRAZE_NUMS = CAM_GRAZE.split(',').map(Number);
const reconvWindowMs = quick ? 3000 : 8000;
const captureIntervalMs = 500;
// Same rule as run-10.mjs / run-temporal.mjs: first interval k where diff[k]
// and diff[k+1] both drop to <= max(still*1.5, still+0.3) (2 consecutive,
// guards a lucky pair).
const RECONVERGE_RULE =
  'first k where diff[k] <= threshold AND diff[k+1] <= threshold, ' +
  'threshold = max(still*1.5, still+0.3); reported = frame[k+1].t (real elapsed s).';

async function main() {
  const browser = await launchBrowser();
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const rows = [];

  for (const stack of stacksToRun) {
    await openDemo(page, {
      demo: '17', scene: 'cornell', cam: CAM,
      query: { view: 'combined', stack },
    });
    const shotBase = resolve(REPO_ROOT, `bench/results/shots/lab17/${stack}/combined`);
    const stability = await stabilityMetric(page, { settleMs, gapMs, saveAs: shotBase });
    const config = await exportConfig(page);
    rows.push({ demo: '17-guides-ab', stack, view: 'combined', stability, config: JSON.stringify(config) });
    console.log(`[lab17] stack=${stack} view=combined stability=${stability.toFixed(4)}`);

    // Second screenshot pair for the guides debug view (R=disocc, B=|vel|).
    await openDemo(page, {
      demo: '17', scene: 'cornell', cam: CAM,
      query: { view: 'guides', stack },
    });
    const guidesShotBase = resolve(REPO_ROOT, `bench/results/shots/lab17/${stack}/guides`);
    const guidesStability = await stabilityMetric(page, { settleMs, gapMs, saveAs: guidesShotBase });
    const guidesConfig = await exportConfig(page);
    rows.push({ demo: '17-guides-ab', stack, view: 'guides', stability: guidesStability, config: JSON.stringify(guidesConfig) });
    console.log(`[lab17] stack=${stack} view=guides stability=${guidesStability.toFixed(4)}`);
  }

  // Teleport reconvergence A/B.
  const reconvRows = [];
  for (const stack of STACKS) {
    await openDemo(page, {
      demo: '17', scene: 'cornell', cam: CAM_WIDE, query: { view: 'combined', stack },
    });
    const stillBase = resolve(REPO_ROOT, `bench/results/shots/lab17/${stack}/reconv-still`);
    const still = await stabilityMetric(page, { settleMs, gapMs, saveAs: stillBase });

    // Teleport in place — continues the same accumulation state (the
    // disocclusion event under test), no extra motion injected.
    await page.evaluate(
      (nums) => window.__cam.set(nums[0], nums[1], nums[2], nums[3], nums[4], nums[5]),
      GRAZE_NUMS,
    );
    const t0 = Date.now();
    const frames = [];
    while (Date.now() - t0 < reconvWindowMs) {
      const elapsedS = (Date.now() - t0) / 1000;
      const shot = resolve(REPO_ROOT, `bench/results/shots/lab17/${stack}/reconv-${elapsedS.toFixed(2)}.png`);
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
      demo: '17-guides-ab', stack, view: 'reconv', stability: still,
      reconvergeSeconds: reconvergeSeconds ?? '',
      reconverged: reconvergeSeconds !== null, threshold,
      diffsJson: JSON.stringify(diffs.map((d) => ({ t: +d.t.toFixed(3), diff: +d.diff.toFixed(4) }))),
      config: JSON.stringify(config),
    });
    console.log(
      `[lab17] reconv stack=${stack} still=${still.toFixed(4)} ` +
        `reconverge=${reconvergeSeconds ?? `>${(reconvWindowMs / 1000).toFixed(1)}s (not reached)`} threshold=${threshold.toFixed(4)}`,
    );
  }
  rows.push(...reconvRows);

  await browser.close();

  const meta = {
    settleMs, gapMs, cam: CAM, scene: 'cornell',
    m6: 'the FSR3 upscaler guides API drops @experimental when this A/B (fsr-guides matches or beats private-guides) passes — see GUIDES-HANDOFF.md.',
    reconvergence: {
      stacks: STACKS, camWide: CAM_WIDE, camGraze: CAM_GRAZE,
      reconvWindowMs, captureIntervalMs, rule: RECONVERGE_RULE,
      note: 'ghosting/smear is a visual judgment — reconv frames saved under bench/results/shots/lab17/<stack>/ for human review, not scored here.',
    },
    ...(quick ? { note: 'quick smoke run — not a recorded number' } : {}),
  };
  const { jsonPath, mdPath } = writeResults(outName, rows, meta);
  console.log(`[lab17] wrote ${jsonPath}`);
  console.log(`[lab17] wrote ${mdPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
