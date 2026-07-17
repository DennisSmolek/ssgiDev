// Demo 03 — SSRT3 WebGPU compute port. Main ray-march kernel.
//
// Lineage: cdrinmatane/SSRT3 HDRP `SSRTCS.compute` (CSMain) — the source of
// truth. This is a faithful compute port restoring what three's TSL SSGINode
// dropped: the true VBAO 32-bit visibility bitmask, per-newly-revealed-sector GI
// gather, off-screen probe fallback (§3.2), multibounce, and the mip/normal
// bandwidth optimizations. Built in stages a-g behind uniform flags.
//
// Coordinate conventions (WebGPU traps — see PLAN.md bottom, demo 00 README):
//   - Compute dispatch id.xy are pixel coords, framebuffer top-left origin.
//   - uv = (id.xy + 0.5) / resolution (top-left).
//   - We reconstruct STANDARD three view space (right-handed, camera looks down
//     -z) from depth via invProj, consistent with three's `normalView` MRT.
//     Then we convert into SSRT3's flipped "posVS" convention (z positive
//     forward, normal.z negated, viewDir = normalize(-posVS)) so the horizon /
//     bitmask / fallback math ports verbatim. All the SSRT3 formulas below
//     operate in that flipped space; the only bridge is the reconstruct + flip.
//   - Slice rotation uses PI/rotationCount (NOT PI2 — issue #29668 trap).
//   - stepRadius is divided by (stepCount+1) ONCE (no SSRT3 double-divide —
//     three's port fixed it, we don't re-import the bug).

const PI : f32 = 3.14159265359;
const HALF_PI : f32 = 1.57079632679;
const MAX_RAY : u32 = 32u;

struct Params {
  proj : mat4x4<f32>,
  invProj : mat4x4<f32>,
  camToWorld : mat4x4<f32>,   // view->world rotation (camera.matrixWorld) for fallback rays
  resolution : vec2<f32>,
  near : f32,
  far : f32,

  radius : f32,
  thickness : f32,
  expFactor : f32,
  halfProjScale : f32,

  rotationCount : u32,
  stepCount : u32,
  frameSeed : u32,
  flags : u32,

  aoIntensity : f32,
  giIntensity : f32,
  backfaceLighting : f32,
  maxLuminance : f32,

  temporalOffset : f32,
  temporalDirection : f32,
  fallbackSampleCount : u32,
  fallbackPower : f32,

  fallbackIntensity : f32,
  multiBounceGI : f32,
  mipCount : u32,
  pad1 : f32,
};

// flags bits
const F_BITMASK : u32 = 1u;         // bit0: use VBAO bitmask (b+) instead of classic GTAO (a)
const F_JITTER : u32 = 2u;          // bit1: temporal/spatial jitter of sample positions
const F_LINEAR_THICKNESS : u32 = 4u;// bit2: thickness grows with distance
const F_SCREENSPACE : u32 = 8u;     // bit3: screen-space sample distribution
const F_MIPOPT : u32 = 16u;         // bit4: mip optimization (g)
const F_NORMALAPPROX : u32 = 32u;   // bit5: reconstruct sample normal from position (g)
const F_FALLBACK : u32 = 64u;       // bit6: probe fallback enabled (e)
const F_FB_NORMALIZE : u32 = 128u;  // bit7: SSRT3 shipped MAX_RAY normalization (vs paper per-subregion)
const F_CONE_MIP : u32 = 256u;      // bit8: cone->mip formula (vs hardcoded mip 3)
const F_GI : u32 = 512u;            // bit9: gather GI (c+)

@group(0) @binding(0) var depthTex : texture_depth_2d;
@group(0) @binding(1) var normalTex : texture_2d<f32>;   // three normalView (view-space, [-1,1])
@group(0) @binding(2) var lightTex : texture_2d<f32>;    // radiance source (beauty, or lightmask at f)
@group(0) @binding(3) var envTex : texture_2d<f32>;      // PMREM cube-uv atlas (fallback, e); dummy otherwise
@group(0) @binding(4) var envSampler : sampler;          // filtering sampler for envTex
@group(0) @binding(5) var outTex : texture_storage_2d<rgba16float, write>;
@group(0) @binding(6) var<uniform> params : Params;

fn hasFlag(f : u32) -> bool { return (params.flags & f) != 0u; }

