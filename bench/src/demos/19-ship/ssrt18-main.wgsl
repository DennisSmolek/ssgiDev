// Demo 18 (temporal lab) — FORK of demo 12 (ssrt12-main), copied verbatim
// (same march kernel; the lab changes are all in temporal/denoise). Demo 12
// provenance: fork of demo 03 ssrt-main.wgsl (cdrinmatane/SSRT3 lineage) with
// the measured Phase-T winners
// swapped in, UNOPTIMIZED (academic-style code kept — no trig identities, no
// branch restructuring, no precision tricks; this demo is the Phase-O control).
//
// Swaps vs demo 03 (see README provenance table + NEXTGEN.md Phase D):
//   1. HALF-RES CHAIN (lab 09): the march runs at MARCH resolution reading a
//      downsampled G-buffer — depth is an r32float texture (NOT texture_depth_2d),
//      normal/light are march-res buffers. Everything else is unchanged; at
//      marchScale=full the buffers are 1:1 and this degenerates to demo 03.
//   2. NOISE (lab 11 verdict): IGN (Jimenez interleaved gradient noise) with the
//      exact per-frame temporal advance from 11-sampling/sampling.wgsl replaces
//      demo 03's gradientNoise/spatialOffsets/rand. Enum {ign, white} for debug.
//   3. THICKNESS (lab 08 verdict): Ottosson occluder-adaptive thickness heuristic
//      (3clGWB) replaces constant thickness; constant + linear kept as toggles.
//   4. DISTANT LIGHT (lab 08 verdict): salm-caps spherical-caps env sampling on
//      the unoccluded bits, alongside SSRT3's §3.2 probe fallback (enum).
//
// Coordinate conventions (WebGPU traps — see demo 03 README): we reconstruct
// STANDARD three view space (z-forward) from depth via invProj, then flip into
// SSRT3's posVS (z positive forward, normal.z negated, viewDir = normalize(-posVS))
// so the horizon/bitmask/fallback math ports verbatim. Dot products and lengths
// are invariant under that flip, so lab 08's occluder heuristic (built in demo
// 04/05 standard view space) ports without change: viewDir plays the role of V.

const PI : f32 = 3.14159265359;
const HALF_PI : f32 = 1.57079632679;
const MAX_RAY : u32 = 32u;

struct Params {
  proj : mat4x4<f32>,
  invProj : mat4x4<f32>,
  camToWorld : mat4x4<f32>,   // view->world rotation (camera.matrixWorld) for fallback rays
  resolution : vec2<f32>,     // MARCH resolution
  near : f32,
  far : f32,

  radius : f32,
  thickness : f32,
  expFactor : f32,
  halfProjScale : f32,        // computed at march res

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

  // --- demo 12 additions ---
  noiseMode : u32,            // 0 ign (default), 1 white, 2 bluenoise
  thicknessHeuristic : u32,   // 0 constant, 1 linear-over-dist, 2 ottosson (default)
  distantLightMode : u32,     // 0 off (default), 1 ssrt-fallback (§3.2), 2 salm-caps
  capsBits : u32,             // salm-caps bits per cap (1/2/4/8 -> 32/16/8/4 caps)

  occluderThicknessScale : f32, // Ottosson: thickness grows this fast with occluder size
  occluderCosLimit : f32,       // Ottosson: reset occluder start when |dot(dPrev,V)| exceeds this
  distantIntensity : f32,       // salm-caps env gain (pre-gamma)
  linearThickK : f32,           // linear-over-dist thickness slope
};

// flags bits (mirror index.ts). F_LINEAR_THICKNESS retired -> thicknessHeuristic.
const F_BITMASK : u32 = 1u;
const F_JITTER : u32 = 2u;
const F_LINEAR_THICKNESS : u32 = 4u;// retired (kept for bit stability); use thicknessHeuristic
const F_SCREENSPACE : u32 = 8u;
const F_MIPOPT : u32 = 16u;
const F_NORMALAPPROX : u32 = 32u;
const F_FALLBACK : u32 = 64u;       // retired (kept for bit stability); use distantLightMode
const F_FB_NORMALIZE : u32 = 128u;
const F_CONE_MIP : u32 = 256u;
const F_GI : u32 = 512u;
const F_SECTOR_REMAP : u32 = 1024u;
const F_BENT_NORMALS : u32 = 2048u; // P4: accumulate bent normal + cone into bentOut

