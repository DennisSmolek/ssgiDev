// Lab 11 — sampling/noise comparison (bench/src/demos/11-sampling).
// Offline readback MSE via window.__lab11.measure(): converges a GT-VBAO
// self-reference (white noise, truthFrames) then reports each noise's MSE at
// each of `frames` against it, plus a frame-to-frame shimmer metric.
//
// Usage: node scripts/run-11.mjs [--quick] [--out <name>]

import { launchBrowser, openDemo, exportConfig, writeResults } from './lib/harness.mjs';

const args = process.argv.slice(2);
const quick = args.includes('--quick');
const outIdx = args.indexOf('--out');
const outName = outIdx >= 0 ? args[outIdx + 1] : 'lab11-noise-mse';

// Full methodology: default measure() opts (frames [8,32,128], truthFrames 512,
// matches the README's converged findings table). --quick shrinks both so the
// smoke run finishes fast; the resulting numbers are not comparable to WORKLOG.
const measureOpts = quick ? { frames: [4], truthFrames: 16 } : undefined;

async function main() {
  const browser = await launchBrowser();
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

  // Default cam (source doesn't dictate an override for this lab); cornell scene.
  await openDemo(page, { demo: '11', scene: 'cornell', query: { view: 'combined' } });

  // __lab11 attaches only after the blue-noise atlas finishes loading async.
  await page.waitForFunction(() => typeof window.__lab11?.measure === 'function', undefined, {
    timeout: 30_000,
  });

  console.log(`[lab11] measuring (opts=${measureOpts ? JSON.stringify(measureOpts) : 'defaults'})...`);
  // measure() freezes the demo's rAF loop for its duration (the `measuring`
  // guard in the demo) — without it, live-loop dispatches land inside
  // measure's readback awaits and clear/pollute every count after the first
  // (seen 2026-07-21: clean mse8, polluted mse24/32/48, batch hit varying by
  // run — the await-window race signature).
  const json = await page.evaluate((opts) => window.__lab11.measure(opts), measureOpts);
  const result = JSON.parse(json);
  console.log(`[lab11] LAB11_MSE ${json}`);

  const config = await exportConfig(page);
  const rows = [];
  for (const noise of Object.keys(result.mse)) {
    const perFrame = result.mse[noise];
    const row = { noise };
    for (const f of result.frames) row[`mse${f}`] = perFrame[String(f)] ?? perFrame[f];
    row.shimmer = result.shimmer[noise];
    rows.push(row);
    console.log(`[lab11] noise=${noise} ${JSON.stringify(row)}`);
  }

  await browser.close();

  const meta = {
    scene: 'cornell',
    truthFrames: result.truthFrames,
    frames: result.frames,
    config: JSON.stringify(config),
    ...(quick ? { note: 'quick smoke run — not a recorded number' } : {}),
  };
  const { jsonPath, mdPath } = writeResults(outName, rows, meta);
  console.log(`[lab11] wrote ${jsonPath}`);
  console.log(`[lab11] wrote ${mdPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
