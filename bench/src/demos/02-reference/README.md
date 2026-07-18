# Demo 02 — Brute-force screen-space reference

The ground-truth control every later SSGI demo validates against. A per-pixel
brute-force screen-space ray marcher plus a frame-accumulation mode: with a
static camera it converges over N frames to a low-noise reference for AO and GI.
"Converges to the reference" is the GT-VB\* family's own correctness standard.

Pinned to **three@0.185.1**.

## Lineage

Ported from **Mirko Salm / TinyTexel "GT-VBAO"** (Shadertoy
[XXGSDd](https://www.shadertoy.com/view/XXGSDd)), **Buffer C `ReferenceAO()`** —
the brute-force marcher GT-VBAO itself is validated against
(`research/sources/shadertoy/XXGSDd/buffer-c.glsl`). Salm's marcher is AO-only
and runs on his toy analytic g-buffer; here it is adapted to our real G-buffer
(depth + view-space normal + beauty from three's MRT) and extended to gather GI.

## Semantics inherited from the reference (the important part)

These match `ReferenceAO()` so results are directly comparable to the paper family:

- **Cosine-weighted hemisphere sampling.** A uniform point on the unit sphere is
  drawn, then `dir = normalize(sphereSample + N)` — Salm's exact trick, which
  produces a cosine-weighted lobe about the view-space normal `N`. (Uniform-
  hemisphere weighting is not exposed here; cosine is the GI-relevant case.)
- **Thickness slab hit test.** A marched sample at view-space depth `rayDepth`
  is an occluder iff `surfDepth < rayDepth < surfDepth + thickness`, where
  `surfDepth` is the stored surface depth at the reprojected pixel. Thickness is
  the reference's finite-thickness assumption: geometry is treated as a slab of
  `thickness` world units, so a ray passing *behind* a surface but within the
  slab is blocked, and beyond it passes through. **Thickness is world-space** —
  the default `0.5` matches Salm's constant on our 5.5-unit Cornell scale (PLAN
  trap: Sponza/zoo will need a different value).
- **Geometric step schedule with jittered start.** Each ray takes `steps` samples
  whose spacing grows geometrically from a small `tMin` out to `radius`
  (`t *= pow(radius/tMin, 1/steps)`), with a per-ray random start offset. This
  concentrates samples near the origin, matching the reference's exponential `t`
  (its `Raymarching_Width`/`SampleCount` distribution).
- **First hit wins** (break on occlusion); **miss = sky / no contribution**
  (adds `skyIntensity`, default 0 for the closed Cornell box).
- **Normal-bias origin offset** (`bias` along `N`) to avoid self-occlusion, plus
  the march starting at `tMin > 0`.

### Deviations from Salm (logged)

- **View-space march, not screen-texel march.** Salm marches in screen-texel
  space using reciprocal-`w` interpolation against his toy buffer. We reconstruct
  the origin's **view-space** position from our depth buffer via the inverse
  projection, march in view space, and re-project each sample to a pixel to read
  depth. Same limitations (screen-space depth samples only, thickness slab,
  bounded march length) — cleaner and less trap-prone with a real perspective
  projection. Depth comparison uses positive linear distance `-viewZ`.
- **GI gather added.** On a hit we also read the **beauty** buffer's radiance at
  the hit pixel (firefly-clamped to `maxLuminance`, a tunable — PLAN trap: SSGINode
  hardcodes 7) and accumulate it. Because sampling is cosine-weighted, the per-ray
  mean is an irradiance estimator (∝ `E/π`). **GI is modulated by albedo at
  composite**, not in the marcher (PLAN trap, three PR #31839).
- **WebGPU conventions.** Framebuffer/UV origin top-left (`ndc.y = 1 - 2*uv.y`);
  clip-z in `[0,1]`; right-handed view space, camera down `-z`.

## Outputs / view modes (`view` dropdown or `?view=<mode>`)

| mode       | content                                                              |
| ---------- | ------------------------------------------------------------------- |
| `ao`       | AO only (converged): contact + corner darkening                     |
| `gi`       | GI radiance only (converged): red/green color bleed × `giExposure`  |
| `combined` | `beauty·AO + albedo·GI` — lit scene with AO shadows + GI bleed       |
| `beauty`   | raw lit beauty (sanity passthrough)                                  |
| `split`    | A/B comparator: 1-sample **live** vs **converged** accumulation      |

## Shared ReferencePass (`src/harness/reference-pass.ts`)

The brute-force marcher (`src/harness/reference-marcher.wgsl` — the ONE copy,
moved out of this demo) and its accumulation/pose-reset logic now live in a
shared harness class, `ReferencePass`, so any demo can show a ground-truth
comparison. Demo 02 consumes it: `update()` advances the converged accumulation
(its primary output) every frame, `outputTexture` is sampled by the display
nodes, and `renderSingle()` renders the 1-sample **live** buffer for the split
view. Demos 04/05 use the same class as a lazy validation oracle. Demo 02's
behaviour is unchanged by the extraction.

## Accumulation & reset

- The marcher writes into an **additive-blend** accumulation target (`rgb` = GI
  radiance sum, `a` = AO sum); the display divides by the sample count to recover
  the running mean. No ping-pong: the accumulation texture is stable, so the TSL
  display samples it without per-frame recompiles.
- **Reset** (sample count → 0, next frame clears the buffer) fires on: camera
  move (pose delta over threshold — note the threshold must tolerate OrbitControls
  damping jitter; the pose snapshot is float64 because a float32 `fovHash` self-
  resets every frame), any marcher param change, render-scale/resize, or
  `accumulate` off (then every frame is a fresh 1-sample estimate).
- `max frames` caps accumulation (marcher is skipped once reached, freezing the
  converged result). The **accum samples** readout shows the live count.
- Rays × frames compound: the shipped default (4 rays/pixel × up to 512 frames ≈
  2048 samples/pixel) converges to clean AO/GI on Cornell.
- **Enabling "rotate short box" prevents convergence** (the scene is no longer
  static); keep it off when capturing a reference.

## A/B comparator (harness feature — `src/harness/compare.ts` + `compare.wgsl`)

Generic split-screen / abs-diff of any two textures, reusable by any later demo.

- **Design choice (logged): raw WGSL pass**, not a TSL node. It reuses the proven
  `RawRenderPass` texture-load interop, rebinds whatever GPU textures it is handed
  per frame (ping-pong/resize safe), and needs no TSL recompile when the compared
  sources change.
- **split** mode: texA left of a draggable divider, texB right, with a marker
  line. In this demo texA = 1-sample live, texB = converged accumulation — the
  headline demonstration of what accumulation buys you. Drag the divider by
  grabbing near it (orbit is suspended while dragging so it doesn't reset the
  accumulator).
- **diff** mode: `abs(A − B) · diffAmp`.
- Per-input **scale** (used here as `1` for live and `1/sampleCount` for the
  accumulated sums) and **channel** select (`alpha` = AO, `rgb` = GI) keep it
  generic while letting demo 02 compare the meaningful signal.

## Params

`rays/pixel`, `steps/ray`, `radius` (world), `thickness` (world), `normal bias`,
`accumulate`, `max frames`, `firefly clamp`, `GI strength`, `GI display gain`,
`sky (miss)`, plus comparator `A/B mode` / `A/B channel` / `diff amp`. All are
copy/paste-able as JSON (screenshot-embeddable presets).

## Harness additions made for this demo

- `src/harness/raw-pass.ts` — `RawRenderPass`, a generalized sibling of
  `RawFragmentPass` (demo 00's fixed depth+uniform layout was too narrow). Takes a
  declarative binding list (`depth` / `tex` / `uniform`), optional blend state
  (additive accumulation), and a per-`execute` `loadOp` (clear on reset, load to
  accumulate). Same interop rules: writes into three-allocated targets, reads
  everything with `textureLoad` at render resolution.
- `src/harness/compare.ts` + `compare.wgsl` — the comparator above.
- `src/harness/reference-pass.ts` + `reference-marcher.wgsl` — the shared
  `ReferencePass` (marcher + accumulation + pose-reset), promoted out of this
  demo so demos 04/05 (and later 03) can validate against ground truth.

## Validation (headless, cached Playwright chromium-1228, `--enable-unsafe-webgpu`)

Screenshots in `bench/screenshots/02-*.png` on Cornell at 512 accumulated frames:
`ao` (plausible Cornell AO — contact darkening at box bases, corner darkening),
`gi` (red/green color bleed onto boxes and floor), `combined`, and `split`
(noisy live vs smooth converged). Typecheck + build pass.

## Known limitations / open bugs

- Screen-space only: geometry off-screen or occluded in depth contributes no GI
  and casts no occlusion (inherent to the reference — it shares the algorithm's
  own limitations by design).
- GI display uses a `giExposure` gain purely for viewing the (dim) single-bounce
  irradiance; it does not affect the stored/accumulated values.
- `combined` composite is an interpretable preview (`beauty·AO + albedo·GI`), not
  a physically rigorous relight.
- Sponza/zoo scenes: thickness/radius defaults are Cornell-tuned; retune per scene.