// --- noise (SSRT3 SpatialOffsets + GradientNoise + rand) ----------------------
fn spatialOffsets(p : vec2<i32>) -> f32 {
  return 0.25 * f32((p.y - p.x) & 3);
}
fn gradientNoise(p : vec2<f32>) -> f32 {
  return fract(52.9829189 * fract(dot(p, vec2<f32>(0.06711056, 0.00583715))));
}
fn rand(co : vec2<f32>) -> f32 {
  let dt = dot(co, vec2<f32>(12.9898, 78.233));
  let sn = dt % 3.14;
  return fract(sin(sn) * 43758.5453);
}

// GTAO fast acos (SSRT3 GTAOFastAcos)
fn fastAcos(xIn : f32) -> f32 {
  let x = clamp(xIn, -1.0, 1.0);
  var o = -0.156583 * abs(x) + HALF_PI;
  o = o * sqrt(1.0 - abs(x));
  if (x >= 0.0) { return o; }
  return PI - o;
}

// --- depth / position reconstruction -----------------------------------------
// Positive linear eye distance from clip depth (WebGPU clip z in [0,1]).
fn linearDepthAt(coord : vec2<i32>) -> f32 {
  let d = textureLoad(depthTex, coord, 0);
  let n = params.near;
  let f = params.far;
  return (n * f) / (f - d * (f - n));
}
fn rawDepthAt(coord : vec2<i32>) -> f32 {
  return textureLoad(depthTex, coord, 0);
}

// Standard three view-space position (z negative forward) from uv + clip depth.
fn viewPosStd(uv : vec2<f32>, d : f32) -> vec3<f32> {
  let ndc = vec2<f32>(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0);
  let clip = vec4<f32>(ndc, d, 1.0);
  let vp = params.invProj * clip;
  return vp.xyz / vp.w;
}
// SSRT3 flipped posVS (z positive forward) at a uv, sampling depth at that uv.
fn posSSToVS(uv : vec2<f32>) -> vec3<f32> {
  let coord = vec2<i32>(floor(uv * params.resolution));
  let d = rawDepthAt(coord);
  let stdP = viewPosStd(uv, d);
  return vec3<f32>(stdP.x, stdP.y, -stdP.z);
}

fn projectToUV(posVS : vec3<f32>) -> vec2<f32> {
  // posVS is flipped (z+ forward); convert back to std view (z- forward) to project.
  let stdP = vec3<f32>(posVS.x, posVS.y, -posVS.z);
  let clip = params.proj * vec4<f32>(stdP, 1.0);
  let ndc = clip.xyz / clip.w;
  return vec2<f32>(ndc.x * 0.5 + 0.5, 0.5 - ndc.y * 0.5);
}

// --- Stage (a): classic GTAO horizon integration ------------------------------
// Marches one direction, returns the max horizon cosine (dot of dir-to-sample
// with viewDir). Thin occluders fully block the horizon here (over-darkening) —
// the exact failure the bitmask fixes in stage (b).
fn marchHorizonCos(dirIsRight : bool, posVS : vec3<f32>, slideDir_TexelSize : vec2<f32>,
                   initialRayStep : f32, uv : vec2<f32>, viewDir : vec3<f32>) -> f32 {
  let stepCount = max(1u, params.stepCount);
  var stepRadius = max((params.radius * params.halfProjScale) / posVS.z, f32(stepCount));
  if (hasFlag(F_SCREENSPACE)) {
    stepRadius = (params.radius * (params.resolution.x * 0.5)) / 16.0; // no double-divide
  }
  stepRadius = stepRadius / (f32(stepCount) + 1.0);
  let radiusVS = max(1.0, f32(stepCount) - 1.0) * stepRadius;
  let samplingDirection = select(-1.0, 1.0, dirIsRight);

  var cHorizon = -1.0;
  for (var j : u32 = 0u; j < stepCount; j = j + 1u) {
    let offset = pow(abs((stepRadius * (f32(j) + initialRayStep)) / radiusVS), params.expFactor) * radiusVS;
    let uvOffset = slideDir_TexelSize * max(offset, f32(j) + 1.0);
    let sampleUV = uv + uvOffset * samplingDirection;
    if (sampleUV.x <= 0.0 || sampleUV.y <= 0.0 || sampleUV.x >= 1.0 || sampleUV.y >= 1.0) { break; }
    let samplePosVS = posSSToVS(sampleUV);
    let pixelToSample = samplePosVS - posVS;
    let dist = length(pixelToSample);
    if (dist < 1e-5) { continue; }
    let c = dot(pixelToSample / dist, viewDir);
    // Falloff: ignore samples beyond radius.
    let falloff = clamp(1.0 - (dist * dist) / (params.radius * params.radius), 0.0, 1.0);
    cHorizon = max(cHorizon, c * falloff);
  }
  return cHorizon;
}

