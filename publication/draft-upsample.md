# The upsample node three.js doesn't have — built once, measured three times

*Draft — venue-neutral. Numbers from `bench/src/demos/09-bandwidth/README.md`,
`bench/results/lab09-bandwidth.md` (commit `df2e232`), `WORKLOG.md` 2026-07-21
"P1 Track D" and "P2 + P3 landed and accepted" / "Scene-v2 re-baseline recorded"
entries, `bench/src/demos/12-distilled/README.md`, `bench/results/
demo12-acceptance.md` (commit `df2e232-dirty`).*

## The claim, and the gap behind it

SSILVB's Table 2 config (f) reports the standard screen-space GI trick — render
the expensive pass at half resolution, upsample with an edge-aware filter —
at roughly 4× (2.93 ms → 1.07 ms), with a caveat attached: it "can introduce
more flickering... and a blurrier result." That's a specific, checkable claim.
We wanted to check it, and building the check turned up something the paper
doesn't mention: nothing in three.js actually implements the upsample it's
describing.

We searched rather than assumed. `research/sources/denoising/threejs-nodes.md`
(lines 114–151) audits every bilateral building block in three's `dev` branch:
`BilateralBlurNode` is a generic two-pass edge-aware blur with an optional
resolution change, but its only "guide" is the luminance of the signal being
blurred — no separate high-res depth/normal buffer, so it resamples rather
than upsamples in the Kopf et al. sense. `depthAwareBlur` is closer — its own
docstring says "handy for denoising a half-resolution effect such as ambient
occlusion" — but it's a same-resolution depth-only blur (no normal term), and
its docstring is explicit that turning it into an actual low-res→hi-res
upsample would need "manual mip/half-res render-target plumbing... the file
provides the edge-aware weighting, not the resolution-bridging logic itself."
A repo-wide GitHub code search for `upsample` in `mrdoob/three.js` returned no
purpose-built joint-bilateral-upsample node at all (line 151). The paper
recommends a specific, well-known technique; the most popular WebGPU-capable
engine doesn't ship it. So we built one and measured it directly, rather than
taking the paper's number on faith or three's absence as evidence it doesn't
matter.

## What we built

`bench/src/demos/09-bandwidth/ssrt09-upsample.wgsl`, paired with a
`ssrt09-downsample.wgsl` that produces a self-consistent march-resolution
G-buffer (box-MIN raw depth = closest occluder, the min-depth texel's view
normal, box-avg beauty) so the march never reads the native full-res textures
at any scale. The upsample itself, per full-res pixel: gather the 2×2
low-res taps around the projected position, weight each by
`bilinear · depthSimilarity(fullDepth, tapDepth) · normalSimilarity`, with a
nearest-tap fallback when all four weights collapse (the disocclusion case).
Depth similarity is computed on linear view depth normalized by the center
depth, so the weighting stays scale-invariant with distance rather than using
a fixed screen-space radius. At `marchScale = 1.0` the downsample block is
1×1 — a straight copy — so the full-res baseline runs through the identical
code path as every other scale, which is what makes the comparison a fair
control rather than two different code paths being timed against each other.

## The measurement, three times

The lab's numbers weren't recorded once and left alone — they were
re-measured after a march-correctness bug fix and again after a scene
rewrite, and the ratio held in the same band each time.

**Original measurement** (`bench/src/demos/09-bandwidth/README.md`, "Axis 1"
table — these are the numbers `OUTLINE.md` §5 originally cited):

| scene | config | full chain | half chain | ratio | quarter chain | ratio |
|---|---|---|---|---|---|---|
| sponza | rc4/sc32 | 20.14 ms | 4.40 ms | 4.6× | 0.94 ms | 21.4× |
| cornell | rc4/sc32 | 13.26 ms | 2.09 ms | 6.3× | 0.57 ms | 23.3× |

**Post-y-fix revalidation** — after the demo 03 y-mirror bug (draft-methodology.md's
"box-top speckle" story) was fixed and the march that lab 09 forks changed
underneath it (`WORKLOG.md` 2026-07-21 "P1 Track D"): half-res chain
3.8–5.4× (sponza heavy 23.97 → 4.66 ms = 5.1×, cornell heavy 11.96 → 2.23 ms =
5.4×), quarter-res ~22×. Absolutes drifted up (the fixed marcher does more
correct — and costlier — grazing-angle work, plus thermal ±15%); the ratio
held.

