# Temporal / TAA research — deliverables index

Answers to the bench brief (`TEMPORAL-RESEARCH-TOPICS.md`, demo 18 temporal lab,
2026-07-24), plus a new denoising topic. Sourcing is **balanced code + papers**,
with WebGPU/WGSL/GitHub emphasis per Dennis's ask. Depth is **tiered**: full
treatment for HIGH + denoising; lighter (summary + key formulas + source list)
for MED/LOW.

Every topic file carries its own Primary sources / Code / WGSL notes / Confidence
sections. Consolidated link list in `sources/BIBLIOGRAPHY.md`. Raw verified
research notes (the fetched-verbatim detail) in `sources/`.

| # | Topic | Prio | Depth | Key deliverable |
|---|-------|------|-------|-----------------|
| 01 | Variance clipping vs neighborhood clamping | HIGH | full | `μ ± γσ` moment AABB (YCoCg), γ=1, clip-toward-center; Bevy WGSL |
| 02 | Disocclusion / history rejection under jitter | HIGH | full | SVGF depth-gradient weight; FSR2 `depth_clip.h` view-space test |
| 03 | Spatiotemporal blue noise (temporal axis) | HIGH | full | STBN energy fn; NVIDIA-RTX/STBN SDK; golden-ratio caveat |
| 04 | History resampling filters | MED | light | 5/9-tap bilinear-merged Catmull-Rom; MJP gist; Bevy 5-tap |
| 05 | Velocity dilation / closest-depth velocity | MED | light | 3×3 nearest-depth MV select + atomic reproj; FSR2 dilate |
| 06 | HDR weighting + firefly-safe accumulation | MED | light | Karis/Lottes reversible tonemap; producer-side pre-clamp |
| 07 | A-SVGF temporal gradients | MED | light | fixed-RNG forward-projected gradient λ; Q2RTX asvgf shaders |
| 08 | TAA-upscaling rectification internals | MED | light | FSR2 `accumulate.h`/`lock.h` verbatim; FSR3/4 current state |
| 09 | Perceptual thresholds for temporal noise | LOW | light | tCSF/Ferry–Porter/Window-of-Visibility; elaTCSF to port |
| 10 | Standard test scenes + ghosting metrics | LOW | light | stress scenes; temporal PSNR/FLIP/tOF/FVVDP; Yang survey |
| 11 | Real-time denoising direction (WebGPU) | NEW | full | SVGF→FSR3 spine + A-SVGF + ReSTIR; OIDN as settle pass |

## Cross-cutting notes for the bench

- **Single best starting bibliography for everything:** Yang, Liu, Salvi, "A Survey
  of Temporal Antialiasing Techniques" (CGF 2020) — http://behindthepixels.io/assets/files/TemporalAA.pdf
- **Single best reusable WGSL reference:** `bevy taa.wgsl` fuses variance clipping
  (γ=1), 5-tap Catmull-Rom history, and reversible-tonemap HDR accumulation in
  ~200 lines (MIT/Apache). Touches topics 01, 04, 06 at once.
- **Single best code analog to the whole stack:** `C-none/Web-RTRT` — ReSTIR →
  SVGF+RELAX → FSR2, all in WGSL.
- **γ recommendation for the successor arm (topic 01): γ = 1.0.**
- **Do NOT cite a numeric STBN convergence multiplier (topic 03)** — sources are
  qualitative; measure it on the bench.
- **Perceptual verdict (topic 09):** there is no universal scalar; the defensible
  move is a per-region tCSF model (elaTCSF) that gates the churn metric by
  luminance / spatial frequency / eccentricity.
- **Denoising (topic 11) headline:** the "OIDN is very slow" premise appears out of
  date vs the current `DennisSmolek/Denoiser` (WebGPU+ORT, ~104 ms/1080p warm) —
  see that file's flagged note.

## Flagged unverifiables (carried from research; confirm before quoting)

- FSR2 `ffx_fsr2_reconstruct_previous_depth.h` body would not render through any
  mirror this session — the dilation pseudocode (topic 05) is manual-sourced +
  corroborated by call sites, not byte-exact. Open the GitHub blob to capture the
  exact `FindNearestDepth` loop.
- Karis 2014 PPTX page numbers relied on the s2014 index + secondary citations.
- Kelly 1979 exact URL and the "~0.2–0.5% / >50–70 Hz" flicker rule of thumb
  (topic 09) are inferred, not single cited constants.
- SVGF "~10 ms/1080p" and A-SVGF "9×–166× MSE" are the papers' own abstract figures.
