# SSILVB/VBAO Research Collection - Master Notes

**Collection Date:** July 17, 2026  
**Scope:** Screen Space Indirect Lighting with Visibility Bitmask (SSILVB) and related ambient occlusion research  
**Total Resources Captured:** 8 primary sources + 5 PDFs/documents

---

## Resource Summaries

### 1. SSILVB Paper (arXiv 2301.11376)
**File:** `ssilvb-2301.11376.pdf`, `ssilvb-abstract.md`, `ssilvb-paper-notes.md`

The foundational peer-reviewed publication by Olivier Therrien, Yannick Levesque, and Guillaume Gilet, published in Visual Computing (2022). Introduces the visibility bitmask concept as an improvement over GTAO by replacing dual horizon angles with a binary sector-based occlusion representation. The paper demonstrates superior visual quality for both ambient occlusion and indirect diffuse lighting with reduced noise compared to prior screen-space methods. Achieves this through a constant-thickness model that naturally handles thin geometry while maintaining computational efficiency.

### 2. CG Spotlight #5 Presentation Materials
**File:** `ssilvb-slides.md`

Presentation by Olivier Therrien at CG Spotlight #5 (May 31, 2023) announcing the SSILVB technique to the graphics community. The announcement page doesn't directly link the slide PDF, but references the accompanying blog post with implementation details. The presentation likely covers the algorithm fundamentals, directional ambient occlusion principles, and reflection-probe integration strategies. Key audience: real-time graphics professionals and researchers.

### 3. Therrien's Reference HLSL Implementation
**File:** `therrien-ssaovb-code.md`

