# ROADMAP — SSGI program plan

Canonical plan doc as of **2026-07-24**. Supersedes the plan fragments
scattered across WORKLOG.md, the milestone briefs, and session todos; those
stay as records, this is where "what's next" lives. Update this file when a
phase closes or a decision lands.

## Where we are

**The noise program is OPEN, not solved.** We are still resolving critical
issues through the demo chain (12 → 13 → 18); nothing below treats them as
done. The recorded battery at `4118871` settled M6 and the SVGF cost/
stability comparison, but Dennis's human-eye defect sweep then showed the
metrics had missed the structural problem: **the shipped accumulator is a
capped EMA and mathematically cannot converge** — every downstream demo
inherits that noise floor, which is why no tuning ever made the noise go
away. Demo 18 (`67e924c`) is the **candidate** fix: α = 1/N accumulation +
sub-pixel jitter AA converges in the churn metric (0.447 → 0.242 and
falling vs the capped control flat at 0.58) — but the same metrics also
called earlier states "fine," so it is not considered resolved until it
passes eyes.

Still open, critical:

- demo 18 human validation (does it *look* converged, not just measure it)
- residual noise under motion / young history — everywhere, all stacks
  (spatialFallback is a first attempt, not a verdict)
- ign-vs-bluenoise sampling default (banding vs floor trade, eye call)
- demo 16 / FSR upscale-path non-convergence (external, under their
  investigation — Report 3 + addendum)
- SVGF motion boil; aliasing in every demo except 18's jitter arms
- lab-11 sampling ranking is suspect (measured under the broken IGN
  temporal advance) — re-rank pending

**Dependency direction, stated once:** the accumulator sits UPSTREAM of
everything (denoisers, guides, upscaler, display). No later phase could
have fixed its floor — SVGF filters the floor, FSR upscales the floor, the
display dithers the floor. The demo 12/13/18 detail work was the root fix,
not a detour. The only things genuinely parked "for a later step" are the
three items in P3/P4 below, each blocked on an external input (their FSR
fix, quiet GPU, Dennis's verdicts) — none of them solves anything being
worked now.

## P0 — Dennis's eye passes (now; blocks P1)

Decisions only human eyes can make, per the human-over-metrics protocol:

1. **Demo 18 verdict** — steps: `HUMAN-TESTS.md` Experiment F. Partial
   (2026-07-24 verbal): still camera CLEAN ("looks amazing"); rotation
   GHOSTS severely with persistent artifacts — the unclamped-1/N stale-
   shading trade, which makes the F4 jitterClamp A/B and the
   variance-clipping experiment (EXPERIMENTS.md A1) the deciding items.
   **Graduation cannot be bare oneOverN** — ship needs a motion-adaptive
   history rectifier on top.
2. **Noise default** — ign vs bluenoise in demo 12 (flip = recorded
   distillation decision + re-baseline).
3. **Demo 10 `guidesHistoryCap` dead-knob check** (pre-registered
   prediction: no visible change) and demo 13 freeze-noise check.
4. Re-look at demo 14 dark areas post display-dither port.

Record in `bench/results/human/HUMAN-RESULTS.md`.

## P1 — Graduation (after P0 confirms)

- Port the winning demo-18 arm into the ship track: α = 1/N + disocclusion
  reset, sub-pixel jitter AA, spatial fallback for young history, bluenoise
  sampling. Needs a **proper beauty resolve** (known 1–2 px silhouette
  fringe under sustained motion is acceptable in the lab, not in ship).
- Ship-track home: new demo (12 stays the frozen control) — likely
  `19-ship`; naming decided at build time.
- Port bluenoise mode to demo 13's fork if the default flips.
- Revisit the SVGF default-stack verdict: SVGF's stability win was measured
  against the floored incumbent; re-judge against a converging accumulator
  (SVGF likely remains the motion/young-history champion, loses the
  still-camera case).

## P2 — Consolidated quiet-GPU re-record

One battery, coordinated with Dennis being off the GPU:

- run-14 post-jitter-fix absolutes (current lab14 numbers are upper bounds)
- demo 12/13 rows under display dither + fixed IGN advance (+ noise default
  if flipped)
- lab-11 sampling re-rank under the fixed temporal advance (its "IGN best"
  verdict was measured with the broken advance)
- lab18 clean absolutes (+ demo 19 rows if P1 has landed)

## P3 — FSR track (external dependency)

- **Handoff doc: `GUIDES-HANDOFF-RESPONSE.md`** — Report 3 + its 2026-07-24
  addendum (converging counter-example + the two jitter-compensation
  mechanisms their bug likely misses). That file is the complete package to
  give the FSR model.
- Blocked on their fix: FSR3-BRIEF Req 2 upscale+AA acceptance; jitterAA
  default-on; SVGF + upscaler premium pairing (renders GI at reduced res to
  claw back the K=4 cost — the answer to demo 14's fps).
- NOT blocked: guides API (M6 PASSED, drop-`@experimental` verdict stands).

## P4 — Research arms (optional, Dennis's call)

- **TAA literature: DELIVERED** (2026-07-24, `research/sources/temporal/`,
  11 topics, summary in its `HANDOFF.md`). Mapped to concrete bench
  experiments in **`EXPERIMENTS.md`** (the experiment catalog — variance
  clipping, jitter-aware disocclusion, STBN measurement, A-SVGF, velocity
  dilation, firefly guard, stress scenes, OIDN settle pass, and the
  us-vs-FSR3 work split). FSR-relevant extracts (topics 02/05/08, verbatim
  FSR2 source) pointed to from `GUIDES-HANDOFF-RESPONSE.md` for their
  Report-3 hunt.
- **15-ptref**: unbiased PT ground truth — the only way to break the SVGF
  MSE tie and get a real quality ranking.
- **Tiny-neural spatial denoiser** (ref: N8AO NeuralDenoise.js — 512-weight
  int8 attention net over 4–16 taps, shader-codegenned, AO-only): assessed
  as a possible *spatial fallback / young-history* filter, not a SVGF
  replacement. Pretrained weights are off-distribution for our RGB GI and
  the training pipeline is not published, so this is a
  port-and-retrain-for-AO-channel experiment at best. Park behind P1/P2.

## Standing rules

- Demos 00–13 are frozen instruments; changes land as new demos or recorded
  re-baselines, never silent edits.
- Human observation contradicting a metric triggers metric review, not
  dismissal; human rows win for UX decisions.
- Recorded batteries run serial-only on a quiet GPU.
