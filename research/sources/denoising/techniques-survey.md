# Techniques survey: cleaning up SSAO/SSGI signals in production

Concise, link-carrying survey of the standard technique families used to denoise/stabilize/upsample screen-space AO and GI signals, gathered for the ssgiDev bitmask-SSGI support pipeline. Each entry: what it solves, cost, reference.

---

## 1. Temporal accumulation (EMA) + disocclusion rejection

**What it solves**: per-frame Monte-Carlo-style noise (from limited samples/slices per pixel) by trading it for cross-frame variance reduction — spreads the sample budget across time instead of paying for it all in one frame.

**How**: reproject the previous frame's filtered result using motion vectors, blend with the current frame via `result = lerp(history, current, alpha)` where `alpha` (accumulation speed) is raised toward 1 (full reset to current frame) whenever history is judged invalid — typically via depth comparison, normal comparison, world-position distance, and/or velocity magnitude. Neighborhood clamping/clipping (min/max box, or full variance clipping) is layered on to bound how far history can diverge from the current frame's local statistics, preventing runaway ghosting while still smoothing.

**Cost**: one extra full-screen pass, one persistent history render target (RGBA half-float typical), one motion-vector buffer (often already available for TAA). Cheap relative to the sampling pass it's smoothing.

**Concrete implementations gathered in this research**:
- three.js `TRAANode.js` — full variance-clipping neighborhood clamp + depth/edge-based disocclusion + subpixel-motion weighting + luminance-weighted flicker reduction. See `threejs-nodes.md`.
- SSRT3 `TemporalReprojPass` (`SSRT.shader`) — world-space-position-delta rejection + light 4-corner-neighbor clamp; `temporalResponse` param. See `ssrt3-denoiser.md`.
- Reference write-ups: Alex Tardif, ["TAA"](https://alextardif.com/TAA.html); Emilio López, ["Temporal AA and the Quest for the Holy Trail"](https://www.elopezr.com/temporal-aa-and-the-quest-for-the-holy-trail/) (both cited directly in `TRAANode.js`'s docstring).

**Watch-outs**: pure depth-based rejection misses lighting-only disocclusion (light moved, geometry didn't) — relevant specifically to GI signals, not just AO. Ghosting vs. noise is a direct trade-off via the accumulation-speed knob (SSRT3's `temporalResponse`, generically "TAA alpha").

---

## 2. Spatial bilateral / edge-aware filtering

**What it solves**: residual per-frame noise/banding that temporal accumulation alone can't fully remove (e.g., at scene-load / high-motion frames where history is mostly invalidated), and it works standalone without any history buffer at all (useful before a temporal stage exists, or as the only filter when motion vectors aren't available).

**How**: a weighted blur where the weight of each neighbor tap is the product of a spatial (Gaussian) term and one or more "range" similarity terms — typically depth, normal, and/or luminance similarity — so the blur stops at geometric/shading edges instead of bleeding across them.

**Cost**: proportional to tap count (typically 8–32 taps in a rotated/spiral pattern, or separable 2-pass 5–13-tap directional blurs). Depth/normal reads add bandwidth.

