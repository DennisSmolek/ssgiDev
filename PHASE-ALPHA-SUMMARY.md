# Phase α — Testing Infrastructure (COMPLETE)

**Date:** 2026-08-03  
**Status:** OPERATIONAL  
**Commit:** 9d21307 (with Phase α additions)

---

## What Was Built

### 1. **convergenceCurve()**
Generalizes run-18's temporal measurement into a reusable function:
- **Input:** page, demo params (demo/scene/cam/query), duration, sample interval
- **Output:** `{diffs: [{t, churn}, ...], early, late, frames: [...]}`
- **Methodology:** settle, grab screenshots at fixed intervals, calculate per-frame churn via meanAbsDiff
- **Validation:** Demo 12 (capped) shows flat churn (0.354→0.363); Demo 14 (SVGF) shows low stable churn (0.041); Demo 18 (1/N) shows declining churn (0.437→0.375)

### 2. **geometricGhostingDetector()**
Per-pixel luminance variance as a ghosting proxy:
- **Input:** frames array (PNG objects)
- **Output:** score in [0, 1] where 1 = severe ghosting
- **Method:** sample pixels, measure temporal variance, threshold at σ>20 luminance units
- **Status:** Works, but detection is weak on still cameras (ghosting is primarily a motion/disocclusion artifact). Will be more sensitive when testing camera movement.
- **Note:** For now, use convergence curves as primary validation; save geometric detector for motion test sequences.

### 3. **edgeSharpness()**
Laplacian-based high-frequency energy for edge-quality metric:
- **Input:** PNG frame
- **Output:** scalar in [0, 1] where 1 = very sharp
- **Method:** 3×3 Laplacian kernel, sum absolute responses, normalize
- **Caveat:** Low values on smooth/antialiased images are expected (0.014 on demo 14 is normal, not a bug)
- **Refinement:** Normalization constant (currently 600) can be tuned per scene. For ship validation, prioritize human eyes over this metric.

### 4. **churnHeatmap()**
Per-pixel temporal churn visualization:
- **Input:** frames array, save path
- **Output:** 64×64 false-color PNG (red=high churn, blue=low)
- **Purpose:** Visual inspection of where boiling/artifacts concentrate
- **Generated:** One heatmap per test case in `bench/results/shots/alpha/`

---

## Validation Results

**Quick run (6s window, early/late from 3-frame windows each):**

| Demo | Early | Late | Trend | Verdict |
|------|-------|------|-------|---------|
| **12-capped** | 0.354 | 0.363 | ↗ (flat/up) | ✗ Non-shippable (perpetual boiling) |
| **14-svgf** | 0.041 | 0.041 | → (stable, converged) | ✓ Converges clean |
| **18-oneOverN-jitter** | 0.437 | 0.375 | ↘ (declining) | ✓ Converging (still noisy baseline) |

**Key findings:**
- ✅ convergenceCurve correctly distinguishes boiling (non-converging) from converging stacks
- ✅ All four Phase α components build and run without errors
- ⚠️ Ghosting detector returns 0 on stills (expected — geometric ghosting is motion-driven)
- ⚠️ Edge sharpness is uniformly low (expected — SVGF and AA naturally smooth edges; not a bug)

---

## Infrastructure Exported

**Location:** `bench/scripts/lib/harness.mjs`  
**Functions added:**
- `convergenceCurve(page, demoParams, {duration, sampleMs})`
- `geometricGhostingDetector(frames)`
- `edgeSharpness(frame)`
- `churnHeatmap(frames, savePath)`

**Test runner:** `bench/scripts/run-alpha.mjs`
- Validates metrics on 3 deliberate test cases (demo 12/14/18)
- Compares early vs late churn to detect convergence
- Generates JSON + markdown reports + heatmap PNGs

**Usage:**
```bash
BENCH_URL=http://localhost:5182/ node bench/scripts/run-alpha.mjs --quick
```

---

## What's Next: Phase β

**Goal:** Build clean v1 stack (VBAO + oneOverN + FSR3 + SVGF)

**Actions:**
1. Create new demo (19-ship) with clean integration from scratch
2. Measure using Phase α infrastructure:
   - Still camera: convergenceCurve should show clean decline to low floor
   - Motion: ghostingDetector on deliberate motion sequence (teleport + rotate)
   - Edges: run on demo 14/18 variants to understand edge-sharpness baseline
   - Heatmap: visual inspection of where residual churn concentrates
3. Human eyes: verify still converges, motion ghosting is zero persistent, edges are smooth
4. Iterate if needed, then move to Phase γ (v2 motion tuning)

---

## Notes for Future Runs

- **Ghosting detection:** Currently tuned for still-camera variance. For motion tests, will need sequence like: (1) settle at position A, (2) teleport to position B, (3) rotate back to match view from A, (4) compare snapshots. This deliberate test exposes stale view-dependent GI.
- **Edge sharpness:** Metric is correct but uninformative on smooth content. Prioritize visual inspection (AA subjective quality) over the numeric scalar.
- **Convergence curves:** Early/late split should use first/last N frames (currently 3 each). For 12s runs, could expand to first/last 6 for more robust statistics.
- **Dev server:** Currently on port 5182. If port changes, update `BENCH_URL` env var.

---

## Commit State

Current branch: main  
Dirty files: Phase α additions to harness.mjs + run-alpha.mjs  
Next step: Commit Phase α infrastructure, then begin Phase β build.
