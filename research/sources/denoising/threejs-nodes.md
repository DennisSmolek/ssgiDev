# three.js support nodes for denoising/temporal filtering (dev branch, `examples/jsm/tsl/display/`)

Local copies of the exact source files referenced below live in `research/sources/threejs/`:
`TRAANode.js`, `DenoiseNode.js`, `BilateralBlurNode.js`, `depthAwareBlur.js`, `SSGINode.js`, `GTAONode.js`.

Upstream (dev branch): `https://github.com/mrdoob/three.js/tree/dev/examples/jsm/tsl/display/`

---

## 1. `TRAANode.js` — Temporal Reprojection Anti-Aliasing

**What it does**: A full temporal-reprojection resolve pass built for antialiasing the final beauty buffer. It jitters the camera projection matrix per frame (Halton sequence, 32-sample cycle), reprojects the previous frame's resolved output using per-pixel velocity, and blends it with the current frame using **variance clipping** (neighborhood clamp) plus a luminance-based flicker-reduction blend. It maintains its own history render target (color + depth) internally — it is a self-contained, full-effect node, not a filter you can bolt onto an arbitrary signal.

**Docstring / references** (verbatim):
```
* References:
* - {@link https://alextardif.com/TAA.html}
* - {@link https://www.elopezr.com/temporal-aa-and-the-quest-for-the-holy-trail/}
*
* Note: MSAA must be disabled when TRAA is in use.
```