// GTAO slice integral (Jimenez 2016). n = projected-normal angle within slice.
fn gtaoSlice(cosH1 : f32, cosH2 : f32, n : f32, projLen : f32) -> f32 {
  var h1 = -fastAcos(cosH1);
  var h2 = fastAcos(cosH2);
  h1 = n + max(h1 - n, -HALF_PI);
  h2 = n + min(h2 - n, HALF_PI);
  let sinN = sin(n);
  let v1 = -cos(2.0 * h1 - n) + cos(n) + 2.0 * h1 * sinN;
  let v2 = -cos(2.0 * h2 - n) + cos(n) + 2.0 * h2 * sinN;
  return 0.25 * projLen * (v1 + v2);
}

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) gid : vec3<u32>) {
  let dim = vec2<u32>(u32(params.resolution.x), u32(params.resolution.y));
  if (gid.x >= dim.x || gid.y >= dim.y) { return; }
  let coord = vec2<i32>(gid.xy);
  let uv = (vec2<f32>(gid.xy) + 0.5) / params.resolution;

  let rawD = rawDepthAt(coord);
  if (rawD >= 0.99999) {
    textureStore(outTex, coord, vec4<f32>(0.0, 0.0, 0.0, 1.0));
    return;
  }

  let stdPos = viewPosStd(uv, rawD);
  let posVS = vec3<f32>(stdPos.x, stdPos.y, -stdPos.z); // flipped (z+ forward)

  let nStd = normalize(textureLoad(normalTex, coord, 0).xyz);
  let normalVS = vec3<f32>(nStd.x, nStd.y, -nStd.z);    // SSRT3 flip
  let viewDir = normalize(-posVS);

  let noiseOffset = spatialOffsets(coord);
  let noiseDirection = gradientNoise(vec2<f32>(coord));
  var initialRayStep = fract(noiseOffset + params.temporalOffset);
  if (hasFlag(F_JITTER)) {
    initialRayStep = initialRayStep + (rand(uv) * 2.0 - 1.0);
  }

  let rotationCount = max(1u, params.rotationCount);
  var ao : f32 = 0.0;

  for (var i : u32 = 0u; i < rotationCount; i = i + 1u) {
    let rotationAngle = (f32(i) + noiseDirection + params.temporalDirection) * (PI / f32(rotationCount));
    let sliceDir = vec3<f32>(cos(rotationAngle), sin(rotationAngle), 0.0);
    let slideDir_TexelSize = sliceDir.xy * (1.0 / params.resolution);

    let planeNormal = normalize(cross(sliceDir, viewDir));
    let tangent = cross(viewDir, planeNormal);
    let projectedNormal = normalVS - planeNormal * dot(normalVS, planeNormal);
    let projLen = length(projectedNormal);
    let projectedNormalN = projectedNormal / max(projLen, 1e-5);

    let cos_n = clamp(dot(projectedNormalN, viewDir), -1.0, 1.0);
    let n = -sign(dot(projectedNormal, tangent)) * acos(cos_n);

    let cosR = marchHorizonCos(true, posVS, slideDir_TexelSize, initialRayStep, uv, viewDir);
    let cosL = marchHorizonCos(false, posVS, slideDir_TexelSize, initialRayStep, uv, viewDir);
    // Map "no occluder found" (cos = -1) to the full open hemisphere.
    ao = ao + gtaoSlice(cosL, cosR, n, projLen);
  }

  ao = ao / f32(rotationCount);
  ao = clamp(ao, 0.0, 1.0);
  ao = clamp(pow(ao, params.aoIntensity), 0.0, 1.0);

  textureStore(outTex, coord, vec4<f32>(0.0, 0.0, 0.0, ao));
}
