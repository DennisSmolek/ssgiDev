# 07 — A-SVGF: temporal gradient-driven adaptivity (MED)

**Bench decision this feeds:** our whole 1/N story assumes static lighting; A-SVGF
is the principled answer for dynamic lights/emissive changes, and likely the next
SVGF-lab (demo 14) arm — the replacement for `detectShadingChanges`-style heuristics.

---

## Summary + mechanism

A-SVGF replaces ad-hoc shading-change heuristics with a **measured per-pixel
temporal gradient** that distinguishes "history stale because lighting changed"
(raise blend weight toward the new frame) from "everything static" (let
accumulation approach the 1/N ideal, α → small).

**Gradient estimation** (repurposes a small fraction of the shading budget):
1. Take a **stratified subset** of pixels — one gradient sample per K×K tile
   (paper example: 3×3).
2. **Forward-project** last frame's surface samples into the current frame via
   motion vectors.
3. **Re-shade them with the same random-number sequence** as last frame. Because
   the RNG is held fixed, any change in shaded luminance Φ is due to
   *lighting/visibility change*, not sample noise.
4. Normalized temporal gradient (self-normalizing, HDR-robust):
   ```
   λ = |Φ_curr − Φ_prev| / max(Φ_curr, Φ_prev)   ∈ [0,1]
   ```
5. Spatially reconstruct/dilate λ from the sparse strata to a dense per-pixel field.

λ drives the **adaptive temporal accumulation factor** α: high λ → α rises →
history discarded fast (kills ghosting/lag on lighting change); low λ → α → 1/N
long accumulation for max denoising/stability. Runs ~2 ms at 1080p; basis of
Q2VKPT, shipped in Q2RTX.

## Primary sources

- **Gradient Estimation for Real-Time Adaptive Temporal Filtering** — Schied,
  Peters, Dachsbacher — Proc. ACM CGIT (HPG) 1(2), Art. 24, 2018.
  DOI: https://doi.org/10.1145/3233301
  · project (PDF, code, video): https://momentsingraphics.de/HPG2018.html
  · author PDF: https://cg.ivd.kit.edu/publications/2018/adaptive_temporal_filtering/adaptive_temporal_filtering.pdf
- **Q2VKPT** — Schied (first real-time path-traced Quake II, predecessor context).
  http://brechpunkt.de/q2vkpt/

## Code / implementations

Verified files in **NVIDIA/Q2RTX** (`src/refresh/vkpt/`, GLSL/Vulkan compute):

- `shader/asvgf.glsl` — shared A-SVGF helpers.
  https://github.com/NVIDIA/Q2RTX/blob/master/src/refresh/vkpt/shader/asvgf.glsl
- `shader/asvgf_gradient_img.comp` ⭐ — builds the temporal gradient image from
  forward-projected samples.
  https://github.com/NVIDIA/Q2RTX/blob/master/src/refresh/vkpt/shader/asvgf_gradient_img.comp
- `shader/asvgf_temporal.comp` — gradient-driven adaptive-α accumulation.
  https://github.com/NVIDIA/Q2RTX/blob/master/src/refresh/vkpt/shader/asvgf_temporal.comp
- `shader/asvgf_lf.comp` (low-freq/indirect), `shader/asvgf_taau.comp` (temporal
  upscale), `asvgf.c` (host orchestration).
- Original paper shader code (KIT):
  https://momentsingraphics.de/Media/HPG2018/Schied2018-AdaptiveTemporalFilteringCode.zip

## WGSL portability notes

- No known first-class WebGPU/WGSL port; research-grade target. GLSL compute maps
  cleanly to WGSL `@compute`. Two porting risks:
  - **Forward-projection scatter** — writing gradient samples to a coarse gradient
    image is a scatter; in WGSL use a storage buffer / `texture_storage_2d` with
    atomics or a dedicated scatter pass (no arbitrary framebuffer scatter).
  - **Deterministic RNG reuse** — persist and replay the previous frame's
    per-sample seed; store seeds in a ping-pong storage buffer keyed by the
    forward-projected sample ID.
- The λ formula is directly implementable: `abs(a-b)/max(max(a,b), eps)`.
- Cheapest useful subset for the bench: sparse-stratified gradient (one sample per
  3×3 tile) + a small edge-aware blur to densify λ.

## Confidence

Authors/venue/DOI, forward-projection + fixed-RNG mechanism, ~2 ms/1080p, Q2VKPT
lineage, and Q2RTX file URLs verified. Exact 3×3 stratification constant is the
paper's example — confirm against `asvgf_gradient_img.comp` when implementing
(path confirmed, body not opened).