@group(0) @binding(0) var marchDepthTex : texture_2d<f32>; // r32float march-res raw clip depth (lab 09 downsample)
@group(0) @binding(1) var normalTex : texture_2d<f32>;     // march-res view normal ([-1,1])
@group(0) @binding(2) var lightTex : texture_2d<f32>;      // march-res radiance source (beauty + prevGI feedback)
@group(0) @binding(3) var envTex : texture_2d<f32>;        // equirect ambient source (distant light)
@group(0) @binding(4) var envSampler : sampler;
@group(0) @binding(5) var depthPyramid : texture_2d<f32>;  // march-res depth mip pyramid (mipOptimization)
@group(0) @binding(6) var backDepthTex : texture_depth_2d; // P4: march-res back-face depth (two-sided thickness). Only read when thicknessHeuristic==3.
@group(0) @binding(7) var outTex : texture_storage_2d<rgba16float, write>;
@group(0) @binding(8) var bentOut : texture_storage_2d<rgba16float, write>; // P4: xyz = std view-space bent normal, w = visibleCone. Only written when F_BENT_NORMALS.
@group(0) @binding(9) var<uniform> params : Params;
@group(0) @binding(10) var noiseAtlas : texture_2d<f32>; // stbn-atlas.png (bluenoise mode only; 1x1 placeholder until loaded)

fn hasFlag(f : u32) -> bool { return (params.flags & f) != 0u; }

// --- noise (lab 11 sampling.wgsl verdict: IGN + per-frame temporal advance) ---
// IGN (Jimenez interleaved gradient noise).
fn ign(p : vec2<f32>) -> f32 {
  return fract(52.9829189 * fract(dot(p, vec2<f32>(0.06711056, 0.00583715))));
}
// Temporal advance: hashed per-frame 2D Cranley-Patterson offset.
// The original scalar-diagonal advance (5.588238 * frame, per Salm/Jimenez)
// TRANSLATES the IGN pattern coherently; a translating striped pattern does
// not temporally average to flat — its accumulated mean keeps row-coherent
// bands (IGN's gradient y-coefficient is tiny → near-horizontal stripes;
// Dennis spotted the surviving bands 2026-07-24). A white 2D offset per
// frame keeps IGN's in-frame stratification (the lab-11 win) while making
// each pixel's temporal sequence white, so accumulation converges it.
fn ignTemporal(p : vec2<f32>, n : u32) -> f32 {
  let h = pcg(n * 0x9E3779B9u);
  let off = vec2<f32>(f32(h & 0xFFFFu), f32(h >> 16u)) * (512.0 / 65536.0);
  return ign(p + off);
}
// white-noise control (PCG hash).
fn pcg(x : u32) -> u32 {
  let state = x * 747796405u + 2891336453u;
  let word = ((state >> ((state >> 28u) + 4u)) ^ state) * 277803737u;
  return (word >> 22u) ^ word;
}
fn nextRand(seed : ptr<function, u32>) -> f32 {
  *seed = pcg(*seed);
  return f32(*seed) * (1.0 / 4294967296.0);
}
// Four decorrelated uniform randoms for a pixel at temporal index n:
//   x -> slice rotation jitter   y -> march-start offset
//   z -> march-start jitter      w -> Ottosson occluder-scale jitter
// stbn-atlas.png: 512x512 = 4x4 grid of 128x128 tiles, RG = two independent
// blue-noise fields per tile (bench/scripts/gen-bluenoise.mjs).
fn atlasFetch(coord : vec2<i32>, tile : u32) -> vec2<f32> {
  let tcol = i32(tile) % 4;
  let trow = i32(tile) / 4;
  let lx = coord.x & 127;
  let ly = coord.y & 127;
  return textureLoad(noiseAtlas, vec2<i32>(tcol * 128 + lx, trow * 128 + ly), 0).rg;
}

