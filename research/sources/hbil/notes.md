# HBIL (Horizon-Based Indirect Lighting) - Research Notes

## File Map

### Documentation
- README.md - Overview and build instructions
- MIT-0.txt - License (MIT-0/Unlicense)

### Core Implementation Files
- Shaders/HBIL/HBIL.hlsl - Main HBIL algorithm with horizon marching and radiance integration
- Shaders/HBIL/ComputeHBIL_BruteForce.hlsl - Full per-pixel HBIL computation (16 angles x 16 samples max)
- Shaders/HBIL/ComputeHBIL_Interleaved.hlsl - Optimized interleaved pattern computation

### Supporting Shaders
- Shaders/Global.hlsl - Global constants and utility functions
- Shaders/ComputeLighting.hlsl - Lighting integration
- Shaders/ComputeReprojection.hlsl - Temporal reprojection for noise reduction
- Shaders/DownSampleDepth.hlsl - Mip chain generation for depth
- Shaders/FastMath.hlsl - Fast approximations (FastAcos)
- Shaders/PostProcess.hlsl - Post-processing and tone mapping
- Shaders/RecomposeBuffers.hlsl - Buffer recomposition from split interleaved buffers
- Shaders/SplitBuffers.hlsl - Split full-res into interleaved sub-buffers
- Shaders/SphericalHarmonics.hlsl - SH coefficient computation and integration
- Shaders/RenderDebugCone.hlsl - Debug visualization of bent-cone results

### Scene Rendering
- Shaders/Scene/Lighting.hlsl - Scene lighting model
- Shaders/Scene/RenderScene.hlsl - 2D scene rendering
- Shaders/Scene/RenderScene3D.hlsl - 3D geometry rendering
- Shaders/Scene/Scene.hlsl - Scene setup
- Shaders/Scene/SceneEkoSewers.hlsl - Eko Sewers test scene
- Shaders/Scene/SceneRayMarchingInfiniteRooms.hlsl - Ray-marched infinite rooms
- Shaders/Scene/SceneRayMarchingLibrary.hlsl - Ray-march library functions
- Shaders/Scene/SceneRayTraceCornell.hlsl - Cornell box ray tracing
- Shaders/Scene/SceneRayTraceHeightfield.hlsl - Heightfield ray tracing
- Shaders/Scene/SceneSchaeffer.hlsl - Schaeffer test scene
- Shaders/Scene/SceneSibenik.hlsl - Sibenik cathedral
- Shaders/Scene/SceneSponza.hlsl - Crytek Sponza atrium
- Shaders/Scene/Specular.hlsl - Specular reflection model

### Temporal Anti-Aliasing
- Shaders/TAA/TemporalAA.hlsl - TAA implementation for noise filtering

