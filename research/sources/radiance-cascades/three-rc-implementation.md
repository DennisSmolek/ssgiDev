# three-rc — CodyJasonBennett's 3D Radiance Cascades (three.js + three-mesh-bvh)

- Repo: https://github.com/CodyJasonBennett/three-rc
- **This is the single most relevant implementation found for this project** — same stack (three.js), same problem (3D GI without temporal accumulation), and it directly implements a screen-space-probe / world-space-interval hybrid.

## Repo structure (via `gh api .../git/trees/main`)
```
index.html
package.json / yarn.lock
public/sponza.glb        # test scene = Crytek Sponza
src/index.js             # ~843 lines, entire implementation
```
JS 98.4% / HTML 1.6%. 76 commits on main. **No license** — explicitly because the depth-aware upscaler (credited to Alexander Sannikov personally) "cannot be licensed due to restrictions." Practical implication: this code can be *read* for reference but treat re-use of the upscaler specifically as legally encumbered.

## Technical approach (confirmed by reading `src/index.js` directly)

- Screen-space probes, fixed-cost storage in a screen-sized cascade texture.
- Two selectable tracing backends:
  1. **BVH-based** (via `three-mesh-bvh`) — traces true world-space ray intervals, so it *does* capture offscreen occluders/emitters. This is the "world-space radiance intervals" half of Sannikov's "Screen Space Probes with World Space Radiance Intervals" (SPWI) approach from the paper.
  2. **Screen-space raycasting** — adapted from Tiny Glade's screen-space raymarcher; faster, but sacrifices modeling of offscreen geometry (the same tradeoff called out in the paper's Limitations section and the HN thread).
- Depth-aware upscaler (Sannikov's, unlicensed) reconstructs full-res diffuse+specular GI from the sparse probe grid without temporal accumulation.

### Key constants and probe/cascade math (from `src/index.js`)
```js
const BASE_INTERVAL_LENGTH = 0.005
const PROBE_SPACING = 4
```
```glsl
float getIntervalScale(int cascadeLevel) {
  if (cascadeLevel == 0) return 0.0;
  return pow(float(ANGULAR_FACTOR), float(cascadeLevel));
}
vec2 getIntervalRange(int cascadeLevel) {
  return intervalLength * vec2(getIntervalScale(cascadeLevel), getIntervalScale(cascadeLevel + 1));
}
```
Probe grid derivation ties tile size directly to screen pixels, exactly the "surface radiance" case from the paper's scaling analysis:
```glsl
// Probe parameters for cascade N
int tileSize      = probeSpacing * (1 << cascadeLevel);
int raysPerDim    = (1 << (cascadeLevel + 2));
ivec2 probeGridSize = (ivec2(resolution) + tileSize - 1) / tileSize;

// Interval parameters at cascade N
vec2 probeUV    = (vec2(pixel % probeGridSize) + 0.5) / vec2(probeGridSize);
float probeDepth = linearizeDepth(textureLod(depthTexture, probeUV, float(cascadeLevel)).r);
vec3 worldPos   = getWorldPosition(probeUV, probeDepth);
```
Merge step (cascade N+1 → N), 4-probe bilinear gather with clamped indices at grid edges:
```glsl
vec2 upperProbeCoord = probeUV * vec2(upperProbeGridSize) - 0.5;
ivec2 upperProbeBase = ivec2(floor(upperProbeCoord));
vec2 upperProbeFrac  = fract(upperProbeCoord);
ivec2 probeCoords[4];
for (int probeIndex = 0; probeIndex < 4; probeIndex++) {
  probeCoords[probeIndex] = clamp(upperProbeBase + getBilinearOffset(probeIndex), ivec2(0), ivec2(upperProbeGridSize - 1));
  ...
}
```
A modified BVH intersection function supports a **min/max ray interval** (`rayInterval: vec2`) directly — i.e. the three-mesh-bvh traversal was patched specifically to support Sannikov-style bounded radiance intervals rather than unbounded ray casts:
```glsl
bool intersectTrianglesInterval(
  sampler2D positionAttr, usampler2D indexAttr, uint offset, uint count,
  vec3 rayOrigin, vec3 rayDirection, vec2 rayInterval,
  inout float minDistance, inout uvec4 faceIndices, inout vec3 faceNormal, inout vec3 barycoord,
  inout float side, inout float dist
) { ... }
```
Comment in source: "Modified to support min/max ray interval. Min is ignored to avoid misses with multi-bounce tracing." — a practical note on a subtlety (min-interval clipping vs. multi-bounce) not discussed in the paper itself.

## Classification for this project's taxonomy
**Screen-space probes + world-space (BVH) OR screen-space raymarched intervals, selectable.** Not 2D flatland. This is the reference implementation to study for a three.js WebGPU SSGI + RC hybrid.
