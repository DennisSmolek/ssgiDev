// Demo 08 — GT-VBAO distant-light + thickness lab.
//
// Lineage (all Bjorn Ottosson / TinyTexel, LIVE 2026-07-17 captures):
//   - wcfGWB  GT-VBAO [Distant Light Sampling] : per-bin direction reconstruction
//             from the occlusion bitmask, one env sample per UNOCCLUDED bit.
//             (`EvaluateLight(WVec_from_VVec(dir))` in the bit loop.)     -> method 0
//   - wc2SzR  GT-VBAO [Distant Light Sampling] (TinyTexel): spherical caps of
//             constant sky colour — bits grouped into sectors, partial popcount
//             gives the visible fraction per cap, one env sample per cap.  -> method 1
//   - 3clGWB  GT-VBAO thickness heuristic : occluder-size estimate
//             (thickness grows with distance from the occluder's start).  -> heuristic 2
//   - wcBGRz  GT-VBAO Light&Occluder heuristic : heuristic 2 + occluder
//             back-face clamp (horCos.y = min(occluderBackAngle, horCos.y)). -> heuristic 3
//   - wcsXDN  slice-relative direction mapping : the SliceRelCDFInverse_Cos /
//             SliceRelCDF_Cos_AtPhiEqualsN pair that turns a bit/cap index back
//             into a view-space direction. Integrated here (it IS the machinery
//             both distant-light methods need); see README for the compose note.
//
// Built on demo 04/05's GT-VBAO march (same slice construction, same
// three-view-space handedness handling: reference axis from = (0,0,+1), the
// mirror of Salm's LIVE (0,0,-1) fix). The GI here is DISTANT light: unoccluded
// bins/caps sample an equirect environment (demo 03's ambient source, re-baked
// with a directional sun so directionality is visible) via camToWorld, NOT the
// beauty buffer. AO still falls out of the same bitmask.
//
// DEVIATION (logged): Salm's caps (method 1) ports his STRUCTURE — grouped
// sectors, partial popcount, one constant-colour env sample per cap weighted by
// visible bit count — but reuses the EXACT SliceRelCDFInverse_Cos for the cap
// centre direction instead of his cheaper approximation ladder
// (InvSinstep11 / SliceRelInverseCDF0_Cos_Ref11). The headline (8 env samples
// vs 32) is preserved and measured; only the per-cap direction is exact-CDF.

struct Params {
  proj : mat4x4<f32>,
  invProj : mat4x4<f32>,
  camToWorld : mat4x4<f32>,   // view->world (camera.matrixWorld); rotate dir to sample env
  resolution : vec2<f32>,
  near : f32,
  far : f32,
  slicesPerFrame : u32,
  stepsPerSlice : u32,
  frameSeed : u32,
  flags : u32,                // b0 acosApprox, b1 slice importance
  thickness : f32,            // base thickness (world/view units)
  marchWidthPx : f32,
  bias : f32,
  thicknessHeuristic : u32,   // 0 const, 1 linear-over-dist, 2 Ottosson, 3 light/occluder
  lightMethod : u32,          // 0 Ottosson per-bin, 1 Salm caps, 2 flat fallback
  occluderThicknessScale : f32,
  occluderCosLimit : f32,
  distantIntensity : f32,
  ambientIntensity : f32,
  linearThickK : f32,         // linear-over-distance slope (heuristic 1)
  bitsPerSector : u32,        // Salm caps sector size (1/2/4/8 -> 32/16/8/4 caps)
  envLod : f32,               // cone-blur LOD into the env mip chain
};

@group(0) @binding(0) var depthTex : texture_depth_2d;
@group(0) @binding(1) var normalTex : texture_2d<f32>;   // view-space normal, [-1,1]
@group(0) @binding(2) var envTex : texture_2d<f32>;      // equirect distant environment
@group(0) @binding(3) var envSampler : sampler;
@group(0) @binding(4) var<uniform> params : Params;

struct VOut { @builtin(position) pos : vec4<f32> };

@vertex
fn vs(@builtin(vertex_index) vid : u32) -> VOut {
  var verts = array<vec2<f32>, 3>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>( 3.0, -1.0),
    vec2<f32>(-1.0,  3.0),
  );
  var out : VOut;
  out.pos = vec4<f32>(verts[vid], 0.0, 1.0);
  return out;
}

