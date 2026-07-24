# Handoff — temporal/TAA research delivered

Research pass on `TEMPORAL-RESEARCH-TOPICS.md` is complete. All 11 topics are in
`research/sources/temporal/` as `01`–`11` markdown files, with `00-INDEX.md` and a
consolidated `sources/BIBLIOGRAPHY.md`. Sourcing is balanced papers + real code
(FSR2/Q2RTX/Bevy WGSL/GitHub), verified — URLs that didn't resolve are flagged in
each file's Confidence section. Depth is tiered: full for HIGH + denoising, tighter
for MED/LOW.

## Per-topic actionable answer (one line each)

1. **Variance clipping** — build `μ ± γσ` AABB from 3×3 raw moments in YCoCg,
   **γ = 1.0**, clip history toward box center (not per-channel clamp). Best in
   practice: clamp to min/max box first, then variance-clip. → successor to the
   `jitterClamp` arm.
2. **Disocclusion under jitter** — don't compare raw depth. Use SVGF's gradient-
   scaled depth weight or FSR2's view-space required-separation test against
   *reconstructed previous depth*. Replaces the ad-hoc 0.35 threshold.
3. **STBN temporal axis** — true 3D STBN should beat the golden-ratio tile cycle at
   low N, but sources are qualitative — **measure it** (RMSE-vs-frame, 1/N and EMA).
   Textures: NVIDIA-RTX/STBN `Assets/STBN.zip`.
4. **History resampling** — 5-tap corner-skipped Catmull-Rom (Bevy WGSL / MJP gist).
   Matters *more* at large N, not less (recursive blur compounds).
5. **Velocity dilation** — 3×3 nearest-depth MV select + atomic forward reprojection.
   Standard fix for the silhouette fringe.
6. **HDR / firefly** — oneOverN can keep unclamped history if the firefly guard
   moves producer-side: max-luma pre-clamp + accumulate in reversible-tonemap space
   (Karis/Lottes `max3`).
7. **A-SVGF** — fixed-RNG forward-projected temporal gradient λ drives adaptive α;
   the principled replacement for `detectShadingChanges`. → next demo-14 arm.
8. **Upscaling rectification** — FSR2 `accumulate.h`/`lock.h` read verbatim; churn≈0
   is the box-loosened static regime, so Req 2 criteria must also cover the
   box-tightened disocclusion/high-velocity regime. Target FSR2/FSR3.1 analytic
   path (FSR4/DLSS/XeSS are tensor-locked, not WGSL-portable).
9. **Perceptual thresholds** — no universal scalar; gate the churn metric with a
   per-region tCSF model (elaTCSF) weighted by luminance / spatial freq / eccentricity.
10. **Test scenes / metrics** — no canonical suite; build pendulum / disocclusion-
    sweep / thin-feature scenes, log temporal RMSE vs 16–64× SS reference, score
    FLIP/FVVDP offline. Yang 2020 survey = master bibliography.
11. **Denoising (new)** — keep **SVGF → FSR3** as the spine; add A-SVGF adaptive α +
    ReSTIR upstream; Dammertz à-trous as the cheap disocclusion fallback; OIDN as a
    *settle-time* pass, not per-frame.

## Recommended next arms (priority order)

1. **Variance clipping γ=1** as the `jitterClamp` successor (topic 01) — Bevy
   `taa.wgsl` is a drop-in WGSL reference fusing 01+04+06.
2. **A-SVGF** for the SVGF lab / demo 14 (topic 07) — unlocks dynamic lighting,
   which the whole 1/N-static story currently can't handle.
3. **STBN measurement** (topic 03) — cheap experiment, potential drop-in producer
   win for every stack; needs a real number before adoption.

## Flags (don't quote as settled)

- FSR2 `reconstruct_previous_depth.h` body won't render through the raw mirror
  (re-confirmed) — the dilation pseudocode in topic 05 is manual-sourced, not
  byte-exact. Open the GitHub blob for the exact `FindNearestDepth` loop.
- No numeric STBN convergence multiplier exists in the literature — measure it.
- No universal perceptual-flicker scalar — use elaTCSF per region.
- **Premise correction:** the "OIDN port is very slow" assumption looks out of date
  vs the current `DennisSmolek/Denoiser` (WebGPU+ORT, ~104 ms/1080p warm). Confirm
  before investing in neural — see topic 11.
