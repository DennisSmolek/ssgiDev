# EXPERIMENTS — temporal research → bench experiments

Written 2026-07-24, after the temporal research pass landed in
`research/sources/temporal/` (summary: `research/sources/temporal/HANDOFF.md`).
This maps each research finding to a concrete bench experiment: where it
lives, what gets built, the pre-registered hypothesis, and how it's judged.
Everything here is a **candidate** until it passes eyes (standing rule);
hypotheses are written down before building so the metrics can't be graded
on a curve afterward.

Companion to `ROADMAP.md` (phases/ordering live there; this is the
experiment catalog). FSR-boundary analysis at the bottom decides which of
these belong to us vs the FSR3 library team.

**Bench discipline (Dennis, 2026-07-24): one question per demo.** No
super-benches accumulating features and tests. Each experiment below gets
its **own demo, forked from the simplest relevant parent**, answering one
question; when answered, it freezes and keeps its history/thread. Demo 18
stays as-built (accumulation-mode question) — new arms below do NOT get
piled into it. Demo numbers are assigned at build time; "home" below names
the parent to fork.

---

## Track A — temporal mechanics (each its own fork of demo 18's skeleton)

### A1. Variance clipping (research 01) — PRIORITY 1

- **Home:** own demo, forked from 18 stripped to two arms (`oneOverN` vs
  `varianceClip`).
- **Build:** 3×3 moments in YCoCg
  (`μ = m1/9`, `σ = sqrt(max(m2/9 − μ², 0))` — the `max(,0)` is a hard NaN
  guard, a NaN poisons the accumulator forever), box `μ ± 1.0·σ` clamped
  against the raw min/max box (Salvi), history **clamp-then-clip-toward-
  center** (Playdead `clip_aabb`), chroma extent shrunk to ¼ luma
  (Playdead `USE_YCOCG`). Reference implementation to crib: **Bevy
  `taa.wgsl`** (~200 lines, WGSL, MIT — covers 01+04+06 in one file).
- **Hypothesis (pre-registered):** flat floor well below `jitterClamp`'s
  1.28 — the σ-box is far tighter than min/max against MC noise — but
  still a floor above `oneOverN`'s converging curve, because any
  rectification against a noisy current frame bounds convergence. Expected
  landing zone: between capped (0.58) and jitterClamp (1.28), likely below
  capped.
- **Judge:** lab18 battery churn curves (still + teleport recovery), then
  eyes: does it ghost less than `oneOverN` on the teleport while staying
  visually stable on stills.
- **Why it matters:** if the floor is visually clean, this becomes the
  *motion-robust* arm — the missing middle between "unclamped 1/N
  (converges, ghost-prone)" and "hard clamp (never converges)".

### A2. Jitter-aware disocclusion (research 02) — PRIORITY 1

- **Home:** own demo, forked from 18's `oneOverN+jitter` arm only.
- **Build:** replace the ad-hoc widened world-delta threshold (0.35)
  with SVGF's gradient-scaled depth weight:
  `w_z = exp(−|z(p)−z(q)| / (σ_z·|∇z(p)·(p−q)| + ε))`, σ_z ≈ 1, ∇z via
  finite differences in compute. Optionally a second arm with FSR2's
  view-space required-separation test (`Ksep = 1.37e-05`, FOV-compensated)
  for comparison.
- **Hypothesis:** same convergence as current still-path hack but without
  the special-cased "accept same-texel history unconditionally" branch —
  i.e. one principled test replaces two ad-hoc ones, and teleport recovery
  is unchanged (no rolling AccumulationAge regression).
- **Judge:** lab18 curves + the demo-14-style rolling-accumAge check; eyes
  on silhouettes under slow orbit.

### A3. Catmull-Rom history resampling (research 04) — PRIORITY 2

- **Home:** folds into A1's demo if built together (both are history-fetch
  concerns), else its own fork.
- **Build:** toggle on the history fetch: 5-tap corner-skipped Catmull-Rom
  (MJP weights `w0..w3`, `w12`, `offset12`; Bevy has the WGSL). Needs a
  linear sampler for history taps, nearest for everything else.
- **Hypothesis:** invisible on stills (still path is same-texel), visible
  as sharpness retention under sustained sub-pixel motion at large N —
  recursive bilinear blur compounds regardless of blend rate.
- **Judge:** needs a sharpness probe, not churn: edge-gradient magnitude at
  frame ~600 vs frame ~10 under continuous slow orbit, plus eyes.
- **Caveat:** negative lobes ring on HDR edges — only run combined with A1
  (clipping) and A4 (tonemapped blend).

### A4. Firefly-safe unclamped accumulation (research 06) — PRIORITY 2, graduation prerequisite

- **Build:** producer-side max-luminance pre-clamp
  (`color = min(color, maxLum)` before the accumulator) + accumulate in
  Karis/Lottes reversible-tonemap space (`c/(max3(c)+1)`, invert on
  resolve). This is what protects `oneOverN`'s deliberately unclamped
  history from a single 1000× firefly frame.
