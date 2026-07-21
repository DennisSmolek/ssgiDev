# Line-Sweep Ambient Obscurance (LSAO) — Technical Notes

**Ville Timonen** (Turku Centre for Computer Science / Åbo Akademi University), Eurographics Symposium on Rendering 2013, CGF Vol 32 No 4. PDF: `LineSweemAmbientObscurance.pdf`. BSD-licensed reference source was published at `http://wili.cc/research/lsao/` (CUDA).

**Why it's in this research base:** the SSILVB paper's future work (§5) names this as the fix for its own biggest cost problem: *"SSGI can be an expensive algorithm because it is very demanding on GPU bandwidth and utilizes the cache poorly. Using a caching method similar to LSAO could potentially improve this."* LSAO is cited there as [Tim13].

## The problem it attacks

Every prior SSAO/HBAO evaluates each receiver pixel independently: K azimuthal directions × N ray-march steps → **O(KN) per pixel**, and the effect radius directly drives cost (bigger radius = more steps or undersampling artifacts). LSAO is "the first attempt to reduce the underlying time complexity of SSAO since its inception in 2007": it computes HBAO-quality obscurance in **O(K) per pixel with unbounded radius** — radius has *zero* impact on execution time.

## Core idea — line sweeps + incremental obscurance hull

1. **Separability:** like HBAO, obscurance is separable per azimuthal direction. LSAO uses a globally fixed set of K discrete directions *shared by all pixels* (this sharing is both the speed win and the source of its one artifact: banding).
2. **Sweep, don't gather:** for each direction, sweep parallel lines across the whole depth buffer (one thread per line). Each visited point is deprojected to eye-space and pushed onto a stack.
3. **Obscurance hull (the data structure):** an adaptation of the incremental convex hull from Timonen & Westerholm 2010 height-field self-shadowing [TW10]. Before pushing a new point, points are popped while the new point casts *more falloff-weighted obscurance* onto the receiver than they do (pop test compares obscurance via the estimator, not geometric convexity — hence "obscurance hull," not necessarily convex; early-stack points progressively lose weight through the falloff). The **largest occluder is always on top of the stack** — amortized **O(1) per step** (each of M line steps = exactly 1 push, ≤ M total pops → between M and 2M inner iterations, O(M) per line).
4. **Largest-occluder approximation:** per direction, only the single occluder that casts the most falloff-weighted obscurance is used (Figure 2 right vs left). Slight *under*estimate (occluders below/above the largest are ignored), but "visual impact is modest" (Figure 3), and it's what buys the order-of-magnitude headroom. Degenerate hull cases (rapid depth changes where a popped point was actually the largest occluder) cause only 0.02–0.3% average AO error.

### Obscurance estimator

HBAO's estimator (Eq. 1), driven by horizon angle h and tangent angle t per direction; falloff ρ(d) = r/(r + d²) (Eq. 2). The pseudocode inner loop (Algorithm 1) is ~10 lines: deproject, pop-while-occludes-more, `writeResult(occlusion(h1, u_k))`, push, step.

### Tangent-plane subtlety (§4.1, Figure 7)

Eq. 1 depends on the receiver's tangent plane, but the hull is shared along the line, so hull-culling and obscurance-evaluation tangents can disagree. Three strategies: (1) real tangent for both — hull unfolds on steep slopes, misses occluders; (2) fixed tangent for hull, real for evaluation — perceptible discontinuities (jumps when the largest occluder switches); (3) **fixed tangent for both** — geometrically wrong but *consistent*, biased mostly toward under-occlusion; this is what they use, with sin(t) = −0.85.

## Sparse evaluation + gather (§5)

