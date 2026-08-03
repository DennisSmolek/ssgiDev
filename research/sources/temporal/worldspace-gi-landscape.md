# World-Space GI on the Web: A Landscape Survey for WebGPU

*Prepared July 2026. Scope: real-time global illumination techniques viable (or worth studying) for a browser/WebGPU renderer. Excludes pure neural/ML methods and full ReSTIR path tracers, per request. Emphasis: full landscape first, WebGPU-viability tagged throughout.*

---

## TL;DR — the shape of the map

There are really only **five structural ideas** in real-time GI, and every named technique is a variation on one of them:

1. **Probes** — cache irradiance at points in space, interpolate at shading time. (SH light probes → **DDGI** → **radiance cascades**.)
2. **Voxels** — store radiance in a 3D grid and cone-trace it. (**VXGI / voxel cone tracing**, Godot **VoxelGI**.)
3. **Distance fields** — store distance-to-surface, sphere-trace rays, fetch light from a *separate* cache. (**SDFGI**, Unreal **Lumen** software path.)
4. **Surfels / radiance caches** — cache lighting on surface discs or in a spatial hash, trace few rays, reuse across frames. (EA **GIBS**, AMD **GI-1.0**, **id Tech 8**.)
5. **Screen-space** — reconstruct indirect light from the g-buffer you already have. (**SSGI**, **HBIL**, **SSILVB**.)

Plus two "supporting cast" ideas that people confuse for GI: **radiosity/lightmaps** (baked, static geometry) and **clustered/tiled light culling** (a *direct*-light optimization, not GI — this is almost certainly the "cluster light" you saw).

**The single most important fact for your situation:** WebGPU has **no hardware ray tracing** in the shipping spec. Every "clean, fast" GI number from the papers below (DDGI at 1–2 ms, id Tech 8 at 1.7–2.1 ms, GIBS, Bevy Solari) assumes RT cores. On the web you trace against an **SDF, voxel grid, or a CPU-built BVH traversed in compute** (three-mesh-bvh). That software-tracing tax is the real design constraint — not the GI algorithm you pick.

**Your instinct is right, but half-right.** Moving from SSGI toward DDGI/world-space is the correct direction *for the problems SSGI structurally cannot solve* (off-screen light, view-dependent popping). But a large fraction of your "intractable noise" is likely **algorithmic** — you're probably ray-marching the depth buffer (the noisy SSGI family), when the horizon/visibility-bitmask family (**SSILVB**) attacks the noise at the source and is already the basis of three.js's official WebGPU SSGI. Fix the near-field cheaply first; add world-space as the far-field fallback second. That's what every shipping engine actually does.

---

## The comparison matrix

Difficulty is a 1–5 build-from-scratch-in-WGSL rating. "WebGPU fit" folds in the no-hardware-RT reality.

