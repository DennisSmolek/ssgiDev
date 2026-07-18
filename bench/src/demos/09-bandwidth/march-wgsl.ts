// Demo 09 — bandwidth lab. Single source of truth for the SSRT march, emitted in
// three dispatch variants that share ONE core (the reconstruct + horizon/bitmask
// + GI-gather math, forked from demo 03 ssrt-main.wgsl):
//
//   1. compute-plain  — 8x8 compute, depth read via global textureLoad.
//   2. compute-shared — 8x8 compute, LSAO-style workgroup shared-memory depth
//                       tile cooperatively preloaded once per workgroup; near
//                       samples read from LDS, far samples fall back to global.
//   3. fragment       — fullscreen-triangle fragment pass, identical core math.
//
// The march is DECOUPLED from the native G-buffer: it reads a march-resolution
// depth (r32float), normal and light buffer produced by the downsample pass, so
// the SAME code runs unchanged at full / half / quarter res (Table 2 half-res
// recipe). Sampling stays in normalized [0,1] uv; integer coords derive from
// params.resolution (== march res), so everything is self-consistent per scale.
//
// The only per-variant seam is `sampleMarchDepthUV(uv) -> f32` (raw clip depth):
// plain/fragment define it as a global fetch, shared defines it as tile-or-global.

// Params: 52 f32 = 208 bytes (mat4 proj + mat4 invProj + scalars). Layout mirrors
// index.ts fillUniform().
const PARAMS_STRUCT = /* wgsl */ `
struct Params {
  proj : mat4x4<f32>,
  invProj : mat4x4<f32>,
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
  pad0 : f32,
  pad1 : f32,
};

const PI : f32 = 3.14159265359;
const HALF_PI : f32 = 1.57079632679;
const MAX_RAY : u32 = 32u;

// flags bits (subset of demo 03 relevant to the bandwidth lab)
const F_BITMASK : u32 = 1u;
const F_JITTER : u32 = 2u;
const F_LINEAR_THICKNESS : u32 = 4u;
const F_NORMALAPPROX : u32 = 32u;
const F_GI : u32 = 512u;

fn hasFlag(f : u32) -> bool { return (params.flags & f) != 0u; }
`;

