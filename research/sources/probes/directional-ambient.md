# The directional-ambient technique (paper §3.2) and related implementations

## 1. The paper, verbatim (§3.2 "Directionally Occluded Ambient Lighting")

Source: `research/sources/papers/ssilvb-2301.11376.pdf` (Therrien, Levesque, Gilet — "Screen Space Indirect Lighting with Visibility Bitmask," arXiv:2301.11376), extracted locally with `pdftotext -layout` (poppler installed for this task since it wasn't previously available in the environment). Also on arXiv: https://arxiv.org/abs/2301.11376 / https://arxiv.org/pdf/2301.11376, and readable HTML mirror: https://ar5iv.labs.arxiv.org/html/2301.11376

> Ambient lighting in real-time applications is usually sampled using the surface normal, but tends to give poor results because it doesn't take into account the directional occlusion of lighting. Screen space bent normal [KRES11] addresses this problem by sampling towards the largest non-occluded direction, but is limited to a single ambient direction per pixel and does not handle thickness properly. Visibility bitmasks can improve this by weighting the ambient lighting in a given direction by the directional occlusion while allowing light to pass behind surfaces. **To this end, we divide the hemisphere into as many subregions as the number of ambient samples, generating a sampling direction vector at the center of each subregion. The ambient source is then sampled with this vector and multiplied the lighting intensity by the amount of un-occluded sectors over the total sector count** (see Figure 8). It made the ambient light color vary smoothly according to changes in occlusion directionality.

Figure 8's caption: "In this example, 4 ambient samples per slice per pixel are taken so the hemisphere is divided into 4 subregions. Vectors a1, a2, a3, a4 are generated at the center of their respective subregion."

**Important scoping note:** the paper's Algorithm 1 pseudocode (the one with `AO`, `GI`, `COUNTBITS(bj & ~bi)` etc.) covers only ambient occlusion and indirect-diffuse bounce — it does **not** contain an explicit line for the ambient-fallback formula above. §3.2 is prose-only in the paper; there is no worked equation for "amount of un-occluded sectors over the total sector count" beyond that sentence. The actual reference implementation of this sentence is SSRT3's shipped HLSL (see `ssrt3-fallback.md`), by the same lead author (Olivier Therrien / `cdrinmatane`), and it's worth noting that SSRT3's normalization (`unoccluded / MAX_RAY_total`, not `unoccluded / subregion_size`) is a specific interpretation choice, not dictated by the paper text.

**Comparison to bent normal (§4.2, "Directionally Occluded Ambient Lighting" results section):**

> In most 3D applications, ambient lighting is sampled in the direction of the surface normal. This approach does not take into account the fact that some light could be occluded in some direction and tend to make ambient lighting change sharply with the scene geometry. A better approach is to use a screen space bent normal per pixel that is modulated according to nearby occlusion. It points towards the direction of incoming light and gives a smoother result. However, it cannot handle multiple light directions and will misrepresent the ambient lighting of surfaces enclosed by thin objects.
>
> Our approach used visibility bitmasks to take multiple samples along each hemisphere slice in the directions that were not occluded. Doing so allow ambient light to pass behind surfaces, giving smooth lighting from multiple directions. It's also worth noting that each ambient sample is weighted according to the occlusion in that specific direction. If the ambient color had been simply averaged out and then multiplied by ambient occlusion, a lot of the color variation in the lighting would have been lost.

This is the explicit argument for *why* to do K-directional-sample-weighted-by-bitmask instead of (a) `ambient(normal) * scalarAO` (the ubiquitous game-engine shortcut) or (b) bent-normal single-direction sampling: multi-sample-per-direction preserves **directional color variation** in the ambient term (e.g. one side of a pixel's hemisphere lit warm, the other cool/shadowed) that both cheaper alternatives collapse away.

**The paper's own acknowledgment of the off-screen gap (§5, future work):**

> the common ambient light sources are either static (constant color, light probes) or expensive to update at runtime. We might investigate in the future ways to approximate low-frequency ambient irradiance dynamically.

This is the paper explicitly naming the exact problem this research task is chasing — the paper itself doesn't solve it, treats it as future work, and (per the co-authorship overlap with `cdrinmatane`/SSRT3) that "future work" appears to be what SSRT3's `Fallback` enum later shipped as an engineering answer (APV or reflection probes), not a new algorithmic contribution from the paper itself.

## 2. CG Spotlight #5 slides — explicit fallback-source list + explicit acknowledgment of the off-screen limitation

Source: https://cdrinmatane.github.io/cgspotlight-slides/ssilvb_slides.pdf (linked from https://cdrinmatane.github.io/posts/cgspotlight-slides/, presentation "Screen Space Indirect Lighting with Visibility Bitmask" by Olivier Therrien, CG Spotlight #5, May 31 2023). Extracted locally with `pdftotext -layout` after downloading the PDF (the page itself is just a header/embed shell that WebFetch can't render — the PDF had to be fetched directly).

Slide, "Directional occlusion of ambient light":

> - Compatible with any ambient source
>   - Spherical harmonics probes
>   - Reflection probes
>   - Irradiance cubemap
>   - Others
> - Sample the ambient source in X directions
>   - a1..a4: We divide the hemisphere in 4 sub-regions and sample in the center direction
>   - Multiply sampled light color by the ratio of un-occluded sectors per sub-region over sector count per sub-region

Note this slide phrasing ("...per sub-region over sector count **per sub-region**") is more explicit than the paper text and states the **per-subregion** normalization (each subregion's weight capped at 1.0 individually) — reinforcing that SSRT3's shipped `/MAX_RAY`(global) normalization is a specific implementation choice divergent from how the technique is described here, not a typo in `ssrt3-fallback.md`'s reading of the code.

Slide, "Directional occlusion (reflection probes)":

> - There is no diffuse bounce in those images (only ambient)
> - Most games just multiply ambient source by pixel AO (uniform AO)
>   - Fails to reconstruct directional color changes and indirect shadows
> - Multisampling a detailed ambient source like reflection probes and apply occlusion directionally (per sample) gives much richer ambient light
>   - Directional light changes are very noticeable
>   - Can create large indirect soft shadows (column)
> - Please do this in your game :)
>   - Much cheaper to compute than a GI bounce, yet it accounts for most of the "Wow" effect

Slide, **"Limitation: Out of screen light"** — the presentation's own framing of exactly the gap this research task exists to close:

> - Light needs to be on screen to contribute a bounce
>   - Especially visible with long rays and intense light
> - Can be mitigated by reducing GI strength, and relying more on ambient lighting
> - Ultimately would need to continue sampling outside the screen
>   - Realtime cubemap around camera?
>   - Ray tracing?

Slide, "Limitation: Occluded light":

> - Light behind other surfaces cannot contribute
>   - Especially visible with long rays
> - Can be mitigated by reducing GI strength, and relying more on ambient lighting
> - No easy fix
>   - Deep G-Buffers? (Would also need back-faces)
>   - Stochastic Depth?

So the author's own stated mitigation for both "off-screen" and "occluded" bounce gaps is **the same thing**: fall back harder on the directional-ambient-source term (§3.2/the reflection-probe slide) when the screen-space bounce runs dry — which is precisely the mechanism SSRT3 shipped (see `ssrt3-fallback.md`). The slides float "realtime cubemap around camera" and "ray tracing" as the *further* future options for actual off-screen bounce (not just ambient fallback), neither of which SSRT3 implements.

## 3. GT-VBAO "distant light sampling" (Björn Ottosson, building on Mirko Salm's GT-VBAO)

This is a related but **distinct** lineage from SSILVB/SSRT3: GT-VBAO is a from-scratch "ground truth" shadertoy re-derivation of visibility-bitmask AO (attributed to Mirko Salm, building on prior work by shadertoy user `volfaze`), which Björn Ottosson then extended in two shadertoy forks to sample a **distant/environment light** instead of computing AO, plus an occluder-thickness heuristic.

**Fetch status: BLOCKED across every method tried.** This is a documented failure, not an omission:
- Direct `shadertoy.com/view/<id>` fetch → HTTP 403 (Cloudflare) for both `wc2SzR` and `wcfGWB` (confirmed again in this session; matches the pre-existing local notes at `research/sources/shadertoy/wc2SzR/notes.md` and `.../wcfGWB/notes.md`).
- `web.archive.org` mirror of the shadertoy page → tool-level refusal ("Claude Code is unable to fetch from web.archive.org").
- Björn Ottosson's X/Twitter thread describing the math (https://x.com/bjornornorn/status/1891431145172025740) → HTTP 402 Payment Required.
- Web search for code mirrors/gists of the shader source → none found; only secondary descriptions.

**What's known second-hand** (from search-result snippets only — not verbatim, not verified against source):
- X post title/preview (via web search): *"I'm working on a AO and GI for my game. For that reason I'm extending @Mirko_Salm's GT-VBAO (based on @volfaze's work). I've done two things so far: - Sampling a distant light instead of computing AO - Added a heuristic for estimating occluder thickness."* — https://x.com/bjornornorn/status/1891431145172025740
- Mirko Salm's original GT-VBAO shadertoy post (via search snippet): *"a ground truth version of Visibility Bitmask Ambient Occlusion (VBAO) that matches the result of a brute force ray marcher sharing the same limitations and assumptions... supports both uniform hemisphere weighting and cosine weighted hemisphere weighting... addresses shortcomings in the original VBAO implementation through correct slice-local sample distribution, and accounts for non-uniform slice-local sample probability density function by remapping min/max-horizon angles using the corresponding CDF."* — https://x.com/Mirko_Salm/status/1833211198009184650
- Shadertoy IDs referenced (titles taken from this repo's pre-existing local notes, which were themselves populated before this fetch attempt): `wc2SzR` "GT-VBAO [Dist. Light Sampling 2]", `wcfGWB` "GT-VBAO distant light sampling (Björn Ottosson)", `wcBGRz` "GT-VBAO Light&Occluder Heuristic (Björn Ottosson)", `3clGWB` "GT-VBAO thickness heuristic (Björn Ottosson)".

**Why this matters conceptually even without the source:** "sampling a distant light" from within a visibility-bitmask AO shader is, structurally, the same move as SSRT3's fallback — evaluate an occluded/unoccluded bitmask locally, then for the unoccluded sectors, sample *something at infinity* (a directional/distant light or, generalized, an environment map) instead of (or in addition to) local screen-space bounce. Framed as "distant light via spherical cap" (per the title pattern and the general spherical-cap-sampling literature that surfaced in search, e.g. https://arxiv.org/pdf/2306.05044, https://cg.ivd.kit.edu/english/sampling_spherical_caps.php — not confirmed to be the exact method Ottosson used, just the closest published technique with that name), the likely idea is analytically integrating a distant light's solid angle against the bitmask's unoccluded arc(s) rather than doing K discrete direction samples the way SSRT3/the paper do — i.e., a potentially cheaper/more-analytic sibling to the paper's discrete-K-subregion approach, for the specific case where the "ambient source" is a single distant directional light rather than a full environment. **This should be verified against the actual shader before being relied on** — flagged here as an unverified lead, not a source.

**Recommended manual follow-up** (not performable by this agent): open `https://www.shadertoy.com/view/wc2SzR`, `.../wcfGWB`, `.../wcBGRz`, `.../3clGWB` in a real browser, and/or open the X thread while logged in, and copy the GLSL / thread text by hand into the corresponding `research/sources/shadertoy/<id>/notes.md` files (which currently only contain placeholder "not accessible" stubs).

## 4. Implementation-level pseudocode (cross-reference)

The concrete, verified, implementation-level version of all of the above is the SSRT3 HLSL already quoted in full in `ssrt3-fallback.md` §2–3 — that code **is** the paper's §3.2 formula plus the CG Spotlight slide's "sample any ambient source in X directions, weight by unoccluded-sector ratio," made concrete: K = `_FallbackSampleCount`, subregions = equal contiguous bit-ranges of the same 32-bit slice bitmask used for AO, direction = a stratified cosine-space point on the `(realTangent, normalVS)` plane re-projected to remove the slice's `planeNormal` component, source = APV SH-irradiance-in-a-direction or reflection-probe cubemap (+ sky gap-fill). No separate pseudocode is repeated here; see that file for the full loop.
