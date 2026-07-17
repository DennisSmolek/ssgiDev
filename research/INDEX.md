# SSGI Research Base — Index

Central map of the gathering run (2026-07-17). Everything below lives under `research/sources/`. This is a research base only — no build decisions are made here. Original link list: [links.md](links.md).

## The lineage in one paragraph

SSILVB paper (Therrien et al. 2022, "visibility bitmask") → SSRT3 (Therrien's Unity HDRP reference implementation) → three.js `SSGINode` (Mugen87's TSL port, deliberately a baseline). In parallel, Mirko Salm (Shadertoy handle **TinyTexel**) built the GT-VBAO/GT-VBGI family — ground-truth-converging refinements of the bitmask idea — and both Salm and Therrien have said on the three.js threads that GT-VBGI is the better target. Björn Ottosson (**bjornornorn**) contributed distant-light-sampling and thickness-heuristic variants. The three big gaps in the three.js port, confirmed across every source: no off-screen/probe fallback (paper §3.2), no multibounce, and none of SSRT3's bandwidth optimizations.

## Directory guide

### `sources/threejs/` — the three.js state of the art
Full comment threads of issue #29668 (34 entries) and PR #31839 (47 entries), Bevy's VBAO tracking issue #19713, plus verbatim `SSGINode.js`, `GTAONode.js`, `DenoiseNode.js`, `TRAANode.js` from the dev branch. `notes.md` has the flagged comments quoted verbatim — including Salm's "why not GT-VBGI?" exchange with Mugen87 and Mugen87's confirmation that SSGINode is a replaceable baseline. Threads also record the port's bug history (PI vs PI2 slice rotation, bitfield corruption fixed in #31873, GI compositing fixed to modulate by albedo) — useful trap-list for any reimplementation.

