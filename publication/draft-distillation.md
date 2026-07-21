# Demo 12/13: distill first, optimize second, keep a frozen control the whole time

*Draft — venue-neutral. Numbers from `WORKLOG.md` 2026-07-21 "P2 + P3,"
"P4," "Scene-v2 re-baseline + P5.1 ALU," "P5.2 bandwidth RECORDED VERDICT,"
"P5.3 RECORDED VERDICT + Phase-O closing adjudication" entries;
`bench/results/demo12-acceptance.md` (`df2e232-dirty`),
`bench/results/demo13-all.md` (`eacdc2d-dirty`),
`bench/results/demo13-phase3.md` (`46abb76-dirty`); `bench/src/demos/
12-distilled/README.md`, `bench/src/demos/13-optim/README.md`; `NEXTGEN.md`.*

## The setup: five separate findings, one new implementation

Sections 1–5 of this series each measured one ingredient in isolation: the
bake-off methodology, a negative result about LSAO-style caching, a
frame-count accumulator fixing a broken EMA, a guides-driven adaptive march,
and a joint-bilateral half-res upsample chain. None of those numbers say what
happens when you build something out of the winners. Demo 12 and demo 13 are
that build — not a port of any single paper, but the bench's own SSGI,
assembled from measured choices and optimized under a paired-measurement
discipline strict enough that ten optimization attempts could be adjudicated
in a single day.

The project's rule (`NEXTGEN.md`, "The faithfulness boundary") is what makes
this safe: demos 00–11 stay frozen source-faithful forever — they're the
measuring instruments — and new work happens only in demos built *after* the
testing phase closed. Demo 12 is the first of those, and it inherits the
boundary in miniature: it is itself now the frozen control that demo 13's
ten variants are measured against.

## Phase D: combine the winners, unoptimized, and check it still tells the truth

Demo 12 ("distilled SSGI v0") takes the ingredient list the testing phase
locked (`bench/src/demos/12-distilled/README.md`, "Ingredient provenance"):
SSRT3's compute-pipeline shape as the algorithm base (bitmask march, §3.2
probe fallback, lightmask multibounce), frame-count 1/N accumulation instead
of the shipped EMA (§3), IGN noise with per-frame temporal advance, Ottosson
occluder-adaptive thickness, salm-caps spherical-cap distant light, and — the
largest single ingredient — the half-res downsample→march→joint-bilateral-
upsample chain (§5). Every choice traces to a specific lab verdict, not a
guess; the README's provenance table cites the exact track or lab for each
row.

Critically, nothing is optimized yet — the code stays in the same academic
style as its parents (`12-distilled/README.md`, line 4). Demo 12 has to
prove the *ingredients themselves* are worth something before any cleverness
is layered on top, by matching or beating the same oracle every other demo
in the bench is checked against.

It passed both checks. At acceptance (`bench/results/demo12-acceptance.md`,
commit `df2e232-dirty`, re-baselined on the sponza-v2 relight):

| cell | demo 12 total (half-res) | demo 03 total | speedup | MSE-vs-oracle (12 / 03) | stability (12 / demo03) |
|---|---|---|---|---|---|
| C-wide (cornell) | 1.2475 ms | 2.145 ms | **1.72×** | 0.0662 / 0.0677 | 0.3553 / 0.3058 |
| S-hall (sponza) | 1.6525 ms | 4.5825 ms | **2.77×** | 0.0143 / 0.0145 | 0.459 / 0.4242 |

Both cells pass equal-or-better MSE against demo 12's own oracle, and
stability lands within the paired 1.25× tolerance of demo 03's frame-count
number (the gate was made relative rather than absolute because the sponza
relight changed the scene's baseline noise floor — an honest lesson recorded
in the same WORKLOG entry). This is `NEXTGEN.md`'s "≥2× at equal-or-better
MSE" success measure, met at S-hall and a *near-miss* at C-wide (1.72×) —
going into optimization, not after it. Swapping in five measured winners
with zero new cleverness banked most of the win by itself. That's the
headline of Phase D: the ingredient choices, not code-level polish, are
where most of the speedup already lives.