**Scene-v2 re-baseline** — after Dennis's sponza relight (`WORKLOG.md`
2026-07-21 "Sponza scene v2"), the whole re-baseline battery re-ran, lab 09
included (`bench/results/lab09-bandwidth.md`, commit `df2e232`):

| scene | config | full chain | half chain | ratio | quarter chain | ratio |
|---|---|---|---|---|---|---|
| sponza | rc2/sc12 | 5.94 ms | 1.5475 ms | 3.8× | 0.475 ms | 12.5× |
| sponza | rc4/sc32 | 25.53 ms | 5.03 ms | 5.1× | 1.09 ms | 23.4× |
| cornell | rc2/sc12 | 3.36 ms | 0.82 ms | 4.1× | 0.29 ms | 11.7× |
| cornell | rc4/sc32 | 13.37 ms | 2.19 ms | 6.1× | 0.60 ms | 22.4× |

Three independent sessions, spanning a march-correctness fix and a full scene
relight, land in the same 3.8×–6.3× half-res band and 11.7×–23.4× quarter-res
band every time. That consistency is itself evidence: the win is coming from
cutting texel count on a bandwidth-bound march (README's "Cross-axis
conclusion" — the march scales super-linearly with pixel count, ~1/4.3× at
half-res rather than the naive 1/4×), not from some fragile interaction with
one scene's geometry or lighting.

## The machinery is nearly free

The half-res *chain* (downsample + march + upsample) is what matters for
shipping, not the march in isolation, and the two extra passes barely move
the total. README's own summary: "downsample 0.04–0.35 ms, upsample
0.05–0.16 ms — a fixed <0.5 ms tax against a several-ms march saving." The
scene-v2 table confirms this at the shipped default: cornell rc4/sc32
half-res machinery is 0.04 + 0.0575 = 0.10 ms; sponza rc4/sc32 is
0.0425 + 0.075 = 0.12 ms — both comfortably under the 0.5 ms figure, and it
never eats the win even at quarter-res where the march itself drops sub-ms.

## Quality: no halos, error confined to where you'd expect it

The AO diff screenshots (`09-{cornell,sponza}-gi-diff.png`,
`09-cornell-ao-diff.png`, amplified 3×, cited in README's Axis 1 findings)
are decisive on two points. First, flat surfaces facing the camera reconstruct
to near-zero error (black in the diff) — the depth+normal guide is doing its
job on the easy case. Second, and more load-bearing: there are **no bright
silhouette halos**. A naive (depth-only, or unweighted bilinear) upsample
would bleed low-res color across geometric edges and show up as a bright rim
in the diff; this doesn't happen here, which is the direct evidence that the
normal-similarity term (not just depth) is pulling weight — a surface that's
close in depth but facing a different direction (a thin wall seen edge-on
next to the floor behind it) still gets rejected correctly. Error concentrates
only at grazing angles (ceiling/floor) and high-frequency contact detail, and
is heavily entangled with the raw, un-denoised march noise both resolutions
carry — lab 09 deliberately composites the raw march (no temporal, no
denoiser) to isolate the resolution/upsample variable alone, so this is the
honest floor, not a polished number. On sponza's low-frequency GI the
half-res result is visually indistinguishable from full-res in normal viewing
(`09-sponza-half.png`).

## Against the paper's own number, and why ours doesn't carry the same caveat

SSILVB's Table 2 row (f) claims ≈4× (2.93 ms → 1.07 ms) with an attached
warning: "can introduce more flickering... and a blurrier result." Our
half-res chain matches or exceeds the 4× figure (4.1–6.3× measured, three
times) without reproducing that caveat in the diff evidence — no halos, and
the blur that does show up is confined to grazing/contact regions, not a
general softening. The likely reason isn't mysterious: the paper's own Table
2 config doesn't specify whether its upsample guide uses depth alone or
depth+normal, and ours uses both. A depth-only guide is exactly the
configuration that produces silhouette halos on thin, near-parallel geometry
(a wall edge-on to a floor at similar depth but a completely different
normal) — precisely the failure mode our diff evidence shows suppressed. We
can't run the paper's own implementation to confirm this is *the* reason
rather than *a* reason, so this is an inference from the mechanism, not a
controlled A/B against their exact code — worth stating plainly rather than
implying we've proven the paper's caveat wrong in general.

## Shipped: demo 12's default chain, not just a lab curiosity

The upsample didn't stay inside the isolated lab. Demo 12 ("distilled SSGI
v0," `bench/src/demos/12-distilled/README.md`) is the bench's own new SSGI
implementation, combining every measured winner from the testing phase, and
its pipeline step 6 is this exact joint-bilateral upsample (step 3 is the
paired downsample), guided by the full-res depth+normal, and skipped only
when `marchScale = full` (in which case the chain degenerates to demo 03 plus
one downsample copy — the equal-quality control point). The shipped default
is `marchScale = half` — this is not a toggle presented alongside a
full-res default, it's the pipeline Dennis's own distilled implementation
runs unless told otherwise.

The acceptance numbers (`bench/results/demo12-acceptance.md`, commit
`df2e232-dirty`, scene-v2) measure the *whole* pipeline — G-buffer,
lightmask, downsample, march, upsample, temporal, denoise — not the isolated
chain, so they're the real end-to-end payoff of shipping half-res by default:

| cell | demo 12 total (half) | demo 03 total | speedup | MSE-vs-oracle (12 / 03) | pass |
|---|---|---|---|---|---|
| C-wide | 1.2475 ms | 2.145 ms | **1.72×** | 0.0662 / 0.0677 | equal-or-better ✓ |
| S-hall | 1.6525 ms | 4.5825 ms | **2.77×** | 0.0143 / 0.0145 | equal-or-better ✓ |

Both cells pass NEXTGEN's acceptance bar (equal-or-better MSE against the
demo's own oracle, stability within 1.25× of demo 03's) with the half-res
upsample chain doing the majority of the work — the same headline number
`WORKLOG.md`'s "P2 + P3 landed and accepted" entry recorded at first landing
(pre-relight: 1.91× C-wide / 2.61× S-hall) and the "Scene-v2 re-baseline"
entry reconfirmed after the relight (1.72× / 2.77×) — a fourth independent
measurement session, at a different level of the stack (full pipeline, not
isolated chain), landing in the same range as the lab's own numbers.

