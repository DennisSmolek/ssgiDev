# SVGF-SPEC.md — variance-guided denoise demo (demo 14) + noise-stress harness

Status: **concept spec, pre-build.** Sits after the optimization demo
(`13-optim`) and consumes a *settled* base, not a source-faithful one (unlike
demos 00–11 under the NEXTGEN faithfulness boundary). Producer of record for
the FSR3 data it consumes: `FSR3-BRIEF.md` (esp. the SVGF addendum). Consumer
motivation: `advantagous-concepts.md` (SVGF-style variance moments). Scoring
conventions: `TESTING.md` + `bench/scripts/lib/harness.mjs`.

Ids: `13-optim` is taken. This spec defines **demo 14 (`14-svgf`)** for the
real question and **demo 15 (`15-ptref`)** for the noise-stress harness. Both
register in `bench/src/demos/index.ts` (import + `demoRegistry.register`).

---

## 1. Thesis — why this is a small build, not a port

SVGF is three stages: temporal accumulation, variance estimation, and a
variance-guided à-trous wavelet filter. Post-FSR3-decomposition, the bench
already owns two of the three:

- **Temporal front-end** — reprojection with dilated MVs + graded
  disocclusion + per-pixel history length N, produced once by
  `TemporalGuidesPass` and consumed instead of re-derived. This IS SVGF's
  front-end, and it's better than stock SVGF's (graded disocclusion, dilated
  MVs, an explicit reactive channel the paper lacks).
- **Variance primitive** — the FSR3 addendum's `MomentPyramid` pass (a
  signal-agnostic luminance moment/pyramid computation) instantiated on the GI
  irradiance gives per-pixel `Var = E[L²] − E[L]²` and the short-history
  spatial fallback. FSR3 runs the same code on its own luma; we run it on ours.

So the **only genuinely new code is the à-trous body** — a multi-pass
increasing-stride filter whose depth/normal edge stops we already have (the
existing bilaterals), plus the one term that makes it SVGF: a luminance weight
divided by √variance. Everything else is wiring existing passes.

Corollary: this demo's cost of being *wrong* is low (small new surface) and
its value is mostly **validating the FSR3 addendum's statistics primitive is
real and not cosmetic** — the addendum's own acceptance test.

---

## 2. Architecture — pass chain (demo 14)

Ordering follows demos 03/12 (temporal → spatial, already SVGF-correct), with
demodulation bracketing the whole denoise so we never filter across albedo.

```
G-buffer (beauty, albedo, normalView, velocity, depth)
  │
  ├─ TemporalGuidesPass          → dilatedVelocity, disocclusion, historyLength N,
  │                                 reactive, dilatedDepth, prevDepth  (FSR3 addendum §A)
  │
  ├─ SSGI producer march          → rawGI (rc1/sc8 fixed noisy control, per §4)
  │
  ├─ demodulate                   → irr = rawGI / max(albedo, ε)      [NEW, 1 line]
  │
  ├─ temporal + moments           → irrHist (EMA α = max(α_min, 1/N)),
  │  (extend ssrt3-guides-temporal)  moments = (E[irr], E[irr²])       [NEW: moment channels]
  │       reset moments where disocclusion≈1; α from N (guides)
  │
  ├─ variance estimate            → Var = E[irr²] − E[irr]²;           [NEW]
  │  (MomentPyramid, addendum §B)    where N < N_min: spatial 7×7 / pyramid fallback
  │
  ├─ à-trous ×K (K=3..5, stride 1,2,4,…)                               [NEW — the body]
  │     w = w_depth · w_normal · w_lum,
  │     w_lum = exp(−|l_p−l_q| / (σ_l·√(g·Var)+ε))
  │     variance filtered alongside color (variance of a filtered mean shrinks);
  │     feed first-iteration output back as next temporal history (SVGF convention)
  │
  ├─ remodulate                   → outGI = irrFiltered · albedo        [NEW, 1 line]
  │
  └─ composite / display
```

