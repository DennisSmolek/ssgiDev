# Faithful-source bake-offs: a methodology for testing what a screen-space GI paper actually claims

*Draft — venue-neutral. Numbers stamped to commit `7f80b84` (bake-off table) /
`6f5b91e` (lab runs) unless noted. Every claim below cites the file it came
from; re-run any of them via `bench/scripts/run-*.mjs`.*

## The problem with reimplementing a paper once

If you port a screen-space GI paper and it looks wrong, you have exactly two
hypotheses and usually no way to separate them: either the paper's technique
has the limitation you're seeing, or your port has a bug. Most graphics blog
posts and even some papers resolve this by eyeballing it against "what looks
right" — which quietly launders port bugs into technique limitations and vice
versa. We wanted a harness that couldn't do that.

The fix is structural, not diligence: build the same paper **three times**,
from three different lineages that share no code, and measure all three
against a ground truth that consumes the identical input data. Where the
three implementations agree, that's the paper's real behavior. Where they
diverge, the divergence is a ready-made experiment — you go find which one is
wrong, and the paper gets to keep its reputation either way.

## What we built it around

The paper is Therrien, Levesque, and Gilet, "Screen Space Indirect Lighting
with Visibility Bitmask" (arXiv:2301.11376) — horizon-based AO/GI that
replaces GTAO's two horizon angles with an N-bit occupancy mask per
hemisphere slice, letting light pass behind thin geometry at horizon-method
cost. Three independent lineages exist in public source form:

