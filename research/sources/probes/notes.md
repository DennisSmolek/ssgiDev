# Synthesis: probe/environment fallback for three.js WebGPU SSGI

Research summary only — not a build plan. Companion files: `ssrt3-fallback.md`, `unity-probe-systems.md`, `threejs-probe-options.md`, `directional-ambient.md`.

## The shape of the problem (recap)

SSRT3's port to three.js, `SSGINode.js` (local copy: `research/sources/threejs/SSGINode.js`), already computes exactly the ingredient the fallback needs and then throws it away: per rotation/slice, it builds a 32-bit `globalOccludedBitfield` (`SSGINode.js` line 422 declares it, lines ~509–521 populate it, matching SSRT3's `ComputeOccludedBitfield` bit for bit), but the only consumer is `ao.addAssign( float( countOneBits( globalOccludedBitfield ) ).div( float( MAX_RAY ) ) )` (line 626). There is no `_FallbackSampleCount` loop, no `realTangent`, no probe/environment sample call, no `fallbackPower`/`fallbackIntensity`/`reflectSky` equivalent anywhere in the file — confirmed by grep, matching the task's premise exactly. Both the SSILVB paper (§5, future work) and the CG Spotlight slides ("Limitation: Out of screen light") independently flag this as the known, acknowledged gap in the technique — it isn't something SSRT3/the paper solved elegantly and three.js missed; it's the part everyone agrees is still open, with SSRT3 shipping one practical (Unity-specific) answer.

## Three viable architectures

### A. Global environment fallback via `pmremTexture` (lowest lift, ships today)

Reuse `scene.environment`'s existing PMREM (`pmremTexture`, `src/nodes/pmrem/PMREMNode.js`/`PMREMUtils.js`) as the "reflection probe" analog, and/or `LightProbe`/`getShIrradianceAt` as the "APV" analog — both already exist in three.js **core**, stable, no new baking pipeline.

