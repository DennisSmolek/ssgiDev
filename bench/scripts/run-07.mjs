// Lab 07 — ambient-fallback spot-check captures (bench/src/demos/07-ambient-lab).
// Screenshot grid: ambient source A/B/C x fallback on/off. No metrics — this is
// a visual spot-check manifest (see README §3.2 findings for the quality read).
//
// Usage: node scripts/run-07.mjs [--quick] [--out <name>]

import { launchBrowser, openDemo, settle, grabContent, exportConfig, writeResults } from './lib/harness.mjs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

const args = process.argv.slice(2);
const quick = args.includes('--quick');
const outIdx = args.indexOf('--out');
const outName = outIdx >= 0 ? args[outIdx + 1] : 'lab07-shots';

const SOURCES = ['A', 'B', 'C'];
const FALLBACKS = [true, false];
const CAM = '1.4,3.6,4.6,0.95,1.3,0.7';
const settleMs = quick ? 2000 : 6000;
const sources = quick ? SOURCES.slice(0, 1) : SOURCES;

async function main() {
  const browser = await launchBrowser();
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const rows = [];

  for (const src of sources) {
    for (const fallback of FALLBACKS) {
      await openDemo(page, {
        demo: '07', scene: 'cornell', cam: CAM,
        query: { src, fallback: fallback ? '1' : '0' },
      });
      await settle(settleMs);
      const fbLabel = fallback ? 'on' : 'off';
      const path = resolve(REPO_ROOT, `bench/results/shots/lab07/${src}-${fbLabel}.png`);
      await grabContent(page, path);
      const config = await exportConfig(page);
      rows.push({ src, fallback: fbLabel, file: `bench/results/shots/lab07/${src}-${fbLabel}.png`, config: JSON.stringify(config) });
      console.log(`[lab07] src=${src} fallback=${fbLabel} -> ${path}`);
    }
  }

  await browser.close();

  const meta = {
    scene: 'cornell', cam: CAM, settleMs,
    ...(quick ? { note: 'quick smoke run — not a recorded number' } : {}),
  };
  const { jsonPath, mdPath } = writeResults(outName, rows, meta);
  console.log(`[lab07] wrote ${jsonPath}`);
  console.log(`[lab07] wrote ${mdPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
