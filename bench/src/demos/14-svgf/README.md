# Demo 14 — SVGF lab

Pinned to **three@0.185.1**. Same one-fixed-noisy-producer-feeds-pluggable-arms
shape as `10-denoise`, extended per `SVGF-SPEC.md`: this lab tests whether a
variance-guided à-trous filter (SVGF) beats the existing bilateral/EMA
denoisers on this bench's SSGI signal, using the shared `TemporalGuidesPass`
(temporal front-end) and the FSR3 `MomentsPass` (variance statistics
primitive) as its two building blocks — per the spec's thesis, the ONLY
genuinely new code here is the à-trous body (`svgf-atrous.wgsl`); everything
else is wiring.

## Producer (the control)

Identical to demo 10: demo 03's SSRT3 march (`../03-ssrt3/ssrt-main.wgsl`,
reused verbatim) at rc1/sc8, jitter on, VBAO bitmask + GI gather on, fallback
off, no multibounce. Packed `rgba16float` (`rgb` = indirect radiance, `a` =
AO).

## Arms (`?stack=`)

| id | what | source |
|---|---|---|
| `bilateral` | spatial-only fixed-radius depth/normal bilateral, NO temporal — the honest baseline SVGF-SPEC §4 arm 1 asks for | `../03-ssrt3/ssrt-denoise.wgsl` live import, applied directly to the raw (or noiseinject) producer output |
| `svgf-lite` | the SVGF front-end (temporal+moments+variance) feeding a SINGLE à-trous pass (K forced to 1) — SVGF-SPEC §3's "keep the bilateral, add only the √Var luminance term" fallback, implemented via the shared à-trous kernel at one iteration rather than a separate shader | `svgf-demodulate` → `svgf-temporal-moments` → `svgf-variance` → `svgf-atrous`×1 → `svgf-remodulate` |
| `svgf` | the full chain: demodulate → temporal+moments → variance → à-trous ×K → remodulate | same pipeline, `atrousIterations` K (default 4) |
| `ssrt3-guides` | demo 10's incumbent, cloned wholesale (guides-fed EMA temporal + bilateral) — the arm to beat | `../10-denoise/ssrt3-guides-temporal.wgsl` + `../03-ssrt3/ssrt-denoise.wgsl`, same `TemporalGuidesPass` |
| `mathis` | count-based accumulation + adaptive bilateral (lab 10's stability winner) | `../10-denoise/denoise-mathis.wgsl`, cloned wholesale |

`svgf` and `svgf-lite` share ALL state (demodulate/temporal-moments/variance/
feedback buffers) — they are the same front end at different à-trous depth,
so switching between them mid-session still resets cleanly (both are in the
stack-switch reset).

## The svgf/svgf-lite pipeline (SVGF-SPEC §2)

```
rawInput (rgb=GI, a=AO; live producer OR noiseinject signal)
  │
  ├─ svgf-demodulate.wgsl      → irr = rawGI / max(albedo, demodEpsilon), ao passthrough
  │
  ├─ svgf-temporal-moments.wgsl → EMA-resolved (irr, ao) + (E[lum], E[lum²])
  │    alpha = max(alphaMin, 1/N)   (N = guides.historyLengthTexture — SVGF-SPEC
  │                                  item 5: consumed directly, unlike demo 10's
  │                                  fixed-temporalResponse ema fork)
  │    history invalid (off-screen OR disocclusion >= historyRejectThresh)
  │      => alpha=1, moments reset to the current single-sample estimate
  │
  ├─ MomentsPass.dispatch({source: irr})   (@pmndrs/upscaler, addendum §B)
  │    → coarseMoments (4×4 block means) — the short-history spatial fallback
  │
  ├─ svgf-variance.wgsl        → Var = E[lum²] - E[lum]², smoothly blended
  │                               toward the coarse spatial estimate as
  │                               N → 0 (see file header: a ramp over
  │                               [0, nMinForTemporalVar], not a hard branch —
  │                               documented deviation from the spec's literal
  │                               if/else, avoids a visible pop at N==nMin)
  │
  ├─ svgf-atrous.wgsl ×K        → w = w_depth·w_normal·w_lum,
  │    (K=1 for svgf-lite)         w_lum = exp(-|lp-lq| / (sigmaLum·sqrt(g·Var)+eps))
  │                                variance filtered alongside colour
  │                                (newVar = Σw²·varTap / (Σw)²)
  │                                iteration-0 output captured for next-frame
  │                                history feedback (atrousFeedback knob, §8.2)
  │
  └─ svgf-remodulate.wgsl      → outGI = irrFiltered · albedo, ao passthrough
```

## noiseinject mode (SVGF-SPEC §5 pre-validator)

`?noiseinject=1` (or the tweakpane toggle). Instead of feeding the live noisy
producer to the active arm, `svgf-noiseinject.wgsl` takes the **converged
reference** (`accumulate.wgsl`'s running mean of the SAME producer — always
computed, every frame, regardless of this toggle) and adds controllable
variance-scaled Gaussian noise (`noiseSigma`, stddev ∝ √luminance — the shape
Monte-Carlo estimator noise has) plus optional firefly spikes (`fireflyRate`).
A fresh per-pixel-per-frame hash draw, not a spatially-fixed dither, so
temporal accumulation sees genuinely uncorrelated noise.

This gives **exact ground truth** (the reference itself, known before noise is
added) — cheap validation of the implementation and the √Var math, before any
real path-tracer noise-stress harness. Idealized/uncorrelated noise only: it
does NOT reproduce real Monte-Carlo correlated/firefly noise, which is exactly
why `15-ptref` (SVGF-SPEC §5, a limited-spp path tracer with its own converged
trace as truth) remains spec'd but **deferred** — this demo ships only the
pre-validator, per the SVGF-SPEC §8 recommendation (decision 4) and the task
scope for this build.

**Caveat inherited from the reference itself:** `accumulate.wgsl` only
converges under a still camera (it resets on any camera move). Give it a few
seconds after the camera stops before trusting noiseinject's "exact ground
truth" framing — the same caveat demo 10's `reference` view carries.

## View modes (`?view=`)

`combined` (beauty·AO + albedo·GI) · `gi` · `raw-gi` (whichever texture is
actually feeding the active arm — the live producer, or the noiseinject
signal when that toggle is on) · `variance` (√Var, amplified by `varianceAmp`)
· `moments` (R = E[irr luma], G = √Var amplified, B = historyLength/64 — a
three-way debug pack, same convention as demo 10's `guides` view) · `reference`
· `split` / `diff` (active arm vs the converged reference, draggable divider
in `split`).

`variance`/`moments` run the svgf front-end live even when a non-svgf arm is
selected (lazy-run, like `TemporalGuidesPass` elsewhere in this bench), so you
can eyeball variance while comparing `bilateral` or `mathis`.

## Config knobs

Per SVGF-SPEC §2: `atrousIterations` K (default 4, svgf arm only — svgf-lite
hardcodes K=1), `sigmaLum`, `sigmaDepth`, `sigmaNormal`, `alphaMin`,
`nMinForTemporalVar`, `varianceBoostFromReactive`, `momentsSpace`
(linear|ycocg, default ycocg), `atrousFeedback` (§8.2 A/B), plus this build's
`demodEpsilon`, `historyRejectThresh`, and the noiseinject group
(`noiseInject`, `noiseSigma`, `fireflyRate`).

**`varianceBoostFromReactive`** is wired live through
`TemporalGuidesPass.reactiveTexture` (a real texture read + multiply in
`svgf-variance.wgsl`, not a stub) — but nothing in this demo currently WRITES
into `guides.reactive` (SVGF is a reactive *producer* too per FSR3-BRIEF
addendum §D; that write-back loop is out of scope here), so in practice the
mask reads 0 everywhere and the knob has no visible effect today. It activates
for free the moment any consumer starts writing `guides.reactive`.

## §8 open-question defaults taken (this build)

1. **Moments space:** scalar YCoCg-Y (spec default), knob-switchable to linear.
2. **History feedback:** defaults ON (`atrousFeedback = true`, the paper
   convention — GUIDES-SPEC-RESPONSE's recommendation), A/B-able live.
3. **À-trous resolution:** full-res (spec default for the clean H1/H5 read;
   half-res is a follow-up arm, not built here).
4. **`15-ptref` scope:** noiseinject ships in this demo; the path tracer is
   deferred (spec's own recommendation — "noiseinject first; the PT only if
   demo 14 is ambiguous").

## Spec deviations (documented in-file, summarized here)

- **Variance spatial-fallback blend is a ramp, not a branch.** SVGF-SPEC §2
  reads as "where N < nMin use spatial fallback" (implying a hard switch);
  `svgf-variance.wgsl` instead linearly ramps temporal-vs-spatial weight over
  `[0, nMinForTemporalVar]` to avoid a visible pop at the N==nMin boundary as
  pixels cross it frame to frame. Same qualitative behaviour at the endpoints.
- **à-trous variance prefilter (`g` in the weight formula)** uses a 3×3 box
  (not the paper's more elaborate scheme) for stabilizing `sqrt(Var)` before
  it divides the luminance weight — a documented simplification at bench
  scale, not a fidelity claim.
- **`svgf-temporal-moments.wgsl` is NOT byte-identical to
  `ssrt3-guides-temporal.wgsl`** despite being described as a "fork" in
  SVGF-SPEC §7 — the blend rule genuinely differs (N-driven `alpha =
  max(alphaMin, 1/N)` vs the ema fork's fixed-`temporalResponse`/disocclusion
  mix), per the task brief's explicit instruction to consume `historyLength`
  directly, unlike demo 10. Same disocclusion source, same neighbourhood
  clamp shape, different consumption rule downstream — documented at the top
  of the file.

## Verification status

Functional smoke-tested headed (own dev server, port 5201) — all five arms
render lit GI, `variance` view shows real spatial structure, noiseinject
visibly stresses `bilateral` while `svgf` cleans it up. See WORKLOG.md
(2026-07-22 entry) for the smoke observations and variance sanity numbers.

**No recorded H0–H5 numbers in this build.** TESTING.md's grid/stability
protocol applies unchanged (`bench/scripts/run-14.mjs` clones `run-10.mjs`'s
shape for when a quiet-GPU window is available), but this build's GPU was in
active use by other work — running it now would produce contaminated
numbers per this bench's own methodology (`harness.mjs`: "GPU results are
meaningless under contention"). The runner is shipped and functional but not
executed for recorded numbers here.
