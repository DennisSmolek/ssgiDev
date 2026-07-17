# Screen-Space AO / VBAO / DDGI Research — Handoff Notes

Context: evaluating ambient occlusion strategy for a Three.js WebGPU renderer, starting from "is GTAO (2016) still state of the art," through a code review of Three.js's `SSGINode`, to how AO should evolve if the renderer later adopts DDGI for global illumination.

---

## 1. AO Technique Lineage

| Technique | Year / Origin | Core idea |
|---|---|---|
| SSAO | ~2007 | Cheap hemisphere-sample hack, visible artifacts |
| HBAO | 2008, Nvidia | Marches several screen-space directions per pixel, finds the *horizon angle* (steepest angle blocked by geometry) in each — a heuristic, not calibrated to ground truth |
| **GTAO** | 2016, Activision (Jimenez et al.) | Same horizon-marching idea as HBAO, but the integration math is reformulated and calibrated against ground-truth (brute-force ray-traced) AO. This is what Three.js's `GTAOPass`/`GTAONode` implements. |
| **VBAO** | 2023, Therrien/Levesque/Gilet ([arXiv 2301.11376](https://arxiv.org/abs/2301.11376)) | Extends GTAO: instead of collapsing each slice direction to a single horizon angle, tracks a **32-bit occluded-sector bitmask**. More accurate (esp. on thin geometry), and the directional data can be reused to gather real indirect bounce light, not just AO. Introduces a constant-thickness heuristic for occluders. |
| **GT-VBAO** | 2024, Mirko Salm (Shadertoy) | Refinements to VBAO that make it match a brute-force ray-marcher: non-uniform slice-sample-density correction, point-sample quantization fix, perspective-correct slice sampling, cosine-weighted hemisphere sampling options. |

**Important clarification:** "horizon" in horizon-based AO refers to the per-direction elevation-angle math (like a horizon line cutting off the sky), *not* physical scale. The effective reach of the effect is controlled by a separate world-space **sample radius** parameter — the same algorithm family works fine for both tight interior contact shadows and large exterior AO, just with different radius settings.

### Where things stand (as of this research, mid-2026)
- GTAO is still the dominant, well-supported screen-space baseline across engines (UE, Unity URP, Godot, Three.js).
- VBAO is the real, meaningful "next step" beyond GTAO — not a full replacement paradigm, an extension of the same horizon-search machinery.
- Industry-wide, the bigger shift isn't "better screen-space AO," it's engines with the budget moving to **ray-traced or hybrid AO** (UE5 Lumen, RTAO) to escape screen-space's fundamental limitation: it can only occlude using what's visible on-screen.

---

## 2. Interior-Space Considerations

- Use a **small world-space radius + high sample density** — interiors are full of close contact points (baseboards, furniture legs, corners, doorframes); a small radius keeps AO reading as crisp contact shadow rather than soft haze.
- Plain scalar AO assumes a uniform ambient sky dome, which breaks down indoors where light comes from a specific window/lamp, not a hemisphere. **VBAO's directional bitmask is valuable here** — it can be combined with a direct-lighting buffer to approximate localized bounce light, which is exactly what `SSGINode` already does (see §4).
- GTAO's paper includes a cheap **multi-bounce approximation** (uses surface albedo to fake secondary bounces) — an easy, worthwhile add for interior look regardless of which core algorithm is used. (Not present in `SSGINode` currently — it does real bounce-light gathering instead, which is arguably better but costs more.)
- Screen-space AO's classic weakness (missing off-screen occluders) matters **less** indoors than outdoors, since most relevant geometry (walls, furniture) is usually already on-screen in a room.

---

## 3. Pairing AO with DDGI (if/when adopted)

- DDGI (probe-based GI) already provides a form of occlusion via its Chebyshev/variance **visibility test** between probe and shading point. This happens in world space, so — unlike screen-space AO — it correctly handles occluders that are off-screen or behind the camera.
- But DDGI probes are sparse (often 0.5–2m spacing), so this occlusion is inherently **low-frequency**: good for "this room is dim because the door's shut," useless for contact-scale detail like a chair leg touching the floor.
- Standard architecture (confirmed via NVIDIA's own DDGI integration guide, and mirrored in UE5 Lumen's `r.Lumen.ScreenProbeGather.ShortRangeAO`): pair the probe-based broad GI/occlusion with a **separate, full-resolution short-range AO pass** just for contact detail.
- Screen-space AO's off-screen weakness barely matters for a *short-range* contact term specifically, because the occluder (chair leg) and the shaded point (floor beneath it) are almost always co-visible in the same frame.
- **RTAO would be the theoretically better pairing**, but: **WebGPU has no hardware ray tracing yet.** It's blocked on bindless resources in the spec, realistically 2027+ if it ships at all. Unofficial community efforts exist (WebRTX, dawn-ray-tracing unofficial Vulkan/D3D12 extensions) but nothing production-viable in-browser today.
- If a scene SDF or voxel structure ends up getting built anyway (likely, since that's the realistic way to update DDGI probes without hardware RT), that same structure could yield off-screen-safe AO "for free" (distance-field AO / voxel cone traced AO) — a more elegant long-term pairing than screen-space AO, but more upfront engineering.

**Recommended sequencing:** ship DDGI + GTAO/VBAO (tight contact radius) first — this is literally the Lumen recipe. Revisit distance-field/voxel AO only once an SDF/voxel structure already exists for other reasons (e.g., driving DDGI probe updates).

---

## 4. Code Review: Three.js `SSGINode`

Source reviewed: [`SSGINode.js`](https://github.com/mrdoob/three.js/blob/dev/examples/jsm/tsl/display/SSGINode.js) (three.js `dev` branch, `examples/jsm/tsl/display/`)

### Key finding: it's already VBAO, not plain GTAO
Despite one code comment referencing "Activision GTAO paper," that comment is only attached to two small **borrowed utility functions** — `GTAOFastAcos` (fast acos approximation) and `spatialOffsets` (temporal dither pattern) — not the core occlusion algorithm.

The real lineage, per the class docstring, is:
- [cdrinmatane/SSRT3](https://github.com/cdrinmatane/SSRT3) — Therrien's Unity reference implementation
- [Therrien's `ssaovb-code` blog post](https://cdrinmatane.github.io/posts/ssaovb-code/)
- `ssilvb_slides.pdf` — "**S**creen **S**pace **I**ndirect **L**ighting with **V**isibility **B**itmask"

### Evidence of the VBAO bitmask in the code
- `globalOccludedBitfield` — a `uint` bitmask, tracked per slice
- `MAX_RAY = uint(32)` — 32 sectors, matching the original VBAO paper's `SECTOR_COUNT`
- `angleHorizonBitfield` / `currentOccludedBitfield` — bit-shifting logic to mark occluded sectors
- `countOneBits(globalOccludedBitfield)` — reduces the bitmask to an occlusion value

Also present: `thickness` and `useLinearThickness` uniforms — the constant/linear-over-distance occluder-thickness heuristic from the VBAO paper.

### It goes beyond AO — real SSGI is built on the same bitmask
Because the bitmask carries *directional* occlusion info (not just a scalar), the shader reuses it to gather actual indirect bounce light: for each sample that's visible per the bitmask (`numOccludedZones.greaterThan(0)`), it samples the beauty buffer's color at that point and accumulates it weighted by normal dot products. This is the full SSILVB technique — AO and indirect diffuse light from the same pass, not just an AO term.

Outputs: `getAONode()` (AO-only texture) and `getGINode()` (GI texture) are exposed separately.

Relevant tunables already exposed: `sliceCount`, `stepCount`, `aoIntensity`, `giIntensity`, `radius`, `useScreenSpaceSampling`, `expFactor`, `thickness`, `useLinearThickness`, `backfaceLighting`.

Denoising is **external/modular** — the docstring notes temporal filtering requires pairing with `TRAANode`, or a manual `DenoiseNode` pass if not using temporal filtering. Not baked into this file.

### What it does NOT include, vs. GT-VBAO refinements

| Refinement | Present? | Assessment |
|---|---|---|
| Quantized arc-length point-sample treatment | ❌ | **Add this first** — described as same instruction count as current approach, i.e. a near-free correctness fix |
| Cosine-weighted hemisphere slice-direction sampling | ❌ | **Highest-value addition** — reduces variance for the same sample count, directly helps since this renderer is already sample-count-constrained and denoiser-dependent |
| Non-uniform slice-local sample pdf correction (CDF remap for pole near view vector) | ❌ | Real bias fix (not just noise), worth adding — **but** `numOccludedZones` also feeds the GI light-intensity weighting here, so any change to bitmask semantics needs validation against **both** `getAONode()` and `getGINode()` output, not AO alone |
| Perspective-correct slice-direction sampling | ❌ | Situational — matters more at wide FOV / VR / screen edges, low priority for typical ~60–90° desktop FOV |
| Improved occluder-thickness heuristic (beyond constant/linear) | ❌ | Worth pursuing only if scenes have significant thin/foliage geometry (fences, leaves, thin walls) where the current heuristic is a known weak point |
| Faster acos | ✅ (own version) | Already has `GTAOFastAcos`; the Shadertoy acos-removal trick isn't worth chasing |

### Recommended enhancement sequencing (if pursuing GT-VBAO refinements)
1. Quantized arc-length point-sample fix — free correctness win
2. Cosine-weighted slice-direction sampling — biggest quality-per-sample win
3. Non-uniform slice-local pdf CDF remap — real bias fix; re-validate GI output alongside AO
4. Perspective-correct slice sampling + improved thickness heuristic — situational, pursue only if specific artifacts appear (wide-FOV distortion or thin-geometry issues)

---

## 5. General Build Strategy Notes (if writing SSAO from scratch elsewhere)

If ever implementing this outside of forking `SSGINode` (e.g., a from-scratch pass):
1. Build and validate GTAO's shared plumbing first: depth linearization, view-space normal reconstruction, per-pixel jittered slice/direction generation, horizon-search loop, mip-mapped depth sampling, spatial + temporal denoising.
2. Only then swap the final integration step for the VBAO bitmask — per Therrien's own writeup, this is a small, isolated change (~10 lines) once the surrounding pipeline is proven correct.
3. Rationale: the pipeline is identical between GTAO and VBAO; isolating correctness at each stage makes debugging tractable, and VBAO introduces a new tunable (thickness) worth understanding on its own.

---

## 6. Possible Build Paths — Summary

- **Option A — Use as-is:** `SSGINode` already bundles VBAO-quality AO + cheap SSGI. Lowest effort.
- **Option B — AO-only fork:** Strip the light-gathering branch (the `luminance(lightColor).greaterThan(0.001)` block and related color accumulation inside `horizonSampling`) to get a cheaper, AO-only pass if GI isn't needed yet.
- **Option C — Incremental GT-VBAO upgrade:** Fork and layer in refinements per the sequencing in §4, keeping the existing GI-gather intact but re-validating it after any bitmask-semantics changes.
- **Option D — Longer-term DDGI adoption:** Move primary indirect diffuse + broad occlusion to DDGI (world-space, off-screen-safe); keep a small-radius `SSGINode`-derived pass purely for contact AO (mirrors the Lumen architecture). Revisit distance-field/voxel AO only if an SDF/voxel structure gets built anyway to drive DDGI probe updates.

**Standing constraint:** WebGPU has no hardware ray tracing today; RTAO is not currently viable in-browser. Realistic timeline for spec support is 2027+, if it happens at all.

---

## 7. Sources

**Papers / core references**
- [Screen Space Indirect Lighting with Visibility Bitmask (VBAO paper, arXiv 2301.11376)](https://arxiv.org/abs/2301.11376)
- [Practical Real-Time Strategies for Accurate Indirect Occlusion (GTAO paper, Activision)](https://research.activision.com/publications/archives/practical-real-time-strategies-for-accurate-indirect-occlusion)
- [Integrating Dynamic Diffuse Global Illumination (DDGI) — NVIDIA Developer Blog](https://developer.nvidia.com/blog/an-engineers-guide-to-integrating-ddgi/)
- [RTXGI-DDGI Algorithms doc — NVIDIAGameWorks](https://github.com/NVIDIAGameWorks/RTXGI-DDGI/blob/main/docs/Algorithms.md)

**VBAO code / writeups**
- [SSAO using Visibility Bitmasks — Olivier Therrien's blog (HLSL code walkthrough)](https://cdrinmatane.github.io/posts/ssaovb-code/)
- [cdrinmatane/SSRT3 — reference Unity implementation](https://github.com/cdrinmatane/SSRT3)
- [Screen Space Indirect Lighting with Visibility Bitmask — GLSL writeup (cybereality)](https://cybereality.com/screen-space-indirect-lighting-with-visibility-bitmask-improvement-to-gtao-ssao-real-time-ambient-occlusion-algorithm-glsl-shader-implementation/)
- [ARK.KRA — VBAO Unreal Engine plugin (forum thread)](https://forums.unrealengine.com/t/ark-kra-vbao-visibility-bitmask-ambient-occlusion/2705204)

**GT-VBAO refinements**
- [SSAO/VBAO Improvements tracking issue — bevyengine/bevy #19713](https://github.com/bevyengine/bevy/issues/19713) (contains all Shadertoy links below plus discussion)
- GT-VBAO main: https://www.shadertoy.com/view/XXGSDd
- GT-VBAO without bidirectional ray marching: https://www.shadertoy.com/view/Xc3yzs
- acos-removal perf trick: https://www.shadertoy.com/view/4cdfzf
- Improved occluder-thickness heuristic: https://www.shadertoy.com/view/3clGWB

**Three.js**
- [`SSGINode.js` — three.js dev branch](https://github.com/mrdoob/three.js/blob/dev/examples/jsm/tsl/display/SSGINode.js)
- [`GTAOPass` — three.js docs](https://threejs.org/docs/pages/GTAOPass.html)
- [`GTAONode` — three.js docs](https://threejs.org/docs/pages/GTAONode.html)
- [Bevy 0.15 release notes (VBAO adoption)](https://bevy.org/news/bevy-0-15/)

**Lumen / engine context**
- [Lumen and Ray Traced Ambient Occlusion — Epic Developer Community forums](https://forums.unrealengine.com/t/lumen-and-ray-traced-ambient-occlusion/236640)
- [Unreal 5 Lighting Features Reference (Lumen short-range AO)](https://medium.com/@shinsoj/lighting-features-cheat-sheet-5b81b63b3ab7)

**WebGPU ray tracing status**
- [WebGPU Future Roadmap (2025–2027) — ray tracing status](https://kaelan.fyi/research/webgpu-future-roadmap/)
- [Ray Tracing extension issue — gpuweb/gpuweb #535](https://github.com/gpuweb/gpuweb/issues/535)
- [WebRTX — community ray tracing via compute shaders](https://github.com/codedhead/webrtx)
- [dawn-ray-tracing — unofficial hardware RT extension for Chromium WebGPU](https://github.com/maierfelix/dawn-ray-tracing)