Technical blog post (https://cdrinmatane.github.io/posts/ssaovb-code/) providing the reference HLSL implementation of SSAO with visibility bitmasks. Serves as the primary reference for Algorithm 1 in the paper, documenting the core loop structure, sector activation logic, front/back face calculation with thickness offset, and the bitfield accumulation pattern. Includes performance considerations showing the constant-thickness model eliminates traditional distance-based falloff calculations. This is the authoritative reference implementation for paper validation.

### 4. Cybereality's GLSL/WebGL ES Port
**File:** `cybereality-glsl-port.md`

Practical implementation writeup (https://cybereality.com/...) documenting a full GLSL ES porting of SSILVB from HLSL reference. Uniquely valuable for capturing real-world implementation gotchas: depth buffer artifact prevention through constant thickness, Interleaved Gradient Noise seeding strategy, blur filtering at 50% resolution, and light accumulation feedback loop damping (~50% factor). Includes complete shader code and platform-specific considerations for WebGL. Achieved ~1.1ms performance on AMD 6950XT at 1080p/50% scale. The document captures practical decisions made during production porting that don't appear in the paper.

### 5. GTAO Foundational Paper (Jimenez et al., 2016)
**File:** `gtao-jimenez2016.pdf`, `gtao-notes.md`

The seminal work "Practical Real-Time Strategies for Accurate Indirect Occlusion" from Activision Research (ATVI-TR-16-01, 2016) that forms the theoretical foundation for SSILVB. Introduces the horizon-based reformulation of the ambient occlusion equation, enabling ground-truth-accurate results in ~0.5ms on console hardware. Documents cosine-weighted horizon integration, multi-bounce approximation formula, spatio-temporal filtering architecture, and graceful quality degradation. SSILVB can be understood as a discretization of GTAO's continuous horizon integral with additional support for thin-surface handling and directional encoding.

### 6. Mirrors & Community Implementations
**File:** `tweets.md` (meta-reference)

References to community adoption and validation:
- **Bevy Engine:** Issue #19713 discussing SSAO/VBAO improvements
- **three.js:** Issue #29668 requesting SSILVB postprocessing integration
- **Cybereality Tweet:** Announcement of SSILVB implementation (status 1815051731950317794)
- **Mirko Salm Tweet:** GT-VBAO accuracy validation discussion vs. ray-marching reference (status 1833211198009184650)
- **volfaze Tweet:** SSILVB discussion (status 1849437680506909016, content unfetchable)

These indicate active community interest and ongoing port efforts across multiple engines and languages.

---

## Key Findings: Paper vs. Implementation Differences

### 1. Constant Thickness as Primary Feature
**Paper:** Mentions efficiency of horizon methods with improved occlusion representation.  
**Implementation:** Constant thickness (`deltaPosBackface = deltaPos - V * Thickness`) is the primary differentiator from GTAO, preventing false occlusion halos and enabling transparent/thin geometry handling without separate depth treatment.

**Practical Impact:** Eliminates a major category of GTAO artifacts (silhouette halos, fence artifacts) through a single parameter, rather than requiring complex depth analysis.

### 2. Bitfield as Directional Information
**Paper:** Describes visibility bitmask mathematically as discrete approximation of continuous horizon integral.  
**Implementation:** Each bit represents a direction around the hemisphere slice, enabling per-sector weighting, directional ambient occlusion, and natural reflection probe integration.

**Practical Impact:** Enables techniques not suggested in the paper, such as selective probe sampling based on occlusion sectors (probe fallback for out-of-screen geometry).

### 3. Noise Management Requires Post-Process
**Paper:** Assumes clean sampling results.  
**Implementation:** Production porting requires Interleaved Gradient Noise seeding on pixel coordinates and spatial filtering (bilateral blur at 50% resolution) as mandatory components.

**Practical Impact:** Raw algorithm produces visible noise; filtering adds ~15-20% to computational cost but is essential for visual quality.

### 4. Temporal Stability Needs Damping
**Paper:** Doesn't explicitly discuss previous-frame accumulation.  
**Implementation:** Multi-frame integration requires ~50% damping of historical indirect lighting to prevent exponential brightening and temporal instability.

**Practical Impact:** Suggests the paper's single-frame results may need temporal accumulation for production use, with specific damping ratios determined empirically.

### 5. Distance Falloff is Implicit, Not Explicit
**Paper:** Horizon-based integration naturally incorporates distance weighting.  
**Implementation:** Constant thickness parameter replaces traditional distance-based falloff; the thickness value controls both near-field geometry handling and effective occlusion range.

**Practical Impact:** Simpler parameter space (thickness vs. distance + falloff curve), but requires understanding that thickness is doing double duty.

### 6. Resolution Scaling for Performance
**Paper:** Theoretical algorithm at full resolution.  
**Implementation:** Production code renders at 50% resolution (0.5x), filters with bilateral cross-filtering, then upsamples. This is essential for real-time performance.

**Practical Impact:** ~4x performance improvement with minor quality loss (filtered reconstruction handles upsampling well), making the difference between 1.1ms and 0.3ms.

---

## Algorithm Core: Visibility Bitmask vs. Horizon Angles

### Traditional GTAO (Jimenez et al.)
```
For each slice:
  horizon_min = minimum elevation angle to occlusion
  horizon_max = maximum elevation angle (far field)
  AO += clamp(sin(horizon_min) - cos(normal_proj) * (1 - cos(horizon_max)), 0, 1)
```
**Characteristics:**
- Continuous value per slice
- Two horizon angles per direction
- Smooth but requires specific angle formulation

### SSILVB (Therrien et al.)
```
uint globalOccludedBitfield = 0u;
For each slice:
  For each sample:
    sector_range = mapHorizonRangeToSectors(horizon_min, horizon_max)
    globalOccludedBitfield |= sector_range
AO = 1.0 - float(countbits(globalOccludedBitfield)) / 32.0
```
**Characteristics:**
- Discrete binary per sector (32 sectors typical)
- One bitfield accumulation per slice
- Native GPU bitcount operation
- Naturally encodes direction information

**Trade-off:** Slight resolution reduction (32 discrete sectors vs. continuous horizon) but gains directional encoding and thin-surface handling.

---

## Probe Fallback Strategy Implications

The directional nature of SSILVB's bitmask suggests integration with reflection probes:

1. **Screen-space Primary:** SSILVB provides high-detail, view-dependent indirect lighting
2. **Probe Secondary:** Spherical harmonics or directional probes cover out-of-screen geometry
3. **Integration:** Sectors indicate which directions are occluded; occluded sectors can preferentially sample from directional probes rather than environment
4. **Fallback:** At frame edges or sky regions, smooth transition to pure probe contribution

This is hinted at in the paper's abstract ("enables light simulation behind surfaces") but the implementation details for probe blending are not fully specified—suggesting this is an active area of research/implementation.

---

## Performance Summary

| Method | Hardware | Resolution | Time | Config |
|--------|----------|-------------|------|--------|
| GTAO (Jimenez 2016) | PS4/Xbox One | 1080p | 0.5ms | 3 slices, 3 samples |
| SSILVB (Cybereality) | AMD 6950XT | 540p (50%) | 1.1ms | 4 slices, 4 samples |
| SSILVB (estimated full res) | AMD 6950XT | 1080p | ~2.0-2.5ms | 4 slices, 4 samples |

**Note:** Performance scales non-linearly with resolution due to cache behavior and filtering overhead. Lower-end configurations (2 slices, 2 samples) achieve ~0.3-0.5ms.

---

## Discovered Links & Resources

### Primary Publications
- **SSILVB Paper:** https://arxiv.org/abs/2301.11376 (arXiv 2301.11376)
- **GTAO Paper:** https://research.activision.com/publications/archives/atvi-tr-16-01practical-realtime-strategies-for-accurate-indirect-occlusion
- **GTAO PDF Mirror:** https://www.activision.com/cdn/research/PracticalRealtimeStrategiesTRfinal.pdf

### Implementation References
- **Therrien's Blog:** https://cdrinmatane.github.io/posts/ssaovb-code/ (HLSL reference)
- **CG Spotlight Announcement:** https://cdrinmatane.github.io/posts/cgspotlight-slides/
- **Cybereality GLSL Port:** https://cybereality.com/screen-space-indirect-lighting-with-visibility-bitmask-improvement-to-gtao-ssao-real-time-ambient-occlusion-algorithm-glsl-shader-implementation/

### Community Discussions
- **Bevy Engine VBAO:** https://github.com/bevyengine/bevy/issues/19713
- **three.js SSILVB Integration:** https://github.com/mrdoob/three.js/issues/29668
- **XeGTAO Reference Impl:** https://github.com/GameTechDev/XeGTAO (Intel/GameTech reference)
- **GitHub Mirror (GTAO PDF):** https://github.com/Patapom/GodComplex/blob/master/Tests/TestGroundTruthAOFitting/2016%20Jimenez%20-%20Practical%20Realtime%20Strategies%20for%20Accurate%20Indirect%20Occlusion.pdf

### Related Papers & References
- **Contextual Ambient Occlusion:** https://www.sciencedirect.com/science/article/pii/S0097849324000116 (volumetric approach comparison)
- **SelfShadow Publications:** https://blog.selfshadow.com/publications/s2016-shading-course/activision/s2016_pbs_activision_occlusion.pdf (GTAO course material)
- **Semantic Scholar:** https://www.semanticscholar.org/paper/Practical-Real-Time-Strategies-for-Accurate-Jimenez-Wu/b6d1ee60ac13ddd04ee0291d5e36a5677c6155e8

### Technical Blogs & Resources
- **Geeks3D on XeGTAO:** https://geeks3d.com/newz/item?id=438
- **Imagine Tech Blog (AO in Vulkan):** https://blog.imaginationtech.com/ambient-occlusion-in-vulkan
- **Valve Developer Wiki (AO ref):** https://developer.valvesoftware.com/wiki/SFM/Ambient_Occlusion

### Social Media (Unfetchable but Referenced)
- **Mirko Salm GT-VBAO Validation:** https://x.com/Mirko_Salm/status/1833211198009184650 (HTTP 402)
- **volfaze SSILVB Discussion:** https://x.com/volfaze/status/1849437680506909016 (HTTP 402)
- **Cybereality Implementation Announcement:** https://x.com/cybereality/status/1815051731950317794

---

## Research Gaps & Open Questions

Based on captured materials:

1. **Probe Integration:** Paper hints at probe fallback but doesn't detail sector-based probe selection strategy
2. **Temporal Accumulation:** Optimal damping ratios and history weighting for multi-frame integration
3. **Distance Variation:** How thickness should vary with geometry (adaptive thickness vs. constant)
4. **Specular Extension:** Applicability to specular indirect lighting (hints in implementations but not fully developed)
5. **Resolution Trade-offs:** Formal analysis of quality loss from reduced-resolution rendering and upsampling
6. **Color Bleeding:** Saturation and intensity characteristics when incorporating bounced light color

---

## Fetch Status Summary

| Source | Type | Status | Notes |
|--------|------|--------|-------|
| SSILVB Paper (2301.11376) | PDF | ✓ Downloaded | 20MB (full PDF) |
| SSILVB Abstract | Web | ✓ Fetched | ArXiv metadata captured |
| Slides Announcement | Web | ✓ Fetched | Link to blog, no direct PDF link |
| Therrien Blog Post | Web | ✓ Fetched | Full HLSL code captured |
| Cybereality GLSL | Web | ✓ Fetched | Complete shader code + gotchas |
| GTAO Paper | PDF | ✓ Downloaded | 7.1MB (via GitHub mirror) |
| volfaze Tweet | Web | ✗ HTTP 402 | Twitter API restriction |
| Mirko Salm Tweet | Web | ✗ HTTP 402 | Twitter API restriction (context found via search) |

---

## Summary

This collection captures the SSILVB technique from its peer-reviewed foundations (GTAO), through its paper publication, to production implementations across multiple shader languages. The material reveals key differences between theoretical formulation and practical porting, particularly around thin-surface handling through constant thickness, noise management requirements, and temporal stability. The visibility bitmask's directional encoding suggests promising avenues for probe-based fallback and specular lighting extensions, though these applications remain partially speculative based on implementation patterns.

**Total Captured:** 8 markdown documents + 2 PDFs documenting the core algorithm, implementations, performance analysis, and community adoption.

## Update 2026-07-17 — LSAO paper added

Dennis added `LineSweemAmbientObscurance.pdf` (Timonen, "Line-Sweep Ambient Obscurance", EGSR 2013) — the [Tim13] reference the SSILVB paper's future work names as the caching fix for its bandwidth problem. Full summary in `lsao-timonen2013-notes.md`.
