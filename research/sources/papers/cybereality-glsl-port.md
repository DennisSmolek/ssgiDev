# Cybereality's GLSL Port - Implementation Writeup

**URL:** https://cybereality.com/screen-space-indirect-lighting-with-visibility-bitmask-improvement-to-gtao-ssao-real-time-ambient-occlusion-algorithm-glsl-shader-implementation/

**Topic:** GLSL Implementation of SSILVB with Practical Gotchas  
**Author:** Cybereality  
**Platform:** WebGL (GLSL ES)

## Overview

This writeup documents a practical GLSL/WebGL ES implementation of Screen Space Indirect Lighting with Visibility Bitmask, converting the reference HLSL code to OpenGL ES standards and addressing real-world porting challenges.

## Core Algorithm Description

The technique extends Ground Truth Ambient Occlusion (GTAO) by replacing random hemisphere sampling with horizon-based slice sampling:

> "Rather than taking random samples across a hemisphere, the method divides it into discrete 'slices' that rotate around the surface normal, with linear sampling within each 2D half-disc."

**Key Innovation:** The visibility bitmask "rather than calculating a single angle, it uses a bitmask that allows 'sectors' to be occluded or not." Using a 32-bit unsigned integer provides 32 occlusion sectors, enabling:
- Directional light information
- Improved accuracy over traditional SSAO/GTAO
- Natural support for reflection probe integration

## Implementation Parameters

### Recommended Configuration

- **Sample count:** 4 samples per slice
- **Slice count:** 4 slices per pixel
- **Sample radius:** 4.0 (screen space units)
- **Hit thickness:** 0.5 (for constant-thickness surface handling)

**Rationale:** This balanced configuration provides good quality while maintaining real-time performance.

### Input Requirements

- **Fullscreen position buffer:** View-space positions (texture)
- **Fullscreen normal buffer:** View-space normals (texture)
- **Fullscreen direct lighting buffer:** Pre-computed direct lighting
- **Projection matrix:** For screen-space to world-space conversion

### Output

- **Vec4 Result:**
  - **RGB:** Indirect lighting color (accumulated from sampled light)
  - **A:** Ambient occlusion value (0 to 1)

## Practical Gotchas & Solutions

### 1. Depth Buffer Artifacts

**Problem:**
Traditional screen-space methods treat the z-buffer as if it has infinite thickness behind surface hits, causing:
- False occlusion in transparent or thin geometry
- Harsh halos around silhouettes
- Artifacts on fence-like geometry (trees, railings, curtains)

**Solution (SSILVB Approach):**
The visibility mask assumes constant finite thickness:
```
deltaPosBackface = deltaPos - V * _Thickness
```

**Result:**
- Prevents false occlusion behind thin surfaces
- Natural handling of cloth, curtains, thin walls
- Silhouette halos are eliminated

**Implementation Note:**
The thickness parameter acts as the primary control, not requiring separate distance-based falloff as traditional GTAO does.

### 2. Noise Management

**Problem:** Sampling-based screen-space methods introduce temporal noise and flickering without proper noise handling.

**Solution (Recommended):**
Use **Interleaved Gradient Noise (IGN)** seeded on pixel coordinates:

```glsl
float randf(int x, int y) {
    return mod(52.9829189 * mod(0.06711056 * float(x) + 0.00583715 * float(y), 1.0), 1.0);
}
```

**Application:**
- Seed on `gl_FragCoord.xy` (pixel coordinates)
- Apply to sample offset jitter
- Prevents temporal coherence artifacts
- Maintains noise pattern stability across frames

**Temporal Behavior:**
- Per-pixel noise pattern remains stable
- Avoids flickering across frames
- Compatible with temporal denoisers

### 3. Blur Strategy & Filtering

**Problem:**
Raw per-pixel sampling produces visible noise that impacts perceived quality.

**Solution (Tested Approach):**
Apply dual-filtering post-process:
- **Scale:** Render at 50% resolution (half-width, half-height)
- **Filter:** Bilateral or cross-bilateral filter
- **Blend:** Composite back to full resolution with depth-aware blending

**Benefits:**
- Maintains edge definition
- Reduces noise effectively
- Minimal performance cost
- Preserves fine spatial detail

**Alternative:** Temporal accumulation (requires frame history)

### 4. Light Accumulation - Avoiding Feedback Loops

**Problem:**
When incorporating previous-frame indirect lighting, feedback loops can cause:
- Exponential brightening
- Temporal instability
- Unrealistic light intensification