New WGSL for demo 14: `svgf-demodulate.wgsl`, `svgf-temporal-moments.wgsl`
(fork of `ssrt3-guides-temporal.wgsl` + 2 moment channels), `svgf-variance.wgsl`
(or the shared `MomentPyramid`), `svgf-atrous.wgsl` (the K-iteration filter),
`svgf-remodulate.wgsl`. Reuse verbatim: `accumulate.wgsl` (oracle),
`compare.wgsl`/`Comparator` (A/B), `blit.wgsl`, the guides passes.

Config knobs (exported via `window.__benchParams` per bench convention):
`atrousIterations` K, `sigmaLum` σ_l, `sigmaDepth`, `sigmaNormal`, `alphaMin`,
`nMinForTemporalVar`, `varianceBoostFromReactive`, `momentsSpace`
(linear-irradiance | ycocg).

---

## 3. Assumptions — gains we expect (as falsifiable hypotheses)

Each is stated with the metric that confirms/refutes it, in the bench's numeric
convention (stability = still-camera `meanAbsDiff` 0..255, lower better; MSE vs
oracle 0..1, lower better; ms = min-of-3×40 bursts). No letter grades.

| # | Hypothesis | Predicted signal | Measured by |
|---|---|---|---|
| H1 | Variance-guided radius preserves contact detail the fixed bilateral blurs | **lower MSE at C-contact specifically**, equal-or-lower elsewhere | MSE-vs-oracle per grid cell; diff-shot error localization (flat/grazing/contact/silhouette) |
| H2 | à-trous handles disocclusion better than EMA+bilateral (spatial fill where history invalid, no smear) | **faster time-to-reconverge** after orbit-stop; less visible smear | Test-matrix C protocol (orbit ~5 s, stop, stability at 0.5 s intervals) |
| H3 | Converged still-camera stability at least matches count-based accumulation | stability **≤ mathis 0.10 / xegtao 0.21** ballpark (lab 10 re-rank) | `stabilityMetric()` at each grid cell |
| H4 | Demodulated filtering removes albedo-edge halos the current pre-albedo bilateral still shows on textured surfaces | **lower error at texture boundaries** (S-column banners, Z-zoo) | diff shots at textured cells; Z-zoo artifact checklist |
| H5 | Total denoise cost stays within a small multiple of the bilateral despite K passes | à-trous ×K + moments **≤ ~2× the 1-pass bilateral ms**; half-res K-tap mitigates | fenced-burst ms per pass, default + heavy, C-wide + S-hall |

**The honest null hypothesis (H0):** on the SSGI signal, the existing
variance-*un*aware bilateral is already good enough that SVGF's win is inside
measurement noise — because the producer after temporal accumulation is
low-noise, and SVGF was built for far noisier input. H0 is *likely* on the
SSGI signal alone. That is exactly why §5 exists: to test SVGF where its value
is separable before concluding it doesn't help.

**Cheapest-real-step fallback (SVGF-lite):** if H5 fails (à-trous too costly)
but H1 holds, the fallback is: keep the single-pass bilateral, add ONLY the
√Var luminance term to it. Captures most of H1 at ~zero added bandwidth. The
spec treats SVGF-lite as a first-class arm in the A/B, not a consolation.

---

## 4. Test plan — demo 14 (the real question: does it help OUR GI?)

Matches TESTING.md's matrix exactly; reuses `bench/scripts/lib/harness.mjs`
(`meanAbsDiff`, `mse`, `stabilityMetric`, `minOfBursts`, `writeResults`,
`GRID_CAMS`). Every recorded number = (grid id, exported config JSON, commit).

**Experimental control:** identical fixed noisy producer for every arm
(rc1/sc8, jitter on) — reused verbatim from demo 03 the way demo 10 does, so
each denoiser eats the same input signal.

**Arms (A/B/C… via the `Comparator` split/diff view, texB = converged oracle):**
1. `bilateral` — current fixed-radius depth/normal bilateral (baseline).
2. `svgf-lite` — bilateral + √Var luminance term only (H1 isolation).
3. `svgf` — full demodulated temporal-moments + à-trous ×K.
4. `ssrt3-guides` — the existing guides-fed EMA+bilateral (demo 10 default) as
   the incumbent to beat.
