// Phase β — v1 BUILD VALIDATION
// Measures demo 18 (oneOverN temporal candidate) using Phase α infrastructure.
// Goal: Validate still-camera convergence, motion ghosting, and edge quality.
//
// Success criteria:
//   1. Still convergence: churnLate < 0.15 (clean decline, beats demo 12's 0.36)
//   2. Motion ghosting: near-zero (geometric ghosting detector)
//   3. Edge sharpness: reasonable (Laplacian energy > 0.01)
//   4. Human eyes: converges clean, no persistent smears, smooth edges
//
// Usage: node scripts/run-phase-beta.mjs [--full] [--out <name>]

import {
  launchBrowser,
  openDemo,
  exportConfig,
  settle,
  grabContent,
  convergenceCurve,
  geometricGhostingDetector,
  edgeSharpness,
  churnHeatmap,
  writeResults,
  GRID_CAMS,
} from './lib/harness.mjs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

const args = process.argv.slice(2);
const full = args.includes('--full');
const outIdx = args.indexOf('--out');
const outName = outIdx >= 0 ? args[outIdx + 1] : 'phase-beta-v1-candidate';
const SHOTS = resolve(REPO_ROOT, 'bench/results/shots/phase-beta');

const CAM = GRID_CAMS['C-wide'].cam;
const settleMs = full ? 2000 : 1000;
const windowMs = full ? 12000 : 6000;

// v1 Candidate: demo 18 with oneOverN + jitter (the temporal foundation)
const V1_CANDIDATE = {
  demo: '18',
  scene: 'cornell',
  cam: CAM,
  query: { accum: 'oneOverN', aa: 'jitter', view: 'combined' },
};

// Baseline comparisons for context
const COMPARISON_CASES = [
  {
    name: 'demo-12-capped-baseline',
    demo: '12',
    scene: 'cornell',
    cam: CAM,
    query: { view: 'combined' },
    purpose: 'Baseline (non-shippable, perpetual boiling)',
  },
  {
    name: 'demo-14-svgf',
    demo: '14',
    scene: 'cornell',
    cam: CAM,
    query: { stack: 'svgf', view: 'combined' },
    purpose: 'Denoiser quality (SVGF converges, but different temporal path)',
  },
];

async function measureCandidate(page) {
  console.log('[phase-β] measuring v1 candidate (demo 18 oneOverN+jitter)...');

  const demoParams = {
    demo: V1_CANDIDATE.demo,
    scene: V1_CANDIDATE.scene,
    cam: V1_CANDIDATE.cam,
    query: V1_CANDIDATE.query,
  };

  // 1. Convergence curve (still camera)
  const curve = await convergenceCurve(page, demoParams, {
    duration: windowMs,
    sampleMs: 1000,
  });

  // 2. Ghosting detection (temporal variance)
  const ghostingScore = geometricGhostingDetector(curve.frames);

  // 3. Edge sharpness (final frame)
  const sharpness = edgeSharpness(curve.frames[curve.frames.length - 1]);

  // 4. Heatmap visualization
  const heatmapPath = await churnHeatmap(
    curve.frames,
    resolve(SHOTS, 'v1-candidate-heatmap.png')
  );

  const config = await exportConfig(page);

  return {
    testCase: 'v1-candidate-demo18-oneOverN',
    purpose: 'Core v1 stack (temporal foundation + jitter AA)',
    churnEarly: curve.early,
    churnLate: curve.late,
    convergenceTrend: curve.late < curve.early ? 'declining ✓' : 'flat/rising ✗',
    ghostingScore,
    edgeSharpness: sharpness,
    heatmapPath,
    config: JSON.stringify(config),
    diffsJson: JSON.stringify(
      curve.diffs.map((d) => ({ t: +d.t.toFixed(2), churn: +d.churn.toFixed(4) }))
    ),
  };
}

