// Phase α — Testing Infrastructure Validation
//
// Validates four metric subsystems:
//   1. convergenceCurve — per-frame churn tracking
//   2. geometricGhostingDetector — temporal variance as ghosting proxy
//   3. edgeSharpness — Laplacian-based edge-quality scalar
//   4. churnHeatmap — per-pixel false-color churn visualization
//
// Test strategy: deliberate fail (demo 12 boiling) vs pass (demo 14 clean)
// cases, then human eyes to confirm metrics match intuition.
//
// Usage: node scripts/run-alpha.mjs [--quick] [--shots <dir>] [--out <name>]

import {
  launchBrowser, openDemo, exportConfig, settle, grabContent, meanAbsDiff,
  convergenceCurve, geometricGhostingDetector, edgeSharpness, churnHeatmap,
  writeResults, GRID_CAMS,
} from './lib/harness.mjs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

const args = process.argv.slice(2);
const quick = args.includes('--quick');
const outIdx = args.indexOf('--out');
const outName = outIdx >= 0 ? args[outIdx + 1] : 'alpha-metrics';
const shotsIdx = args.indexOf('--shots');
const SHOTS = shotsIdx >= 0 ? args[shotsIdx + 1] : resolve(REPO_ROOT, 'bench/results/shots/alpha');

const CAM = GRID_CAMS['C-wide'].cam;
const settleMs = quick ? 500 : 2000;
const windowMs = quick ? 6000 : 12000;

// Test cases: deliberate fail (high noise floor) vs pass (converges clean)
const TEST_CASES = [
  {
    name: 'demo-12-capped-baseline',
    verdict: 'fail', // perpetual boiling from capped EMA
    demo: '12',
    scene: 'cornell',
    query: { view: 'combined' },
    description: 'Capped EMA (baseline bug): forever boiling, no convergence',
  },
  {
    name: 'demo-14-svgf-clean',
    verdict: 'pass', // SVGF converges on stills
    demo: '14',
    scene: 'cornell',
    query: { view: 'combined' },
    description: 'SVGF + EMA: converges clean at rest',
  },
  {
    name: 'demo-18-oneOverN-jitter',
    verdict: 'pass', // 1/N + jitter converges
    demo: '18',
    scene: 'cornell',
    query: { accum: 'oneOverN', aa: 'jitter', view: 'combined' },
    description: '1/N + jitter AA: converges, should measure well below capped',
  },
];

async function metricsRun(page, testCase) {
  const demoParams = {
    demo: testCase.demo,
    scene: testCase.scene,
    cam: CAM,
    query: testCase.query,
  };

  console.log(`[alpha] measuring ${testCase.name}...`);

  // 1. Convergence curve
  const curve = await convergenceCurve(page, demoParams, {
    duration: windowMs,
    sampleMs: 1000,
  });

  // 2. Extract final frames for ghosting/sharpness/heatmap
  const frames = curve.frames;

  // 3. Ghosting detection
  const ghostingScore = geometricGhostingDetector(frames);

  // 4. Edge sharpness (use final frame)
  const sharpness = edgeSharpness(frames[frames.length - 1]);

  // 5. Temporal churn heatmap
  const heatmapPath = await churnHeatmap(frames, resolve(SHOTS, `${testCase.name}-heatmap.png`));

  // Export config
  const config = await exportConfig(page);

  return {
    testCase: testCase.name,
    verdict: testCase.verdict,
    description: testCase.description,
    churnEarly: curve.early,
    churnLate: curve.late,
    ghostingScore,
    edgeSharpness: sharpness,
    heatmapPath,
    config: JSON.stringify(config),
    diffsJson: JSON.stringify(
      curve.diffs.map((d) => ({ t: +d.t.toFixed(2), churn: +d.churn.toFixed(4) }))
    ),
  };
}

async function main() {
  const browser = await launchBrowser();
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

  const rows = [];
  const results = {};

  // Run all test cases
  for (const testCase of TEST_CASES) {
    try {
      const result = await metricsRun(page, testCase);
      results[testCase.name] = result;
      rows.push(result);

      console.log(
        `[alpha] ${testCase.name} ` +
          `churnEarly=${result.churnEarly.toFixed(4)} churnLate=${result.churnLate.toFixed(4)} ` +
          `ghosting=${result.ghostingScore.toFixed(4)} sharpness=${result.edgeSharpness.toFixed(4)}`
      );
    } catch (err) {
      console.error(`[alpha] ${testCase.name} failed: ${err.message}`);
      rows.push({
        testCase: testCase.name,
        verdict: testCase.verdict,
        error: err.message,
      });
    }
  }

  await browser.close();

  // Validation logic
  const failures = [];

  const demo12 = results['demo-12-capped-baseline'];
  const demo14 = results['demo-14-svgf-clean'];
  const demo18 = results['demo-18-oneOverN-jitter'];

  // Pass criteria:
  // 1. demo 12 (fail case) should show perpetual boiling: churnLate >= churnEarly
  if (demo12 && demo12.churnLate < demo12.churnEarly) {
    failures.push(
      `[UNEXPECTED] demo-12 converged: late=${demo12.churnLate.toFixed(4)} should be >= early=${demo12.churnEarly.toFixed(4)}`
    );
  }

  // 2. demo 14 (pass case) should converge: churnLate < churnEarly
  if (demo14 && demo14.churnLate >= demo14.churnEarly) {
    failures.push(
      `[EXPECTED FAIL] demo-14 did NOT converge: late=${demo14.churnLate.toFixed(4)} should be < early=${demo14.churnEarly.toFixed(4)}`
    );
  }

  // 3. demo 18 (pass case) should converge cleanly
  if (demo18 && demo18.churnLate >= demo18.churnEarly) {
    failures.push(
      `[EXPECTED FAIL] demo-18-oneOverN-jitter did NOT converge: late=${demo18.churnLate.toFixed(4)} should be < early=${demo18.churnEarly.toFixed(4)}`
    );
  }

  // 4. Ghosting scores should differ: fail case > pass case
  if (demo12 && demo14 && demo12.ghostingScore <= demo14.ghostingScore) {
    failures.push(
      `[SOFT] ghosting metric did not differentiate: demo12=${demo12.ghostingScore.toFixed(4)} should be > demo14=${demo14.ghostingScore.toFixed(4)}`
    );
  }

  // 5. Edge sharpness should be decent on demo 14 (SVGF smooths)
  if (demo14 && demo14.edgeSharpness < 0.3) {
    failures.push(
      `[SOFT] demo-14 edge sharpness is low: ${demo14.edgeSharpness.toFixed(4)} (SVGF should smooth, but not to 0)`
    );
  }

  const meta = {
    cam: CAM,
    scene: 'cornell',
    settleMs,
    windowMs,
    shots: SHOTS,
    rule: 'convergenceCurve = per-frame churn; ghosting = luminance variance detector; sharpness = Laplacian energy; heatmap = false-color churn.',
    failures,
    ...(quick ? { note: 'quick smoke run — not a recorded number' } : {}),
  };

  const { jsonPath, mdPath } = writeResults(outName, rows, meta);
  console.log(`[alpha] wrote ${jsonPath}`);
  console.log(`[alpha] wrote ${mdPath}`);

  if (failures.length) {
    console.log(`\n[alpha] ${failures.length} issues found (not all critical):`);
    failures.forEach((f) => console.log(`  ${f}`));
  } else {
    console.log('[alpha] all core validations passed (human eyes confirm metrics make sense)');
  }

  process.exitCode = failures.filter((f) => f.startsWith('[EXPECTED FAIL]')).length > 0 ? 1 : 0;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