5. `mathis` — count-based adaptive bilateral (the stability winner, lab 10).

**Grid:** C-wide, C-graze, **C-contact** (H1 primary), S-hall, **S-column**
(H4 primary), Z-zoo. Configs: as-shipped defaults + one heavy (rc4/sc32).

**Reference oracle & its caveat:** `accumulate.wgsl` CPU running-mean under a
static camera. **It converges the producer to the producer's own biased
expected value, not to true GI.** So demo 14's MSE measures "closeness to the
unbiased-denoised version of *this biased signal*" — good for ranking denoisers
against each other, useless for measuring SVGF's *absolute* bias/over-blur.
Cross-demo MSE ranking is invalid anyway (trackE caveat: each demo references a
different oracle channel). This limitation is the entire reason for §5.

**Acceptance (decision, not a grade):**
- SHIP `svgf` if it beats `ssrt3-guides` on **C-contact MSE** AND matches it
  within noise on stability (H3) AND passes H5 (≤~2× bilateral ms).
- SHIP `svgf-lite` instead if it captures ≥~70% of svgf's C-contact MSE gain at
  bilateral-level cost (H5 fails but H1 holds).
- KILL both, keep `ssrt3-guides`, if neither beats the incumbent outside
  measurement noise on any grid cell (H0 confirmed on the SSGI signal). Record
  the null result the way lab 07/LSAO negative results were recorded — a
  measured "no" is a finding.

---

## 5. Noise-stress harness — demo 15 (`15-ptref`): make SVGF's value obvious

**Why demo 14 alone under-tests SVGF.** SVGF's benefit scales with input
variance. Our SSGI producer, after temporal accumulation, is already
low-variance — so demo 14 risks concluding "SVGF ≈ bilateral" when the truth is
"our input isn't noisy enough to tell them apart." That measures our *input*,
not the *algorithm*. Two things are conflated and must be separated:

- **Does our SVGF implementation actually work?** (algorithm validation)
- **Does SVGF help the SSGI pipeline?** (the demo-14 question)

Demo 15 answers the first with a noisy input that has **unbiased ground truth**,
which demo 14 structurally cannot provide.

