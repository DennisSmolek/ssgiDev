# The Demo Population — Lineage, Trials, and Grounds for Comparison

Why each demo exists, where its code actually comes from, what went wrong on the way in, and
what it's *for* when comparing. Detail lives in each demo's README; this is the map.

The central fact of the bench: demos 03, 04/05, and 06 are **three independent implementations
of the same paper** (Therrien et al., "Screen Space Indirect Lighting with Visibility Bitmask",
arXiv 2301.11376) that share no code. Where they agree, that's the paper's true behavior; where
they diverge, each divergence is a ready-made experiment. Demo 01 is what actually ships in
three.js today, and demo 02 is the oracle everything is measured against.

---

## 00 — G-buffer inspector
- **Lineage:** none (bench infrastructure, M0).
- **What:** scene → MRT G-buffer (beauty/albedo/view-space normal/depth/velocity) with view modes.
- **Trial that mattered:** the raw-pass interop smoke test — a handwritten WGSL pass reading
  three's depth `GPUTexture` and writing a three-allocated target consumed by the node graph.
  Proved the architecture every later raw pass relies on. `rawDepth` is pixel-equivalent to the
  TSL `depthLinear`.
- **Compare with it:** don't — use it to sanity-check G-buffer conventions when a port looks wrong.
- **Known wart:** one wasted beauty blit per frame (polish queue).