// Core math. References the module-global bindings marchNormalTex / lightTex /
// params and the per-variant fn sampleMarchDepthUV(uv). No entry point, no
// storage/output binding — those are variant-specific.
const CORE = /* wgsl */ `
fn clampCoordRes(c : vec2<i32>) -> vec2<i32> {
  return clamp(c, vec2<i32>(0), vec2<i32>(params.resolution) - vec2<i32>(1));
}
fn coordFromUV(uv : vec2<f32>) -> vec2<i32> {
  return vec2<i32>(floor(uv * params.resolution));
}

fn spatialOffsets(p : vec2<i32>) -> f32 { return 0.25 * f32((p.y - p.x) & 3); }
fn gradientNoise(p : vec2<f32>) -> f32 {
  return fract(52.9829189 * fract(dot(p, vec2<f32>(0.06711056, 0.00583715))));
}
fn rand(co : vec2<f32>) -> f32 {
  let dt = dot(co, vec2<f32>(12.9898, 78.233));
  let sn = dt % 3.14;
  return fract(sin(sn) * 43758.5453);
}
fn fastAcos(xIn : f32) -> f32 {
  let x = clamp(xIn, -1.0, 1.0);
  var o = -0.156583 * abs(x) + HALF_PI;
  o = o * sqrt(1.0 - abs(x));
  if (x >= 0.0) { return o; }
  return PI - o;
}

// Standard three view-space position (z negative forward) from uv + clip depth.
fn viewPosStd(uv : vec2<f32>, d : f32) -> vec3<f32> {
  let ndc = vec2<f32>(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0);
  let clip = vec4<f32>(ndc, d, 1.0);
  let vp = params.invProj * clip;
  return vp.xyz / vp.w;
}
// SSRT3 flipped posVS (z positive forward). Depth comes through the per-variant
// sampleMarchDepthUV seam so the shared-memory variant can serve it from LDS.
fn posSSToVS(uv : vec2<f32>) -> vec3<f32> {
  let d = sampleMarchDepthUV(uv);
  let stdP = viewPosStd(uv, d);
  return vec3<f32>(stdP.x, stdP.y, -stdP.z);
}
fn sampleNormalVS(uv : vec2<f32>) -> vec3<f32> {
  let n = normalize(textureLoad(marchNormalTex, clampCoordRes(coordFromUV(uv)), 0).xyz);
  return vec3<f32>(n.x, n.y, -n.z);
}

fn computeOccludedBitfield(minHorizon : f32, maxHorizon : f32, globalBitfield : ptr<function, u32>) -> u32 {
  var startHorizonInt = u32(minHorizon * f32(MAX_RAY));
  if (startHorizonInt >= 32u) { startHorizonInt = 31u; }
  let angleHorizonInt = u32(ceil(clamp(maxHorizon - minHorizon, 0.0, 1.0) * f32(MAX_RAY)));
  var angleHorizonBitfield : u32 = 0u;
  if (angleHorizonInt > 0u) { angleHorizonBitfield = 0xFFFFFFFFu >> (32u - angleHorizonInt); }
  var current = angleHorizonBitfield << startHorizonInt;
  current = current & (~(*globalBitfield));
  *globalBitfield = (*globalBitfield) | current;
  return countOneBits(current);
}

// Classic GTAO horizon march (stage a path).
fn marchHorizonCos(dirIsRight : bool, posVS : vec3<f32>, slideDir_TexelSize : vec2<f32>,
                   initialRayStep : f32, uv : vec2<f32>, viewDir : vec3<f32>) -> f32 {
  let stepCount = max(1u, params.stepCount);
  var stepRadius = max((params.radius * params.halfProjScale) / posVS.z, f32(stepCount));
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
    // GTAO-canonical falloff (same fix as demo 03's ssrt-main.wgsl): fade the
    // RESULT toward the previous horizon, never scale the cosine itself.
    let distFacSq = clamp((dist * dist) / (params.radius * params.radius), 0.0, 1.0);
    cHorizon = mix(max(cHorizon, c), cHorizon, distFacSq);
  }
  return cHorizon;
}

// VBAO bitmask + GI gather sweep (stages b/c path).
fn horizonBitmask(dirIsRight : bool, posVS : vec3<f32>, slideDir_TexelSize : vec2<f32>,
                  initialRayStep : f32, uv : vec2<f32>, viewDir : vec3<f32>, n : f32,
                  normalVS : vec3<f32>, planeNormal : vec3<f32>,
                  globalBitfield : ptr<function, u32>, col : ptr<function, vec3<f32>>) {
  let stepCount = max(1u, params.stepCount);
  var stepRadius = max((params.radius * params.halfProjScale) / posVS.z, f32(stepCount));
  stepRadius = stepRadius / (f32(stepCount) + 1.0);
  let radiusVS = max(1.0, f32(stepCount) - 1.0) * stepRadius;
  let samplingDirection = select(-1.0, 1.0, dirIsRight);
  let gatherGI = hasFlag(F_GI);
  var lastSamplePosVS = posVS;

  for (var j : u32 = 0u; j < stepCount; j = j + 1u) {
    let offset = pow(abs((stepRadius * (f32(j) + initialRayStep)) / radiusVS), params.expFactor) * radiusVS;
    let uvOffset = slideDir_TexelSize * max(offset, f32(j) + 1.0);
    let sampleUV = uv + uvOffset * samplingDirection;
    if (sampleUV.x <= 0.0 || sampleUV.y <= 0.0 || sampleUV.x >= 1.0 || sampleUV.y >= 1.0) { break; }

    let samplePosVS = posSSToVS(sampleUV);
    let pixelToSample = normalize(samplePosVS - posVS);
    let linearThicknessMultiplier = select(1.0, clamp(samplePosVS.z / params.far, 0.0, 1.0) * 100.0, hasFlag(F_LINEAR_THICKNESS));
    let pixelToSampleBackface = normalize((samplePosVS - linearThicknessMultiplier * viewDir * params.thickness) - posVS);

    var fbh = vec2<f32>(dot(pixelToSample, viewDir), dot(pixelToSampleBackface, viewDir));
    fbh = vec2<f32>(fastAcos(fbh.x), fastAcos(fbh.y));
    fbh = clamp(((samplingDirection * -fbh) - n + HALF_PI) / PI, vec2<f32>(0.0), vec2<f32>(1.0));
    let ordered = select(fbh, fbh.yx, dirIsRight);
    let numOccludedZones = computeOccludedBitfield(ordered.x, ordered.y, globalBitfield);

    if (gatherGI && numOccludedZones > 0u) {
      let c = clampCoordRes(coordFromUV(sampleUV));
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

// The whole march for one pixel. Returns vec4(GI.rgb, AO.a).
fn computeGiAo(coord : vec2<i32>, uv : vec2<f32>) -> vec4<f32> {
  let rawD = sampleMarchDepthUV(uv);
  if (rawD >= 0.99999) { return vec4<f32>(0.0, 0.0, 0.0, 1.0); }

  let stdPos = viewPosStd(uv, rawD);
  let posVS = vec3<f32>(stdPos.x, stdPos.y, -stdPos.z);
  let nStd = normalize(textureLoad(marchNormalTex, clampCoordRes(coord), 0).xyz);
  let normalVS = vec3<f32>(nStd.x, nStd.y, -nStd.z);
  let viewDir = normalize(-posVS);

  let noiseOffset = spatialOffsets(coord);
  let noiseDirection = gradientNoise(vec2<f32>(coord));
  var initialRayStep = fract(noiseOffset + params.temporalOffset);
  if (hasFlag(F_JITTER)) { initialRayStep = initialRayStep + (rand(uv) * 2.0 - 1.0); }

  let rotationCount = max(1u, params.rotationCount);
  let useBitmask = hasFlag(F_BITMASK) || hasFlag(F_GI);

  var visSum : f32 = 0.0;
  var col : vec3<f32> = vec3<f32>(0.0);

  for (var i : u32 = 0u; i < rotationCount; i = i + 1u) {
    let rotationAngle = (f32(i) + noiseDirection + params.temporalDirection) * (PI / f32(rotationCount));
    let sliceDir = vec3<f32>(cos(rotationAngle), sin(rotationAngle), 0.0);
    let slideDir_TexelSize = vec2<f32>(sliceDir.x, -sliceDir.y) * (1.0 / params.resolution); // screen y-down vs view y-up (see demo 03 ssrt-main.wgsl)

    let planeNormal = normalize(cross(sliceDir, viewDir));
    let tangent = cross(viewDir, planeNormal);
    let projectedNormal = normalVS - planeNormal * dot(normalVS, planeNormal);
    let projLen = length(projectedNormal);
    let projectedNormalN = projectedNormal / max(projLen, 1e-5);

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
  }

  var ao = clamp(visSum / f32(rotationCount), 0.0, 1.0);
  ao = clamp(pow(ao, params.aoIntensity), 0.0, 1.0);
  col = col / f32(rotationCount);
  col = col * params.giIntensity;
  let vmax = max(max(col.r, col.g), col.b);
  if (vmax > params.maxLuminance) { col = col * (params.maxLuminance / vmax); }
  return vec4<f32>(col, ao);
}
`;

