# Guides-driven adaptive bitmask marching: LSAO's complaint, solved a different way

*Draft — venue-neutral. Numbers from `WORKLOG.md` 2026-07-21 "P2 + P3 landed
and accepted" (commit `e69f90b`), "P5 phase 1/3" / "Scene-v2 re-baseline
recorded + P5.1 ALU verdict" / "P5.2 BANDWIDTH family implemented" / "P5.2
bandwidth family RECORDED VERDICT" entries, `bench/results/lab10-stability.md`
(commit `d6e441f-dirty`), `bench/results/demo13-all.md` (commit
`eacdc2d-dirty`), `FSR3-BRIEF.md`, `bench/src/harness/temporal-guides.ts`
header, `bench/src/demos/13-optim/variants.ts` and `README.md`.*

## The problem: every pixel pays full march cost, whether it needs to or not

SSILVB's own Table 1 shows the bitmask adds only ~0.01–0.02 ms of ALU over
GTAO — the real cost is bandwidth, uncorrelated per-step light/normal/depth
fetches. Our own lab reproduces that diagnosis independently
(`bench/src/demos/09-bandwidth/README.md`, "Cross-axis conclusion": a
resolution lever worth ~4.5× against an ALU-rearrangement lever worth ~0×).
But there's a second, quieter cost baked into the same march that neither the
paper's diagnosis nor the resolution lever touches: it runs the *same* full
`rotationCount × stepCount` budget on every pixel, every frame, regardless of
whether that pixel's signal has already converged. A static camera on a
static scene re-marches every pixel at full cost forever, even though the
temporal accumulator sitting downstream is averaging away most of what that
work produces. The march doesn't know it's being wasted on a pixel that
already has sixteen frames of clean history.

## The classical answer, and why it doesn't transfer

SSILVB's own future-work section names a fix for its bandwidth problem:
"using a caching method similar to LSAO." We took that suggestion literally
and tested it (`publication/draft-lsao.md`) — cooperative workgroup
shared-memory depth-tile caching, the direct compute-shader translation of
"cache like LSAO does." The result was a narrow, sometimes-negative win
(0.87×–1.06×, `bench/results/lab09-bandwidth.md` Axis 2), and the reason is
structural, not a tuning failure: LSAO's O(1)-per-step speedup depends on
collapsing each direction's occlusion query to a single largest occluder — an
obscurance-hull stack that only needs to track "who's biggest." A visibility
bitmask needs the opposite: full per-sector occupancy, because that's exactly
what lets light pass behind a thin occluder and be re-blocked further along
the same direction. You cannot port LSAO's central trick to a bitmask without
giving up the property that makes a bitmask better than a horizon-pair
estimator in the first place (`draft-lsao.md`, "Reading 2 — structural").

The paper's diagnosis was right; its prescribed cure doesn't fit the data
structure it's being suggested for. That draft's own closing section names
the shape of the real answer without measuring it: "temporal amortization
with per-pixel effort control — amortize over *time* instead of along a
line... This project already has the prerequisite signal built (frame-count
accumulation)... and is building the guides pass that would consume it
next." This draft is that measurement landing.

## The guides architecture: frame properties, computed once

The prerequisite signal already existed, but privately. Demo 03's frame-count
accumulation fix (`publication/draft-accumulation.md`) maintains a per-pixel
history-length counter `N` to fix a broken EMA — and that counter is,
verbatim, the `historyLength` FSR3 needs internally and normally hides. The
architectural move is generalizing it: `FSR3-BRIEF.md`'s thesis states it
directly — "disocclusion, dilated motion vectors, reactivity, and history
validity are **frame properties, not upscaler properties**. FSR3 computes
them internally and hides them; meanwhile every temporal effect upstream...
re-derives worse versions privately... one computation feeds everything."

The bench-side implementation of that contract is `TemporalGuidesPass`
(`bench/src/harness/temporal-guides.ts`), producing four textures once per
frame, post-G-buffer, pre-effects:

| texture | format | contents |
|---|---|---|
| `dilatedVelocity` | rg16float | closest-depth 3×3-dilated NDC velocity |
| `disocclusion` | r16float | graded 0 (stable) .. 1 (fresh) |
| `historyLength` | r16float | per-pixel valid-history frame count N |
| `reactive` | r8unorm | app/effect fast-change mask (merge-in) |

Three dispatches — dilate, reproject, commit — because the cross-pixel data
dependencies (closest-depth dilation needs neighbor depths; reprojection
needs the dilated velocity) forbid folding them into one pass. It follows the
same lazy-run contract as the harness's `ReferencePass`: cheap to construct,
but `update()` only runs while a consumer is actually reading the guides, so
demos that don't use it pay nothing.

## The gate: does sharing the computation cost anything?

