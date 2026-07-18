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
const F_GI : u32 = 512u;
const F_SECTOR_REMAP : u32 = 1024u; // bit10: Therrien's shipped-but-commented "one
// sector narrower hemisphere" remap (SSRTCS.compute L265). Coplanar samples land
// exactly on the hemisphere boundary where ceil() stamps a phantom sector
// (1/32 AO per step, rotation-modulated flicker on flat surfaces); shrinking the
// mapped range by ~1.5 sectors per side collapses those spans to zero width.            // bit9: gather GI (c+)

@group(0) @binding(0) var depthTex : texture_depth_2d;
@group(0) @binding(1) var normalTex : texture_2d<f32>;   // three normalView (view-space, [-1,1])
@group(0) @binding(2) var lightTex : texture_2d<f32>;    // radiance source (beauty, or lightmask at f)
@group(0) @binding(3) var envTex : texture_2d<f32>;      // equirect ambient source (fallback, e)
@group(0) @binding(4) var envSampler : sampler;          // filtering sampler for envTex
@group(0) @binding(5) var depthPyramid : texture_2d<f32>;// raw-depth mip pyramid (g, mipOptimization)
@group(0) @binding(6) var outTex : texture_storage_2d<rgba16float, write>;
@group(0) @binding(7) var<uniform> params : Params;

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

// Cone-angle -> mip (patapom.com/blog/BRDF/PreIntegration). SSRT3 has this but
// ships hardcoded mip 3; we expose both (F_CONE_MIP toggle).
fn mipFromConeAngle(theta : f32, envSize : f32) -> f32 {
  let nMip = log2(envSize);
  let u = cos(theta * 0.5);
  return nMip + 0.5 * log2(1.0 / (u * u) - 1.0);
}

// Sample the equirectangular ambient source in a world-space direction at an
// explicit LOD (cone blur). Equirect UV: longitude atan2(z,x), latitude acos(y).
// (Deviation logged in README: SSRT3 samples a cube PMREM; we use an equirect
// radiance texture because three's cube-uv PMREM atlas packing is impractical to
// sample from a hand-written compute shader. Same "directional env at cone mip".)
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
// SSRT3 flipped posVS (z positive forward) at a uv, sampling depth at `mip` of
// the depth pyramid (g, mipOptimization). mip 0 uses the full-res depth buffer.
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
    // Distance falloff, GTAO-canonical (see GTAONode.js): raise the horizon with
    // the RAW sample cosine, then fade the RESULT back toward the previous
    // horizon as dist approaches the radius. Multiplying the cosine by the
    // falloff instead drags negative cosines toward zero, which RAISES the
    // horizon on flat grazing surfaces — phantom AO + per-frame boil.
    let distFacSq = clamp((dist * dist) / (params.radius * params.radius), 0.0, 1.0);
    cHorizon = mix(max(cHorizon, c), cHorizon, distFacSq);
  }
  return cHorizon;
}