// --- variant seams ---------------------------------------------------------

const BINDINGS_COMPUTE = /* wgsl */ `
@group(0) @binding(0) var marchDepthTex : texture_2d<f32>;
@group(0) @binding(1) var marchNormalTex : texture_2d<f32>;
@group(0) @binding(2) var lightTex : texture_2d<f32>;
@group(0) @binding(3) var outTex : texture_storage_2d<rgba16float, write>;
@group(0) @binding(4) var<uniform> params : Params;
`;

const BINDINGS_FRAGMENT = /* wgsl */ `
@group(0) @binding(0) var marchDepthTex : texture_2d<f32>;
@group(0) @binding(1) var marchNormalTex : texture_2d<f32>;
@group(0) @binding(2) var lightTex : texture_2d<f32>;
@group(0) @binding(3) var<uniform> params : Params;
`;

const SEAM_GLOBAL = /* wgsl */ `
fn sampleMarchDepthUV(uv : vec2<f32>) -> f32 {
  return textureLoad(marchDepthTex, clampCoordRes(coordFromUV(uv)), 0).r;
}
`;

// LSAO-style tile: workgroup preloads an (8 + 2*BORDER)^2 depth tile once. Near
// samples (within the tile) read from LDS; anything beyond (exponential far
// steps, large radius) falls back to a global fetch. BORDER=8 -> 24x24 = 576 f32
// = 2.3 KB shared memory. Only DEPTH is cached (normal + light stay global) —
// this is deliberately the "cooperative depth tile loading alone" experiment the
// spec asks about.
const TILE = 24; // 8 + 2*8
const SEAM_SHARED = /* wgsl */ `
const WG : u32 = 8u;
const BORDER : i32 = 8;
const TILE : i32 = ${TILE};
var<workgroup> gTile : array<f32, ${TILE * TILE}>;
var<workgroup> gTileOrigin : vec2<i32>;

fn sampleMarchDepthUV(uv : vec2<f32>) -> f32 {
  let coord = coordFromUV(uv);
  let local = coord - gTileOrigin;
  if (local.x >= 0 && local.y >= 0 && local.x < TILE && local.y < TILE) {
    return gTile[local.y * TILE + local.x];
  }
  return textureLoad(marchDepthTex, clampCoordRes(coord), 0).r;
}
`;