**Design — a limited-sample path tracer as the input, its own converged trace
as truth.** A totally separate demo (per the user's instinct), not an SSGI
march:

- A minimal WebGPU path tracer over the same scenes (cornell first — closed
  box, analytic-ish, cheap BVH; sponza later). N-spp knob, `N ∈ {1,2,4,8}`.
  Real Monte-Carlo noise: correlated, heavy-tailed, fireflies — the exact
  distribution SVGF's neighborhood clamp + variance term were built for, and
  which synthetic noise does NOT reproduce.
- **Ground truth = the same path tracer at high spp** (e.g. 1024+, progressive
  accumulate). This is *unbiased true GI*, so MSE here measures SVGF's real
  bias/over-blur — the thing demo 14's biased oracle hides.
- Run the identical demo-14 denoise chain on the PT output. Because truth is
  unbiased, we get honest answers to: how much noise can SVGF eat before it
  fails? does it over-blur (bias) as σ_l rises? where does the variance
  estimate become unreliable (low N, fireflies)?

**Metrics add convergence-equivalence:** alongside MSE/stability, report
**"spp-equivalent"** — at what raw spp does the *un*-denoised trace match the
1-spp+SVGF MSE? "1-spp SVGF ≈ 16-spp raw" is the headline SVGF result and only
this demo can produce it.

**Cheaper pre-validator (build this FIRST, ~1 day vs a real PT):**
`svgf-noiseinject` mode — take the converged reference and add controllable
variance-scaled noise (tunable σ, optional Poisson/firefly spikes) to synthesize
an "N-spp-like" input with *exact* ground truth and a clean noise knob. Idealized
(uncorrelated) noise, so it validates the implementation and the √Var math
cheaply, but does NOT stress the clamp realistically. Sequence:
1. `svgf-noiseinject` — prove the implementation + variance math on exact GT
   (fast, catches sign/space bugs in the moment pass).
2. `15-ptref` limited-spp PT — prove it on realistic correlated/firefly noise
   with unbiased GT (the headline "1-spp ≈ N-spp" result).
3. Only then trust demo 14's ranking on the (low-noise, biased-oracle) SSGI
   signal.

**Scope honesty:** a real path tracer is the biggest single build in this spec
(BVH, sampling, progressive accumulate) — far larger than the SVGF body itself.
It is justified only because it's the sole way to get unbiased GT + a noise
knob. If time-boxed, ship `svgf-noiseinject` and defer `15-ptref` — but record
that the SSGI-only verdict is under-powered without it.

---

## 6. Risks / kill criteria

- **Wrong space in the moment pass** (addendum §B trap): moments computed on
  tonemapped/display luma instead of linear irradiance → variance meaningless.
  Guard: `svgf-noiseinject` CPU-reference check `Var = E[x²]−E[x]²` in both
  linear and ycocg space *before* any denoiser consumes it (addendum §E).
- **Temporal lag / boiling** from long EMA + wide fallback → use the `reactive`
  channel to shorten α on fast GI; measure via test-matrix C motion protocol.
- **à-trous over-blur (bias)** as σ_l rises → only visible against unbiased GT,
  i.e. demo 15; if invisible there, H1's "detail preservation" is illusory.
- **H5 blows the budget** → fall back to SVGF-lite (§3) and/or half-res à-trous,
  measured against the existing half-res joint-bilateral chain (that's where the
  bandwidth budget already went — lab 09).
- **The whole thing is H0** on the SSGI signal → that's a valid measured "no";
  record it. Demo 15 still stands alone as an SVGF-validation / PT-denoise
  artifact independent of the SSGI verdict.

---

## 7. File / registration plan

```
bench/src/demos/14-svgf/
  index.ts                     # DemoDef { id:'14-svgf', label, create }; ?scene=, sceneDefaults()
  svgf-demodulate.wgsl
  svgf-temporal-moments.wgsl   # fork ssrt3-guides-temporal.wgsl + moment channels
  svgf-variance.wgsl           # or import shared MomentPyramid (FSR3 addendum §B)
  svgf-atrous.wgsl             # the K-iteration variance-guided filter (only truly new pass)
  svgf-remodulate.wgsl
  README.md
  # reuse: accumulate.wgsl, compare.wgsl/Comparator, blit.wgsl, TemporalGuidesPass

bench/src/demos/15-ptref/      # noise-stress harness (stage 2; svgf-noiseinject mode ships in 14 first)
  index.ts
  pathtrace.wgsl               # minimal PT; N-spp knob + progressive hi-spp GT
  README.md

bench/src/demos/index.ts       # +2 imports, +2 demoRegistry.register — per demo
bench/scripts/lib/harness.mjs  # add 14-svgf/15-ptref to DEMO_IDS; new runner uses existing metrics
```

Runner: new `bench/scripts/*-svgf.mjs` importing `GRID_CAMS`, `meanAbsDiff`,
`mse`, `stabilityMetric`, `minOfBursts`, `writeResults` — no new scoring code.

---

## 8. Open questions (decide before build)

1. **Moments in luminance or full RGB?** SVGF tracks scalar luminance variance
   (cheaper, 2 channels). RGB variance (6 channels) preserves chroma denoise
   fidelity. Default: scalar luminance in YCoCg-Y; revisit if chroma noise
   survives.
2. **Feed à-trous first-iteration output back as history** (SVGF convention,
   tighter feedback) vs feed the raw temporal result — the former can over-
   stabilize. A/B it.
3. **Half-res à-trous from the start**, or full-res first then measure the
   half-res tax against lab 09's chain? Default: full-res for the clean H1/H5
   read, half-res as a follow-up arm.
4. **`15-ptref` scope** — real PT now, or ship `svgf-noiseinject` and time-box
   the PT? Recommendation: noiseinject in demo 14 first (cheap, validates math),
   real PT only if the algorithm survives noiseinject and demo 14 is ambiguous.
