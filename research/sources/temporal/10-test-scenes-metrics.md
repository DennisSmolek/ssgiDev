# 10 — Standard test scenes + ghosting metrics (LOW)

**Bench decision this feeds:** P2 re-record battery design — externally comparable
numbers.

---

## Summary

There is **no single "official" community benchmark suite** for TAA temporal
stability; the field uses a mix of canonical stress patterns, perceptual metrics,
and reviewer A/B methodology.

**Stress tests (community convention):**
- **Pendulum / swinging-object ghosting** — high-contrast object oscillating over
  a contrasting background; the canonical ghosting/trailing test.
- **Disocclusion sweeps** — camera/object translation that continuously uncovers
  background; tests history rejection + reprojection (trailing smear behind
  silhouettes).
- **Thin-feature flicker** — wires, foliage, fences, specular highlights,
  alpha-tested vegetation; sub-pixel features that alias/flicker; tests
  neighborhood-clamp aggressiveness vs stability.
- **Sub-pixel motion / slow pans** — exposes swimming, jitter shimmer, mip flicker.

**Metrics:**
- **Temporal PSNR / temporal RMSE** — of consecutive-frame differences vs a
  supersampled ground-truth sequence (accuracy + stability). Standard practice,
  not a single canonical paper.
- **FLIP (ꟻLIP)** — Andersson et al.; a perceptual difference evaluator designed
  for **alternating** images (flicker-aware). Closest to a standard per-frame
  perceptual metric in graphics.
- **tOF (temporal Optical Flow error)** — TecoGAN; end-point error between optical
  flow of adjacent GT frames vs adjacent output frames — quantifies motion-
  trajectory drift / flicker.
- **FovVideoVDP / FVVDP** — perceptual spatiotemporal video quality metric modeling
  flicker and judder; increasingly used for TAA/upscaler eval.
- **elaTCSF** — flicker-detection tCSF (2024/2025), see topic 09.

**Reviewer methodology** (Digital Foundry, Hardware Unboxed): frame-stepped
side-by-side at matched frames, lossless/high-bitrate capture, zoom crops on known
stress geometry, slow-motion for shimmer/disocclusion trails, motion vs static.
Qualitative but consistent and widely cited.

## Primary sources

- **A Survey of Temporal Antialiasing Techniques** ⭐ — Yang, Liu, Salvi, CGF 39(2),
  Eurographics 2020 STAR, pp. 607–621. **The master bibliography — best starting
  point for ALL topics in this brief.**
  https://onlinelibrary.wiley.com/doi/abs/10.1111/cgf.14018
  · author PDF: http://behindthepixels.io/assets/files/TemporalAA.pdf
- **ꟻLIP: A Difference Evaluator for Alternating Images** — Andersson et al.,
  Proc. ACM CGIT (HPG) 3(2), 2020. https://dl.acm.org/doi/10.1145/3406183
  · https://research.nvidia.com/publication/2020-07_flip
- **TecoGAN** (defines tOF) — Chu et al., ACM ToG 2020.
  https://arxiv.org/abs/1811.09393
- **k-DOP Clipping: Robust Ghosting Mitigation in TAA** — SIGGRAPH Asia 2024 Tech
  Comm. (recent ghosting method + AABB-clamp baseline discussion).
  https://dl.acm.org/doi/10.1145/3681758.3697996

## Code / implementations

- **NVlabs/flip** (C++/CUDA, Python, PyTorch, NumPy, MATLAB) — per-frame perceptual
  error vs GT. https://github.com/NVlabs/flip
- **TecoGAN** (Python; tOF / temporal-metric eval code). https://github.com/thunil/TecoGAN
- **FovVideoVDP** (Python/PyTorch). https://github.com/gfxdisp/FovVideoVDP
- **Alex Tardif TAA Starter Pack** (HLSL bench baseline to port to WGSL).
  https://alextardif.com/TAA.html

## WGSL / bench notes

- Implement **temporal PSNR/RMSE** + a frame-difference visualizer directly as a
  compute/fragment pass over ping-pong history — trivial, real-time.
- FLIP + FVVDP are offline reference metrics — dump PNG/EXR sequences plus a
  supersampled ground-truth pass, score offline.
- Build stress scenes procedurally: (a) oscillating high-contrast quad (pendulum),
  (b) translating camera over a textured plane with foreground occluders
  (disocclusion sweep), (c) thin-line/fence grid + alpha-tested foliage card
  (flicker). Drive jitter with Halton(2,3) or R2; log per-frame temporal RMSE vs a
  16–64× supersampled reference per scene.

## Confidence

Yang/Liu/Salvi authors, venue (CGF 39, EG 2020 STAR), pp. 607–621, URL verified;
FLIP authorship/formats, tOF/TecoGAN, k-DOP verified. **Inferred / not standardized:**
the stress-scene list is community convention (no canonical named suite with a
citable spec); "temporal PSNR" is practice, not one paper; reviewer methodology is
journalistic (cited descriptively).
