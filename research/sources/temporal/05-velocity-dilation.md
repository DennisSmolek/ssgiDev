# 05 — Velocity dilation / closest-depth velocity (MED)

**Bench decision this feeds:** demo 18's known 1–2 px beauty fringe at silhouettes
under sustained motion — dilated velocity is the standard fix, needed for the P1
beauty resolve.

---

## Summary + algorithm

At a silhouette, a pixel's own MV may belong to the background while its neighbor
belongs to a fast foreground object → an "MV leak" halo. Sampling the
**nearest-depth** MV in a 3×3 neighborhood makes the whole edge reproject with
the foreground's motion. Karis-2014 / Jimenez trick; FSR2 calls it "dilation."

**FSR2 "Reconstruct & dilate" pass** (manual-sourced; confirmed by `depth_clip.h`
call sites):

```
for each low-res pixel p:
    nearest = argmin_over_3x3_q ( cameraDistance(depth[q]) )   // nearest to camera
                                                               // (min or max per reversed-Z)
    dilatedDepth[p] = depth[nearest]
    dilatedMV[p]    = inputMV[nearest]        // <-- closest-depth velocity
    // reproject depth forward for NEXT frame's disocclusion test:
    uv' = uv(p) + dilatedMV[p]
    // many source px map to one dest px -> resolve nearest via atomic:
    InterlockedMax( reconstructedPrevDepth[ round(uv'*renderSize) ], asuint(depth) )
```

Downstream, `ffx_fsr2_depth_clip.h` consumes `LoadDilatedDepth(iPxPos)` /
`LoadDilatedMotionVector(iPxPos)` and reads the scattered result via
`LoadReconstructedPrevDepth`. GPUOpen manual: *"look at the depth values for a 3×3
neighbourhood … select the depth values and motion vectors … where the depth value
is nearest to the camera … atomic operations resolve the value of the nearest depth."*

Karis uses the same 3×3 closest-depth select before reprojection; CoD dilates with
a cross/box pattern and pairs it with variance-clip color rectification.

## Primary sources

- **High Quality Temporal Supersampling** — Karis, SIGGRAPH 2014.
  https://advances.realtimerendering.com/s2014/ — origin of closest-depth (3×3)
  velocity dilation.
- **Filmic SMAA** — Jimenez 2016.
  https://research.activision.com/publications/archives/filmic-smaasharp-morphological-and-temporal-antialiasing
- **Dynamic Temporal Antialiasing and Upsampling in Call of Duty** (velocity
  dilation + upsampling).
  https://www.activision.com/cdn/research/Dynamic_Temporal_Antialiasing_and_Upsampling_in_Call_of_Duty_v4.pdf
- **FSR2 manual — "Reconstruct & dilate"** —
  https://gpuopen.com/manuals/fidelityfx_sdk/techniques/super-resolution-temporal/
- **GDC 2022: FSR 2.0** slides —
  https://gpuopen.com/download/GDC_FidelityFX_Super_Resolution_2_0.pdf

## Code / implementations

- **FSR2 `ffx_fsr2_reconstruct_previous_depth.h`** ⭐ (HLSL/FFX) — the dilation +
  atomic depth reprojection. Exact "dilated velocity" file.
  https://github.com/GPUOpen-Effects/FidelityFX-FSR2/blob/master/src/ffx-fsr2-api/shaders/ffx_fsr2_reconstruct_previous_depth.h
  ⚠️ File path verified; body would not render through any mirror in this session —
  algorithm above is manual-sourced + corroborated by verbatim call sites in
  `depth_clip.h`. Open the GitHub blob to capture the exact `FindNearestDepth` loop.
- **FSR2 → OpenGL/GLSL port** (readable cross-check) —
  https://github.com/JuanDiegoMontoya/FidelityFX-FSR2-OpenGL

## WGSL portability notes

- **Atomic depth reprojection is the hard part.** `InterlockedMax` → WGSL
  `atomicMax` on an `atomic<u32>` in a storage buffer. Bit-cast float depth
  (`bitcast<u32>(f32)`); for [0,1] depths from a positive projection the raw cast
  is already monotonic so `atomicMax` works directly. **You cannot atomically
  write into a texture in WebGPU** — use a storage buffer sized to render
  resolution, then copy out (or restructure as a gather).
- Reversed-Z: encode the min/max choice as an `override`, consistent with the
  depth-clip pass.
- The 3×3 nearest-depth select itself is a trivial unrolled loop — fully portable;
  keep depth in f32.

## Confidence

Consumers (`depth_clip.h` call sites) and manual prose verified. Exact function
names/loop inside `reconstruct_previous_depth.h` inferred (body not retrievable) —
treat pseudocode as faithful-to-manual, not byte-exact.