- Dense mode: lines 1px apart, 1px steps → obscurance evaluated at W·H points per direction.
- Sparse mode: lines D_L pixels apart, steps D_S pixels → **K/(D_S·D_L) obscurance values per pixel**. Final per-pixel gather averages the nearest evaluated value in each of the K directions (within radius √((D_S/2)² + (D_L/2)²)), optionally edge-aware (depth and/or normal thresholds).
- The trade triangle (their summary, verbatim gist): *small K + high D_L, D_S = fast; high K = less banding; small D_L, D_S = less blur.* Banding is hidden by increasing K (paid for with sparsity) rather than by a big post-blur.
- Snapping sample coordinates to texel centers (required — depth can't be interpolated across discontinuities) creates noise on slopes unless directions/step lengths are chosen so every receiver sees the *same* visited-sample pattern: directions from a (2n+1)×(2n+1) grid template → **K = 8n aligned directions** with matched D_S (Figure 10). Diagonal-heavy direction distribution is compensated by azimuthal-coverage weights.

## Implementation notes

- **Compute-only:** variable-length lines writing variable output counts "do not map well to fragment shaders" — they used CUDA. (Same constraint SSILVB inherits: three.js `SSGINode` is a fragment quad, so an LSAO-style pass would need WebGPU compute.)
- Two stages: line-sweep then gather. Table 2 (1280×720+guard): sweep ≈ 1.6–1.9 ms roughly *constant* as K rises (more, shorter threads → better utilization); gather grows 0.38 → 0.90 ms from K=8 to K=32.
- Intermediate buffer of K·W·H/(D_S·D_L) floats (~11 MB at 1080p configs). Scattering to the framebuffer with atomics instead was measurably slower (uncoalesced writes).
- "Our method takes very few texture samples and is not much impacted by a texture cache miss penalty" — *this* is the property SSILVB's future-work covets: traversal cost is amortized across all receivers on a line, and access is coherent along the sweep instead of per-pixel random.

## Results (GTX 480, 2013)

| Screen resolution | LSAO | HBAO |
|---|---|---|
| 800×600 | 1.49 ms | 10.5 ms |
| 1280×720 | 2.56 ms | 24.2 ms |
| 1920×1080 | 5.24 ms | 92.5 ms |
| 2560×1600 | 9.58 ms | 249 ms |

(Table 1, K=16, Sponza, 20% guard band, **unbounded radius** for LSAO.) ~2K inner-loop iterations per pixel on average vs HBAO's K·N. Hero shots: 1080p in 1.7 ms (Fig 1) and 2.3 ms (Fig 13). Scales linearly with resolution (slightly super-cubic growth reported for HBAO due to cache misses at large radii).

## Relevance to the SSGI/bitmask project

1. **The bandwidth prescription.** SSILVB Table 2 shows GI sampling is bandwidth-bound (uncorrelated per-pixel fetches of light + normal buffers). LSAO's answer: share depth-field traversal across all receivers on a line via a per-direction sweep with an incremental stack. That's the "caching method similar to LSAO" the SSILVB authors point to.
2. **Adapting it to a bitmask is an open problem, not a recipe.** LSAO's O(1)-per-step trick depends on collapsing each direction to a *single largest occluder*; a visibility bitmask needs the full per-sector occupancy, and GI additionally needs each sample's radiance weighted by newly-visible sectors. A sweep could still amortize the *depth/light fetches* (the expensive part) even if per-receiver sector math remains, but nobody in the gathered sources has built this.
3. **Structural fit with the unidirectional GT-VBAO/GI variants** (`Xc3yzs`, `4ctBRH`, `XcdBWf`): those already process one direction per pixel per frame, which is the same per-direction decomposition a sweep formulation wants.
4. **Costs to expect if pursued:** compute passes (WebGPU compute in three.js — outside `SSGINode`'s fragment-quad architecture), an intermediate buffer (~11 MB-class at 1080p), banding-vs-blur-vs-time tuning via (K, D_L, D_S), and LSAO's fixed-tangent bias trade-off.

---

## 2026-07 EXPERIMENTAL OUTCOME (bench lab 09, axis 2) — the paper's suggestion, tested

SSILVB §5's future-work claim ("using a caching method similar to LSAO could
potentially improve this") was put to numbers in `bench/src/demos/09-bandwidth`
(full tables in its README). Two readings were tested:

1. **Literal "caching": cooperative shared-memory depth tiles** (24×24 LDS tile
   per 8×8 workgroup, depth only — the tractable subset). **Negative result**:
   best case −13% (sponza, high samples, *small* radius); a wash at production
   radii (exponential far steps miss the tile → global fallback); slightly
   SLOWER on cornell (barrier + preload overhead unrepaid). Ceiling identified:
   GI also fetches light+normal per step at the same uncorrelated coords, and
   those stayed global.
2. **Structural: the line-sweep itself** — not portable to a visibility
   bitmask. LSAO's O(1)-per-step obscurance hull requires collapsing each
   direction to the single largest occluder; the bitmask estimator requires
   full per-sector occupancy (and GI needs per-sample radiance × newly-revealed
   sectors). "LSAO for bitmasks" = open research problem (a sweep maintaining a
   running sector mask per direction is unpublished in either direction).

**Interpretation:** the paper correctly diagnosed the disease (bandwidth,
cache-hostile gathers — lab 09 confirmed the march is fetch-bound: resolution
lever ≈4.5×, ALU rearrangement ≈0×) but its prescribed cure predates the
treatments that actually shipped in the following decade.

## Modern (2013 → 2026) answers to the same problem

- **Deinterleaved rendering** (Intel ASSAO → AMD FidelityFX CACAO): partition
  pixels into phase buckets so each bucket's fetches are coherent; process at
  reduced res per bucket, reassemble. The production-proven "make the fetches
  coherent" fix — and bitmask-compatible, since it reorganizes WHERE fetches
  happen, not the estimator. Closest true heir to the paper's suggestion.
- **Sparse evaluation + gather, modernized** = screen-space radiance caching:
  AMD GI-1.0 screen probes, Unreal Lumen's screen-probe gather + world radiance
  cache. Evaluate the expensive gather at sparse anchors, interpolate
  edge-aware — LSAO's own §5 sparse mode reborn with radiance instead of
  obscurance. Bitmask-compatible (interpolate irradiance, not masks).
- **ReSTIR-family spatiotemporal reservoir resampling**: share *samples* (with
  resampling weights) across pixels and frames instead of sharing traversal.
  The general modern replacement for cross-pixel work sharing.
- **Temporal amortization with per-pixel effort control** (our temporal-guides
  plan, `advantagous-concepts.md`): converged pixels coast on history, budget
  concentrates on disocclusions — amortize over TIME instead of along lines.
- **Hierarchy**: min-max depth pyramid step skipping (Hi-Z), distance-based
  mips on light/normal (the fetch classes lab 09 identified as the ceiling).
- **WebGPU subgroups** (shipping in browsers now): intra-wave sample sharing
  (subgroup broadcast/shuffle) — a barrier-free micro-realization of
  cooperative fetching; the LDS experiment's overhead argument does not
  automatically transfer. NOTE: usable in this repo TODAY — three r185
  auto-requests all adapter features and our marchers are raw WGSL
  (`enable subgroups;`), no three/TSL support needed. Scheduled as a Phase O
  variant (NEXTGEN.md P5), alongside deinterleaved phase-bucket marching
  (CACAO-style), the other scheduled heir. Radiance caching and ReSTIR are
  deliberately deferred (see P5 note).
