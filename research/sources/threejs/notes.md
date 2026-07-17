# Research Notes: SSGI/VBAO Implementation Overview

## Thread Summary

Issue #29668 ("Add SSILVB GI and AO") documents the exploration and experimentation with screen-space global illumination techniques in three.js, spanning October to November 2024. The thread covers three major SSGI approaches: cdrinmatane's SSRT3 (Unity-based SSILVB), cybereality's simplified implementation, and Mirko Salm's GT-VBAO (ground-truth visibility bitmask AO). Initial attempts to port these to three.js GLSL encountered numerous coordinate-space and normalization bugs, but progress was steady with contributions from zalo (porting efforts), cybereality (original reference implementation), Mirko-Salm (GT-VBAO developer), and Olivier Therrien (cdrintherrieno, SSRT3 author). The discussion evolved from comparative analysis of noise functions and denoising strategies to practical debugging of bitfield calculations and slice parametrization issues.

PR #31839 ("SSGINode: New node for screen-space global illumination") represents the formal integration of SSRT3 into three.js's WebGPU renderer via TSL (Texture Shader Language). Mugen87 ported the complete Unity implementation with temporal filtering support, initially targeting the old WebGL post-processor but switching to WebGPU-only TSL for consistency with new effects like TRAA. The PR evolved through bug fixes (particularly a critical bitfield corruption issue found by zalo in PR #31873), coordinate-space corrections for WebGPU's top-left UV convention, and refinement of GI compositing to properly modulate indirect light by surface albedo. Secondary issues were identified around TRAA ghosting and optimal scene selection for demoing the effect.

Bevy issue #19713 ("SSAO/VBAO Improvements") tracks adoption of performance and quality improvements to screen-space ambient occlusion techniques, particularly Mirko Salm's GT-VBAO variants (uniform and cosine-weighted). The issue documents acos approximation optimizations, importance-sampling refinements for slice directions, unidirectional ray marching variants, and dynamic thickness heuristics, positioning GT-VBAO as the "ground truth" reference that converges to brute-force ray marching results.

## Technically Substantive Comments (by contributor)

