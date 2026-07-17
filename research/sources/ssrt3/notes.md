# SSRT3 Source Extraction - Notes

## File Map

### Documentation
- **README.md** - Main project documentation with overview, features, limitations, installation, usage instructions, and algorithm explanation with images.

### C# Scripts
- **HDRP/Scripts/SSRT_HDRP.cs** - Main settings/volume component class. Defines all tunable parameters, render passes enum, compute shader dispatch logic, temporal accumulation, denoising pass coordination, and texture buffer management.
- **HDRP/Scripts/SSRTToggle.cs** - Debug/testing utility class for keyboard shortcuts to toggle SSRT on/off and switch between debug visualization modes (GI, AO, combined).
- **HDRP/Scripts/SimpleCameraController.cs** - Example camera controller for the demo scene; handles input and smooth camera movement/rotation.

### Shader Files
- **HDRP/Shaders/Resources/SSRT.shader** - Main post-process shader. Contains passes for temporal reprojection, denoising, depth/normal/light pyramid sampling, and debug visualization (AO, GI, combined). Uses HDR pyramid textures and performs temporal clamping.
- **HDRP/Shaders/Resources/SSRTCS.compute** - Main compute shader implementing the horizon-based ray-marching algorithm. Performs GTAO-based sampling with 32-bit bitmask for thin-surface handling, integrates fallback sampling from APV/reflection probes, applies GI/AO calculations.
- **HDRP/Shaders/Resources/DiffuseDenoiser.compute** - Bilateral filter denoiser (reused from HDRP SSGI). Performs point distribution generation and edge-aware filtering to reduce noise in the GI result.

### Other
- **HDRP/Classroom/Shaders/SG-HDRP-Lit/README.md** - Shader Graph version of HDRP/Lit shader used in the demo scene.

---

## Settings/Tunables Reference

All parameters are defined in `SSRT_HDRP.cs` as VolumeParameter properties. Listed with property name, C# type, default value, and tooltip.

### Sampling Section
| Property | Type | Default | Tooltip |
|----------|------|---------|---------|
| `rotationCount` | `ClampedIntParameter` | 1 (range 1-4) | Number of per-pixel hemisphere slices. This has a big performance cost and should be kept as low as possible. |
| `stepCount` | `ClampedIntParameter` | 12 (range 1-32) | Number of samples taken along one side of a given hemisphere slice. The total number of samples taken per pixel is rotationCount * stepCount * 2. This has a big performance cost and should be kept as low as possible. |
| `radius` | `ClampedFloatParameter` | 5.0 (range 1.0-25.0) | Effective sampling radius in world space. AO and GI can only have influence within that radius. |
| `expFactor` | `ClampedFloatParameter` | 1.0 (range 1.0-3.0) | Controls samples distribution. Exp Factor is an exponent applied at each step get increasing step size over the distance. |
| `jitterSamples` | `BoolParameter` | true | Applies some noise on sample positions to hide the banding artifacts that can occur when there is undersampling. |
| `screenSpaceSampling` | `BoolParameter` | false | Makes the sample distance in view space instead of world-space (helps having more detail up close). |
| `mipOptimization` | `BoolParameter` | true | Use lower mip maps over the distance to use less GPU bandwidth. |

### GI Section (Global Illumination)
| Property | Type | Default | Tooltip |
|----------|------|---------|---------|
| `GIIntensity` | `ClampedFloatParameter` | 10.0 (range 0.0-100.0) | Intensity of the indirect diffuse light. |
| `multiBounceGI` | `ClampedFloatParameter` | 0.0 (range 0.0-1.0) | Intensity of the light for second and subsequent bounces. |
| `normalApproximation` | `BoolParameter` | false | Guess what normal should be based on sample position. This avoids reading normals from the G-Buffer for every sample and saves some GPU bandwidth. |
| `backfaceLighting` | `ClampedFloatParameter` | 0.0 (range 0.0-1.0) | How much light backface surfaces emit. |

### Occlusion Section (Ambient Occlusion)
| Property | Type | Default | Tooltip |
|----------|------|---------|---------|
| `AOIntensity` | `ClampedFloatParameter` | 1.0 (range 0.0-4.0) | Power function applied to AO to make it appear darker/lighter. |
| `thickness` | `ClampedFloatParameter` | 1.0 (range 0.01-10.0) | Constant thickness value of objects on the screen in world space. Allows light to pass behind surfaces past that thickness value. |
| `linearThickness` | `BoolParameter` | false | Increase thickness linearly over distance (avoid losing detail over the distance). |
| `multiBounceAO` | `BoolParameter` | false | Multi-Bounce analytic approximation from GTAO. |

### Off-screen Fallback Section
| Property | Type | Default | Tooltip |
|----------|------|---------|---------|
| `fallback` | `FallbackParameter` | Fallback.None | Source for off-screen lighting. Enum: None, AdaptiveProbeVolume, ReflectionProbe. |
| `fallbackPower` | `ClampedFloatParameter` | 1.0 (range 1.0-4.0) | Power function applied to ambient source to make it appear darker/lighter. |
| `fallbackIntensity` | `ClampedFloatParameter` | 1.0 (range 0.0-10.0) | Intensity of the ambient light coming from a fallback source. |
| `fallbackSampleCount` | `FallbackSampleCountParameter` | FallbackSampleCount._4 | Number of samples per rotation taken in the ambient source. Higher number can give more correct ambient estimation, but is more taxing on performance. Enum: _2, _4, _8, _16, _32. |
| `reflectSky` | `BoolParameter` | false | If enabled, ambient sampling done outside of the influence shape of the reflection probes will use the sky light instead (Used only when using reflection probe fallback). |

