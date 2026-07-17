# GTAO Paper - Technical Notes & Summary

**Title:** Practical Real-Time Strategies for Accurate Indirect Occlusion

**Authors:** Jorge Jimenez et al.

**Publication:** Activision Research (ATVI-TR-16-01), 2016

**DOI/ID:** Part of GDC/ShaderX publications on real-time rendering

**Primary Reference:** https://research.activision.com/publications/archives/atvi-tr-16-01practical-realtime-strategies-for-accurate-indirect-occlusion

## Overview

GTAO (Ground Truth Ambient Occlusion) introduces a reformulation of the ambient occlusion equation that achieves ground truth accuracy while maintaining real-time performance. The key innovation is an efficient implementation that distributes computation using spatio-temporal filtering and horizon-based sampling.

**Key Claim:** GTAO can match ground truth reference solutions in approximately 0.5 milliseconds on console hardware (2016-era), providing superior results compared to HBAO while maintaining speed comparable to HemiAO (one of the fastest screen-space techniques).

## Algorithm Structure

### Core Components

The GTAO algorithm consists of several integrated techniques:

1. **Horizon-Based Sampling:** Replace random hemisphere sampling with organized slice-based sampling
2. **Dual-Horizon Elevation Angles:** Track minimum and maximum horizon angles per slice direction
3. **Cosine-Weighted Horizon Integration:** Convert horizon angles to weighted occlusion factor
4. **Spatio-Temporal Filtering:** Denoise results across space and time
5. **Near-Field Global Illumination Extension:** Account for secondary bounces

### Main Loop Structure

**Pseudocode Overview:**
```
For each pixel:
  Initialize occlusion accumulator
  For each slice direction around normal:
    Initialize front/back horizon angles
    For each sample along slice:
      Compute projected depth
      Update front/back horizon angles
      Accumulate weighted occlusion
  Filter and temporally blend results
```

## Multi-Bounce Approximation Formula

The paper extends single-bounce ambient occlusion with multi-bounce approximation to account for light bouncing between surfaces:

**Single-Bounce AO:**
```
AO = integral of cosine-weighted horizon visibility
```

**Multi-Bounce Extension:**
```
AO_multi = AO_single + (1 - AO_single) * AO_single * bounce_factor
```

Where:
- **AO_single:** Direct visibility (0 to 1)
- **bounce_factor:** Typically 0.5 to 1.0 depending on surface properties
- **Term 2:** Approximates light that bounced once off occluding surfaces

**Practical Implementation:**
- Blend factors based on local geometry complexity
- Can be precomputed or data-driven
- Reduces banding artifacts in heavily occluded areas

## Cosine-Weighted Horizon Integration

The horizon-based occlusion is computed through cosine-weighted integration:

### Horizon Angle to AO Conversion

For a given slice direction, two horizon angles are computed:
- **θh_min:** Minimum elevation angle to nearest occluding surface
- **θh_max:** Maximum elevation angle (for far-field occlusion)

**Occlusion Integral:**
```
AO_slice = integral from -π/2 to θh_min of max(0, cos(θ) - cos(θn)) dθ
```

Where:
- **θ:** Elevation angle around the slice
- **θn:** Surface normal angle in the slice plane
- **cos(θn):** Projected normal component

### Efficient Computation

Rather than computing this integral explicitly, GTAO uses:

**Analytic Formula:**
```
f(θ_h) = sin(θ_h) - cos(θ_n) * (1 - cos(θ_h))
```

**Application:**
```
AO_from_horizon = clamp(f(θ_h_min) - f(θ_h_max), 0, 1)
```

**Advantages:**
- Single evaluation per horizon pair
- No numerical integration needed
- GPU-efficient (no loops)

### Slice Averaging

Final AO is average across all slice directions:
```
AO_final = average(AO_slice_1, AO_slice_2, ..., AO_slice_n)
```

Typically 3-4 slices per pixel for good quality.

## Distance-Based Falloff

GTAO incorporates distance weighting to smooth transitions between near-field and far-field:

**Distance Weighting:**
```
weight(distance) = 1.0 / (1.0 + distance^2 / radius^2)
```

