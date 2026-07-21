# We tested the paper's own bandwidth fix, so you don't have to

*Draft — venue-neutral. Numbers from `bench/results/lab09-bandwidth.md` and
`bench/src/demos/09-bandwidth/README.md`, commit `6f5b91e-dirty`.*

## The suggestion, quoted

Therrien, Levesque, and Gilet's "Screen Space Indirect Lighting with
Visibility Bitmask" (arXiv:2301.11376) ends §5 with three future-work items.
The second one names its own fix for the paper's biggest cost problem,
verbatim:

> "SSGI can be an expensive algorithm because it is very demanding on GPU
> bandwidth and utilizes the cache poorly. Using a caching method similar to
> LSAO could potentially improve this."

LSAO is Timonen's 2013 Line-Sweep Ambient Obscurance (Eurographics Symposium
on Rendering, CGF Vol 32 No 4), cited in the paper as [Tim13]. It's a
specific, well-known, well-cited technique — not a vague gesture at
"caching" — so the claim is testable. We tested it: literally, and then
structurally once the literal test explained why it wasn't working. Both
readings are negative, and the negative result is more interesting than a
positive one would have been, because it tells you exactly where the real
2026 answer lives instead.

## What LSAO actually does, and why it's fast

Every prior SSAO/HBAO evaluates each receiver pixel independently: K
azimuthal directions × N march steps = O(KN) per pixel, and the effect
radius directly drives cost. LSAO's contribution was reducing this to O(K)
per pixel with **radius having zero impact on execution time** — the first
attempt to cut SSAO's underlying complexity class since 2007.

The mechanism: for each of K globally-fixed directions, sweep parallel lines
across the whole depth buffer (one thread per line, not per pixel). Each
visited point is deprojected and pushed onto a stack that maintains an
"obscurance hull" — an incremental structure where, before pushing a new
point, earlier points are popped if the new point casts more falloff-
weighted obscurance than they do. The **largest occluder is always on top of
the stack**, and maintaining that property costs amortized O(1) per step
(each of M line steps performs exactly one push and at most one net pop). The
catch, and it's explicit in the paper: only the single largest occluder per
direction is used. Smaller occluders below or above it are simply ignored.
That's the entire trick — collapse the direction's occlusion query to "who's
biggest," and querying "who's biggest" is O(1) to maintain incrementally.
LSAO's own numbers back this up hard: at 1920×1080, K=16, unbounded radius,
LSAO measured 5.24 ms against HBAO's 92.5 ms on a GTX 480 — not a
marginal win.

## Two readings, tested

The paper's suggestion doesn't specify *what* to cache or *how* — "a caching
method similar to LSAO" is doing a lot of work in one sentence. We split it
into the two readings that sentence could plausibly mean and tested both
inside `bench/src/demos/09-bandwidth`, forked from demo 03's march so the
only variable is the bandwidth technique.

### Reading 1 — literal: cooperative shared-memory depth tiles

The most direct translation of "a caching method similar to LSAO" into
compute-shader vocabulary: preload a tile of depth values into workgroup
shared memory (LDS) once per workgroup, then serve nearby samples from that
tile instead of a global texture fetch. `ssrt09-march-shared` implements
this — a 24×24 tile (8×8 workgroup + 8-texel border, 2.3 KB LDS), depth
only (normal and light buffers stay global, since caching all three didn't
fit the "depth caching" scope this experiment isolates).

Result, across sponza and cornell, default and heavy configs, full- and
half-res, radius 2 through radius 8 (`bench/results/lab09-bandwidth.md`):

| best case | typical | worst case |
|---|---|---|
| ~0.87× (sponza, radius 2, heavy) | ~0.91–0.97× (a wash) | ~1.06× — slower (cornell, radius 2, heavy) |

Best case is roughly **13% faster**, and only in a narrow regime: small
radius, high sample count. At the demo's *default* radii (8 world units on
sponza, 5 on cornell) the win nearly vanishes (0.97×, 1.04×-slower) because
the march's exponentially-distributed far steps land outside the 24×24 tile
and fall back to a global fetch anyway — the cache stops paying for itself
exactly where production settings live. On cornell, the barrier-plus-preload
overhead isn't repaid by simple geometry at all; it's measurably slower.

There's also a hard structural ceiling independent of tuning: the GI gather
fetches light and normal per step at the same uncorrelated coordinates as
depth, and caching only depth (the tractable subset for a first pass) leaves
that traffic untouched.

### Reading 2 — structural: does the line-sweep itself port to a bitmask?

The literal reading's disappointing numbers point at a deeper question: is
"LSAO but for bitmasks" even the right shape of idea, independent of
implementation effort? No.

