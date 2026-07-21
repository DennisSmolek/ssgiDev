// Lab 08 — distant-light method + thickness heuristic spot-check captures
// (bench/src/demos/08-distant-light). Screenshot grid: each distant-light
// method at default thickness, plus each thickness heuristic at the default
// method, on cornell + artifact-zoo. No metrics — visual spot-check manifest
// (see README for the quantitative cost tables / quality findings).
//
// Usage: node scripts/run-08.mjs [--quick] [--out <name>]

import { launchBrowser, openDemo, settle, grabContent, exportConfig, writeResults } from './lib/harness.mjs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

const args = process.argv.slice(2);
const quick = args.includes('--quick');
const outIdx = args.indexOf('--out');
const outName = outIdx >= 0 ? args[outIdx + 1] : 'lab08-shots';

const METHODS = ['ottosson-perbin', 'salm-caps', 'flat-fallback'];
const HEURISTICS = ['constant', 'linear-dist', 'ottosson-3clGWB', 'light-occluder-wcBGRz'];
const SCENES = ['cornell', 'artifact-zoo'];
const settleMs = quick ? 2000 : 6000;

const methods = quick ? METHODS.slice(0, 1) : METHODS;
const heuristics = quick ? HEURISTICS.slice(0, 1) : HEURISTICS;
const scenes = quick ? SCENES.slice(0, 1) : SCENES;

async function main() {
  const browser = await launchBrowser();
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const rows = [];

  const capture = async (axis, value, scene, query) => {
    await openDemo(page, { demo: '08', scene, query }); // default cam
    await settle(settleMs);
    const path = resolve(REPO_ROOT, `bench/results/shots/lab08/${axis}-${value}-${scene}.png`);
    await grabContent(page, path);
    const config = await exportConfig(page);
    rows.push({ axis, value, scene, file: `bench/results/shots/lab08/${axis}-${value}-${scene}.png`, config: JSON.stringify(config) });
    console.log(`[lab08] ${axis}=${value} scene=${scene} -> ${path}`);
  };

  // Method axis, default thickness (schema default 0.5), default heuristic.
  for (const method of methods) {
    for (const scene of scenes) {
      await capture('method', method, scene, { method });
    }
  }
  // Heuristic axis, default method.
  for (const heuristic of heuristics) {
    for (const scene of scenes) {
      await capture('heuristic', heuristic, scene, { heuristic });
    }
  }

  await browser.close();

  const meta = {
    settleMs,
    ...(quick ? { note: 'quick smoke run — not a recorded number' } : {}),
  };
  const { jsonPath, mdPath } = writeResults(outName, rows, meta);
  console.log(`[lab08] wrote ${jsonPath}`);
  console.log(`[lab08] wrote ${mdPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
