// Demo 07 — ambient-fallback lab. Main ray-march kernel.
//
// Forked from demo 03 (`03-ssrt3/ssrt-main.wgsl`) — the SSRT3 WebGPU compute
// port. The march / VBAO bitmask / GI gather are IDENTICAL to demo 03; the only
// thing this lab changes is the §3.2 directional-ambient FALLBACK STAGE, which
// here is a PLUGGABLE ambient source (A/B/C) instead of demo 03's single
// equirect. Everything else is kept verbatim so the fallback comparison is the
// only moving part.
//
// Ambient sources (paper §3.2 / CG Spotlight "compatible with any ambient source"):
//   A (0) — EQUIRECT radiance texture, directional sample at cone LOD
//           (demo 03's Source A, wired in). Global (position-independent).
//   B (1) — SH GRID: a 3x3x3 grid of L2 SH irradiance probes, trilinearly
//           interpolated at the shading point's WORLD position, then evaluated
//           (getShIrradianceAt) per fallback direction. Position + direction
//           dependent. (three's LightProbeGrid WebGPU node does NOT ship in
//           0.185.1 — see README; this is a hand-rolled SH grid, the legitimate
//           "manual SH fill" fallback the packet allows.)
//   C (2) — GLOBAL LightProbe SH: one L2 SH probe for the whole scene, evaluated
//           per fallback direction. Directional but position-independent
//           (cheapest, static — the paper's weakest-praised baseline).
//
// Coordinate conventions (WebGPU traps — unchanged from demo 03):
//   - Compute dispatch id.xy are pixel coords, framebuffer top-left origin.
//   - Reconstruct STANDARD three view space, then flip to SSRT3's "posVS"
//     (z positive forward) so the horizon/bitmask/fallback math ports verbatim.
//   - Slice rotation PI/rotationCount (NOT PI2 — issue #29668 trap).
//   - stepRadius divided by (stepCount+1) ONCE (no SSRT3 double-divide).

const PI : f32 = 3.14159265359;
const HALF_PI : f32 = 1.57079632679;
const MAX_RAY : u32 = 32u;

// SH grid dimensions (fixed at 3x3x3 = 27 probes; gridSH holds 27*9 = 243 vec4).
const GX : u32 = 3u;
const GY : u32 = 3u;
const GZ : u32 = 3u;

struct Params {
  proj : mat4x4<f32>,
  invProj : mat4x4<f32>,
  camToWorld : mat4x4<f32>,   // view->world (camera.matrixWorld); fallback rays + world pos
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

  // --- ambient-source block (demo 07) ---
  ambientSource : u32,        // 0=A equirect, 1=B SH grid, 2=C global SH
  gpad0 : u32,
  gpad1 : u32,
  gpad2 : u32,
  gridMin : vec4<f32>,        // world-space grid AABB min (xyz)
  gridMax : vec4<f32>,        // world-space grid AABB max (xyz)
  gridInvRange : vec4<f32>,   // 1/(max-min) per axis (xyz)
  gridDims : vec4<f32>,       // (GX, GY, GZ) as f32
  globalSH : array<vec4<f32>, 9>,     // Source C: one probe, 9 L2 coeffs
  gridSH : array<vec4<f32>, 243>,     // Source B: 27 probes * 9 coeffs
};

// flags bits (unchanged from demo 03)
const F_BITMASK : u32 = 1u;
const F_JITTER : u32 = 2u;
const F_LINEAR_THICKNESS : u32 = 4u;
const F_SCREENSPACE : u32 = 8u;
const F_MIPOPT : u32 = 16u;
const F_NORMALAPPROX : u32 = 32u;
const F_FALLBACK : u32 = 64u;
const F_FB_NORMALIZE : u32 = 128u;
const F_CONE_MIP : u32 = 256u;
const F_GI : u32 = 512u;

@group(0) @binding(0) var depthTex : texture_depth_2d;
@group(0) @binding(1) var normalTex : texture_2d<f32>;
@group(0) @binding(2) var lightTex : texture_2d<f32>;
@group(0) @binding(3) var envTex : texture_2d<f32>;      // equirect ambient (Source A)
@group(0) @binding(4) var envSampler : sampler;
@group(0) @binding(5) var depthPyramid : texture_2d<f32>;
@group(0) @binding(6) var outTex : texture_storage_2d<rgba16float, write>;
@group(0) @binding(7) var<uniform> params : Params;

