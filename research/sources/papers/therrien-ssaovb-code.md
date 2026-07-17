# Therrien's SSAO with Visibility Bitmasks - Implementation Blog Post

**URL:** https://cdrinmatane.github.io/posts/ssaovb-code/  
**Author:** Olivier Therrien  
**Topic:** SSAO Using Visibility Bitmasks - Reference HLSL Implementation

## Overview

This technical blog post presents a reference implementation of screen-space ambient occlusion enhanced with visibility bitmasks, improving upon the traditional GTAO (Ground Truth Ambient Occlusion) approach by replacing dual horizon angle tracking with a bitfield-based sector system.

## Core Concept

The method "allows light to pass behind surfaces of constant thickness while keeping the efficiency of horizon-based methods." Rather than tracking two horizon angles per slice, the enhanced version:

- Passes an `inout uint globalOccludedBitfield` through the horizon calculation loop
- Marks occluded sectors in the bitfield
- Computes integral as: `1.0 - float(countbits(globalOccludedBitfield)) / float(SECTOR_COUNT)`

## Algorithm Description

### Original GTAO Loop Structure

The base GTAO implementation iterates through sampling directions:
- Compute projected normals onto slice planes
- Find maximum horizon elevations on each side of the view vector
- Accumulate occlusion based on horizon angles
- Weight by cosine of angle

### Visibility Bitmask Modification

The enhanced version modifies the core loop:

**1. Bitfield Initialization:**
```
uint globalOccludedBitfield = 0u;
```

**2. Horizon Loop with Bitfield Update:**
- Call modified `HorizonLoop()` function with bitfield as inout parameter
- Each call marks additional occluded sectors
- Accumulate occlusion across all samples

**3. Occlusion Calculation:**
```
float occlusion = 1.0 - float(countbits(globalOccludedBitfield)) / float(SECTOR_COUNT);
```

## Front/Back Face Calculation

A critical aspect is handling surfaces with constant thickness:

```
deltaPosBackface = deltaPos - V * _Thickness
```

This creates a thickness-offset backface sample for computing occlusion ranges:

- **Front surface:** `horizon_front = normalize(deltaPos - position)`
- **Back surface:** `horizon_back = normalize(deltaPos - position - viewDirection * thickness)`
- **Horizon range:** The angular span between these two horizons

The thickness parameter accounts for finite-thickness geometry like curtains, cloth, or thin walls, which would otherwise be incorrectly treated as infinitely thick in traditional GTAO.

## Sector Activation Logic

The `UpdateSectors()` function maps horizon angle ranges to bitfield sectors:

**Input:**
- `minHorizon`: Lower horizon angle (normalized to [0, 1])
- `maxHorizon`: Upper horizon angle (normalized to [0, 1])
- `outBitfield`: Current bitfield state

**Algorithm:**
```
uint startBit = uint(minHorizon * float(SECTOR_COUNT));
uint horizonAngle = uint(ceil((maxHorizon - minHorizon) * float(SECTOR_COUNT)));
uint angleBit = (horizonAngle > 0u) ? 
    uint(0xFFFFFFFFu >> (SECTOR_COUNT - horizonAngle)) : 0u;
uint currentBitfield = angleBit << startBit;
return outBitfield | currentBitfield;
```

**Rounding Strategy Impact:**

Different rounding methods affect sensitivity to partial-sector coverage:

- **`ceil()`:** Sector is marked as occluded if touched anywhere in horizon range
  - Most sensitive to occlusion
  - Better detail preservation
  - May introduce more aliasing

- **`round()`:** Sector marked if coverage >= 50%
  - Balanced approach
  - Good for most content

- **`floor()`:** Sector marked only if fully covered
  - Most permissive (less occlusion)
  - Smoother results
  - May miss subtle occlusion

## Performance Consideration

The visibility bitmask approach achieves an important computational advantage:

> "The constant thickness and the bitmask is enough to reproduce the attenuation over the distance in a plausible manner," eliminating the need for traditional distance-based falloff calculations required in standard GTAO.

**Implications:**
- No separate distance-weighting calculation needed
- Thickness parameter implicitly handles distance falloff
- Reduces computational overhead
- Maintains visual quality through simpler formulation

## Implementation Details

### Memory Efficiency
- Single `uint` per evaluation (32-bit)
- One bit per sector
- Matches GPU native bitcount instruction
- Minimal register pressure

### Numerical Stability
- Bitwise operations are exact (no floating-point precision loss)
- Bitcount is a native GPU instruction (very fast)
- No division needed until final step

### Parallelization
- Bitfield OR operation is commutative and associative
- Can accumulate sectors in any order
- Supports parallel sample collection

## Reference HLSL Code Structure

Based on the blog post implementation:

**Pseudo-code structure:**
```hlsl
// Assume texture definitions and uniforms available
// Inputs: screen position, normal, view direction
// Output: ambient occlusion value

uint GlobalOccludedBitfield = 0u;
float accumulator = 0.0;

// Slice loop
for(float slice = 0.0; slice < sliceCount; ++slice) {
    // Determine slice direction
    float angle = (slice / sliceCount) * TWO_PI;
    float3 sliceDir = float3(cos(angle), sin(angle), 0.0);
    
    // Sample loop
    for(float sample = 0.0; sample < sampleCount; ++sample) {
        // Offset from current pixel
        float2 sampleOffset = (sample / sampleCount) * sampleRadius * sliceDir.xy;
        float3 samplePos = textureFetch(positionBuffer, pixelCoord + sampleOffset);
        
        // Compute horizon angles
        float3 delta = samplePos - currentPixelPos;
        float3 deltaFront = normalize(delta);
        float3 deltaBack = normalize(delta - viewDir * thickness);
        
        float horizonFront = acos(dot(deltaFront, viewDir));
        float horizonBack = acos(dot(deltaBack, viewDir));
        
        // Normalize to [0, 1]
        float minH = horizonFront / PI;
        float maxH = horizonBack / PI;
        
        // Update sectors
        GlobalOccludedBitfield |= UpdateSectors(minH, maxH);
    }
}

// Final occlusion calculation
float occlusion = 1.0 - float(countbits(GlobalOccludedBitfield)) / 32.0;
```

## Key Technical Insights from Implementation

### 1. Bitfield as Directional Information
The bitmask naturally encodes which directions are occluded, enabling:
- Directional ambient occlusion
- Selective sampling from reflection probes
- Per-sector weighting of indirect light

### 2. Thickness as Primary Control
Rather than separate distance falloff, thickness parameter controls:
- How far light can "bend" around geometry
- Effective occlusion range
- Visual distinction between thin vs. thick surfaces

### 3. Integer Math Advantage
Using bitwise operations provides:
- Exact computation without float precision issues
- GPU-friendly (native instructions)
- Cache-efficient bitcount operation

### 4. Sample Accumulation Pattern
Unlike traditional horizon angles (which require two channels), bitmask accumulates with OR:
- Monotonically increases certainty
- No need for min/max tracking
- Supports incremental sample collection

## Relationship to Paper

This implementation demonstrates the Algorithm 1 from the SSILVB paper (arXiv 2301.11376):
- Reference code validates paper's mathematical formulation
- Shows practical parameter ranges (slice count, sample count, thickness)
- Illustrates the computational efficiency gain over traditional GTAO

## Related Materials

- **Paper:** https://arxiv.org/abs/2301.11376 (arXiv 2301.11376)
- **Presentation:** CG Spotlight #5 (May 31, 2023)
- **GLSL Port:** cybereality.com implementation with additional optimizations