// --- Stage (b): VBAO 32-bit visibility bitmask (SSRT3 ComputeOccludedBitfield) -
// Marks the sector range [minHorizon, maxHorizon] (both in [0,1] hemisphere
// fraction) as occluded in a 32-bit mask, returns the count of NEWLY occluded
// sectors (bits that were not already set — "newly revealed" is the complement,
// used for GI in stage c).
fn computeOccludedBitfield(minHorizon : f32, maxHorizon : f32, globalBitfield : ptr<function, u32>) -> u32 {
  var startHorizonInt = u32(minHorizon * f32(MAX_RAY));
  if (startHorizonInt >= 32u) { startHorizonInt = 31u; } // guard: 1<<32 is WGSL UB
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

// Sample view-space normal (SSRT3 flipped convention) from three's normalView.
fn sampleNormalVS(sampleUV : vec2<f32>) -> vec3<f32> {
  let c = vec2<i32>(floor(sampleUV * params.resolution));
  let n = normalize(textureLoad(normalTex, c, 0).xyz);
  return vec3<f32>(n.x, n.y, -n.z);
}

// Marches one horizon direction accumulating occluded sectors into the shared
// per-slice bitfield. When F_GI is set, per sample it also gathers radiance from
// the light buffer weighted by the number of NEWLY occluded sectors (SSRT3
// HorizonSampling GI term) — those sectors are ones this sample is the closest
// occluder for, i.e. its surface is visible from the shading point.
fn horizonBitmask(dirIsRight : bool, posVS : vec3<f32>, slideDir_TexelSize : vec2<f32>,
                  initialRayStep : f32, uv : vec2<f32>, viewDir : vec3<f32>, n : f32,
                  normalVS : vec3<f32>, planeNormal : vec3<f32>,
                  globalBitfield : ptr<function, u32>, col : ptr<function, vec3<f32>>) {
  let stepCount = max(1u, params.stepCount);
  var stepRadius = max((params.radius * params.halfProjScale) / posVS.z, f32(stepCount));
  if (hasFlag(F_SCREENSPACE)) {
    stepRadius = (params.radius * (params.resolution.x * 0.5)) / 16.0; // no double-divide
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

    // SSRT3: coarser mip over distance, capped at 4 (the pyramid always has >=5
    // mips at any render scale). params.mipCount is the ENV mip count, not this.
    let mipOffset = select(0u, min((j + 1u) / 2u, 4u), mipOpt);
    let samplePosVS = posSSToVSMip(sampleUV, mipOffset);
    let pixelToSample = normalize(samplePosVS - posVS);
    let linearThicknessMultiplier = select(1.0, clamp(samplePosVS.z / params.far, 0.0, 1.0) * 100.0, hasFlag(F_LINEAR_THICKNESS));
    let pixelToSampleBackface = normalize((samplePosVS - linearThicknessMultiplier * viewDir * params.thickness) - posVS);

    var fbh = vec2<f32>(dot(pixelToSample, viewDir), dot(pixelToSampleBackface, viewDir));
    fbh = vec2<f32>(fastAcos(fbh.x), fastAcos(fbh.y));
    fbh = clamp(((samplingDirection * -fbh) - n + HALF_PI) / PI, vec2<f32>(0.0), vec2<f32>(1.0));
    if (hasFlag(F_SECTOR_REMAP)) {
      fbh = clamp(fbh * (1.0 + 1.5 * PI / f32(MAX_RAY)) - vec2<f32>(1.5 * HALF_PI / f32(MAX_RAY)), vec2<f32>(0.0), vec2<f32>(1.0));
    }
    // Front/back swap by direction (SSRT3: directionIsRight ? .yx : .xy)
    let ordered = select(fbh, fbh.yx, dirIsRight);
    let numOccludedZones = computeOccludedBitfield(ordered.x, ordered.y, globalBitfield);

    if (gatherGI && numOccludedZones > 0u) {
      let c = vec2<i32>(floor(sampleUV * params.resolution));
      var lightColor = textureLoad(lightTex, c, 0).rgb;
      // Firefly clamp as a PARAM (SSGINode hardcodes maxLuminance=7).
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
  // GI gather needs the bitmask (numOccludedZones), so GI implies bitmask.
  let useBitmask = hasFlag(F_BITMASK) || hasFlag(F_GI);
  let doFallback = hasFlag(F_FALLBACK);
  let fbCount = max(2u, params.fallbackSampleCount);
  // Cone->mip (F_CONE_MIP) or hardcoded mip 3 (SSRT3 shipped).
  let ambientMip = select(3.0, clamp(mipFromConeAngle(PI / f32(fbCount), f32(1u << (params.mipCount - 1u))), 0.0, f32(params.mipCount - 1u)), hasFlag(F_CONE_MIP));

  var visSum : f32 = 0.0; // per-slice VISIBILITY (1 = fully open)
  var col : vec3<f32> = vec3<f32>(0.0);
  var fallbackColor : vec3<f32> = vec3<f32>(0.0);

  for (var i : u32 = 0u; i < rotationCount; i = i + 1u) {
    let rotationAngle = (f32(i) + noiseDirection + params.temporalDirection) * (PI / f32(rotationCount));
    let sliceDir = vec3<f32>(cos(rotationAngle), sin(rotationAngle), 0.0);
    // sliceDir is a VIEW-SPACE direction (y up); our screen uv has y DOWN
    // (top-left origin, viewPosStd flips y). Unity's uv is y-up so SSRT3 uses
    // sliceDir.xy for both spaces — here the screen step must mirror y or every
    // slice marches in the y-mirrored plane of its own planeNormal/n frame
    // (horizon sectors land mirrored about the normal; grazing-angle speckle).
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
      // Stages (b/c): VBAO. Both sweeps share one 32-bit sector mask. AO is the
      // occluded-bit fraction; thin plates block only a few sectors (vs GTAO's
      // full-horizon block), so they over-darken far less. GI is gathered per
      // sample inside the sweeps (SSRT3 newly-revealed-sector radiance).
      horizonBitmask(true, posVS, slideDir_TexelSize, initialRayStep, uv, viewDir, n, normalVS, planeNormal, &bitfield, &col);
      horizonBitmask(false, posVS, slideDir_TexelSize, initialRayStep, uv, viewDir, n, normalVS, planeNormal, &bitfield, &col);
      visSum = visSum + (1.0 - f32(countOneBits(bitfield)) / f32(MAX_RAY));
    } else {
      // Stage (a): classic GTAO horizon-angle integration.
      let cosR = marchHorizonCos(true, posVS, slideDir_TexelSize, initialRayStep, uv, viewDir);
      let cosL = marchHorizonCos(false, posVS, slideDir_TexelSize, initialRayStep, uv, viewDir);
      visSum = visSum + gtaoSlice(cosL, cosR, n, projLen);
    }

    // Stage (e): probe fallback (§3.2). Split the same 32-bit mask into fbCount
    // contiguous ranges; per range fire one ambient sample weighted by that
    // range's UNOCCLUDED fraction. Directions stratify across the slice arc
    // (SSRT3 realTangent/normal construction, Fig 8 of the paper).
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
        // flipped view -> std view (flip z) -> world (camToWorld rotation).
        let rayDirWS = normalize((params.camToWorld * vec4<f32>(rayDir.x, rayDir.y, -rayDir.z, 0.0)).xyz);
        let ambient = sampleEnv(rayDirWS, ambientMip);

        let unoccluded = f32(maskSize - hitCount);
        // F_FB_NORMALIZE: SSRT3 shipped (unoccluded/MAX_RAY -> each range caps at
        // 1/fbCount, sums <=1). Else: paper per-subregion (unoccluded/maskSize
        // capped at 1, averaged by /fbCount). See probes/ssrt3-fallback.md §5.
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

  var ao = clamp(visSum / f32(rotationCount), 0.0, 1.0);
  ao = clamp(pow(ao, params.aoIntensity), 0.0, 1.0);

  // GI: average slices, apply GIIntensity. SSRT3 clamps the final value channel
  // (HSV) to 7 to kill fireflies; we keep the per-sample luminance clamp above
  // (firefly clamp as a param) and additionally clamp the summed value here.
  col = col / f32(rotationCount);
  col = col * params.giIntensity;

  // Fallback: average, gamma (fallbackPower) + intensity, add to bounced GI
  // (SSRT3: col = fallbackColor + col*GIIntensity; GIIntensity already applied).
  fallbackColor = fallbackColor / f32(rotationCount);
  fallbackColor = clamp(pow(abs(fallbackColor), vec3<f32>(params.fallbackPower)) * params.fallbackIntensity, vec3<f32>(0.0), vec3<f32>(1.0));
  col = col + fallbackColor;

  let vmax = max(max(col.r, col.g), col.b);
  if (vmax > params.maxLuminance) { col = col * (params.maxLuminance / vmax); }

  textureStore(outTex, coord, vec4<f32>(col, ao));
}