fn noise4(coord : vec2<i32>, n : u32) -> vec4<f32> {
  if (params.noiseMode == 2u) {
    // Blue-noise (2026-07-24, Dennis's banding session): four INDEPENDENT
    // channels — two from tile t, two from a transposed fetch of a different
    // tile — where the ign path below feeds all four dimensions from ONE
    // striped plane (march-jitter dimensions inherit the stripes and the
    // step-quantization bands never dither cleanly). STBN-style tile cycling
    // per temporal index; golden-ratio value-jitter each full 16-cycle so
    // deep accumulation keeps decorrelating (lab 11: raw cycling plateaus).
    let tile = n % 16u;
    let rg = atlasFetch(coord, tile);
    let ba = atlasFetch(vec2<i32>(coord.y, coord.x), (tile + 7u) % 16u);
    let shift = fract(0.6180339887 * f32(n / 16u));
    return fract(vec4<f32>(rg.x, rg.y, ba.x, ba.y) + shift);
  }
  if (params.noiseMode == 1u) {
    var seed = pcg(
      (u32(coord.x) * 3266489917u) ^
      (u32(coord.y) * 668265263u) ^
      (n * 374761393u) ^ 0x9CF617FAu,
    );
    let a = nextRand(&seed);
    let b = nextRand(&seed);
    let c = nextRand(&seed);
    let d = nextRand(&seed);
    return vec4<f32>(a, b, c, d);
  }
  let p = vec2<f32>(coord);
  return vec4<f32>(
    ignTemporal(p, n),
    ignTemporal(p + vec2<f32>(59.0, 17.0), n),
    ignTemporal(p + vec2<f32>(11.0, 91.0), n),
    ignTemporal(p + vec2<f32>(23.0, 7.0), n),
  );
}

// Cone-angle -> mip (patapom.com/blog/BRDF/PreIntegration).
fn mipFromConeAngle(theta : f32, envSize : f32) -> f32 {
  let nMip = log2(envSize);
  let u = cos(theta * 0.5);
  return nMip + 0.5 * log2(1.0 / (u * u) - 1.0);
}

// Sample the equirectangular ambient source in a world-space direction at LOD.
fn sampleEnv(dirWS : vec3<f32>, lod : f32) -> vec3<f32> {
  let d = normalize(dirWS);
  let u = atan2(d.z, d.x) / (2.0 * PI) + 0.5;
  let v = acos(clamp(d.y, -1.0, 1.0)) / PI;
  return textureSampleLevel(envTex, envSampler, vec2<f32>(u, v), lod).rgb;
}

// GTAO fast acos (SSRT3 GTAOFastAcos)
fn fastAcos(xIn : f32) -> f32 {
  let x = clamp(xIn, -1.0, 1.0);
  var o = -0.156583 * abs(x) + HALF_PI;
  o = o * sqrt(1.0 - abs(x));
  if (x >= 0.0) { return o; }
  return PI - o;
}

// --- depth / position reconstruction (reads MARCH-res r32float depth) ---------
fn rawDepthAt(coord : vec2<i32>) -> f32 {
  let c = clamp(coord, vec2<i32>(0), vec2<i32>(params.resolution) - vec2<i32>(1));
  return textureLoad(marchDepthTex, c, 0).r;
}
fn linearDepthAt(coord : vec2<i32>) -> f32 {
  let d = rawDepthAt(coord);
  let n = params.near;
  let f = params.far;
  return (n * f) / (f - d * (f - n));
}
// P4 two-sided: raw clip depth of the back-face prepass (march res).
fn backDepthAt(coord : vec2<i32>) -> f32 {
  let c = clamp(coord, vec2<i32>(0), vec2<i32>(params.resolution) - vec2<i32>(1));
  return textureLoad(backDepthTex, c, 0);
}

// Standard three view-space position (z negative forward) from uv + clip depth.
fn viewPosStd(uv : vec2<f32>, d : f32) -> vec3<f32> {
  let ndc = vec2<f32>(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0);
  let clip = vec4<f32>(ndc, d, 1.0);
  let vp = params.invProj * clip;
  return vp.xyz / vp.w;
}
// SSRT3 flipped posVS (z positive forward), sampling depth at `mip` of the march
// depth pyramid. mip 0 reads the march-res depth buffer directly.
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
fn posSSToVS(uv : vec2<f32>) -> vec3<f32> {
  return posSSToVSMip(uv, 0u);
}

fn projectToUV(posVS : vec3<f32>) -> vec2<f32> {
  let stdP = vec3<f32>(posVS.x, posVS.y, -posVS.z);
  let clip = params.proj * vec4<f32>(stdP, 1.0);
  let ndc = clip.xyz / clip.w;
  return vec2<f32>(ndc.x * 0.5 + 0.5, 0.5 - ndc.y * 0.5);
}

// --- Stage (a): classic GTAO horizon integration (AO-only validation path) ----
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
    let distFacSq = clamp((dist * dist) / (params.radius * params.radius), 0.0, 1.0);
    cHorizon = mix(max(cHorizon, c), cHorizon, distFacSq);
  }
  return cHorizon;
}

