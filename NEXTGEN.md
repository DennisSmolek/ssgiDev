# NEXTGEN.md — distilling the bench into our own SSGI

The plan, rules, and success measures for turning bench learnings into a new,
original implementation. Written 2026-07-19; principles dictated by Dennis,
phasing agreed. Concept backlog: `advantagous-concepts.md`. Test methodology:
`TESTING.md`.

## The faithfulness boundary (hard rule)

- **Demos 00–11 and the labs stay faithful to their sources. No optimizations
  land there — ever.** They are the measuring instruments; optimizing them
  destroys the baseline. Bug fixes that restore faithfulness (y-mirror class)
  are allowed with a WORKLOG entry + re-baseline.
- **Our own work happens in NEW demos (12+), created only AFTER the testing
  phase** — distillations and conceptual expansions that combine the measured
  winners and then experiment with optimizations ON that combined base.
- Improvements inside existing demos remain toggles, default = faithful
  (the demo 03 `accumMode` pattern).

## Phasing

1. **Phase T — testing** (current): run TESTING.md. Output: bake-off table,
   budget map, lab re-validation, algorithm-base decision.
2. **Phase D — distillation (demo 12, "our SSGI v0")**: combine measured
   winners UNOPTIMIZED first — same academic-style code as its parents — and
   verify it reproduces their quality vs the oracle. This is the control.
   Expected ingredients (subject to Phase T): bitmask march + probe fallback,
   frame-count accumulation, per-frame jitter (IGN per lab 11), half-res +
   joint-bilateral chain, temporal+bilateral denoise, Ottosson thickness,
   spherical-caps distant light. Bent normals/spec occlusion + temporal guides
   enter here as new capability (they're additive, not optimizations).
3. **Phase O — optimization passes (demo 12 variants / demo 13)**: apply the
   optimization principles below, one family at a time, each landing with a
   paired measurement: fenced ms delta + diff-vs-oracle delta + stability
   delta at the TESTING.md grid. A change that wins ms but loses quality gets
   a documented judgment call, not a silent merge.
4. **Phase I — integration**: package as consumable three.js node(s); wire the
   FSR3 temporal-guides contract (FSR3-BRIEF.md); upscaler/AA resolve last.

## Optimization principles (Phase O). Perf goals, NOT hard rules.

None of these are dogma. There is always a legitimate reason for a costly
construct; the discipline is that cost is *chosen and measured*, not inherited
from academic reference code. Every principle below yields to a measurement.

1. **Trig avoidance as a goal** (IQ's "avoiding trigonometry" series,
   https://iquilezles.org/articles/noacos/): academic shaders reach for
   acos/atan2/sin/cos where vector identities (dot/cross/normalize/rsqrt,
   half-angle forms, Chebyshev recurrences for stepped angles) compute the
   same quantity. Our marchers are full of this (fastAcos per sample, sin/cos
   per slice). Replace where the identity is exact or the approximation error
   is measured below the noise floor; keep the trig where clarity or accuracy
   genuinely needs it.
2. **Branch hygiene**: academic ports carry per-sample conditionals (flag
   checks, mode switches) inside hot loops. Prefer specialization (compile-time
   WGSL variants per flag-set — we already generate shader text in TS),
   `select()` over divergent `if` for cheap both-sides, and moving uniform
   branches outside loops. But: a coherent branch that skips real work
   (early-out on sky pixels) is a WIN, not a smell — measure.
3. **Precision discipline**: stop defaulting to f32 everywhere. f16 storage is
   already used (rgba16float, r16float); extend to arithmetic where WGSL/
   hardware allows and the value range is proven (AO in [0,1], normalized
   directions, sector counts). Pack booleans/enums into existing u32 flags.
   Depth stays f32 (reconstruction precision is load-bearing — measured on the
   prev-depth pass).
4. **Loop hygiene**: hoist invariants — compute the base term once before the
   loop and advance incrementally (`value = base + i * step`, rotation by
   angle-sum recurrence) instead of re-evaluating pow/divide/trig of `i` per
   iteration. The SSRT3 march recomputes `pow(abs(...), expFactor)` per step;
   the slice loop recomputes sin/cos per rotation. Classic strength-reduction
   targets — verify the incremental form doesn't accumulate error across 32
   steps before shipping.
5. **Bandwidth before ALU**: lab 09's thesis, proven — the march is fetch-bound
   (resolution lever 4.5×, ALU rearrangement ~0×). Rank any optimization that
   reduces/coheres fetches (mips for light+normal, half-res, checkerboard,
   guides-driven adaptive effort) above any pure-ALU cleverness. Corollary: an
   ALU optimization that adds a fetch is almost certainly a loss.
6. **Adaptive over uniform**: per-pixel effort steered by history length /
   variance (temporal guides) beats globally lowering quality. Converged
   pixels coast; disoccluded pixels get the full budget.

## Measures of success (targets finalized after Phase T baselines)

Recorded per TESTING.md grid; v1.0 of demo 12 must hit, vs the Phase T table:

- **Quality**: MSE vs oracle ≤ best faithful demo's MSE (AO and GI separately),
  and no NEW artifact-zoo failure at graded diff amp 2.
- **Performance**: ≥ 2× faster than the best faithful demo at equal-or-better
  MSE on C-wide and S-hall (the half-res chain alone banks most of this;
  adaptive effort is upside).
- **Stability**: still-camera stability metric ≤ frame-count-mode demo 03;
  post-motion reconvergence ≤ 0.5 s at 60 fps equivalent.
- **Realism**: bent-normal/spec-occlusion on, verified against the oracle's
  directional visibility (new comparison view to be added in Phase D).
- **Consumability**: runs as a three.js node with zero bench dependencies;
  temporal-guides contract implemented (produce or consume per FSR3-BRIEF.md).

## Standing rules (all phases)

- Every optimization/change lands with: fenced ms, diff-vs-oracle, stability
  metric, config JSON, commit hash. No measurement, no merge.
- Negative results get WORKLOG entries with the same rigor as wins.
- Best-guess decisions made without Dennis get logged under "Decisions for
  review" — never silently.
- The bench (00–11 + labs + oracle) is the permanent regression harness for
  everything Phase D onward.
- **Feature-gated paths need a fallback (Dennis, 2026-07-19).** Chrome-only
  adapter features (`subgroups`, `shader-f16`, ...) are fine for research
  variants, but the shipped single "solution" must runtime-detect
  (`adapter.features.has(...)`) and fall back to a no-feature variant with
  documented quality/perf deltas. Every feature-dependent optimization is
  therefore built as a WGSL variant pair from day one (we already generate
  shader text in TS — specialization is cheap), and the fallback path stays in
  the P0 regression matrix so it can't rot.

---

# Execution workplan (added 2026-07-19)

End goals, in Dennis's words: **(1) use it in our own applications, (2) publish
it.** Both shape the work: consumability (a clean three.js node, zero bench
deps) and reproducibility (every claim re-runnable from committed runners) are
first-class requirements, not afterthoughts.

## Agent tiering (per packet)

- **Fable** — orchestrator, reviewer, hard-problem debugger, cross-packet
  synthesis, final adjudication of quality-vs-perf judgment calls. Does not
  bulk-implement.
- **Opus** — implementation workhorse: demo/algorithm code, WGSL, harness
  passes, anything where a wrong subtle decision costs a debugging session.
- **Sonnet** — scripted verification runners, measurement collection, port
  transliteration with a clear reference, README/doc drafts, test-matrix
  execution once runners exist.
- **Haiku** — mechanical legwork: schema `group:`/`hint:` annotation sweeps,
  boilerplate, screenshot collection re-runs from existing scripts, table
  formatting, link/consistency checks.

Protocol unchanged from PLAN.md: parallel worktrees, safety commit at every
green boundary, headed-only WebGPU verification, run-to-completion (best-guess
+ "Decisions for review" instead of blocking), WORKLOG is the state of record.

## Packets

**P0 — committed lab runners (unblocks everything).**
`bench/scripts/run-<lab>.mjs` playwright drivers: URL/config → fence hooks
(`__bench09`, `__ssrt3bench`) / screenshot MSE readback / stability metric →
one results table (JSON + markdown) stamped with config + commit. Sonnet
builds from the diag-03*.mjs pattern; Fable reviews methodology fidelity.

**P1 — testing phase execution (TESTING.md).**
Track D lab re-validation FIRST (labs concluded pre-y-fix), then B (perf
budget map), A (quality vs oracle), C (temporal), E (bake-off synthesis).
Sonnet executes via P0 runners; Haiku collects/formats; Fable synthesizes and
updates DEMOS.md verdicts. **Gate: Phase D ingredient list locked here.**

**P2 — temporal guides pass + A/B lab.**
Harness `TemporalGuidesPass` (dilated velocity, graded disocclusion, history
length; reactive as merge-in) per FSR3-BRIEF contract; demo 10 extension
A/B-ing guides-fed temporal vs private logic. Opus implements; this is also
the acceptance test for the FSR3 port's decomposition (P7).

**P3 — demo 12: distilled SSGI v0 (Phase D).**
The measured winners combined, UNOPTIMIZED (academic-style code kept) — the
control. Verified ≥ parents vs oracle on the TESTING.md grid. Opus, with
Fable doing the architecture review before code.

**P4 — demo 12 capability adds.**
Bent normals + specular occlusion from the sector mask (needs a new oracle
comparison view — Fable designs, Opus implements); two-sided depth thickness.
Additive capability, not optimization — allowed in Phase D.

**P5 — demo 13: optimization variants (Phase O).**
One family per variant, each with paired measurement (ms + MSE + stability):
trig-identity pass (noacos), branch/specialization pass, precision pass, loop
strength-reduction pass, half-res chain integration, guides-driven adaptive
effort, checkerboard, Hi-Z skipping, light/normal mips, deinterleaved
phase-bucket marching (CACAO-style — **MUST-DO, Dennis 2026-07-19**: the
production heir to SSILVB's LSAO suggestion; spatial fetch coherence,
bitmask-compatible; run it for completeness even if other levers already hit
target), and a subgroup sample-sharing experiment (**availability CONFIRMED
2026-07-19 by live probe**: Chrome 149 / Apple metal-3 adapter exposes
`subgroups` and a device requesting it succeeds; also present: `shader-f16`
— real f16 arithmetic for the precision pass, not just storage — and
`timestamp-query`, a GPU-timestamp option for the P0 runners. Barrier-free,
so lab 09's LDS-overhead argument does not transfer). Unscheduled by choice, revisit if P5 misses
targets: screen-space radiance caching (GI-1.0/Lumen family — an architecture,
not a variant; overlaps the deferred radiance-cascades track) and ReSTIR
reservoir resampling (wins concentrate in many-light regimes our scenes don't
stress). Opus implements,
Sonnet measures via P0 runners, Fable adjudicates every accept/reject.

**P6 — publication track (runs alongside P3–P5).**
Method writeup + results tables generated from P0 runner output (reproducible
by construction). Candidate contributions to develop honestly: the bench
methodology itself (faithful-source bake-off + oracle views), the LSAO-for-
bitmask negative result + modern-alternatives analysis (documented in
research/sources/papers/lsao-timonen2013-notes.md), frame-count accumulation
vs shipped EMA, guides-driven adaptive bitmask marching, the joint-bilateral
upsample node, and demo 12/13 itself. Haiku/Sonnet draft, Fable edits, Dennis
owns voice and venue (blog series vs paper decided when results exist).

**P7 — FSR3/upscaler convergence (Dennis's repo + bench).**
Dennis's FSR3 port decomposes per FSR3-BRIEF.md (passes/input staging pulled
early, self-contained repo). Bench consumes passes 1–2 as the guides provider
(replacing P2's home-grown pass if the port's is better); demo 12/13 outputs
feed the accumulate+upsample stage last. FSR3 internals worth mining beyond
the guides bundle: depth-clip/disocclusion logic, luma-instability tracking,
lock mechanism (thin-feature persistence), reactive-mask semantics.

## Order & gates

P0 → P1 (gate: ingredients) → {P2, P3} parallel → P4 → P5 (gate per variant:
measurement) → P6 finishes when P5 stabilizes. P7 proceeds in Dennis's repo on
its own clock; the P2 lab is its acceptance test on the bench side.