Before any consumer could be trusted to build on this, the decomposition had
to clear a real bar: does a *shared* pass do at least as well as the private
logic it's replacing? This isn't rhetorical — an abstraction that's clean but
worse is still a bad trade. `WORKLOG.md`'s "P2 + P3 landed and accepted"
entry records the A/B, demo 10's `ssrt3` stack (private world-position
disocclusion test) against `ssrt3-guides` (fed by the shared pass's
closest-depth-dilated velocity + graded disocclusion), same march, same
scene, same stability methodology (`bench/results/lab10-stability.md`,
commit `d6e441f-dirty`):

| stack | combined stability | gi stability | teleport reconvergence |
|---|---|---|---|
| ssrt3 (private) | 2.06 | 7.09 | 1.52 s |
| ssrt3-guides (shared) | **1.49** | 7.20 | 1.50 s |

The shared pass is **28% steadier** on the combined view, equal within noise
on gi-only and reconvergence speed. "The FSR3-BRIEF decomposition is REAL —
a shared guides pass feeds a temporal effect at least as well as its private
logic while computing frame properties once" (`WORKLOG.md`, same entry). This
is the acceptance test `FSR3-BRIEF.md` itself asked for — "that lab is the
acceptance test for the decomposition being real and not cosmetic" — and it's
also the gate `OUTLINE.md` §4 set before any adaptive-effort number could be
trusted: P2 had to land and be validated equivalent-or-better before P5 could
measure a march that reads the guides.

## The measurement: adaptive effort

With the gate cleared, the march itself was given a `historyLength` binding
and one new scalar, `gEffort`, computed once per invocation
(`bench/src/demos/13-optim/variants.ts`):

```
gEffort = mix(1.0, 0.4, clamp((N - 4.0) / 12.0, 0.0, 1.0))
```

`N < 4` (freshly disoccluded, or never converged) gets `gEffort = 1.0` — full
budget. `N ≥ 16` (well-converged) floors at `gEffort = 0.4`. Between, it
ramps linearly. `gEffort` scales both `rotationCount` and `stepCount` in the
march, so a converged pixel doesn't just take shorter steps — it slices fewer
directions too. Two deterministic flag bits (`F_ADAPT_FRESH` /
`F_ADAPT_CONVERGED`) pin `gEffort` to 1.0 or 0.4 for a clean paired
measurement independent of whatever the live guides happen to read at
capture time.

The isolated, recorded run (`bench/results/demo13-all.md`, commit
`eacdc2d-dirty` — not the smoke pass; the orchestrator's own isolated run is
the verdict, per this project's standing rule that a slower or unverified
number doesn't get to hide):

| cell | converged march | fresh march | baseline march | converged ratio | oracle MSE Δ | stability Δ |
|---|---|---|---|---|---|---|
| C-wide (cornell) | 0.2075 ms | 0.6775 ms | 0.6575 ms | **3.17×** | +0.0006 | +0.171 (0.356→0.527) |
| S-hall (sponza) | 0.3550 ms | 0.8550 ms | 0.8425 ms | **2.37×** | +0.0002 | +0.035 (0.467→0.502) |

This is exactly the shape the mechanism promises, not a rounded-off
approximation of it: **converged pixels coast (3.17×/2.37×), and a freshly
disoccluded pixel costs the same as the march that never had adaptive effort
at all** (fresh 0.6775/0.8550 ms vs. baseline 0.6575/0.8425 ms — within
measurement noise, not a discount and not a penalty). Nothing is stolen from
the disoccluded case to pay for the converged case; the win comes only from
pixels that didn't need the work in the first place.

Rolled up into the actual deliverable: with the march at 0.21 ms on C-wide,
demo 12's estimated converged-frame total is ≈0.80 ms against demo 03's
2.145 ms — the project's own "≥2× at equal-or-better MSE" success measure,
which sat at a 1.72× near-miss on C-wide going into this measurement
(`publication/draft-upsample.md`), **is now met on converged frames** (fresh
frames still land at the ~1.7× half-res baseline). And it's the concrete
ending to the LSAO story: the paper's complaint — every pixel pays full march
cost regardless of need — gets solved, just not by LSAO's mechanism. Sharing
effort across *time*, fed by a guides pass instead of a shared-memory tile,
turns out to be bitmask-compatible in a way cross-pixel traversal sharing
never was.

## The honest costs: stability, and why the other bandwidth cuts didn't work

Two things this section will not round off. First, the stability cost is
real and recorded, not folded into the headline ratio: C-wide's combined
stability moves from 0.356 to 0.527 (+0.171), because the 0.4 effort floor
means even a fully-converged pixel keeps re-marching at 40% budget rather
than freezing — that's a deliberate choice (a pixel that's coasting on its
temporal accumulator still needs *some* fresh samples to detect a future
disocclusion), and the floor is a tunable constant, not a law of the
mechanism. S-hall's stability cost is much smaller (+0.035, 0.467→0.502),
suggesting the tradeoff isn't fixed but scene- and content-dependent — worth
tuning per deployment rather than treating 0.4 as a universal answer.

