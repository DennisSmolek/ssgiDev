# 03 — Spatiotemporal blue noise (STBN), the temporal axis (HIGH)

**Bench decision this feeds:** demo 12/18 bluenoise mode currently cycles atlas
tiles with a golden-ratio value shift. If true STBN-over-time converges measurably
faster at low N, it's a drop-in producer win for every stack.

---

## The key insight

Per-frame spatial blue-noise masks (Georgiev–Fajardo / void-and-cluster) give a
blue-noise *spatial* spectrum every frame — but if you cycle **independent** masks
per frame, each pixel's value sequence **over time is white noise**. Under
temporal accumulation the per-pixel error then integrates at the white-noise rate
and filters poorly along the time axis.

STBN reformulates the mask so a pixel's values are *also* blue-noise-distributed
along the time (z) axis. Generation = standard void-and-cluster / BNDS with a
**modified energy function**: pairwise energy is counted only when two samples
share the same z-slice (spatial neighbors within a frame) OR share the same (x,y)
but differ in z (same pixel across frames); cross terms are zero. Result: N slices
each spatially blue, each pixel temporally blue.

---

## Consequences for the bench

- **Under 1/N (box) accumulation:** each pixel's samples over the window are
  well-stratified in value, so the running mean converges toward the expected
  value faster than independent per-frame blue noise (which is white over time).
  NVIDIA: "converge rapidly for Monte Carlo integration," "substantially faster."
- **Under EMA:** STBN's temporal blue spectrum attenuates the low-frequency
  temporal error (the part EMA cannot remove) → more stable, less "swimmy." The
  Part-1 blog's Fig 1 shows the Disney cloud under EMA α=0.1.
- **3D blue noise is NOT a substitute.** A 3D blue-noise volume's individual 2D
  slices are not spatially blue, and a pixel's z-line isn't cleanly blue either
  (Peters, "The problem with 3D blue noise"). STBN engineers *both* marginals blue.
- **Under motion / TAA:** a moving pixel loses its temporal-neighbor relationship,
  so STBN degrades gracefully to ordinary spatial blue noise — "does no worse than
  spatial blue noise, so it should always be used."

### Your current approach: 2D-atlas + golden-ratio value shift

Keep one 2D blue-noise tile; each frame add the golden-ratio conjugate
`g = 0.618033988…` (the R1 low-discrepancy increment `frac(n·φ⁻¹)`) to the scalar
value mod 1. This animates a single tile so each pixel walks a low-discrepancy 1D
sequence over time — cheaper in memory but generally **lower quality** than a true
3D STBN volume, because the spatial spectrum is preserved but the *temporal*
spectrum is only 1D-LDS, not jointly optimized with the spatial term. R2 (Roberts)
generalizes to 2D vector shifts via the plastic-number constants.

> **Verdict for the bench:** true STBN should converge faster at low N than your
> golden-ratio-animated tile, but the sources give this **qualitatively**
> ("substantially faster"), not as a single multiplier. Measure it directly:
> RMSE-vs-frame for (a) independent blue noise, (b) golden-ratio tile cycle,
> (c) 3D STBN volume, under both 1/N and EMA. See the arXiv PDF's RMSE plots for
> the expected shape.

---

## Primary sources

- **Spatiotemporal Blue Noise Masks** — Wolfe, Morrical, Akenine-Möller,
  Ramamoorthi — EGSR 2022 (NVIDIA).
  https://research.nvidia.com/publication/2022-07_spatiotemporal-blue-noise-masks
  · author PDF: https://cseweb.ucsd.edu/~ravir/stbn.pdf
  · arXiv: https://arxiv.org/abs/2112.09629
- **Rendering in Real Time with Spatiotemporal Blue Noise Textures, Part 1 & 2**
  — NVIDIA Technical Blog, 2021.
  https://developer.nvidia.com/blog/rendering-in-real-time-with-spatiotemporal-blue-noise-textures-part-1
  (and `-part-2`) — energy-function modification, EMA/AO demos.
- **The problem with 3D blue noise** — Christoph Peters.
  https://momentsingraphics.de/3DBlueNoise.html
- **Blue-noise Dithered Sampling** — Georgiev & Fajardo, SIGGRAPH 2016 Talks.
  https://www.arnoldrenderer.com/research/dither_abstract.pdf
- **The Unreasonable Effectiveness of Quasirandom Sequences** (R1/R2 golden /
  plastic) — Martin Roberts.
  https://extremelearning.com.au/unreasonable-effectiveness-of-quasirandom-sequences/
- **Distributing Monte Carlo Errors as Blue Noise in Screen Space** —
  Heitz & Belcour, EGSR 2019 (the seed-permutation alternative STBN benchmarks against).
  https://belcour.github.io/blog/research/publication/2019/06/18/animation-bluenoise.html

## Code / implementations

- **NVIDIA-RTX/STBN** ⭐ (was NVIDIAGameWorks/SpatiotemporalBlueNoiseSDK — old URL
  301-redirects). https://github.com/NVIDIA-RTX/STBN — C++/CMake generator.
  **Pregenerated textures now at `Assets/STBN.zip`** (the old root `STBN.zip` path
  cited in blogs is stale). `ScalarApp` = 1D void-and-cluster (~60× faster than
  reference); `VectorApp` = 1D/2D/3D simulated annealing, L1/L2/L∞/neg-dot metrics.
- **joshbainbridge/blue-noise-generator** (C++, the 2016 BNDS paper).
  https://github.com/joshbainbridge/blue-noise-generator
- **bartwronski/BlueNoiseGenerator** (C++ void-and-cluster).
  https://github.com/bartwronski/BlueNoiseGenerator
- **Demofox, "Thresholding Modern Blue Noise Textures"** (2025) — current practical
  shader-usage reference, GLSL/HLSL patterns port directly to WGSL.
  https://blog.demofox.org/2025/05/27/thresholding-modern-blue-noise-textures/

## WGSL / WebGPU notes

- Load STBN slices as a `texture_2d_array` (one layer per z-slice) or `texture_3d`,
  sampled **nearest/point only** (`'nearest'`) — never linear; interpolation
  destroys the blue-noise spectrum. Point-sample via `textureLoad`, not `textureSample`.
- Index: `layer = frameIndex % depth`, tile spatially `textureLoad(tex, pixel % 128, layer)`
  (SDK masks are 128×128×64).
- Golden-ratio fallback in WGSL is trivial and memory-cheap:
  `v = fract(textureLoad(tile, p, 0).r + f32(frame) * 0.618033988);`

## Confidence

Method, energy modification, EMA demo, 3D caveat, motion behavior, SDK repo
contents + redirect all verified. **Do NOT cite a specific convergence multiplier**
— sources state it qualitatively and provide RMSE plots, no single factor. The
golden-ratio-per-frame value shift is standard practice (Roberts + Wolfe's
"animating noise" posts); the R1 math is verified.
