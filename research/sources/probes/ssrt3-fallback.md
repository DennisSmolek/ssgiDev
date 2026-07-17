# SSRT3's off-screen fallback: how it actually works

Sources (local clone already present in this repo):
- `research/sources/ssrt3/HDRP/Scripts/SSRT_HDRP.cs` — Unity `CustomPostProcessVolumeComponent` exposing the fallback controls.
- `research/sources/ssrt3/HDRP/Shaders/Resources/SSRTCS.compute` — the compute shader where sampling, occlusion-bitmask, and fallback all happen.
- `research/sources/ssrt3/HDRP/Shaders/Resources/SSRT.shader` — composite/debug passes (fog, multi-bounce AO, final blit). No fallback logic lives here; it only consumes the GI buffer that `SSRTCS.compute` already baked the fallback into.
- Upstream repo: https://github.com/cdrinmatane/SSRT3 (same file layout under `HDRP/`).

## 1. The controls (C#, `SSRT_HDRP.cs`)

```csharp
public enum Fallback { None, AdaptiveProbeVolume, ReflectionProbe}
public enum FallbackSampleCount { _2 = 2, _4 = 4, _8 = 8, _16 = 16, _32 = 32}
...
[Header("Off-screen Fallback")]
[Tooltip("Source for off-screen lighting.")]
public FallbackParameter fallback = new FallbackParameter(Fallback.None);
[Tooltip("Power function applied to ambient source to make it appear darker/lighter.")]
public ClampedFloatParameter fallbackPower = new ClampedFloatParameter(1.0f, 1.0f, 4.0f);
[Tooltip("Intensity of the ambient light coming from a fallback source.")]
public ClampedFloatParameter fallbackIntensity = new ClampedFloatParameter(1.0f, 0.0f, 10.0f);
[Tooltip("Number of samples per rotation taken in the ambient source. Higer number can give more correct ambient estimation, but is more taxing on performance.")]
public FallbackSampleCountParameter fallbackSampleCount = new FallbackSampleCountParameter(FallbackSampleCount._4);
[Tooltip("If enabled, ambient sampling done outside of the influence shape of the reflection probes will use the sky light instead (Used only when using reflection probe fallback).")]
public BoolParameter reflectSky = new BoolParameter(false);
```

These are wired into the compute shader as **shader keywords + uniforms**, not a separate pass:

```csharp
// Fallback parameters
cmd.SetKeyword(ssrtCS, new LocalKeyword(ssrtCS, "FALLBACK_REFLECTION_PROBE"), fallback.value == Fallback.ReflectionProbe);
cmd.SetKeyword(ssrtCS, new LocalKeyword(ssrtCS, "FALLBACK_APV"), fallback.value == Fallback.AdaptiveProbeVolume);
cmd.SetKeyword(ssrtCS, new LocalKeyword(ssrtCS, "FALLBACK_NONE"), fallback.value == Fallback.None);
cmd.SetComputeFloatParam(ssrtCS, "_FallbackPower", fallbackPower.value);
cmd.SetComputeFloatParam(ssrtCS, "_FallbackIntensity", fallbackIntensity.value);
cmd.SetComputeIntParam(ssrtCS, "_FallbackSampleCount", (int)fallbackSampleCount.value);
cmd.SetKeyword(ssrtCS, new LocalKeyword(ssrtCS, "REFLECT_SKY"), reflectSky.value);
```

`Fallback` is a tri-state exclusive choice (None / APV / ReflectionProbe), enforced with `#pragma multi_compile_local FALLBACK_NONE FALLBACK_APV FALLBACK_REFLECTION_PROBE` at the top of `SSRTCS.compute`. `reflectSky` is an independent bit that only matters in the ReflectionProbe branch.

## 2. Where it runs: same pass as the horizon march, per-slice, after the two-sided sweep

Everything happens inside the single `CSMain` kernel of `SSRTCS.compute` — there is **no separate fallback pass**. Per pixel, per rotation ("slice"):

