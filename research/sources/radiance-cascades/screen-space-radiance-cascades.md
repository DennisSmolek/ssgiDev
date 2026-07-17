# Screen-Space Radiance Cascades (SSRC) — the key open question for this project

This file consolidates everything found across all sources specifically on how RC relates to screen-space GI — the question this research sweep was really run to answer.

## 1. It's in Sannikov's own paper as a named subsection
Section 4.5 of the paper's Implementations chapter is literally titled **"Screen Space Probes with World Space Radiance Intervals"** (see `sannikov-paper-notes.md`). This is Sannikov's own terminology for the hybrid approach: probes are placed/indexed in screen space (cheap, resolution tied to the G-buffer), but the radiance *intervals* those probes gather are still traced in world space (so they can, in principle, see past the screen edge / around occluders that the depth buffer alone can't resolve).

Paper's own limitation callout, verbatim: **"PoE2's screenspace implementation cannot capture offscreen lighting or occluders."** — meaning the shipped PoE2 GI is a simpler, cheaper screen-space-only variant, not the full SPWI hybrid. The SPWI section reads as the paper's proposed remedy for that gap, not as what shipped.

## 2. Community restatement of the tradeoff (HN thread + m4xc article + tmpvar notes)
Three independent sources converge on the same framing:
- **World-space probe arrangements** (probe size ~2^i × 2^i, i.e. genuinely volumetric) can capture offscreen indirect light — including surfaces occluded in the depth buffer — but are "much less efficient" than screen-space marching (source: search-result synthesis corroborated by the paper's "voxelizing the entire scene" limitation).
- **PoE2's screen-space probes** scale as ~2^i × 1 (flat, tied to screen resolution in one dimension only) — 1-2 orders of magnitude faster, but blind to anything not in the depth buffer.
- **SPWI** is explicitly positioned (by the paper, and independently by Kyriakos Gavras's Chalmers thesis, see `academic-followups.md`) as the memory-efficient middle path: keep probes screen-space-indexed, but let intervals escape into world space for the parts of the light transport that need it.

## 3. Concrete implementations of the hybrid
- **CodyJasonBennett/three-rc** (see `three-rc-implementation.md`) is the clearest working code example: screen-space probe grid (tied to `resolution`/`tileSize` in pixels) whose ray intervals are traced either via a world-space BVH (three-mesh-bvh, patched to support bounded `rayInterval`) — capturing offscreen occluders/emitters — or via a faster pure screen-space raymarch (Tiny Glade-style) that gives up that capability. The repo literally exposes both as a toggle, making it a live A/B of the exact tradeoff the paper describes.
- **Kyriakos Gavras's Chalmers thesis** builds directly on SPWI, swapping ray-marching for ray-tracing and adding a new "Bilinear 3D" depth-aware upscaler.
- **tmpvar's 3D explainer** exposes a live "Screen Space Brute Force" vs. "World Space Brute Force" toggle for exactly this comparison (interactive, no code, but good for building intuition before implementing).

## 4. Relevance to a VBAO-style near-field pass (for `notes.md` synthesis)
None of the sources found directly discuss combining RC with a *variance/visibility-bitmask*-style AO pass (VBAO) as a hybrid near-field term — this specific combination does not appear to have prior art in the literature gathered here. The closest analogues:
- The paper's own cascade-0-is-expensive problem ("calculating just cascade 0 in a high level of detail can take milliseconds") is exactly the regime a cheap near-field AO/bent-normal pass could substitute for or accelerate, since cascade 0 is the *only* cascade level that needs full spatial resolution — see `notes.md` for the synthesized recommendation.
- Noam Zeise's dissertation (`academic-followups.md`) is the one source that explicitly stages RC next to SSAO visually, though the writeup captured here is a summary, not the full comparison — worth a deeper manual read if this becomes a load-bearing design decision.

## Bottom line
SSRC is not a separate named technique with its own literature — it is Sannikov's own §4.5 hybrid (SPWI), which the community (three-rc, the Chalmers thesis, tmpvar) has picked up and is actively iterating on, but which has not yet converged on a single accepted best practice. It is real, it is exactly the shape this project needs (screen-space probe placement + selectively world-space ray intervals for offscreen light), and the three-rc repo is the best available concrete reference for a three.js/WebGPU implementation.
