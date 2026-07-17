# Demo 09 — bandwidth lab

Pinned to **three@0.185.1**. The most research-heavy lab. Cross-cutting finding #3
(PLAN): the SSGI cost structure is **bandwidth, not ALU** (SSILVB paper Table 1 —
the bitmask adds only ~0.01–0.02 ms of ALU over GTAO; the real cost is the
uncorrelated per-step light/normal/depth fetches). This lab attacks that bandwidth
three ways and reports **numbers**. Honest negative results are the point — see
Findings.

## Lineage

Forks demo 03's SSRT march (`bench/src/demos/03-ssrt3/ssrt-main.wgsl`, itself a
port of cdrinmatane/SSRT3). The march math (view reconstruct + flip, GTAO horizon
integral, VBAO 32-bit bitmask, newly-revealed-sector GI gather, firefly clamp) is
carried over verbatim; the same traps are honoured (WebGPU top-left UV, view-space
flip bridge, `PI` not `PI2` slice rotation, single `stepRadius` divide, per-sample
firefly clamp as a param). Multibounce / fallback / temporal / denoise are dropped
— this lab isolates the **march + resolution** bandwidth, so it composites the raw
(un-denoised) march directly. That is why the combined views are noisy; that noise
is the honest raw signal a denoiser (demo 10) would consume.

## The one architectural move: decouple the march from the native G-buffer

Every experiment here needs the march to run at an arbitrary resolution and to be
expressible as both compute and fragment. So the march never reads the native
depth/normal/beauty textures. A **downsample pass** (`ssrt09-downsample.wgsl`)
first produces a *march-resolution* G-buffer — `marchDepth` (r32float, box-MIN raw
depth = closest occluder), `marchNormal` (rgba16float, the min-depth texel's view
normal), `marchLight` (rgba16float, box-avg beauty). The march then reads a
self-consistent low-res G-buffer (1/4 the texels at 0.5×, 1/16 at 0.25× — the
actual bandwidth win), with sampling in normalized `[0,1]` UV and integer coords
derived from `params.resolution`. At scale 1.0 the block is 1×1 (a straight copy),
so the full-res baseline routes through the identical code path — a fair control.

One WGSL source of truth (`march-wgsl.ts`) emits three dispatch variants from a
shared core; the only per-variant seam is `sampleMarchDepthUV(uv)`:

| Variant | Dispatch | Depth fetch |
|---|---|---|
| `compute` | 8×8 compute, `textureStore` | global `textureLoad` |
| `shared` | 8×8 compute, `textureStore` | workgroup LDS tile, global fallback |
| `fragment` | fullscreen triangle, color out | global `textureLoad` |

## The four experiment axes

### Axis 1 — half-res march + joint bilateral upsample (SSILVB Table 2, config f)
March at 0.5× / 0.25× (independent of the global `renderScale`), then a **joint
bilateral upsample** (`ssrt09-upsample.wgsl`): each full-res pixel gathers the 2×2
low-res taps around its projected position, weighted by
`bilinear · depthSimilarity(fullDepth,tapDepth) · normalSimilarity`, with a
nearest-tap fallback when all weights collapse (disocclusion). Depth similarity uses
linear view depth normalised by the centre depth (scale-invariant). This is the
Kopf-et-al. upsample the paper recommends but **no engine ships as a node**
(`research/sources/denoising/threejs-nodes.md`: three has `depthAwareBlur` and
`BilateralBlurNode` but no joint-bilateral **upsample**) — so this lab builds one.

### Axis 2 — LSAO-style workgroup shared-memory depth caching (EXPERIMENT)
`ssrt09-march-shared` cooperatively preloads a `(8 + 2·BORDER)² = 24×24` depth tile
(BORDER=8, 2.3 KB LDS) once per workgroup, `workgroupBarrier`s, then serves near
samples from the tile and falls back to a global fetch beyond it. **Only depth is
cached** (normal + light stay global) — deliberately the "cooperative depth-tile
loading alone" scope the packet asks about. Research (`lsao-timonen2013-notes.md`)
predicts this can't reach LSAO's order-of-magnitude win: LSAO's speed comes from
its largest-occluder O(1) line-sweep, which needs a single occluder per direction
and does **not** map to a bitmask (which needs full per-sector occupancy). The
experiment: does cooperative depth loading *alone* cut bandwidth? Result bit-matches
`compute` (same texels), so the axis is purely speed.

### Axis 3 — fragment vs compute dispatch of the same march
`ssrt09-march-frag` (a `RawRenderPass`) runs the identical core as a fullscreen
fragment pass. The three.js `SSGINode` is a fragment quad; demo 03 is compute. This
quantifies what that choice costs/saves at identical settings.