| Technique | Family | How light is gathered | Difficulty | Dynamic geo | Light leak | Diffuse/Spec | WebGPU fit |
|---|---|---|---|---|---|---|---|
| **SH light probes** | Probe | Interpolate 8 nearest SH probes | 2 | No (baked) | High | Diffuse | Trivial (exists in three.js) |
| **DDGI** | Probe | Ray-trace probes + Chebyshev visibility | 4 | Yes | Low–Med | Diffuse | Viable; needs software tracer. **Proven (Orillusion)** |
| **Radiance Cascades** | Probe | Cascade of probes, coarse→fine merge | 3 (2D) / 5 (3D) | Yes | Low (if bilinear fix) | Both | Great fit in 2D/2.5D; 3D is open research |
| **Voxel Cone Tracing / VXGI** | Voxel | Cone-march mipped radiance voxels | 4 | Yes | **High** | Both | Feasible (WebGL2 refs); use clipmap not octree |
| **SDFGI (Godot-style)** | SDF | Sphere-trace SDF → probe irradiance | 4 | Partial | Low–Med | Both | Sphere-trace is easy; SDF baking is the work |
| **Lumen (software path)** | SDF+cache | Screen→SDF trace → surface cache | 5 | Yes | Low–Med | Both | Reference architecture, not a clone target |
| **Surfel GI (GIBS)** | Surfel | Ray-trace surfels, interpolate to pixels | 5 | Yes | Med | Diffuse | **Proven on WebGPU (webgiya)**, heavy |
| **AMD GI-1.0** | Radiance cache | Screen-probe + world-cache, few rays | 5 | Yes | Med | Both (1.1) | Hard; needs BVH emulation |
| **id Tech 8** | Probe+hash cache | Multi-cache final gather (SS→world→probe) | 5 | Yes | Low | Both | Architecture portable; RT primitive is not |
| **LPV** | Voxel/SH | Flood-propagate SH through grid | 2–3 | Yes | **High** | Diffuse | Excellent; WebGL ref exists |
| **RSM** | Many-light | Sample shadow-map texels as VPLs | 2 | Yes | **High** | Diffuse | Excellent, cheapest real GI; **in Babylon.js** |
| **Instant Radiosity / VPLs** | Many-light | Scene lit by many virtual point lights | 4 | Partial (flicker) | Med | Diffuse | Feasible; pairs with clustered |
| **Radiosity / lightmaps / PRT** | Baked | Texture fetch / SH dot product | 4 bake / 2 use | **No** | Low | Diffuse | Excellent runtime, but bake step |
| **Clustered/tiled culling** | *(not GI)* | Light-list lookup per cluster | 3 | Yes | N/A | — | Excellent; you likely want this anyway |
| **SSGI (ray-marched)** | Screen-space | Hi-Z march, gather hit radiance | 3–4 | Yes | Leaks (thickness hack) | Both | Cheap but **this is your noise source** |
| **SSILVB / HBIL** | Screen-space | Horizon sweep, analytic integrate | 3 | Yes | Low (bitmask) | Diffuse | **Great fit; three.js official uses it** |

---

## Part 1 — Probe methods

### SH light probes (the baseline everything else improves on)
A grid of points, each storing directional irradiance as low-order spherical harmonics (usually 9 coefficients/channel). A shading surface samples the 8 nearest probes, trilinearly interpolates, evaluates along its normal. Cheap to the point of being free; tiny memory. **But** there's no visibility stored, so light leaks straight through thin walls, and it's baked (static). This is the canonical leaking baseline DDGI was invented to fix.

- Difficulty 2 · static · leaks badly · diffuse only.
- three.js WebGPU example: <https://threejs.org/examples/webgpu_lightprobe.html>
- Irradiance Volume (Greger 1998): <https://www.researchgate.net/publication/3208677_The_Irradiance_Volume> · Ramamoorthi SH irradiance: <https://cseweb.ucsd.edu/~ravir/papers/envmap/envmap.pdf>