### `sources/shadertoy/` — the GT-VBAO / GT-VBGI family (verbatim GLSL)
**All 14 shaders captured in full, live from Shadertoy (2026-07-17)** via Chrome browser automation (Cloudflare only blocks headless fetching). Per-shader folders with code + `notes.md` (metadata, defines, discovered links); status and re-capture recipe in `MANUAL-CAPTURE.md`. The 11 originally recovered from the GabeRundlett archive were refreshed with live code and audited — `live-refresh-2026-07-17.md` has the exact archive→live diffs (notable: Salm's post-snapshot `GetQuaternion` +z→−z reference-direction fix across 8 shaders). Highlights:
- `XXGSDd` GT-VBAO (Salm's main, cosine-weighted, converges to brute-force ray-march reference)
- `lfdBWn` / `XcdBWf` / `XfcBDl` GT-VBGI diffuse variants (bidir / unidir / uniformly-weighted)
- `4cdfzf` / `XfcBDl` uniformly-weighted variants (no acos in inner loop → faster)
- `Xc3yzs` / `4ctBRH` unidirectional variants (half the depth samples, denoiser-dependent)
- `wcfGWB` / `3clGWB` / `wcBGRz` Ottosson's distant-light sampling + thickness + light/occluder heuristics
- `wc2SzR` Salm's newer distant-light sampling (spherical caps of constant colors)
- `wcsXDN` slice-relative direction mapping
- `dsGBzW` Mathis's Screen Space Horizon GI (multibounce, temporal accumulation + 3×3 bilateral)

### `sources/ssrt3/` — the Unity reference implementation
`SSRTCS.compute` (the bitmask march **including the probe-fallback sampling** missing from three.js), `DiffuseDenoiser.compute`, `SSRT.shader`, and `SSRT_HDRP.cs` with all 23 tunables (fallback power/intensity/sample-count, reflectSky, multibounce GI/AO, mip optimization, normal approximation, temporal response, denoising radius). `notes.md` maps the five-stage pipeline: pyramid → march+fallback → temporal reprojection → bilateral denoise → composite.

### `sources/papers/` — primary literature
- `ssilvb-2301.11376.pdf` + `ssilvb-paper-notes.md` — **notes transcribed from the actual PDF**: Algorithm 1 verbatim, Table 1 (bitmask costs +0.01–0.02 ms over GTAO; 32 sectors ≈ free, 128 costs 5–10%), Table 2 (GI 0.9–4.0 ms full-res; half-res + bilateral ≈ 4× faster at 1.07 ms), §3.2 subregion-weighted directional ambient, future work (per-pixel thickness, LSAO-style caching, dynamic ambient irradiance).
- `gtao-jimenez2016.pdf` + notes — the GTAO basis (cosine-weighted horizon integration, multi-bounce approximation).
- `therrien-ssaovb-code.md` — Therrien's reference HLSL walkthrough (sector rounding strategies, front/back thickness).
- `cybereality-glsl-port.md` — the GLSL port with real-world gotchas (IGN noise seeding, 50% scale + dual filter, ~50% feedback damping for multibounce, +1.0 blend trick); ~1.1 ms on a 6950XT at 1080p/50%.
- `ssilvb-slides.md`, `tweets.md` (both X links unfetchable; context recovered via search).
- `LineSweemAmbientObscurance.pdf` + `lsao-timonen2013-notes.md` — LSAO (Timonen, EGSR 2013), the caching method SSILVB's future work names as the fix for its bandwidth problem: per-direction line sweeps over the depth buffer with an incremental "obscurance hull" stack → O(K) per pixel, radius-independent, 5.24 ms vs HBAO's 92.5 ms at 1080p on a GTX 480. Compute-only (won't fit a fragment quad), and its largest-occluder-per-direction trick doesn't directly carry over to a bitmask — adaptation is an open problem.

### `sources/hbil/` — the horizon-based predecessor
32 files from Patapom's GodComplex TestHBIL: `HBIL.hlsl` core, brute-force + interleaved compute variants, TAA/reprojection, SH integration, and a CPU reference implementation. Valuable as the analytically-integrated ancestor (closed-form irradiance integrals, bent-normal accumulation) and because its answer to off-screen light was also environment probes.

### `sources/probes/` — off-screen fallback research (§3.2 track)
The deepest analysis track. `ssrt3-fallback.md` walks the actual fallback HLSL: per slice, the 32-bit bitmask is split into K contiguous bit-ranges, one stratified direction per range, sampling APV SH irradiance or reflection-probe cubemaps (+ `reflectSky`), weighted by unoccluded-bit fraction. `threejs-probe-options.md` finds three candidate ambient sources in three.js: **(A)** `pmremTexture(scene.environment)` directional sampling, **(B)** the brand-new `LightProbeGrid`/`LightProbeGridNode` (WebGPU PR merged 2026-07-01 — closest to Unity APV but immature, sampling helper currently private), **(C)** global `LightProbe` + `getShIrradianceAt` (cheapest, static). `notes.md` synthesizes 3 architectures + open questions — notably that SSRT3's shipped normalization diverges from the paper's per-subregion weighting, and that SSRT3 hardcodes fallback mip 3 with the cone→mip formula left commented out.

### `sources/denoising/` — the support pipeline
`ssrt3-denoiser.md` (temporal reprojection with world-position-delta rejection, `temporalResponse=0.35`; distance-scaled bilateral, `denoisingRadius=0.5`; an unused half-res upsample "Gather" path), `threejs-nodes.md` (TRAA/Denoise nodes **plus the undocumented `BilateralBlurNode` and `depthAwareBlur`** — the latter explicitly built for half-res AO; no joint-bilateral-upsample node exists), `techniques-survey.md` (8 technique families incl. XeGTAO's denoiser). Key finding: no open-source engine ships the paper's recommended half-res + bilateral upsample + combined spatial/temporal stack for a bitmask signal — it's an open gap, not a recipe to copy.

### `sources/radiance-cascades/` — the exploratory track
19 files: Sannikov's paper PDF (+ notes from the .tex source), tmpvar's explainers, jason.today's WebGL walkthrough, GM Shaders two-parter, implementations survey (2D flatland vs 3D vs screen-space), and deep dives on the two most substantive implementations — **CodyJasonBennett/three-rc** (three.js, screen-space probes, toggleable world-BVH vs screen-space tracing — the closest working demo of what this project would want) and tlegoc's Vulkan version. Maturity: 2D is settled; PoE2 shipped screen-space-only (explicitly can't see off-screen light); the screen-space-probe/world-space-interval hybrid (paper §4.5) is the active frontier.

## Cross-cutting findings

1. **The upgrade path everyone points to is GT-VBGI, not more SSRT3.** Salm (on the PR): GT-VBAO/GI "converges to the same results that a brute-force screen-space ray-marcher converges to." Mugen87: SSGINode is a baseline, happy to switch. We now hold the full GT-VBGI source (3 variants).
2. **The probe fallback is the biggest missing feature and is well-documented.** Paper §3.2 + slides + SSRT3's shipped HLSL + three viable three.js ambient sources are all captured. The bitmask needed for direction weighting is already computed in SSGINode and currently discarded after AO.
3. **Cost structure is bandwidth, not ALU.** Paper Table 1/2 + SSRT3's mip-optimization and normal-approximation options (both absent from the three.js port) + LSAO-style caching as the paper's own future-work suggestion — the LSAO paper itself is now in the base (`sources/papers/lsao-timonen2013-notes.md`); note it's compute-only (SSGINode is a fragment quad) and its single-largest-occluder shortcut doesn't map 1:1 onto a bitmask.
4. **Denoise/upsample is assembly-required everywhere.** three.js has more pieces than advertised (BilateralBlurNode, depthAwareBlur) but no assembled stack; SSRT3's is the only shipped reference.
5. **WebGPU/WGSL mapping is clean**: `countOneBits` is native; 32 sectors = one u32 register (deliberately — 128 sectors spills to vec4 and costs 5–10%); watch the port traps from the threads (UV origin, view-space handedness, PI2 constants, rg11b10ufloat-renderable requirement).

## Outstanding / manual follow-ups

- [x] ~~Manual capture of 3 shadertoys~~ — all 14 captured live via Chrome, 2026-07-17
- [x] ~~Diff archived shader snapshots against live revisions~~ — done; see `sources/shadertoy/live-refresh-2026-07-17.md`
- [ ] Two X/Twitter threads unfetchable (volfaze; Ottosson's explainer, HTTP 402) — screenshot/paste manually if wanted
- [ ] Radiance-cascades Discord threads have no public archive — community claims are secondhand via tmpvar/GM Shaders/radiance.wiki
