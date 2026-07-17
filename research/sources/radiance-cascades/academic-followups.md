# Academic follow-up work (post-Sannikov-paper)

## Holographic Radiance Cascades for 2D Global Illumination
- arXiv: https://arxiv.org/abs/2505.02041 (PDF: https://arxiv.org/pdf/2505.02041) — submitted 2025-05-04, cs.GR, 9 pages / 15 figures.
- **Authors: Rouli Freeman, Alexander Sannikov, Adrian Margel** — Sannikov himself is a co-author, making this the closest thing to an official "part 2" of the original paper.
- ResearchGate mirror: https://www.researchgate.net/publication/391461286_Holographic_Radiance_Cascades_for_2D_Global_Illumination
- Contribution: a "multi-level radiance probe system" replacing conventional raytracing with combined short ray intervals, described as a "single-shot scene-agnostic radiance transfer algorithm" achieving results "visually indistinguishable from the 2D reference solution at realtime framerates" — without stochastic raytracing, temporal denoising, or undersampling.
- Measured performance: **1.85 ms at 512×512**, **7.67 ms at 1024×1024** on an RTX 3080 Laptop GPU; constant cost for a given scene size.
- Related repo: Yaazarai/Volumetric-HRC (https://github.com/Yaazarai/Volumetric-HRC) — "Constant-Time per-pixel volumetrics using ray-extensions and Holographic Radiance Cascades" — likely a community implementation of (or precursor to) the ideas in this paper.
- Scope caveat: still explicitly **2D**, despite the "holographic" framing suggesting something more exotic — do not conflate with a 3D solution.

## "Radiance Cascades for Real-Time 2D Global Illumination" (ResearchGate)
- https://www.researchgate.net/publication/399216475_Radiance_Cascades_for_Real-Time_2D_Global_Illumination
- Surfaced in search but not fetched in depth this pass (ResearchGate gating likely to block WebFetch) — flagged for a follow-up pass if deeper 2D-academic grounding is needed later.

## Kyriakos Gavras — "Exploration and Optimization of Radiance Cascades for Real-Time Applications" (Chalmers University thesis)
- https://odr.chalmers.se/items/3ee9fb4e-1880-46c2-802a-a660e38dc9ee
- **Directly on-topic for this project**: focuses on **Screen-Space Probes with World-Space Intervals (SPWI)** — exactly the section 4.5 approach named in Sannikov's own paper (see `sannikov-paper-notes.md` and `screen-space-radiance-cascades.md`).
- Diverges from the original paper by using **ray-tracing rather than ray-marching**, and introduces a novel depth-aware upscaling technique the thesis calls **"Bilinear 3D,"** compared against other upscaling methods.
- Explicitly scoped as "screen space for 2D" — i.e. it treats SPWI as a memory-efficient way to capture off-screen indirect lighting without needing a full 3D probe grid, and frames the contribution as foundational/exploratory rather than final.

## Noam Zeise — "3D Radiance Cascades" (honours project writeup)
- https://noamzeise.com/drafts/2025-05-10-dissertation.html
- Built in **Common Lisp + OpenGL** (an unusual stack choice worth noting for anyone assuming C++/GLSL is required).
- Explicitly explored three probe-placement strategies in sequence and reports why each was abandoned:
  1. World-space dense grid — too slow.
  2. Projection-space probes moving with the camera — dropped due to interpolation issues from inconsistent world-space distance between probes.
  3. View-space probes — the one that stuck.
- Includes a direct visual comparison against SSAO — **this is the one source in this whole sweep that explicitly stages RC next to an ambient-occlusion technique**, which is the exact comparison this project's VBAO-vs-RC question needs. Recommend reading this one in full if it becomes available in more depth than the summary captured here (the fetch returned a compressed narrative summary, not verbatim text — worth a manual re-read).

## Caveat: unrelated same-named paper
- arXiv:2408.14425 "Radiance Cascades: A Novel High-Resolution Formal Solution for Multidimensional Non-LTE Radiative Transfer" (https://arxiv.org/abs/2408.14425) is **NOT related** to Sannikov's computer-graphics technique — it's an astrophysics/radiative-transfer paper that happens to reuse the term "radiance cascades" for a physically-unrelated numerical method (stellar atmosphere radiative transfer). It surfaces in nearly every broad search for "radiance cascades paper" and should be filtered out. Noted here explicitly so it isn't mistaken for a Sannikov-lineage citation in future work.
