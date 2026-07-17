# SSRT3 (cdrinmatane/SSRT3) — temporal accumulation + spatial diffuse denoiser

Local copies: `research/sources/ssrt3/README.md`, `research/sources/ssrt3/HDRP/Scripts/SSRT_HDRP.cs`,
`research/sources/ssrt3/HDRP/Shaders/Resources/SSRT.shader` (temporal reprojection pass),
`research/sources/ssrt3/HDRP/Shaders/Resources/SSRTCS.compute` (main GI/AO compute),
`research/sources/ssrt3/HDRP/Shaders/Resources/DiffuseDenoiser.compute` (spatial bilateral denoiser, reused from HDRP's ray-tracing package).

Repo: `https://github.com/cdrinmatane/SSRT3`

SSRT3 is the reference Unity/HDRP implementation the SSILVB paper and three.js's `GTAONode`/`SSGINode` cite directly (`GTAONode.js` docstring literally links `https://github.com/cdrinmatane/SSRT3`). It has **two separate filtering stages**, run in this order per the render-graph code in `SSRT_HDRP.cs`: (1) temporal reprojection/accumulation, then (2) a spatial diffuse denoiser.

---

## 1. Temporal accumulation (`SSRT.shader`, `TemporalReprojPass`)

**User-facing controls** (README, verbatim):
```
**Filters**
* __Temporal Accumulation:__ Enable/Disable temporal reprojection.
* __Temporal Response:__ Controls the speed of the accumulation, slower accumulation is more
  effective at removing noise but can introduce ghosting.
* __Denoising:__ Enable/Disable diffuse denoiser.
* __Denoising Radius:__ Controls the radius of the GI denoiser.
```

**`temporalResponse` in code** (`SSRT_HDRP.cs`):
```csharp
[Tooltip("Controls the speed of the accumulation, slower accumulation is more effective at removing noise but can introduce ghosting.")]
public ClampedFloatParameter temporalResponse = new ClampedFloatParameter(0.35f, 0.0f, 1.0f);
...
material.SetFloat("_TemporalResponse", temporalResponse.value);
```
Default **0.35**, range **[0, 1]**. It is passed straight into the shader as `_TemporalResponse` and used as the **base blend weight toward the current frame** — i.e. it functions like an EMA (exponential moving average) alpha: lower value ⇒ more history retained ⇒ more denoising but more ghosting; higher value ⇒ faster convergence, less ghosting, more residual noise. This is the direct analogue of "temporal response"/"accumulation speed" knobs in most production TAA/GI temporal filters.

**History rejection — verbatim shader (`TemporalReprojPass`, `SSRT.shader`)**:
```hlsl
float4 TemporalReprojPass(Varyings input) : SV_Target
{
    ...
    float4 gi = LOAD_TEXTURE2D_X(_FilterTexture1, positionSS);
    float depth = GetLinearDepth(positionSS);
    float4 fragpos = mul(_InverseViewProjectionMatrix, float4(float3(uv * 2 - 1, depth), 1));
    fragpos.xyz /= fragpos.w;
    float4 thisWorldPosition = fragpos;

    float2 motionVectors;
    DecodeMotionVector(LOAD_TEXTURE2D_X(_CameraMotionVectorsTexture, positionSS), motionVectors);
    float2 reprojCoord = uv - motionVectors.xy;

    float prevDepth = GetPreviousLinearDepth(reprojCoord*_ScreenParams.xy);

    float4 previousWorldPosition = mul(_LastFrameInverseViewProjectionMatrix,
        float4(reprojCoord.xy * 2.0 - 1.0, prevDepth * 2.0 - 1.0, 1.0));
    previousWorldPosition /= previousWorldPosition.w;

    float blendWeight = _TemporalResponse;

    float posSimilarity = saturate(1.0 - distance(previousWorldPosition.xyz, thisWorldPosition.xyz) * 1.0);
    blendWeight = lerp(1.0, blendWeight, posSimilarity);

    float4 minPrev = float4(10000, 10000, 10000, 10000);
    float4 maxPrev = float4(0, 0, 0, 0);

    float4 s0 = LOAD_TEXTURE2D_X(_FilterTexture1, positionSS+int2(1, 1));
    minPrev = s0; maxPrev = s0;
    s0 = LOAD_TEXTURE2D_X(_FilterTexture1, positionSS+int2(1, -1));
    minPrev = min(minPrev, s0); maxPrev = max(maxPrev, s0);
    s0 = LOAD_TEXTURE2D_X(_FilterTexture1, positionSS+int2(-1, 1));
    minPrev = min(minPrev, s0); maxPrev = max(maxPrev, s0);
    s0 = LOAD_TEXTURE2D_X(_FilterTexture1, positionSS+int2(-1, -1));
    minPrev = min(minPrev, s0); maxPrev = max(maxPrev, s0);

    float4 prevGI = LOAD_TEXTURE2D_X(_PreviousColor, reprojCoord*_ScreenParams.xy);
    prevGI = lerp(prevGI, clamp(prevGI, minPrev, maxPrev), 0.25);

    gi = lerp(prevGI, gi, float4(blendWeight, blendWeight, blendWeight, blendWeight));

    return gi;
}
```

**How rejection actually works** — this is notably *not* a depth/normal G-buffer comparison the way TRAA or SVGF-style filters do it. SSRT3 instead:
1. Reprojects using motion vectors from HDRP's motion vector buffer (`_CameraMotionVectorsTexture`), exactly like standard TAA reprojection.
2. Reconstructs **world-space position** for both the current pixel and the reprojected previous pixel (using current/previous inverse view-projection matrices and linear depth), then measures **Euclidean world-space distance** between them (`posSimilarity = saturate(1 - distance(...))`).
3. Uses that similarity to interpolate the blend weight between `1.0` (full disocclusion → discard all history, current-frame only) and `_TemporalResponse` (full validity → normal accumulation speed): `blendWeight = lerp(1.0, blendWeight, posSimilarity)`.
4. **Additionally** clamps history to a lightweight 2×2-diagonal-neighbor (corner taps, not a full 3×3) min/max box in the *current* frame's `_FilterTexture1` buffer, and blends 25% toward that clamp (`lerp(prevGI, clamp(prevGI, minPrev, maxPrev), 0.25)`) before the temporal blend — a cheap, partial neighborhood-clamp (much lighter than TRAA's full variance clipping, and only 4 corner taps rather than all 8 neighbors).