**Solution (Damping Strategy):**
Dampen previous frame's indirect lighting by ~50% before addition:

```glsl
// Example composition
vec3 indirectLight = texture(indirectBuffer, uv).rgb;
vec3 prevIndirect = texture(previousFrameIndirectBuffer, uv).rgb;

// Apply damping to prevent feedback
vec3 historicalIndirect = prevIndirect * 0.5;  // ~50% damping

vec3 accumulatedIndirect = mix(indirectLight, indirectLight + historicalIndirect, weight);
```

**Rationale:**
- Multiple bounce approximation needs stability
- Damping prevents divergence
- ~50% factor provides good visual stability
- Can be tuned per-scene

### 5. Platform-Specific Considerations (WebGL ES)

**Problem:** WebGL ES has different capabilities than desktop GL/HLSL:
- Limited precision (mediump float in ES 2.0 / 3.0)
- Different built-in functions availability
- Integer operations less optimized

**Solution (GLSL ES 3.0+):**

```glsl
#version 300 es
precision highp float;
precision highp sampler2D;

// Use built-in bitcount for sector counting
uint bitCount(uint value) {
    value = value - ((value >> 1u) & 0x55555555u);
    value = (value & 0x33333333u) + ((value >> 2u) & 0x33333333u);
    return ((value + (value >> 4u) & 0xF0F0F0Fu) * 0x1010101u) >> 24u;
}
```

**Key Decisions:**
- Use `highp` (high precision) for all critical calculations
- Implement bitcount if native instruction unavailable
- Avoid bitwise operations on mediump values

## Complete GLSL Implementation

```glsl
#version 300 es
precision highp float;
precision highp sampler2D;

in vec2 fragUV;
out vec4 fragColor;

uniform sampler2D screenPosition;
uniform sampler2D screenNormal;
uniform sampler2D screenLight;

uniform float sampleCount;
uniform float sampleRadius;
uniform float sliceCount;
uniform float hitThickness;

uniform vec2 screenSize;
uniform mat4 projection;

const float pi = 3.14159265359;
const float twoPi = 2.0 * pi;
const float halfPi = 0.5 * pi;

// Interleaved Gradient Noise function
float randf(int x, int y) {
    return mod(52.9829189 * mod(0.06711056 * float(x) + 0.00583715 * float(y), 1.0), 1.0);
}

// Bit counting function for sector occlusion
uint bitCount(uint value) {
    value = value - ((value >> 1u) & 0x55555555u);
    value = (value & 0x33333333u) + ((value >> 2u) & 0x33333333u);
    return ((value + (value >> 4u) & 0xF0F0F0Fu) * 0x1010101u) >> 24u;
}

const uint sectorCount = 32u;

// Update bitfield sectors based on horizon angle range
uint updateSectors(float minHorizon, float maxHorizon, uint outBitfield) {
    uint startBit = uint(minHorizon * float(sectorCount));
    uint horizonAngle = uint(ceil((maxHorizon - minHorizon) * float(sectorCount)));
    uint angleBit = horizonAngle > 0u ? uint(0xFFFFFFFFu >> (sectorCount - horizonAngle)) : 0u;
    uint currentBitfield = angleBit << startBit;
    return outBitfield | currentBitfield;
}

vec4 getVisibility() {
    uint indirect = 0u;
    uint occlusion = 0u;

    float visibility = 0.0;
    vec3 lighting = vec3(0.0);
    vec2 frontBackHorizon = vec2(0.0);
    vec2 aspect = screenSize.yx / screenSize.x;
    
    vec3 position = texture(screenPosition, fragUV).rgb;
    vec3 camera = normalize(-position);
    vec3 normal = normalize(texture(screenNormal, fragUV).rgb);

    float sliceRotation = twoPi / (sliceCount - 1.0);
    float sampleScale = (-sampleRadius * projection[0][0]) / position.z;
    float sampleOffset = 0.01;
    float jitter = randf(int(gl_FragCoord.x), int(gl_FragCoord.y)) - 0.5;

    // Slice iteration loop
    for (float slice = 0.0; slice < sliceCount + 0.5; slice += 1.0) {
        float phi = sliceRotation * (slice + jitter) + pi;
        vec2 omega = vec2(cos(phi), sin(phi));
        vec3 direction = vec3(omega.x, omega.y, 0.0);
        vec3 orthoDirection = direction - dot(direction, camera) * camera;
        vec3 axis = cross(direction, camera);
        vec3 projNormal = normal - axis * dot(normal, axis);
        float projLength = length(projNormal);

        float signN = sign(dot(orthoDirection, projNormal));
        float cosN = clamp(dot(projNormal, camera) / projLength, 0.0, 1.0);
        float n = signN * acos(cosN);

        // Sample iteration loop
        for (float currentSample = 0.0; currentSample < sampleCount + 0.5; currentSample += 1.0) {
            float sampleStep = (currentSample + jitter) / sampleCount + sampleOffset;
            vec2 sampleUV = fragUV - sampleStep * sampleScale * omega * aspect;
            vec3 samplePosition = texture(screenPosition, sampleUV).rgb;
            vec3 sampleNormal = normalize(texture(screenNormal, sampleUV).rgb);
            vec3 sampleLight = texture(screenLight, sampleUV).rgb;
            vec3 sampleDistance = samplePosition - position;
            float sampleLength = length(sampleDistance);
            vec3 sampleHorizon = sampleDistance / sampleLength;

            // Front and back surface horizon calculation
            frontBackHorizon.x = dot(sampleHorizon, camera);
            frontBackHorizon.y = dot(normalize(sampleDistance - camera * hitThickness), camera);

            // Convert to horizon angles
            frontBackHorizon = acos(frontBackHorizon);
            frontBackHorizon = clamp((frontBackHorizon + n + halfPi) / pi, 0.0, 1.0);

            // Update occlusion bitmask
            indirect = updateSectors(frontBackHorizon.x, frontBackHorizon.y, 0u);
            
            // Accumulate lighting with directional weighting
            lighting += (1.0 - float(bitCount(indirect & ~occlusion)) / float(sectorCount)) *
                sampleLight * clamp(dot(normal, sampleHorizon), 0.0, 1.0) *
                clamp(dot(sampleNormal, -sampleHorizon), 0.0, 1.0);
            
            // Accumulate occlusion across all samples
            occlusion |= indirect;
        }
        
        // Accumulate visibility per slice
        visibility += 1.0 - float(bitCount(occlusion)) / float(sectorCount);
    }

    // Average results
    visibility /= sliceCount;
    lighting /= sliceCount;

    return vec4(lighting, visibility);
}

void main() {
    fragColor = getVisibility();
}
```