```hlsl
UNITY_LOOP
for (int i = 0; i < _RotationCount; i++)
{
    float rotationAngle = (i + noiseDirection + _TemporalDirections) * (PI / (float)_RotationCount);
    float3 sliceDir = float3(float2(cos(rotationAngle), sin(rotationAngle)), 0);
    ...
    uint globalOccludedBitfield = 0;

    float3 planeNormal = normalize(cross(sliceDir, viewDir));
    float3 tangent = cross(viewDir, planeNormal);
    float3 projectedNormal = normalVS - planeNormal * dot(normalVS, planeNormal);
    float3 projectedNormalNormalized = normalize(projectedNormal);
    float3 realTangent = cross(projectedNormalNormalized, planeNormal);

    float cos_n = clamp(dot(projectedNormalNormalized, viewDir), -1, 1);
    float n = -sign(dot(projectedNormal, tangent)) * acos(cos_n);

    col += HorizonSampling(true,  radius, posVS, slideDir_TexelSize, initialRayStep, uv, viewDir, normalVS, n, globalOccludedBitfield, planeNormal);
    col += HorizonSampling(false, radius, posVS, slideDir_TexelSize, initialRayStep, uv, viewDir, normalVS, n, globalOccludedBitfield, planeNormal);

    ao += float(countbits(globalOccludedBitfield)) / float(MAX_RAY);

    uint globalOccludedBitfieldCopy = globalOccludedBitfield;
    for (uint j = 0; j < _FallbackSampleCount; j++)
    {
        uint maskSize = MAX_RAY/_FallbackSampleCount;
        uint mask = 0xFFFFFFFF >> (MAX_RAY - maskSize);
        uint hitCount = countbits(globalOccludedBitfieldCopy & mask);

        float cosine = (1.0 - ((float(j)+0.5) / _FallbackSampleCount)) * 2.0 - 1.0;
        float angleCosine = GTAOFastAcos(cosine);
        float3 rayDir = normalize(realTangent * cos(angleCosine) + normalVS * sin(angleCosine));

        rayDir = normalize(rayDir - planeNormal * dot(rayDir, planeNormal));
        float3 rayDirWS = mul((float3x3)_CameraToWorldMatrix, float3(rayDir.xy, -rayDir.z));
        float3 cubemapColor = 0;

        #if defined(FALLBACK_APV) && (defined(PROBE_VOLUMES_L1) || defined(PROBE_VOLUMES_L2))
        if(_EnableProbeVolumes)
        {
            BuiltinData apvBuiltinData;
            ZERO_INITIALIZE(BuiltinData, apvBuiltinData);
            EvaluateAdaptiveProbeVolume(GetAbsolutePositionWS(posInput.positionWS),
                rayDirWS,
                -rayDirWS, // Not used
                GetWorldSpaceNormalizeViewDir(posInput.positionWS),
                posInput.positionSS,
                apvBuiltinData.bakeDiffuseLighting,
                apvBuiltinData.backBakeDiffuseLighting); // Not used
            cubemapColor = apvBuiltinData.bakeDiffuseLighting;
        }
        #endif
        #if defined(FALLBACK_REFLECTION_PROBE)
        float weight = 0.0f;
        TraceReflectionProbes(posInput, normalWS, rayDirWS, weight, cubemapColor, ambientMip);
        #if defined(REFLECT_SKY)
        if(weight < 1.0f)
        {
            cubemapColor += SAMPLE_TEXTURECUBE_ARRAY_LOD(_SkyTexture, s_trilinear_clamp_sampler, rayDirWS , 0.0, ambientMip).xyz * (1.0 - weight);
            weight = 1.0;
        }
        #endif
        #endif

        fallbackColor += cubemapColor * saturate(float(maskSize - hitCount) / float(MAX_RAY)) * GetCurrentExposureMultiplier();

        globalOccludedBitfieldCopy >>= maskSize;
    }
}
```
(`SSRTCS.compute` lines 338–419.)

So: **per slice**, after the two `HorizonSampling` sweeps have populated a 32-bit `globalOccludedBitfield` for that slice, the code divides the *same* 32-bit mask into `_FallbackSampleCount` contiguous bit-ranges (`maskSize = MAX_RAY/_FallbackSampleCount`), and for each range fires one fallback sample. This directly implements the paper's "divide the hemisphere into K subregions" idea — the K subregions are literally equal contiguous slices of the same bitmask used for occlusion.

## 3. Fallback ray direction construction

The direction is *not* the slice/tangent axis and *not* the surface normal — it's stratified across the hemisphere slice using a cosine parameter:

```hlsl
float cosine = (1.0 - ((float(j)+0.5) / _FallbackSampleCount)) * 2.0 - 1.0;   // maps j -> [-1, 1], sample-centered
float angleCosine = GTAOFastAcos(cosine);                                     // -> angle in [0, PI]
float3 rayDir = normalize(realTangent * cos(angleCosine) + normalVS * sin(angleCosine));
rayDir = normalize(rayDir - planeNormal * dot(rayDir, planeNormal));          // re-project into the slice plane
float3 rayDirWS = mul((float3x3)_CameraToWorldMatrix, float3(rayDir.xy, -rayDir.z));
```

`realTangent = cross(projectedNormalNormalized, planeNormal)` and `normalVS` (the projected surface normal) together span the 2D slice plane; `rayDir` is a unit vector in that plane, evenly distributed across the visible hemisphere arc of the slice, one per `j`. This mirrors Figure 8 of the paper (vectors a1..a4 at the center of each subregion) almost exactly — subregion index `j` ↔ bit-range `j`, angle ↔ bit position.

## 4. What gets sampled, and when