### Olivier Therrien (cdrintherrieno)
- **2024-11-01T20:48:04Z**: Visual comparison of SSRT3 three.js vs Unity implementations; notes missing details in three.js port, speculates on sampling issues
- **2025-09-09T13:40:16Z**: Diagnostic hints for flickering AO bug; points out `frontBackHorizon` computation around slice parametrization, cross-references Shadertoy implementations
- [Issue comment permalink: https://github.com/mrdoob/three.js/issues/29668#issuecomment-2449626270 (note: ID 2449626270)]

### Mirko Salm (Mirko-Salm)
- **2024-10-31T11:26:50Z**: Discusses `deltaPosBack` calculation variants and performance/accuracy tradeoffs; notes depth unit assumptions
- **2024-10-30T11:06:20Z**: Clarifies noise function flexibility in GT-VBAO; recommends interleaved gradient noise over R1-Hilbert for denoising
- **2024-11-01T18:16:21Z**: Comprehensive answer on GI possibility with cosine weighting; explains unidirectional GT-VBAO progress; performance optimization flags (USE_HQ_ACOS, etc.)
- **2024-11-08T10:30:46Z**: Details unidirectional variant benefits (50% sample reduction, camera-facing surface caveats)
- [Issue comments: 2446623827, 2452357235, 2464354938]

### zalo (primary experimenter)
- **2024-10-18T01:52:42Z** onward: Step-by-step debugging of bitfield accumulation bugs; discovers two-hemisphere vs single-horizon sampling discrepancy
- **2024-10-18T06:48:38Z**: Catalogs three working implementations (SSRT3 GLSL, cybereality's simplification, TSL attempt) with known bugs in each
- **2025-09-09T19:33:28Z** (PR #31839): Identifies critical PI vs PI2 bug in slice rotation constant (PR #31873 follows)
- **2025-09-11T00:42:47Z** onward: Identifies GI compositing incorrectness (adding unmodulated to scene); proposes fix using diffuse channel modulation
- **2025-09-11T03:07:33Z**: Proposes Cornell Box scene to showcase AO+GI benefits clearly

### Mugen87 (three.js maintainer)
- **2024-10-16T07:53:33Z**: Directs approach toward TSL/WebGPURenderer instead of old post-processor
- **2025-09-07T10:01:19Z**: PR description of SSGINode; documents temporal filtering requirement, presets for slice/step counts
- **2025-09-09T09:06:36Z**, **2025-09-09T15:03:36Z**: Coordinate-space debugging; discusses UV convention (0,0 top-left vs bottom-left) and view-space handedness differences
- **2025-09-27T08:37:58Z** onward: Addresses performance requests; suggests temporal filtering for GTAONode as alternative to SSGINode

### cybereality
- **2024-10-16T00:26:58Z**: First reference implementation author; confirms code structure, notes unresolved denoising/blending questions
- **2024-10-18T02:43:56Z**, **2024-10-18T06:19:11Z**, **2024-10-18T06:42:48Z**: Engages in slice rotation constant debugging; confirms PI (not PI/2) bug and fix

---

## Flagged Comments (Verbatim Excerpts)

### Issue Comment 2449626270 — Mirko-Salm (2024-10-31)
> I'm glad to see that people find it useful!
> Just as an aside with regard to the deltaPosBack calculation, I think the 'normalize'-variant is probably a bit faster than the 'VPos_from_SPos'-variant while not really being less accurate (just a different assumption about the finite thickness behavior). I chose 'VPos_from_SPos' as the default because it matches the implicit behavior of the reference ray-marcher (which could also be modified to use the 'normalize'-variant, but here it would be the less performant choice since here we get the 'VPos_from_SPos'-behavior for free).

### Issue Comment 2446623827 — Mirko-Salm (2024-10-30)
> "The noise function is different and the Poisson Denoiser doesn't like it..." - The particular choice of noise function is not integral to GT-VBAO. You can use whatever noise function you like as long as it follows a uniform distribution. In my experience interleaved gradient noise works better than R1-Hilbert noise for denoising. I chose R1-Hilbert noise as the default for the Shadertoy demo simply because its screen space characteristics are more isotropic than those of IGN (as long as you don't denoise).

### Issue Comment 2452357235 — Mirko-Salm (2024-11-01)
> it's just linear z from 0 to inf.
>
> GI should also be possible. I haven't looked into it yet since I'm still busy with the uni-directional variant of GT-VBAO (having to always ray march bi-directionally is a bit of a downer). I can't really say how big of an improvement the cosine weighting would be for GI, but it shouldn't be hard to set up a reference GI ray marcher to get an upper bound on the possible quality improvements.
>
> Hard to say if doing in it all in one pass is going to be beneficial. Seems like something you just have to try and profile.
>
> RE performance optimizations: try disabling #define USE_HQ_ACOS; the approximation should be good enough while being quite a bit faster. I only had the high quality variants on by default to show that the converged results exactly match those of the reference ray marcher. Disabling #define USE_HQ_APPROX_SLICE_IMPORTANCE_SAMPLING might not be worth it, though.
>
> EDIT: I have just added an improved version of ACos_Approx() to the GT-VBAO shadertoy code. The error introduced due to using the acos approximation is now so small that there is basically no reason not to do so (by disabling  #define USE_HQ_ACOS).

### Issue Comment 2464354938 — Mirko-Salm (2024-11-08)
> The benefit is that you cut the number of depth buffer samples in half without doing the same to the quality. Well, at least if your scene doesn't primarily consist of camera facing surfaces. In that case you lose about as much quality as you gain performance. Whether you would want to switch probably depends on whether marching a single direction per-pixel gives you sufficiently good results for the denoiser.

### PR Comment 3271661398 — Mirko-Salm (2025-09-09) — [permalink](https://github.com/mrdoob/three.js/pull/31839#issuecomment-3271661398)
> I'm genuinely curious what made you decide to go with SSGI instead of GT-VBGI (https://www.shadertoy.com/view/lfdBWn). Since you already have a functional GT-VBAO implementation, getting GT-VBGI to work should have been straightforward.

### PR Comment 3271711084 — Mugen87 (2025-09-09) — [permalink](https://github.com/mrdoob/three.js/pull/31839#issuecomment-3271711084)
> TBH, I'm new to SSGI and I found the SSRT3 solution well documented. And since I have worked with Unity a bit, it was easier to study and port the code.
>
> Do you mind explaining the differences between SSRT3 and GT-VBGI? From the comparison screenshots in #29668, I could not tell whether GT-VBAO or SSRT3 produces the better AO.
>
> To be clear, the current implementation in `SSGINode` is a first step so we have something in the main repository to work with. There is no reason why we should not switch to a different and better implementation. A working SSRT3 version makes it also easier to switch to a different technique since we have some sort of baseline for comparisons.

### PR Comment 3271862750 — Mirko-Salm (2025-09-09) — [permalink](https://github.com/mrdoob/three.js/pull/31839#issuecomment-3271862750)
> The differences are basically the same as those outlined in the GT-VBAO docu here: https://www.shadertoy.com/view/XXGSDd.
> The biggest selling point of GT-VBAO/GI might be that it converges to the same results that a brute-force screen-space ray-marcher converges to (as demonstrated by all the GT-VBAO/GI shadertoy implementations). If you prefer the look of uniformly-weighted sampling over cosine-weighted sampling there are also uniformly-weighted variants of GT-VBAO/GI. Those might actually be a bit faster since they don't require acos calls inside the inner loop. Recently I also added distant light sampling support to (cosine-weighted) GT-VBAO: https://www.shadertoy.com/view/wc2SzR.

All three comments are also present in the full thread capture (`pr-31839.md`).

---

## Discovered External Links

### Reference Implementations & Papers
- **SSRT3 (Olivier Therrien's Unity port)**: https://github.com/cdrinmatane/SSRT3
- **SSRT3 Blog & Explanations**: https://cdrinmatane.github.io/posts/ssaovb-code/
- **SSRT3 Slides**: https://cdrinmatane.github.io/cgspotlight-slides/ssilvb_slides.pdf
- **Original VBAO Paper**: https://arxiv.org/abs/2301.11376
- **Stochastic Depth Ambient Occlusion Paper**: https://graphics.tudelft.nl/Publications-new/2021/VSE21/SDAO.pdf (https://www.youtube.com/watch?v=X7JnEF__ZsQ)
- **Generalized Decoupled Object-Space Shading**: https://www.oxidegames.com/wp-content/uploads/2022/07/Generalized-Decoupled-and-Object-Space-Shading-System.pdf
- **Object-Space Lighting (Rev 2)**: https://www.oxidegames.com/wp-content/uploads/2016/03/Object-Space-Lighting-Rev-21.pdf
- **Approximate Radiance Transfer (ARv2010)**: https://xevius.org/papers/approxradpaper2010.pdf

### Shadertoy Implementations
- **GT-VBAO (cosine-weighted, ground-truth ref)**: https://www.shadertoy.com/view/XXGSDd
- **GT-VBAO (unidirectional variant)**: https://www.shadertoy.com/view/Xc3yzs
- **GT-VBAO with Distant Light Sampling**: https://www.shadertoy.com/view/wc2SzR
- **SSILVB Simplified (cybereality)**: https://www.shadertoy.com/view/dsGBzW
- **MXAO iMMERSE variant**: https://www.shadertoy.com/view/XXGSDd (cross-ref to iMMERSE shader)
- **AO Denoise Examples**: https://www.shadertoy.com/results?query=denoise (including Mirko's: https://www.shadertoy.com/view/Nljfzt)
- **Acos Approximation (performance)**: https://www.shadertoy.com/view/4cdfzf
- **Occluder Thickness Heuristics**: https://www.shadertoy.com/view/3clGWB

### Denoising & Related Techniques
- **glslSmartDeNoise**: https://github.com/BrutPitt/glslSmartDeNoise
- **Dennis Smolek's Denoiser**: https://github.com/DennisSmolek/Denoiser (noted as too slow for real-time)
- **Nvidia Joint Neural Denoising**: https://research.nvidia.com/publication/2023-03_joint-neural-denoising-surfaces-and-volumes (unreleased, too slow)
- **OIDN Port attempt**: https://x.com/pissang1/status/1809119875258011671 (too slow)
- **N8AO Denoise Pass**: https://github.com/N8python/n8ao/blob/master/src/N8AOPass.js#L433

### Demo URLs (zalo's experimental branches)
- **SSRT3 GLSL port (best three.js version)**: https://raw.githack.com/zalo/three.js/feat-ssilvb/examples/webgl_postprocessing_ssilvb.html
- **cybereality simplification port**: https://raw.githack.com/zalo/three.js/feat-ssilvb-cybereality/examples/webgl_postprocessing_ssilvb.html
- **GT-VBAO GLSL port (enhanced quality)**: https://raw.githack.com/zalo/three.js/feat-ssilvb-gtvbao/examples/webgl_postprocessing_ssilvb.html
- **Three.js Official SSGI Demo**: https://rawcdn.githack.com/mrdoob/three.js/dev/examples/webgpu_postprocessing_ssgi.html
- **Cornell Box SSGI Scene**: https://rawcdn.githack.com/mrdoob/three.js/ce783910bcf441be07b9d2949945f1ba6ed6c296/examples/webgpu_postprocessing_ssgi.html

### YouTube Comparisons & Demos
- **zalo's SSRT3 flythrough (default settings)**: https://www.youtube.com/watch?v=WdWV6FIzNNM
- **zalo's LittlestTokyo SSGILB demo**: https://youtu.be/BGg_Z5icnl4
- **SDAO Paper Demo**: https://www.youtube.com/watch?v=X7JnEF__ZsQ

### Social Media / Discussion Threads
- **Mirko Salm's GT-VBAO announcement**: https://twitter.com/Mirko_Salm/status/1833211198009184650
- **Sonic Ether AO discussion**: https://x.com/sonic_ether/status/1848025383028871649
- **1000Orks GT-VBAO funding**: https://1000orks.com/
- **Occluder thickness heuristics discussion**: https://bsky.app/profile/bottosson.bsky.social/post/3liejizfkmk2k
- **Object Space Shading discussion**: https://x.com/notimothylottes/status/1856177383570616554
- **Tim Lottes on AO trends**: https://x.com/threejs/status/1851773285920575952

### Related three.js Components
- **GTAONode (existing AO, no temporal filtering)**: https://github.com/mrdoob/three.js/blob/dev/examples/jsm/tsl/display/GTAONode.js
- **DenoiseNode (TSL denoise filter)**: https://github.com/mrdoob/three.js/blob/dev/examples/jsm/tsl/display/DenoiseNode.js
- **TRAANode (temporal antialiasing)**: https://github.com/mrdoob/three.js/blob/dev/examples/jsm/tsl/display/TRAANode.js
- **SSGINode (new SSGI implementation)**: https://github.com/mrdoob/three.js/blob/dev/examples/jsm/tsl/display/SSGINode.js