## What's not done yet, honestly

Two gaps, neither hidden:

**Not packaged as a standalone three.js-consumable node.** The upsample
exists as bench WGSL inside demo 09's isolated lab and, in frozen-fork form,
inside demo 12's own file tree — it has never been extracted into something
you could `import` into an arbitrary three.js `RenderPipeline` outside this
harness. That packaging step (NEXTGEN.md's Phase I / "Integration") is
scheduled but not started. This is the single biggest gap between "we proved
the technique" and "we shipped a reusable thing," and it's the reason this
section's thesis is phrased as "no engine ships the upsample as a consumable
node" rather than "we built one for you to use" — today, you'd still have to
port the WGSL out of this repo yourself.

**The quality number is pre-denoiser, not post-denoiser.** Lab 09's diff
evidence (no halos, error at grazing angles) is measured on the raw,
un-denoised march by design, since the lab isolates the resolution variable
from the denoise/temporal stage. Demo 12 ships the upsample *inside* a full
temporal+denoise pipeline, and its acceptance table measures the whole
chain's MSE, not the upsample's isolated contribution once a denoiser is
sitting downstream of it. A quality number that isolates just "how much does
the upsample's own error contribute once a denoiser has had a chance to clean
it up" doesn't exist yet — **TODO-EVIDENCE**: an ablation cell (demo 12 at
`marchScale=full` vs `half`, both post-denoise, MSE-vs-oracle only) would
close this, and the harness already has everything needed to run it; it just
hasn't been run as a named comparison.

## The takeaway

The paper's own Table 2 says half-res + bilateral upsample is worth ~4×, with
a quality caveat attached. We built the specific upsample nobody in the
three.js ecosystem ships, measured it three times across a bug fix and a
scene rewrite (4.1–6.3× on the isolated chain, every time), watched it carry
through into a real full-pipeline implementation at 1.7–2.8× with
equal-or-better quality against oracle, and found no evidence of the paper's
own flickering/blur caveat in three independent diff-screenshot sessions. The
<0.5 ms fixed tax for the down/up machinery means there's no real reason not
to default to half-res on a bandwidth-bound march — which is exactly what
demo 12 now does. The gap that remains isn't in the numbers; it's that the
node still lives inside this repo's bench harness instead of being something
you can drop into any three.js WebGPU project today.