## Performance & Results

### Measured Performance

**Hardware:** AMD 6950XT GPU  
**Resolution:** 1080p (rendered at 50% scale = 540p)  
**Frame Time:** ~1.1 milliseconds per frame  

**Configuration:** 4 slices × 4 samples = 16 ray-march operations per pixel

### Quality Characteristics

- **Subtle Grounding Effect:** Objects are naturally grounded with bounced light color
- **Directional Quality:** Light direction information preserved through bitmask sectors
- **Tone Shift:** Improvement through color hue shifts rather than obvious highlights
- **Artifact Handling:** Constant-thickness approach naturally reduces halos and false occlusion

## Lighting Composition Strategy

**Key Insight from Implementation:**

> "If you use float colors, you can add 1.0 to the indirect lighting result, and then simply multiply this by your standard lighting when you draw."

**Implementation Pattern:**

```glsl
// Assuming you have:
// - directLighting: standard forward/deferred lighting result
// - indirectLighting: SSILVB result (can be > 1.0)

vec3 finalColor = directLighting * (1.0 + indirectLighting);
```

**Advantages of this Approach:**
- Boosts intensity naturally through multiplication
- Color hues from indirect light naturally blend
- Reduces feedback loop artifacts
- More stable than simple additive blending

**Alternative (Simpler but Less Sophisticated):**
```glsl
vec3 finalColor = directLighting + indirectLighting;
```

## Denoising Recommendations

For production use, the author recommends:

1. **Temporal Accumulation:** Store results across frames, blend with damping
2. **Spatial Filtering:** Bilateral or cross-bilateral filter
3. **Hybrid Approach:** Screen-space detail + probe-based robustness
4. **Resolution Scaling:** Render at lower resolution, upsample with edge preservation

## Conclusion & Practical Notes

This GLSL port demonstrates:
- Feasibility of SSILVB on WebGL platforms
- Practical solutions to common screen-space issues (halos, noise, feedback)
- High efficiency with modern GPU features (bitcount, integer math)
- Natural integration with existing real-time rendering pipelines

The constant-thickness model and visibility bitmask are the key innovations enabling both better visual quality and computational efficiency compared to traditional GTAO implementations.