**Concrete implementations gathered in this research**:
- three.js `DenoiseNode.js` — 16-tap spiral, luma+depth(plane-distance)+normal similarity, rotated by a tileable simplex-noise texture indexed by frame count. AO-oriented but signal-agnostic in the weight math. See `threejs-nodes.md`.
- three.js `BilateralBlurNode.js` — generic 2-pass (H/V) luminance-only edge-stopping blur, resolution-scalable via `resolutionScale`. See `threejs-nodes.md`.
- three.js `depthAwareBlur.js` — 5-tap separable, view-space-depth-only edge stopping, explicitly documented as *"handy for denoising a half-resolution effect such as ambient occlusion"*. Scalar (red-channel) signal only. See `threejs-nodes.md`.
- SSRT3 `DiffuseDenoiser.compute` (reused from Unity HDRP's ray-tracing denoiser package) — distance-scaled world-space bilateral filter with Owen-scrambled disk sampling, hard background/depth-consistency rejection. See `ssrt3-denoiser.md`.
- Intel **XeGTAO** (`GameTechDev/XeGTAO`) — 5×5 depth-aware spatial filter, explicitly designed as spatial-only and to rely on TAA for the temporal component. Repo: [github.com/GameTechDev/XeGTAO](https://github.com/GameTechDev/XeGTAO). Denoiser source: [`Source/Rendering/Shaders/XeGTAO.hlsli`](https://github.com/GameTechDev/XeGTAO/blob/master/Source/Rendering/Shaders/XeGTAO.hlsli). Notable design notes surfaced in research: edge detection is made symmetric on purpose ("does not guarantee left-edge-of-right-pixel == right-edge-of-left-pixel" naturally, so symmetricity is enforced for a sharper blur), and a small amount of intentional AO leaking is allowed across 3-or-4-edge configurations specifically to reduce both spatial *and temporal* aliasing — i.e. a deliberate small-bias-for-stability trade baked into an otherwise "unbiased" edge-aware filter. Exposed quality presets: Disabled / Sharp / Medium / Soft.
- Bevy's SSAO/VBAO implementation (heavily based on XeGTAO) — same spatial bilateral-blur-with-edge-detection approach, per its PR description (see §5 below).

**Watch-outs**: fixed/screen-space radii (three.js `DenoiseNode`) shrink in world-space footprint with distance unless explicitly distance-scaled (as SSRT3 and XeGTAO's world-space-aware variants do); scalar-only kernels (`depthAwareBlur`) need per-channel adaptation for RGB GI.

---

## 3. Interleaved / checkerboard rendering

**What it solves**: lets you spend the *same* per-pixel sample budget less often per pixel by spreading the work over a checkerboard or N×N interleaved tile pattern across frames/pixels, relying on the spatial+temporal filter to reconstruct full coverage — a way to buy sample density without linearly paying for it every pixel every frame.

**How**: partition pixels into a repeating pattern (e.g. 2×2 or 4×4 tile); each pattern-phase computes the expensive pass (sampling/raymarching) for only its subset of pixels this frame (or this tile), and the denoiser (spatial and/or temporal) fills in the rest using neighbor/history data. Closely related to (and often combined with) half-res rendering below, and to deinterleaved/checkerboard depth textures used to improve sample cache coherency (e.g. NVIDIA's classic ["Deinterleaved Texturing for Cache-Efficient Interleaved Antialiasing"](https://developer.nvidia.com/sites/default/files/akamai/gameworks/samples/DeinterleavedTexturing.pdf), referenced in Bevy's SSAO tracking issue).

**Cost / trade-off**: reduces per-frame shading cost roughly by the interleave factor, at the cost of needing a robust reconstruction filter and more careful temporal jitter management; more prone to visible pattern artifacts under fast motion or when the denoiser under-converges.

**References**: Bevy's SSAO PR (#7402) and follow-up tracking issue (#8888) list "deinterleaved SSAO for better cache efficiency" as a future item, citing the NVIDIA deinterleaved-texturing paper above; SSRT3's `DiffuseDenoiser.compute` supports a `_HalfResolutionFilter` mode that dispatches 4 samples per 2×2 group using a `localIndex`-selected quadrant of the sample set — a related, tile-local variant of the same idea (see `ssrt3-denoiser.md`).

---

## 4. Half-resolution rendering + (joint) bilateral upsampling

**What it solves**: raw compute cost of the expensive sampling/horizon-search pass — running the core AO/GI kernel at half (or quarter) the pixel count is a large, direct win, at the cost of needing to reconstruct full-res detail from a lower-res buffer without introducing depth-discontinuity halos.

**How**: render the noisy AO/GI signal at half resolution (using a matching half-res depth/normal buffer, often via existing depth-mip infrastructure), then upsample using a **joint (cross) bilateral filter**: for each full-res output pixel, blend the 2×2 (or larger) neighborhood of low-res source texels weighted by how closely each low-res texel's depth matches the *full-resolution* depth at that pixel — this "guide buffer" is what distinguishes a joint/cross bilateral upsample from a plain bilinear upsample, and is what prevents bright/dark haloing around depth edges.

**Primary-source claim (SSILVB paper, arXiv 2301.11376, §4.3, page 8)** — quoted verbatim:
> "Full resolution means that the shader is executed for every pixel of the final render resolution, whereas half-resolution executes it on a screen that is half the size (a quarter the number of pixels). The image is then upscaled with a classic bilateral upsampler to avoid aliasing. Rendering in half resolution is much more efficient (around 4x), but can introduce more flickering in the image and a blurrier result."

**Cost**: ~4× reduction in sampling-pass cost (paper's own figure) at the cost of an extra upsample pass (cheap, ~2×2-tap) and the noted flicker/blur trade-off.

**Concrete implementations gathered in this research**:
- SSRT3's `DiffuseDenoiser.compute` ships `GatherSingle`/`GatherColor` kernels performing exactly this via HDRP's shared `BilateralUpsample.hlsl` (`BilUpSingle_Uniform`/`BilUpColor3_Uniform`), reconstructing full-res from a half-res-denoised buffer using a 2×2 low-res neighborhood weighted by depth match. See `ssrt3-denoiser.md`.
- AMD FidelityFX **CACAO** (Combined Adaptive Compute Ambient Occlusion) documents a 5×5-kernel bilateral upsampler for its downsampled quality tiers: [GPUOpen manual](https://gpuopen.com/manuals/fidelityfx_sdk/techniques/combined-adaptive-compute-ambient-occlusion/).
- Depth-aware upsampling deep-dive series (practical implementation walkthrough, part 6 covers "a complete approach to upsample the half-resolution render target of a SSAO implementation"): [hikiko-blog](https://eleni.mutantstargoat.com/hikiko/depth-aware-upsampling-6/).
- Bevy's SSAO tracking issue (#8888) lists "Render at half resolution and use a bilateral upsample" as an open, not-yet-implemented item — i.e. even a modern (2024/2025-era) shipping SSAO implementation treats this as a known-valuable-but-not-yet-done optimization, useful context for scoping ssgiDev's own roadmap.
- three.js has the building blocks (`depthAwareBlur.js`'s docstring explicitly calls out AO half-res denoising as its intended use) but **no dedicated joint-bilateral-upsample node** — confirmed via a repo-wide code search for "upsample" across `mrdoob/three.js`, which returned no dedicated node. See `threejs-nodes.md`.

**Watch-outs**: the paper's own caveat — flickering and blur increase at half-res; this interacts with temporal accumulation (a jittery half-res+upsampled signal is harder for a temporal filter to converge without more ghosting-prone smoothing).

---

## 5. Blue-noise + temporal rotation of sample patterns (Jimenez spatiotemporal offsets)

**What it solves**: converts structured/banding noise patterns (visible, repeating undersampling artifacts) into visually-neutral, high-frequency noise that both (a) looks better per-frame and (b) is easier for a temporal accumulation filter to average out to the correct converged value, because successive frames sample *different* points rather than the same wrong ones repeatedly.

**How**: rotate/offset the per-pixel sample pattern (hemisphere slice angle, disk sample rotation, ray starting offset, etc.) using a combination of (a) a per-pixel spatial hash / blue-noise or interleaved-gradient-noise texture and (b) a per-frame temporal index that cycles through a small set of offsets (e.g. three.js's `_spatialOffsets = [0, 0.5, 0.25, 0.75]` cycling on `frameId % 4`), so the *same* pixel samples a different sub-pixel/sub-angle position on the next frame.

**Reference lineage**:
- Jorge Jimenez, ["Next Generation Post Processing in Call of Duty: Advanced Warfare"](https://www.iryoku.com/next-generation-post-processing-in-call-of-duty-advanced-warfare/) (SIGGRAPH 2014 Advances in Real-Time Rendering course) — introduced **Interleaved Gradient Noise**, explicitly designed to pair well with TAA (low-discrepancy in both space and, via per-frame rotation, time).
- Follow-up practical write-ups: ["Interleaved Gradient Noise: A Different Kind of Low Discrepancy Sequence"](https://blog.demofox.org/2022/01/01/interleaved-gradient-noise-a-different-kind-of-low-discrepancy-sequence/); ["Animating Noise For Integration Over Time"](https://blog.demofox.org/2017/10/31/animating-noise-for-integration-over-time/) (both blog.demofox.org, Alan Wolfe) — cover why/how to animate dither/noise patterns per-frame for temporal integration.
- Bart Wronski, ["Dithering part three – real world 2D quantization dithering"](https://bartwronski.com/2016/10/30/dithering-part-three-real-world-2d-quantization-dithering/) — practical blue-noise dithering considerations.

**Already in use in this project's target nodes**: three.js's `SSGINode.js` and `GTAONode.js` both already implement this family of technique at the *sampling* stage (not the denoise/reconstruction stage) — see the cross-reference note at the end of `threejs-nodes.md`. `SSGINode.js` even has an inline comment explicitly tying its noise-jitter scheme to TRAA convergence, citing three.js issue/PR `#31890`. SSRT3's diffuse denoiser also rotates *which* block of its 16 Owen-scrambled samples is used per frame via `_JitterFramePeriod` — i.e. the same temporal-rotation idea applied to the denoiser's own sampling, not just the primary GI sampler.

**Watch-outs**: this technique reduces *visible banding/structure* in the noise but does not by itself reduce total noise energy or handle disocclusion — it's a complement to, not a replacement for, temporal accumulation and spatial filtering.

---

## 6. Firefly clamping

**What it solves**: isolated, extremely bright outlier samples (from small/bright light sources or near-singular BRDF/visibility configurations) that show up as flickering bright pixels ("fireflies") — a particular risk for a GI signal (HDR radiance) in a way that a bounded-[0,1] AO signal doesn't have.

**How**: clamp sample/pixel luminance (or per-channel value) to a maximum threshold before accumulation/denoising, trading a small amount of energy-conservation bias for stability. Can be applied pre-temporal-accumulation (per-sample), post-accumulation (per-pixel, on the history or resolved value), or via a soft variant (e.g. Reinhard-style tonemap-then-untonemap around the filtering step) to reduce the visible bias.

**References gathered**:
- General technique framing: ["Fixing Fireflies in Blender/Cycles"](https://blendergrid.com/articles/fixing-fireflies-in-blender-cycles) (offline-renderer framing of the same core idea); Sébastien Lagarde-style clamping notes; ["Reweighting Firefly Samples for Improved Finite-Sample Monte Carlo Estimates"](https://jo.dreggn.org/home/2018_fireflies.pdf) (academic treatment of *why* naive clamping biases the estimator and a reweighting alternative).
- Historical DDGI/denoiser patent literature turned up in search (Denoising dynamically ray-traced scenes patents, USPTO) discusses luminance-clamping-ratio bookkeeping as part of history-clamping in modern RT denoisers — useful vocabulary ("clamping ratio → 0 when unaffected, → 1 when history is being clamped") even though these are patent filings, not implementation references.
- Not observed as an explicit standalone stage in the three.js nodes or SSRT3 gathered above — three.js's `TRAANode` variance clipping and SSRT3's neighborhood min/max clamp both implicitly bound outliers as a side effect of their neighborhood-clamp math, but neither exposes a dedicated "max luminance" clamp control. This is a **gap** relative to what a bitmask-SSGI pipeline (HDR radiance, potential emissive-surface fireflies per the SSRT3 README's feature list) may need as an explicit, separate stage.

---

## 7. À-trous / SVGF-style multi-pass wavelet filtering (context, not directly used by the sources above)

**What it solves**: efficiently approximates a very large-radius spatial blur (needed to denoise heavily under-sampled path-traced/ray-traced signals) using a small number of passes with exponentially increasing gaps between taps, each still edge-aware (depth/normal/luminance-variance-guided).

**How**: repeated small-kernel (e.g. 5×5) "atrous" (with holes) passes where the sample offset doubles each pass, combined with per-pixel variance estimation (spatial + temporal) to adapt filter strength — this is the core of **SVGF** (Spatiotemporal Variance-Guided Filtering).

**References**:
- Schied et al., "Spatiotemporal Variance-Guided Filtering: Real-Time Reconstruction for Path-Traced Global Illumination", HPG 2017 — the canonical reference; see e.g. [ResearchGate summary of the earlier edge-avoiding À-Trous paper](https://www.researchgate.net/publication/221248942_Edge-Avoiding_A-Trous_Wavelet_Transform_for_Fast_Global_Illumination_Filtering) it builds on.
- Open implementations found: [jacquespillet/SVGF](https://github.com/jacquespillet/SVGF), [HummaWhite/Project4-CUDA-Denoiser](https://github.com/HummaWhite/Project4-CUDA-Denoiser), [ZheyuanXie/CUDA-Path-Tracer-Denoising](https://github.com/ZheyuanXie/CUDA-Path-Tracer-Denoising), [TheVaffel/spatiotemporal-variance-guided-filtering](https://github.com/TheVaffel/spatiotemporal-variance-guided-filtering).
- ReLAX (a later evolution, partitions diffuse/specular for targeted denoising) mentioned in search results as a further refinement.

**Relevance caveat**: this family targets *heavily* undersampled (1 spp-class) ray/path-traced signals; a horizon-based/bitmask SSGI pass (dozens of analytic-slice samples per pixel, much lower variance than 1-spp path tracing) is a fundamentally less noisy starting point, closer in noise character to GTAO than to RTGI — so full SVGF-grade multi-pass wavelet machinery is likely overkill relative to the single-pass bilateral filters (§2) and half-res+upsample (§4) approaches the more directly-relevant sources (SSRT3, XeGTAO, three.js) actually use in production. Included here for completeness/context since the survey was asked to be broad, not because any gathered source recommends it for this exact signal class.

---

## 8. Bevy VBAO — production tracking issues as a technique checklist

Bevy's engine-level VBAO (GTAO + visibility bitmask, i.e. the closest "shipping open-source engine" analog to this project's SSGI pass) has two directly relevant GitHub threads:

- **PR #7402** ("Screen Space Ambient Occlusion (SSAO) MVP"): implementation notes state the shipped pipeline is "GTAO pass → Spatial denoise pass (bilateral blur with edge detection) → Main pass", explicitly modeled on Intel's XeGTAO. Its own "Future Improvements" list (unimplemented at time of writing) reads almost exactly like this project's support-pipeline shopping list: *"Try interleaved gradient noise or spatiotemporal blue noise; Replace the spatial denoiser with a combined spatial+temporal denoiser; Render at half resolution and use a bilateral upsample; Better multibounce approximation."* [github.com/bevyengine/bevy/pull/7402](https://github.com/bevyengine/bevy/pull/7402)
- **Issue #8888** ("SSAO/SSGI followup tracking issue"): carries the same checklist forward, adding *"Replace the spatial denoiser with a combined spatial+temporal denoiser, similar to bevy_solari's"* (bevy_solari being Bevy's separate hardware-raytracing path — implying their own RT denoiser is the aspirational target for the screen-space path too) and *"Deinterleaved SSAO for better cache efficiency"* citing the NVIDIA deinterleaved-texturing paper. [github.com/bevyengine/bevy/issues/8888](https://github.com/bevyengine/bevy/issues/8888)
- **Issue #19713** ("SSAO/VBAO Improvements") surfaces newer (2024/2025) community shader work on a "ground-truth" VBAO variant (GT-VBAO, Shadertoy: [XXGSDd](https://www.shadertoy.com/view/XXGSDd)) addressing non-uniform slice-sample distribution, perspective distortion, and cosine-weighted hemisphere sampling corrections to the original visibility-bitmask paper's assumptions — orthogonal to denoising per se, but relevant if the sampling stage itself is revisited later. [github.com/bevyengine/bevy/issues/19713](https://github.com/bevyengine/bevy/issues/19713)

**Takeaway**: as of this research (mid-2026), no major open-source engine (Bevy, three.js) has yet *shipped* the "half-res + bilateral upsample" and "combined spatial+temporal denoiser" combination for their GTAO/VBAO-family SSAO/SSGI — both treat it as a known, desirable, still-open improvement. This is useful scoping context: ssgiDev would be closing a gap that exists industry-wide in the open-source space, not reinventing an already-solved wheel.
