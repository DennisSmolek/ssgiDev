# What three.js (WebGPU/TSL) offers today as a fallback source

Four candidate sources exist in or near three.js today, at very different levels of maturity. All source excerpts below were pulled directly from `mrdoob/three.js` via `gh api`/raw.githubusercontent (dev branch) on 2026-07-17.

## 1. `LightProbe` + `LightProbeGenerator` — single global SH probe (core, stable)

- Docs: https://threejs.org/docs/pages/LightProbe.html, https://threejs.org/docs/pages/LightProbeGenerator.html
- Source: `src/lights/LightProbe.js`, `src/nodes/lighting/LightProbeNode.js`, `examples/jsm/lights/LightProbeGenerator.js`

**What it stores.** One `SphericalHarmonics3` — 9 `Vector3` coefficients (L2 SH, same coefficient layout as Unity's light probes) — plus a scalar `intensity`. `LightProbeGenerator.fromCubeTexture(cubeTexture)` / `fromCubeRenderTarget(renderer, cubeRenderTarget)` project an existing radiance cubemap into these 9 coefficients (CPU-side integration for `fromCubeTexture`; GPU render-target read for the render-target variant). It's a single global probe — "functionally equivalent to an irradiance environment map" per the docs — with no positional variation at all.

**How it's sampled directionally.** The core WebGPU integration, `LightProbeNode.setup()`:

```js
// src/nodes/lighting/LightProbeNode.js
setup( builder ) {
    const irradiance = getShIrradianceAt( normalWorld, this.lightProbe );
    builder.context.irradiance.addAssign( irradiance );
}
```

`getShIrradianceAt` (`src/nodes/functions/material/getShIrradianceAt.js`, publicly exported from `three/tsl` — confirmed via `src/nodes/TSL.js:174` and `src/Three.TSL.js:210`) is a **direction-in, irradiance-out** TSL function:

```js
const getShIrradianceAt = Fn( ( [ normal, shCoefficients ] ) => {
    const x = normal.x, y = normal.y, z = normal.z;
    let result = shCoefficients.element( 0 ).mul( 0.886227 );                                    // L0
    result = result.add( shCoefficients.element( 1 ).mul( 2.0 * 0.511664 ).mul( y ) );            // L1
    result = result.add( shCoefficients.element( 2 ).mul( 2.0 * 0.511664 ).mul( z ) );
    result = result.add( shCoefficients.element( 3 ).mul( 2.0 * 0.511664 ).mul( x ) );
    result = result.add( shCoefficients.element( 4 ).mul( 2.0 * 0.429043 ).mul( x ).mul( y ) );   // L2
    result = result.add( shCoefficients.element( 5 ).mul( 2.0 * 0.429043 ).mul( y ).mul( z ) );
    result = result.add( shCoefficients.element( 6 ).mul( z.mul( z ).mul( 0.743125 ).sub( 0.247708 ) ) );
    result = result.add( shCoefficients.element( 7 ).mul( 2.0 * 0.429043 ).mul( x ).mul( z ) );
    result = result.add( shCoefficients.element( 8 ).mul( 0.429043 ).mul( mul( x, x ).sub( mul( y, y ) ) ) );
    return result;
} );
```

Because this takes an arbitrary `normal`/direction argument (not hardcoded to `normalWorld`), it can be called once per fallback subregion direction exactly the way SSRT3 calls `EvaluateAdaptiveProbeVolume` with a fallback ray direction instead of the real surface normal.

**Limitations.** No position dependence (one probe for the whole scene) — the paper's own critique of "static constant-color" ambient applies directly. But it's the cheapest possible integration: everything needed (`LightProbe`, `getShIrradianceAt`, the uniform-array upload pattern in `LightProbeNode`) already ships in three.js core, nothing experimental.

## 2. `scene.environment` / PMREM via `pmremTexture` TSL node — directional radiance, no position dependence (core, stable)

- Source: `src/nodes/pmrem/PMREMNode.js`, `src/nodes/pmrem/PMREMUtils.js`
- Usage pattern from the node's own doc comment: `material.envNode = pmremTexture( envMap );`

**What it stores.** A prefiltered, mipmapped radiance environment map ("PMREM") baked from either a cube texture or an equirectangular texture (`generator.fromCubemap(...)` / `generator.fromEquirectangular(...)`), stored as a single 2D "cube-UV" atlas texture (all 6 faces packed into one 2D texture per mip, `CubeUVReflectionMapping`) with a full mip chain where **roughness maps to mip level**:

```js
// PMREMUtils.js — the roughness -> mip remap used at sample time
const roughnessToMip = Fn( ( [ roughness ] ) => {
    const mip = float( 0.0 ).toVar();
    If( roughness.greaterThanEqual( cubeUV_r1 ), () => {
        mip.assign( cubeUV_r0.sub( roughness ).mul( cubeUV_m1.sub( cubeUV_m0 ) ).div( cubeUV_r0.sub( cubeUV_r1 ) ).add( cubeUV_m0 ) );
    } ).ElseIf( roughness.greaterThanEqual( cubeUV_r4 ), () => { /* ... */ } )
      .ElseIf( roughness.greaterThanEqual( cubeUV_r5 ), () => { /* ... */ } )
      .ElseIf( roughness.greaterThanEqual( cubeUV_r6 ), () => { /* ... */ } )
      .Else( () => {
        mip.assign( float( -2.0 ).mul( log2( mul( 1.16, roughness ) ) ) ); // 1.16 = 1.79^0.25
    } );
    return mip;
} );
```

**How it's sampled directionally.** `pmremTexture(value, uvNode, levelNode)` — despite the name, `uvNode` is a **3D direction vector**, not a 2D UV; `PMREMNode.setup()` forwards it to `textureCubeUV(texture, direction, level, texelWidth, texelHeight, maxMip)`, which internally does `getFace(direction)` → per-face `getUV(direction, face)` → samples the packed atlas at the right mip with edge-seam blending. So `pmremTexture(scene.environment, someWorldSpaceRayDir, roughnessToMip(coneRoughness))` returns the same kind of "sample the environment in this direction at this blur level" result that SSRT3's `TraceReflectionProbes(..., ambientMip)` produces, minus any positional/parallax correction.

**Limitations.** Exactly one environment for the whole scene (`scene.environment`), no per-object or per-region influence volumes, no box/sphere parallax correction like Unity's reflection probes — closer to Unity's **skybox fallback** (`REFLECT_SKY` branch) than to a probe system with local influence volumes. There is no shipped multi-probe blending/placement manager in three.js analogous to Unity's reflection-probe cache; `CubeCamera`/`WebGLCubeRenderTarget` exist for baking a single (or several manually-managed) real-time cubemap(s), but composing several into one shader query would have to be hand-rolled.

## 3. `LightProbeGrid` + `LightProbeGridNode` — position + direction dependent SH volume (examples/jsm, brand-new, WebGPU-only)

This is the closest three.js analog to Unity's Adaptive Probe Volumes, and it did **not exist** until very recently:
- PR #33125 "LightProbeGrid: Add position-dependent diffuse Global Illumination" (WebGL) — merged 2026-04-16. https://github.com/mrdoob/three.js/pull/33125
- PR #33670 "WebGPU: add LightProbeGrid example" — closed (superseded). https://github.com/mrdoob/three.js/pull/33670
- PR #33913 "LightProbeGrid: Add WebGPURenderer version" — **merged 2026-07-01** (roughly two weeks before this research). https://github.com/mrdoob/three.js/pull/33913
- Related/older, closed, superseded: PR #18371 "LightProbeVolume: Baked lighting for dynamic objects" (2016) https://github.com/mrdoob/three.js/pull/18371, and issue #16228 "Light Probe interpolation using Tetrahedral Tesselations" (closed, unresolved) https://github.com/mrdoob/three.js/issues/16228.
- Source (WebGPU path): `examples/jsm/lighting/LightProbeGrid.js` (bake pipeline), `examples/jsm/tsl/lighting/LightProbeGridNode.js` (sampling/integration).

**What it stores.** A 3D grid of L2 SH irradiance probes (9 coefficients, same basis as `getShIrradianceAt`), baked **entirely on the GPU**: for each probe, a `CubeCamera`/`CubeRenderTarget` captures the local environment, then a projection pass integrates that cubemap against the 9 SH basis functions over an **equal-area Fibonacci sphere** of sample directions:

```js
// LightProbeGrid.js — projectSHNode: one fragment per (coefficient, probe)
const z = float( 1.0 ).sub( fi.mul( 2.0 ).add( 1.0 ).div( sampleCount ) );
const r = z.mul( z ).oneMinus().max( 0.0 ).sqrt();
const phi = fi.mul( GOLDEN_ANGLE );                       // GOLDEN_ANGLE = π(3 - √5)
const dir = vec3( r.mul( phi.cos() ), z, r.mul( phi.sin() ) );
const radiance = cube.sample( dir ).level( 0 ).rgb;
const basis = array( [ /* 9 L2 SH basis functions of dir.x/y/z */ ] ).element( coefIndex );
accum.addAssign( radiance.mul( basis ) );
// normalized by equal-area quadrature: 4π / sampleCount
```

The 9 coefficients are then packed into an **RGBA 3D texture atlas**, 7 texture-depth "slices" of `(nz + 2)` Z-layers each (padding to avoid trilinear bleed across sub-volume boundaries), so hardware trilinear filtering interpolates smoothly across the whole probe grid for free.

**How it's sampled directionally + positionally** — `LightProbeGridNode.js`:

```js
function evaluateGridIrradiance( atlas, uvw, res, normal ) {
    const nz = res.z;
    const paddedSlices = nz.add( 2.0 * ATLAS_PADDING );
    const atlasDepth = paddedSlices.mul( 7.0 );
    const uvZBase = uvw.z.mul( nz ).add( ATLAS_PADDING );
    const slice = ( t ) => atlas.sample( vec3( uvw.xy, uvZBase.add( paddedSlices.mul( t ) ).div( atlasDepth ) ) );
    const s0 = slice(0), s1 = slice(1), /* ... */ s6 = slice(6);
    const sh = array( [ s0.xyz, vec3(s0.w, s1.xy), vec3(s1.zw, s2.x), s2.yzw,
                         s3.xyz, vec3(s3.w, s4.xy), vec3(s4.zw, s5.x), s5.yzw, s6.xyz ] );
    return getShIrradianceAt( normal, sh ).max( vec3( 0.0 ) );
}

// setup(builder): world position -> grid UVW, sample, add to lighting
const samplePos = positionWorld.add( normalWorld.mul( spacing ).mul( 0.5 ) );  // half-probe-spacing normal offset
const uvw = samplePos.sub( min ).div( range ).clamp( 0.0, 1.0 ).mul( resMinusOne ).div( res ).add( vec3( 0.5 ).div( res ) );
const result = evaluateGridIrradiance( texture3D( light.texture ), uvw, res, normalWorld );
builder.context.irradiance.addAssign( result.mul( this._intensity ) );
```

Note `evaluateGridIrradiance` already takes an arbitrary `normal` argument (just like `getShIrradianceAt` itself) — evaluating the same atlas at a fallback-sample direction instead of `normalWorld` is a direct, minimal change; the harder part is that `LightProbeGridNode` is authored as a `Light`/`AnalyticLightNode` that only calls it once (with `normalWorld`) and isn't exposed as a standalone "sample SH-atlas at world position + direction" utility callable from an arbitrary post-process pass like an SSGI node.

**Integration mechanism.** Per PR #33913's description: "`LightProbeGrid` is a `Light` with a custom `LightProbeGridNode` registered via `renderer.library.addLight( LightProbeGridNode, LightProbeGrid )`. The renderer collects and routes it like any built-in light... so it composes with the rest of the lighting and every lit node material picks it up automatically." Multi-volume scenes select bounds via an "object-origin bounds selection" rule (per the PR body) matching the older WebGL addon's behavior; single-volume scenes skip bounds rejection entirely. There's also `falloff`-based smooth boundary blending (`outside.length().smoothstep(0, falloff).oneMinus()`).

**Caveats for reuse in an SSGI fallback:**
- Lives in `examples/jsm`, not `src/` — not part of the stable core API, subject to change without a major-version bump, and (as of this research) merged roughly two weeks ago. High API-churn risk.
- The atlas-sampling helper (`evaluateGridIrradiance`) and the packing scheme (7-slice RGBA layout, `ATLAS_PADDING`) are **not exported** — they're module-private functions in `LightProbeGridNode.js`. Reusing them from an SSGI compute/fragment pass means either importing the file directly (fragile) or vendoring/re-deriving the unpack logic.
- The full GPU bake pipeline (cube camera capture × N probes, SH projection pass, repack pass) is a real feature to stand up — significant engineering weight if the only goal is "give SSGI something better than a flat ambient color to fall back to."
- No documented API yet for querying "what's the SH at world position P" outside the Light-node integration point — would need a small wrapper.

## Summary table

| Source | Position-varying? | Directional? | Maturity | Closest Unity analog |
|---|---|---|---|---|
| `LightProbe` (+ `getShIrradianceAt`) | No | Yes (SH, diffuse-only) | Core, stable | Legacy Light Probes / "static ambient" |
| `scene.environment` (+ `pmremTexture`) | No | Yes (full radiance + roughness→mip) | Core, stable | Skybox / `REFLECT_SKY` fallback |
| `LightProbeGrid` (+ `LightProbeGridNode`) | Yes (grid, trilinear) | Yes (SH, diffuse-only) | `examples/jsm`, ~2 weeks old, WebGPU-only | Adaptive Probe Volumes |
| (none) reflection-probe-style local cubemap w/ box/sphere influence + blending | — | — | **Does not exist** in three.js | Reflection Probes |

No three.js equivalent of Unity's parallax-corrected, multi-probe-blended **reflection probe** system was found in core, `examples/jsm`, or open/closed issues and PRs searched (`"probe volume"`, `"irradiance volume"`, `"light probe grid"`, `"APV"` against `mrdoob/three.js`). The nearest available building blocks for hand-rolling one would be `CubeCamera`/`WebGLCubeRenderTarget`/PMREM generation per probe, with influence-volume selection and blending left entirely to the caller.
