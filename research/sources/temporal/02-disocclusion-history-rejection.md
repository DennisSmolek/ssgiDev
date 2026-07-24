# 02 — Disocclusion / history-rejection under sub-pixel jitter (HIGH)

**Bench decision this feeds:** demo-18's still-path accept + widened 0.35
threshold works but is ad hoc; also the prime suspect in the demo-16/FSR defect
review (Report 3 addendum — jittered-depth disocclusion).

---

## The core problem

With sub-pixel jitter, the depth of a silhouette pixel flips between foreground
and background every frame, so a naive `|z_curr − z_prev| < ε` test fires
constantly on edges. Production upscalers therefore do **not** compare raw
depths. They:

1. **Dilate** depth/velocity to the nearest surface first (see topic 05),
2. **Reproject** last frame's depth forward using the dilated motion vector, and
3. Apply a **view-space, perspective- and FOV-aware depth-separation test** whose
   tolerance scales with distance and resolution — not a fixed epsilon.

Failing history isn't hard-discarded; it gets a per-pixel **disocclusion factor
∈ [0,1]** that widens the color-clamp box and biases accumulation toward the
current frame.

---

## SVGF edge-stopping weights (Schied et al. 2017, verbatim from preprint)

Bilateral à-trous weight `w = w_z · w_n · w_l`:

**Depth (eq. 3)** — the key idea is the gradient in the denominator:
```
w_z = exp( −|z(p) − z(q)| / ( σ_z · |∇z(p) · (p − q)| + ε ) )
```
Tolerance is the local screen-space depth gradient projected onto the sample
offset `(p−q)`, so a steep-but-continuous surface is not penalized while a true
discontinuity is. `σ_z ≈ 1`.

**Normal (eq. 4):**  `w_n = max(0, n(p)·n(q))^σ_n`,  `σ_n ≈ 128`.

**Luminance (eq. 5):**
`w_l = exp( −|l(p) − l(q)| / ( σ_l · sqrt(g_{3×3}(Var(l(p)))) + ε ) )`, `σ_l ≈ 4`;
`g_{3×3}` = 3×3 Gaussian pre-blur of the variance estimate.

> This is the principled version of what a "still-path accept + fixed threshold"
> is approximating. Porting the gradient-scaled depth weight should let you drop
> the ad-hoc 0.35 constant.

---

## FSR2 depth-clip test (verbatim from `ffx_fsr2_depth_clip.h`)

FSR2 replaces SVGF's gradient with an analytic per-pixel *required depth
separation*, compared in **view space** against the **reconstructed previous
depth** (last frame's depth pulled forward through the dilated MV — this is what
makes it jitter-robust):

```
Ksep  = 1.37e-05
Kfov  = length(viewSpaceCorner) / length(viewSpaceCenter)   // FOV compensation
fRequiredDepthSeparation = Ksep * Kfov * fHalfViewportWidth * fDepthThreshold

// per bilinear tap, only when fDepthDiff = z_curr - z_prevNearest > 0:
fPower = lerp(1.0, 3.0, resolutionFactor)     // resolutionFactor vs 1920x1080
term   = pow( saturate(fRequiredDepthSeparation / fDepthDiff), fPower )

depthClipFactor = saturate( 1.0 - sum(term*w)/sum(w) )   // 0 = trust history, 1 = disoccluded
```

- `FFX_FSR2_OPTION_INVERTED_DEPTH` swaps min/max for reversed-Z.
- Gated by `EvaluateSurface()`, a thin-surface detector using three vertical
  reconstructed-depth taps with a ~1% relative threshold.
- `depthClipFactor` later scales the color rectification box + accumulation in
  the accumulate pass (see topic 08).

---

## UE5 TSR (named subsystems, per Epic docs)

Rejection is decomposed into *Parallax Heuristics* (reproject via MVs, preserve
quality on disocclusion), *Shading Rejection* (color/translucency change),
*Flickering Temporal Analysis*, and *History Resurrection* (re-use older history
when a surface reappears). `r.TSR.Visualize 1` overlays the rejection mask,
velocity, and history age. `BlendFinal==1` fully disables history reprojection
where regions are too noisy to clamp safely.

---

## Primary sources

- **Spatiotemporal Variance-Guided Filtering** — Schied et al., HPG 2017.
  Preprint (eqs 3–5 verbatim): https://cg.ivd.kit.edu/publications/2017/svgf/svgf_preprint.pdf
  · project: https://cg.ivd.kit.edu/english/svgf.php
  · camera-ready: https://www.highperformancegraphics.org/wp-content/uploads/2017/Papers-Session1/HPG2017_SpatiotemporalVarianceGuidedFiltering.pdf
- **FSR2 technique manual** (passes: reconstruct&dilate → depth clip → locks →
  reproject&accumulate) — GPUOpen.
  https://gpuopen.com/manuals/fidelityfx_sdk/techniques/super-resolution-temporal/
- **Temporal Super Resolution in Unreal Engine** — Epic.
  https://dev.epicgames.com/documentation/en-us/unreal-engine/temporal-super-resolution-in-unreal-engine
  · FAQ: https://dev.epicgames.com/documentation/en-us/unreal-engine/temporal-super-resolution-frequently-asked-questions-for-unreal-engine

## Code / implementations

- **FSR2 `ffx_fsr2_depth_clip.h`** ⭐ (HLSL/FFX) — `ComputeDepthClip`,
  `EvaluateSurface`, `DepthClip`. The exact disocclusion file.
  https://github.com/GPUOpen-Effects/FidelityFX-FSR2/blob/master/src/ffx-fsr2-api/shaders/ffx_fsr2_depth_clip.h
  ✅ fetched verbatim.
- **FSR2 `ffx_fsr2_reproject.h`** (HLSL/FFX) — `ComputeReprojectedUVs`,
  `ReprojectHistoryColor`, history/lock resampling.
  https://github.com/GPUOpen-Effects/FidelityFX-FSR2/blob/master/src/ffx-fsr2-api/shaders/ffx_fsr2_reproject.h
- **FSR2 → OpenGL/GLSL port** (readable, resolves) —
  https://github.com/JuanDiegoMontoya/FidelityFX-FSR2-OpenGL
- **SVGF references for the weights** — TheVaffel/spatiotemporal-variance-guided-filtering
  (GLSL) https://github.com/TheVaffel/spatiotemporal-variance-guided-filtering ;
  ZheyuanXie/CUDA-Path-Tracer-Denoising (CUDA)
  https://github.com/ZheyuanXie/CUDA-Path-Tracer-Denoising

## WGSL portability notes

- **f16**: FSR2 uses `min16float` paths; WGSL `f16` is an optional extension —
  run the f32 reference path.
- **View-space depth reconstruction** needs projection constants (near/far or
  inverse-projection matrix) in a uniform; thread reversed-Z state explicitly as
  a `const`/`override`.
- **Bilinear-weight gather**: reproduce `GetBilinearSamplingData` with manual
  integer taps or `textureGather` — no blocker.
- SVGF's `∇z(p)` is a screen-space derivative; in a compute pass use finite
  differences of the depth texture (WGSL `dpdx/dpdy` are fragment-only anyway).
- Macro metaprogramming (`DeclareCustomTextureSample`) has no WGSL equivalent —
  inline samplers by hand.

## Confidence

SVGF eqs 3–5 and FSR2 `depth_clip.h`/`reproject.h` read verbatim from source.
UE5 TSR subsystem names from Epic docs. "Reconstructed previous depth is produced
by the dilate pass" is corroborated across the manual and the `LoadReconstructedPrevDepth`
call sites but the reconstruct file body wasn't pulled (see topic 05 caveat).