fn hasFlag(f : u32) -> bool { return (params.flags & f) != 0u; }

// --- noise (SSRT3) ------------------------------------------------------------
fn spatialOffsets(p : vec2<i32>) -> f32 { return 0.25 * f32((p.y - p.x) & 3); }
fn gradientNoise(p : vec2<f32>) -> f32 {
  return fract(52.9829189 * fract(dot(p, vec2<f32>(0.06711056, 0.00583715))));
}
fn rand(co : vec2<f32>) -> f32 {
  let dt = dot(co, vec2<f32>(12.9898, 78.233));
  let sn = dt % 3.14;
  return fract(sin(sn) * 43758.5453);
}

// Cone-angle -> mip (patapom.com/blog/BRDF/PreIntegration). SSRT3 ships mip 3;
// F_CONE_MIP toggles this formula (promoted to a first-class axis in this lab).
fn mipFromConeAngle(theta : f32, envSize : f32) -> f32 {
  let nMip = log2(envSize);
  let u = cos(theta * 0.5);
  return nMip + 0.5 * log2(1.0 / (u * u) - 1.0);
}

// Source A: sample the equirect ambient in a world-space direction at an LOD.
fn sampleEnv(dirWS : vec3<f32>, lod : f32) -> vec3<f32> {
  let d = normalize(dirWS);
  let u = atan2(d.z, d.x) / (2.0 * PI) + 0.5;
  let v = acos(clamp(d.y, -1.0, 1.0)) / PI;
  return textureSampleLevel(envTex, envSampler, vec2<f32>(u, v), lod).rgb;
}

// Sources B/C: three's getShIrradianceAt (src/nodes/functions/material/
// getShIrradianceAt.js) ported to WGSL — direction-in, irradiance-out. Basis +
// cosine-lobe constants match three exactly so coefficients projected with
// three's SphericalHarmonics3.getBasisAt evaluate consistently.
fn shIrradiance(sh : array<vec3<f32>, 9>, n : vec3<f32>) -> vec3<f32> {
  let x = n.x; let y = n.y; let z = n.z;
  var r = sh[0] * 0.886227;
  r = r + sh[1] * (2.0 * 0.511664) * y;
  r = r + sh[2] * (2.0 * 0.511664) * z;
  r = r + sh[3] * (2.0 * 0.511664) * x;
  r = r + sh[4] * (2.0 * 0.429043) * x * y;
  r = r + sh[5] * (2.0 * 0.429043) * y * z;
  r = r + sh[6] * (z * z * 0.743125 - 0.247708);
  r = r + sh[7] * (2.0 * 0.429043) * x * z;
  r = r + sh[8] * 0.429043 * (x * x - y * y);
  return r;
}

fn gridIndex(ix : u32, iy : u32, iz : u32) -> u32 {
  return ix + iy * GX + iz * GX * GY;
}

// Source B: trilinearly interpolate the 9 SH coefficients of the probe grid at a
// world position. Returns the interpolated coefficient set (evaluated per
// direction afterwards). 8 corner probes, hardware-free trilerp.
fn sampleGridSH(worldPos : vec3<f32>) -> array<vec3<f32>, 9> {
  let dims = params.gridDims.xyz;
  let gp = clamp((worldPos - params.gridMin.xyz) * params.gridInvRange.xyz, vec3<f32>(0.0), vec3<f32>(1.0)) * (dims - vec3<f32>(1.0));
  let base = floor(gp);
  let f = gp - base;
  let bx = u32(base.x); let by = u32(base.y); let bz = u32(base.z);
  let x1 = min(bx + 1u, GX - 1u);
  let y1 = min(by + 1u, GY - 1u);
  let z1 = min(bz + 1u, GZ - 1u);
  // 8 corner probe base offsets into gridSH (each probe = 9 consecutive vec4).
  let i000 = gridIndex(bx, by, bz) * 9u;
  let i100 = gridIndex(x1, by, bz) * 9u;
  let i010 = gridIndex(bx, y1, bz) * 9u;
  let i110 = gridIndex(x1, y1, bz) * 9u;
  let i001 = gridIndex(bx, by, z1) * 9u;
  let i101 = gridIndex(x1, by, z1) * 9u;
  let i011 = gridIndex(bx, y1, z1) * 9u;
  let i111 = gridIndex(x1, y1, z1) * 9u;
  var out : array<vec3<f32>, 9>;
  for (var c : u32 = 0u; c < 9u; c = c + 1u) {
    let c00 = mix(params.gridSH[i000 + c].xyz, params.gridSH[i100 + c].xyz, f.x);
    let c10 = mix(params.gridSH[i010 + c].xyz, params.gridSH[i110 + c].xyz, f.x);
    let c01 = mix(params.gridSH[i001 + c].xyz, params.gridSH[i101 + c].xyz, f.x);
    let c11 = mix(params.gridSH[i011 + c].xyz, params.gridSH[i111 + c].xyz, f.x);
    let c0 = mix(c00, c10, f.y);
    let c1 = mix(c01, c11, f.y);
    out[c] = mix(c0, c1, f.z);
  }
  return out;
}