1. **Demo 03** — a WebGPU compute port of Therrien's own Unity HDRP reference
   implementation (SSRT3), restoring everything the community's earlier
   three.js port (demo 01, Mugen87's TSL port, PR #31839) had simplified
   away: the §3.2 probe fallback, multibounce, mip/normal-approximation
   bandwidth optimizations. `bench/DEMOS.md` lines 53–66.
2. **Demos 04/05** — Mirko Salm's independent ground-truth refit
   (Shadertoy, `TinyTexel`), which Therrien himself called "a great
   improvement... and makes it more physically correct." `bench/DEMOS.md`
   lines 68–96.
3. **Demo 06** — Mathis's SSHGI (Shadertoy `dsGBzW`), which predates Salm's
   work and shares zero code with SSRT3: "the only captured source where the
   complete loop (bitmask GI + multibounce + temporal accumulation +
   bilateral) ships together and is known-stable." `bench/DEMOS.md` lines
   98–115.

All three consume the same G-buffer producer (depth, view-space normal,
beauty, velocity — demo 00), so any two demos disagreeing means the
*algorithm's interpretation* diverged, not the input data.

## The oracle

Demo 02 is a brute-force, unbiased Monte Carlo path marcher (cosine sampling,
finite-slab thickness, view-space march) that reads that same G-buffer and
converges by ~512 accumulated frames. Because it consumes identical input, a
diff against it isolates *algorithm error* from *screen-space's inherent
blindness* (off-screen occluders, single-layer depth) — every demo suffers
the latter equally, so it cancels out of a same-scene comparison.

This started as one demo's private tool and was promoted into a shared
harness feature, `ReferencePass` (`bench/src/harness/reference-pass.ts`,
WORKLOG 2026-07-18 "Shared ReferencePass: ground-truth comparison as a
harness feature"), wired into demos 02/03/04/05 with three view modes:
`reference` (oracle alone), `split` (draggable divider), `diff` (`|a−b|×amp`,
amp defaults to 2 per `TESTING.md` — 8 saturates white from known systematic
offsets before showing structure). The pass runs lazily: it only marches
while a reference-mode view is active, verified by a gpu-ms gate (demo 04
4.74→9.13 ms parked-vs-active, demo 05 6.52→11.59 ms — WORKLOG 2026-07-18).

## Measurement discipline

Four rules, none of them exotic, all of them enforced by the harness rather
than by trust:

**Fenced bursts, not frame-timer averages.** GPU work is fenced via
`queue.onSubmittedWorkDone()` around N iterations, reported as the *min* of
3×40-iteration bursts (min ≈ least-throttled ≈ true cost), paired variants
measured back-to-back so they share thermal state (`bench/src/demos/
09-bandwidth/README.md` "Measurement methodology"). This is exposed per-demo
as `window.__bench0N` hooks and driven by committed Playwright runners
(`bench/scripts/run-<lab>.mjs`, WORKLOG 2026-07-21 "P0: committed lab
runners") rather than manual stopwatch numbers.

**Ratios, not absolutes.** Thermal drift moves absolute GPU-ms by roughly
±15% across a long measurement session — lab 09 documents this explicitly and
recorded it happening: sponza's rc4/sc32 full-res march measured 20.03 ms in
one burst and 24.88 ms half a session later, same code, same input
(`bench/results/lab09-bandwidth.md`). The number that survives is the paired
ratio (half-res is 4.1–6.3× the full-res march regardless of which absolute
session you're in), not either absolute. Every headline in this project is
phrased as a ratio for exactly this reason.

**Config + commit stamped on every number.** Every markdown results table
carries a `commit:` field and, per row, the config that produced it — see
the header block of any file under `bench/results/` (e.g.
`trackE-bakeoff.md` line 5: "commit 7f80b84"; `lab09-bandwidth.md` line 3:
"commit 6f5b91e-dirty"). A number without both is treated as not having
happened — this is a written rule (`TESTING.md`: "Every number lands with
its config JSON + commit hash or it didn't happen").

**A stability metric for temporal claims, not adjectives.** "Looks stable"
is not a measurement. The metric: mean absolute per-pixel diff between two
screenshots of a static camera, 2 seconds apart, after a 6-second settle
(established WORKLOG 2026-07-18, used identically in `trackC-temporal.md`
and `lab10-stability.md`). This single number is what separates "converged"
from "still boiling" throughout the project — see the accumulation draft for
what it found.

## Faithfulness as the load-bearing constraint

The harness's hardest rule is also its least intuitive one: **the demos that
serve as measuring instruments are frozen source-faithful — no optimizations
land there, ever** (`NEXTGEN.md` "The faithfulness boundary"). This feels
backwards if your instinct is "make everything as fast as possible," but the
logic is that an optimized baseline is a moving target — you can no longer
tell whether a later change improved *the algorithm* or just moved further
from whatever the paper actually specified. Bug fixes that *restore*
faithfulness are allowed (with a WORKLOG entry and a re-baseline of any
affected numbers); optimizations are reserved for new demos built *after*
the measuring is done.

Two stories from this project make the case concretely, and both cost real
debugging time to find.

**The demo 03 y-mirror bug.** Bitmask mode showed rotation-modulated gray
speckle on flat, camera-facing surfaces (box tops in the Cornell scene) that
the temporal accumulator could never converge away, while the reference
marcher rendered the same surfaces near-white. The first theory — a
phantom-sector quantization bug in the bitmask's `ceil()` — was plausible,
matched a real bug SSRT3 itself has a commented-out fix for, and was *wrong*:
Dennis disproved it experimentally (removing the ceil changed nothing) and
supplied the winning clue by comparing against demos 04/05, which are also
bitmask-based but showed no speckle. The real cause: SSRT3's WGSL used the
same 2D vector, `sliceDir.xy`, as both the view-space slice direction (which
builds the hemisphere angle mapping) and the screen-space march step. That's
legal in Unity, where UV is y-up and matches view-space y. It's wrong in a
WebGPU compute port, where UV is y-down (top-left origin) — so the marcher
physically walked in `(cos a, −sin a)` while the hemisphere mapping assumed
`(cos a, +sin a)`, mirroring every slice about its own frame. The error
scales with grazing angle and varies with per-pixel rotation noise, which is
exactly the dark-speckle-on-flat-surfaces signature that made the
quantization theory look right at first glance (WORKLOG 2026-07-18 "Demo 03
box-top speckle: REAL root cause"). Without a second faithful implementation
(04/05) to disagree with, and without an oracle both could be checked
against, this bug ships as "SSRT3's known limitation on flat surfaces."

**The lab 10 broken-import bug.** Nine months later — same repo, different
packet — lab 10's re-validation run returned a stability score of exactly
0.0000 for the SSRT3 stack. That's not convergence; it's a black canvas. Lab
10 imports demo 03's `ssrt-temporal.wgsl` verbatim via a raw WGSL import, and
an unrelated demo 03 change (the frame-count accumulation rewrite,
`c77e960`) had changed that file's binding layout — nine bindings instead of
the lab's expected set — silently breaking the lab's pass with no error
surfaced anywhere in the pipeline (WORKLOG 2026-07-21 "P1 Track D," Lab 10
paragraph). The fix was to freeze a fork (`ssrt3-temporal-ema.wgsl`) rather
than track the live file, and the standing lesson was written down as a
rule: cross-demo `?raw` WGSL imports are interface coupling, and when a
source file's bindings change, forks must be frozen copies or they break
silently. This is exactly the class of bug the fenced-runner discipline is
built to catch — a manual "does it still look right" pass would have
reported a black canvas as "SSRT3 mode broken" without diagnosing why, and
might easily have miscounted it as evidence *against* the accumulation
change that actually caused it.

Both stories share a shape: the bug was invisible without a second faithful
reference to disagree with, and it hid behind a plausible-but-wrong first
theory. That's the actual argument for faithfulness-as-instrument — it isn't
about purity, it's that a frozen, cross-checked baseline is the only thing
that makes "this diverges" a meaningful sentence.

## What the deliverable looks like

The end product of a testing phase under this methodology is one table:
demo × (MSE-AO, MSE-GI, GPU ms default/heavy, still stability, reconvergence,
artifact-zoo notes) at a fixed camera/scene grid, every cell re-runnable from
a committed script. `bench/results/trackE-bakeoff.md` is that table for this
project — five verdicts (algorithm base, accumulation scheme, budget
location, quality reference, cost explanation) fell directly out of reading
it, documented in the same file. The grid itself (six camera/scene pairs
stressing wall bleed, grazing angles, contact detail, long-range bandwidth,
thin occluders, and an artifact checklist — `TESTING.md` "Standard
measurement grid") is committed as `GRID_CAMS` in
`bench/scripts/lib/harness.mjs`, so "run the grid again" is a one-line import,
not a re-derivation from memory.

## The honest limits

MSE numbers across demos in `trackA-quality.md` are **not** cross-demo
comparable as-is — different demos' reference views compare different
quantities (composite vs. alpha-scale oracle for demo 03, AO-only for demo
04, RGB-scale for demo 05), a caveat recorded in the results file itself
rather than glossed over. The within-demo cell profile and the diff
screenshots are the valid cross-demo signal today; a channel-matched MSE
upgrade (AO view vs. oracle alpha, consistently, per demo) is a named,
unscheduled follow-up. We'd rather publish that gap than paper over it with
a ranking the data doesn't support yet.
