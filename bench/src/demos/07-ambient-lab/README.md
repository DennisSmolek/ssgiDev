# Demo 07 — Ambient-fallback lab (§3.2 directional ambient)

Pinned to **three@0.185.1**. A focused comparison bench for the SSILVB paper's
§3.2 "Directionally Occluded Ambient Lighting" question: when the screen-space
GI bounce runs dry (off-screen / occluded light), what do you fall back to, and
how do the three three.js ambient sources compare?

## Lineage

- **March / VBAO bitmask / GI gather / temporal / denoise are demo 03's, verbatim.**
  `ssrt-main.wgsl` is forked from `03-ssrt3/ssrt-main.wgsl`; the temporal,
  denoise, lightmask and depth-pyramid passes are copied unchanged. The **only**
  thing this lab changes is the §3.2 fallback stage, so the ambient-source
  comparison is the sole moving part.
- **Reference for the fallback loop:** SSRT3 `SSRTCS.compute` §2–3
  (`research/sources/probes/ssrt3-fallback.md`) — the K-subregion split of the
  32-bit slice bitmask, stratified `realTangent`/normal direction construction
  (paper Fig 8), per-range unoccluded weighting.
- **Ambient-source options** from `research/sources/probes/threejs-probe-options.md`
  (A `pmremTexture`/equirect, B `LightProbeGrid`, C global `LightProbe` SH) and
  the §3.2 prose in `research/sources/probes/directional-ambient.md`.

## The three ambient sources (`ambientSource` param / `?src=A|B|C`)

All three are baked from the **same** analytic scene content, so A/B/C differ
only by REPRESENTATION, not by content. For Cornell the content is an analytic
ray-vs-box model against the six walls (red left, green right, white
back/floor/ceiling, bright ceiling-light disc, open front = dark) — genuinely
positional. For Sponza/zoo it is a position-independent sky gradient.

| Src | What | Position? | Direction? | three API used |
|---|---|---|---|---|
| **A** | Equirect radiance texture, `textureSampleLevel` at cone LOD | No (baked at scene centre) | Yes (per-direction radiance) | demo 03's Source A, `DataTexture` + mip chain |
| **B** | 3×3×3 grid of L2 SH probes, trilerp at world pos → `getShIrradianceAt` per direction | **Yes** (grid, trilinear) | Yes (SH irradiance) | hand-rolled (see below) + `getShIrradianceAt` math |
| **C** | One global L2 SH probe (`getShIrradianceAt` per direction) | No | Yes (SH irradiance) | `getShIrradianceAt` math (core `LightProbe` analog) |

Sources B/C return SH **irradiance** `E(dir)`; A returns per-direction
**radiance** `L`. To make all three energy-comparable at the same
`fallbackIntensity`, B/C apply the Lambertian conversion `L = E/π` in the shader
(`ssrt-main.wgsl`). The SH basis + cosine-lobe constants are ported verbatim from
three's `getShIrradianceAt.js`; the JS-side projection uses three's
`SphericalHarmonics3.getBasisAt` constants (Fibonacci-sphere Monte-Carlo
quadrature, `4π/N` weight) so evaluation is consistent by construction.

### LightProbeGrid API status (Source B) — a finding in itself