fn globalSHLocal() -> array<vec3<f32>, 9> {
  var g : array<vec3<f32>, 9>;
  for (var i : u32 = 0u; i < 9u; i = i + 1u) { g[i] = params.globalSH[i].xyz; }
  return g;
}

fn fastAcos(xIn : f32) -> f32 {
  let x = clamp(xIn, -1.0, 1.0);
  var o = -0.156583 * abs(x) + HALF_PI;
  o = o * sqrt(1.0 - abs(x));
  if (x >= 0.0) { return o; }
  return PI - o;
}

// --- depth / position reconstruction (unchanged from demo 03) ------------------
fn linearDepthAt(coord : vec2<i32>) -> f32 {
  let d = textureLoad(depthTex, coord, 0);
  let n = params.near;
  let f = params.far;
  return (n * f) / (f - d * (f - n));
}
fn rawDepthAt(coord : vec2<i32>) -> f32 { return textureLoad(depthTex, coord, 0); }

fn viewPosStd(uv : vec2<f32>, d : f32) -> vec3<f32> {
  let ndc = vec2<f32>(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0);
  let clip = vec4<f32>(ndc, d, 1.0);
  let vp = params.invProj * clip;
  return vp.xyz / vp.w;
}
fn posSSToVSMip(uv : vec2<f32>, mip : u32) -> vec3<f32> {
  var d : f32;
  if (mip == 0u) {
    d = rawDepthAt(vec2<i32>(floor(uv * params.resolution)));
  } else {
    let mipDim = vec2<f32>(params.resolution / f32(1u << mip));
    let c = vec2<i32>(floor(uv * mipDim));
    d = textureLoad(depthPyramid, c, i32(mip)).r;
  }
  let stdP = viewPosStd(uv, d);
  return vec3<f32>(stdP.x, stdP.y, -stdP.z);
}
fn posSSToVS(uv : vec2<f32>) -> vec3<f32> { return posSSToVSMip(uv, 0u); }

fn projectToUV(posVS : vec3<f32>) -> vec2<f32> {
  let stdP = vec3<f32>(posVS.x, posVS.y, -posVS.z);
  let clip = params.proj * vec4<f32>(stdP, 1.0);
  let ndc = clip.xyz / clip.w;
  return vec2<f32>(ndc.x * 0.5 + 0.5, 0.5 - ndc.y * 0.5);
}

// --- Stage (a): classic GTAO horizon integration (unchanged) -------------------
fn marchHorizonCos(dirIsRight : bool, posVS : vec3<f32>, slideDir_TexelSize : vec2<f32>,
                   initialRayStep : f32, uv : vec2<f32>, viewDir : vec3<f32>) -> f32 {
  let stepCount = max(1u, params.stepCount);
  var stepRadius = max((params.radius * params.halfProjScale) / posVS.z, f32(stepCount));
  if (hasFlag(F_SCREENSPACE)) {
    stepRadius = (params.radius * (params.resolution.x * 0.5)) / 16.0;
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
    let falloff = clamp(1.0 - (dist * dist) / (params.radius * params.radius), 0.0, 1.0);
    cHorizon = max(cHorizon, c * falloff);
  }
  return cHorizon;
}