- **What exists:** `pmremTexture(envMap, direction, roughnessLevel)` for directional radiance sampling with a working roughness→mip curve (`roughnessToMip`); `getShIrradianceAt(direction, shCoefficients)` for directional SH irradiance; `LightProbeGenerator.fromCubeTexture/fromCubeRenderTarget` to build the SH source; the bitmask itself already computed per-slice in `SSGINode.js`.
- **What must be built:** the K-subregion loop (port of SSRT3's `for (uint j = 0; j < _FallbackSampleCount; j++)` block — see `ssrt3-fallback.md` §2–3) in TSL; the stratified fallback-direction construction (`realTangent`/`cos(angleCosine)`/`sin(angleCosine)` — three.js's current slice loop doesn't even compute `realTangent` since nothing needs it yet); exposed uniforms for `fallbackSampleCount`/`fallbackPower`/`fallbackIntensity`; a cone-angle→mip (or just a fixed low mip, as SSRT3 itself ended up doing) decision, since `roughnessToMip` expects a roughness value, not a subregion angular width, and would need re-deriving or reusing loosely.
- **Fidelity ceiling:** no positional variation (single global environment, like Unity's `REFLECT_SKY` degrade-path, not like Unity's parallax-corrected reflection probes) — good for exterior/sky-dominated scenes, weaker for interiors with spatially distinct lighting zones.

### B. `LightProbeGrid`-based fallback (closest match to Unity APV, but immature)

Reuse the brand-new `examples/jsm` SH-irradiance-volume machinery (`LightProbeGrid.js` bake pipeline + `LightProbeGridNode.js` sampling, WebGPU version merged **2026-07-01**, i.e. about two weeks before this research) as a stand-in for Unity's Adaptive Probe Volumes.

- **What exists:** a full GPU bake pipeline (per-probe `CubeCamera` capture → Fibonacci-sphere SH projection → packed RGBA 3D-texture atlas with padding for clean trilinear filtering); `evaluateGridIrradiance(atlas, uvw, res, normal)` which already takes an arbitrary direction, not just `normalWorld`; world-position→UVW mapping with bounds clamping and multi-volume falloff blending.
- **What must be built:** extraction of `evaluateGridIrradiance` (and the atlas unpack/padding constants) into an importable, general-purpose "sample SH atlas at world position + arbitrary direction" utility, since today it's a private helper inside a `Light`/`AnalyticLightNode` that only ever calls it once per fragment with `normalWorld`; wiring the grid's `min`/`max`/`resolution`/`texture` uniforms into `SSGINode`; the same K-subregion loop as architecture A, but calling this instead of/in addition to `pmremTexture`; a decision on multi-grid scenes (bounds selection is handled today only in the Light-node integration path).
- **Risk:** this is `examples/jsm` code, not core, merged roughly two weeks before this research — high risk of API/format churn before a dependent feature would ship. Also the heaviest lift of the three architectures: a full SH-volume bake pipeline is a lot of new machinery if the actual goal is "improve the ambient fallback," not "add irradiance volumes to three.js" as a feature in its own right.

### C. Single global `LightProbe` fallback (cheapest, matches the paper's weakest-praised baseline)

Just call `getShIrradianceAt(fallbackDir, lightProbe.sh)` per K subregion, using a `LightProbe` built once via `LightProbeGenerator`.

- **What exists:** everything — `LightProbe`, `LightProbeGenerator`, `getShIrradianceAt` (confirmed publicly exported from `three/tsl`), all core/stable.
- **What must be built:** only the K-subregion loop + weighting; zero new baking/atlas/grid infrastructure.
- **Fidelity ceiling:** the lowest of the three — one SH probe for the entire scene, no position dependence at all. This is close to exactly the "static, constant-color ambient" option the SSILVB paper itself calls out as the weak, expensive-to-avoid baseline in its future-work paragraph — i.e., architecture C is a legitimate, cheap starting point, but is explicitly the thing the paper's authors were hoping to do better than.

**Framing:** A and C are both available immediately and differ mainly in whether the fallback is a full radiance environment (A, directional + roughness-aware, better for specular-leaning ambient/GGX reuse per the paper's closing note on specular reuse) or a pure SH-diffuse global probe (C, simpler, marginally cheaper). B is strictly higher-fidelity than either but carries real schedule/stability risk given how recently it landed. A pragmatic sequencing is A or C first (both are a few days of TSL work reusing existing core nodes), with B as a later upgrade once `LightProbeGridNode`'s sampling helper has had time to stabilize or be officially exposed.

## Open questions (research-level, not implementation tickets)

1. **Subregion weight normalization convention.** The paper's prose and the CG Spotlight slides both describe normalizing per-subregion (`unoccluded / subregion_sector_count`, each subregion independently capped at 1.0); SSRT3's shipped HLSL instead normalizes by the *whole* 32-bit mask (`unoccluded / MAX_RAY`), making each subregion's ceiling `1/K`. Both are internally consistent ways to reach a total ≤ 1 across all K subregions, but they aren't the same curve as K varies. No source clarifies which is "correct" — it's a design choice to make explicitly, not inherited.
2. **Cone-angle → mip/roughness mapping is unresolved even in the reference implementation.** SSRT3 computes `ambientConeAngle = PI/_FallbackSampleCount` and has a commented-out `MipLevelFromConeAngle` call, but ships a hardcoded `ambientMip = 3` instead. Three.js's `roughnessToMip` expects a roughness value, not a cone angle — there is no existing, validated formula anywhere in the sources gathered for this mapping. It would need to be derived or empirically tuned.
3. **Energy accounting between on-screen bounce and fallback.** SSRT3 relies entirely on the bitmask itself (occluded-vs-unoccluded sectors are complementary by construction) to avoid double-counting between the screen-space bounce term and the fallback term; there's no additional reconciliation once both are combined (`fallbackColor + col * _GIIntensity`, no shared normalization). Whether that's sufficient once fallbackPower/fallbackIntensity are tuned independently of GIIntensity (as SSRT3 allows) is untested/unclear from any source.
4. **Positional fidelity vs. cost.** Architectures A/C give zero positional variation in the fallback; whether that's visually acceptable depends on scene type (matches Unity's own `REFLECT_SKY`/static-ambient options, which the paper treats as the *lesser* of its two shipped fallback choices, with reflection-probe parallax correction as the better one three.js has no equivalent for at all — see `threejs-probe-options.md` summary table, "reflection-probe-style local cubemap" row: does not exist in three.js).
5. **`LightProbeGridNode` API stability and multi-volume composition.** Not fully documented even in its own PR: how multiple `LightProbeGrid` instances compose today (each summed as a separate light vs. some priority/selection) is inferred from a one-line PR description ("multi-volume sampling automatically uses object-origin bounds selection"), not verified against the actual selection code path.
6. **GT-VBAO distant-light-sampling math (Björn Ottosson) remains unverified.** Completely blocked by Shadertoy's Cloudflare wall and a paywalled X thread (see `directional-ambient.md` §3) — if this turns out to be an analytic spherical-cap integration (as its "spherical cap" naming and the surrounding literature suggest) rather than discrete K-sample integration, it could be a meaningfully cheaper alternative to the paper's discrete-subregion approach for the special case of a single distant/directional light, but this is speculative until someone with browser/Twitter access retrieves the actual source.
7. **Performance budget.** SSRT3's own cost model is `RotationCount × FallbackSampleCount` extra probe/cubemap samples per pixel per frame, on top of the existing horizon-march cost; no source in this research measured this specific cost in isolation (SSRT3's Table 1/Table 2 benchmarks are AO/indirect-diffuse only, not fallback-specific) — real cost on WebGPU/mobile for any of the three architectures is unmeasured.

## Discovered links (aggregated)