// --- Stage (b): VBAO 32-bit visibility bitmask (SSRT3 ComputeOccludedBitfield) -
fn computeOccludedBitfield(minHorizon : f32, maxHorizon : f32, globalBitfield : ptr<function, u32>) -> u32 {
  var startHorizonInt = u32(minHorizon * f32(MAX_RAY));
  if (startHorizonInt >= 32u) { startHorizonInt = 31u; }
  let angleHorizonInt = u32(clamp(maxHorizon - minHorizon, 0.0, 1.0) * f32(MAX_RAY));
  var angleHorizonBitfield : u32 = 0u;
  if (angleHorizonInt > 0u) {
    angleHorizonBitfield = 0xFFFFFFFFu >> (32u - angleHorizonInt);
  }
  var current = angleHorizonBitfield << startHorizonInt;
  current = current & (~(*globalBitfield));
  *globalBitfield = (*globalBitfield) | current;
  return countOneBits(current);
}

// Sample view-space normal (SSRT3 flipped convention) from the march-res normal.
fn sampleNormalVS(sampleUV : vec2<f32>) -> vec3<f32> {
  let c = vec2<i32>(floor(sampleUV * params.resolution));
  let n = normalize(textureLoad(normalTex, c, 0).xyz);
  return vec3<f32>(n.x, n.y, -n.z);
}