three@0.185.1 ships `examples/jsm/lighting/LightProbeGrid.js`, but its own
docstring states: *"this class can only be used with `WebGLRenderer`. A version
for `WebGPURenderer` will be added at a later point"* — it imports
`WebGL3DRenderTarget` / `WebGLCubeRenderTarget` / `WebGLRenderer`. There is **no
`LightProbeGridNode.js`** (the WebGPU sampling helper) anywhere in
`examples/jsm/tsl/lighting/` in this release. The 2026-07-01 WebGPU merge (PR
#33913) the research anticipated is **not in the pinned 0.185.1 build**. So
three's `LightProbeGrid` is genuinely unusable on our `WebGPURenderer` bench.
Per the packet's fall-through instruction, Source B is therefore a **hand-rolled
SH probe grid** (the "manual SH fill" the packet explicitly allows): the same 9
L2 coefficients `LightProbeGrid` would bake, uploaded as a fixed uniform array
(3×3×3 probes × 9 `vec4`) and trilinearly interpolated + `getShIrradianceAt`-
evaluated in WGSL. This is exactly the "extract SH coefficients to a uniform
buffer, sample per fallback direction" path the research flagged as legitimate.

## The two toggles, promoted to first-class experiment axes

- **`fallbackNormalization`** (`?norm=1|0`) — SSRT3 shipped vs paper-literal:
  - **on** (SSRT3): `weight = unoccluded/MAX_RAY`. Each of the K subregions caps
    at `maskSize/MAX_RAY = 1/K`, so the K samples SUM to ≤ 1.0 (energy-conserving).
  - **off** (paper / CG-Spotlight literal): `weight = unoccluded/maskSize`, each
    subregion normalized to itself (cap 1.0) and SUMMED with **no** global `/K`,
    so the total can reach K when several subregions are open (over-counts).
  - (Note: `unoccluded/maskSize /K` — a naive reading of "paper" — is
    algebraically identical to SSRT3's `unoccluded/MAX_RAY`; the genuine
    divergence is whether the global `/K` normalization is applied at all.)
- **`coneMip`** (`?conemip=1|0`) — cone-angle→mip formula
  (`mipFromConeAngle(π/K, envSize)`, patapom pre-integration) vs SSRT3's
  hardcoded mip 3. Only affects Source A (the mip-chained equirect).

## Params & URL overrides

Same SSRT3 tunable set as demo 03 (rotation/step counts, radius/thickness,
GI/AO intensity, firefly clamp, temporal/denoise) plus the ambient axes above.
`gatherGI` + `useBitmask` default **on** so the on-screen bounce and fallback
coexist (the realistic composite). Debug views `combined`/`gi`/`ao`/`beauty`
(+ `-raw`); `gi` with `gatherGI` off isolates the **pure fallback term**.
URL: `?demo=07-ambient-lab&scene=&src=A|B|C&view=&cam=px,py,pz,tx,ty,tz&
fallback=&gi=&norm=&conemip=&fbsc=&fbi=&giExposure=&rc=&sc=&radius=&thickness=`.
`?cam=` is a harness-level deterministic camera override added for this lab.

## Decisions for review

- **Source B is a hand-rolled SH grid, not three's `LightProbeGrid`** — forced,
  because the WebGPU `LightProbeGrid` node does not ship in 0.185.1 (above). The
  grid is fixed at 3×3×3 = 27 probes uploaded in the main uniform buffer (243
  `vec4` ≈ 3.9 KB, well under the 64 KB uniform limit) — no storage-buffer
  binding kind added to `RawComputePass`, keeping the harness untouched.
- **Ambient content is analytic (ray-vs-box for Cornell), not a live cube bake.**
  `LightProbeGenerator.fromCubeRenderTarget` *does* support WebGPU in 0.185.1, but
  a deterministic analytic bake (same model feeding A, B and C) isolates
  representation from content and is headless-reproducible. Sponza/zoo get a sky
  gradient (position-independent → B collapses to C there, an honest result).
- **B/C `E→L` (÷π) conversion** so sources sit at one scale; `fallbackIntensity`
  is still the per-source tuning knob (as SSRT3 intends).
- **`?cam=` harness override** (`app.ts`) added for deterministic wall-edge-on
  captures — additive, isolated, other demos ignore it.
- **Cornell equirect content upgraded** from demo 03's flat neutral to the
  directional ray-vs-box bake, so Source A can actually exhibit directionality
  (demo 03's flat cornell env was, correctly, directionally flat).

## Validation

Headless Playwright (cached chromium-1228, `--enable-unsafe-webgpu`,
chrome-for-testing binary), 1280×800, screenshots `bench/screenshots/07-*.png`.
Typecheck + build green; zero page errors on all captures.

## Findings

1. **The fallback works and is the headline win.** With `fallback` off, surfaces
   that receive no on-screen bounce collapse to their direct-lit value only
   (`07-cornell-nofallback` / `07-cornell-wall-nofb`); with it on, every source
   restores a plausible dim indirect floor (`07-cornell-src-{a,b,c}`,
   `07-cornell-wall-{a,b,c}`). The fallback term is **temporally rock-stable by
   construction** — it is a texture/SH lookup, not a screen-space march, so as
   screen light vanishes (flat wall filling the frame) it adds a smooth,
   flicker-free tint while the GI term is the noisy part.

2. **Directionality is real and source-dependent — this is the richest finding.**
   Isolating the pure fallback (`gatherGI` off, `view=gi`):
   - **A (equirect, centre bake)** and **C (global SH, centre bake)** produce the
     same *directional-occlusion* tint: the red-wall side of the box gets a
     **green** ambient and the green-wall side gets **red**
     (`07-cornell-fbonly-a`, `07-cornell-fbonly-c`). This is **correct and is
     exactly §3.2's point**: the near wall self-occludes its own hemisphere
     sectors, so the ambient that reaches the receiver arrives through the *open*
     (opposite-wall) directions. The bitmask weighting is doing its job — this is
     the "light passes behind surfaces / colour varies with occlusion
     directionality" behaviour, not a flat AO-multiply.
   - **B (positional SH grid)** *flips* it: red-wall surfaces get **red** ambient,
     green-wall surfaces green (`07-cornell-fbonly-b`). The probe nearest the red
     wall has a red-dominant DC/L0 coefficient (the wall subtends a huge solid
     angle from that position), and SH is too low-frequency for the per-direction
     occlusion weighting to redirect it — so **positional** proximity dominates.
   - Verdict on "does the red side get red ambient?": **only the positional grid
     (B) says yes**; the directional-occlusion sources (A, C) correctly say the
     red side gets the *open opposite* colour. Both are directional (neither is
     flat) but they encode different physics — position-dependent GI (B) vs
     directional-occlusion of a global source (A/C). A is the crisp version of
     C (radiance vs π-smoothed SH), visibly sharper at wall-colour boundaries.

3. **Paper vs SSRT3 normalization — SSRT3's is the energy-plausible one.** The
   two "obvious" readings collapse to the same formula (`unoccluded/maskSize /K`
   ≡ `unoccluded/MAX_RAY`); the genuine divergence is whether the global `/K` is
   applied. SSRT3's global normalization keeps the K-subregion sum ≤ 1
   (`07-cornell-norm-ssrt3`, moderate). The paper-literal per-subregion-capped-
   and-summed reading has no global cap and **blows out toward white**
   (`07-cornell-norm-paper`) — up to K× energy when several subregions are open.
   SSRT3's shipped choice is the correct one to default to; the "paper" reading
   over-counts. (This is why SSRT3 diverged from the slide wording in the first
   place.)

4. **Cone→mip vs hardcoded mip 3 — visible, and mip 3 wins for detail.** On
   Cornell (env with the sharp ceiling-light disc + wall-colour edges) at
   `fbsc=8`, the cone→mip formula selects mip ≈ 4.7 for a π/8 cone vs the
   hardcoded 3, i.e. a **blurrier** sample: `07-cornell-conemip` is visibly
   washed out and low-contrast next to `07-cornell-mip3`, which keeps saturated
   directional colour. On **Sponza** the env is a smooth low-frequency sky
   gradient, so cone→mip vs mip 3 is **imperceptible** (`07-sponza-mip3` ≈
   `07-sponza-conemip`) — the mip choice only matters when the ambient source has
   high-frequency content. SSRT3's decision to ship hardcoded mip 3 (rather than
   its own commented-out cone formula) is defensible: it preserves more
   directional detail and the "correct" formula tends to over-blur.

5. **Source choice is nearly free; the fallback itself is ~10%.** Compute-only
   fence timing (Sponza full-res, rotationCount 4, stepCount 24, fbsc 32 = 128
   fallback samples/pixel/frame, min of 5×120 iterations):

   | config | ms/frame | Δ vs fallback-off |
   |---|---|---|
   | fallback OFF | 12.36 | — |
   | A equirect | 13.64 | +1.28 |
   | B SH grid (27 probes) | 13.60 | +1.24 |
   | C global SH | 14.00 | +1.64 |

   All three sources land within ~0.4 ms of each other — the per-source cost
   difference is below the noise floor. A filtered equirect fetch, an 8-corner SH
   trilerp, and a single SH eval all cost about the same. The fallback stage adds
   ~1.2–1.6 ms (~10%) over the bare march even at this deliberately heavy
   fbsc=32; at the default fbsc=4 it is far cheaper. (At light workloads the
   fence method is dominated by rAF/vsync contention — the same sub-8 ms limit
   demo 03 flagged — hence the heavy-workload config for a trustworthy ordering.)

6. **Default recommendation:** **Source A (equirect radiance) as the default.**
   It is the crispest directional result, ships today with zero new machinery
   (demo 03 already had it), costs the same as the SH options, and its
   directional-occlusion behaviour is the §3.2 headline. **Source C** is the
   cheap-and-cheerful static option (one global SH, π-smoothed A). **Source B**
   is the one to reach for when *positional* variation matters (interiors with
   spatially distinct lighting zones) — but on our bench it required hand-rolling
   because three's WebGPU `LightProbeGrid` isn't in 0.185.1; revisit B via three's
   node once a release ships `LightProbeGridNode`. Defaults to ship: `src=A`,
   `fallbackNormalization=on` (SSRT3), `coneMip=off` (mip 3).