**SSRT3 / SSILVB core:**
- SSRT3 repo: https://github.com/cdrinmatane/SSRT3 (local clone: `research/sources/ssrt3/`)
- SSILVB paper (arXiv): https://arxiv.org/abs/2301.11376 / https://arxiv.org/pdf/2301.11376 (local: `research/sources/papers/ssilvb-2301.11376.pdf`)
- Readable HTML mirror of paper: https://ar5iv.labs.arxiv.org/html/2301.11376
- CG Spotlight slides post: https://cdrinmatane.github.io/posts/cgspotlight-slides/
- CG Spotlight slides PDF (direct): https://cdrinmatane.github.io/cgspotlight-slides/ssilvb_slides.pdf
- Author's research blog (SSAO code companion post): https://cdrinmatane.github.io/posts/ssaovb-code/
- Semantic Scholar entry: https://www.semanticscholar.org/paper/Screen-space-indirect-lighting-with-visibility-Therrien-Levesque/48917e436f6d1a5b15c793dd21888edf79643a63

**Unity APV / reflection probes:**
- APV concept (HDRP 17.0): https://docs.unity3d.com/Packages/com.unity.render-pipelines.high-definition@17.0/manual/probevolumes-concept.html
- APV concept (URP 6000.0): https://docs.unity3d.com/6000.0/Documentation/Manual/urp/probevolumes-concept.html
- Light probe technical data format: https://docs.unity3d.com/Manual/LightProbes-TechnicalInformation.html
- APV code-level overview (DeepWiki, cites actual Unity Graphics source): https://deepwiki.com/Unity-Technologies/Graphics/4.2-adaptive-probe-volumes
- Light Probe Proxy Volumes (Built-in RP, legacy): https://docs.unity3d.com/Manual/class-LightProbeProxyVolume.html
- Reflection Probes manual: https://docs.unity3d.com/Manual/ReflectionProbes.html
- Reflection Probe (HDRP 14.0): https://docs.unity3d.com/Packages/com.unity.render-pipelines.high-definition@14.0/manual/Reflection-Probe.html
- MipLevelFromConeAngle source technique: https://patapom.com/blog/BRDF/PreIntegration/

**three.js:**
- `LightProbe` docs: https://threejs.org/docs/pages/LightProbe.html
- `LightProbeGenerator` docs: https://threejs.org/docs/pages/LightProbeGenerator.html
- `PMREMNode` docs: https://threejs.org/docs/pages/PMREMNode.html
- `src/nodes/pmrem/PMREMNode.js`, `src/nodes/pmrem/PMREMUtils.js`, `src/nodes/lighting/LightProbeNode.js`, `src/nodes/functions/material/getShIrradianceAt.js` — https://github.com/mrdoob/three.js/tree/dev/src/nodes
- LightProbeGrid PR #33125 (WebGL, merged): https://github.com/mrdoob/three.js/pull/33125
- LightProbeGrid WebGPU example PR #33670 (closed/superseded): https://github.com/mrdoob/three.js/pull/33670
- LightProbeGrid WebGPU PR #33913 (merged 2026-07-01): https://github.com/mrdoob/three.js/pull/33913
- `LightProbeVolume` historical PR #18371 (2016): https://github.com/mrdoob/three.js/pull/18371
- Tetrahedral interpolation issue #16228 (closed, unresolved): https://github.com/mrdoob/three.js/issues/16228
- PMREM generator original issue: https://github.com/mrdoob/three.js/issues/7402

**Directional ambient / distant-light-sampling lineage (partly unverified — see caveats):**
- Mirko Salm GT-VBAO shadertoy: https://www.shadertoy.com/view/3clGWB (and related IDs `wc2SzR`, `wcfGWB`, `wcBGRz` — all Cloudflare-blocked for programmatic fetch)
- Mirko Salm X post: https://x.com/Mirko_Salm/status/1833211198009184650
- Björn Ottosson X thread (paywalled, 402): https://x.com/bjornornorn/status/1891431145172025740
- Spherical cap sampling background (unconfirmed relation to Ottosson's method): https://arxiv.org/pdf/2306.05044, https://cg.ivd.kit.edu/english/sampling_spherical_caps.php, https://dl.acm.org/doi/10.1145/3320282

## Fetch failures (for the record)

- `shadertoy.com/view/{wc2SzR,wcfGWB,wcBGRz,3clGWB}` — HTTP 403 (Cloudflare) via WebFetch, confirmed again this session.
  - **UPDATE (post-gather):** full multi-pass source for `wcfGWB` (GT-VBAO distant light sampling), `wcBGRz` (Light&Occluder Heuristic), and `3clGWB` (thickness heuristic) — all by Björn Ottosson — was later recovered from the GabeRundlett/shadertoy-api-shaders archive dump into `research/sources/shadertoy/<ID>/`. `wc2SzR` (Dist. Light Sampling 2) was subsequently captured live via Chrome on 2026-07-17 — all four are now under `research/sources/shadertoy/<ID>/`. The distant-light-sampling analysis in `directional-ambient.md` can now be verified against real code.
- `web.archive.org` mirror of the above — tool refuses to fetch this host at all.
- `x.com/bjornornorn/status/1891431145172025740` — HTTP 402 Payment Required via WebFetch.
- `cdrinmatane.github.io/posts/cgspotlight-slides/` (the HTML post itself, as opposed to the linked PDF) — fetchable, but contains only a header/nav shell with no technical content; the actual content is in the linked PDF, which required a direct binary fetch + local `pdftotext` (poppler was not installed in this environment; installed via `brew install poppler` mid-task) to extract cleanly.
