// Demo 05 — GT-VBGI (cosine-weighted visibility-bitmask GI + AO).
//
// Lineage: Mirko Salm / TinyTexel GT-VBGI family (LIVE 2026-07-17 captures):
//   - bidirectional  : lfdBWn  `GTVBGI()`     (variant 0, default)
//   - unidirectional : XcdBWf  `uniGTVBGI()`  (variant 1; half the depth
//                      samples, single march dir + per-pixel/per-frame side via
//                      full-2pi slice-dir sampling + w0 partial-slice remap)
//   - uniform-weighted: XfcBDl/4cdfzf         (variant 2; uniform hemisphere
//                      weighting, SliceRelCDF_Uniform — polynomial, no acos in
//                      the weighting)
//
// Built on demo 04's GT-VBAO groundwork: same slice construction, same
// screen-space bitmask march, same three-view-space handedness handling
// (reference axis from = (0,0,+1), the mirror of Salm's LIVE (0,0,-1) fix; see
// demo 04 README). The GI extension is the bidirectional-gather bit trick:
// newly-visible bits per depth sample (occBits0 & ~occBits) weight the sample's
// beauty-buffer radiance. AO falls out of the same bitmask for free.
//
// GI is gathered UNMODULATED here (radiance * visibility). Albedo modulation
// happens at composite (PLAN trap, three PR #31839): col = beauty*AO + albedo*GI.

struct Params {
  proj : mat4x4<f32>,
  invProj : mat4x4<f32>,
  resolution : vec2<f32>,
  near : f32,
  far : f32,
  slicesPerFrame : u32,
  stepsPerSlice : u32,
  frameSeed : u32,
  flags : u32,          // b0 acosApprox, b1 importance, b2 thicknessNormalize, b3 backfaceReject
  thickness : f32,
  marchWidthPx : f32,
  bias : f32,
  variant : u32,        // 0 bidirectional, 1 unidirectional, 2 uniform-weighted
  fireflyClamp : f32,   // max luminance per gathered sample
  pad0 : f32,
  pad1 : f32,
};

@group(0) @binding(0) var depthTex : texture_depth_2d;
@group(0) @binding(1) var normalTex : texture_2d<f32>;  // view-space normal, [-1,1]
@group(0) @binding(2) var beautyTex : texture_2d<f32>;  // HDR lit radiance
@group(0) @binding(3) var<uniform> params : Params;

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
fn sliceRelCDF_Uniform(x : f32, angN : f32, isPhiLargerThanAngN : bool) -> f32 {
  if (x <= 0.0 || x >= 1.0) { return x; }
  let phi = x * PI - PI05;
  let m0 = select(0.0, 2.0, isPhiLargerThanAngN);
  let m1 = select(1.0, -1.0, isPhiLargerThanAngN);
  return 0.5 * (m0 + m1 * cos(angN - phi) + sin(angN));
}

fn arcToBits(hor01 : vec2<f32>) -> u32 {
  let horInt = vec2<u32>(vec2<i32>(floor(hor01 * 32.0)));
  let full = 0xFFFFFFFFu;
  let mX = select(0u, full << horInt.x, horInt.x < 32u);
  let mY = select(0u, full >> (32u - horInt.y), horInt.y != 0u);
  return mX & mY;
}

struct GIResult { gi : vec3<f32>, ao : f32 };

