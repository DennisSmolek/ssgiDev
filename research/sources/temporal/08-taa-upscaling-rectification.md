# 08 — TAA-upscaling rectification internals (MED)

**Bench decision this feeds:** reviewing FSR's fix for the Report-3 defect, and
defining Req 2 upscale+AA acceptance criteria beyond "churn goes to ~0".

---

## FSR2 per-pixel accumulation (verbatim from `ffx_fsr2_accumulate.h` + `_lock.h`)

### (a) Color rectification / clamp box — `RectifyHistory`

Upsampling builds a `RectificationBox` (min/max/center of the current-frame YCoCg
neighborhood, à la neighborhood clamp). History is clamped to a **scaled** box:

```
fVelocityFactor = saturate(hrVelocity / 20)
fBoxScaleT      = max(depthClipFactor, max(accumulationMask, fVelocityFactor))
fBoxScale       = lerp(fScaleFactorInfluence, 1.0, fBoxScaleT)   // bigger box (weaker clamp) when static & occlusion-safe
boxMin/Max      = clamp(center ± boxVec*fBoxScale, aabbMin, aabbMax)
if history outside box:
    clamped = clamp(history, boxMin, boxMax)
    contribution = max(lumaInstabilityFactor, lockContributionThisFrame)
                 * (1 - pow(reactiveFactor, 0.5))    // reactive & unstable keep less history
    history      = lerp(clamped, history, saturate(contribution))
    accumulation = lerp(min(accum,0.1), accum, saturate(contribution))
```

So disocclusion (`depthClipFactor`), high velocity, and reactivity **tighten** the
clamp; locks and luma-instability protection **loosen** it. This is the
generalization of your churn metric: churn≈0 is the *static, box-loosened* regime;
acceptance criteria should also cover the disoccluded/high-velocity *box-tightened*
regime where history is deliberately dropped.

### (b) Locks — thin-feature protection (`ffx_fsr2_lock.h`)

`ComputeThinFeatureConfidence` = a **ridge detector** on a 3×3 luma window: a pixel
is a lock candidate only if its luma is a local ridge
(`nucleus > dissimilarLumaMax || nucleus < dissimilarLumaMin`) AND no full 2×2
quadrant is "similar" (`difference < 1.05`). Locks give sub-pixel thin features
(wires, foliage) a lifetime during which history is trusted despite clamp pressure.
`FinalizeLockStatus`: `fLifetimeDecrease = upsampledWeight / (jitterLen · avgLanczosWeight)`,
killed if the pixel's estimated next-frame UV leaves the screen.

### (c) Reactive mask + luminance instability

`ComputeLumaInstabilityFactor` keeps a **4-frame luma history** (N-1..N-4, 8-bit
quantized); when current luma differs from history with *consistent sign*, flags
instability and re-injects history to suppress fireflies/flicker — but only where
depth-clip, accumulation mask, and reactive factor are all `< 0.1` and the sample
isn't new. `ComputeTemporalReactiveFactor` stores next-frame reactivity (with a
sign bit) in history alpha: `if saturate(hrVelocity*10) >= 1: factor *= -1` (sign
encodes "was in motion last frame"). Game-supplied reactive mask forces the current
frame through on translucent surfaces (particles/alpha).

### (d) Base accumulation

`ComputeBaseAccumulationWeight` = `fMaxAccumulationLanczosWeight ·
(1 − reactiveFactor)·(1 − depthClipFactor)`, further reduced as velocity /
"in motion last frame" rise. `Accumulate` = standard exponential blend
`history = lerp(history, upsampled, upsampledWeight/accum)` in YCoCg (optional HDR
tonemap round-trip).

## FSR3 vs FSR2, and current state (verified July 2026)

- **FSR3's upscaler (FSR 3.1)** ≈ FSR2's algorithm, decoupled into `FfxFsr3Upscaler`
  so it ships/updates independently; headline addition is **optical-flow Frame
  Generation** + Anti-Lag (orthogonal to the spatiotemporal upscaler). FSR 3.1 also
  improved ghosting and added a stable API/DLL.
- **DLSS / XeSS** replace the hand-tuned rectification/clamp with a **trained
  network** (DLSS 2+ conv autoencoder; DLSS 3.5 Ray Reconstruction; XeSS on XMX or
  DP4a fallback). Disocclusion/lock logic is *learned*, not exposed as formulas —
  docs give inputs (jittered color, MVs, depth, exposure, optional reactive mask),
  not per-pixel math.
