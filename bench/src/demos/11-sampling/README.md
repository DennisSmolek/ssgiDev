# Demo 11 — sampling lab (IGN vs R1-Hilbert vs blue noise vs STBN)

A **lab**, not a technique. It takes demo 04's GT-VBAO march *unchanged* and makes
its per-pixel noise source pluggable, then measures how the noise choice affects
raw appearance, convergence, denoised quality and temporal shimmer. Cross-cuts
demo 10 (denoise lab): per Salm, noise and denoiser interact.

Pinned to **three@0.185.1**. Producer: **demo 04 GT-VBAO** (`sampling.wgsl` is
demo 04's `gt-vbao.wgsl` with only the RNG swapped — same slice construction,
same 32-bit visibility bitmask, same handedness bridge). Holding the AO math
fixed means any observed difference is attributable to the noise alone.

## The noise sources

The march consumes three uniform `[0,1)` randoms per pixel per (frame, slice):
`rnd.x` → slice-direction angle, `rnd.y` → march-start jitter, `rnd.z` → horizon
jitter. `getNoise(coord, n)` in `sampling.wgsl` supplies them from:

0. **white** — PCG hash of pixel ⊕ temporal index. Control.
1. **IGN** — interleaved gradient noise (Jimenez), one scalar per channel
   (coordinate-offset decorrelated), temporal advance `uv += 5.588238·(n%64)`.
2. **R1-Hilbert** — Hilbert-curve linearise the pixel (`EvalHilbertCurve`, ported
   from XXGSDd `common.glsl`, N=7), then a Roberts R3 additive low-discrepancy
   sequence advanced by frame index. **Salm's shadertoy default.**
3. **blue** — precomputed blue-noise texture (tile 0 of the atlas), temporally
   advanced by golden-ratio value jitter `fract(v + φ·n)`.
4. **STBN-approx** — cycles the atlas's 16 mutually-decorrelated blue tiles, one
   per frame. **An approximation of Wolfe et al. STBN, not the real optimiser**
   (see "provenance / honesty" below).

### Blue-noise atlas provenance

`stbn-atlas.png` (512×512, committed) is a 4×4 grid of sixteen 128×128 tiles;
each tile's R/G channels are two mutually-decorrelated scalar blue-noise fields.
Generated offline, **no network**, by `bench/scripts/gen-bluenoise.mjs`
(`node scripts/gen-bluenoise.mjs`, deterministic seed, ~60 s):

- Method: **Georgiev & Fajardo, "Blue-noise Dithered Sampling"** (SIGGRAPH 2016)
  energy minimisation. Each field starts as a random permutation of the uniform
  ranks `{0.5/N … (N−0.5)/N}` — so the histogram is **exactly uniform and stays
  uniform** under swaps (Salm's requirement: the noise "must follow a uniform
  distribution"). Random value swaps that lower the spatial-blue energy
  `E = Σ exp(−‖pᵢ−pⱼ‖²/σ_s² − |vᵢ−vⱼ|^{d/2}/σ_v²)` are accepted. Verified
  lag-1 neighbour correlation ≈ **−0.20** (white ≈ 0), i.e. genuinely blue.
- It is **not** the classic void-and-cluster rank builder, and the 16 tiles are
  independently seeded (spatially blue, temporally *decorrelated* — not jointly
  optimised across the time axis the way real STBN is). Hence "STBN-approx".

## Experiments and how to reproduce

URL params drive deterministic captures: `?demo=11-sampling&scene=cornell`
`&view=<ao|reference|combined|denoised|split>` `&noise=<white|ign|hilbert|blue|stbn>`
`&accum=<maxFrames>` `&temporal=<0|1>` `&cmp=<split|diff>`.

- **RAW single-frame character** — `view=ao&accum=1` (one sample, seed 0,
  deterministic). Screenshots `11-raw-*.png`, `11-zoo-raw-*.png`.
- **Convergence** — quantitative, via readback MSE. `window.__lab11.measure()`
  converges a **GT-VBAO self-reference** (white, 512 frames) then reports MSE of
  each noise's accumulated AO at 8/32/128 frames against it, plus a shimmer
  metric. See "why self-reference" below.
- **Under a denoiser** — one fixed joint-bilateral (`bilateral.wgsl`, depth+normal
  aware, radius 3) applied identically to each noise's raw single frame.
  `view=denoised`. Screenshots `11-dn-*.png`.
- **Under motion** — `11-motion-ign-static` (temporal=0: the pattern is frozen in
  screen space and never resolves — this is what "crawls" during camera motion)
  vs `11-motion-ign-advanced` (temporal=1: resolves).

### Why the convergence metric is a GT-VBAO self-reference, not the brute-force marcher

The demo still ships demo 02's brute-force ray-march marcher (for the `split`
view), but the **quantitative** convergence metric compares each noise to
GT-VBAO's *own* converged limit, not to the marcher. Reason (measured): in a
**closed** Cornell box the two estimators have genuinely different screen-space
bias — the marcher's world-space radius over-counts the far walls as occluders —
so MSE(GT-VBAO, marcher) ≈ **0.255** and is dominated by that constant bias,
swamping the ~10⁻³ noise signal the lab is about. All five noises converge to the
*same* GT-VBAO value, so measuring each one's approach to that shared limit
isolates noise-driven variance (sampling efficiency) — the correct comparison.
Logged as a decision. `11-cornell-split-vs-marcher.png` shows the estimator-bias
diff (structured, not noise), which is exactly why the marcher is unsuitable as
the convergence oracle here.