- **Hypothesis:** no measurable churn change on current scenes (they're
  firefly-poor); the win is robustness, provable with a synthetic emissive
  spike scene (one frame of a small bright emitter).
- **Judge:** synthetic firefly scene — with guard: bounded blip that decays
  as 1/N; without: persistent bright splotch. This must pass before
  `oneOverN` graduates to ship (P1).

## Track B — producer / sampling

### B1. STBN measurement (research 03) — PRIORITY 1, cheap

- **Build:** grab NVIDIA-RTX/STBN pregenerated textures
  (`Assets/STBN.zip`, 128×128×64), load as `texture_2d_array`, sample
  **`textureLoad` nearest only** (linear filtering destroys the spectrum),
  `layer = frame % 64`. **Home:** own demo — a small lab-11-successor
  battery forked from 12's producer path: independent-BN vs our
  golden-ratio tile cycle vs true STBN. (Not a demo-18 arm — one question
  per demo.)
- **Hypothesis:** deliberately none on magnitude — the literature is
  qualitative ("substantially faster"), and the research pass explicitly
  flags: **do not cite a convergence multiplier, measure it**. Direction:
  STBN ≤ golden-ratio cycle ≤ independent, under both 1/N and EMA.
- **Judge:** RMSE-vs-frame curves vs a long-run converged reference, both
  accumulation modes. If STBN wins measurably at low N, it's a drop-in
  producer upgrade for **every** stack (12/13/14/18/ship) — highest
  leverage-per-effort experiment on this list.

## Track C — SVGF lab (demo 14 arm)

### C1. A-SVGF gradient-driven α (research 07) — PRIORITY 2, bigger build

- **Build:** sparse temporal gradient: one sample per 3×3 tile,
  forward-project last frame's surface, **re-shade with last frame's RNG
  seeds** (ping-pong seed buffer), gradient
  `λ = |Φ_curr − Φ_prev| / max(Φ_curr, Φ_prev, ε)`, densify λ with a small
  edge-aware blur, drive α: high λ → drop history fast, low λ → α → 1/N.
  Reference: Q2RTX `asvgf_gradient_img.comp` / `asvgf_temporal.comp`
  (GLSL; confirm the 3×3 stratification constant there — it's the paper's
  example, not gospel). WGSL risks: the forward-projection scatter needs a
  storage-buffer/atomics pass, and RNG replay needs deterministic seeds.
- **Hypothesis:** replaces `detectShadingChanges`-style heuristics with a
  *measured* signal — distinguishes "camera still, light moved" (α must
  rise) from "everything static" (α → 1/N). This is the answer to the
  whole 1/N story's static-lighting assumption.
- **Judge:** new dynamic-light test scene (moving emitter, static camera):
  staleness lag vs boil trade, plus stills must not regress.
- **Note:** ~2 ms at 1080p in Q2RTX; budget-check on WebGPU.

## Track D — graduation / ship (demo 19, after P0 eyes)

### D1. Velocity dilation for the beauty resolve (research 05) — graduation prerequisite