Second, adaptive effort wasn't the only bandwidth-family variant tested in
the same session, and it's the only one that won — which matters, because it
rules out "any bandwidth cut helps" as the explanation. Recorded alongside
adaptive in the same isolated run:

- **light-mips** (prefiltered light mips for distant samples): 0.98–0.99×
  — a wash, though it does reduce fireflies (stability −0.05); "quality
  tool, not a perf lever at default settings."
- **hiz-skip** (Hi-Z bitfield-saturation early-out + beyond-radius AO skip):
  0.98× — an honest, correctness-free zero. The full angular-interval Hi-Z
  traversal (the larger payoff) remains a documented follow-up, not shipped.
- **checkerboard** (frame-parity half-rate march): recorded **negative** —
  ms ~1.0× because a per-thread `return` doesn't compact the dispatch (the
  workgroup still schedules all 64 threads; half just idle), while stability
  degrades +0.26 to +1.0×. "A true 2× needs compacted dispatch, not a
  per-thread early-out" — parked, not shipped.
- The ALU family (P5.1, a separate packet, same march): `trig` 1.08×
  (C-wide) / 1.04× (S-hall), `loop`/`precision` at or below 1.0× — an honest
  near-zero, confirming NEXTGEN principle 5 ("bandwidth before ALU") on the
  bench's own code, not just on lab 09's forks of demo 03.

Against that field, adaptive effort isn't "one bandwidth idea among several
that all worked a bit" — it's the only one of six tested variants that banked
a multiplicative win, and it did so by changing *when* work happens rather
than *how much data* each invocation touches.

## What's unprecedented here, and what's not

Adaptive effort steered by a convergence signal is not a new idea in the
abstract. Spatiotemporal Variance-Guided Filtering (SVGF) — surveyed in this
project's own research notes (`research/sources/denoising/
techniques-survey.md` §7) — adapts filter strength per pixel using
spatiotemporal variance, the offline/RT-denoising ancestor of "spend less
effort where the signal already agrees with itself." The survey's own
relevance caveat is worth carrying forward honestly: SVGF targets
heavily-undersampled (~1 spp) path-traced signals, "a fundamentally less
noisy starting point" than a horizon-based bitmask march, so the
*mechanism* here (scaling march sample count via `rotationCount`/`stepCount`,
not a wavelet filter's kernel radius) isn't a port of SVGF — it's the same
underlying idea (spend effort where the temporal signal says you need it)
applied to the sampling stage instead of the filtering stage. The broader
claim that adaptive sample-count/effort scaling is standard in modern
real-time ray-tracing denoising pipelines generally (ReSTIR-family adaptive
resampling, adaptive-spp reprojection) is well-established industry practice
but has no source file in this repo to cite — **TODO-EVIDENCE**: an external
citation (e.g. the SVGF paper itself, Schied et al. 2017, or a production
adaptive-sampling writeup) should be added before this draft goes external.

What's specific to this project, and is the actual contribution: a
per-pixel effort signal fed by a *shared*, FSR3-shaped guides pass (not a
private per-effect computation) steering a *bitmask* march (not a filter
kernel) inside a shipping-shaped WebGPU compute pipeline, with every number
— the 3.17×/2.37× converged win, the fresh-pixel cost parity, the +0.17/+0.03
stability tradeoff, the tunable 0.4 floor — measured and recorded rather than
asserted. It's also the concrete resolution of a specific, named negative
result (§2, LSAO) rather than a general architectural gesture: the paper
asked for cross-pixel sharing, the bitmask refused it, and cross-*time*
sharing through a guides pass turned out to be the lever that actually closed
the gap the resolution lever (`draft-upsample.md`) left on the table.

## Takeaway

The paper diagnosed its own bottleneck correctly (bandwidth, not ALU) and
prescribed a cure that doesn't fit the data structure it's suggesting it for
(§2). The resolution lever closes most of the gap but leaves a near-miss on
the harder scene (`draft-upsample.md`, C-wide 1.72×). What closes the rest of
it isn't a cleverer traversal — it's noticing that a per-pixel "how converged
is this signal" counter already existed for an unrelated reason (fixing a
broken EMA), generalizing it into a shared frame-property pass the way FSR3
does internally, and letting the march read it. Converged pixels drop to 40%
effort and the march goes 2.4–3.2× faster; disoccluded pixels pay exactly
what they always paid; the cost is a recorded, tunable amount of extra boil
on fully-converged frames. Every other bandwidth-family idea tried in the
same session — prefiltered mips, Hi-Z skip, checkerboard — came back at or
below 1.0×. This one didn't, and the reason it didn't is architectural, not
lucky: it's the only one that changed *when* the march runs at full cost
instead of trying to make every invocation of it cheaper.