### Filters Section (Post-processing)
| Property | Type | Default | Tooltip |
|----------|------|---------|---------|
| `temporalAccumulation` | `BoolParameter` | true | Enable/Disable temporal reprojection. |
| `temporalResponse` | `ClampedFloatParameter` | 0.35 (range 0.0-1.0) | Controls the speed of the accumulation, slower accumulation is more effective at removing noise but can introduce ghosting. |
| `denoising` | `BoolParameter` | true | Enable/Disable diffuse denoiser. |
| `denoisingRadius` | `ClampedFloatParameter` | 0.5 (range 0.0-1.0) | Controls the radius of the GI denoiser. |

### Debug Section
| Property | Type | Default | Tooltip |
|----------|------|---------|---------|
| `debugMode` | `DebugModeParameter` | DebugMode.None | View of the different SSRT buffers for debug purposes. Enum: None, AO, GI. |
| `lightOnly` | `BoolParameter` | false | If enabled only the radiance that affects the surface will be displayed, if unchecked radiance will be multiplied by surface albedo. |

### Enable Toggle
| Property | Type | Default | Tooltip |
|----------|------|---------|---------|
| `enabled` | `BoolParameter` | false | Global on/off switch for the SSRT effect. |

---

## Architecture Summary

SSRT3 is a horizon-based screen-space global illumination algorithm for HDRP that runs in deferred mode only. The main render pipeline consists of five sequential stages:

1. **Pyramid Generation** (SSRT.shader passes 8-10): Depth, normal, and light pyramids are generated with mipmaps from the G-Buffer and previous frame lighting to enable mip-optimized sampling at distance.

2. **Main SSRT Ray-March** (SSRTCS.compute kernel CSMain): Performs horizon-based hemisphere sampling per pixel with rotation count and step count parameters. Each sample checks the depth pyramid to detect occlusion. A novel 32-bit bitmask tracks multiple elevation angles to handle thin surfaces and light transmission. Result is GI radiance (RGB) and AO factor (alpha).

3. **Temporal Reprojection** (SSRT.shader pass 3): Reprojected previous frame data is blended with current frame using motion vectors. Includes color clamping using neighborhood min/max to reduce ghosting artifacts.

4. **Bilateral Denoising** (DiffuseDenoiser.compute bilateral filter): Edge-aware bilateral filter reduces noise in the temporal accumulation output using point distribution sampling and depth/normal discontinuity awareness.

5. **Final Composite** (SSRT.shader passes 4-7): Multiplies denoised GI by surface albedo and adds optional multi-bounce AO approximation from GTAO paper. Atmospheric scattering can be applied in combined debug mode.

Off-screen lighting fallback to Adaptive Probe Volumes (APV) or reflection probes is integrated into the main ray-march kernel to ensure stable illumination outside the screen bounds. Tunable parameters control sampling radius, occlusion thickness (enabling light transmission through thin surfaces), quality/performance tradeoffs, and filter characteristics.

---

## Discovered Links

- **Activision GTAO Paper**: https://www.activision.com/cdn/research/s2016_pbs_activision_occlusion.pptx
  - Source of ground-truth ambient occlusion techniques and multi-bounce AO approximations used in SSRT3.

- **Quantum Break Global Illumination**: http://wili.cc/research/quantum_break/
  - Multi-scale global illumination approach that inspired the horizon-based sampling methodology.

- **HDRP SSGI Documentation**: https://docs.unity3d.com/Packages/com.unity.render-pipelines.high-definition@14.0/manual/Override-Screen-Space-GI.html
  - Unity's screen-space global illumination implementation; SSRT3 reuses denoiser and fallback logic from HDRP's version.

- **MaxwellGengYF GTAO Unity Implementation**: https://github.com/MaxwellGengYF/Unity-Ground-Truth-Ambient-Occlusion
  - Reference GTAO implementation for Unity that influenced SSRT3's occlusion computation.

- **Horizon-Based Indirect Lighting (HBIL) Paper**: https://github.com/Patapom/GodComplex/blob/master/Tests/TestHBIL/2018%20Mayaux%20-%20Horizon-Based%20Indirect%20Lighting%20(HBIL).pdf
  - Foundational horizon-based lighting paper by Benoît "Patapom" Mayaux.

- **Compact Normal Storage**: https://aras-p.info/texts/CompactNormalStorage.html
  - Spheremap transform encoding technique used for normal pyramid compression in SSRT.shader.

- **Interleaved Gradient Noise**: http://goo.gl/eomGso
  - Jimenez 2014 paper on gradient-based noise patterns used for jittered sampling.

- **CDRIN Graphics R&D**: https://www.cdrin.com/
  - Studio responsible for SSRT3 development.

- **Blender Classroom Demo Scene**: https://www.blender.org/download/demo-files/
  - CC0 licensed Classroom scene from Christophe Seux used in the project demo.

- **Unity ScriptableRenderPipeline Repository**: https://github.com/Unity-Technologies/ScriptableRenderPipeline
  - Public HDRP documentation and reference implementation.

---

## Extract Metadata
- **Repository**: https://github.com/cdrinmatane/SSRT3
- **Tested on**: Unity 2021.2.17f1 with HDRP 12
- **License**: See original repo (not included in this extract)
- **Extract Date**: 2026-07-17
- **Files Extracted**: 8 total (1 README root + 3 C# scripts + 3 shader files + 1 README for shader graph)