fn gtVBGI(coord : vec2<i32>, positionVS0 : vec3<f32>, normalVS : vec3<f32>) -> GIResult {
  let useAcosApprox = (params.flags & 1u) != 0u;
  let useImportance = (params.flags & 2u) != 0u;
  let thickNormalize = (params.flags & 4u) != 0u;
  let backfaceReject = (params.flags & 8u) != 0u;
  let unidirectional = params.variant == 1u;
  let uniformWeight = params.variant == 2u;

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

    // -------- slice-direction sampling --------
    var smplDirVS : vec3<f32>;
    var dir : vec2<f32>;
    if (unidirectional) {
      // full-2pi uniform: the sampled direction encodes which side is marched,
      // so per-pixel/per-frame the two half-slices are both covered.
      let a = rndSlice * PI2;
      smplDirVS = transformVz0Qz0(vec2<f32>(cos(a), sin(a)), Q_toV);
    } else if (uniformWeight) {
      let a = rndSlice * PI; // uniform half-slice; bidirectional march covers rest
      smplDirVS = transformVz0Qz0(vec2<f32>(cos(a), sin(a)), Q_toV);
    } else if (useImportance) {
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

    // per-slice weighting (mode selection)
    var sliceWeight = 1.0;
    if (unidirectional) {
      // mode-1 uniform partial-slice: compensate uniform 2pi dir sampling
      sliceWeight = max(0.0, projNLen * (cosN + angN * sin(angN)));
    } else if (!useImportance || uniformWeight) {
      // uniform slice-dir sampling needs the cosine-normalisation weight
      // (uniform-weight variant uses w=1 via SliceRelCDF_Uniform, so skip)
      if (!uniformWeight) {
        sliceWeight = max(0.0, projNLen * (cosN + angN * sin(angN)));
      }
    }

    // unidirectional partial-slice remap constants
    var w0 = 0.0;
    if (unidirectional) {
      w0 = clamp((sin(angN) / (cosN + angN * sin(angN))) * (PI / 4.0) + 0.5, 0.0, 1.0);
    }
    let w0RemapMul = select(1.0, 1.0 / (1.0 - w0), unidirectional);
    let w0RemapAdd = select(0.0, -w0 * w0RemapMul, unidirectional);

    // -------- march --------
    // unidirectional marches a single +dir pass; bidirectional does ±dir.
    var occBits = 0u;
    var gi0 = vec3<f32>(0.0);
    var d = select(-1.0, 1.0, unidirectional);
    loop {
      let rayDir = dir * d;
      var t = pow(sStep, rndZ);
      rndZ = 1.0 - rndZ;

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

        let deltaPosFront = samplePosVS - positionVS;
        var deltaPosBack : vec3<f32>;
        if (thickNormalize) {
          deltaPosBack = deltaPosFront + normalize(samplePosVS) * params.thickness;
        } else {
          let zc = samplePosVS.z;
          deltaPosBack = samplePosVS * ((zc - params.thickness) / zc) - positionVS;
        }

        let horCos = vec2<f32>(dot(normalize(deltaPosFront), V),
                               dot(normalize(deltaPosBack), V));
        var hor01 : vec2<f32>;
        if (unidirectional) {
          let horAng = vec2<f32>(acosFast(horCos.x, useAcosApprox),
                                 acosFast(horCos.y, useAcosApprox));
          hor01 = clamp(horAng * RCP_PI + angOff, vec2<f32>(0.0), vec2<f32>(1.0));
          hor01.x = sliceRelCDF_Cos(hor01.x, angN, cosN, true);
          hor01.y = sliceRelCDF_Cos(hor01.y, angN, cosN, true);
          hor01 = hor01 * w0RemapMul + w0RemapAdd;
          hor01 = clamp(hor01 + rndW * (1.0 / 32.0), vec2<f32>(0.0), vec2<f32>(1.0));
        } else {
          let horAng = vec2<f32>(acosFast(horCos.x, useAcosApprox),
                                 acosFast(horCos.y, useAcosApprox)) * d;
          hor01 = clamp(horAng * RCP_PI + angOff, vec2<f32>(0.0), vec2<f32>(1.0));
          hor01 = select(hor01.yx, hor01.xy, d >= 0.0);
          if (uniformWeight) {
            hor01.x = sliceRelCDF_Uniform(hor01.x, angN, d > 0.0);
            hor01.y = sliceRelCDF_Uniform(hor01.y, angN, d > 0.0);
          } else {
            hor01.x = sliceRelCDF_Cos(hor01.x, angN, cosN, d > 0.0);
            hor01.y = sliceRelCDF_Cos(hor01.y, angN, cosN, d > 0.0);
          }
          hor01 = clamp(hor01 + rndW * (1.0 / 32.0), vec2<f32>(0.0), vec2<f32>(1.0));
        }

        let occBits0 = arcToBits(hor01);

        // --- GI gather: newly-visible bits weight the sample radiance ---
        let visBits0raw = occBits0 & (~occBits);
        if (visBits0raw != 0u) {
          var visBits0 = visBits0raw;
          if (backfaceReject) {
            var N0 = normalize(textureLoad(normalTex, sc, 0).xyz);
            let projN0 = N0 - sliceN * dot(N0, sliceN);
            let projN0SqrLen = dot(projN0, projN0);
            if (projN0SqrLen != 0.0) {
              let projN0RcpLen = inverseSqrt(projN0SqrLen);
              let flipT = dot(T, N0) < 0.0;
              var u = dot(projN, projN0) * projNRcpLen * projN0RcpLen;
              var bh = acosFast(u, useAcosApprox) * RCP_PI;
              if (flipT) { bh = 1.0 - bh; }
              if (uniformWeight) {
                bh = sliceRelCDF_Uniform(bh, angN, bh * PI - PI05 > angN);
              } else {
                bh = sliceRelCDF_Cos(bh, angN, cosN, bh * PI - PI05 > angN);
              }
              bh = bh * w0RemapMul + w0RemapAdd;
              bh = clamp(bh + rndW * (1.0 / 32.0), 0.0, 1.0);
              let hi = u32(floor(bh * 32.0));
              var visN = select(0u, 0xFFFFFFFFu << hi, hi < 32u);
              if (!flipT) { visN = ~visN; }
              visBits0 = visBits0 & visN;
            }
          }
          let vis0 = f32(countOneBits(visBits0)) * (1.0 / 32.0);
          var rad = textureLoad(beautyTex, sc, 0).rgb;
          let lum = dot(rad, vec3<f32>(0.2126, 0.7152, 0.0722));
          if (lum > params.fireflyClamp) { rad = rad * (params.fireflyClamp / lum); }
          gi0 = gi0 + rad * vis0;
        }

        occBits = occBits | occBits0;
      }

      if (unidirectional) { break; } // single march direction
      d = d + 2.0;
      if (d > 1.0) { break; }
    }

    let occ0 = f32(countOneBits(occBits)) * (1.0 / 32.0);
    var w = 1.0;
    if (unidirectional) { w = 2.0 - 2.0 * w0; }
    aoAcc = aoAcc + sliceWeight * (w - w * occ0);
    giAcc = giAcc + sliceWeight * (w * gi0);
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
    return vec4<f32>(0.0, 0.0, 0.0, 1.0); // background: open AO, no GI
  }
  let uv = in.pos.xy / params.resolution;
  let N = normalize(textureLoad(normalTex, coord, 0).xyz);
  let positionVS = viewPosFromDepth(uv, d);
  let r = gtVBGI(coord, positionVS, N);
  // rgb = GI radiance (unmodulated), a = AO. Additive accumulation; display /count.
  return vec4<f32>(r.gi, r.ao);
}