- **FSR 4 / "FSR Redstone"**: AMD's ML upscaler + ML frame-gen + ray regeneration +
  radiance caching, shipped **Dec 10 2025** (Adrenalin 25.12.1), **RDNA 4-only** for
  the ML upscaler (older cards fall back to FSR 3.1). FSR SDK 2.3 added "Upscaling
  4.1" with RDNA 3 support. Intel shipped the **XeSS 3.0 SDK** (2026) with
  multi-frame generation (Windows-only proprietary binaries).

> **Implication for the bench:** the last *analytic* (portable, non-neural)
> upscaler generation is FSR 3.1. A WGSL upscaler should target the FSR2/FSR3.1
> analytic path — DLSS/XeSS/FSR4-ML need tensor/matrix hardware WebGPU doesn't expose.

## Primary sources

- **FSR2 technique manual** — https://gpuopen.com/manuals/fidelityfx_sdk/techniques/super-resolution-temporal/
- **FSR3.1 Upscaler manual** — https://gpuopen.com/manuals/fidelityfx_sdk/techniques/super-resolution-upscaler/
- **GDC 2022: FSR 2.0** slides — https://gpuopen.com/download/GDC_FidelityFX_Super_Resolution_2_0.pdf
- **AMD FSR 3** — https://gpuopen.com/fidelityfx-super-resolution-3/
- **AMD FSR Redstone for developers** — https://gpuopen.com/learn/amd-fsr-redstone-developers-neural-rendering/
- **FSR SDK 2.3 (FSR 4.1, RDNA3)** — https://gpuopen.com/learn/amd-fsr-sdk-2-3-blog/
- **UE5 TSR** — https://dev.epicgames.com/documentation/en-us/unreal-engine/temporal-super-resolution-in-unreal-engine
- **Intel XeSS (GDC 2022 coverage)** — https://www.techspot.com/news/93921-intel-gdc-presentation-sheds-more-light-xess-upscaler.html

## Code / implementations

- **FSR2 `ffx_fsr2_accumulate.h`** ⭐ (HLSL/FFX) — `RectifyHistory`,
  `ComputeLumaInstabilityFactor`, `ComputeTemporalReactiveFactor`,
  `ComputeBaseAccumulationWeight`, `Accumulate`, `FinalizeLockStatus`. ✅ fetched.
  https://github.com/GPUOpen-Effects/FidelityFX-FSR2/blob/master/src/ffx-fsr2-api/shaders/ffx_fsr2_accumulate.h
- **FSR2 `ffx_fsr2_lock.h`** (HLSL/FFX) — `ComputeThinFeatureConfidence`,
  `ComputeLock`. ✅ fetched.
  https://github.com/GPUOpen-Effects/FidelityFX-FSR2/blob/master/src/ffx-fsr2-api/shaders/ffx_fsr2_lock.h
- **FSR2 auto reactive-mask** — `ffxFsr2ContextGenerateReactiveMask` /
  https://github.com/GPUOpen-Effects/FidelityFX-FSR2/blob/master/src/ffx-fsr2-api/ffx_fsr2.h
- **Current FidelityFX SDK (FSR 3.1 source)** —
  https://github.com/GPUOpen-LibrariesAndSDKs/FidelityFX-SDK
- **Intel XeSS SDK** — https://github.com/intel/xess (headers/samples only; ML
  kernels not open source).
- **FSR2 → OpenGL/GLSL port** (fully readable) —
  https://github.com/JuanDiegoMontoya/FidelityFX-FSR2-OpenGL

## WGSL portability notes

- **f16 packing**: FSR2 leans on `min16float` + 8-bit packed luma history/masks.
  Run f32 reference; use `pack4x8unorm`/`unpack4x8unorm` for the 8-bit channels.
  Match the exact `round(luma*255)/255` quantization or instability behavior drifts.
- **Sign-bit-in-alpha trick** needs signed float storage — `rgba16float`/`rgba32float`
  (note `rgba16float` isn't a guaranteed storage format in base WebGPU — check caps
  or carry the flag in a separate channel).
- Can't sample and `textureStore` the same texture in one pass — ping-pong (FSR2
  already does).
- **No neural path**: WGSL exposes `dot4I8Packed` (DP4a-like) but no cooperative-
  matrix/XMX equivalent yet — target FSR2/FSR3.1 analytic, not DLSS/XeSS/FSR4-ML.

## Confidence

All FSR2 accumulate/lock math verbatim from source. FSR3 = FSR2 upscaler + frame-gen,
FSR4/Redstone Dec 2025 RDNA4-only, XeSS 3.0 SDK proprietary — verified via GPUOpen /
reputable secondary. DLSS/XeSS per-pixel internals not publicly specified (input/output
level only). FSR3.1 per-file diffs vs FSR2 inferred (repo verified, bodies not pulled).