Phase D also added capabilities that are explicitly *not* optimizations —
bent normals and a visibility cone from the bitmask (default ON,
bit-identical when off), specular occlusion (default OFF: the closed-Cornell
oracle models `skyIntensity=0`, so turning it on would inflate the control's
MSE against a light source the oracle can't see), and two-sided depth
thickness as a toggle alongside Ottosson. The bent-normal comparison against
the oracle's own cosine-weighted accumulation shows a ~20–25° mean angular
error invariant to rotation count — a weighting-estimator gap (uniform-sector
centroid vs. cosine-weighted visibility), not a convention bug, logged as
such (`12-distilled/README.md`, "P4 capability adds").

## Phase O: ten variants, one control, paired gates

Demo 13 forks demo 12 again — byte-identical copies of every WGSL file,
verified by `diff` — and adds one new mechanism: a compile-time `variant`
system that specializes only the march kernel per optimization principle,
string-transforming the pristine source and asserting exact occurrence
counts so upstream drift fails loudly at build time, never silently
(`13-optim/README.md`). Each variant compiles to its own pipeline; `baseline`
is asserted byte-identical to demo 12's own march, so the control can't drift
out from under the comparison.

Every variant clears three gates, not just a speed number: `pass_ms` (march
strictly faster than the paired, thermally-matched baseline), `pass_baseline`
(MSE against baseline's own converged image within a gate — 1e-4 exact, or a
relaxed 1e-3 converged-only gate for variants only lossy in motion), and
`pass_oracle` (quality vs. ground truth unchanged). A variant that's faster
but fails `pass_baseline` or `pass_oracle` doesn't get to claim the speed
number — this is what keeps the harness from shipping a silently-wrong image
disguised as a win.

Ten variants were tested against the frozen `baseline` in one day
(`WORKLOG.md`, "P5.3 RECORDED VERDICT": "10 variants, one day, zero wrong
images"). Eight came back near-zero or outright negative. One — `trig` —
banked a small, genuinely free win. One — `adaptive` — was the flagship.

### The eight that didn't move the needle (recorded, not hidden)

**The ALU family** (`loop`, `precision`, `alu-all`) — strength-reduced loop
arithmetic and f16 precision for proven-[0,1] quantities — confirmed
`NEXTGEN.md` principle 5 ("bandwidth before ALU") on the bench's own code,
not just lab 09's forks of demo 03. Isolated (`bench/results/demo13-all.md`,
`eacdc2d-dirty`): `loop` 1.01–1.02×, `precision` 0.99–1.00× (`pass_ms` false
both cells). The march is fetch-bound; rearranging arithmetic doesn't touch
the bottleneck.

**light-mips** (a prefiltered light-buffer mip pyramid, selected by the same
distance→mip map the depth pyramid already uses): 0.99× C-wide, 0.98× S-hall
— a wash on ms, though it measurably reduces fireflies (stability improves by
0.05). Verdict: "quality tool, not a perf lever at default settings"
(`WORKLOG.md`, P5.2 recorded-verdict entry).

**hiz-skip** (a box-MAX companion pyramid enabling two provably
contribution-free early-outs — full bitfield saturation, beyond-radius AO
skip): 0.98× both cells, bit-identical to baseline (MSE ~1e-5, the tightest
gate in the family) — an honest, correctness-free zero. The sector bitfield
rarely fully saturates at the shipped step count, so the early-out fires
seldom; the larger payoff, a full angular-interval Hi-Z traversal, remains a
scoped, unshipped follow-up.

**checkerboard** (frame-parity half-rate marching, relying on the
frame-count accumulator to refill the skipped half): ms ~1.0–1.05× — not
because the idea is wrong but because a per-thread `return` doesn't compact
the dispatch; the workgroup still schedules all 64 threads, half idle.
Stability degrades sharply: +0.9996 at C-wide, +0.2638 at S-hall. Recorded
as a documented negative: "a true 2× needs compacted dispatch, not a
per-thread early-out."

**deinterleave** (CACAO-style phase-bucket marching — Dennis's explicit
must-do, the named production heir to LSAO's coherence goal and, unlike
LSAO, bitmask-compatible by construction: it reorganizes *where* fetches
land, not the estimator). Isolated (`bench/results/demo13-phase3.md`, commit
`46abb76-dirty`): march 0.89× C-wide / 0.76× S-hall, chain (incl.
extract/scatter) 0.92× / 0.78× — a recorded perf *negative*, correct on image
(MSE-vs-baseline 1.3e-4/3.2e-5, oracle unchanged). The 4-dispatch split plus
extract/scatter overhead costs more than the cache-locality gain banks,
because the march is already half-res: the compact quarter-res images
already fit L2, leaving little miss penalty to recover — the same ceiling
lab 09's shared-memory LDS experiment hit, for the identical structural
reason (§2). This closes the LSAO paper trail end-to-end: the suggested fix
tested literally (negative, narrow), structurally (incompatible by
construction), and now its named modern heir on our own march (negative, for
a specific measured cause) — three independent negatives, each for a
different documented reason, converging on one conclusion: the win isn't in
cross-pixel or cross-fetch reorganization at this operating point.

**subgroups** (barrier-free intra-wave sample sharing, only when every active
lane provably wants the same texel): 0.99× both cells at isolation — the
1.07–1.19× seen at smoke did not survive. Bit-exact (MSE ~1e-5, the exact
gate), proving the mechanism correct and the feature-gated-fallback pattern
practical. A verified freebie, not a lever — coherent far-fetch hit-rate is
low on a per-pixel march where sector fetches scatter across the frame.

### The one free rider

**trig** — replacing per-slice `sin/cos` with an angle-sum recurrence, and
two `acos`-then-`cos/sin` pairs with exact vector identities (`c = 2f−1; s =
√(1−c²)`), removing an approximation (`fastAcos`) for an *exact* form —
measured 1.05× C-wide / 1.07× S-hall, `pass_ms` true both cells,
MSE-vs-baseline ~1e-4 (an exact identity, not an approximation trade). Real,
free, zero-risk, small — kept available because there's no reason not to.

### The flagship: guides-driven adaptive effort

**adaptive** reads a per-pixel history-length signal — the same `N` counter
built for the frame-count accumulator (§3), generalized into a shared
`TemporalGuidesPass` following the FSR3-BRIEF contract (§4) — and scales a
`gEffort` term shrinking both `rotationCount` and `stepCount` as a pixel's
history converges: full budget below `N=4`, floored at 40% above `N=16`,
linear between. The isolated, recorded numbers (`bench/results/
demo13-all.md`):

| cell | converged march | fresh march | baseline march | converged ratio | oracle MSE Δ | stability Δ |
|---|---|---|---|---|---|---|
| C-wide (cornell) | 0.2075 ms | 0.6775 ms | 0.6575 ms | **3.17×** | +0.0006 | +0.171 (0.356→0.527) |
| S-hall (sponza) | 0.3550 ms | 0.8550 ms | 0.8425 ms | **2.37×** | +0.0002 | +0.035 (0.467→0.502) |

Two things make this more than a fast number. First, the fresh-pixel case —
a just-disoccluded pixel with no history — costs exactly what the unmodified
march costs (0.6775/0.8550 ms vs. baseline 0.6575/0.8425 ms, within
measurement noise). Nothing is stolen from the case that needs full quality
to pay for the case that doesn't. Second, it's the only one of the ten
variants that changed *when* the march runs at full cost rather than trying
to make every invocation cheaper — and it's the one that won by a multiple
instead of a percentage. Rolled into the shipped deliverable: with the march
at 0.21 ms, demo 12+adaptive's estimated converged-frame C-wide total is
≈0.80 ms against demo 03's 2.145 ms — the project's ≥2× success measure, a
near-miss at 1.72× before this measurement, **is now met on converged
frames** (fresh frames still land at the ~1.7× half-res floor demo 12
already banked).

The cost is real and recorded, not rounded off: the 0.4 effort floor means
even a fully-converged pixel keeps re-marching at 40% budget (to detect a
future disocclusion), and that shows up as extra boil — stability moves from
0.356 to 0.527 at C-wide (+0.171), a much smaller +0.035 at S-hall,
suggesting the tradeoff is scene-dependent and 0.4 is a tunable constant, not
a fixed law of the mechanism.

## The score, stated plainly

Ten variants, one control, one day: 8 near-zero-or-negative (ALU family,
light-mips as a perf lever, hiz-skip scoped-but-honest, checkerboard,
deinterleave, subgroups), 1 free exact rider (trig), 1 flagship (adaptive).
That ratio is itself a finding — a sharper confirmation of the lesson §1–5
already pointed at from the ingredient side: on this march, the resolution
lever (§5, 4.1–6.3×) and the temporal lever (adaptive, 2.4–3.2× on top of
that) are where the multiplicative wins live; ALU rearrangement, cross-pixel
fetch reorganization, and uncompacted parity tricks all come back at or below
1.0×. Two layers, same shape: at ingredient-selection, *which* algorithm and
accumulation scheme mattered more than code-level polish (§1–3); at
optimization, *when* work happens (temporal adaptivity) beat every attempt to
make *how much data* each invocation touches cheaper (spatial cleverness).
Neither finding was obvious going in — Dennis's own must-do (deinterleave)
was a reasonable bet on the paper's named production heir, and it lost for a
specific, measured, structural reason, not because it was a bad idea to try.

`WORKLOG.md`'s closing adjudication states the practical upshot directly:
demo 12 stays the unoptimized control (its permanent role — a distillation
demo doesn't get to also be the shipped fast path, or the next optimization
attempt has nothing stable to measure against); the best shipping-shaped
configuration today is demo 13's `bandwidth-all` (adaptive + light-mips +
hiz-skip composed, checkerboard excluded because it double-dips adaptive's
own temporal stability budget) plus `trig` — ≈0.8 ms estimated converged
C-wide total against demo 03's 2.145 ms, both success measures met on
converged frames.