async function measureComparison(page, testCase) {
  console.log(`[phase-β] measuring comparison: ${testCase.name}...`);

  const demoParams = {
    demo: testCase.demo,
    scene: testCase.scene,
    cam: testCase.cam,
    query: testCase.query,
  };

  const curve = await convergenceCurve(page, demoParams, {
    duration: windowMs,
    sampleMs: 1000,
  });

  const ghostingScore = geometricGhostingDetector(curve.frames);
  const sharpness = edgeSharpness(curve.frames[curve.frames.length - 1]);
  const config = await exportConfig(page);

  return {
    testCase: testCase.name,
    purpose: testCase.purpose,
    churnEarly: curve.early,
    churnLate: curve.late,
    convergenceTrend: curve.late < curve.early ? 'declining ✓' : 'flat/rising ✗',
    ghostingScore,
    edgeSharpness: sharpness,
    config: JSON.stringify(config),
  };
}

async function main() {
  const browser = await launchBrowser();
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

  const rows = [];

  try {
    // Measure v1 candidate
    const v1Result = await measureCandidate(page);
    rows.push(v1Result);

    console.log(
      `[phase-β] v1-candidate: early=${v1Result.churnEarly.toFixed(4)} ` +
        `late=${v1Result.churnLate.toFixed(4)} ${v1Result.convergenceTrend} ` +
        `ghosting=${v1Result.ghostingScore.toFixed(4)} sharpness=${v1Result.edgeSharpness.toFixed(4)}`
    );

    // Measure comparisons for context
    for (const caseInfo of COMPARISON_CASES) {
      const result = await measureComparison(page, caseInfo);
      rows.push(result);

      console.log(
        `[phase-β] ${caseInfo.name}: early=${result.churnEarly.toFixed(4)} ` +
          `late=${result.churnLate.toFixed(4)} ${result.convergenceTrend}`
      );
    }
  } finally {
    await browser.close();
  }

  // Validation
  const failures = [];
  const v1 = rows[0]; // v1 candidate is first row

  // Gate 1: convergence must show decline
  if (v1.churnLate >= v1.churnEarly) {
    failures.push(
      `[GATE 1 FAIL] v1 did not converge: late=${v1.churnLate.toFixed(4)} should be < early=${v1.churnEarly.toFixed(4)}`
    );
  }

  // Gate 2: must beat demo 12 (capped baseline)
  const demo12 = rows.find((r) => r.testCase === 'demo-12-capped-baseline');
  if (demo12 && v1.churnLate >= demo12.churnLate) {
    failures.push(
      `[GATE 2 SOFT] v1 late churn (${v1.churnLate.toFixed(4)}) should be better than demo-12 baseline (${demo12.churnLate.toFixed(4)})`
    );
  }

  // Gate 3: ghosting must be low (still camera)
  if (v1.ghostingScore > 0.1) {
    failures.push(
      `[GATE 3 SOFT] v1 ghosting score (${v1.ghostingScore.toFixed(4)}) is elevated for still camera`
    );
  }

  const meta = {
    cam: CAM,
    scene: 'cornell',
    settleMs,
    windowMs,
    shots: SHOTS,
    rule: 'v1 gates: (1) convergence decline, (2) beats capped baseline, (3) low still-camera ghosting',
    candidate: 'demo 18 oneOverN + jitter',
    nextStep: 'Human eyes + motion test → Phase γ (v2 motion tuning) if pass',
    failures,
    ...(full ? {} : { note: 'quick validation run' }),
  };

  const { jsonPath, mdPath } = writeResults(outName, rows, meta);
  console.log(`[phase-β] wrote ${jsonPath}`);
  console.log(`[phase-β] wrote ${mdPath}`);

  if (failures.length) {
    console.log(`\n[phase-β] ${failures.length} gate issues:`);
    failures.forEach((f) => console.log(`  ${f}`));
  }

  console.log(
    '\n[phase-β] NEXT STEPS: (1) Review heatmap + curves. (2) Human eyes on demo 18. ' +
      '(3) If converges clean + no persistent ghosting → Phase γ (v2 motion tuning). ' +
      '(4) Else iterate on temporal foundation.'
  );

  process.exitCode = failures.filter((f) => f.startsWith('[GATE 1')).length > 0 ? 1 : 0;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