### DDGI — Dynamic Diffuse Global Illumination
The upgrade that made probes dynamic (Majercik et al., JCGT 2019). Each frame, trace a stochastic spray of rays (64–256) *per probe*, shade each hit (direct light + last frame's probe irradiance for multi-bounce), and blend results into two octahedral atlases per probe: an **irradiance** map and a **visibility/distance** map storing mean and mean-squared depth. Temporal hysteresis (~0.97) converges probes over frames. At shading time, the killer feature is the **Chebyshev visibility test** (variance-shadow-map math): using stored mean/variance depth toward the shade point, compute the *probability* the probe can see the point, and weight it down if it's on the far side of a wall. This is what fixes leaking.

Two follow-up features matter for quality: **relocation** (nudge a probe out of geometry using backface-hit ratio) and **classification** (skip probes that see no nearby geometry — a real perf win in interiors).

- Difficulty 4 · fully dynamic · leak control good (imperfect when wall thickness ≈ probe spacing) · diffuse only (pair with SSR for glossy).
- **The WebGPU catch:** DDGI's cheap numbers assume hardware RT to update probes. On the web you must trace against an SDF/voxel/BVH — that tracer is the actual project.
- Paper (free PDF): <https://www.jcgt.org/published/0008/02/01/paper-lowres.pdf> · Production scaling paper: <https://jcgt.org/published/0010/02/01/paper-lowres.pdf>
- McGuire's readable overview: <https://morgan3d.github.io/articles/2019-04-01-ddgi/overview.html>
- NVIDIA RTXGI-DDGI SDK + algorithm docs: <https://github.com/NVIDIAGameWorks/RTXGI-DDGI>
- Vulkan reference impl: <https://github.com/helenl9098/Dynamic-Diffuse-Global-Illumination-Minecraft> · another: <https://github.com/xuechao-chen/DDGI> · SDF-based DDGI (relevant to software tracing): <https://arxiv.org/pdf/2007.14394>
- **Proven on WebGPU:** Orillusion, a WebGPU-native engine, ships a DDGI implementation: <https://www.orillusion.com/en/guide/>

### Radiance Cascades (Sannikov / Path of Exile 2)
The genuinely new idea. Built on the **penumbra hypothesis**: you need high *spatial* resolution near a point but only high *angular* resolution far away, and the two trade off with distance. RC exploits this with a cascade hierarchy — cascade 0 is a dense probe grid casting few short rays; each higher cascade **halves probe density but doubles ray count** and covers a longer radial interval. Merging coarse→fine reconstructs the full radiance field. In **2D this is noise-free with no temporal accumulation** and **geometry-agnostic** (cost depends on grid resolution, not triangle count) — which is why it's magic for compute shaders.

Two caveats you must budget for: naive merging produces **ring artifacts**, fixed by Sannikov's **bilinear fix** (trace each interval 4× toward the parent probes, ~4× merge cost). And **3D is an open problem** — the angular domain becomes a full sphere and the favorable 2D cost balance breaks. Current 3D web demos fall back to *screen-space* probes (with the usual screen-space limits). Also note Sannikov's depth-aware upscaler is **not licensable**, which complicates commercial reuse.

- Difficulty 3 (2D) / 4 (screen-space 3D) / 5 (true world-space 3D) · fully dynamic · low leak with bilinear fix · both diffuse and specular.
- Hub (best resource, notes the 3D open problem): <https://radiance.wiki/>
- Interactive build-it tutorial: <https://jason.today/rc> and <https://jason.today/gi>
- Bilinear-fix explainer (Xor & Sannikov): <https://mini.gmshaders.com/p/radiance-cascades>
- Paper mirror: <https://github.com/Raikiri/RadianceCascadesPaper>
- **WebGPU demos:** tmpvar 2D <https://tmpvar.com/poc/radiance-cascades/> · tmpvar 3D <https://tmpvar.com/poc/radiance-cascades-3d/> · playground <https://radiance-cascades.com/>
- **three.js 3D RC** (screen-space probes + three-mesh-bvh; note: WebGL, noise-free diffuse+specular): <https://github.com/CodyJasonBennett/three-rc>
- Bevy/wgpu (compiles to WebGPU): <https://github.com/nixonyh/bevy_radiance_cascades>
- ⚠️ Don't confuse with the *astrophysics* "Radiance Cascades" arXiv paper (2408.14425) — unrelated, same name.

---

## Part 2 — Voxel and distance-field methods

**The key mental split:** voxel cone tracing stores *light/color* in the voxels and cone-filters it directly. SDF methods store only *distance to geometry* and get light from a **separate** cache/probe structure. That decoupling is why SDF leaks less and scales to bigger worlds — at the cost of needing a second lighting structure.

### Voxel Cone Tracing / VXGI (Crassin 2011)
Voxelize the scene into a mipmapped volume (originally a sparse octree; modern versions use a **camera-centered clipmap**) where each voxel stores averaged radiance + opacity. To shade a point, launch ~5–9 **cones** over the hemisphere (plus one tight cone for specular) and march each, sampling the mip level whose voxel size matches the cone's current radius. Widening cones cheaply approximate integrating many rays → soft diffuse + glossy + AO, fully dynamic, no RT hardware.

Signature weakness: **light leaking** through walls thinner than a voxel (voxels average occupancy). Plus revoxelization cost/memory and boundary flicker.

- Difficulty 4 (octree 5, clipmap 3–4) · dynamic (revoxelize for moving geo) · **high leak** · both.
- Paper: <https://maverick.inria.fr/Publications/2011/CNSGE11/I3D2011_Poster_web.pdf>
- Godot VoxelGI (production VCT): <https://docs.godotengine.org/en/stable/tutorials/3d/global_illumination/using_voxel_gi.html>
- **WebGL2 impl (closest to web):** <https://github.com/novalain/gi-voxels>
- Best study reference (clipmap, fully dynamic): <https://github.com/compix/VoxelConeTracingGI> · no-SVO variant: <https://github.com/rdinse/VCTGI>
- No mature dedicated WebGPU VCT found — porting compix to WGSL compute is the realistic path.

### SDFGI (Godot 4) and Lumen's software path
Store a **signed distance field** (each cell = distance to nearest surface), in *cascades* around the camera. Gather GI by **sphere-tracing** rays (step by the stored distance, skipping empty space fast). The SDF has no color, so light comes from a **decoupled cache**: Godot uses a dense **irradiance probe grid with an occlusion term**; Lumen uses its **Surface Cache**. Godot calls SDFGI "a dynamic real-time lightmap that needs no unwrapping" — diffuse + sharp/rough specular + emissive, 60fps on a GTX 1060.

Mostly leak-free (thanks to probe occlusion) *if* walls are thicker than a cascade cell. Godot's big limitation: **dynamic objects only receive GI, they don't contribute it** (no dynamic occluders/emitters), and the SDF only refreshes on cascade-boundary crossings.

- Difficulty 4 · partial dynamic · low–med leak · both.
- Godot SDFGI docs: <https://docs.godotengine.org/en/stable/tutorials/3d/global_illumination/using_sdfgi.html>
- Announcement (leak-vs-VCT rationale): <https://godotengine.org/article/godot-40-gets-sdf-based-real-time-global-illumination/>
- Standalone SDFGI study repo: <https://github.com/carlos-lopez-garces/SDFGI>
- ⚠️ **Godot SDFGI does NOT run on web exports** — it needs the Forward+ renderer; web only has Compatibility. Same for VoxelGI. Study it for the algorithm, not as a web-shippable path.
- Sphere-tracing is trivial in WGSL; the real work is baking arbitrary meshes into cascaded SDFs + the probe system.

### Unreal Lumen (reference architecture, not a clone target)
A hybrid, multi-tier system and the best real-world example of layering these ideas. For each ray it tries the cheapest reliable source first: **(1) screen traces** against the depth buffer, then falls back to **(2) world-space** — either the *software* path (sphere-trace Mesh Distance Fields merged into a **Global Distance Field**) or the *hardware* path (trace triangles via RT cores). Once a ray hits, lighting is read from the **Surface Cache** (an atlas of per-mesh "cards"), amortized over many frames — this is what makes many dynamic lights + multi-bounce affordable.

- Difficulty 5 (a production research system) · fully dynamic · low-but-present leak (needs modular geometry, walls ≥10 cm).
- **The transferable idea:** decouple geometry (distance field) from lighting (surface cache/probes), and layer screen traces → world traces. This is exactly what id Tech 8 does too.
- Technical details: <https://dev.epicgames.com/documentation/en-us/unreal-engine/lumen-technical-details-in-unreal-engine>

### Light Propagation Volumes (LPV, Crytek)
The cheap ancestor (ran on Xbox 360/PS3). Inject radiance from a reflective shadow map into a coarse 3D grid of SH cells, then **iteratively flood-propagate** it cell-to-cell (a diffusion step, no tracing at all), gated by a low-res occlusion grid. Sample the nearest cell's SH for one blurry diffuse bounce.

- Difficulty 2–3 (cheapest to stand up) · fully dynamic · **high leak** (worst of the group) · diffuse only.
- Cascaded LPV paper: <https://cg.ivd.kit.edu/publications/p2010/CLPVFRII_Kaplanyan_2010/CLPVFRII_Kaplanyan_2010.pdf>
- Approachable writeup: <https://ericpolman.com/2016/06/28/light-propagation-volumes/>
- **WebGL impl (directly portable to WebGPU):** <https://github.com/Global-Illuminati/Light-Propagation-Volumes>

### Data structures: sparse voxel octree vs clipmap
Not GI algorithms — the *storage* the above use. **SVO** = adaptive tree, best memory for sparse/huge static scenes, but pointer-chasing traversal and dynamic GPU updates are research-grade hard (difficulty 5). **Clipmap** = a few camera-centered uniform 3D textures at cascaded resolutions, toroidally scrolled as the camera moves — bounded memory, cheap hardware trilinear sampling, easy dynamic updates (difficulty 3). **For WebGPU, always choose the clipmap.** Modern VXGI/SDFGI/Lumen all use cascades, not octrees.

---

## Part 3 — Surfels, radiance caches, and id Tech 8

### Surfel GI — EA SEED GIBS
A **surfel** is an oriented disc (position + normal + radius). The point: surfels **decouple lighting from screen resolution** — shade ~50k surfels to light a 2M-pixel screen, and cache that work across frames. GIBS spawns surfels *on the fly* from the g-buffer (no bake, no UVs), stores them in a camera-centered hash grid, ray-traces a few rays *per surfel* (with ray guiding + binning to cut noise), temporally integrates per-surfel irradiance, and interpolates onto pixels. Shipped in EA SPORTS College Football 25. Requires hardware RT.

- Difficulty 5 · fully dynamic (incl. skinned) · med leak (per-surfel depth/VSM) · diffuse.
- Slides + talk: <https://www.ea.com/seed/news/siggraph21-global-illumination-surfels> · PDF: <https://advances.realtimerendering.com/s2021/SIGGRAPH%20Advances%202021%20-%20Surfel%20GI.pdf>
- **⭐ The single best WebGPU reference for you — webgiya:** a complete GIBS-style surfel GI in ~3000 lines of TS/WGSL, ~13 compute passes/frame, that documents *exactly* which WebGPU limits bite.
  - Repo: <https://github.com/jure/webgiya> · demo: <https://jure.github.io/webgiya/> · **excellent writeup:** <https://juretriglav.si/surfel-based-global-illumination-on-the-web/>
  - It emulates RT with **three-mesh-bvh** (<https://github.com/gkjohnson/three-mesh-bvh>), uses EA's Multi-Scale Mean Estimator for temporal stability, and Moment Shadow Mapping per-surfel for leak control.
  - **Documented WebGPU blockers:** no hardware RT (<https://github.com/gpuweb/gpuweb/issues/535>); Chrome's **10-storage-buffers-per-compute-pass** limit forced buffer merging; no bindless. Author states many-lights and fully dynamic geometry are "effectively impractical" in this WebGPU build today (current demo: static geo, diffuse, one directional light — but runs 60fps on desktop *and* mobile Safari).

### AMD GI-1.0
A **two-level radiance cache** (screen-probe + coarser world cache) that uses hardware RT but caches radiance to slash ray counts. Open source inside AMD's Capsaicin D3D12 framework, with a reference path tracer to validate against; GI-1.1 added glossy.

- Difficulty 5 · fully dynamic · med leak · both (1.1).
- Paper: <https://gpuopen.com/download/publications/GPUOpen2022_GI1_0.pdf> · Capsaicin: <https://gpuopen.com/capsaicin/>

### id Tech 8 — "Fast as Hell" (Doom: The Dark Ages, 2025)
**This is the talk you were thinking of, and it's real and public.** *"Fast as Hell: idTech 8 Global Illumination"* by **Tiago Sousa** (id Software), SIGGRAPH 2025 Advances course.

- **Slides (primary source, full speaker notes):** <https://advances.realtimerendering.com/s2025/content/SOUSA_SIGGRAPH_2025_Final.pdf>
- Talk video: <https://www.youtube.com/watch?v=VTrdeqMMMK0> · the X post you saw: <https://x.com/panoskarabelas1/status/1960345478710669560>

**What it actually is** (this matters, because people conflate it with Lumen and with path tracing): a **hardware-ray-traced probe + radiance-cache pipeline**, NOT a surface cache, NOT voxel GI, NOT path tracing (in the base game). Per-frame flow: Light Grid → World Visibility → **World Radiance Cache** → **Irradiance Volumes** → **Final Gather** → Denoise → Upscale. Components:

- **Cascaded Irradiance Volumes** — DDGI-style probes; storage explicitly "similar to DDGI [Majercik 2019]" (octahedral atlas, RGB9E5 + RG16F visibility, ~64 MB). Probes trace *visibility only* (16/32/64 rays), interleaved updates.
- **World Radiance Cache** — a **spatial hash** grid (Gautron 2020), 25 cm³ cells, only ~14 MB. This is their "surface cache" analog, but hash-based.
- **Final Gather** — 1 ray/pixel at ½ or ¼ res, blue noise, **zero shading**, just a 3-level cache lookup: **screen-space cache → world radiance cache → irradiance-volume fallback**. Output stored as 2-band SH (each pixel becomes an irradiance probe).

Rationale for going ray-based: the old idTech 7 baked-lightmap path would have needed ~44–110 GB on disk and weeks of bake turnaround for Dark Ages' ~5000 km² levels. Ray GI → **0 GB baked, instant iteration**. The whole GI stack runs **~1.7–2.1 ms/frame** across Series S/X, PS5, PC at ≥60Hz. id Tech 8 is the first id engine to *require* RT-capable hardware. (Path tracing is a *separate, later PC update* using NVIDIA SHaRC + DLSS-RR — don't conflate it with the shipping GI.)

- Digital Foundry × Billy Khan: <https://www.youtube.com/watch?v=Ed4vNNQwCDU>
- Path-tracing update interview: <https://developer.nvidia.com/blog/how-id-software-used-neural-rendering-and-path-tracing-in-doom-the-dark-ages>

**Relevance to WebGPU:** the RT primitive is a hard blocker (no 1:1 port). But the **architecture is highly portable and is essentially a super-set of what you already have** — DDGI-style probes + a spatial-hash world radiance cache + an SH final gather with a screen→world→probe fallback chain. That fallback chain is the blueprint. Bevy **Solari** (jms55) is the closest open-source cousin (ReSTIR DI/GI + world irradiance cache), but it also needs hardware RT via wgpu and does **not** run in the browser today. Study both for structure, not for shippable code.

---

## Part 4 — Many-light and baked methods (the supporting cast)

### Clustered / tiled light culling — NOT global illumination
Important clarification: **"cluster light" is a light-culling technique, not GI.** It answers "which of my N *direct* lights affect this pixel," letting you shade thousands of direct lights cheaply (subdivide the frustum into a 3D grid, assign lights to clusters, look up per cluster). It only becomes GI-relevant as the *delivery mechanism* for VPL/RSM many-light GI. Very implementable in WebGPU compute, and you probably want it in your renderer regardless.

- Clustered shading paper (Olsson et al.): <https://www.highperformancegraphics.org/previous/www_2012/media/Papers/HPG2012_Papers_Olsson.pdf>

### Reflective Shadow Maps (RSM) — cheapest real GI
Extend a light's shadow map so each texel also stores world position, normal, and reflected flux — every shadow-map pixel becomes a tiny indirect light (a VPL). Sample a neighborhood of them per pixel for single-bounce indirect diffuse. Base method **ignores indirect occlusion** → fast but leaks/over-brightens.

- Difficulty 2 · fully dynamic · **high leak** (no occlusion) · diffuse.
- Paper: <https://users.soe.ucsc.edu/~pang/160/s13/proposal/mijallen/proposal/media/p203-dachsbacher.pdf>
- **Shipping in Babylon.js 8** as `GIRSM`: <https://doc.babylonjs.com/features/featuresDeepDive/lights/rsmgi> (Babylon 8 also added voxel-based IBL shadows.)

### Instant Radiosity / Virtual Point Lights
Shoot particles from lights; deposit a VPL at each hit; light the scene with lights + VPLs. Naturally multi-bounce, reuses your many-light path (hence pairs with clustered), but VPLs are poor at glossy, spike near surfaces (needs clamping), and flicker across frames.

- Difficulty 4 · partial dynamic (flicker) · med leak · diffuse.
- Forward+ Instant Radiosity impl: <https://github.com/rohith10/ForwardPlus-InstantRadiosity>

### Radiosity / lightmaps / PRT (Enlighten-style)
Precompute the expensive visibility/form-factor part offline, then at runtime either solve radiosity progressively (Enlighten — allows runtime light-color/intensity changes, e.g. time-of-day) or dot SH environment lighting against precomputed transfer vectors (PRT). Extremely cheap at runtime, smooth, leak-controlled — but **static geometry only** and a slow bake step.

- Difficulty 4 to build a baker / 2 to consume · dynamic lights, **static geo** · low leak · diffuse.
- Enlighten: <https://www.siliconstudio.co.jp/middleware/enlighten/en/techinfo/> · Unity Realtime GI: <https://docs.unity3d.com/Manual/realtime-gi-using-enlighten.html> · PRT (Sloan 2002): <https://en.wikipedia.org/wiki/Precomputed_Radiance_Transfer>

---

## Part 5 — SSGI vs world-space, and your noise problem

### There are two SSGI families, and conflating them is the root of your pain
**Family A — ray-marched (SSR-style).** Trace a few stochastic rays into the Hi-Z depth buffer per pixel; on a hit, read that pixel's shaded color as one incoming-radiance sample. Mechanically identical to SSR but with cosine-hemisphere directions. **This is Monte Carlo integration of the whole hemisphere with 1–4 samples/pixel — it is noisy by construction.** If your test bench is "intractably noisy," you're almost certainly here.

**Family B — horizon / visibility-bitmask (HBAO → GTAO → HBIL → SSILVB).** Treat the depth buffer as a height-field; for each pixel, sweep azimuthal slices, find horizon angles, and **analytically integrate** the visibility/radiance between samples instead of stochastically sampling it. Every sample along a slice contributes (an SSR ray contributes at most once, on a hit), so it's **dramatically less noisy at equal sample count**. **SSILVB** (Screen-Space Indirect Lighting with Visibility Bitmask, 2023) is the current state of the art: it packs a 32-sector hemisphere into a single `u32` bitmask, each depth sample sets a run of bits with a shift-and-mask, and it fixes horizon methods' worst failure (thin-surface over-darkening; light passing *behind* surfaces).

**This is the highest-leverage, lowest-effort move you have:** switching the near-field integrator from Family A to SSILVB attacks the noise at the source rather than downstream in a denoiser — and it's *already* the direction the web took. three.js's official WebGPU SSGI is built on SSILVB, not ray marching.

- SSILVB paper: <https://arxiv.org/pdf/2301.11376> · GLSL writeup: <https://cybereality.com/screen-space-indirect-lighting-with-visibility-bitmask-improvement-to-gtao-ssao-real-time-ambient-occlusion-algorithm-glsl-shader-implementation/>
- HBIL (Mayaux 2018): <https://github.com/Patapom/GodComplex/tree/master/Tests/TestHBIL> · GTAO (Jimenez 2016): <https://research.activision.com/publications/archives/atvi-tr-16-01practical-realtime-strategies-for-accurate-indirect-occlusion> · XeGTAO: <https://github.com/GameTechDev/XeGTAO>
- SSRT3 (GTAO-based SSGI + probe fallback, ~25–50% faster & less noisy than Unity's ray-marched SSGI): <https://github.com/cdrinmatane/SSRT3>
- **three.js official WebGPU SSGI (SSILVB):** <https://threejs.org/examples/webgpu_postprocessing_ssgi.html> (`SSGINode` docs: <https://threejs.org/docs/pages/SSGINode.html>)
- Anderson Mancini WebGPU SSGI demo: <https://ssgi-webgpu-demo.vercel.app/> · WebGL SSGI (0beqz, ray-marched + SVGF — a case study in *why* denoising this is hard): <https://github.com/0beqz/realism-effects>

### Why ray-marched SSGI noise is so hard to kill
- **Undersampling.** You integrate a full hemisphere with ~1–4 rays; most rays exit the screen without hitting anything → variance with no signal.
- **Temporal accumulation is the standard fix and where the artifacts live.** Reprojecting last frame boosts samples cheaply but brings: **ghosting** (slow blends that kill noise smear motion), **disocclusion** (newly revealed pixels have no history → noise floods back as trails behind moving objects — SVGF/ReBLUR ramp history back up over several frames), **thin-feature loss** (edge-aware filters can't find valid neighbors on thin geometry), and **subtly wrong reprojection** for indirect light (bounced radiance moves with the *source* geometry, not the receiver).

Net: SVGF/ReBLUR make 1-spp path tracing look clean on *static* frames, but degrade exactly when the screen changes — which is always in an interactive renderer.

### The fundamental wall: SSGI only knows what's on screen
This is not tuning — it's the definition:
- **No off-screen occluders or emitters** — a bright wall just outside the frustum contributes nothing; light "disappears" when its source leaves the screen.
- **No behind-surface information** — a single depth layer is a height-field; the "thickness" hack is a fudge for the unknown.
- **View-dependent popping** — turning the camera changes the available bounce sources, so indirect lighting shifts and pops. No denoiser can fix this; the signal genuinely changed.

World-space methods exist precisely to supply this missing off-screen/behind-surface radiance.

### SSGI vs world-space — the honest comparison

| Dimension | Screen-space (SSGI/SSILVB) | World-space (DDGI/voxel/SDF) |
|---|---|---|
| Off-screen / behind-surface light | ❌ none (the core failure) | ✅ full scene, view-independent |
| View-dependent popping | ❌ pops as things enter/leave frame | ✅ stable regardless of camera |
| Spatial detail | ✅ pixel-perfect contact GI/AO | ❌ grid/voxel-limited, blurry |
| Noise | A: high; B: low | ✅ essentially none |
| Temporal stability under motion | ❌ ghosting/disocclusion trails | ✅ high (probes lag slightly instead) |
| Precompute / authoring | ✅ none | mostly none (DDGI runtime) but needs probe config + bias tuning |
| Cost driver | screen resolution (cheap ~1–3 ms) | ray budget + probe count — **assumes RT backend** |
| Glossy / specular | partial (shares SSR pipe) | ❌ diffuse only — add separate specular |

**The 2026 answer is hybrid, and it's the architecture, not a compromise.** Near-field contact detail from screen-space; far-field/off-screen/behind-surface from world-space probes/voxels. Lumen does it (screen traces first, SDF/voxel fallback). DDGI's own authors say DDGI "must be paired with a separate glossy GI solution such as screen-space ray tracing." SSRT3 ships it in miniature (horizon SSGI + probe fallback). id Tech 8's final gather *is* this chain (screen cache → world cache → irradiance volumes).

---

## Part 6 — Recommendation, difficulty-ranked for WebGPU

You already have DDGI world-space probes + a light-leak variant, and a noisy SSGI bench. Here's the path I'd take, cheapest/highest-leverage first:

**1. Fix the near-field noise at the source (difficulty 3, days-to-weeks).** Replace ray-marched SSGI with **SSILVB**. A 32-sector bitmask is one `u32`; `countOneBits()` is a native WGSL builtin; it's one compute pass + a cheap bilateral denoiser. You get less noise *and* correct thin-surface handling *and* light passing behind surfaces — the three things ray marching fights hardest. Reference: three.js `SSGINode`, XeGTAO, SSRT3. This alone may end your "losing battle."

**2. Keep and harden your DDGI as the far-field base (difficulty 4, you're already here).** Once the near-field is clean, your remaining problems (off-screen light, camera-turn popping) are exactly what DDGI solves. Invest in relocation + classification and Chebyshev bias tuning. Wire it as the *fallback* under SSGI, not a replacement.

**3. Add a world radiance cache — the id Tech 8 move (difficulty 4–5, the interesting project).** A **spatial-hash radiance cache** (25 cm³ cells, ~14 MB in id Tech 8) sitting between screen-space and your probes gives you a screen→world-cache→probe **final-gather fallback chain**. This is the single most impactful architectural upgrade available to you, it's exactly what the "Fast as Hell" talk describes, and none of it needs hardware RT if you trace against your existing probe/SDF/BVH structures. Start from the SOUSA slides + the webgiya hash-grid code.

**4. Optional near-term wins depending on scene type:**
- Static/architectural scenes → **baked lightmaps/PRT** for a leak-free diffuse base (difficulty 2 to consume). Cheapest quality.
- Want glossy + AO cheaply and can tolerate leak → **clipmap voxel cone tracing** (difficulty 4, study compix + novalain/gi-voxels).
- Want the newest toy and mostly 2.5D → **radiance cascades** (difficulty 3 in 2D; budget for the bilinear fix; 3D is still research).

**What to skip on WebGPU for now:** true 3D world-space radiance cascades (open research), SVO-backed voxel GI (GPU build is a time sink — use clipmaps), and anything assuming hardware RT budgets (GIBS/GI-1.0/Solari as *shippable code* — study them as architecture).

**Reference renderers to keep open while you build:** webgiya (WebGPU surfel GI + documented WebGPU limits), three.js `SSGINode` (official WebGPU SSILVB), three-rc (RC in 3D), the SOUSA id Tech 8 slides (your target architecture), and Lumen's technical docs (the layering philosophy).

---

## Uncertainty notes
- **WebGPU hardware ray tracing** is not in the shipping spec as of mid-2026 (tracking issue gpuweb#535). Verify current browser status before committing — a native RT extension would change the calculus significantly.
- Memory/perf figures (DDGI ~5–20 MB, id Tech 8 caches, SSGI ms timings) are from desktop RT hardware or specific papers; a software WebGPU port on browser + mobile will be materially slower.
- three-rc is tagged WebGL (not WebGPU) despite being 3D three.js; it uses screen-space probes + a BVH.
- "GTGI" isn't one canonical paper — it's shorthand for extending GTAO's slice integration to carry radiance; HBIL and SSILVB are the concrete realizations.
