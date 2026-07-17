# Synthesis notes: denoising/temporal/upsampling options for a bitmask SSGI pass on WebGPU

Companion to `threejs-nodes.md`, `ssrt3-denoiser.md`, `techniques-survey.md` in this folder. This file synthesizes *options*, not a build plan — per the research brief, no implementation decisions are made here.

---

## What a denoise/upsample stack could look like, per the gathered sources

The sources converge on the same conceptual pipeline shape, differing mainly in *where the resolution change happens* and *how much of the reconstruction is temporal vs. spatial*:

```
[bitmask SSGI sampling, jittered per-frame]
        ↓
(optional) half-res sampling  ──┐
        ↓                       │ SSILVB §4.3: ~4x cheaper, more flicker/blur
[temporal accumulation / EMA]   │ SSRT3: runs BEFORE spatial denoise
        ↓                       │
[spatial bilateral / edge-aware denoise] 
        ↓                       │
(if half-res) joint bilateral upsample to full-res  ──┘
        ↓
[composite with albedo / direct light]
```

Three distinct architectures observed, any of which is a legitimate starting point:

1. **SSRT3's order**: sample → temporal reprojection (world-position-delta rejection, light corner clamp) → spatial bilateral denoise (distance-scaled world-space radius, Owen-scrambled samples) → optional half-res+`BilateralUpsample` gather. Temporal *before* spatial. See `ssrt3-denoiser.md`.
2. **XeGTAO's order**: sample (with edge info computed inline) → spatial-only 5×5 depth-aware denoise, deliberately **not** doing its own temporal stage, instead relying on the engine's existing TAA to close the temporal loop. Spatial-only, TAA does the temporal job "for free" if the engine already has it. See `techniques-survey.md` §2.
3. **three.js's currently-shipped pairing suggestion** (per SSGINode's own docstring, quoted in the task): TRAANode (full temporal AA resolve, variance clipping, depth+edge disocclusion) **or** DenoiseNode (spatial-only bilateral) — presented as alternatives, not a combined stack. Neither is a purpose-built GI temporal accumulator; TRAA is an AA resolve repurposed, DenoiseNode is an AO-tuned spatial filter repurposed. See `threejs-nodes.md`.

For a WebGPU/TSL project, option 3's existing nodes are the path of least resistance for *reuse*, but the research consistently points out that none of them is a purpose-fit temporal GI accumulator — the closest fit (SSRT3's own dedicated `TemporalReprojPass` + `DiffuseDenoiser`) would need to be reimplemented in TSL rather than reused, since it's Unity HLSL/compute, not a three.js node.

