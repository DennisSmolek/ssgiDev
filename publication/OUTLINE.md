# OUTLINE — ssgiDev publication track

Status: draft skeleton, written 2026-07-21 against commit `7f80b84` (dirty at
write time — trackA/trackC stamped `7f80b84-dirty`, trackB/DEMOS.md bake-off
stamped clean `7f80b84`). Venue is **undecided** (blog series vs paper —
Dennis's call); everything below is written venue-neutral: each section is a
self-contained claim + evidence unit that works as a blog post, a paper
section, or a talk slide, in any order.

Six candidate contributions, in the order the bench actually produced them.
Three have full drafts today (`draft-methodology.md`, `draft-lsao.md`,
`draft-accumulation.md`); three are outline-only because their evidence is
mid-flight (P2/P5) or their draft wasn't in this packet's scope (joint-
bilateral upsample — evidence is done, prose isn't written yet).

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
this bench (P5 will produce that number).

**Packet:** negative result closed (P1/lab 09, done). Modern-heir
confirmation (CACAO-style deinterleaved marching, subgroup sharing) is
NEXTGEN.md P5.

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

---

## 4. Guides-driven adaptive bitmask marching — PENDING P2/P5

**Thesis.** The real answer to LSAO's complaint (every pixel pays full march
cost regardless of need) is not sharing traversal across pixels (LSAO's
approach, incompatible with bitmasks — see §2) but sharing effort across
*time*: a per-pixel history-length signal already exists (frame-count
accumulation, §3) and can steer march quality — converged pixels coast,
disoccluded pixels get full budget. This is the single largest projected win
on the table and it is not measured yet.

**Evidence available today:**
- The architectural case and its FSR3 lineage: `advantagous-concepts.md`
  ("The biggest lever: adaptive effort steered by those guides" section) and
  `FSR3-BRIEF.md` (temporal-guides contract: `dilatedVelocity`,
  `disocclusion`, `historyLength`, `reactive` textures, passes 1–2).
- The prerequisite already shipped: `historyLength` is exactly demo 03's
  frame-count accumulator (§3), already computed, currently private to one
  demo — `FSR3-BRIEF.md` "Notes" bullet, WORKLOG 2026-07-18 "Demo 03
  temporal" Task 2.
- Scheduling: `NEXTGEN.md` P2 ("temporal guides pass + A/B lab", promotes the
  private accumulator into a shared harness pass, demo 10 A/B) and P5
  ("guides-driven adaptive effort" as one of the Phase O optimization
  variants, each requiring a paired ms/MSE/stability measurement).

**Evidence still needed:** everything quantitative — no ms delta, no MSE
delta, no stability delta exists yet for adaptive effort. This is explicitly
gated behind P2 (the shared guides pass must exist and be validated as
equivalent-or-better than demo 03's private logic) before P5 can measure the
adaptive-march variant against it.

**Packet:** P2 (guides pass + A/B lab) → P5 (adaptive-effort variant,
measured). **Do not draft prose claiming a specific speedup for this section
until P5 lands a number.**

---

## 5. The joint-bilateral upsample node

**Thesis.** SSILVB's Table 2 config (f) reports ~4× from half-res + bilateral
upsample, but no shipping three.js node implements a *joint* bilateral
upsample (low-res color guided by high-res depth/normal, Kopf et al. sense) —
only same-resolution edge-aware blurs. The bench built one as a standalone
harness pass and measured the paper's claim directly, with margin to spare.

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

**Evidence still needed:** the pass exists only inside lab 09's isolated
march (no temporal/denoise chain attached, by lab design — see README
"Lineage"). It is not yet integrated into demo 03 proper or packaged as a
general-purpose three.js-consumable node outside the bench harness.

**Packet:** measurement complete (P0/P1, lab 09, done). Integration into
demo 12's half-res chain is NEXTGEN.md Phase D (P3); packaging as a
standalone consumable node is Phase I (P5→ "Integration" phase in
NEXTGEN.md).

---

## 6. Demo 12/13 — the distilled SSGI (Phase D/O) — PENDING

**Thesis.** Combine every measured winner from §1–5 into one new
implementation — not a port, not faithful to any single source — first
unoptimized (demo 12, the control: same academic-style code as its parents,
proving it reproduces their quality against the oracle), then with
optimization families applied one at a time, each with a paired
ms/MSE/stability measurement (demo 13 variants). This is the actual
deliverable NEXTGEN.md is building toward; §1–5 are its evidence base.

**Evidence available today:**
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
- The success bar: `NEXTGEN.md` "Measures of success" section (quality ≤ best
  faithful demo's MSE, perf ≥2× at equal-or-better MSE, stability ≤
  frame-count demo 03, realism = bent-normal verification, consumability =
  zero-bench-dependency three.js node).

**Evidence still needed:** all of it — demo 12 does not exist yet as of this
packet. No code, no measurement, no comparison-vs-oracle for the combined
system.

**Packet:** P3 (demo 12 distillation) → P4 (capability adds: bent
normals/spec occlusion, two-sided thickness) → P5 (demo 13 optimization
variants, one family per measured commit) → P6 finishes the writeup when P5
stabilizes (this packet's own governing document, NEXTGEN.md, says as much).
**No prose should claim demo 12/13 results exist until P3 lands.**

---

## Style notes carried into the drafts

- Every number cites its file. Where a number spans two files (e.g. the same
  metric run twice, before/after a bug fix), both are cited.
- Negative results get the same prominence as wins — §2 and the lab-10 bug
  story in §3 are written as findings, not apologies.
- No claim in §4 or §6 is asserted as fact — both sections are explicitly
  pending and the drafts must not borrow numbers from the *intended* results.
