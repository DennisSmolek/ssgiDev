# Demo 03 — SSRT3 complete (WebGPU compute port)

Pinned to **three@0.185.1**. Built in stages **a–g** (commit per validated stage).

## Lineage: SSRT3 → this port

- **Source of truth:** cdrinmatane/SSRT3 (Unity HDRP), `HDRP/Shaders/Resources/`:
  `SSRTCS.compute` (the horizon march + 32-bit visibility bitmask + probe
  fallback §3.2 + multibounce + mip/normal opts), `SSRT.shader`
  (temporal reprojection + composite/debug), `DiffuseDenoiser.compute`
  (bilateral). Dispatch/tunables from `Scripts/SSRT_HDRP.cs`.
  Local copies in `research/sources/ssrt3/`.
- **What three's TSL `SSGINode` dropped, restored here:** the probe fallback
  (§3.2 off-screen ambient), multibounce GI + analytic multibounce AO, the mip
  pyramid / `mipOptimization`, and `normalApproximation`. This port also keeps
  SSGINode's fixes (no `stepRadius` double-divide; albedo modulation at
  composite; PI — not PI2 — slice rotation).

## Why compute (not a fragment quad)

Implemented as WebGPU **compute** passes via the new harness `RawComputePass`
(sibling of `RawRenderPass`), dispatched in 8×8 workgroups like SSRT3's
`[numthreads(8,8,1)]`. Compute is deliberate: later bandwidth experiments
(stage g, demo 09) need workgroup shared memory a fragment pass can't express.
Compute outputs are three `StorageTexture`s (STORAGE_BINDING | TEXTURE_BINDING),
so every raw output stays a plain TSL `texture()` node downstream (interop rule).

## Coordinate conventions (traps)

- WebGPU framebuffer/UV origin **top-left**; dispatch `id.xy` are pixel coords.
- Reconstruct **standard three view space** (right-handed, camera looks down −z)
  from depth via `invProj`, consistent with three's `normalView` MRT, then flip
  into SSRT3's `posVS` convention (z **positive** forward, normal.z negated,
  `viewDir = normalize(-posVS)`) so the SSRT3 horizon/bitmask/fallback math ports
  verbatim. The only bridge is reconstruct + flip.
- Slice rotation uses `PI / rotationCount` (issue #29668 PI-vs-PI2 trap).
- `stepRadius` divided by `(stepCount+1)` **once** — SSRT3's screen-space branch
  double-divides; we don't re-import that bug (matches SSGINode's fix).
- **Perspective-only** (`halfProjScale` assumes a perspective camera) — documented
  limitation, acceptable per PLAN.

## Stages

| Stage | What | Status |
|---|---|---|
| a | GTAO plumbing (depth linearize, view reconstruct, slice rotation + jitter, horizon march, classic GTAO integration) | **validated** |
| b | Visibility bitmask (VBAO 32-bit sector mask) | pending |
| c | GI gather (newly-revealed-sector radiance) | pending |
| d | Temporal reprojection + bilateral denoise | pending |
| e | Probe fallback (§3.2) | pending |
| f | Multibounce GI + analytic multibounce AO | pending |
| g | Bandwidth opts (depth mip pyramid, normalApproximation) | pending |

### Stage (a) — GTAO plumbing

`ssrt-main.wgsl` reconstructs view position/normal, rotates `rotationCount`
slices (per-pixel `SpatialOffsets` + `GradientNoise` rotation, optional
`jitterSamples`), marches both horizon directions (`stepCount` geometric steps,
`expFactor`), and integrates a classic **Jimenez-2016 GTAO** slice (max-horizon
angle). Thin occluders fully block the horizon here — the exact over-darkening
the bitmask fixes in stage (b). Output: `giAoTex` rgba16float, `a`=AO (rgb=0
until stage c).

**Validation (cornell):** `screenshots/03a-cornell-ao.png` vs demo 01 GTAO
`screenshots/03a-cornell-gtao-ref-demo01.png`. Same AO structure — corner
creases, box contact shadows, grazing-face darkening. Stronger than demo 01
because `radius` defaults to 5 (world units, ≈ Cornell's 5.5-unit interior) vs
demo 01's GTAO radius 0.5; noise is single-frame (temporal lands stage d).

## Params (all 23 SSRT3 tunables + display)

Exposed via the harness param schema with SSRT3 defaults where sensible
(`rotationCount` 2, `stepCount` 12, `radius` per-scene, `expFactor` 1,
`GIIntensity` 10, `AOIntensity` 1, `thickness` per-scene, `temporalResponse`
0.35, `denoisingRadius` 0.5, `fallbackSampleCount` 4, firefly clamp **7 as a
param** — SSGINode hardcodes it). Per-scene world-space defaults:
cornell `radius 5 / thickness 0.5`, sponza `8 / 2`, artifact-zoo `3 / 0.3`.

Debug views: `combined`, `ao`, `gi`, `beauty` (raw-vs-denoised split added at
stage d). URL: `?demo=03-ssrt3&scene=&view=`.
