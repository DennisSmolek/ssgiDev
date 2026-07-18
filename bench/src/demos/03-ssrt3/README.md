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

## Pipeline (per frame)

`gbuffer → lightmask(f) → depth-pyramid(g) → main march(a-c,e,g) → temporal(d) →
bilateral denoise(d) → composite(f)`. Six compute passes (five `RawComputePass`
+ the pyramid downsample chain) between three's G-buffer render and the TSL
display. All inter-pass buffers are three `StorageTexture`s (interop rule).

## Stages — all validated

| Stage | What | Status |
|---|---|---|
| a | GTAO plumbing (depth linearize, view reconstruct, slice rotation + jitter, horizon march, classic GTAO integration) | **validated** |
| b | Visibility bitmask (VBAO 32-bit sector mask) | **validated** |
| c | GI gather (newly-revealed-sector radiance) | **validated** |
| d | Temporal reprojection + bilateral denoise | **validated** |
| e | Probe fallback (§3.2) | **validated** |
| f | Multibounce GI + analytic multibounce AO | **validated** |
| g | Bandwidth opts (depth mip pyramid + mipOptimization, normalApproximation) | **validated** |

### Stage (a) — GTAO plumbing
`ssrt-main.wgsl` reconstructs view position/normal, rotates `rotationCount`
slices (per-pixel `SpatialOffsets` + `GradientNoise`, optional `jitterSamples`),
marches both horizon directions (`stepCount` geometric steps, `expFactor`), and
integrates a classic **Jimenez-2016 GTAO** slice. Thin occluders fully block the
horizon here — the over-darkening the bitmask fixes next. **Validation:**
`03a-cornell-ao.png` vs demo 01 GTAO `03a-cornell-gtao-ref-demo01.png` — same AO
structure; stronger because `radius` is 5 world units (≈ Cornell's 5.5) vs demo
01's 0.5.

### Stage (b) — VBAO visibility bitmask
Both hemisphere sweeps share one 32-bit sector mask (`computeOccludedBitfield`);
front/back horizon comes from the world-space `thickness` slab (+ `linearThickness`).
AO = occluded-bit fraction. **Validation:** `03b-zoo-bitmask.png` vs
`03b-zoo-gtao.png` — thin plates over-darken far less; occlusion concentrates at
true contact lines instead of smearing across plate faces.

### Stage (c) — GI gather
Per sample inside the bitmask sweeps, radiance from the light buffer is weighted
by `numOccludedZones` (newly-occluded sectors = the ones this sample is the
closest occluder for) × N·L × lightNormal·L, with `backfaceLighting` and a
per-sample firefly clamp **as a param** (`maxLuminance`, SSGINode hardcodes 7).
**Validation:** `03c-cornell-gi.png` — red bleed from the red wall, green from the
green wall, matching demo 01's GI.

### Stage (d) — temporal + bilateral denoise
`ssrt-temporal.wgsl` reprojects prev-resolved GI/AO along three's velocity
(`prevUV = uv − vel·vec2(0.5,−0.5)`), rejects on world-position delta, 4-neighbour
history clamp (soft `mix 0.25`); ping-pong history. `ssrt-denoise.wgsl` (distilled
DiffuseDenoiser) is a 16-tap disk bilateral with depth+normal edge stops scaled by
`denoisingRadius`. **Validation:** `03d-cornell-gi-denoised.png` vs
`03d-cornell-gi-raw.png` — converged still-camera result far cleaner;
`03d-cornell-moving.png` — camera orbit stays clean, no ghosting trails.

**Real previous-depth pass** (matches SSRT3's `previousDepthTexture`,
SSRT_HDRP.cs). The reproject reads `dPrev` from a real prev-depth buffer, not the
old "current depth at the reprojected coord" proxy. A tiny copy pass
(`ssrt-copydepth.wgsl`) writes the current depth into an r32float StorageTexture
(`prevDepthTex`) each frame AFTER the temporal pass has consumed the prior copy;
next frame's reproject reads it. First frame / resize: the reset short-circuit
(`frameCounter < 2` / `resetTemporal`) emits current before `dPrev` is read, so
the uninitialized copy never rejects startup history.

**Accumulation mode** (`accumMode`, group *temporal & denoise*, **default
`ssrt3-ema`** = SSRT3-faithful):
- `ssrt3-ema` — fixed-`temporalResponse` EMA (0.35, ~3-frame memory). Cannot
  converge SSRT3's 12-frame noise cycle (6 rotations × 4 spatial offsets) →
  residual boil on stills.
- `frame-count` — **our improvement.** A per-pixel frame counter `N` (r16float
  ping-pong, reprojected alongside the GI history) grows while history stays valid
  (`N = min(N+1, accumFrameCap)`) and resets to 1 on disocclusion
  (`posSimilarity < 0.5`), off-screen reproj, or reset. Blend weight `= 1/N`, so a
  static pixel keeps averaging (up to `accumFrameCap`, default 16) and the cycle
  converges. Tradeoff: smoother stills vs more potential motion ghosting; the soft
  neighborhood clamp is kept in both modes to bound it. `N` is written in both
  modes so switching needs no reset.

**Validation (headed, box-top cam):** gi view, two shots 2s apart after 6s
settle — mean abs per-pixel diff `frame-count` ≈ 0.83 (converged), `ssrt3-ema` ≈
3.38 (≈4× more boil). combined view identical & correct in both modes.

### Stage (e) — probe fallback (§3.2), the headline restored feature
Per slice, the same 32-bit mask is split into `fallbackSampleCount` contiguous
ranges; each fires one ambient sample in a direction stratified across the slice
arc (paper Fig 8), weighted by that range's **unoccluded** fraction. Toggles:
`fallbackNormalization` (SSRT3 shipped `unoccluded/MAX_RAY` vs paper
per-subregion `unoccluded/maskSize /K` — the two diverge, a future experiment),
`coneMip` (`MipLevelFromConeAngle` formula vs hardcoded mip 3). Ambient source:
a procedural per-scene **equirect** radiance texture (cornell dim neutral,
sponza/zoo sky gradient), sampled directionally at the cone LOD — see Decisions.
**Validation:** `03e-cornell-gi-fb.png` vs `03e-cornell-gi-nofb.png` — with
fallback the ceiling + camera-facing box front (pure black without it) hold a dim
ambient floor; bleed preserved.

### Stage (f) — multibounce
`ssrt-lightmask.wgsl` builds the march's light source = `beauty +
reproject(prev denoised GI) · (multiBounceGI · mbDamping)`, so second+ bounces
feed back; damping (default 0.5, exposed) keeps the loop convergent. `multiBounceAO`
= the Activision GTAO analytic colored-multibounce AO, at composite (TSL toggle).
**Validation:** `03f-cornell-mb1.png` — mean scene luminance 99.7 (off) → 103.8
(on); early(1.5s) 103.84 vs late(10s) 103.85 → brightness plateaus, no runaway.

### Stage (g) — bandwidth opts
Depth mip pyramid (`ssrt-depth-pyramid.wgsl`, box-min raw depth into mips 0-4 of
a mip-capable r32float StorageTexture) + `mipOptimization` (march samples coarser
mips over distance, SSRT3 `min((j+1)/2, 4)`); `normalApproximation` (reconstruct
the sample normal from position deltas instead of fetching). **Validation:**
`03g-sponza-{mipoff,mipon,naon}.png` — no gross visual regression. Compute-only
GPU timing (sponza, 1280×800, rotationCount 4, stepCount 32, measured via a
`queue.onSubmittedWorkDone()` fence over 60 iterations — not a custom timestamp
set):

| config | compute GPU ms/frame | vs baseline |
|---|---|---|
| baseline (both off) | 15.61 | — |
| mipOptimization on | 8.85 | **−43%** |
| normalApproximation on | 13.59 | −13% |
| both on | 8.21 | **−47%** |

## Params (all 23 SSRT3 tunables + display)

Exposed via the harness param schema with SSRT3 defaults where sensible
(`rotationCount` 2, `stepCount` 12, `radius`/`thickness` per-scene, `expFactor` 1,
`jitterSamples`, `screenSpaceSampling`, `mipOptimization`, `GIIntensity` 10,
`multiBounceGI` 0, `normalApproximation`, `backfaceLighting` 0, `AOIntensity` 1,
`linearThickness`, `multiBounceAO`, fallback (`fallbackPower`/`Intensity`/
`SampleCount`/normalization/coneMip), `temporalAccumulation`, `temporalResponse`
0.35, `denoising`, `denoisingRadius` 0.5). Firefly clamp is **`maxLuminance` 7 as a
param** (SSGINode hardcodes it). Extra harness param exposed by the packet:
`mbDamping` (multibounce feedback damping). Per-scene world-space defaults:
cornell `radius 5 / thickness 0.5`, sponza `8 / 2`, artifact-zoo `3 / 0.3`.

Debug views: `combined`, `ao`, `gi`, `beauty`, plus `ao-raw` / `gi-raw`
(pre-denoise signal — the raw-vs-denoised comparison). URL overrides for
deterministic captures: `?demo=03-ssrt3&scene=&view=&bitmask=&gi=&fallback=&
temporal=&denoise=&mb=&mbao=&mip=&na=&rc=&sc=&radius=&thickness=`.

Works on cornell + sponza + artifact-zoo and at `renderScale` 0.5 (`?scale=0.5`).

## Decisions for review (this port)

- **Fallback ambient source is an equirect texture, not three's cube-uv PMREM.**
  three's PMREM atlas packing (`textureCubeUV` face/seam logic) is impractical to
  sample from a hand-written compute shader, so the fallback samples a procedural
  per-scene equirectangular radiance texture (RGBA8 + mip chain) directionally at
  the cone LOD. Same "directional env at cone mip" as SSRT3's reflection-probe
  fallback (option A in `threejs-probe-options.md`), minus parallax/positional
  correction. Not wired to `scene.environment` — keeps beauty unchanged and
  isolates the fallback term for validation.
- **Temporal prev-depth is now a real buffer** (was: current-depth proxy).
  `ssrt-copydepth.wgsl` refreshes an r32float `prevDepthTex` after each temporal
  pass, matching SSRT3's `previousDepthTexture`; the reproject's world-delta reject
  is accurate under camera motion. See stage (d).
- **Per-frame jitter advance (deviation from SSRT3).** SSRT3 ships a frame-static
  `rand(uv)` for the F_JITTER first-step offset, which the temporal accumulator can
  never average away (lab 10). We advance the rand input per frame by a
  golden-ratio offset driven by `frameSeed` (`rand(uv + frameSeed%64 · φ)`), so it
  decorrelates and temporal accumulation converges it. `frameSeed` is driven from
  the freeze-aware frame counter, so `freezeNoise` pins the jitter too.
- **View-space bridge.** Reconstruct standard three view space, then flip to
  SSRT3's convention so its horizon/bitmask/fallback math ports verbatim.
- **Perspective-only** (`halfProjScale`) — documented, acceptable per PLAN.
- **Three raw-pass classes now exist** (`RawFragmentPass`, `RawRenderPass`,
  `RawComputePass`) — reconcile in the polish pass (flagged since M2).

## Ground-truth comparison views

`reference` / `split` / `diff` compare SSRT3 against the shared brute-force
oracle (harness ReferencePass; see demo 02). Lazy-run: the oracle only marches
while one of these views is active, accumulating ~2-4s on a static camera and
resetting on movement. `A/B channel` alpha = AO (default, cleanest comparison);
rgb = GI with the demo side divided by GIIntensity (SSRT3 gathers with a
non-physical gain; the oracle gathers at unit strength). Expect a systematic
AO offset (~0.1) and a large GI scale gap at unit gain — both are real
algorithmic differences, not wiring bugs (WORKLOG 2026-07-18).
