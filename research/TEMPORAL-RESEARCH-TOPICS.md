# Temporal / TAA research topics — brief for the research agent

Requested by the bench (demo 18 temporal lab, 2026-07-24). For each topic:
the question we need answered, names/keywords to chase, and which bench
decision it feeds. Deliverable per topic: 1–2 page summary + the primary
sources (papers/talks/code) dropped in `research/`. Priority order below.

## 1. Variance clipping vs neighborhood clamping (HIGH)

- **Question**: exact formulation of moment-based variance clipping (mean ±
  γ·σ AABB, usually in YCoCg), recommended γ, and its measured noise floor
  vs hard min/max clamping.
- **Chase**: Marco Salvi, "An Excursion in Temporal Supersampling" (GDC
  2016); Karis "High Quality Temporal Supersampling" (SIGGRAPH 2014);
  Jimenez et al. (SIGGRAPH 2016 filmic TAA).
- **Feeds**: demo 18's `jitterClamp` arm measured the hard 3×3 clamp flat at
  ~2× the capped-EMA floor. Variance clipping is the successor arm to build
  — we need the reference formulation before implementing.

## 2. Disocclusion / history-rejection tests under sub-pixel jitter (HIGH)

- **Question**: how production TAA/upscalers decide "history invalid" when
  the depth buffer itself is jittered (silhouette depth flips every frame
  by construction). Depth-plane distance tests, normal agreement, jitter-
  compensated depth reprojection, tolerance schedules.
- **Chase**: SVGF's depth-plane weight (Schied 2017); FSR2 source
  (rectification + disocclusion logic, GPUOpen); UE5 TAA/TSR docs.
- **Feeds**: our demo-18 still-path accept + widened 0.35 threshold works
  but is ad hoc; also directly informs the demo-16/FSR defect review
  (Report 3 addendum — jittered-depth disocclusion is the prime suspect).

## 3. Spatiotemporal blue noise (STBN) — the temporal axis (HIGH)

- **Question**: sampling sequences whose TEMPORAL average is engineered to
  converge fast (blue noise over the time axis, not just space). How much
  faster does STBN converge under 1/N and under EMA vs independent
  per-frame blue noise? How to use 3D STBN volumes vs 2D-atlas tile
  cycling (what we do now)?
- **Chase**: Wolfe, Morrical, Akenine-Möller et al., "Spatiotemporal Blue
  Noise Masks" (NVIDIA, EGSR 2022); Georgiev & Fajardo scrambling notes;
  free STBN texture releases (NVIDIA).
- **Feeds**: demo 12/18 bluenoise mode currently cycles atlas tiles with a
  golden-ratio value shift — if true STBN-over-time converges measurably
  faster at low N, that's a drop-in producer win for every stack.

## 4. History resampling filters (MED)

- **Question**: bilinear history fetch accumulates blur over hundreds of
  frames; what do production TAAs use (5-tap Catmull-Rom approximation),
  and does it matter at N in the hundreds (our 1/N arm)?
- **Chase**: Karis 2014 (Catmull-Rom history); Jimenez 2016; "filmic SMAA
  T2x" notes.
- **Feeds**: demo 18 currently nearest/bilinear-reprojects; long-horizon
  1/N accumulation makes resampling blur a first-order quality question
  for the P1 graduation build.

## 5. Velocity dilation / closest-depth velocity (MED)

- **Question**: fetching motion from the closest-depth pixel in a 3×3
  neighborhood so silhouette edges reproject with foreground motion.
- **Chase**: FSR2 "dilated velocity"; UE TAA notes; Jimenez 2016.
- **Feeds**: demo 18's known 1–2 px beauty fringe at silhouettes under
  sustained motion — dilated velocity is the standard fix, needed for the
  P1 beauty resolve.

## 6. HDR weighting + firefly-safe accumulation (MED)

- **Question**: accumulating in tonemapped space (Karis reversible
  tonemap), luminance-weighted blending, and firefly suppression WITHOUT
  history clamping (our oneOverN arm deliberately dropped all clamps —
  what protects it from a single 1000× firefly frame?).
- **Chase**: Karis "Tone mapping for AA" blog note; Brian Karis SIGGRAPH
  2014 Q&A; RTX path-tracing temporal accumulation notes (max-luminance
  pre-clamp on the producer side).
- **Feeds**: oneOverN's unclamped history is its convergence superpower and
  its firefly liability; we need the standard producer-side mitigation
  before graduation.

## 7. A-SVGF — temporal gradient-driven adaptivity (MED)

- **Question**: estimating per-pixel temporal gradients (sparse forward-
  projected reference samples) to detect LIGHTING change — distinguishing
  "camera still, lighting changed" (history stale, α must rise) from
  "everything static" (α → 1/N). The principled replacement for
  detectShadingChanges-style heuristics.
- **Chase**: Schied et al., "Gradient Estimation for Real-Time Adaptive
  Temporal Filtering" (A-SVGF, HPG 2018); Q2RTX/vkpt implementation.
- **Feeds**: our whole 1/N story assumes static lighting; A-SVGF is the
  answer for dynamic lights/emissive changes, and likely the next SVGF-lab
  (demo 14) arm.

## 8. TAA-upscaling rectification internals (MED)

- **Question**: how FSR2/3 (public source), DLSS/XeSS (public docs) handle
  locks, thin features, reactive masks, and luminance instability — what
  their accumulation actually does per pixel.
- **Chase**: FSR2 GPUOpen source + GDC talks; Intel XeSS GDC talk; "Temporal
  upsampling" survey material (TSR deep dives).
- **Feeds**: reviewing their fix for the Report-3 defect, and defining our
  Req 2 upscale+AA acceptance criteria beyond "churn goes to ~0".

## 9. Perceptual thresholds for temporal noise (LOW, high leverage)

- **Question**: what residual frame-to-frame fluctuation is perceptually
  invisible (flicker sensitivity vs luminance, spatial frequency, and fps;
  JND data). Is there a defensible number where "FLOOR-live" becomes
  "CLEAN" to a human?
- **Chase**: flicker fusion / temporal contrast sensitivity function
  literature (de Lange curves); VESA FreeSync/flicker metrics; any
  game-industry "acceptable TAA shimmer" write-ups.
- **Feeds**: HUMAN-TESTS.md verdicts are currently subjective; a
  perceptual threshold would let the recorded churn metric predict the
  human verdict — closing the metric-vs-eye gap that started this whole
  program.

## 10. Standard test scenes + ghosting metrics (LOW)

- **Question**: are there community-standard temporal-stability stress
  tests (pendulum ghosting, disocclusion sweeps, thin-feature flicker) we
  should adopt so our battery numbers are externally comparable?
- **Chase**: TAA comparison methodology in the Jimenez/Salvi decks; FSR/
  DLSS reviewer methodology; academic TAA survey (Yang et al., "A Survey
  of Temporal Antialiasing Techniques", CGF 2020 — likely the single best
  starting bibliography for ALL topics above).
- **Feeds**: P2 re-record battery design.

## Out of scope for this pass

ReSTIR-family temporal reuse (producer-side resampling — separate track),
neural TAA (DLSS-internals speculation is low-value without source), and
anything requiring training pipelines (see ROADMAP P4 neural-denoiser note).
