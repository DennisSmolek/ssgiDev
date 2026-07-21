# OUTLINE — ssgiDev publication track

Status: draft skeleton, written 2026-07-21 against commit `7f80b84` (dirty at
write time — trackA/trackC stamped `7f80b84-dirty`, trackB/DEMOS.md bake-off
stamped clean `7f80b84`). Venue is **undecided** (blog series vs paper —
Dennis's call); everything below is written venue-neutral: each section is a
self-contained claim + evidence unit that works as a blog post, a paper
section, or a talk slide, in any order.

Six candidate contributions, in the order the bench actually produced them.
**All six now have full drafts** (`draft-methodology.md`, `draft-lsao.md`,
`draft-accumulation.md`, `draft-upsample.md`, `draft-adaptive.md`, added
2026-07-21 once P2/P5.2 landed; `draft-distillation.md`, added at P6 once
P5.3 landed and closed out §6's isolated-variant evidence — see §6 below for
what it does and doesn't claim).

---

## 1. The bench methodology — faithful-source bake-off + oracle views

**Thesis.** You cannot trust a single reimplementation's numbers about a
paper's own tradeoffs — only independent implementations of the same paper,
measured against a shared ground truth built from the *same* G-buffer, tell
you whether a divergence is the paper's behavior or your port's bug. This is
the instrument the other five sections stand on.

**Evidence available today:**
- Three independent, code-sharing-free implementations of Therrien et al.
  (arXiv 2301.11376) exist in the bench: demo 03 (SSRT3/Unity HDRP port, WGSL
  compute), demos 04/05 (Salm's Shadertoy ground-truth refit), demo 06
  (Mathis's Shadertoy SSHGI). Lineage and independence documented per-demo in
  `bench/DEMOS.md` lines 1–116.
- The oracle: demo 02's brute-force MC marcher, consuming the identical
  G-buffer as every demo, promoted to a shared `ReferencePass`
  (`bench/src/harness/reference-pass.ts`) — WORKLOG 2026-07-18 "Shared
  ReferencePass" entry. Reference/split/diff views wired into demos 02/03/04/05
  (WORKLOG 2026-07-18 "Demo 03 wired to the shared ReferencePass").
- Reproducible runners: `bench/scripts/run-<lab>.mjs` (P0 packet, WORKLOG
  2026-07-21 "P0: committed lab runners") drive headed Playwright, fence GPU
  time via `queue.onSubmittedWorkDone()`, and stamp every table with commit +
  config JSON — `bench/results/*.md` + matching `.json`.
- The faithfulness boundary itself is a documented rule, not folklore:
  `NEXTGEN.md` lines 8–19 ("demos 00–11 and the labs stay faithful... they are
  the measuring instruments").
- Two motivating failure stories, both in WORKLOG: the demo 03 y-mirror bug
  (2026-07-18 "Demo 03 box-top speckle: REAL root cause") and the lab 10
  broken-import bug (WORKLOG 2026-07-21 "P1 Track D", the `ssrt-temporal.wgsl`
  binding-layout break).
- The deliverable table: `bench/results/trackE-bakeoff.md`, cross-referenced
  in `bench/DEMOS.md` "Bake-off verdicts" section.

**Evidence still needed:** channel-matched cross-demo MSE (today's MSE
compares different quantities per demo — composite vs alpha-scale oracle,
AO-only, rgb-scale; see trackA-quality.md caveat and footnote 3 in
trackE-bakeoff.md); this is a named follow-up, not yet scheduled to a packet.

**Packet:** evidence complete for the story as told (P0/P1); the
channel-matched MSE upgrade is unscheduled.

---

## 2. The LSAO-for-bitmask negative result + modern-alternatives analysis

**Thesis.** SSILVB's own future-work section (§5) names LSAO's shared-memory
caching as the fix for its bandwidth problem. We tested that suggestion
literally and structurally. Literal: negative (0.87–1.06×, occasionally
slower). Structural: incompatible by construction — LSAO's O(1) speedup
requires collapsing each direction to a single largest occluder, and a
visibility bitmask needs full per-sector occupancy. The paper diagnosed the
disease correctly; its prescribed cure doesn't transfer to the data structure
that superseded HBAO's horizon pair.

**Evidence available today:**
- The paper's own claim, quotable verbatim: `research/sources/papers/
  ssilvb-paper-notes.md` §5 point 2 ("Using a caching method similar to LSAO
  could potentially improve this").
- LSAO's mechanism and why it's O(1): `research/sources/papers/
  lsao-timonen2013-notes.md` "Core idea" section (obscurance hull, largest-
  occluder approximation).
- The literal-reading experiment (cooperative 24×24 LDS depth tile,
  `bench/src/demos/09-bandwidth/ssrt09-march-shared` — described in
  `bench/src/demos/09-bandwidth/README.md` Axis 2): numbers in
  `bench/results/lab09-bandwidth.md` and the README's Axis 2 findings table
  (best case 0.87×/sponza-radius2, worst 1.06×-slower/cornell-radius2).
- The structural-reading argument: `lsao-timonen2013-notes.md` "2026-07
  EXPERIMENTAL OUTCOME" section, point 2.
- The contrast number: resolution lever (Axis 1) 4.1–6.3× vs caching lever
  (Axis 2) 0.87–1.06× — both in the same README, same measurement session,
  same march.
- Modern-heirs analysis: `lsao-timonen2013-notes.md` "Modern (2013 → 2026)
  answers" section — deinterleaved/CACAO (scheduled must-do, NEXTGEN.md P5),
  screen-space radiance caching (deferred), ReSTIR (deferred), temporal
  amortization via guides (our own P2/P5 track), hierarchy (Hi-Z, unscheduled
  idea in advantagous-concepts.md), subgroups (confirmed available, NEXTGEN.md
  P5, live probe WORKLOG 2026-07-19).

**Evidence still needed:** none for the negative result itself — it's closed.
The deinterleaved/CACAO "true heir" claim is analysis, not yet measured on
this bench. One of the named heirs — "temporal amortization with per-pixel
effort control" — is no longer a deferred idea: it's now measured and
drafted, see §4 / `draft-adaptive.md`, which explicitly frames itself as this
section's sequel ("the LSAO story's ending"). CACAO-style deinterleaving and
subgroup sharing remain unmeasured.

**Staleness note (scene-v2, added at P6):** the Axis 2 (LSAO-caching) numbers
cited above predate the sponza relight (`WORKLOG.md` 2026-07-21 "Sponza scene
v2") — the re-baseline battery that followed
(`WORKLOG.md` "Scene-v2 re-baseline recorded") re-ran lab 09's Axis 1 and
Axis 3 but not Axis 2 (`bench/results/lab09-bandwidth.md`, commit `df2e232`,
has no `shared` dispatchMode rows). The negative result's *shape* (narrow,
regime-dependent, sometimes-negative) is structural (see the argument in
`draft-lsao.md`) and not expected to change on a relit scene, but the exact
percentages in the table above are v1-scene numbers and haven't been
re-confirmed on v2. Unscheduled follow-up, named rather than silently carried
forward.

**Packet:** negative result closed (P1/lab 09, done); its sequel (§4) is also
closed. Modern-heir confirmation (CACAO-style deinterleaved marching,
subgroup sharing) is unscheduled.

---

## 3. Frame-count accumulation vs shipped EMA

**Thesis.** SSRT3 ships a fixed-`temporalResponse` EMA with roughly a
3-frame memory, but its own noise generator cycles on 12 frames (6 rotations
× 4 offsets). An EMA with less memory than the pattern it's supposed to
average cannot converge — it inherits a permanent floor of boil. A simple
per-pixel frame-counter (`N`, reset on disocclusion, blend weight `1/N`
capped) fixes this without touching the march. This is not a new invention —
count-based history is standard in TAA and appears independently in the
Mathis/SSHGI reference — but the *measured, apples-to-apples comparison
inside one shipped algorithm's own code path* is the contribution.

**Evidence available today:**
- The mismatch argument (12-frame cycle vs ~3-frame EMA memory): WORKLOG
  2026-07-18 "Demo 03 temporal" entry, Task 2 description.
- The fix's implementation: same WORKLOG entry — `accumMode` toggle
  (`ssrt3-ema` default / `frame-count`), `accumFrameCap`, disocclusion-reset
  rule (`posSimilarity < 0.5`), r16float ping-pong counter texture.
- First measurement (WORKLOG 2026-07-18, same entry): frame-count 0.83 vs
  ssrt3-ema 3.38 (mean abs pixel diff, gi view, 2s apart after 6s settle) —
  ~4× boil reduction.
- Re-confirmation on the fixed base, Track C stills: `bench/results/
  trackC-temporal.md` — frame-count 0.3058 vs ssrt3-ema 1.0575 (C-wide,
  combined view).
- Re-confirmation, lab 10 (fixed independently, different metric run, same
  methodology): `bench/results/lab10-stability.md` — mathis (count-based)
  0.0959 vs ssrt3-EMA 2.0663 (combined view); mathis 0.4591 vs ssrt3 6.8338
  (gi-only view). Cross-ref in demo 03's own accumMode toggle at the same
  session: ema 4.895 vs frame-count 1.4992 (WORKLOG 2026-07-21 Track D entry).
- Cross-demo confirmation, Track E: `bench/results/trackE-bakeoff.md` verdict
  2 — SSHGI's independently-invented count-based accumulation (0.34) beats
  demo 03's EMA (1.06) even though SSHGI's march is 6× more expensive; the
  accumulation idea and the march cost are separable findings.
- The lab-10 bug-and-fix story itself is part of the evidence: the lab's
  ssrt3 stack silently broke when demo 03's binding layout changed underneath
  its `?raw` WGSL import — WORKLOG 2026-07-21 "P1 Track D" entry, "Lab 10 —
  verdict refined + bench bug found/fixed" paragraph. Worth telling as the
  methodology's self-correction, not hidden.

**Evidence still needed:** an external citation for "count-based accumulation
is standard in TAA / SSHGI already does this independently" beyond what's in
this repo (Mathis's SSHGI accumulation is observed in-repo, `bench/DEMOS.md`
demo 06 section; the general TAA history-length claim is well-established
industry practice but has no source file in this repo — **TODO-EVIDENCE**:
external citation, e.g. Karis 2014 "High Quality Temporal Supersampling" or
an FSR2/TAA history-buffer reference, to be added by Dennis or in a later
pass).

**Packet:** evidence complete (P0/P1, done). No further packet required
unless Dennis wants the external-citation gap filled.

**Scene-v2 note (added at P6):** this section's numbers are Cornell/zoo-based
(Track C, lab 10) and were not affected by the sponza relight
(`WORKLOG.md` 2026-07-21 "Sponza scene v2" — "Cornell/zoo rows re-record with
[the sponza battery] (same-commit freshness, no scene change there)"); no
re-baseline was needed and none is pending.

---

## 4. Guides-driven adaptive bitmask marching — DRAFTED (`draft-adaptive.md`)

**Thesis.** The real answer to LSAO's complaint (every pixel pays full march
cost regardless of need) is not sharing traversal across pixels (LSAO's
approach, incompatible with bitmasks — see §2) but sharing effort across
*time*: a per-pixel history-length signal already exists (frame-count
accumulation, §3) and can steer march quality — converged pixels coast,
disoccluded pixels get full budget. Both gates this section was waiting on
have now landed: P2 validated the shared guides pass as equivalent-or-better
than the private logic it replaces, and P5.2 measured the adaptive-march
variant against it. It is, on the recorded numbers, the single largest
optimization win found in the project.

**Evidence available today:**
- The architectural case and its FSR3 lineage: `advantagous-concepts.md`
  ("The biggest lever: adaptive effort steered by those guides" section) and
  `FSR3-BRIEF.md` (temporal-guides contract: `dilatedVelocity`,
  `disocclusion`, `historyLength`, `reactive` textures; decomposition passes
  1–4; `bench/src/harness/temporal-guides.ts` is the shipped bench-side
  implementation, 3 dispatches, lazy-run like `ReferencePass`).
- The prerequisite: `historyLength` is exactly demo 03's frame-count
  accumulator (§3), generalized from private to shared.
- **P2 acceptance (landed, commit `e69f90b`):** `WORKLOG.md` 2026-07-21 "P2 +
  P3 landed and accepted" — `bench/results/lab10-stability.md` (commit
  `d6e441f-dirty`), guides-fed temporal (`ssrt3-guides`) combined stability
  1.49 vs private-logic `ssrt3` 2.06 (28% steadier), gi 7.20 vs 7.09 (equal),
  teleport reconvergence 1.50 vs 1.52 s (equal). "The FSR3-BRIEF decomposition
  is REAL." This is the gate that had to clear before P5 could measure
  anything against the guides.
- **P5.2 recorded verdict (landed):** `WORKLOG.md` 2026-07-21 "P5.2 bandwidth
  family RECORDED VERDICT" + `bench/results/demo13-all.md` (commit
  `eacdc2d-dirty`) — the `adaptive` march variant (`bench/src/demos/
  13-optim/variants.ts`, `gEffort = mix(1.0, 0.4, clamp((N-4)/12, 0, 1))`
  scaling `rotationCount`/`stepCount`): converged march 3.17× (C-wide) /
  2.37× (S-hall), fresh-pixel cost = baseline (no discount, no penalty),
  stability cost +0.17 / +0.03 (recorded, tunable via the 0.4 floor), oracle
  MSE +0.0006 / +0.0002. Adjudicated the flagship Phase-O optimization; other
  bandwidth-family variants tested the same session (light-mips, hiz-skip,
  checkerboard) all came back at or below 1.0×, and the ALU family (P5.1,
  `WORKLOG.md` "Scene-v2 re-baseline recorded + P5.1 ALU verdict") confirmed
  near-zero — both are the honest control showing adaptive effort, not raw
  fetch reduction, is where this particular win lives.
- Full argument, all sources synthesized: `draft-adaptive.md`.

**Evidence still needed:** `adaptive` is adjudicated as demo 12's headline
Phase-O graduate but the *integration* decision — making it demo 12's actual
default and re-synthesizing the E-table around it — is explicitly deferred to
P5.3 (`WORKLOG.md` "P5.2 bandwidth family RECORDED VERDICT," final
paragraph: "integration decision deferred to post-P5.3 so the E-table updates
once"). No demo-12-with-adaptive-as-default acceptance number exists yet —
today's numbers are the isolated march variant, not the shipped pipeline.

**Packet:** P2 (guides pass + A/B lab, done) → P5.2 (adaptive-effort variant,
measured, done) → P5.3 (integration into demo 12's default, pending) → §6's
E-table resynthesis. This section's own claims (the isolated variant's
ms/MSE/stability) are fully evidenced; §6's combined-system claim is not yet.

---

## 5. The joint-bilateral upsample node — DRAFTED (`draft-upsample.md`)

**Thesis.** SSILVB's Table 2 config (f) reports ~4× from half-res + bilateral
upsample, but no shipping three.js node implements a *joint* bilateral
upsample (low-res color guided by high-res depth/normal, Kopf et al. sense) —
only same-resolution edge-aware blurs. The bench built one as a standalone
harness pass, measured the paper's claim directly with margin to spare
(three independent sessions, spanning a march bug fix and a scene relight),
and it now ships as demo 12's actual default chain, not just a lab result.

**Evidence available today:**
- The gap in three.js today, searched and confirmed: `research/sources/
  denoising/threejs-nodes.md` lines 114–151 — `BilateralBlurNode` and
  `depthAwareBlur` exist but neither is a low-res→hi-res guided upsample; a
  GitHub code search for `upsample` in `mrdoob/three.js` returned no
  purpose-built joint-bilateral-upsample node (line 151).
- The implementation: `bench/src/demos/09-bandwidth/ssrt09-upsample.wgsl`,
  described in `bench/src/demos/09-bandwidth/README.md` "Axis 1" section
  (2×2 low-res tap gather, `bilinear · depthSimilarity · normalSimilarity`
  weighting, nearest-tap disocclusion fallback).
- The measurement: `bench/results/lab09-bandwidth.md` + README Axis 1 table —
  half-res chain 4.1–6.3× faster than full-res march (sponza rc4/sc32
  20.14→4.40 ms = 4.6×; cornell rc4/sc32 13.26→2.09 ms = 6.3×), machinery
  <0.5 ms fixed tax, quarter-res 15–23×.
- Quality evidence: near-zero diff error on flat/front-facing surfaces, no
  silhouette halos (README Axis 1, quality paragraph); error concentrates at
  grazing angles and contact detail, entangled with raw-march MC noise (both
  images un-denoised by lab design).
- SSILVB's own claimed number to compare against: `ssilvb-paper-notes.md`
  Table 2 row (f) — 2.93 ms → 1.07 ms, "≈4× faster... but can introduce more
  flickering... and a blurrier result" (their caveat; ours reports the
  opposite — no halos, error confined to grazing/contact, because the guide
  uses both depth AND normal similarity where the paper's config is
  underspecified on this point).
- **Re-validated twice more since the numbers above were recorded**, both
  times holding the same 3.8×–6.3× band: post-y-fix (`WORKLOG.md` 2026-07-21
  "P1 Track D," half-res 3.8–5.4×) and post-scene-v2-relight
  (`bench/results/lab09-bandwidth.md`, commit `df2e232`, half-res 3.8–6.1×
  computed from the raw table).
- **Integration landed (P3, no longer pending):** `bench/src/demos/
  12-distilled/README.md` pipeline steps 3+6 ship this exact chain, default
  `marchScale = half`. Full-pipeline acceptance (`bench/results/
  demo12-acceptance.md`, commit `df2e232-dirty`, scene-v2): total 1.72×
  (C-wide) / 2.77× (S-hall) vs demo 03, equal-or-better MSE-vs-oracle both
  cells — a fourth independent measurement session (whole pipeline, not
  isolated chain) landing in the same range lab 09 predicted.

**Evidence still needed:** not packaged as a standalone three.js-consumable
node outside this bench harness — it lives as bench WGSL inside demo 09's
lab and demo 12's frozen fork; that extraction (NEXTGEN.md Phase I) hasn't
started. Also: the quality diff evidence (no halos, grazing-angle error) is
measured pre-denoiser by lab design; a post-denoiser ablation isolating the
upsample's own contribution to demo 12's MSE doesn't exist yet —
**TODO-EVIDENCE** in `draft-upsample.md`.

**Packet:** measurement complete (P0/P1, lab 09, done; re-confirmed twice
more, P1 Track D and scene-v2). Integration into demo 12's half-res chain
(Phase D / P3) is **done and shipped as the default**. Packaging as a
standalone consumable node outside the bench harness (Phase I) remains
unscheduled.

---

## 6. Demo 12/13 — the distilled SSGI (Phase D/O) — DRAFTED (`draft-distillation.md`)

**Thesis.** Combine every measured winner from §1–5 into one new
implementation — not a port, not faithful to any single source — first
unoptimized (demo 12, the control: same academic-style code as its parents,
proving it reproduces their quality against the oracle), then with ten
optimization variants applied one at a time against that frozen control, each
with a paired ms/MSE-vs-baseline/MSE-vs-oracle/stability gate (demo 13). This
is the actual deliverable NEXTGEN.md is building toward; §1–5 are its
evidence base, and this section is their synthesis: distill-then-optimize
banked most of the win at the ingredient level (1.7–2.8× pre-optimization),
and of ten optimization variants tested against that control in one day, one
(`adaptive`, guides-driven per-pixel effort — §4's mechanism, now shown as
the flagship of a ten-way field rather than in isolation) closed the
remaining C-wide gap while eight came back near-zero or negative and one
(`trig`) was a free exact rider — the harness's paired-gate discipline is
what let all ten be adjudicated honestly in a single day.

**Evidence available today (P3/P4/P5.1/P5.2/P5.3 have all landed and closed
Phase O; full synthesis drafted in `draft-distillation.md`):**
- The ingredient list, locked at the P1 gate: `WORKLOG.md` 2026-07-21 "P1
  Tracks B/A/C/E" entry, final paragraph — "SSRT3-compute base + frame-count
  accumulation + IGN-under-denoiser + half-res joint-bilateral chain +
  Ottosson thickness + salm-caps distant light + §3.2 fallback; GT-VBGI as
  the quality acceptance [bar]" (continues past the read window, see
  `NEXTGEN.md` Phase D expected-ingredients list, lines 26–31, for the same
  list with bent normals/spec occlusion and temporal guides marked additive).
- Every ingredient's individual evidence is §1–5 above plus lab 07/08 (ambient
  fallback, thickness/distant-light — `bench/DEMOS.md` "07-11 — The labs"
  table) and lab 11 (noise choice — same table).
- **P3 — demo 12 exists and is accepted** (`WORKLOG.md` "P2 + P3 landed and
  accepted," commit `d6e441f`; re-baselined on scene-v2,
  `bench/results/demo12-acceptance.md` commit `df2e232-dirty`): 1.72×
  (C-wide) / 2.77× (S-hall) vs demo 03 total, equal-or-better MSE-vs-oracle
  both cells — "≥2×" met at S-hall, near-miss at C-wide going into P5 (now
  closed on converged frames by §4/`draft-adaptive.md`, pending P5.3
  integration).
- **P4 — capability adds landed**: bent normals + visible cone (default ON,
  bit-identical when off, `bentDiff` ~20–25° mean angular error vs oracle,
  invariant to rotationCount — a weighting-estimator gap, not a convention
  bug), specular occlusion (default OFF — the closed-Cornell oracle models
  `skyIntensity=0`, so defaulting it on would inflate the control's MSE),
  two-sided depth thickness (default stays Ottosson) —
  `bench/src/demos/12-distilled/README.md` "Capability adds," `WORKLOG.md`
  2026-07-21 "P4: demo 12 capability adds."
- **P5.1 — ALU family, RECORDED VERDICT: honest near-zero**
  (`WORKLOG.md` "Scene-v2 re-baseline recorded + P5.1 ALU verdict";
  `bench/results/demo13-alu.md`): trig 1.02–1.08×, loop/precision at or
  below 1.0×. NEXTGEN principle 5 ("bandwidth before ALU") confirmed on the
  bench's own code, not just lab 09's forks.
- **P5.2 — bandwidth family, RECORDED VERDICT**
  (`WORKLOG.md` "P5.2 bandwidth family RECORDED VERDICT";
  `bench/results/demo13-all.md`, commit `eacdc2d-dirty`): `adaptive`
  (guides-driven effort) adjudicated the flagship optimization, 3.17×/2.37×
  converged, fresh-pixel cost = baseline, mechanism drafted at §4 /
  `draft-adaptive.md`. light-mips/hiz-skip near-zero, checkerboard a
  documented negative (uncompacted dispatch costs stability for no real ms
  win).
- **P5.3 — scheduled-heir family + Phase-O closing adjudication, RECORDED
  VERDICT** (`WORKLOG.md` "P5.3 SCHEDULED-HEIR family" + "P5.3 RECORDED
  VERDICT + Phase-O closing adjudication"; `bench/results/demo13-phase3.md`,
  commit `46abb76-dirty`): `deinterleave` (CACAO-style phase-bucket
  marching, Dennis's must-do — the named production heir to LSAO's own
  coherence goal, run for completeness) recorded a perf **negative**, correct
  on image (march 0.89×/0.76×, chain 0.92×/0.78× C-wide/S-hall) — the
  4-dispatch overhead outweighs the cache gain on an already-half-res march,
  closing the LSAO paper trail end-to-end (§2's suggestion tested literally
  and structurally, now its modern heir tested and also negative, for a
  different documented reason each time). `subgroups` recorded ~1.0× both
  cells, bit-exact — a verified, zero-risk freebie like `trig`, not a lever.
  The closing adjudication: **ten variants, one control, one day, zero wrong
  images** — 8 near-zero-or-negative, 1 free rider (`trig`), 1 flagship
  (`adaptive`); demo 12 stays the unoptimized control per its permanent role;
  the best shipping-shaped configuration is demo 13's `bandwidth-all` +
  `trig`, estimated ≈0.8 ms converged C-wide vs demo 03's 2.145 ms — both
  ≥2× success measures met on converged frames.
- The success bar: `NEXTGEN.md` "Measures of success" section (quality ≤ best
  faithful demo's MSE, perf ≥2× at equal-or-better MSE, stability ≤
  frame-count demo 03, realism = bent-normal verification, consumability =
  zero-bench-dependency three.js node).
- Full synthesis, all sources above woven together: `draft-distillation.md`.

**Evidence still needed:** the *combined-system, shipped-default* number —
demo 12 with `adaptive` (or `bandwidth-all`) actually wired in as its
*default* march variant, and the bake-off table re-synthesized around that
one configuration — does not exist yet, and P5.3's closing adjudication
explicitly did not create it: demo 12 stays the unoptimized control by
design, and integration into a single consumable configuration is
`NEXTGEN.md` Phase I, unscheduled, opened when Dennis decides. What exists
today is per-ingredient (§1–5), per-variant (P5.1/P5.2/P5.3, isolated march
measurements against the frozen control), and the closing adjudication's
*estimated* combined total (≈0.8 ms C-wide, arithmetic from separately-
measured pieces, not a single fenced run of a fused pipeline) — no measured
number yet answers "what does one shipped, fully-optimized demo 12 cost
end to end, fenced as one pipeline."

**Packet:** P3 (demo 12 distillation, **done**) → P4 (capability adds,
**done**) → P5.1/P5.2/P5.3 (demo 13's ten optimization variants across ALU,
bandwidth, and scheduled-heir families, **done**, verdicts recorded and the
flagship independently drafted at §4) → this section's own synthesis,
**done** (`draft-distillation.md`) → Phase I (packaging the winning
configuration as a consumable, zero-bench-dependency node; re-running the
bake-off table against one fused, fenced pipeline number), **unscheduled,
Dennis's call to open.** Per-ingredient, per-variant, and the Phase-D/O
synthesis (§1–6) are now fully evidenced and drafted; no prose should claim
a measured (as opposed to estimated) finished-pipeline number until Phase I
runs it.

---

## Style notes carried into the drafts

- Every number cites its file. Where a number spans two files (e.g. the same
  metric run twice, before/after a bug fix), both are cited.
- Negative results get the same prominence as wins — §2 and the lab-10 bug
  story in §3 are written as findings, not apologies; §6's own field of ten
  Phase-O variants carries eight honest failures at the same level of detail
  as its one flagship, for the same reason.
- No claim in any draft is asserted as fact beyond what its cited results
  file actually measured. §6 in particular distinguishes *measured*
  per-ingredient and per-variant numbers (P3/P4/P5.1/P5.2/P5.3, all landed)
  from the *estimated* fused-pipeline total (≈0.8 ms converged C-wide,
  arithmetic over separately-measured pieces) — the latter is labeled an
  estimate in `draft-distillation.md`, not presented as a fenced measurement,
  because no single run has fenced `adaptive` wired in as demo 12's actual
  default. §4 and §6 both graduated out of "pending" at P6 once their
  respective gates (P2+P5.2 for §4; P3–P5.3 for §6) landed.

---

## Status (updated at P6)

**All six sections are now drafted** (`draft-methodology.md`,
`draft-lsao.md`, `draft-accumulation.md`, `draft-adaptive.md`,
`draft-upsample.md`, `draft-distillation.md`). Remaining work before
external publication:

1. **Venue decision** — blog series vs paper vs talk; Dennis's call, deferred
   since this outline's first draft (see header).
2. **External citations flagged TODO-EVIDENCE** — each draft names its own
   gap inline rather than asserting an unsourced claim: `draft-accumulation.md`
   (count-based/TAA-history-buffer industry citation, e.g. Karis 2014 or an
   FSR2/TAA reference), `draft-adaptive.md` (adaptive-sample-count/effort
   citation, e.g. Schied et al. 2017 SVGF or a production adaptive-sampling
   writeup), `draft-upsample.md` (a post-denoiser ablation isolating the
   upsample's own MSE contribution — an in-repo measurement gap, not an
   external citation, but named the same way). None of these block internal
   consistency; they block only external, cited publication.
3. **Phase-I packaging** — the one piece of work still unmeasured rather than
   merely uncited: wiring the winning demo-13 configuration into demo 12 as
   its shipped default and fencing one combined-pipeline number, then
   extracting the upsample (§5) and the eventual distilled SSGI (§6) as
   consumable, zero-bench-dependency three.js nodes. `NEXTGEN.md` Phase I,
   unscheduled, opened when Dennis decides.