**Inputs required** (constructor signature):
```js
constructor( beautyNode, depthNode, velocityNode, camera )
```
- `beautyNode` — the color signal to stabilize (would be your SSGI output if repurposed).
- `depthNode` — scene depth (current frame; it maintains its own copy of the *previous* frame's depth internally via `_previousDepthNode` and `copyTextureToTexture`).
- `velocityNode` — **required**, per-pixel screen-space motion vectors (defaults to three.js's built-in `velocity` TSL node if not supplied via `builder.context.velocity`).
- `camera` — needed for near/far, world matrix, and projection-matrix-inverse uniforms (current *and* previous frame, tracked internally).

**Key tunables** (all instance properties, all uniform-backed):
| Property | Default | Purpose |
|---|---|---|
| `depthThreshold` | `0.0005` | Depth delta above which history is considered a disocclusion. |
| `edgeDepthDiff` | `0.001` | 3×3-neighborhood depth delta that flags a pixel as a geometric edge (edges are allowed to keep history even under "disocclusion" because edges normally read as false positives). |
| `maxVelocityLength` | `128` | Pixel-length of velocity beyond which history is fully discarded (weight → 1 for current frame). |
| `useSubpixelCorrection` | `true` | Reduces blur under sub-pixel motion at the cost of a "square pattern artifact" (their words, in the docstring on the property). |

**History rejection logic** (from `setup()`, `resolve` function):
```js
const isValidUV = historyUV.greaterThanEqual( 0 ).all().and( historyUV.lessThanEqual( 1 ).all() );
const isEdge = farthestDepth.sub( closestDepth ).greaterThan( this.edgeDepthDiff );
const isDisocclusion = closestDepth.sub( previousDepth ).greaterThan( this.depthThreshold );
const hasValidHistory = isValidUV.and( isEdge.or( isDisocclusion.not() ) );
```
i.e. history is valid when the reprojected UV is on-screen **and** (it's an edge pixel **or** there's no disocclusion). Then:
```js
const motionFactor = uvNode.sub( historyUV ).mul( textureSize ).length().div( this.maxVelocityLength ).saturate();
const currentWeight = float( 0.05 ).toVar(); // minimum weight
currentWeight.assign( hasValidHistory.select( currentWeight.add( motionFactor ).saturate(), 1 ) );
```
Neighborhood clamp uses **variance clipping** (8-neighbor moment1/moment2 → mean/variance → `clipAABB`), with `varianceGamma` tightened under fast motion (`mix(0.5, 1, motionFactor.oneMinus().pow2())`), followed by luminance-weighted blending (`flickerReduction`) rather than a flat lerp.

**Limitations for AO/GI signals specifically**:
- TRAA is architected as an *antialiasing resolve for the final composited image*, not a generic per-buffer temporal filter. It owns its own history/resolve render targets, jitters the actual camera projection matrix (introducing sub-pixel jitter that must be matched by whatever generates the input signal), and expects a `vec4` beauty-like signal (`super('vec4')`) — using it directly on a 1-channel AO term or a raw pre-albedo GI radiance buffer means carrying unused channels or wrapping/unwrapping.
- Disocclusion rejection is purely **depth-based** (current-vs-reprojected-previous depth + a 3×3 edge test). There is no normal comparison at all. For a GI signal (which can have legitimate large temporal deltas from moving lights/emissives even with zero depth change) this depth-only history validity test will not catch lighting-only disocclusion — it will happily keep stale GI history when only the *lighting*, not the geometry, changed.
- Ghosting risk: because `currentWeight`'s floor is `0.05`, a valid-history pixel can retain 95% weight from history — for AO/GI, this is exactly the ghosting/smearing behavior the task description anticipates when repurposing an AA temporal filter for a GI signal (slow-to-update indirect light trailing behind moving occluders).
- `maxVelocityLength = 128` and `depthThreshold = 0.0005` are tuned for camera/geometry motion typical of antialiasing, not for AO/GI-specific artifacts like the SSILVB paper's banding or the multibounce feedback loop — TRAA has no concept of "GI intensity" or bounce count and would blindly stabilize whatever feedback-loop energy the input signal already contains.
- Screen-edge behavior: `isValidUV` simply discards history when reprojected UV leaves [0,1] (falls back to `currentWeight = 1`, i.e. current-frame-only) — this produces a visible pop for GI/AO at the screen edge as content leaves the disoccluded/edge history, consistent with the general "screen-edge pop" problem for all screen-space effects.

---

## 2. `DenoiseNode.js` — spatial denoiser for AO (and adaptable to GI)

**What it does**: A single-pass, **spatial-only**, bilateral-style edge-aware blur purpose-built for raw AO output (or similarly noisy scalar/vector screen-space data). No temporal component, no history buffer. Docstring explicitly frames it as an AO denoiser:

```
* Post processing node for denoising data like raw screen-space ambient occlusion output.
* Denoise can noticeably improve the quality of ambient occlusion but also add quite some
* overhead to the post processing setup. It's best to make its usage optional (e.g. via
* graphic settings).
*
* Reference: {@link https://openaccess.thecvf.com/content/WACV2021/papers/Khademi_Self-Supervised_Poisson-Gaussian_Denoising_WACV_2021_paper.pdf}.
```

**Inputs required**:
```js
constructor( textureNode, depthNode, normalNode, camera )
```
- `textureNode` — the noisy signal (AO term, or repurposable to GI radiance).
- `depthNode` — required, for view-position reconstruction and depth-similarity weighting.
- `normalNode` — **optional**; if `null`, normals are reconstructed from depth via `getNormalFromDepth()` (no G-buffer normal needed but noisier/less accurate).
- `camera` — for `projectionMatrixInverse` (view-space reconstruction).

**Algorithm**: 16-tap spiral/rotated sample pattern (`generateDenoiseSamples(16, 2, 1)`; 2 rings, radius exponent 1) rotated by a per-pixel + per-frame-`index` blue-noise-like simplex texture (`generateDefaultNoise`, tileable, `RepeatWrapping`) so the rotation angle differs both spatially and across the `index` uniform (frame count), giving spatiotemporal dithering of the sample pattern similar in spirit to Jimenez's approach. Per-tap weight is the product of three similarity terms:
```js
const normalSimilarity = pow( max( normalDiff, 0 ), this.normalPhi );
const lumaSimilarity   = max( 1 - lumaDiff / this.lumaPhi, 0 );
const depthSimilarity  = max( 1 - depthDiff / this.depthPhi, 0 );
const w = lumaSimilarity.mul( depthSimilarity ).mul( normalSimilarity );
```
where `depthDiff` is measured as `abs(dot(viewPosition - viewPos, viewNormal))` — i.e. a **plane-distance** (view-space, along the surface normal) test rather than a raw depth-buffer delta, which makes it much more robust to grazing angles than a naive depth compare.

**Tunables** (uniforms, all mutable at runtime):
| Property | Default | Purpose |
|---|---|---|
| `lumaPhi` | `5` | Luminance-similarity falloff — lower = more edge-preserving/less blur across brightness discontinuities. |
| `depthPhi` | `5` | Plane-distance falloff — lower = tighter surface-adherence. |
| `normalPhi` | `5` | Exponent on normal-dot-product similarity — higher = stricter normal matching. |
| `radius` | `5` | Screen-space sample spread multiplier (multiplies the ring pattern before dividing by resolution). |
| `index` | `0` | Frame counter driving the noise-rotation lookup (must be incremented by the caller each frame — this node does not auto-increment it itself in `updateBefore()`, which only refreshes `_resolution`). |

**Fallback / early-out**: background pixels (`depth >= 1.0`) or degenerate normals (`dot(viewNormal, viewNormal) == 0`) are passed through unfiltered.

**Limitations for AO/GI signals specifically**:
- Purely spatial — zero temporal accumulation, so it does nothing about frame-to-frame flicker/noise; it must be paired with a temporal stage (this is exactly why the SSGINode docstring says "pair with TRAANode... or DenoiseNode otherwise" — they are not equivalent, one is spatial, one is a full temporal AA resolve).
- Fixed 16-tap budget with a screen-space (not world-space) radius (`radius` divides directly by `_resolution`, no depth-based world-space scaling) — unlike SSRT3's diffuse denoiser (see `ssrt3-denoiser.md`) which scales its kernel by distance-to-camera, so at grazing distance/large depth this kernel will proportionally shrink in world-space footprint, and at close range it may be too tight relative to the noise frequency of a GTAO/visibility-bitmask signal.
- Designed for a 1-hemisphere-scalar-like signal (AO); using it directly on an RGB GI radiance buffer works mechanically (the weight math operates on `.rgb` regardless) but `lumaPhi`'s luminance-similarity term was tuned with AO variance in mind — GI radiance has a much larger dynamic range (HDR, potential fireflies) so `lumaPhi=5` will likely need very different tuning and probably a pre-clamp/tonemap step before comparing luminance, or bright fireflies will fail the similarity test and remain un-denoised (isolated bright pixels stay isolated because their luma difference to all neighbors exceeds `lumaPhi`).
- No noise/energy budget control against the *feedback loop* problem the SSILVB paper warns about (§4.3) — it denoises whatever signal it is given each frame; if that signal already contains runaway multibounce energy, the denoiser cannot correct for it.

---

## 3. Bilateral / edge-aware blur and upsample nodes — **three.js does have these**

Contrary to what the SSGINode docstring implies (TRAA or DenoiseNode as the only two options), three.js's `dev` branch also ships two more directly relevant, more general-purpose building blocks in the same `examples/jsm/tsl/display/` folder:

### `BilateralBlurNode.js`
A generic, resolution-scalable, two-pass (horizontal + vertical) bilateral blur node — not AO-specific, no depth/normal dependency at all, purely luminance-based edge stopping:
```
* Bilateral blur smooths an image while preserving sharp edges. Unlike a
* standard Gaussian blur which blurs everything equally, bilateral blur
* analyzes the intensity/color of neighboring pixels. If a neighbor is too
* different from the center pixel (indicating an edge), it is excluded
* from the blurring process.
*
* Reference: {@link https://en.wikipedia.org/wiki/Bilateral_filter}
```
Constructor: `bilateralBlur(node, directionNode, sigma = 4, sigmaColor = 0.1)`. Exposes a `resolutionScale` property (default `1`) that lets it render its internal horizontal/vertical render targets at a *different* resolution than the input — i.e. it is capable of doing a resolution change during the blur, though it does this by simply resampling the input texture at a scaled UV grid rather than a joint high-res-depth/low-res-color bilateral **upsample** (there is no separate high-res guide buffer input — the only per-tap "guide" signal is the luminance of the texture itself, sampled at whatever resolution the pass is running at). So it's edge-aware blur with an optional resolution change baked in, not a dedicated joint-bilateral upsampler in the classic (Kopf et al.) sense of "blur a low-res buffer using a high-res guide".

### `depthAwareBlur.js`
A smaller, function-only (not a class/Node) TSL helper explicitly aimed at exactly this project's use case:
```js
/**
 * Applies one pass of a separable, depth-aware (bilateral) blur to a screen-space signal.
 *
 * The spatial term is a fixed 5-tap gaussian along `directionNode`; the edge-stopping term
 * rejects neighbours whose view-space depth differs from the center, so the signal is smoothed
 * across surfaces but not across silhouettes. Depth rejection is measured relative to `radius`,
 * which keeps it scale invariant. Run it twice (horizontal then vertical) for a full separable
 * blur. Handy for denoising a half-resolution effect such as ambient occlusion.
 */
export const depthAwareBlur = Fn( ( [ inputNode, depthNode, directionNode, camera, sharpness = 2, radius = 1 ], builder ) => { ... } );
```
Note: it explicitly filters only the input's **red channel** (`inputNode.sample(sampleUv).r`) — it is written for a scalar signal (AO) and would need to be called per-channel (or generalized) for an RGB GI signal. Depth-rejection weight:
```js
const depthWeight = exp( abs( viewZ(sampleUv).sub(centerViewZ) ).div(radius).mul(sharpness).negate() );
```
i.e. exponential falloff on the *view-space* depth delta, normalized by a world-space `radius` (keeping it scale-invariant across distance, unlike `DenoiseNode`'s screen-space-only radius). No normal term at all — purely depth-based edge stopping, 5 taps per direction (2 passes = separable). Its own docstring flags the intended use: **"Handy for denoising a half-resolution effect such as ambient occlusion."** This is the closest thing three.js ships to the SSILVB paper's recommended half-res + bilateral-upsample step, though it is a same-resolution depth-aware blur, not a low-res→hi-res upsample by itself (you'd combine it with manual mip/half-res render-target plumbing to get the "upsample" behavior — the file provides the edge-aware weighting, not the resolution-bridging logic itself).

**Search finding**: a repo-wide GitHub code search for `upsample` in `mrdoob/three.js` (`.js` files) returned **no dedicated "joint bilateral upsample" node** — confirming there is no purpose-built "render at half-res, upsample with high-res depth guide" node in three.js today. The two building blocks above (`BilateralBlurNode`, `depthAwareBlur`) are the closest available primitives; a half-res→full-res joint upsample would need to be assembled from these plus manual render-target size management (as `GTAONode`/`SSGINode`/`TRAANode` all do internally with their own `RenderTarget`/`setSize` patterns).

---

## Cross-reference: SSGINode's built-in temporal jitter (context for pairing with the above)

`SSGINode.js` (also in this repo's `research/sources/threejs/`) already performs its own **spatial+temporal sample-pattern rotation**, independent of whatever denoiser is layered on top:
```js
const _spatialOffsets = [ 0, 0.5, 0.25, 0.75 ];
...
this._temporalOffset.value = _spatialOffsets[ frameId % 4 ];
...
const noiseJitterIdx = this._temporalDirection.mul( 0.02 ); // Port: Add noiseJitterIdx here for slightly better noise convergence with TRAA (see #31890 for more details)
const initialRayStep = fract( noiseOffset.add( this._temporalOffset ) ).add( rand( uvNode.add( noiseJitterIdx ).mul( 2 ).sub( 1 ) ) );
```
The inline comment referencing three.js PR/issue `#31890` explicitly ties this jitter scheme to TRAA convergence — i.e. the upstream authors already designed SSGINode's noise pattern with TRAA pairing in mind. `GTAONode.js` uses the same `interleavedGradientNoise` + `screenCoordinate`-driven rotation pattern (Activision GTAO-style), confirming the "Jimenez spatiotemporal offsets" family of techniques is already baked into both existing bitmask nodes at the sampling level — the outstanding gap is purely in the *reconstruction* (denoise/temporal-accumulate/upsample) stage.