const ENTRY_COMPUTE_PLAIN = /* wgsl */ `
@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) gid : vec3<u32>) {
  let dim = vec2<u32>(u32(params.resolution.x), u32(params.resolution.y));
  if (gid.x >= dim.x || gid.y >= dim.y) { return; }
  let coord = vec2<i32>(gid.xy);
  let uv = (vec2<f32>(gid.xy) + 0.5) / params.resolution;
  textureStore(outTex, coord, computeGiAo(coord, uv));
}
`;

const ENTRY_COMPUTE_SHARED = /* wgsl */ `
@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) gid : vec3<u32>,
        @builtin(local_invocation_index) lidx : u32,
        @builtin(workgroup_id) wid : vec3<u32>) {
  // Cooperative depth-tile preload (uniform control flow: every thread, incl.
  // out-of-range, participates through both barriers).
  let origin = vec2<i32>(wid.xy) * i32(WG) - vec2<i32>(BORDER);
  if (lidx == 0u) { gTileOrigin = origin; }
  workgroupBarrier();
  var i = lidx;
  loop {
    if (i >= u32(TILE * TILE)) { break; }
    let tx = i32(i % u32(TILE));
    let ty = i32(i / u32(TILE));
    gTile[i] = textureLoad(marchDepthTex, clampCoordRes(origin + vec2<i32>(tx, ty)), 0).r;
    i = i + WG * WG;
  }
  workgroupBarrier();

  let dim = vec2<u32>(u32(params.resolution.x), u32(params.resolution.y));
  if (gid.x >= dim.x || gid.y >= dim.y) { return; }
  let coord = vec2<i32>(gid.xy);
  let uv = (vec2<f32>(gid.xy) + 0.5) / params.resolution;
  textureStore(outTex, coord, computeGiAo(coord, uv));
}
`;

const ENTRY_FRAGMENT = /* wgsl */ `
struct VSOut {
  @builtin(position) pos : vec4<f32>,
  @location(0) uv : vec2<f32>,
};
@vertex
fn vs(@builtin(vertex_index) vi : u32) -> VSOut {
  var p = array<vec2<f32>, 3>(vec2<f32>(-1.0, -1.0), vec2<f32>(3.0, -1.0), vec2<f32>(-1.0, 3.0));
  var o : VSOut;
  o.pos = vec4<f32>(p[vi], 0.0, 1.0);
  // WebGPU top-left uv origin (matches compute uv).
  o.uv = vec2<f32>((p[vi].x + 1.0) * 0.5, 1.0 - (p[vi].y + 1.0) * 0.5);
  return o;
}
@fragment
fn fs(in : VSOut) -> @location(0) vec4<f32> {
  let coord = coordFromUV(in.uv);
  return computeGiAo(coord, in.uv);
}
`;

export const marchComputePlainWgsl = PARAMS_STRUCT + BINDINGS_COMPUTE + SEAM_GLOBAL + CORE + ENTRY_COMPUTE_PLAIN;
export const marchComputeSharedWgsl = PARAMS_STRUCT + BINDINGS_COMPUTE + SEAM_SHARED + CORE + ENTRY_COMPUTE_SHARED;
export const marchFragmentWgsl = PARAMS_STRUCT + BINDINGS_FRAGMENT + SEAM_GLOBAL + CORE + ENTRY_FRAGMENT;
