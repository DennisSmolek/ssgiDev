# tlegoc/RadianceCascadesGIVulkan — Théo Le Goc's 2D Vulkan implementation

- Repo: https://github.com/tlegoc/RadianceCascadesGIVulkan
- Blog writeup: https://tlegoc.github.io/blogs/radiance-cascade/
- Classification: **2D flatland**, Vulkan compute shaders written in Slang, not screen-space-3D. Chosen as one of the most substantive implementations because the shader source is clean, short, and directly readable (Slang compiles to a clear compute-shader structure).

## Origin story (from the blog)
Discovered the algorithm via SimonDev's video, deliberately chose 2D over 3D to focus on learning Vulkan more deeply rather than fighting the algorithm and the API simultaneously.

## Repo structure
```
shaders/
  BuildGITexture.slang
  Common.slangi
  DrawToSDFTexture.slang
  FillTextureFloat4.slang
  FinalPass.slang
  MergeCascades.slang
  RaymarchSDF.slang
src/            # ComputeApp.cpp, PipelineBuilder.cpp, ...
include/        # headers
main.cpp
```

## Key technical challenge (per the blog): cascade/screen resolution decoupling
Initial attempts derived cascade texture resolution directly from screen pixel overlap, which broke for arbitrary requested cascade counts. Solution: decouple screen resolution from cascade configuration entirely — specify desired cascade count and vertical probe density at the *max* cascade level, generate textures with slight non-uniform stretching, and do symmetric UV-based probe lookup. Tradeoff: slightly higher probe density at lateral (left/right) edges. This is a genuinely useful practical lesson not covered in the paper or the more polished tutorials.

## Verified shader source (fetched directly, not paraphrased)

`shaders/RaymarchSDF.slang` (full file):
```hlsl
[[vk::binding(0)]]
Sampler2D SDFTexture : register(t0): register(s0);
RWTexture2D<float4> cascadeTexture;

struct PushConstants {
    uint32_t maxLevel;
    uint32_t verticalProbeCountAtMaxLevel;
    float radius;
    float radiusMultiplier;
    float raymarchStepSize;
    float attenuation;
    uint32_t currentLevel;
}

#include "Common.slangi"

[shader("compute")]
[numthreads(8,8,1)]
void main(uint3 id : SV_DispatchThreadID, uniform PushConstants pc)
{
    TextureInfo cascadeTextureInfo = GetTextureInfo(cascadeTexture);
    TextureInfo SDFTextureInfo = GetTextureInfo(SDFTexture);
    if (id.x >= cascadeTextureInfo.width || id.y >= cascadeTextureInfo.height) return;
    CascadeInfo cascadeInfo = GetCascadeInfo(pc.currentLevel, cascadeTextureInfo);
    Ray ray = cascadeInfo.GetRay(id, pc.radius, pc.radiusMultiplier);
    ray = RayCorrection(ray, cascadeTextureInfo, SDFTextureInfo);
    cascadeTexture[id.xy] = Raymarch(ray, pc.raymarchStepSize, pc.attenuation, SDFTextureInfo);
}
```

`shaders/MergeCascades.slang` (full file, includes an explicit credit-by-URL to a specific SimonDev commit for the ray-interpolation index math):
```hlsl
RWTexture2D<float4> inputCascade;
RWTexture2D<float4> outputCascade;

struct PushConstants {
    int maxLevel;
    int verticalProbeCountAtMaxLevel;
    float radius;
    float radiusMultiplier;
    float raymarchStepSize;
    float attenuation;
    int outputLevel;
};

float4 SampleProbe(int2 probe, int dimension, int rayCount, int rays[4])
{
    int width, height, level;
    inputCascade.GetDimensions(0, width, height, level);
    float4 result = float4(0);
    for (int i = 0; i < 4; i++)
    {
        int rayIndex = rays[i] % rayCount;
        int rayX = rayIndex % dimension;
        int rayY = rayIndex / dimension;
        int probeX = probe.x * dimension + rayX;
        int probeY = probe.y * dimension + rayY;
        if (probeX >= width || probeY >= height) continue;
        result += inputCascade[int2(probeX, probeY)];
    }
    return result / 4.0f;
}

[shader("compute")]
[numthreads(8,8,1)]
void main(uint3 id : SV_DispatchThreadID, uniform PushConstants pc)
{
    uint width, height, levels;
    inputCascade.GetDimensions(0,width, height, levels);
    int2 cascadeResolution = int2(width, height);
    if (id.x >= width || id.y >= height) return;

    int probeDimensions = 1 << (pc.outputLevel + 1);
    int probeRayCount = probeDimensions * probeDimensions;
    int2 probeCount = cascadeResolution / probeDimensions;
    int2 probePosition = id.xy / probeDimensions;
    int rayID = id.x % probeDimensions + (id.y % probeDimensions) * probeDimensions;

    int inputProbeDimension = 1 << (pc.outputLevel + 2);
    int inputProbeRayCount = inputProbeDimension * inputProbeDimension;
    int2 inputProbeCount = cascadeResolution / inputProbeDimension;

    // find the two rays that we'll need to lerp
    // https://github.com/simondevyoutube/Shaders_RadianceCascades/blob/bba7867d1c0f1f0043c0ad618c6967d06d92c11e/shaders/cascades.glsl#L64
    float angleNorm = (rayID + .5f) / (float) probeRayCount;
    int angleIndex = floor(angleNorm * inputProbeRayCount);
    int rays[4] = { angleIndex - 1, angleIndex, angleIndex + 1, angleIndex + 2 };

    float2 outputProbePositionInInput = ((float2) probePosition / probeCount) * (float2) inputProbeCount - float2(0.25f);
    int2 probe1 = ceil(outputProbePositionInInput);
    int2 probe2 = floor(outputProbePositionInInput);
    int2 probe3 = int2(ceil(outputProbePositionInInput.x), floor(outputProbePositionInInput.y));
    int2 probe4 = int2(floor(outputProbePositionInInput.x), ceil(outputProbePositionInInput.y));

    float2 lerpWeights = outputProbePositionInInput - probe2;
    float4 probe1Value = SampleProbe(probe1, inputProbeDimension, inputProbeRayCount, rays);
    float4 probe2Value = SampleProbe(probe2, inputProbeDimension, inputProbeRayCount, rays);
    float4 probe3Value = SampleProbe(probe3, inputProbeDimension, inputProbeRayCount, rays);
    float4 probe4Value = SampleProbe(probe4, inputProbeDimension, inputProbeRayCount, rays);
    float4 lerp1 = lerp(probe1Value, probe2Value, lerpWeights.y);
    float4 lerp2 = lerp(probe3Value, probe4Value, lerpWeights.y);
    float4 finalValue = lerp(lerp1, lerp2, lerpWeights.x);

    outputCascade[id.xy] += finalValue * outputCascade[id.xy].a;
}
```
Note the merge samples **4 rays per direction bucket** (not 1), a slightly different interpolation scheme from the GM Shaders "pre-averaging" optimization — worth comparing the two merge strategies side by side if implementing from scratch.

## Results / limitations (per blog)
Visually satisfactory but "unoptimized code susceptible to crashes with large rays or minimal raymarch steps"; unexplained low-resolution artifacts. Planned future work: full 3D (originally intended in Unity via screen-space raymarching) or a "fake-3D" approach inspired by Sannikov.