## What the harness made possible, and what it didn't paper over

The meta-contribution isn't any single variant's number — it's that ten of
them could be tried, measured, and adjudicated in one day without a single
image silently going wrong. That's a direct consequence of the discipline
built across the whole project (§1): `baseline` asserted byte-identical to
its pristine source at every build (drift fails loudly, never silently);
paired, back-to-back, thermally-matched measurement (a slower burst can't be
misread as a real regression); a three-way correctness gate (ms,
baseline-image, oracle-image) a variant must clear before its speed number
counts; and a written culture where "this made it slower" gets the same
rigor as "this made it faster" — checkerboard, deinterleave, hiz-skip, and
the whole ALU family are documented as thoroughly as `adaptive`, not
footnoted. Lab 10's binding-layout bug (§1, §3) is the cautionary tale this
discipline exists to prevent; nothing in demo 13's ten-variant run
reproduced that failure mode.

## What's still open

The combined-system integration — wiring `adaptive` (or `bandwidth-all`) in
as demo 12's *shipped default* march variant, and re-synthesizing the
bake-off table around that number — is `NEXTGEN.md`'s Phase I, deferred so
the table updates once rather than incrementally (`WORKLOG.md`, P5.2
recorded-verdict entry: "integration decision deferred to post-P5.3 so the
E-table updates once"). Today's numbers are the isolated march variant and
the isolated Phase-D control, measured separately, not fused into one
shipped pipeline number. Packaging as a standalone, zero-bench-dependency
three.js node is the same Phase I and hasn't started. And the 0.4 effort
floor's stability cost is recorded but not yet explored as a tunable
surface — whether it's right for a shipped deployment, or should vary by
scene, is an open question with a number attached, not an answer.

## Takeaway

Distill first, optimize second, and never let the thing you're optimizing
also be the thing you trust. Demo 12 combined five independently-measured
winners with zero new cleverness and banked 1.7–2.8× at equal-or-better
quality before a single optimization pass touched it — evidence that
ingredient selection is where most of the win in a project like this comes
from. Demo 13 then spent one day testing ten ways to make the combined
result faster still, under a discipline strict enough that eight honest
failures and one free rider could sit next to one real flagship without any
being mistaken for each other. The flagship — adaptive, guides-driven
effort — didn't win by fetching less data or computing angles more cleverly;
it won by noticing that a signal already built for an unrelated reason
(fixing a broken accumulator) could tell the march when it was already done.
Two layers, one lesson each: ingredients beat micro-optimization, and
temporal adaptivity beats spatial cleverness. Both generalize past this
specific march.