Where:
- **distance:** Sample distance from current pixel
- **radius:** User-defined sampling radius

**Application:**
- Downweight far samples
- Smooth out harsh horizon transitions
- Control occlusion field size

## Performance Architecture

### Spatio-Temporal Filtering Strategy

The paper emphasizes that achieving real-time performance requires careful filtering:

1. **Spatial Filtering:**
   - Bilateral filter to preserve edges
   - Uses depth differences to prevent bleeding
   - Applied at reduced resolution (e.g., 50-75%)

2. **Temporal Filtering:**
   - Accumulate results across frames
   - Weight by temporal coherence
   - Stabilizes noise

3. **Composite Approach:**
   - Render at 0.5x resolution
   - Spatial bilateral filter
   - Temporal blend with history
   - Upsample to full resolution

### Performance Targets (2016 Hardware)

- **Console (PS4/XBO):** ~0.5 ms for full implementation
- **PC (high-end):** 0.3-0.8 ms depending on settings
- **Mobile:** Reduced sample/slice count

### Quality Tiers

The algorithm supports graceful degradation:
- **High:** 4 slices, 4 samples, full filtering
- **Medium:** 3 slices, 3 samples, basic filtering
- **Low:** 2 slices, 2 samples, minimal filtering

## Comparison with Prior Methods

### vs. HBAO (Horizon-Based AO)
- **GTAO Advantage:** Reformulated equation yields ground truth accuracy
- **Performance:** Comparable or faster
- **Quality:** Superior match to reference

### vs. SSAO (Screen-Space AO)
- **GTAO Advantage:** Less noise, smoother results
- **Performance:** More efficient with intelligent sampling
- **Artifacts:** Fewer sampling artifacts

### vs. Voxel-Based AO
- **GTAO Advantage:** Works with standard depth buffers
- **Performance:** Real-time on 2016 hardware
- **Memory:** Minimal overhead

## Global Illumination Extension

The paper also presents techniques for extending GTAO to account for near-field global illumination:

**Color Bleeding from Indirect Light:**
- Sample direct lighting from neighboring pixels
- Weight by occlusion and visibility
- Creates subtle color bounce effects
- Computationally efficient extension to base AO

**Integration with Direct Lighting:**
- Use direct lighting buffer as input
- Multiply by occlusion factor
- Can be further filtered for temporal stability

## Key Contributions Summary

1. **Reformulated AO Equation:** Enabling ground truth accuracy
2. **Efficient Horizon Integration:** Analytic formula vs. numerical integration
3. **Spatio-Temporal Filtering:** Practical denoising that preserves quality
4. **Performance Scalability:** From mobile to console/PC
5. **Global Illumination Extension:** Near-field multi-bounce approximation

## Impact on Industry

The GTAO paper has been highly influential:
- Adopted in multiple AAA game engines
- Foundation for subsequent improvements (SSILVB, XeGTAO, etc.)
- Reference implementation provided by Intel and Activision
- Community-maintained implementations in various engines

## Relationship to SSILVB

SSILVB (Screen Space Indirect Lighting with Visibility Bitmask) builds directly on GTAO:

- **Maintains:** Efficiency of horizon-based approach
- **Replaces:** Dual-horizon angles with visibility bitmask
- **Adds:** Support for light passing behind thin surfaces
- **Improves:** Indirect lighting quality through better directional encoding
- **Reference:** GTAO's mathematical framework is foundation

The visibility bitmask can be seen as a discretized version of the continuous horizon integral, providing both practical benefits (thin surface handling) and novel capabilities (per-sector weighting for probe integration).

## Related Work References

Papers cited/compared in GTAO:
- HBAO (Kaplanyan & Dachsbacher, 2013)
- SSAO variants
- Screen-space techniques literature
- Ground truth reference ray-tracing

## Parameter Guidance

Common parameter ranges from the paper:

- **Sample Radius:** 1.0 to 5.0 screen units
- **Bias:** Small value (0.01-0.1) to prevent self-occlusion
- **Sample Count:** 2-4 per slice
- **Slice Count:** 2-4 (3 typical)
- **Falloff Distance:** Related to sample radius
- **Thickness:** For self-occlusion prevention