// Marches one horizon direction, accumulating occluded sectors + (F_GI) gathering
// radiance. thickness now comes from the heuristic (lab 08) instead of constant.
fn horizonBitmask(dirIsRight : bool, posVS : vec3<f32>, slideDir_TexelSize : vec2<f32>,
                  initialRayStep : f32, uv : vec2<f32>, viewDir : vec3<f32>, n : f32,
                  normalVS : vec3<f32>, planeNormal : vec3<f32>, occluderScale : f32,
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
  // Ottosson occluder-tracking state (heuristic 2), reset at the start of this
  // march direction (each call is ONE direction — matches gt-distant.wgsl reset).
  var occluderStartingPos = posVS;
  var previousPos = posVS;

  for (var j : u32 = 0u; j < stepCount; j = j + 1u) {
    let offset = pow(abs((stepRadius * (f32(j) + initialRayStep)) / radiusVS), params.expFactor) * radiusVS;
    let uvOffset = slideDir_TexelSize * max(offset, f32(j) + 1.0);
    let sampleUV = uv + uvOffset * samplingDirection;
    if (sampleUV.x <= 0.0 || sampleUV.y <= 0.0 || sampleUV.x >= 1.0 || sampleUV.y >= 1.0) { break; }

    let mipOffset = select(0u, min((j + 1u) / 2u, 4u), mipOpt);
    let samplePosVS = posSSToVSMip(sampleUV, mipOffset);
    let pixelToSample = normalize(samplePosVS - posVS);

    // --- thickness heuristic (lab 08 + P4 two-sided) -----------------------
    var thick = params.thickness;
    var backPointVS = samplePosVS - viewDir * thick; // constant-heuristic default
    var twoSided = false;
    if (params.thicknessHeuristic == 3u) {
      // TWO-SIDED depth (P4): the occluder interval is [frontZ, backZ] where
      // backZ comes from a back-face depth prepass rendered at march res — the
      // sector is marked only within the REAL interval, killing the halo/leak
      // tradeoff instead of tuning it. Sky / no-back-face samples fall back to
      // Ottosson (handled by the elif below).
      let backC = vec2<i32>(floor(sampleUV * params.resolution));
      let backD = backDepthAt(backC);
      if (backD < 0.99999) {
        let stdBack = viewPosStd(sampleUV, backD);
        let bp = vec3<f32>(stdBack.x, stdBack.y, -stdBack.z);
        if (bp.z > samplePosVS.z + 1e-4) { backPointVS = bp; twoSided = true; }
      }
    }
    if (params.thicknessHeuristic == 1u) {
      // linear-over-distance (lab 08 heuristic 1).
      thick = params.thickness + params.linearThickK * length(samplePosVS - posVS);
      backPointVS = samplePosVS - viewDir * thick;
    } else if (params.thicknessHeuristic == 2u || (params.thicknessHeuristic == 3u && !twoSided)) {
      // Ottosson 3clGWB occluder-size estimate (lab 08 zoo winner). Ported from
      // gt-distant.wgsl; dot/length are flip-invariant so viewDir == V here.
      // Also serves as the two-sided fallback for samples with no back face.
      var deltaPrevPos = samplePosVS - previousPos;
      deltaPrevPos = vec3<f32>(deltaPrevPos.xy * occluderScale, deltaPrevPos.z);
      let resetOccluder = abs(dot(normalize(deltaPrevPos), viewDir)) > params.occluderCosLimit;
      if (resetOccluder) { occluderStartingPos = samplePosVS; }
      previousPos = samplePosVS;
      thick = occluderScale * (params.thickness
              + params.occluderThicknessScale * length(samplePosVS - occluderStartingPos));
      backPointVS = samplePosVS - viewDir * thick;
    }
    let pixelToSampleBackface = normalize(backPointVS - posVS);

    var fbh = vec2<f32>(dot(pixelToSample, viewDir), dot(pixelToSampleBackface, viewDir));
    fbh = vec2<f32>(fastAcos(fbh.x), fastAcos(fbh.y));
    fbh = clamp(((samplingDirection * -fbh) - n + HALF_PI) / PI, vec2<f32>(0.0), vec2<f32>(1.0));
    if (hasFlag(F_SECTOR_REMAP)) {
      fbh = clamp(fbh * (1.0 + 1.5 * PI / f32(MAX_RAY)) - vec2<f32>(1.5 * HALF_PI / f32(MAX_RAY)), vec2<f32>(0.0), vec2<f32>(1.0));
    }
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

// GTAO slice integral (Jimenez 2016).
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
    if (hasFlag(F_BENT_NORMALS)) { textureStore(bentOut, coord, vec4<f32>(0.0)); }
    return;
  }

  let stdPos = viewPosStd(uv, rawD);
  let posVS = vec3<f32>(stdPos.x, stdPos.y, -stdPos.z); // flipped (z+ forward)

  let nStd = normalize(textureLoad(normalTex, coord, 0).xyz);
  let normalVS = vec3<f32>(nStd.x, nStd.y, -nStd.z);
  let viewDir = normalize(-posVS);

  // NOISE (lab 11): IGN + per-frame temporal advance (or white control). The
  // SSRT3 6-rotation/4-offset temporal cycle (params.temporalOffset/Direction,
  // driven from the CPU) is kept ON TOP as demo 03's structure — the IGN advance
  // decorrelates within a frame, the SSRT3 cycle across frames.
  let noise = noise4(coord, params.frameSeed);
  let noiseDirection = noise.x;
  var initialRayStep = fract(noise.y + params.temporalOffset);
  if (hasFlag(F_JITTER)) {
    initialRayStep = initialRayStep + (noise.z * 2.0 - 1.0);
  }
  // Ottosson occluder-scale jitter (lab 08 3clGWB; accumulated out temporally).
  let occluderScale = pow(2.0, 2.0 * noise.w - 1.0);

  let rotationCount = max(1u, params.rotationCount);
  let useBitmask = hasFlag(F_BITMASK) || hasFlag(F_GI);
  let bentNormals = hasFlag(F_BENT_NORMALS);
  let distantMode = params.distantLightMode;
  let doFallback = distantMode != 0u;
  let fbCount = max(2u, params.fallbackSampleCount);
  let ambientMip = select(3.0, clamp(mipFromConeAngle(PI / f32(fbCount), f32(1u << (params.mipCount - 1u))), 0.0, f32(params.mipCount - 1u)), hasFlag(F_CONE_MIP));

  var visSum : f32 = 0.0;
  var col : vec3<f32> = vec3<f32>(0.0);
  var fallbackColor : vec3<f32> = vec3<f32>(0.0);
  // P4 bent normal + cone accumulation (view-space, flipped posVS basis).
  var bentSum : vec3<f32> = vec3<f32>(0.0);
  var unoccludedTotal : f32 = 0.0;

  for (var i : u32 = 0u; i < rotationCount; i = i + 1u) {
    let rotationAngle = (f32(i) + noiseDirection + params.temporalDirection) * (PI / f32(rotationCount));
    let sliceDir = vec3<f32>(cos(rotationAngle), sin(rotationAngle), 0.0);
    let slideDir_TexelSize = vec2<f32>(sliceDir.x, -sliceDir.y) * (1.0 / params.resolution);

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
      horizonBitmask(true, posVS, slideDir_TexelSize, initialRayStep, uv, viewDir, n, normalVS, planeNormal, occluderScale, &bitfield, &col);
      horizonBitmask(false, posVS, slideDir_TexelSize, initialRayStep, uv, viewDir, n, normalVS, planeNormal, occluderScale, &bitfield, &col);
      visSum = visSum + (1.0 - f32(countOneBits(bitfield)) / f32(MAX_RAY));
    } else {
      let cosR = marchHorizonCos(true, posVS, slideDir_TexelSize, initialRayStep, uv, viewDir);
      let cosL = marchHorizonCos(false, posVS, slideDir_TexelSize, initialRayStep, uv, viewDir);
      visSum = visSum + gtaoSlice(cosL, cosR, n, projLen);
    }

    // --- P4 bent normal + cone from the sector bitmask ----------------------
    // For each UNOCCLUDED bit, rebuild its slice-plane direction with the SAME
    // realTangent/normalVS basis the occlusion test + salm-caps use (bit i ->
    // hemisphere fraction (i+0.5)/32 -> theta = acos(2f-1); dir = realTangent·
    // cos + normalVS·sin, then project out planeNormal). Deriving from that exact
    // basis (not from re-computed raw angles) is the y-convention safeguard
    // (WORKLOG y-mirror). Summed over slices -> centroid = bent normal.
    if (bentNormals && useBitmask) {
      for (var b : u32 = 0u; b < MAX_RAY; b = b + 1u) {
        if ((bitfield & (1u << b)) == 0u) {
          let frac = (f32(b) + 0.5) / f32(MAX_RAY);
          let theta = fastAcos(frac * 2.0 - 1.0);
          var dir = normalize(realTangent * cos(theta) + normalVS * sin(theta));
          dir = normalize(dir - planeNormal * dot(dir, planeNormal));
          bentSum = bentSum + dir;
          unoccludedTotal = unoccludedTotal + 1.0;
        }
      }
    }

    // --- distant light on the unoccluded bits -------------------------------
    if (doFallback) {
      if (distantMode == 2u) {
        // SALM-CAPS (lab 08 wc2SzR verdict): group the 32 bits into caps of
        // capsBits, partial-popcount the VISIBLE bits per cap, one env sample per
        // cap weighted by that visible count. Direction reconstructed with demo
        // 03's own realTangent/normalVS basis at the cap-centre cosine (logged
        // deviation, mirroring lab 08's own note: it ports the STRUCTURE, not the
        // exact per-cap CDF-inverse direction from wcsXDN).
        let bps = clamp(params.capsBits, 1u, 8u);
        let caps = MAX_RAY / bps;
        for (var jc : u32 = 0u; jc < caps; jc = jc + 1u) {
          var occCount : u32 = 0u;
          for (var b : u32 = 0u; b < bps; b = b + 1u) {
            if ((bitfield & (1u << (jc * bps + b))) != 0u) { occCount = occCount + 1u; }
          }
          let vis0 = f32(bps - occCount);
          if (vis0 <= 0.0) { continue; }
          let capCenter = (f32(jc) + 0.5) / f32(caps);       // hemisphere fraction
          let cosine = capCenter * 2.0 - 1.0;
          let angleCosine = fastAcos(cosine);
          var rayDir = normalize(realTangent * cos(angleCosine) + normalVS * sin(angleCosine));
          rayDir = normalize(rayDir - planeNormal * dot(rayDir, planeNormal));
          let rayDirWS = normalize((params.camToWorld * vec4<f32>(rayDir.x, rayDir.y, -rayDir.z, 0.0)).xyz);
          fallbackColor = fallbackColor + sampleEnv(rayDirWS, ambientMip) * (vis0 / f32(MAX_RAY)) * params.distantIntensity;
        }
      } else {
        // SSRT3 §3.2 probe fallback (contiguous ranges, SSRT3-shipped weighting).
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
          let ambient = sampleEnv(rayDirWS, ambientMip);
          let unoccluded = f32(maskSize - hitCount);
          var weight : f32;
          if (hasFlag(F_FB_NORMALIZE)) {
            weight = unoccluded / f32(MAX_RAY);
          } else {
            weight = (unoccluded / f32(maskSize)) / f32(fbCount);
          }
          fallbackColor = fallbackColor + ambient * clamp(weight, 0.0, 1.0);
          bfCopy = bfCopy >> maskSize;
        }
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

  if (bentNormals) {
    var bentDir = normalVS;
    if (dot(bentSum, bentSum) > 1e-8) { bentDir = normalize(bentSum); }
    let visibleCone = clamp(unoccludedTotal / (f32(MAX_RAY) * f32(rotationCount)), 0.0, 1.0);
    // flipped posVS space -> standard three view space (matches oracle + composite).
    let bentStd = vec3<f32>(bentDir.x, bentDir.y, -bentDir.z);
    textureStore(bentOut, coord, vec4<f32>(bentStd, visibleCone));
  }

  textureStore(outTex, coord, vec4<f32>(col, ao));
}