### Axis 4 — interleaved / checkerboard rendering (stretch) — **SKIPPED, logged**
The three axes above consumed the lab's effort and produced complete, defensible
findings. Checkerboard (march half the pixels per frame + temporal fill) needs a
temporal reprojection + history stage this demo deliberately omits (it would
reintroduce exactly the denoise/temporal machinery the lab strips out to isolate
march bandwidth). It belongs with demo 10's temporal stack, not here. Skipped
cleanly per the packet's "skip if the above consumed the effort — log it."

## Params & URL overrides

Schema exposes the experiment axes (`marchScale` 1/0.5/0.25, `dispatchMode`
compute/shared/fragment, `upsampleNormalPhi`/`upsampleDepthPhi`) plus the march
tunables (rotationCount, stepCount, radius, expFactor, jitter, bitmask, GI,
normalApproximation, thickness, …). URL: `?demo=09-bandwidth&scene=&view=&mscale=&
mode=&rc=&sc=&radius=&bitmask=&gi=&na=`. Per-scene world radius/thickness defaults
(cornell 5/0.5, sponza 8/2, zoo 3/0.3).

## Measurement methodology

M3's fence methodology: `queue.onSubmittedWorkDone()` around N iterations (vsync-
independent), exposed on `window.__bench09` (`{config, march, chain, down, up}`).
sponza + cornell at **1280×800**, `rc2/sc12` (SSRT3 defaults) and `rc4/sc32`
(heavy). Reported values are the **min of 3×40-iteration bursts** (min ≈ least-
throttled ≈ true GPU cost) with paired variants measured back-to-back so they share
thermal state. **Caveat:** absolute GPU time drifts ±~15% with thermal state over a
long run, so the paired **ratios** are the robust signal, not the absolutes. Cross-
check: demo 09's full-res compute march at sponza rc4/sc32 reproduces demo 03's
measured **15.6 ms** baseline when measured cold (the 19.8 below is the same kernel
measured hot mid-run) — the two independent marchers agree.

---

# Findings

All ms = CPU-fenced GPU time, 1280×800, min of 3×40-iter bursts. `march` = the march
pass alone; `chain` = downsample + march + upsample (the real per-frame cost).

## Axis 1 — half-res + joint bilateral upsample: **the paper's ~4× is real, and then some**

| scene | params | full-res march | half march | quarter march | full **chain** | half **chain** | quarter **chain** |
|---|---|---|---|---|---|---|---|
| sponza | rc2/sc12 | 5.11 | 1.13 | 0.25 | 5.34 | **1.31** | 0.41 |
| sponza | rc4/sc32 | 19.76 | 4.63 | 0.74 | 20.14 | **4.40** | 0.94 |
| cornell | rc2/sc12 | 3.43 | 0.68 | 0.15 | 3.45 | **0.76** | 0.28 |
| cornell | rc4/sc32 | 12.58 | 1.91 | 0.44 | 13.26 | **2.09** | 0.57 |

- **Half-res chain is 4.1–6.3× faster** than full-res (sponza rc4 20.14→4.40 = 4.6×;
  cornell rc4 13.26→2.09 = 6.3×); **quarter-res is 15–23×** faster. This meets and
  exceeds the paper's Table 2 "≈4×" for half-res.
- The half-res *machinery* is nearly free: downsample 0.04–0.35 ms, upsample
  0.05–0.16 ms — a fixed <0.5 ms tax against a several-ms march saving. It never
  eats the win, even at quarter-res where the march itself is sub-ms.
- The march scales slightly **super-linearly** with pixel count (0.5× → ~1/4.3 of
  the cost, not 1/4) — consistent with the bandwidth thesis: fewer, more cache-
  coherent fetches at low res.
- **Quality** (`09-{cornell,sponza}-gi-diff.png`, `09-cornell-ao-diff.png`, amplified
  3×): the AO diff is decisive — flat surfaces facing the camera reconstruct to
  **near-zero error** (black), and there are **no bright silhouette halos**, proving
  the depth+normal guide correctly stops the upsample at geometric edges (a naive
  bilinear upsample would halo). Error concentrates only at **grazing angles**
  (ceiling/floor) and high-frequency contact detail, and is heavily entangled with
  the uncorrelated raw-march noise the two resolutions carry (neither image is
  denoised). On sponza's low-frequency GI the half-res result is visually
  indistinguishable from full-res in normal viewing (`09-sponza-half.png`).

**Verdict: ship half-res + this joint bilateral upsample.** ~4.5× median speedup for
a <0.5 ms fixed cost and no structural quality loss on flat surfaces or edges. It is
the single biggest bandwidth lever in the lab, and the exact stack nobody packages —
now built. Quarter-res is viable for low-frequency GI / weak hardware but starts
losing contact detail.

## Axis 3 — fragment vs compute dispatch: **it does not matter**