**Half-res + bilateral upsample building blocks already exist in three.js** (`BilateralBlurNode.js`, `depthAwareBlur.js` — the latter's docstring literally says "handy for denoising a half-resolution effect such as ambient occlusion") but there is **no dedicated joint-bilateral upsample node** shipped (confirmed via repo-wide code search, see `threejs-nodes.md`) — assembling the half-res→full-res path would mean combining these primitives with manual render-target size management, following the pattern `GTAONode`/`SSGINode`/`TRAANode` already use internally.

---

## Gotchas recorded by the sources (with citations)

1. **Depth-only disocclusion rejection misses lighting-only changes.** TRAANode's `hasValidHistory` test is depth+edge only, no normal, no lighting-delta check — fine for AA (geometry-driven), risky for GI where a moving light with static geometry produces a legitimate large signal delta that a depth-only test won't flag as "history invalid." (`threejs-nodes.md`, TRAANode section)

2. **SSRT3's rejection is world-position-distance only** — no explicit normal comparison, no user-exposed depth threshold. Simpler/cheaper than TRAA's approach but coarser; worth knowing its `temporalResponse` default (0.35) is the *only* dial available for the ghosting-vs-noise trade-off in that reference implementation. (`ssrt3-denoiser.md`)

3. **SSRT3 defaults, for calibration reference**: `temporalResponse = 0.35` (range 0–1, this is the EMA weight toward current frame — lower = slower/more-stable/more-ghosting-prone); `denoisingRadius = 0.5` (range 0–1, scaled ×0.5 before use, then further scaled by *distance-to-camera* inside the shader, going from `distance/10` down to `distance/50` as distance approaches 500 world units — i.e. their "radius" slider is a multiplier on an already distance-adaptive formula, not a flat world-space or pixel radius). Rotation Count / Step Count are described as "big performance cost, keep as low as possible" — i.e. their tuning philosophy leans on the denoiser to cover for a deliberately cheap sampling budget. (`ssrt3-denoiser.md`)

4. **SSILVB paper §4.3 (page 8, arXiv 2301.11376), banding/jitter advice, quoted verbatim**: "The number of samples taken has a big impact on quality. Having a too low sampling density can introduce banding artifacts. To mitigate the issue, samples are jittered along the sampling direction, as shown in Figure 14." And from the figure caption: "When samples are evenly spaced along the sampling direction, a banding pattern can appear. Jittering the samples along the sampling direction helps mask the banding artifact." — i.e. the paper's own recommended fix for banding is sample-position jitter (trading banding for noise), which then *requires* a downstream denoiser to clean up — jitter and denoise are a matched pair in their own methodology, not independent choices.

5. **SSILVB paper §4.3, half-res claim, quoted verbatim**: "Rendering in half resolution is much more efficient (around 4x), but can introduce more flickering in the image and a blurrier result." The ~4x figure is the paper's own framing (a quarter of the pixels processed), and the cost is explicitly named as *more flickering* (i.e. worse temporal stability, likely compounding gotcha #1/#2 above if paired with a rejection-happy temporal filter) and blur (upsample softening).

6. **SSILVB paper §4.3, feedback-loop warning, quoted verbatim**: "Light intensity needs to be properly balanced when using multi-bounce, or it can cause a feedback loop resulting in lighting accumulation over time." This is a *sampling/GI-intensity* concern (energy balance in the multibounce injection), but it directly compounds with temporal accumulation: a denoiser/temporal-accumulator amplifying an already-unbalanced multibounce signal will accumulate the runaway energy *faster and more smoothly*, potentially masking the divergence until it's visually severe. Any temporal accumulation stage layered on top of multibounce GI should probably have this in mind (e.g. clamping bounce energy before it enters history, not just after).

7. **Screen-edge pops** are a structural property of all screen-space effects, not just this one — TRAANode's own logic makes this explicit: `isValidUV` rejects any reprojected UV outside `[0,1]`, falling back to `currentWeight = 1` (current-frame-only, no history) — meaning content entering/leaving the visible frustum edge always gets a hard cut to un-denoised, non-accumulated data for at least one frame. This is inherent to screen-space information availability, not a bug in any one implementation, and no gathered source claims to solve it — only to bound its visibility (e.g. via vignette-style intensity falloff near edges, not observed as implemented in any source but a plausible mitigation).

8. **Firefly clamping is a documented gap.** None of the three primary sources (three.js nodes, SSRT3, XeGTAO) implement an explicit standalone firefly/luminance clamp stage — the variance-clip/neighborhood-clamp math in TRAA and SSRT3's temporal pass *implicitly* bounds outliers as a side effect, but there's no dedicated max-luminance control anywhere in the gathered sources. Given SSRT3's own feature list includes emissive-surface GI (a common firefly source) and the multibounce feedback-loop risk in #6, this reads as a plausible must-add rather than an optional nice-to-have if the target pipeline supports emissive/bright small sources. (`techniques-survey.md` §6)

9. **Scale of the radius parameter matters and is inconsistently done across sources.** three.js's `DenoiseNode.radius` is a flat screen-space multiplier (divided by `_resolution`, no depth term) — will shrink in world-space footprint with distance. SSRT3's `_DenoiserFilterRadius`/`ComputeMaxDenoisingRadius` and its `depthAwareBlur.js`'s `radius` parameter are both explicitly distance/world-space-scale-aware. If porting/adapting, worth deciding deliberately rather than defaulting to whichever is easiest to wire up.

10. **No open-source engine has shipped the full "half-res + bilateral upsample + combined spatial/temporal denoiser" combination for a GTAO/VBAO-family signal yet**, per Bevy's own PR #7402 and tracking issue #8888 — both list it as a known, desired, still-open item as of the versions researched. This is useful expectation-setting: building this stack for ssgiDev is closing an industry-wide open gap in the open-source space, not just reusing a solved recipe — some amount of the design space here has genuinely not been settled by any reference implementation gathered.

---

## Open questions (not resolved by the gathered sources — flagged for follow-up, not answered here)

- **Normal-buffer availability**: does the ssgiDev pipeline have a G-buffer normal pass available for the denoiser, or would it rely on `getNormalFromDepth()`-style reconstruction (as `DenoiseNode.js` falls back to)? This materially affects denoiser quality (reconstructed normals are noisier, especially at silhouette/grazing angles) and wasn't something any source resolved for a from-scratch WebGPU pipeline specifically.
- **Velocity/motion-vector availability and cost**: TRAA-style and SSRT3-style temporal rejection both assume a velocity buffer already exists (for camera motion at minimum; object motion if dynamic scenes matter). If ssgiDev's scenes are largely static-camera or the velocity pass is expensive to add, this changes which temporal approach (position-delta-based vs. velocity-based) is cheaper to stand up.
- **Whether AO and GI (radiance) channels should share one denoiser pass or be split.** SSRT3 packs GI (rgb) + AO (alpha) into one `float4` and denoises both together with one filter; XeGTAO and three.js's `DenoiseNode`/`GTAONode` are AO-only. No source in this research directly addresses whether a combined AO+GI denoise pass (as SSRT3 does) is preferable to separate passes for a bitmask signal specifically — this seems like a genuine design choice rather than a settled question.
- **How aggressively to firefly-clamp an emissive-surface-driven GI signal** (gotcha #8) — no source gave concrete threshold guidance; this would likely need empirical tuning against ssgiDev's own content.
- **Interaction between SSGINode's existing sampling-stage jitter (`_spatialOffsets`, tied to TRAA convergence per its own code comment referencing three.js #31890) and whatever *new* temporal/denoise stage gets built** — since that jitter was explicitly designed with TRAA pairing in mind, swapping in a different (SSRT3-style, XeGTAO-style, or custom) temporal/denoise approach may need to revisit whether the existing jitter cadence (4-phase, `frameId % 4`) is still the right period, or whether it should change to match a different accumulator's convergence characteristics.
- **Whether a-trous/SVGF-grade multi-pass filtering is ever justified** for this signal class, or whether it's reliably overkill (as reasoned in `techniques-survey.md` §7) — no source directly tested this signal class (bitmask SSGI) against SVGF, so this is inference, not a verified claim.

---

## Discovered links (all sources touched during this research pass)

**Primary implementation sources (local + fetched):**
- three.js `TRAANode.js`, `DenoiseNode.js`, `BilateralBlurNode.js`, `depthAwareBlur.js`, `SSGINode.js`, `GTAONode.js` — `https://github.com/mrdoob/three.js/tree/dev/examples/jsm/tsl/display/` (local copies in `research/sources/threejs/`)
- SSRT3 — `https://github.com/cdrinmatane/SSRT3` (local copy in `research/sources/ssrt3/`), specifically `HDRP/Scripts/SSRT_HDRP.cs`, `HDRP/Shaders/Resources/SSRT.shader`, `HDRP/Shaders/Resources/SSRTCS.compute`, `HDRP/Shaders/Resources/DiffuseDenoiser.compute`
- Olivier Therrien, Yannick Levesque, Guillaume Gilet, "Screen Space Indirect Lighting with Visibility Bitmask", arXiv:2301.11376 — `https://arxiv.org/abs/2301.11376` (local PDF: `research/sources/papers/ssilvb-2301.11376.pdf`; HTML mirror used for search: `https://ar5iv.labs.arxiv.org/html/2301.11376`)
- Intel `GameTechDev/XeGTAO` — `https://github.com/GameTechDev/XeGTAO`, denoiser source `https://github.com/GameTechDev/XeGTAO/blob/master/Source/Rendering/Shaders/XeGTAO.hlsli`, integration example `https://github.com/GameTechDev/XeGTAO/blob/master/Source/Rendering/Shaders/vaGTAO.hlsl`

**Bevy engine references:**
- PR #7402 (SSAO MVP) — `https://github.com/bevyengine/bevy/pull/7402`
- Issue #8888 (SSAO/SSGI followup tracking) — `https://github.com/bevyengine/bevy/issues/8888`
- Issue #19713 (SSAO/VBAO Improvements, GT-VBAO) — `https://github.com/bevyengine/bevy/issues/19713`
- Issue #3632 (original SSAO request) — `https://github.com/bevyengine/bevy/issues/3632`
- GT-VBAO Shadertoy — `https://www.shadertoy.com/view/XXGSDd` (and follow-up `https://www.shadertoy.com/view/Xc3yzs`)
- Olivier Therrien's VBAO blog post — `https://cdrinmatane.github.io/posts/ssaovb-code/`

**AMD / production reference denoisers:**
- FidelityFX CACAO manual — `https://gpuopen.com/manuals/fidelityfx_sdk/techniques/combined-adaptive-compute-ambient-occlusion/`
- FidelityFX-SPD (mip chain generation, referenced by Bevy as a future perf item) — `https://github.com/GPUOpen-Effects/FidelityFX-SPD`
- NVIDIA deinterleaved texturing paper — `https://developer.nvidia.com/sites/default/files/akamai/gameworks/samples/DeinterleavedTexturing.pdf`

**TAA / temporal technique background:**
- Alex Tardif, "TAA" — `https://alextardif.com/TAA.html`
- Emilio López, "Temporal AA and the Quest for the Holy Trail" — `https://www.elopezr.com/temporal-aa-and-the-quest-for-the-holy-trail/`
- msalvi (Marco Salvi), temporal supersampling / variance clipping GDC 2016 slides (referenced inline in TRAANode.js) — `https://developer.download.nvidia.com/gameworks/events/GDC2016/msalvi_temporal_supersampling.pdf`
- playdeadgames temporal AA reference (AABB clipping origin, referenced inline in TRAANode.js) — `https://github.com/playdeadgames/temporal`

**Noise / jitter pattern background (Jimenez spatiotemporal offsets):**
- Jorge Jimenez, "Next Generation Post Processing in Call of Duty: Advanced Warfare" — `https://www.iryoku.com/next-generation-post-processing-in-call-of-duty-advanced-warfare/`
- Alan Wolfe, "Interleaved Gradient Noise: A Different Kind of Low Discrepancy Sequence" — `https://blog.demofox.org/2022/01/01/interleaved-gradient-noise-a-different-kind-of-low-discrepancy-sequence/`
- Alan Wolfe, "Animating Noise For Integration Over Time" — `https://blog.demofox.org/2017/10/31/animating-noise-for-integration-over-time/`
- Bart Wronski, "Dithering part three – real world 2D quantization dithering" — `https://bartwronski.com/2016/10/30/dithering-part-three-real-world-2d-quantization-dithering/`

**Firefly clamping background:**
- "Fixing Fireflies in Blender/Cycles" — `https://blendergrid.com/articles/fixing-fireflies-in-blender-cycles`
- "Reweighting Firefly Samples for Improved Finite-Sample Monte Carlo Estimates" — `https://jo.dreggn.org/home/2018_fireflies.pdf`

**SVGF / à-trous background (context, likely not directly applicable — see gotcha/open-question notes above):**
- Edge-Avoiding À-Trous Wavelet Transform paper (ResearchGate listing) — `https://www.researchgate.net/publication/221248942_Edge-Avoiding_A-Trous_Wavelet_Transform_for_Fast_Global_Illumination_Filtering`
- Example open SVGF implementations: `https://github.com/jacquespillet/SVGF`, `https://github.com/HummaWhite/Project4-CUDA-Denoiser`, `https://github.com/ZheyuanXie/CUDA-Path-Tracer-Denoising`, `https://github.com/TheVaffel/spatiotemporal-variance-guided-filtering`
- vkdt SVGF module readme — `https://jo.dreggn.org/vkdt/src/pipe/modules/svgf/readme.html`