So: **world-position delta is the sole disocclusion signal** (no explicit normal check, no separate depth-threshold constant exposed to the user) — cheaper than depth+normal dual rejection but potentially less discriminating on grazing-angle surfaces where a large depth delta corresponds to a small world-position delta. There is no separate "depth threshold" tunable exposed in the README/script — `temporalResponse` is the only user-facing knob for this stage.

---

## 2. Spatial diffuse denoiser (`DiffuseDenoiser.compute`)

**Origin** — explicitly borrowed from HDRP's own ray-tracing denoiser package (top-of-file comment, verbatim):
```
// This file comes from the HDRP package: Packages/com.unity.render-pipelines.core/Runtime/RenderPipeline/Raytracing/Shaders/Denoising/DiffuseDenoiser.compute
```
Confirmed in the README's acknowledgements: *"This project reuses code from HDRP's SSGI for the following components: Diffuse Denoiser, APV and reflection probe fallback, Owen Scrambled Noise texture."* So SSRT3's spatial stage is literally Unity's shipping RT-denoiser reused for a screen-space (non-ray-traced) signal — a cross-pollination point worth noting: the same bilateral disk-sample denoiser Unity ships for hardware-raytraced diffuse GI is reused here for horizon-based/bitmask SSGI.

**`denoisingRadius` in code**:
```csharp
[Tooltip("Controls the radius of the GI denoiser.")]
public ClampedFloatParameter denoisingRadius = new ClampedFloatParameter(0.5f, 0.0f, 1.0f);
...
cmd.SetComputeFloatParam(diffuseDenoiserCS, "_DenoiserFilterRadius", denoisingRadius.value * 0.5f);
```
Default **0.5**, range **[0, 1]**, scaled by `0.5` before being passed to the compute shader as `_DenoiserFilterRadius`.

