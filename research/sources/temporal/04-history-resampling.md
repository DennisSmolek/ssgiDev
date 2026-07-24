# 04 — History resampling filters (MED)

**Bench decision this feeds:** demo 18 currently nearest/bilinear-reprojects;
long-horizon 1/N accumulation makes resampling blur a first-order quality question
for the P1 graduation build.

---

## Summary

Reprojected history rarely lands on a texel center, so you resample at
`uv − motionVector`. A plain **bilinear** fetch is a low-pass filter applied
*recursively* by the accumulator → over hundreds of frames the image softens
("temporal blur / smearing"). The fix is **Catmull-Rom (bicubic) history
sampling**: an interpolating cubic with **negative lobes** that passes through
the samples and sharpens rather than blurs. Karis 2014 introduced it; now standard.

**Does it still matter at N in the hundreds?** Yes — arguably *more*. The steady-
state blend keeps only ~1/N of the current frame, but the **history term is
resampled every single frame**, so the blur operator compounds geometrically
regardless of blend rate. Because history weight is high (≈1−1/N), history
sharpness dominates the output. Catmull-Rom keeps the recursive operator near
unity-gain at mid frequencies so the image doesn't converge to mush.
Caveat: Catmull-Rom's negative lobes can overshoot/ring on very high-contrast HDR
edges — run variance clipping (01) + HDR weighting (06) alongside.

## The optimized 5/9-tap (bilinear-merged Catmull-Rom)

Naive bicubic = 4×4 = 16 texel gather. The standard optimization (MJP, after
vec3.ca) merges adjacent texels into single hardware-**bilinear** taps. 1D
Catmull-Rom weights for fractional offset `f`:

```
w0 = f*(-0.5 + f*(1.0 - 0.5*f))
w1 = 1.0 + f*f*(-2.5 + 1.5*f)
w2 = f*(0.5 + f*(2.0 - 1.5*f))
w3 = f*f*(-0.5 + 0.5*f)
w12       = w1 + w2
offset12  = w2 / (w1 + w2)
```

Merging the middle columns/rows collapses 4×4 → **3×3 = 9 bilinear taps**
(`SampleTextureCatmullRom`). Dropping the 4 corner taps (CoD / Jimenez 2016, used
by Bevy) gives a **5-tap** filter — corner weights are small, renormalization is
negligible.

## Primary sources

- **High-Quality Temporal Supersampling** — Karis 2014.
  https://advances.realtimerendering.com/s2014/ — introduces Catmull-Rom history +
  Blackman-Harris current-sample reconstruction.
- **Filmic SMAA** — Jimenez 2016.
  https://research.activision.com/publications/archives/filmic-smaasharp-morphological-and-temporal-antialiasing
  · **Dynamic Temporal Antialiasing and Upsampling in Call of Duty** (p.68, corner-skip):
  https://www.activision.com/cdn/research/Dynamic_Temporal_Antialiasing_and_Upsampling_in_Call_of_Duty_v4.pdf
- **Bicubic Filtering in Fewer Taps** — vec3.ca. http://vec3.ca/bicubic-filtering-in-fewer-taps/

## Code / implementations

- **TheRealMJP — SampleTextureCatmullRom gist** ⭐ (HLSL, MIT) — *the* copy-pasted
  9-tap function; exact `w0..w3`, `w12`, `offset12`.
  https://gist.github.com/TheRealMJP/c83b8c0f46b63f3a88a5986f4fa982b1
- **bevy taa.wgsl** (WGSL) — inline **5-tap** corner-skipped Catmull-Rom history
  fetch; directly usable.
  https://github.com/bevyengine/bevy/blob/v0.13.0/crates/bevy_core_pipeline/src/taa/taa.wgsl
- **TheRealMJP/MSAAFilter — Resolve.hlsl** (reconstruction filters).
  https://github.com/TheRealMJP/MSAAFilter/blob/master/MSAAFilter/Resolve.hlsl

## WGSL notes

The tap-merging trick **requires hardware bilinear** — use a `linear_sampler` for
the history taps (and a separate `nearest_sampler` for current/motion/depth).

## Confidence

Tap weights quoted verbatim from the MJP gist; 5-tap corner-skip confirmed in
Bevy WGSL. The "matters more at large N" argument is analysis (recursive-blur-
compounds reasoning), consistent with the sources.
