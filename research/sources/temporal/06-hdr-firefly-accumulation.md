# 06 — HDR weighting + firefly-safe accumulation (MED)

**Bench decision this feeds:** oneOverN's unclamped history is its convergence
superpower and its firefly liability; we need the standard producer-side
mitigation before graduation.

---

## Summary

In HDR, one very bright sample (a firefly, up to ~1000× neighbors) dominates a
linear average — the edge loses its AA and the spike smears through the
accumulator. Keep accumulating in HDR but weight bright samples down.

### Karis reversible-tonemap weight

Accumulate in **tonemapped** space via a reversible tonemap so bright samples
contribute less, then invert after resolve. Karis: `w = 1/(1+luma)`. Lottes (AMD)
replaces luma with `max3(r,g,b)` (no hue shift, one instruction):

```
tonemap(c)         = c / (max3(c.r,c.g,c.b) + 1.0)     // forward, weights bright down
reverse_tonemap(c) = c / (1.0 - max3(c.r,c.g,c.b))     // inverse, restores HDR
TonemapWithWeight(c, w) = c * (w / (max3(c) + 1.0))    // folded weighted form
```

Blend in tonemapped space, then `reverse_tonemap`. A 1000× firefly's tonemapped
value asymptotes toward 1.0, so its blend weight is bounded → the edge erodes
gracefully instead of blooming.

### Luminance-weighted (anti-flicker) blend

```
compressedSource  = source  / (max3(source)  + 1.0)
compressedHistory = history / (max3(history) + 1.0)
sourceWeight  = 0.05 * 1/(1 + Luminance(compressedSource))
historyWeight = 0.95 * 1/(1 + Luminance(compressedHistory))
result = (source*sourceWeight + history*historyWeight)
       / max(sourceWeight + historyWeight, 1e-5)
```

### What protects an *unclamped-history* accumulator (oneOverN) from a 1000× frame?

Three orthogonal mechanisms, none requiring history-vs-neighborhood clamping:

1. **Producer-side max-luminance pre-clamp** — clamp the *current* radiance
   sample before it enters the accumulator (`color = min(color, maxLum)` or on a
   luma proxy). Standard in real-time path tracers; caps per-frame energy at the
   cost of slightly dimmer caustics. **This is the primary guard when you don't
   neighborhood-clamp history.**
2. **Tonemap-space blend** (Karis/Lottes weight) — bounds each sample's
   contribution to <1.0 regardless of HDR magnitude.
3. **YCoCg luma clamp / moment prefilter** — constrain on Y so luminance outliers
   are attenuated while chroma is preserved.

For a path-tracer accumulator: (1) pre-clamp per-sample radiance + (2) accumulate
in tonemapped/weighted space. TAA history clipping (topic 01) is the *TAA* firefly
guard and is orthogonal — which is exactly why oneOverN can keep its unclamped
history *and* stay firefly-safe: move the guard to the producer side.

## Primary sources

- **Graphic Rants: Tone mapping** — Karis, 2013.
  http://graphicrants.blogspot.com/2013/12/tone-mapping.html — origin of `1/(1+luma)`.
- **Optimized Reversible Tonemapper for Resolve** — Timothy Lottes, AMD GPUOpen, 2016.
  https://gpuopen.com/learn/optimized-reversible-tonemapper-for-resolve/ — exact
  `Tonemap`/`TonemapInvert`/`TonemapWithWeight` (max3), "erode instead of expand."
- **High-Quality Temporal Supersampling** — Karis 2014 (TAA between tonemap /
  inverse-tonemap). https://advances.realtimerendering.com/s2014/
- **A Survey of Temporal Antialiasing Techniques** — Yang/Liu/Salvi 2020 (HDR
  weighting + anti-flicker). http://behindthepixels.io/assets/files/TemporalAA.pdf

## Code / implementations

- **GPUOpen reversible tonemapper** (HLSL) — drop-in for a WGSL resolve.
  https://gpuopen.com/learn/optimized-reversible-tonemapper-for-resolve/
  · Shadertoy: https://www.shadertoy.com/view/Xdd3Rr
- **Alex Tardif TAA.html** (HLSL) — luminance-weighted anti-flicker blend tail +
  `max(0, source)` producer-side guard. https://alextardif.com/TAA.html
- **bevy taa.wgsl** (WGSL) — `tonemap`/`reverse_tonemap` via `max3` around the
  whole resolve. https://github.com/bevyengine/bevy/blob/v0.13.0/crates/bevy_core_pipeline/src/taa/taa.wgsl
- **gkjohnson/three-gpu-pathtracer** (JS+GLSL) — exposes a firefly/caustics clamp
  control (producer-side pre-clamp in a web renderer).
  https://github.com/gkjohnson/three-gpu-pathtracer

## WGSL notes

`reverse_tonemap(c) = c/(1 − max3(c))` **diverges as max3→1** — keep accumulation
values safely below 1 in tonemapped space (guaranteed if inputs are non-negative
HDR, since forward tonemap maps `[0,∞)→[0,1)`).

## Confidence

Formulas verbatim from GPUOpen + Tardif HLSL + Bevy WGSL. The three-mechanism
breakdown of what protects an unclamped accumulator is synthesis, consistent with
the sources. three-gpu-pathtracer firefly param confirmed via search; exact shader
file not opened.