LSAO's entire speedup depends on collapsing each direction's occlusion query
to a single largest occluder — that's what makes the obscurance-hull stack
maintainable in O(1) per step. A visibility bitmask estimator needs
something structurally incompatible with that collapse: **full per-sector
occupancy**. The whole reason the bitmask beats a horizon-pair estimator
(GTAO) is that it can represent light passing *behind* a thin occluder and
being re-blocked by something further along the same direction — Algorithm
1's line `GI += COUNTBITS(b_j & ~b_i) / N_b * ...` explicitly counts only
*newly* covered sectors so a closer, smaller occluder still contributes.
Collapsing to "the single largest occluder" is exactly the information a
bitmask exists to keep. You cannot port LSAO's O(1) trick to a bitmask
without giving up the property that makes a bitmask better than GTAO in the
first place. A sweep formulation that maintained a *running sector mask* per
direction instead of a running max-horizon might exist in theory, but it is
unpublished in either direction (LSAO's line or SSILVB's bitmask) — an open
research problem, not a caching tweak you can bolt on in an afternoon.

## The honest numbers, side by side

Both readings tested in the same lab, same march, same session
(`bench/src/demos/09-bandwidth/README.md`, "Cross-axis conclusion"):

| lever | speedup | source |
|---|---|---|
| LSAO-style depth-tile caching (Reading 1) | **0.87×–1.06×** (0–13% narrow-regime win, sometimes a regression) | `lab09-bandwidth.md`, README Axis 2 |
| Half-res march + joint-bilateral upsample (a *different* bandwidth lever, same lab) | **4.1–6.3×** (up to 15–23× at quarter-res) | `lab09-bandwidth.md`, README Axis 1 |

The paper correctly diagnosed the disease. SSILVB's own Table 1 shows the
bitmask adds only ~0.01–0.02 ms of ALU over GTAO — the real cost is
bandwidth, uncorrelated per-step fetches of light, normal, and depth at
scattered screen locations, exactly as the paper states. Lab 09's broader
finding confirms this independently: the march is fetch-bound, with a
resolution lever worth ~4.5× against an ALU-rearrangement lever worth ~0×
(dispatch mode, compute vs. fragment, made no measurable difference either —
0.96–1.09× across every tested config). The diagnosis was right. The
prescribed cure — a 2013 technique whose speedup mechanism specifically
depends on discarding the information a bitmask exists to keep — predates
the treatments that actually shipped for this problem in the following
decade.

## Where the real win lives: modern heirs to the same diagnosis

The paper named LSAO because it was the best answer available for
bandwidth-bound screen-space AO in 2013 (published the same year, cited
directly). Its diagnosis — bandwidth-bound, cache-hostile, uncorrelated
per-pixel fetches — is exactly the disease the last decade of production
techniques also targeted, just with different, bitmask-compatible cures:

- **Deinterleaved rendering** (Intel ASSAO → AMD FidelityFX CACAO): partition
  pixels into phase buckets so each bucket's fetches are spatially coherent,
  process at reduced resolution per bucket, reassemble. This reorganizes
  *where* fetches happen rather than changing the estimator, so it's
  bitmask-compatible by construction — the closest true production heir to
  the paper's own suggestion, and scheduled as a must-do variant in this
  project's next phase.
- **Sparse evaluation + interpolated gather**, modernized into screen-space
  radiance caching (AMD GI-1.0 screen probes, Unreal Lumen's screen-probe
  gather): evaluate the expensive part at sparse anchors, interpolate
  edge-aware between them. This is LSAO's own §5 sparse mode, reborn with
  radiance instead of obscurance, and bitmask-compatible since you're
  interpolating irradiance, not masks.
- **ReSTIR-family spatiotemporal reservoir resampling**: share *samples*
  (with resampling weights) across pixels and frames instead of sharing
  traversal — the general modern replacement for LSAO's cross-pixel work
  sharing.
- **Temporal amortization with per-pixel effort control**: amortize over
  *time* instead of along a line — a per-pixel history-length signal lets
  converged pixels coast on their accumulator while disoccluded pixels get
  full march budget. This project already has the prerequisite signal built
  (frame-count accumulation — see the accumulation draft) and is building
  the guides pass that would consume it next.
- **Hierarchy** (Hi-Z min/max depth pyramids): step-skip through provably
  empty space, refine near hits — a different mechanism for the same "don't
  redo work you don't need" goal, and bitmask-compatible.
- **WebGPU subgroups**, shipping in browsers now: intra-wave sample sharing
  via subgroup broadcast/shuffle — a barrier-free micro-realization of
  cooperative fetching. Critically, the LDS experiment's overhead argument
  (barrier + preload cost not repaid) does not automatically transfer to a
  barrier-free mechanism, so this isn't foreclosed by Reading 1's negative
  result; it's a live probe confirmed available on the test adapter (Chrome
  149 / Apple metal-3) and scheduled for measurement.

## The takeaway

If you're reading a screen-space GI paper's future-work section as a to-do
list, check the date on the cited fix before you spend a sprint on it. LSAO
was the right answer to a bandwidth problem in 2013, for an estimator that
collapses to a single occluder per direction. A bitmask estimator's entire
value proposition is *not* collapsing to a single occluder. The paper's
diagnosis — bandwidth over ALU — is exactly right and reproduced
independently in our own measurements (4.5× resolution lever vs ~0× ALU
lever); its prescribed cure just doesn't fit the data structure it's being
applied to. The honest number is 0–13% from the paper's own suggestion,
against a 450% (4.5×) win sitting one axis over in the same lab, from a
lever (resolution + guided upsample) the paper also describes in its own
Table 2 but nobody had shipped as a reusable node before this project built
one.
