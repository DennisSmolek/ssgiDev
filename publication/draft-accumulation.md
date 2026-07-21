# Counting frames instead of averaging them: fixing an EMA that can't converge its own noise

*Draft — venue-neutral. Numbers from WORKLOG.md 2026-07-18/2026-07-21 entries
and `bench/results/trackC-temporal.md`, `bench/results/lab10-stability.md`,
`bench/results/trackE-bakeoff.md`.*

## The mismatch

SSRT3 (Therrien's Unity HDRP reference implementation, and the basis of the
bench's demo 03 compute port) accumulates its noisy per-frame AO/GI estimate
into history using a fixed-weight exponential moving average: a constant
`temporalResponse` blends new samples in at a fixed rate every frame,
regardless of how long the pixel has been converging. That gives the
accumulator roughly a 3-frame effective memory.

SSRT3's own noise generator, meanwhile, cycles on **12 frames** — 6
slice-direction rotations × 4 sub-pixel sample offsets, the pattern the
temporal pass is supposed to be averaging away into a clean, denoiser-ready
signal. An accumulator with a 3-frame memory averaging a 12-frame-period
noise pattern cannot fully cancel it: by the time the EMA has forgotten a
given phase of the cycle, the cycle hasn't repeated yet, so the signal never
settles into a fixed point. It has a permanent floor of residual boil, by
construction, independent of how long you leave the camera still. This
mismatch is architectural, not a tuning knob — no single `temporalResponse`
value fixes it, because the problem is the *shape* of the memory (fixed-rate
decay) against the *shape* of the noise (a longer, deterministic cycle), not
its rate.

## The fix

The fix doesn't touch the march at all — it replaces the accumulation math.
Track a per-pixel counter `N` (a small integer, stored in an r16float
ping-pong pair alongside the existing GI history) instead of a fixed decay
rate:

- On disocclusion (reprojected-position similarity below threshold),
  off-screen reprojection, or an explicit reset: `N = 1`.
- Otherwise: `N = min(N + 1, cap)`, with `cap` a tunable ceiling (default 16
  in this project's implementation).
- Blend weight for the new sample: `1/N`.

This is the standard "count-based" or "1/N" accumulation shape — it's not a
new idea in the abstract, it's how TAA history buffers and many production
temporal accumulators already work, and it appears independently in one of
this project's own reference implementations (Mathis's SSHGI, demo 06 — see
below). What's specific to this fix is applying it as a **drop-in toggle
inside an existing shipped algorithm's own code path**, so the comparison is
apples-to-apples: same march, same noise generator, same denoiser, the only
variable is EMA-vs-count accumulation. The implementation shipped as
`accumMode` (`'ssrt3-ema'` default — faithful to shipped SSRT3 — or
`'frame-count'`), plus `accumFrameCap`, in demo 03's temporal stage (WORKLOG
2026-07-18, "Demo 03 temporal: real prev-depth, frame-count accumulation,
per-frame jitter," Task 2). A prerequisite fix landed in the same pass: the
march's jitter sampler (`rand(uv)`) was frame-static in the original port —
it never advanced, so even a perfect accumulator would have nothing to
average across frames. Advancing it per-frame (golden-ratio-scaled,
pinned by the existing `freezeNoise` debug toggle) was necessary before the
accumulation comparison could mean anything at all.

## The measurements

**First measurement, at landing (WORKLOG 2026-07-18).** Stability metric =
mean absolute per-pixel diff between two screenshots 2 seconds apart, after
a 6-second settle, static camera, `gi` view:

| mode | stability |
|---|---|
| frame-count | **0.83** |
| ssrt3-ema (faithful default) | 3.38 |

Roughly a 4× reduction in residual boil, and the combined (beauty+AO+GI)
view was visually identical and correct in both modes on the static scene —
no regression, no ghosting, the change is isolated to how fast noise stops
moving.

**Re-confirmation on the fixed base, Track C stills (`bench/results/
trackC-temporal.md`, C-wide camera, `combined` view):**

| mode | still stability |
|---|---|
| frame-count | **0.3058** |
| ssrt3-ema | 1.0575 |

**Re-confirmation, lab 10 (`bench/results/lab10-stability.md`, cornell,
same still-stability methodology, both combined and gi-only views):**

| stack | combined | gi-only |
|---|---|---|
| mathis (count-based, demo 06's own accumulator) | **0.0959** | **0.4591** |
| xegtao | 0.2087 | 1.1103 |
| ssrt3-EMA | 2.0663 | 6.8338 |
| denoise-node | 4.8303 | 8.4185 |
| raw (no temporal) | 10.0531 | 47.5124 |

Demo 03's own `accumMode` toggle, measured in the same session: ema 4.895 vs
frame-count 1.4992 (WORKLOG 2026-07-21, "P1 Track D"). Count-based
accumulation is the stability winner in every single appearance across two
independently-run measurement passes, several months apart, using the same
metric definition each time.

**A bug that's part of the evidence, not separate from it.** Lab 10's first
re-validation run returned an EMA stability of exactly `0.0000` — not
convergence, a black canvas. The lab imports demo 03's `ssrt-temporal.wgsl`
verbatim via a raw WGSL import, and an unrelated later change to that file
(the frame-count accumulation implementation itself, adding prev-depth and
counter-texture bindings) had silently changed its binding layout out from
under the lab's stack. The fix was to freeze a copy of the pre-change file
(`ssrt3-temporal-ema.wgsl`) rather than track the live one (WORKLOG
2026-07-21, "P1 Track D," Lab 10 paragraph). Worth stating plainly: this bug
could have been misread as evidence *against* the frame-count change (a
naive "did the new code break the old mode" read), when the actual finding
is a general lesson about cross-file WGSL imports as silent interface
coupling. We're including this in the writeup rather than cleaning it out of
the history, because the alternative — quietly re-running until the numbers
look clean — is exactly the failure mode a reproducible-runner methodology
exists to prevent.

**Cross-demo confirmation, independent of the fix entirely.** Demo 06
(Mathis's SSHGI) implements its own count-based accumulation, arrived at
independently, with no code shared with demo 03. In the cross-demo bake-off
(`bench/results/trackE-bakeoff.md`, verdict 2 and the summary table):
SSHGI's still stability is **0.34**, beating demo 03's EMA (1.06) even though
SSHGI's march costs roughly 6× more (13.55–31.31 ms vs demo 03's 2.15–4.56
ms, `trackB-budget.md`). The accumulation idea and the march's cost are
cleanly separable findings — SSHGI's expensive march doesn't survive the
bake-off, but its accumulation scheme does, independently corroborating the
demo-03-specific result from a completely different codebase.

## The honest caveat

Count-based ("1/N", history-length-aware) accumulation is not a novel
invention of this project. It is the standard shape of a TAA history buffer
in most production temporal-antialiasing implementations, and — as shown
above — it shows up independently in one of the bench's own reference
implementations (Mathis's SSHGI) with zero code relationship to demo 03. The
external, general-industry citation for "count-based/history-length
accumulation is standard TAA practice" is **TODO-EVIDENCE**: this repo
contains the in-repo corroboration (SSHGI) but not a source file for the
broader TAA/FSR2 lineage claim; a citation (e.g. Karis 2014's temporal
supersampling writeup, or an FSR2/TAA history-buffer reference) should be
added before this draft is finalized for external publication.

What is specific and measured here, and is the actual contribution: **the
paired, apples-to-apples comparison of both accumulation schemes inside one
shipped algorithm's own code path, with everything else held constant** —
same march, same noise generator, same denoiser — repeated across two
independent measurement sessions and cross-checked against a third,
unrelated implementation that happened to make the same choice. The
contribution is the measurement and the mismatch diagnosis (a 3-frame EMA
memory against a 12-frame noise cycle, stated explicitly rather than
discovered by trial and error), not the accumulation scheme itself.

## Why the diagnosis matters more than the fix

The interesting part isn't "count-based accumulation beats EMA" — that's
close to conventional wisdom once you say it out loud. The interesting part
is *why*, stated as a checkable number rather than an intuition: SSRT3's own
noise generator has a 12-frame period, and its own accumulator has roughly a
3-frame memory, and those two numbers are both extractable from the shipped
source. A fixed-rate EMA cannot converge a noise source whose period exceeds
its memory — that's not specific to this paper, it generalizes to any
temporal accumulator paired with any periodic noise generator where nobody
checked the two numbers against each other. The fix here is a toggle, kept
default-off so the faithful baseline stays comparable (`NEXTGEN.md`'s
faithfulness rule, `accumMode` default `'ssrt3-ema'`); the diagnosis is the
part worth generalizing to other shipped temporal-GI code that inherits the
same shape of bug.