const PI : f32 = 3.14159265359;
const PI2 : f32 = 6.28318530718;
const RCP_PI : f32 = 0.31830988618;
const PI05 : f32 = 1.57079632679;
const RCP_PI05 : f32 = 0.63661977236;

fn pcg(x : u32) -> u32 {
  let state = x * 747796405u + 2891336453u;
  let word = ((state >> ((state >> 28u) + 4u)) ^ state) * 277803737u;
  return (word >> 22u) ^ word;
}
fn nextRand(seed : ptr<function, u32>) -> f32 {
  *seed = pcg(*seed);
  return f32(*seed) * (1.0 / 4294967296.0);
}

fn acosPoly(x : f32) -> f32 {
  return 1.5707963267948966 + (-0.20491203466059038 + 0.04832927023878897 * x) * x;
}
fn acosApprox(x : f32) -> f32 {
  let a = abs(x);
  let u = acosPoly(a) * sqrt(1.0 - a);
  return select(PI - u, u, x >= 0.0);
}
fn acosFast(x : f32, useApprox : bool) -> f32 {
  let c = clamp(x, -1.0, 1.0);
  return select(acos(c), acosApprox(c), useApprox);
}

fn viewPosFromDepth(uv : vec2<f32>, d : f32) -> vec3<f32> {
  let ndc = vec2<f32>(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0);
  let vp = params.invProj * vec4<f32>(ndc, d, 1.0);
  return vp.xyz / vp.w;
}
fn projectToPixel(vp : vec3<f32>) -> vec2<f32> {
  let clip = params.proj * vec4<f32>(vp, 1.0);
  let ndc = clip.xyz / clip.w;
  return vec2<f32>(ndc.x * 0.5 + 0.5, 0.5 - ndc.y * 0.5) * params.resolution;
}

// view-space direction -> world-space (rotation part of camToWorld)
fn worldDir(vdir : vec3<f32>) -> vec3<f32> {
  return normalize((params.camToWorld * vec4<f32>(vdir, 0.0)).xyz);
}

// Equirect distant environment. Longitude atan2(z,x), latitude acos(y).
// Sampled at an explicit LOD (cone blur). Same convention as demo 03's sampleEnv.
fn sampleEnv(dirWS : vec3<f32>, lod : f32) -> vec3<f32> {
  let d = normalize(dirWS);
  let u = atan2(d.z, d.x) / PI2 + 0.5;
  let v = acos(clamp(d.y, -1.0, 1.0)) / PI;
  return textureSampleLevel(envTex, envSampler, vec2<f32>(u, v), lod).rgb;
}
// Distant light in a world direction: env radiance scaled by intensity, plus a
// small constant ambient floor (mirrors EvaluateLight's ambientIntensity term).
fn evaluateLight(dirWS : vec3<f32>, lod : f32) -> vec3<f32> {
  return sampleEnv(dirWS, lod) * params.distantIntensity + vec3<f32>(params.ambientIntensity);
}

fn getQuatToV(V : vec3<f32>) -> vec4<f32> {
  var xyz = vec3<f32>(-V.y, V.x, 0.0);
  var s = V.z;
  let u = inverseSqrt(max(0.0, s * 0.5 + 0.5));
  s = 1.0 / u;
  xyz = xyz * (u * 0.5);
  return vec4<f32>(xyz, s);
}
fn transformQz0(v : vec3<f32>, q : vec4<f32>) -> vec3<f32> {
  let k = v.y * q.x - v.x * q.y;
  let g = 2.0 * (v.z * q.w + k);
  var r : vec3<f32>;
  r.x = v.x + q.y * g;
  r.y = v.y - q.x * g;
  r.z = v.z + 2.0 * (q.w * k - v.z * dot(q.xy, q.xy));
  return r;
}
fn transformVz0Qz0(v : vec2<f32>, q : vec4<f32>) -> vec3<f32> {
  let o = q.x * v.y;
  let c = q.y * v.x;
  let b = vec3<f32>(o - c, -o + c, o - c);
  return vec3<f32>(v, 0.0) + 2.0 * (b * vec3<f32>(q.y, q.x, q.w));
}