## 01 — Stock three.js (SSGINode + SSR + GTAO control)
- **Lineage:** paper → SSRT3 (Therrien's Unity HDRP reference) → **Mugen87's TSL port**
  (three PR #31839, Sept 2025). Explicitly a baseline: Mugen87 on the PR — "the current
  implementation is a first step… no reason why we should not switch to a different and better
  implementation."
- **History/trials (inherited, not ours):** issue #29668 (Oct 2024) is a months-long debugging
  saga — zalo, cybereality, Salm, and Therrien himself chasing the PI-vs-PI2 slice-rotation bug,
  bitfield corruption (fixed in #31873), UV-origin/handedness confusion, and the GI compositing
  fix (must modulate by albedo). That thread's bug history became our port trap-list.
- **What it deliberately lacks** (why the rest of this bench exists): no §3.2 probe fallback —
  GI dies when light leaves screen; no multibounce; no mip/normal-approx bandwidth opts; no
  resolution scale; denoising is bring-your-own; hardcoded firefly clamp. Our only change: SSRNode
  added to the chain (toggleable).
- **Compare with it as:** the floor. What a three.js user gets today with zero custom work.

## 02 — Brute-force reference marcher
- **Lineage:** Salm's own ground-truth oracle — the reference ray-marcher inside XXGSDd,
  adapted from his toy scene to our real G-buffer. Cosine sampling via
  `normalize(uniformSphere + N)`, finite-slab thickness (`surfZ < rayZ < surfZ + t`),
  view-space march, miss = sky.
- **Why it's the right truth:** it consumes the *same* G-buffer as every demo, so differences
  against it are pure algorithm error — not screen-space's inherent blindness. Converges by
  ~512 accumulated frames. Absolute truth (Blender Cycles stills) is deferred to the benchmark
  pass; camera bookmarks are exported for it.
- **Trials:** two traps found during bring-up now in the WORKLOG: WGSL operator-precedence
  parens, and float32 camera-pose quantization silently resetting accumulation every frame.
- **Compare with it as:** the oracle. Every "converged vs reference" split/diff runs through this.
- **Caveat:** single-bounce, unbiased. Multibounce demos (03f, 06) *should* read brighter.

## 03 — SSRT3-complete (WebGPU compute port)
- **Lineage:** Therrien's **SSRT3** (cdrinmatane, Unity HDRP) — the paper's reference
  implementation, i.e. the thing demo 01's port simplified. This demo restores everything the
  TSL port dropped, in raw WGSL compute, staged and validated a→g.
- **What was restored:** the **§3.2 probe fallback** (the headline — ceiling corners hold a
  directional ambient floor instead of going black), multibounce GI + analytic multibounce AO
  (damped, plateaus), depth-mip pyramid + normal-from-position (measured: 15.6 → 8.2 ms, −47%,
  on Sponza), its temporal reprojection + bilateral denoiser, all 23 tunables.
- **Trials/decisions:** fallback ambient source is an equirect radiance texture, not three's
  cube-uv PMREM (atlas impractical to sample from raw WGSL); temporal uses current-depth as
  prev-depth proxy; and lab 10 later discovered its **jitter is frame-static** (`rand(uv)` never
  advances) — top of the polish queue. Did NOT reimport SSRT3's stepRadius double-divide bug.
- **Compare with it as:** the full-featured faithful implementation — the "what SSRT3 actually
  ships" benchmark, and the base for labs 07/09/10.

## 04 — GT-VBAO (Salm)
- **Lineage:** **Mirko Salm** (Shadertoy *TinyTexel*), XXGSDd, Sept 2024 — his ground-truth
  refit of the bitmask idea: cosine-weighted sector integration, quantized point-sample
  correction, slice importance sampling, improved ACos approximation. Therrien's verdict on the
  three.js thread: "a great improvement over VBAO and makes it more physically correct."
  Live-capture semantics ported (incl. his post-snapshot GetQuaternion +z→−z fix).
- **Founding claim, verified here:** converges to what a brute-force marcher converges to.
  Our converged port diffs **seamlessly** against demo 02 (8× amplified diff = uncorrelated MC
  noise, no bias regions).
- **Trials:** three's view-space z is opposite Salm's — the quaternion reference direction had
  to be mirrored, and slice directions are derived through the real projection matrix rather
  than hand-signed. AO-only by design.
- **Compare with it as:** the correctness-first AO. If another demo's AO disagrees with 04,
  suspect the other demo.

## 05 — GT-VBGI (Salm's GI family)
- **Lineage:** Salm's successors to GT-VBAO — the shaders both Salm and Therrien pointed
  three.js toward instead of more SSRT3 (Salm on PR #31839: "I'm genuinely curious what made you
  decide to go with SSGI instead of GT-VBGI"). One demo, three switchable variants:
  **bidirectional** (lfdBWn — cleanest), **unidirectional** (Xc3yzs/4ctBRH — half the depth
  samples, noisier per-frame, denoiser-dependent by design), **uniform-weighted**
  (XfcBDl/4cdfzf — no acos in the inner loop, slightly softer/flatter).
- **Validation:** all three converge to demo 02's GI (seamless split for the dominant signal).
  Honest documented caveat: slightly less near-field bounce on the short-box top vs brute
  force — a screen-space-gather limitation, not a port bug.
- **Trials:** unidirectional march must start at d=+1 (not −1) — near-black frame otherwise;
  wcsXDN's slice-relative mapping turned out to be distant-light machinery and moved to lab 08.
- **Compare with it as:** the quality-per-sample frontier, and the variant study (what
  cosine vs uniform weighting and bi- vs uni-directional marching are each worth).

## 06 — SSHGI (Mathis)
- **Lineage:** **independent third branch.** Mathis's Shadertoy dsGBzW (Oct 2023) implements
  the paper directly — predates all of Salm's GT-VBGI work, shares zero code with SSRT3. Its
  distinction: the only captured source where the complete loop (bitmask GI + multibounce +
  temporal accumulation + bilateral) ships together and is known-stable.
- **His estimator, preserved verbatim (the divergences are the data):** 4 single-sided
  horizons at 90° spacing instead of 2 bidirectional slices; a 32-vs-64 divisor mismatch
  between bitmask binning and energy weight; `sqrt` of the *emitter's* facing as light weight
  with **no explicit receiver N·L** (his cos² horizon term substitutes); albedo modulation at
  the accumulate step so history stores outgoing radiance (what enables his feedback).
- **Character:** *biased but stable and attractive* — reads brighter/more saturated than the
  unbiased reference by design. Multibounce plateaus (no runaway) even at his implicit
  feedback=1.0; we added an explicit damping knob (default 0.5) and an optional
  velocity-reprojection toggle that fixes his documented dynamic-scene ghosting (off = his
  original static-accumulate behavior).
- **Compare with it as:** the production-flavored contrast — what a pragmatic, stability-first
  interpretation looks like next to the correctness-first GT family, and the stability anchor
  for denoise comparisons.

---

## 07–11 — The labs (measurement instruments + settled defaults)

Labs answer questions; their READMEs end in Findings. The defaults they settled:

| Lab | Question | Verdict |
|---|---|---|
| **07 ambient** | Which §3.2 ambient source, and whose normalization? | Equirect source default. **SSRT3's normalization beats paper-literal** (which blows out ~K×); **hardcoded mip 3 beats cone→mip** (over-blurs). LightProbeGrid is WebGL-only in three 0.185.1 — revisit on bump. Fallback costs ~1.2–1.6 ms heavy. |
| **08 distant light + thickness** | Can any thickness heuristic span real geometry? Distant light how? | Constant thickness fails across the 20→500 mm plate range (crossover ~140 mm); **Ottosson's occluder-size heuristic (3clGWB) holds the whole range** at ~+40% cost. **Salm's spherical caps** match per-bin distant light 15–26% cheaper → default. |
| **09 bandwidth** | Where does the paper's bandwidth thesis lead? | **Half-res + joint bilateral = ship it** (4.1–6.3×, <0.5 ms overhead, no halos). **LSAO shared-memory caching: negative result** (0.87–1.06× — bitmask needs full-sector occupancy; exponential far steps miss tiles). **Fragment vs compute: no speed difference** — compute buys capability, not throughput. |
| **10 denoise** | Which stack, and how does it feed TRAA? | **SSRT3 temporal+bilateral default** (Mathis ~7% cheaper, near-equal). TRAA rewards low-variance temporally-stable input; spatial-only stacks + TRAA over-smear. Found demo 03's frame-static jitter defect. |
| **11 sampling** | Does noise choice matter? (Salm's claims) | **Both claims held** (quantitative MSE): Hilbert more isotropic raw; IGN denoises best. **Default: IGN when denoising, blue-noise texture when not.** 16-tile STBN approximation plateaus under deep accumulation. |

---

## Cheat sheet

| Demo | Source lineage | Estimator character | Temporal | Off-screen answer | Role |
|---|---|---|---|---|---|
| 01 | SSRT3 → three TSL port | paper-faithful, simplified | wired: TRAA default (selector: TRAA/Denoise/none) | none | shipping floor |
| 02 | Salm's reference marcher | unbiased MC, single bounce | accumulate-only | sky term | oracle |
| 03 | SSRT3 (complete) | paper-faithful, full-featured | own reproj+bilateral | **§3.2 fallback** | faithful reference impl |
| 04 | Salm GT-VBAO | ground-truth-converging AO | accumulate | n/a (AO) | correctness anchor (AO) |
| 05 | Salm GT-VBGI ×3 | ground-truth-converging GI | accumulate | none (see lab 08) | quality frontier + variants |
| 06 | Mathis SSHGI | biased, stable, multibounce | own accum (+our reproj) | none | production-flavored contrast |

A useful comparison protocol: pick a scene + bookmark pose → converge 02 → A/B each of
01/03/04/05/06 against it (split + 8× diff) → then judge the *un*-converged single-frame +
denoised versions against each other, because real-time is the un-converged case, and labs
10/11 say the denoiser and noise choice change that ranking.

---

## Bake-off verdicts (testing phase, 2026-07-21)

Measured at commit 7f80b84 via the committed runners; full table + caveats in
`bench/results/trackE-bakeoff.md`, raw tracks in `bench/results/`.

| Demo | Verdict |
|---|---|
| 01 | The floor, as intended. Fenced timing invalid under TSL render-list caching — use live gpu-ms. |
| 02 | Referee confirmed: 3.6/5.5 ms per accumulation frame (C-wide/S-hall). |
| 03 | **Winner on quality-per-ms and the Phase D base.** 2.15/4.56 ms default *including* temporal+denoise; near-oracle sponza cells; mip toggle worth 2× at heavy. Pair with frame-count accumulation (stability 0.31 vs EMA 1.06). |
| 04 | AO correctness anchor; march-only 4.7/5.5 ms but heavy configs blow to 27–34 ms. |
| 05 | Quality bar, not the base: cleanest cornell diff profile at 3–5× demo 03's cost (heavy up to 50 ms). Demo 12 must match it, not build on it. |
| 06 | March cost prohibitive (13.6/31.3 ms default, 68 ms heavy — the measured cause of the observed fps drag), but its count-based accumulation is the stability winner (0.34) — take the idea, not the march. |

Cross-cutting: the march dominates every budget (lab 09's half-res lever
applies to the dominant term everywhere); count-based accumulation beats EMA
in every appearance (Track C + lab 10); reconvergence ≤2 s for all demos at
the metric's resolution.