- **Build:** 3×3 closest-depth select: dilated depth + dilated MV (fetch
  motion from the nearest-to-camera neighbor), used by beauty reprojection.
  This is the standard fix for demo 18's known 1–2 px silhouette fringe
  under sustained motion. The full FSR2 version adds atomic forward
  reprojection of depth (`atomicMax` on `bitcast<u32>` depth in a storage
  buffer — WebGPU can't atomically write textures); start with the 3×3
  select alone and only add the atomic pass if silhouettes still fringe.
- **Judge:** eyes on silhouettes under sustained orbit; the fringe is a
  known flagged flaw, so before/after screenshots suffice.

### D2. Ship-track composition (P1 as planned)

α=1/N + jitter + winning disocclusion test (A2) + firefly guard (A4) +
dilated velocity (D1) + winning noise mode (B1/eye call) → `19-ship`.
Nothing new here; listed so the graduation build's parts trace back to
their experiments.

## Track E — measurement infrastructure (feeds P2 battery)

### E1. Stress scenes + temporal RMSE (research 10) — PRIORITY 2

- **Build:** three procedural stress scenes: (a) pendulum/oscillating
  high-contrast quad (ghosting), (b) translating camera with foreground
  occluders (disocclusion sweep), (c) thin-line/fence grid (flicker,
  locks). Per-frame temporal RMSE vs a 16–64× supersampled reference as a
  real-time compute pass; FLIP/FVVDP scoring offline from dumped frames.
- **Why:** our churn metric measures frame-to-frame diff, which the
  research pass confirms is only the *static* regime; these scenes cover
  the regimes where rectification deliberately drops history. Also makes
  our numbers externally comparable (Yang 2020 survey methodology).

### E2. Perceptual gating of churn (research 09) — PRIORITY 3, offline

- **Build:** offline elaTCSF/stelaCSF scoring of dumped frame sequences —
  per-region "is this flicker visible" weighted by luminance/spatial
  frequency/eccentricity. No universal scalar exists; the flat low-freq
  regions (large diffuse GI — exactly our content) are where temporal
  sensitivity peaks.
- **Why:** the long-game answer to the metric-vs-eye gap that started this
  program: a churn number that *predicts* Dennis's verdicts. Don't build
  until E1 exists to feed it.

## Track F — settle-time denoiser (research 11)

### F1. Single U-Net settle pass — PRIORITY 3, testbench candidate

- **Correction from Dennis (2026-07-24, supersedes research topic 11's
  read):** the current state of the art here is **pmndrs/denoiser** (his
  work, vastly improved from the personal DennisSmolek/Denoiser repo the
  research cited). Two caveats from him: it tends to prefer **fully
  path-traced input** (our SSGI single-bounce output is off its expected
  distribution), and even at best speed it takes **multiple ms for
  moderate quality** — so per-frame is out, and even settle-pass quality
  on SSGI input is an open question, not an assumption.
- **Build (per Dennis: "worth building a testbench for"):** own small
  demo: detect settle → run one U-Net pass (albedo+normal guided) on the
  accumulated-but-young frame → display while 1/N converges beneath →
  fade back. First question the testbench must answer: does the net do
  anything useful on SSGI-distribution input at all.
- **Judge:** eyes — does the stop-moment transition read as "snaps clean"
  or as a visible filter pop / hallucinated detail.
- The 512-weight N8AO-style micro-net stays parked (P4): research verdict
  is that small-neural has lower ROI than SVGF/A-SVGF/OIDN on a
  no-tensor-core target until WebGPU ships cooperative-matrix.

---

## Where the work lies: us vs the FSR3 library

The research settles the architecture question (topic 11's verdict, and
the reason "just use FSR as the TRAA" isn't the whole answer):

- **TAA rectification assumes mostly-clean aliased input.** FSR2/3's clamp
  box is built from the *current-frame* 3×3 neighborhood — against
  Monte-Carlo-noisy SSGI input that box is noise-wide, so it both admits
  noise and (when tightened by motion/disocclusion) blocks convergence.
  This is the same phenomenon as demo 18's jitterClamp floor, measured.
  An upscaler cannot be the noise-killer; the noise must die upstream.
- **The recommended spine is: producer variance reduction → cheap
  variance-guided denoise (SVGF/A-SVGF) → temporal upscaler accumulation
  (FSR3) for AA + upscale + motion robustness.** The closest public analog
  of this exact stack is C-none/Web-RTRT (WGSL: ReSTIR → SVGF/RELAX →
  FSR2).

So the split:

| Ours (bench) | Theirs (FSR3 lib) |
|---|---|
| A1 variance clipping, A2 disocclusion, A3 resampling, A4 firefly, B1 STBN, C1 A-SVGF, D1 dilation, E1/E2 metrics, F1 settle | Their depth/rectification internals — Report-3 residue included |

Status update (2026-07-24, from reading their repo directly + our probe):

1. **Their Report-3 fix landed** (fsr3 `a9d9bcf`, "max-vote" disocclusion
   aggregation; their side marks it CONFIRMED/RESOLVED). Our consumer
   re-probe of demo 16 partially confirms: interval lows dropped to
   0.13–0.15 (below the old 0.19–0.76 band), but **recurring whole-image
   spikes ~0.66–1.29 remain on a still camera** at both ratio 2 and
   NativeAA, against a clean demo-18 control. Top suspect: unpinned
   auto-exposure (their default `autoExposure: true`). Findings + curves
   recorded in `GUIDES-HANDOFF-RESPONSE.md`. **Demo 16 non-convergence
   stays on the open-issues list** until the spikes are explained.
2. **The FSR2 research extracts are cross-reference, not a lead** —
   their model works from the full FSR research base, and their fused
   gather-instead-of-atomic-scatter depth path is a documented perf trade
   (their `PARITY.md` §1: +30%/+22% saved) with explicit jitter-delta
   compensation. Withdrawn as a debugging lead in the handoff doc.
3. **We keep building our own accumulator** (demo 18 line) even though FSR
   overlaps it: ours is the no-upscale/still-camera champion (true 1/N
   convergence, which rectifying accumulators structurally can't do), and
   it's the testbed for A1–A4. Re-judge "our accumulator vs their
   NativeAA as the ship TAA" on E1 stress scenes once their still-camera
   spikes are resolved.

## Suggested order

1. **B1 STBN** (cheapest, upgrades every stack) and **A1 variance
   clipping** (the named successor arm) — separate forked demos, can share
   one quiet-GPU battery.
2. **A2 disocclusion** (principled test replaces two hacks; also
   cross-checks the FSR defect theory from our side).
3. **A4 + D1** as P1 graduation prerequisites once P0 eyes confirm.
4. **E1 stress scenes** before the P2 re-record so the new battery covers
   motion regimes, not just stills.
5. **C1 A-SVGF** as the next demo-14 arm; **A3, E2, F1** opportunistic.