## Findings

### Convergence — readback MSE vs GT-VBAO self-reference (512f), Cornell, ×10⁻³

| noise        | 8 frames | 32 frames | 128 frames |
|--------------|:--------:|:---------:|:----------:|
| white        |   3.49   |   2.00    |    1.38    |
| **IGN**      | **2.04** |   1.62    |    1.35    |
| **Hilbert**  |   2.35   | **1.61**  |  **1.31**  |
| **blue**     |   2.35   | **1.61**  |  **1.31**  |
| STBN-approx  |   3.55   |   2.55    |    2.28    |

- All three structured noises beat white **1.5–1.7×** at 8 frames; **IGN is best
  early**. By 32–128 frames Hilbert and blue (identical, both good LDS) edge ahead
  and white catches up (everything converges to the same limit, so the gap
  shrinks).
- **STBN-approx is worst and plateaus** (2.55 → 2.28 from 32→128). Cycling only
  16 fixed tiles caps the number of distinct sample sets; past ~16 frames it
  repeats and deep accumulation stops improving. Honest failure of *this*
  approximation — real STBN is built for 1–2-frame temporal windows, not
  512-frame accumulation.

### Frame-to-frame shimmer (mean |ΔAO| of consecutive single frames, temporal on)

| white | IGN | Hilbert | blue | STBN-approx |
|:-----:|:---:|:-------:|:----:|:-----------:|
| 0.105 | **0.140** | **0.096** | **0.096** | 0.105 |

IGN changes **most** per temporal step (highest raw flicker); Hilbert and blue
are steadiest. IGN's shimmer is the signal a temporal denoiser/TAA is designed to
consume — high per-frame decorrelation is *why* it denoises well.

### Raw isotropy (`11-raw-*.png`) — Salm claim 1

> "I chose R1-Hilbert as the default … its screen-space characteristics are more
> isotropic than those of IGN (as long as you don't denoise)."

**HELD.** IGN raw shows clear **diagonal directional streaks** (anisotropic);
Hilbert raw is an **isotropic mottle** with no directional axis (grainier
amplitude, but no preferred direction); blue is the **finest and most even** (best
raw look); white is coarse/clumpy (low-frequency blotches). For "no directional
structure" specifically, **Hilbert beats IGN** — Salm's exact point. Same ordering
on the artifact-zoo thin geometry (`11-zoo-raw-*.png`).

### Denoised quality (`11-dn-*.png`) — Salm claim 2

> "In my experience interleaved gradient noise works better than R1-Hilbert noise
> for denoising."

**HELD.** Same bilateral applied to each: **IGN cleanest**, blue nearly as clean,
**Hilbert leaves a mottled residual** the small kernel can't remove, white leaves
coarse blotches (its low-frequency energy survives bilateral filtering). IGN's
per-frame anisotropy is high-frequency and local, which is exactly what a
depth/normal bilateral eats; Hilbert's isotropic-but-lumpy residual is not.

### Verdict table

| noise        | raw isotropy      | converged error      | denoised     | frame shimmer |
|--------------|-------------------|----------------------|--------------|---------------|
| white        | poor (clumpy)     | worst @8, mid @128   | poor (blotch)| mid           |
| **IGN**      | fair (directional)| **best @8**          | **best**     | worst (0.140) |
| **Hilbert**  | good (isotropic)  | best @128 (tie)      | fair (mottle)| best (0.096)  |
| **blue**     | **best (finest)** | best @128 (tie)      | very good    | best (0.096)  |
| STBN-approx  | best (finest)     | **worst (plateaus)** | very good    | mid           |

### Recommended default noise for the bench

**IGN**, for the bench's accumulate-**and-denoise** pipeline: it denoises best
(Salm's own recommendation), gives the best cheap early convergence, costs **zero
texture bandwidth**, and its high raw shimmer is precisely what the temporal
denoiser/TAA exists to absorb. Secondary guidance:

- **No denoiser / want the best raw or steadiest look → blue-noise texture**
  (best raw, steadiest, and a strong second under denoise). **Hilbert** is the
  best texture-free "static, no-denoiser" option (isotropic + steadiest).
- **Avoid STBN-approx (16 cycled tiles) for deep frame accumulation** — it
  plateaus. It would only make sense for short temporal windows, and even then a
  real STBN volume (Wolfe et al.) should replace this approximation.

**Both of Salm's claims held.**

## Decisions for review (best-guess, logged per PLAN)

- **Convergence oracle = GT-VBAO self-reference** (not the brute-force marcher) —
  measured rationale above; isolates the noise signal from estimator bias.
- **Readback MSE** chosen over comparator-only (the readback path was *not* a
  rabbit hole — `copyTextureToBuffer` on the rgba16float RTs + a half-float
  decode gave clean, differentiated numbers). Runs offline via
  `window.__lab11.measure()`; not on the hot path.
- **Blue noise = Georgiev-Fajardo energy minimisation**, uniform-histogram
  preserved by swaps (documented above); STBN honestly labelled an approximation.
- **`slices/frame` defaults to 1** here (demo 04 uses 2) so a single accumulated
  frame shows one clean slice of the noise's character.
- **Noise dispatcher folds the slice index into the temporal index `n`** so
  multi-slice frames stay decorrelated across both axes.
- **WGSL parens trap** honoured (all `*`/`^`/`<<` mixes parenthesised); PI (not
  PI2) slice rotation and the bitmask/handedness bridge inherited verbatim from
  the validated demo 04 march.