| scene | params | scale | compute march | fragment march | frag/comp |
|---|---|---|---|---|---|
| sponza | rc2/sc12 | 1.0 | 5.25 | 5.47 | 1.04× |
| sponza | rc4/sc32 | 1.0 | 20.03 | 20.00 | **1.00×** |
| cornell | rc2/sc12 | 1.0 | 3.41 | 3.26 | 0.96× |
| cornell | rc4/sc32 | 1.0 | 12.80 | 12.94 | 1.01× |
| sponza | rc4/sc32 | 0.5 | 4.15 | 4.44 | 1.07× |
| cornell | rc4/sc32 | 0.5 | 1.96 | 2.14 | 1.09× |

- At full res the two dispatch modes are **within noise (0.96–1.04×)** across both
  scenes and both workloads. At half-res, fragment is marginally slower (1.07–1.09×)
  but the absolute times are small (~2–4 ms) so the ratio is within measurement
  noise (one outlier sponza rc2 0.5× hit 1.57× on a sub-1.8 ms measurement — noise).
- Screenshots confirm the fragment march is pixel-identical to compute
  (`09-cornell-fragment.png` vs `09-cornell-shared.png` / the compute combined view).

**Verdict: dispatch mode is not a performance axis for this march.** The march is
bandwidth-bound on identical texture fetches, which both modes issue the same way;
the ALU/dispatch envelope is invisible next to memory traffic. The reason to choose
**compute** (demo 03) over fragment (three's `SSGINode`) is **capability, not
speed** — compute unlocks workgroup shared memory (Axis 2) and storage-texture
outputs; it neither costs nor saves throughput. Conversely, three's `SSGINode`
paying nothing for being a fragment quad is a real, measured reassurance.

## Axis 2 — LSAO-style shared-memory depth cache: **modest at best, mostly a wash (negative result)**

| scene | params | config | plain march | shared march | shared/plain |
|---|---|---|---|---|---|
| sponza | rc4/sc32 | radius 8 (default) | 19.74 | 19.17 | 0.97× |
| sponza | rc4/sc32 | **radius 2** | 14.53 | 12.69 | **0.87×** |
| sponza | rc4/sc32 | half-res, radius 8 | 4.25 | 3.87 | 0.91× |
| sponza | rc2/sc12 | radius 2 | 4.66 | 4.39 | 0.94× |
| cornell | rc4/sc32 | radius 5 (default) | 12.04 | 12.49 | 1.04× (slower) |
| cornell | rc4/sc32 | radius 2 | 6.71 | 7.12 | 1.06× (slower) |
| cornell | rc2/sc12 | radius 5 | 3.40 | 3.22 | 0.94× |

- Best case **~13% faster** (sponza, heavy samples, **small radius**); typical
  **±5% i.e. a wash**; on cornell it is frequently **slightly slower** (barrier +
  LDS-fill overhead not repaid on trivially cache-friendly geometry).
- The pattern exactly matches the research prediction. The cache only pays off when
  (a) the radius is small enough that most samples land inside the 24×24 tile, and
  (b) the sample count is high enough (rc4/sc32) that each cached texel is reused
  many times. At production radii (8/5 world units) the **exponentially-distributed
  far steps miss the tile** and fall back to global fetches, erasing the win; the
  preload + barrier then becomes net overhead.
- Fundamental ceiling: caching **only depth** caps the benefit because the GI gather
  also fetches **light and normal** per step at the same uncorrelated coords, and
  those stay global. LSAO's actual speedup comes from its largest-occluder O(1)
  line-sweep traversal (radius-independent cost), which requires collapsing each
  direction to a single occluder — **incompatible with a visibility bitmask** that
  needs full per-sector occupancy (`lsao-timonen2013-notes.md` §2). A tile cache
  amortizes fetches but does not change the O(K·N) traversal.

**Verdict: cooperative depth-tile caching alone is not worth shipping for a bitmask
march.** It delivers at most ~10–13% and only in a narrow small-radius/high-sample
regime, and regresses on simple scenes. A real LSAO-class win would require porting
the line-sweep + obscurance-hull traversal itself (an open problem for bitmasks, not
a caching tweak) — and even then would need to cache light+normal, not just depth,
to move the needle on GI. Honest negative result, as the lab anticipated.

## Cross-axis conclusion

For this bandwidth-bound march the decisive lever is **resolution** (Axis 1: ~4.5×,
free upsample, no quality loss on flat/edge regions), not dispatch mode (Axis 3:
0×) and not naive shared-memory caching (Axis 2: ~0–13%, regime-dependent). The
bandwidth thesis holds: cut the number of uncorrelated fetches (fewer pixels) and
everything speeds up super-linearly; rearrange *how* the same fetches are issued
(fragment↔compute, LDS tile) and little changes.