fn sampleSliceDir(vvsN : vec3<f32>, rnd01 : f32) -> vec2<f32> {
  let ang0 = rnd01 * PI;
  var dir0 = vec2<f32>(cos(ang0), sin(ang0));
  let l = length(vvsN.xy);
  if (l == 0.0) { return dir0; }
  if (dot(dir0, vvsN.xy) < 0.0) { dir0 = -dir0; }
  let n = vvsN.xy / l;
  let x0 = dir0.x * n.y - dir0.y * n.x;
  var s = l;
  s = s + (s - s * s) * 0.15;
  let y = acos(clamp(x0 * sin(s * PI05), -1.0, 1.0)) * RCP_PI05;
  let ys = 1.0 / s;
  let dy = ys - ys * y;
  let dx = sqrt(clamp(1.0 - dy * dy, 0.0, 1.0));
  return vec2<f32>(dx * n.x - dy * n.y, dy * n.x + dx * n.y);
}

fn sliceRelCDF_Cos(x : f32, angN : f32, cosN : f32, isPhiLargerThanAngN : bool) -> f32 {
  if (x <= 0.0 || x >= 1.0) { return x; }
  let phi = x * PI - PI05;
  let n0 = select(1.0, 3.0, isPhiLargerThanAngN);
  let n1 = select(1.0, -1.0, isPhiLargerThanAngN);
  let n2 = select(0.0, 4.0, isPhiLargerThanAngN);
  let t0 = n0 * cosN + n1 * cos(angN - 2.0 * phi)
         + (n2 * angN + (n1 * 2.0) * phi + PI) * sin(angN);
  let t1 = 4.0 * (cosN + angN * sin(angN));
  return t0 / t1;
}
// value of the cosine slice-relative CDF at phi == angN (split point of the inverse).
fn sliceRelCDF_Cos_AtPhiEqualsN(angN : f32, cosN : f32) -> f32 {
  let t0 = 2.0 * cosN + (2.0 * angN + PI) * sin(angN);
  let t1 = 4.0 * (cosN + angN * sin(angN));
  return t0 / t1;
}
// inverse of the cosine slice-relative CDF (wcsXDN slice-relative dir mapping).
fn sliceRelCDFInverse_Cos(y : f32, angN : f32, yAtN : f32) -> f32 {
  let isYSmall = y < yAtN;
  let y0 = select(yAtN, 0.0, isYSmall);
  let y1 = select(1.0, yAtN, isYSmall);
  let xN = angN * RCP_PI + 0.5;
  let x0 = select(xN, 0.0, isYSmall);
  let x1 = select(1.0, xN, isYSmall);
  return x0 + acos(clamp(1.0 - 2.0 * (y - y0) / (y1 - y0), -1.0, 1.0)) * RCP_PI * (x1 - x0);
}

fn arcToBits(hor01 : vec2<f32>) -> u32 {
  let horInt = vec2<u32>(vec2<i32>(floor(hor01 * 32.0)));
  let full = 0xFFFFFFFFu;
  let mX = select(0u, full << horInt.x, horInt.x < 32u);
  let mY = select(0u, full >> (32u - horInt.y), horInt.y != 0u);
  return mX & mY;
}

struct GIResult { gi : vec3<f32>, ao : f32 };

