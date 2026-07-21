// Lab 10 — denoise stack comparison (bench/src/demos/10-denoise).
// Stability metric (WORKLOG methodology) per stack, combined + gi views, plus
// two demo-03 cross-reference rows (accumMode ssrt3-ema / frame-count).
//
// Usage: node scripts/run-10.mjs [--quick] [--out <name>]

import {
  launchBrowser, openDemo, applyConfig, exportConfig, stabilityMetric,
  writeResults, BASE_URL,
} from './lib/harness.mjs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

const args = process.argv.slice(2);
const quick = args.includes('--quick');
const outIdx = args.indexOf('--out');
const outName = outIdx >= 0 ? args[outIdx + 1] : 'lab10-stability';

const STACKS = ['none', 'ssrt3', 'mathis', 'xegtao', 'denoise-node'];
const CAM = '0,2.4,8.8,0,2.6,0';
const settleMs = quick ? 2000 : 6000;
const gapMs = quick ? 1000 : 2000;
const stacksToRun = quick ? STACKS.slice(0, 1) : STACKS;

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

  await browser.close();

  const meta = {
    settleMs, gapMs, cam: CAM, scene: 'cornell',
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