| Keyword | Source sampled | Function | Notes |
|---|---|---|---|
| `FALLBACK_APV` | Adaptive Probe Volume (baked SH irradiance volume) | `EvaluateAdaptiveProbeVolume(worldPos, rayDirWS, ..., viewDir, screenPos, out bakeDiffuseLighting, out backBakeDiffuseLighting)` | Only active if HDRP APV is enabled (`PROBE_VOLUMES_L1`/`L2`) **and** `_EnableProbeVolumes` is true at runtime. Note it passes `rayDirWS` where the API normally expects a *surface normal* — the fallback direction is being reinterpreted as a "normal" to pull SH irradiance from that direction. `backBakeDiffuseLighting` (opposite-facing irradiance) is requested but discarded. |
| `FALLBACK_REFLECTION_PROBE` | HDRP reflection probes (cubemap array/atlas) | `TraceReflectionProbes(posInput, normalWS, rayDirWS, weight, cubemapColor, ambientMip)` | Loops HDRP's per-tile env-light list (scalarized, same mechanism as SSR/GI reflection code), does box/sphere `EvaluateLight_EnvIntersection` parallax correction of `rayDirWS`, samples `_ReflectionAtlas`/`_EnvCubemapTextures` at a fixed `ambientMip` (hardcoded to `3`; the "correct" formula `MipLevelFromConeAngle(ambientConeAngle, 256)` is present but **commented out** in the shipped code), accumulates weighted contributions from all overlapping probes until `totalWeight` saturates to 1. |
| `REFLECT_SKY` (only with `FALLBACK_REFLECTION_PROBE`) | Sky cubemap array (`_SkyTexture`) | Direct `SAMPLE_TEXTURECUBE_ARRAY_LOD` | Only fills in the *remaining* weight (`1.0 - weight`) not covered by any reflection probe's influence volume — i.e. it's a background/gap-filler, not a full replacement. |
| `FALLBACK_NONE` | nothing | — | `cubemapColor` stays `0`; `fallbackColor` contributes nothing. |

`ambientConeAngle = PI / _FallbackSampleCount` is computed but, like the mip formula, effectively unused (`ambientMip` is hardcoded to `3`). This looks like an in-progress/tuned-by-eye value rather than a principled cone-to-mip derivation — worth noting if porting, since the "correct" version (relating subregion angular width to a pre-filtered mip level) is sketched but never wired up.

## 5. Weighting and compositing

```hlsl
fallbackColor += cubemapColor * saturate(float(maskSize - hitCount) / float(MAX_RAY)) * GetCurrentExposureMultiplier();
```

`maskSize - hitCount` is the number of **unoccluded** bits in that subregion; dividing by `MAX_RAY` (the *whole* 32-bit hemisphere, not just this subregion's `maskSize`) means each subregion's maximum possible contribution is `maskSize/MAX_RAY = 1/_FallbackSampleCount` — so contributions from all K subregions sum to at most 1.0 total when every sector in the whole hemisphere is unoccluded. **This differs subtly from the paper's prose** ("multiplied ... by the amount of un-occluded sectors over the total sector count" — see `directional-ambient.md`), which describes normalizing per-subregion (unoccluded/`maskSize`, i.e. each subregion capped at 1.0 individually, then presumably averaged/summed by the caller). SSRT3's shipped code instead does the global-`MAX_RAY` normalization, which bakes the "divide by K" step directly into the per-sample weight. Both are internally consistent; they are just two different but equivalent ways to reach the same normalized total — flagged here because a port should decide explicitly which convention to follow.

After the rotation loop:

```hlsl
fallbackColor /= _RotationCount;
fallbackColor = saturate(pow(abs(fallbackColor), _FallbackPower) * _FallbackIntensity);

col /= _RotationCount;
col = fallbackColor + col * _GIIntensity;   // additive combine, no separate AO multiply
```

`fallbackPower` is a gamma-like contrast/darken-brighten control on the *combined* fallback color (post-average, pre-intensity); `fallbackIntensity` is a plain multiplier. The fallback term is **added** to the on-screen bounced GI term (which is itself scaled by `_GIIntensity`) — there's no explicit reweighting to avoid double-counting energy where on-screen bounce and fallback both contributed to the same subregion; the bitmask weighting (only unoccluded sectors reach the fallback) is the only thing preventing overlap in practice, because a sector that found an on-screen occluder for `col` is by construction excluded from `hitCount`'s complement for `fallbackColor`, and vice versa — the same bitmask literally partitions "occluded (found something on screen)" vs "unoccluded (nothing on screen, so ask the fallback source)".

The result `col` becomes `_GIOcclusionTexture.rgb` (with AO in `.a`), which later gets multiplied by surface albedo in the composite pass (`GIDebugPass`/`CombinedDebugPass` in `SSRT.shader`): `SceneColor = GTAOGI.rgb * albedo * occlusionMap + ...` — so the fallback contribution is treated exactly like on-screen bounced light for compositing purposes (albedo-modulated diffuse irradiance), not as a separate ambient term.

## 6. Cost shape

Per pixel: `_RotationCount * _FallbackSampleCount` fallback samples per frame (independent of `_StepCount`, the horizon-march sample count). Each fallback sample is either one SH evaluate (`EvaluateAdaptiveProbeVolume`, cheap) or a full scalarized loop over the tile's overlapping env lights (`TraceReflectionProbes`, cost scales with local reflection-probe density) plus, optionally, one more cubemap sample for sky fill-in. With defaults (`_RotationCount=1`, `_FallbackSampleCount=4`) that's 4 extra probe/cubemap samples per pixel; cranking `_FallbackSampleCount` to `32` (max) is explicitly flagged in the tooltip as "more taxing on performance."