// --- Stage (b): VBAO 32-bit visibility bitmask (unchanged) ----------------------
fn computeOccludedBitfield(minHorizon : f32, maxHorizon : f32, globalBitfield : ptr<function, u32>) -> u32 {
  var startHorizonInt = u32(minHorizon * f32(MAX_RAY));
  if (startHorizonInt >= 32u) { startHorizonInt = 31u; }
  let angleHorizonInt = u32(ceil(clamp(maxHorizon - minHorizon, 0.0, 1.0) * f32(MAX_RAY)));
  var angleHorizonBitfield : u32 = 0u;
  if (angleHorizonInt > 0u) {
    angleHorizonBitfield = 0xFFFFFFFFu >> (32u - angleHorizonInt);
  }
  var current = angleHorizonBitfield << startHorizonInt;
  current = current & (~(*globalBitfield));
  *globalBitfield = (*globalBitfield) | current;
  return countOneBits(current);
}

fn sampleNormalVS(sampleUV : vec2<f32>) -> vec3<f32> {
  let c = vec2<i32>(floor(sampleUV * params.resolution));
  let n = normalize(textureLoad(normalTex, c, 0).xyz);
  return vec3<f32>(n.x, n.y, -n.z);
}

fn horizonBitmask(dirIsRight : bool, posVS : vec3<f32>, slideDir_TexelSize : vec2<f32>,
                  initialRayStep : f32, uv : vec2<f32>, viewDir : vec3<f32>, n : f32,
                  normalVS : vec3<f32>, planeNormal : vec3<f32>,
                  globalBitfield : ptr<function, u32>, col : ptr<function, vec3<f32>>) {
  let stepCount = max(1u, params.stepCount);
  var stepRadius = max((params.radius * params.halfProjScale) / posVS.z, f32(stepCount));
  if (hasFlag(F_SCREENSPACE)) {
    stepRadius = (params.radius * (params.resolution.x * 0.5)) / 16.0;
  }
  stepRadius = stepRadius / (f32(stepCount) + 1.0);
  let radiusVS = max(1.0, f32(stepCount) - 1.0) * stepRadius;
  let samplingDirection = select(-1.0, 1.0, dirIsRight);
  let gatherGI = hasFlag(F_GI);
  let mipOpt = hasFlag(F_MIPOPT);
  var lastSamplePosVS = posVS;

  for (var j : u32 = 0u; j < stepCount; j = j + 1u) {
    let offset = pow(abs((stepRadius * (f32(j) + initialRayStep)) / radiusVS), params.expFactor) * radiusVS;
    let uvOffset = slideDir_TexelSize * max(offset, f32(j) + 1.0);
    let sampleUV = uv + uvOffset * samplingDirection;
    if (sampleUV.x <= 0.0 || sampleUV.y <= 0.0 || sampleUV.x >= 1.0 || sampleUV.y >= 1.0) { break; }

    let mipOffset = select(0u, min((j + 1u) / 2u, 4u), mipOpt);
    let samplePosVS = posSSToVSMip(sampleUV, mipOffset);
    let pixelToSample = normalize(samplePosVS - posVS);
    let linearThicknessMultiplier = select(1.0, clamp(samplePosVS.z / params.far, 0.0, 1.0) * 100.0, hasFlag(F_LINEAR_THICKNESS));
    let pixelToSampleBackface = normalize((samplePosVS - linearThicknessMultiplier * viewDir * params.thickness) - posVS);

    var fbh = vec2<f32>(dot(pixelToSample, viewDir), dot(pixelToSampleBackface, viewDir));
    fbh = vec2<f32>(fastAcos(fbh.x), fastAcos(fbh.y));
    fbh = clamp(((samplingDirection * -fbh) - n + HALF_PI) / PI, vec2<f32>(0.0), vec2<f32>(1.0));
    let ordered = select(fbh, fbh.yx, dirIsRight);
    let numOccludedZones = computeOccludedBitfield(ordered.x, ordered.y, globalBitfield);

    if (gatherGI && numOccludedZones > 0u) {
      let c = vec2<i32>(floor(sampleUV * params.resolution));
      var lightColor = textureLoad(lightTex, c, 0).rgb;
      let lum = dot(lightColor, vec3<f32>(0.2126, 0.7152, 0.0722));
      if (lum > params.maxLuminance) { lightColor = lightColor * (params.maxLuminance / lum); }
      if (dot(lightColor, vec3<f32>(1.0)) > 0.001) {
        let lightDirectionVS = pixelToSample;
        let ndl = clamp(dot(normalVS, lightDirectionVS), 0.0, 1.0);
        if (ndl > 0.001) {
          var lightNormalVS : vec3<f32>;
          if (hasFlag(F_NORMALAPPROX)) {
            lightNormalVS = -samplingDirection * cross(normalize(samplePosVS - lastSamplePosVS), planeNormal);
          } else {
            lightNormalVS = sampleNormalVS(sampleUV);
          }
          var lndl = dot(lightNormalVS, -lightDirectionVS);
          if (params.backfaceLighting > 0.0 && dot(lightNormalVS, viewDir) > 0.0) {
            lndl = select(abs(lndl), abs(lndl) * params.backfaceLighting, sign(lndl) < 0.0);
          } else {
            lndl = clamp(lndl, 0.0, 1.0);
          }
          *col = *col + (f32(numOccludedZones) / f32(MAX_RAY)) * lightColor * ndl * lndl;
        }
      }
    }
    lastSamplePosVS = samplePosVS;
  }
}

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
  let posVS = vec3<f32>(stdPos.x, stdPos.y, -stdPos.z);
  let worldPos = (params.camToWorld * vec4<f32>(stdPos, 1.0)).xyz; // for the SH grid

  let nStd = normalize(textureLoad(normalTex, coord, 0).xyz);
  let normalVS = vec3<f32>(nStd.x, nStd.y, -nStd.z);
  let viewDir = normalize(-posVS);

  let noiseOffset = spatialOffsets(coord);
  let noiseDirection = gradientNoise(vec2<f32>(coord));
  var initialRayStep = fract(noiseOffset + params.temporalOffset);
  if (hasFlag(F_JITTER)) {
    initialRayStep = initialRayStep + (rand(uv) * 2.0 - 1.0);
  }

  let rotationCount = max(1u, params.rotationCount);
  let useBitmask = hasFlag(F_BITMASK) || hasFlag(F_GI);
  let doFallback = hasFlag(F_FALLBACK);
  let fbCount = max(2u, params.fallbackSampleCount);
  let ambientMip = select(3.0, clamp(mipFromConeAngle(PI / f32(fbCount), f32(1u << (params.mipCount - 1u))), 0.0, f32(params.mipCount - 1u)), hasFlag(F_CONE_MIP));

  // Precompute per-pixel SH coefficient sets for the chosen source (once, not
  // per subregion): Source B interpolates the grid at worldPos, Source C copies
  // the single global probe.
  var pixelSH : array<vec3<f32>, 9>;
  if (doFallback && params.ambientSource == 1u) {
    pixelSH = sampleGridSH(worldPos);
  } else if (doFallback && params.ambientSource == 2u) {
    pixelSH = globalSHLocal();
  }

  var visSum : f32 = 0.0;
  var col : vec3<f32> = vec3<f32>(0.0);
  var fallbackColor : vec3<f32> = vec3<f32>(0.0);

  for (var i : u32 = 0u; i < rotationCount; i = i + 1u) {
    let rotationAngle = (f32(i) + noiseDirection + params.temporalDirection) * (PI / f32(rotationCount));
    let sliceDir = vec3<f32>(cos(rotationAngle), sin(rotationAngle), 0.0);
    let slideDir_TexelSize = sliceDir.xy * (1.0 / params.resolution);

    let planeNormal = normalize(cross(sliceDir, viewDir));
    let tangent = cross(viewDir, planeNormal);
    let projectedNormal = normalVS - planeNormal * dot(normalVS, planeNormal);
    let projLen = length(projectedNormal);
    let projectedNormalN = projectedNormal / max(projLen, 1e-5);
    let realTangent = cross(projectedNormalN, planeNormal);

    let cos_n = clamp(dot(projectedNormalN, viewDir), -1.0, 1.0);
    let n = -sign(dot(projectedNormal, tangent)) * acos(cos_n);

    var bitfield : u32 = 0u;
    if (useBitmask) {
      horizonBitmask(true, posVS, slideDir_TexelSize, initialRayStep, uv, viewDir, n, normalVS, planeNormal, &bitfield, &col);
      horizonBitmask(false, posVS, slideDir_TexelSize, initialRayStep, uv, viewDir, n, normalVS, planeNormal, &bitfield, &col);
      visSum = visSum + (1.0 - f32(countOneBits(bitfield)) / f32(MAX_RAY));
    } else {
      let cosR = marchHorizonCos(true, posVS, slideDir_TexelSize, initialRayStep, uv, viewDir);
      let cosL = marchHorizonCos(false, posVS, slideDir_TexelSize, initialRayStep, uv, viewDir);
      visSum = visSum + gtaoSlice(cosL, cosR, n, projLen);
    }

    // --- Stage (e): directional-ambient fallback (§3.2), PLUGGABLE source -------
    // Split the same 32-bit mask into fbCount contiguous ranges; per range fire
    // one ambient sample in a direction stratified across the slice arc (paper
    // Fig 8), weighted by that range's UNOCCLUDED fraction. The ONLY difference
    // from demo 03 is which ambient source `ambient` comes from.
    if (doFallback) {
      let maskSize = MAX_RAY / fbCount;
      let mask = 0xFFFFFFFFu >> (MAX_RAY - maskSize);
      var bfCopy = bitfield;
      for (var jf : u32 = 0u; jf < fbCount; jf = jf + 1u) {
        let hitCount = countOneBits(bfCopy & mask);
        let cosine = (1.0 - ((f32(jf) + 0.5) / f32(fbCount))) * 2.0 - 1.0;
        let angleCosine = fastAcos(cosine);
        var rayDir = normalize(realTangent * cos(angleCosine) + normalVS * sin(angleCosine));
        rayDir = normalize(rayDir - planeNormal * dot(rayDir, planeNormal));
        let rayDirWS = normalize((params.camToWorld * vec4<f32>(rayDir.x, rayDir.y, -rayDir.z, 0.0)).xyz);

        // Sources B/C return SH irradiance E(dir); the equirect (A) returns
        // per-direction radiance L. Convert E->L (Lambertian, L = E/PI) so all
        // three sources are energy-comparable at the same fallbackIntensity.
        var ambient : vec3<f32>;
        if (params.ambientSource == 0u) {
          ambient = sampleEnv(rayDirWS, ambientMip);                             // A equirect (radiance)
        } else {
          ambient = max(shIrradiance(pixelSH, rayDirWS) / PI, vec3<f32>(0.0));   // B/C SH irradiance -> radiance
        }

        let unoccluded = f32(maskSize - hitCount);
        // F_FB_NORMALIZE selects between the two documented interpretations
        // (research/sources/probes/ssrt3-fallback.md §5, directional-ambient.md §1-2):
        //   on  = SSRT3 SHIPPED: unoccluded/MAX_RAY. Each of the K subregions caps
        //         at maskSize/MAX_RAY = 1/K, so the K samples SUM to <= 1.0 total
        //         (globally energy-conserving; the "divide by K" is baked in).
        //   off = PAPER / CG-Spotlight LITERAL: unoccluded/maskSize, each subregion
        //         normalized to ITSELF and capped at 1.0, then SUMMED with no global
        //         /K — so the total can reach K when several subregions are open
        //         (brighter, can over-count). This is the divergence the slides'
        //         "...per sub-region over sector count per sub-region" wording implies.
        var weight : f32;
        if (hasFlag(F_FB_NORMALIZE)) {
          weight = unoccluded / f32(MAX_RAY);
        } else {
          weight = clamp(unoccluded / f32(maskSize), 0.0, 1.0);
        }
        fallbackColor = fallbackColor + ambient * clamp(weight, 0.0, 1.0);
        bfCopy = bfCopy >> maskSize;
      }
    }
  }

  var ao = clamp(visSum / f32(rotationCount), 0.0, 1.0);
  ao = clamp(pow(ao, params.aoIntensity), 0.0, 1.0);

  col = col / f32(rotationCount);
  col = col * params.giIntensity;

  fallbackColor = fallbackColor / f32(rotationCount);
  fallbackColor = clamp(pow(abs(fallbackColor), vec3<f32>(params.fallbackPower)) * params.fallbackIntensity, vec3<f32>(0.0), vec3<f32>(1.0));
  col = col + fallbackColor;

  let vmax = max(max(col.r, col.g), col.b);
  if (vmax > params.maxLuminance) { col = col * (params.maxLuminance / vmax); }

  textureStore(outTex, coord, vec4<f32>(col, ao));
}