**How the radius is actually used** — it's not a flat pixel radius; it's converted into a **distance-scaled, world-space filter radius** per pixel:
```hlsl
float ComputeMaxDenoisingRadius(float3 positionRWS)
{
    // Compute the distance to the pixel
    float distanceToPoint = length(positionRWS);
    // The world space radius for sample picking goes from distance/10.0 to distance/50.0 linearly
    // until reaching 500.0 meters away from the camera and it is always 20.0f (or two pixels if subpixel).
    return distanceToPoint * _DenoiserFilterRadius / lerp(5.0, 50.0, saturate(distanceToPoint / 500.0));
}
...
const float denoisingRadius = ComputeMaxReprojectionWorldRadius(center.position, center.normal,
    _PixelSpreadAngleTangent, ComputeMaxDenoisingRadius(center.position), PIXEL_RADIUS_TOLERANCE_THRESHOLD);
const float sigma = 0.9 * denoisingRadius;
```
i.e. the radius scales *with distance from camera* (explicitly called "purely empirical" in the source comment) and is further clamped against a minimum pixel-footprint (`ComputeMaxReprojectionWorldRadius` with a `PIXEL_RADIUS_TOLERANCE_THRESHOLD` of 2 pixels) so the filter never collapses to sub-pixel size up close.

**Sampling pattern**: a precomputed low-discrepancy point-disk distribution (`SampleDiskCubic` over an `_OwenScrambledTexture`, i.e. **Owen-scrambled quasi-random samples**, generated once by a `GeneratePointDistribution` kernel), **16 samples** at full resolution or **4 samples** (one quadrant of the 16, selected via `localIndex`) at half resolution, with an optional `_JitterFramePeriod` offset that rotates *which* 16-sample block is used per frame (temporal rotation of the spatial sample set — same spirit as Jimenez spatiotemporal offsets, applied to the denoiser's own sample pattern, not just the GI sampler).

**Per-tap weight** — classic bilateral: Gaussian falloff on world-space sample distance × a `ComputeBilateralWeight(center, tapData)` term (defined in HDRP's shared `BilateralFilter.hlsl`, not reproduced in this repo) that folds in normal/depth similarity between the tapped point and the center, plus explicit background/edge rejection:
```hlsl
if (tapData.z01 == UNITY_RAW_FAR_CLIP_VALUE || abs(tapData.zNF - hClip.w) > 0.1)
    continue;
```
i.e. skip taps that land on the sky/background or whose clip-space depth differs from the projected sample's expected depth by more than a fixed `0.1` tolerance — a depth-consistency check on top of the bilateral weight, guarding against samples that reproject onto unrelated occluded/foreground geometry.

**Half-resolution + "Gather" upsample path**: the same file also ships `GATHER_FILTER` kernels (`GatherSingle`/`GatherColor`) that reconstruct a full-res result from a half-res-denoised buffer using **HDRP's `BilateralUpsample.hlsl`** (`BilUpSingle_Uniform` / `BilUpColor3_Uniform`), sampling a 2×2 neighborhood of the low-res tile from group-shared memory and weighting by depth similarity — i.e. SSRT3's denoiser package already contains a full half-res-render + depth-aware-bilateral-upsample pipeline as an available mode (`_HalfResolutionFilter` toggle in `SSRT_HDRP.cs` sets `0`/full-res in the shipped default wiring, but the half-res kernels and upsample path exist and are functional in the shared file), directly mirroring the SSILVB paper's recommended half-res + bilateral upsample strategy (~4× speedup, see `techniques-survey.md`).

---

## Summary table

| Stage | File | User control | Default | Mechanism |
|---|---|---|---|---|
| Temporal accumulation | `SSRT.shader` (`TemporalReprojPass`) | `temporalResponse` | 0.35 (range 0–1) | EMA blend weight, modulated by world-space reprojection distance (`posSimilarity`); light 4-corner neighbor clamp blended in at 25% before the temporal lerp. No normal check; no explicit depth threshold. |
| Spatial denoise | `DiffuseDenoiser.compute` | `denoisingRadius` | 0.5 (range 0–1), ×0.5 internally | Distance-scaled world-space bilateral filter, Owen-scrambled 16 (full-res) / 4 (half-res) sample disk, per-tap bilateral (normal+depth) weight + hard background/depth-consistency reject; optional half-res + `BilateralUpsample.hlsl` gather reconstruction. Reused verbatim from HDRP's ray-tracing diffuse denoiser package. |

Order of operations in `SSRT_HDRP.cs`: sampling pass → **temporal reprojection pass** (if `temporalAccumulation` enabled) → **diffuse denoiser pass** (if `denoising` enabled) — i.e. temporal accumulation runs *before* the spatial denoiser, not after.