fn gtDistant(coord : vec2<i32>, positionVS0 : vec3<f32>, normalVS : vec3<f32>) -> GIResult {
  let useAcosApprox = (params.flags & 1u) != 0u;
  let useImportance = (params.flags & 2u) != 0u;
  let heuristic = params.thicknessHeuristic;
  let lightMethod = params.lightMethod;

  let positionVS = positionVS0 + normalVS * params.bias;
  let V = -normalize(positionVS);
  let rayStart = projectToPixel(positionVS);

  let Q_toV = getQuatToV(V);
  let Q_fromV = Q_toV * vec4<f32>(-1.0, -1.0, -1.0, 1.0);

  let count = f32(params.stepsPerSlice);
  let sStep = pow(params.marchWidthPx, 1.0 / count);

  var giAcc = vec3<f32>(0.0);
  var aoAcc = 0.0;
  let dirCount = max(1u, params.slicesPerFrame);

  for (var i = 0u; i < dirCount; i = i + 1u) {
    let n = params.frameSeed * dirCount + i;
    var seed = pcg(
      (u32(coord.x) * 3266489917u) ^
      (u32(coord.y) * 668265263u) ^
      (n * 374761393u) ^ 0x9CF617FAu,
    );
    let rndSlice = nextRand(&seed);
    var rndZ = nextRand(&seed);
    let rndW = nextRand(&seed);
    let rndY = nextRand(&seed); // occluder-scale jitter (heuristics 2/3)

    // -------- slice-direction sampling --------
    var smplDirVS : vec3<f32>;
    var dir : vec2<f32>;
    if (useImportance) {
      let normalVVS = transformQz0(normalVS, Q_fromV);
      smplDirVS = transformVz0Qz0(sampleSliceDir(normalVVS, rndSlice), Q_toV);
    } else {
      let a = rndSlice * PI;
      smplDirVS = transformVz0Qz0(vec2<f32>(cos(a), sin(a)), Q_toV);
    }
    {
      let eps = 0.5 * params.near;
      let pe = projectToPixel(positionVS + smplDirVS * eps);
      var rd = pe - rayStart;
      let rl = length(rd);
      if (rl < 1e-6) { continue; }
      dir = rd / rl;
    }

    // -------- construct slice --------
    let sliceN = cross(V, smplDirVS);
    let projN = normalVS - sliceN * dot(normalVS, sliceN);
    let projNSqrLen = dot(projN, projN);
    if (projNSqrLen == 0.0) { aoAcc = aoAcc + 1.0; continue; }
    let projNRcpLen = inverseSqrt(projNSqrLen);
    let projNLen = 1.0 / projNRcpLen;
    let cosN = dot(projN, V) * projNRcpLen;
    let T = cross(sliceN, projN);
    let sgn = select(1.0, -1.0, dot(V, T) < 0.0);
    let angN = sgn * acosFast(cosN, useAcosApprox);
    let angOff = angN * RCP_PI + 0.5;

    let occluderScale = pow(2.0, 2.0 * rndY - 1.0);

    // -------- find horizons (bidirectional) --------
    var occBits = 0u;
    var d = -1.0;
    loop {
      let rayDir = dir * d;
      var t = pow(sStep, rndZ);
      rndZ = 1.0 - rndZ;

      // occluder-tracking state (heuristics 2/3), reset per march direction.
      var occluderStartingPos = positionVS;
      var previousPos = positionVS;

      for (var st = 0u; st < params.stepsPerSlice; st = st + 1u) {
        let samplePos = rayStart + rayDir * t;
        t = t * sStep;
        if (samplePos.x < 0.0 || samplePos.x >= params.resolution.x ||
            samplePos.y < 0.0 || samplePos.y >= params.resolution.y) { break; }

        let sc = vec2<i32>(floor(samplePos));
        let sd = textureLoad(depthTex, sc, 0);
        if (sd >= 0.99999) { continue; }
        let suv = samplePos / params.resolution;
        let samplePosVS = viewPosFromDepth(suv, sd);

        // ---- thickness heuristic ----
        var thick = params.thickness;
        if (heuristic == 1u) {
          // linear-over-distance baseline
          thick = params.thickness + params.linearThickK * length(samplePosVS - positionVS);
        } else if (heuristic >= 2u) {
          // Ottosson occluder-size estimate (3clGWB) + light/occluder (wcBGRz).
          var deltaPrevPos = samplePosVS - previousPos;
          deltaPrevPos = vec3<f32>(deltaPrevPos.xy * occluderScale, deltaPrevPos.z);
          let resetOccluder = abs(dot(normalize(deltaPrevPos), V)) > params.occluderCosLimit;
          if (resetOccluder) { occluderStartingPos = samplePosVS; }
          previousPos = samplePosVS;
          thick = occluderScale * (params.thickness
                  + params.occluderThicknessScale * length(samplePosVS - occluderStartingPos));
        }

        let deltaPosFront = samplePosVS - positionVS;
        let deltaPosBack = deltaPosFront - V * thick;

        var horCos = vec2<f32>(dot(normalize(deltaPosFront), V),
                               dot(normalize(deltaPosBack), V));
        // wcBGRz: clamp the back horizon to the occluder's own back face.
        if (heuristic == 3u) {
          let deltaBackOcc = occluderStartingPos - positionVS - V * thick;
          horCos.y = min(dot(normalize(deltaBackOcc), V), horCos.y);
        }

        let horAng = vec2<f32>(acosFast(horCos.x, useAcosApprox),
                               acosFast(horCos.y, useAcosApprox)) * d;
        var hor01 = clamp(horAng * RCP_PI + angOff, vec2<f32>(0.0), vec2<f32>(1.0));
        hor01 = select(hor01.yx, hor01.xy, d >= 0.0);
        hor01.x = sliceRelCDF_Cos(hor01.x, angN, cosN, d > 0.0);
        hor01.y = sliceRelCDF_Cos(hor01.y, angN, cosN, d > 0.0);
        hor01 = clamp(hor01 + rndW * (1.0 / 32.0), vec2<f32>(0.0), vec2<f32>(1.0));

        occBits = occBits | arcToBits(hor01);
      }

      d = d + 2.0;
      if (d > 1.0) { break; }
    }

    // per-slice cosine normalisation weight (uniform slice-dir sampling).
    var sliceWeight = 1.0;
    if (!useImportance) {
      sliceWeight = max(0.0, projNLen * (cosN + angN * sin(angN)));
    }

    let occ0 = f32(countOneBits(occBits)) * (1.0 / 32.0);
    aoAcc = aoAcc + sliceWeight * (1.0 - occ0);

    // ================= distant-light evaluation =================
    var lightSum = vec3<f32>(0.0);
    let yAtN = sliceRelCDF_Cos_AtPhiEqualsN(angN, cosN);

    if (lightMethod == 2u) {
      // flat fallback: unoccluded fraction times a flat ambient env sample (up).
      let flat = evaluateLight(worldDir(V), params.envLod);
      lightSum = flat * (1.0 - occ0);
    } else if (lightMethod == 1u) {
      // Salm spherical caps: group bits into sectors, one constant-colour env
      // sample per cap weighted by the visible bit count (wc2SzR structure).
      let bps = clamp(params.bitsPerSector, 1u, 8u);
      let caps = 32u / bps;
      let rcpCaps = 1.0 / f32(caps);
      for (var j = 0u; j < caps; j = j + 1u) {
        var occCount = 0u;
        for (var b = 0u; b < bps; b = b + 1u) {
          if ((occBits & (1u << (j * bps + b))) != 0u) { occCount = occCount + 1u; }
        }
        let vis0 = f32(bps - occCount);
        if (vis0 <= 0.0) { continue; }
        let hor = (f32(j) + 0.5) * rcpCaps;           // cap centre in CDF space
        let x = sliceRelCDFInverse_Cos(hor, angN, yAtN);
        let angle = (x - angOff) * PI;
        let dirVS = smplDirVS * sin(angle) + V * cos(angle);
        lightSum = lightSum + evaluateLight(worldDir(dirVS), params.envLod) * vis0;
      }
      lightSum = lightSum * (1.0 / 32.0);
    } else {
      // Ottosson per-bin (wcfGWB): one env sample per unoccluded bit.
      var hor = 0.5 / 32.0;
      for (var b = 0u; b < 32u; b = b + 1u) {
        if ((occBits & (1u << b)) == 0u) {
          let x = sliceRelCDFInverse_Cos(hor, angN, yAtN);
          let angle = (x - angOff) * PI;
          let dirVS = smplDirVS * sin(angle) + V * cos(angle);
          lightSum = lightSum + evaluateLight(worldDir(dirVS), params.envLod);
        }
        hor = hor + 1.0 / 32.0;
      }
      lightSum = lightSum * (1.0 / 32.0);
    }

    giAcc = giAcc + sliceWeight * lightSum;
  }

  let norm = 1.0 / f32(dirCount);
  var res : GIResult;
  res.gi = giAcc * norm;
  res.ao = aoAcc * norm;
  return res;
}

@fragment
fn fs(in : VOut) -> @location(0) vec4<f32> {
  let coord = vec2<i32>(floor(in.pos.xy));
  let d = textureLoad(depthTex, coord, 0);
  if (d >= 0.99999) {
    return vec4<f32>(0.0, 0.0, 0.0, 1.0); // background: open AO, no distant term
  }
  let uv = in.pos.xy / params.resolution;
  let N = normalize(textureLoad(normalTex, coord, 0).xyz);
  let positionVS = viewPosFromDepth(uv, d);
  let r = gtDistant(coord, positionVS, N);
  // rgb = distant-light radiance (unmodulated), a = AO. Additive accum; display /count.
  return vec4<f32>(r.gi, r.ao);
}
