# SSILVB Slides - CG Spotlight #5

**Presentation:** Screen Space Indirect Lighting with Visibility Bitmask  
**Presenter:** Olivier Therrien, Graphics R&D Programmer  
**Event:** CG Spotlight #5  
**Date:** May 31, 2023  
**Venue:** CG Spotlight (Online Conference/Workshop)

## Overview

This presentation covered the SSILVB technique, a screen-space indirect lighting and ambient occlusion algorithm that improves upon GTAO by replacing dual horizon angles with a visibility bitmask approach.

## Content Note

The actual slide deck (ssilvb_slides.pdf) was not directly linked on the announcement page at https://cdrinmatane.github.io/posts/cgspotlight-slides/. The page serves as an announcement and references the related blog post at /posts/ssaovb-code/ for implementation details.

## Related Materials

The presentation is complemented by technical materials:

1. **Blog Post:** https://cdrinmatane.github.io/posts/ssaovb-code/
   - Implementation in HLSL with reference code
   - Core algorithm walkthrough
   - Performance metrics

2. **Paper:** arXiv 2301.11376
   - Detailed mathematical formulation
   - Performance analysis
   - Results comparison

## Key Topics Likely Covered

Based on the paper and implementation materials:

### Algorithm Fundamentals
- Comparison with GTAO horizon-based approach
- Visibility bitmask concept and implementation
- Sector-based occlusion tracking

### Directional Ambient / Reflection-Probe Sampling (§3.2 Context)

**Directional Ambient Occlusion:**
- Traditional GTAO provides directionally-aware occlusion
- SSILVB's bitmask preserves directional information through sector organization
- Each sector represents a direction around the hemisphere slice
- Allows weighting of indirect light by surface orientation

**Reflection-Probe Fallback Integration:**
- Paper context suggests screen-space results serve as primary path
- Probe-based fallback for out-of-screen geometry
- Combines screen-space detail with probe-based robustness
- Sectors enable directional selection from probes

### Screen-Space Limitations & Hybrid Approaches
- Screen-space data is view-dependent
- Limited to visible surfaces within frame
- Edges and silhouettes can exhibit artifacts
- Probes provide coverage for off-screen geometry

### Probe Sampling Strategy
- Directional bitmask allows selection from multi-directional probes
- Sectors encode which directions are occluded
- Can blend multiple probes based on occlusion pattern
- Reduces common "halo" artifacts from single-direction probes

## Performance Highlights

- Efficient compared to full radiosity or voxel-based GI
- Scales well on modern GPUs (AMD 6950XT reference: ~1.1ms at 1080p/50% scale)
- Suitable for real-time applications and games
- Minimal memory overhead (single uint per evaluation)

## Implementation Status

As of the presentation date (May 2023), the technique had been:
- Published as a peer-reviewed paper (Visual Computing, 2022)
- Implemented in multiple commercial engines (references to three.js, Bevy discussion)
- Ported to various shader languages (HLSL, GLSL)

## Related Community Work

The CG Spotlight event appears to be part of a broader community engagement:
- Discussion of SSAO variants across engines
- GTAO/VBAO improvements in Bevy engine
- Three.js postprocessing integration discussions
