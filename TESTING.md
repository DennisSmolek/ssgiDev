# TESTING.md — the testing-phase plan of action

Status: **active phase** (follows the build phase in PLAN.md; precedes the
distillation phase in NEXTGEN.md). The bench is frozen as *source-faithful*
during this phase — no optimizations land in demos 00–11 (see NEXTGEN.md
"faithfulness boundary"). Findings go to per-demo RESULTS sections and
bench/DEMOS.md's verdict column; decisions go to WORKLOG "Decisions for review".

## What we are deciding

1. **Algorithm base for v2** — which march/gather (SSRT3-complete, GT-VBAO/VBGI,
   SSHGI) is the quality-per-ms winner against the oracle, per scene class.
2. **Default stack** — which lab-validated pieces (noise, denoise, half-res,
   thickness, distant light, fallback) survive contact with the *fixed* base.
3. **Perf budget map** — where the milliseconds actually go, per pass, so the
   NEXTGEN improvement tracks are ranked by measured deficit, not appeal.

## Tooling already in place (use these, don't reinvent)

- **Ground truth**: `reference` / `split` (drag divider) / `diff` views in demos
  02/03/04/05 (harness ReferencePass). `A/B channel`: alpha = AO, rgb = GI.
  Diff is |a−b|×amp: start `diff amp` at 2, not 8. The known systematic offsets
  (AO ~0.1 open-surface, GI scale at unit gain) are baseline signal — record
  them, don't "fix" them.
- **Perf**: wall fps (vsync-capped, sanity only) + gpu ms readout; fenced
  bursts via `window.__ssrt3bench(n)` (demo 03) and `window.__bench09` (lab 09
  methodology: min of 3×40-iteration bursts, paired back-to-back, report
  ratios not absolutes — thermals drift ±15%).
- **Determinism**: `?cam=px,py,pz,tx,ty,tz`, `?view=`, per-demo URL overrides,
  copy/paste config JSON (embed the JSON with every recorded number),
  `freezeNoise` (demo 03) for static-pattern inspection.
- **Temporal stability metric**: mean abs pixel diff of two screenshots 2 s
  apart after 6 s settle, tweakpane column excluded (established in WORKLOG
  2026-07-18; frame-count vs EMA measured 0.83 vs 3.38 by this metric).
- **Headed playwright only** (headless = software WebGPU = black), args
  `['--enable-unsafe-webgpu']`, clipboard config driving. Template scripts:
  scratchpad `diag-03*.mjs` pattern.

## Standard measurement grid

Scenes × cameras (add as camera bookmarks so they're one click):

| id | scene | camera (`?cam=`) | what it stresses |
|---|---|---|---|
| C-wide | cornell | `0,2.4,8.8,0,2.6,0` | overall GI/AO, wall bleed |
| C-graze | cornell | `1.4,3.6,4.6,0.95,1.3,0.7` | grazing angles, flat-top artifacts |
| C-contact | cornell | `3.0,1.6,3.6,0.3,0.5,0.1` | contact detail (short-box/floor + inter-box gap), denoiser blur |
| S-hall | sponza | `11,1.8,-0.3,-10,2.6,-0.3` | long-range, bandwidth, distant light (the corridor default pose) |
| S-column | sponza | `2.0,1.6,0.0,3.4,1.4,-2.6` | thin occluders (banner edges, hanging pot + chains, vines vs column), thickness |
| Z-zoo | artifact-zoo | default | the artifact checklist |

Poses are committed as `GRID_CAMS` in `bench/scripts/lib/harness.mjs` (picked
visually 2026-07-21) — runners import them; in the UI paste the `?cam=` string.

Configs per demo: **as-shipped defaults** and one **heavy** config (demo 03:
rc4/sc32). Every recorded number = (grid id, config JSON, commit hash).

## Test matrix

### A. Quality vs ground truth (demos 01, 03, 04, 05, 06)
Per grid cell: `split` + `diff` screenshots (alpha and rgb channels), plus a
scripted pixel-MSE readback vs the converged oracle (lab 11's readback method).
Demo 01 (stock three) has no wired reference view — compare via screenshot MSE
against demo 02 at the same `?cam=`. Record: MSE, where error concentrates
(flat / grazing / contact / silhouette), and the systematic-offset baselines.

### B. Performance (all demos)
Fenced-burst ms per pass (march / temporal / denoise / composite where
separable), default + heavy, C-wide + S-hall. Deliverable: a cost table like
lab 09's, one row per demo. This is the budget map NEXTGEN ranks against.

### C. Temporal behavior (03, 04, 05, 06, 10)
Stills: stability metric in each demo's default accumulation mode (and demo 03
in both `ssrt3-ema` and `frame-count`). Motion: orbit ~5 s, stop, measure
time-to-reconverge (screenshots at 0.5 s intervals until stability metric
drops below the still-camera value) and note ghosting/smear visually.

### D. Lab re-validation on the fixed base (IMPORTANT, do first)
Labs 07/09/10/11 concluded **before** the y-mirror fix (6adb392) and the
per-frame jitter advance (c77e960). Their marchers are forks that received the
y-fix, but their *recorded findings* predate it:
- **Lab 09**: perf ratios are fetch-count driven — safe. Spot-check only.
- **Lab 10**: the "pure temporal mean is noisier because rand(uv) is
  frame-static" finding is now stale for demo 03 (jitter advances). Re-run the
  stack comparison against demo 03's current temporal; confirm the
  SSRT3-temporal+bilateral verdict still holds, and re-rank vs `frame-count`.
- **Lab 11**: re-run the IGN-vs-gradient-noise MSE table on the fixed marcher;
  phantom-sector noise polluted the pre-fix error field.
- **Lab 07/08**: spot re-verify headline findings (fallback directionality;
  Ottosson thickness + salm-caps) — screenshots only unless something moved.

### E. Cross-demo bake-off (the deliverable)
One table: demo × (MSE-AO, MSE-GI, gpu ms, stability, artifact-zoo pass/fail
notes) at C-wide + S-hall defaults. This table + the WORKLOG decisions log is
the input to NEXTGEN phase D.

## Order of work

1. **D first** (re-validate labs on the fixed base — everything else cites them)
2. Camera bookmarks for the grid; then **B** (cheap, scriptable)
3. **A**, then **C**
4. **E** synthesis + verdict column update in bench/DEMOS.md

## Rules during this phase

- No changes to demo/lab algorithm code except verified bug fixes (a fix that
  changes faithfulness gets a WORKLOG entry + re-baseline of affected rows).
- Harness/tooling changes are fine (they don't touch the signal).
- Every number lands with its config JSON + commit hash or it didn't happen.
- Negative results are results — record them (lab 09 is the model).