### CPU/Debug Code
- ComputeHBIL_SoftwareDebug.cs - CPU software implementation for validation (C#)

---

## Algorithm Summary

**HBIL (Horizon-Based Indirect Lighting)** is a screen-space technique that efficiently computes both ambient occlusion and indirect diffuse lighting by reusing the horizon-marching infrastructure from HBAO (Horizon-Based Ambient Occlusion). The key innovation is that instead of only tracking whether each direction is occluded, HBIL also samples the radiance from visible surfaces and integrates it across the horizon.

The algorithm operates in screen-space, making it a "near-field" complement to far-field indirect lighting from environment probes. For each pixel, it marches rays outward in multiple directions (typically 16 angles around the screen-space circle), tracking the horizon angle as geometry rises up. At each step, it:

1. **Samples depth** to determine the current horizon angle (how much the surface blocks the view)
2. **Checks visibility** via bilateral filtering against normal discontinuities
3. **Samples diffuse radiance** from the previous frame's computed radiance buffer
4. **Integrates radiance** across the horizon slice using solid-angle weighting (Equation 18 from the paper)
5. **Accumulates bent normals** to track the direction of average visibility

Key difference from HBAO: HBIL integrates radiance (multiplied by cosine-weighted solid angle) rather than just counting occlusion. The integration uses analytical formulas for the solid-angle integral between two horizon angles, avoiding expensive numeric integration.

Per the README, the technique achieves ~2.5ms at 1280x720 on a GeForce GTX 680, demonstrating real-time viability. Patapom notes that results are much higher quality than HBAO alone, but noise remains an issue (addressed via temporal reprojection/TAA).

---

## Key Mathematical Concepts

### Horizon Angle Tracking
- Each screen-space direction has a horizon angle θ (angle from horizon plane)
- Horizon advances as geometry occludes the view farther out
- Tracked as cos(θ) to avoid expensive acos() calls

### Irradiance Integration (Equation 18 - Paper)
```
E = Integral[θ0, θ1]{ L(Xi) (Wi.N) sin(θ) dTheta }
```
Where:
- L(Xi) = radiance at neighbor surface location
- Wi = direction vector within the slice (function of azimuth φ and elevation θ)
- N = surface normal at center point (not neighbor!)
- Separates into radiance-agnostic integral form:
  - I = L(Xi) * Integral[θ0, θ1]{ (Wi.N) sin(θ) dTheta }

### Analytical Integral (No Numeric Integration Needed)
The integral decomposes into three component integrals (I0, I1, I2) for X, Y, Z normals respectively:
- I0 = [cos(φ).Nx] * { 1/2 * (θ - sin(θ)cos(θ)) }[θ0,θ1]
- I1 = [sin(φ).Ny] * { 1/2 * (θ - sin(θ)cos(θ)) }[θ0,θ1]
- I2 = Nz * { 1/2 * cos²(θ) }[θ1,θ0]  ← Note reversed bounds

### Bent Normal Integration (Equations 5-6)
Two formulations:
1. **WITH normal influence**: Integrates cos(α) where α = angle between normal and direction
2. **WITHOUT normal influence** (preferred): Pure geometric hemisphere of visibility

Formulas use cubic polynomial terms (cos³θ, sin³θ) for analytical solution without acos().

### Bilateral Filtering
Rejects depth/radiance samples that:
- Exceed depth difference tolerance (adaptive based on surface verticality)
- Have normals facing away from central point
- Are too far from center (distance fade-out after 2 meters)

Prevents color bleeding across edges and depth discontinuities.

---

## Key Parameters & Constants (from Shaders)

### Global Constants (Global.hlsl)
- `PI = 3.1415926535...`
- `TAN_HALF_FOV = 0.6` → FOV = 90° (vertical)
- `Z_FAR = 100.0` (meters) - max depth encoded

### HBIL Computation Constants
- `MAX_ANGLES = 16` - circle subdivisions per pixel (azimuthal samples)
- `MAX_SAMPLES = 16` - max radial steps per direction (can reach full screen)
- `GATHER_SPHERE_MAX_RADIUS_P = 100` pixels (screen-space)

### Quality Tuning Flags (HBIL.hlsl)
- `USE_FAST_ACOS = 1` - Use polynomial FastAcos() instead of true acos() (faster, slightly less accurate)
- `SAMPLE_NEIGHBOR_RADIANCE = 1` - Sample radiance from neighbors (more accurate but costlier)
- `RUNNING_WEIGHT_DIM = 1` - Cumulate bilateral filter rejection to prevent radiance flicker
- `STEP_SIZE_FACTORS = 1` - Constant step sizes (good for IL, poor for AO detail) or variable (e.g., [0.125, 0.25, 0.5, 1.0])
- `USE_NORMAL_INFLUENCE_FOR_AO = 1` - Include cos(angle-to-normal) in AO calculation

### Runtime Parameters (CB_HBIL)
- `_gatherSphereMaxRadius_m` - Radius for irradiance gathering (in meters)
- `_gatherSphereMaxRadius_p` - Radius in pixels
- `_temporalAttenuationFactor` - How much to weight previous frame's radiance
- `_bilateralValues` - Tolerance thresholds for bilateral filtering

### Camera & Projection (Global.hlsl / CB_Camera)
- `_resolution` - Viewport dimensions
- `_camera2World, _world2Camera` - Transformation matrices
- `_proj2World, _world2Proj` - Projection matrices
- `_ZNearFar_Q_Z` - Near/far clipping planes and Q factor for depth reconstruction
- `_cameraSubPixelOffset` - For TAA jitter handling

### Previous Frame Data (for Reprojection)
- `_previousWorld2Proj` - Last frame's world-to-projection matrix
- `_previoucCamera2CurrentCamera`, `_currentCamera2PrevioucCamera` - Camera motion tracking

### Spherical Harmonics (CB_SH)
- `_SH[9]` - 9 SH coefficients (3×3 matrix, L0-L2 bands) for environment probe contribution

---

## Algorithm Pipeline Overview

1. **Depth & Normal G-Buffer Pass** → Generate/downsampled MIP levels
2. **HBIL Compute Pass** (per-pixel or interleaved pattern):
   - For each azimuthal direction (16 angles):
     - March forward & backward radially (up to 16 steps each, can extend to screen edges)
     - Track horizon angle advancement
     - Sample & integrate radiance via bilateral filtering
     - Accumulate bent normal direction
3. **Buffer Recomposition** (if using interleaved):
   - Gather interleaved samples back into full-resolution radiance & bent-cone buffers
4. **Temporal Reprojection**:
   - Reproject previous frame's radiance to current view via motion matrices
   - Blend with current frame result for temporal coherence
5. **Rendering**:
   - Sample bent-cone (radiance + cone angle/AO) from HBIL buffer
   - Apply to scene lighting

---

## Known Issues & Limitations

### Noise
- Temporal reprojection + TAA required for acceptable quality
- TAA can introduce blur; author notes "plenty of room for improvement"

### AO Precision vs. Indirect Lighting Trade-off
- Large step sizes = poor AO detail but good far-field IL
- Small step sizes = detailed AO but weak IL
- Ideal solution would require *more samples* (the core speed limiting factor)

### Screen-Space Limitations
- No off-screen reflections (solved by combining with far-field probes)
- Radiance from outside screen bounds not available
- Architecture designed to complement environment-map indirect lighting

### Optimization Opportunities
- Reprojection of normals/directions recomputed unnecessarily each frame
- Radiance history buffer reuse (mix of diffuse+specular) not fully correct but acceptable
- Bypass reprojection for single-bounce approximation possible

---

## Discovered Links

None of the extracted TestHBIL files reference external patapom.com URLs. However, the README references:
- **Main Research Paper**: "2018 Mayaux - Horizon-Based Indirect Lighting (HBIL).pdf" (included in repo but not extracted here as it's binary)
- **Author**: Patapom (https://twitter.com/Patapom2)

The technique is an extension of Horizon-Based Ambient Occlusion (HBAO), documented in:
- Bavoil & Sainz, "Image-Space Horizon-Based Ambient Occlusion" (GDC 2008)

Supporting math references within shaders:
- Frisvad 2012 - Orthonormal basis construction
- Abramowitz & Stegun - FastAcos polynomial coefficients (Handbook of Mathematical Functions)
- NVIDIA Cg Documentation - Original FastAcos source

---

## Integration Notes for Visibility-Bitmask Successor

Per the task description, this HBIL implementation "keeps horizon angles" as continuous values (cos(θ)). A later visibility-bitmask approach would:
- Replace floating-point horizon angles with quantized bitmasks (e.g., 8 or 16 bits per angle)
- Trade some precision for reduced memory/bandwidth
- Maintain or improve performance through better cache coherency
- Still integrate radiance if radiance texture address remains accessible

The analytical integration formulae in HBIL.hlsl would transfer directly; only the horizon angle storage changes.
