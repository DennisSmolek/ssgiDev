// Demo 11 — sampling lab. GT-VBAO march with a PLUGGABLE per-pixel noise source.
//
// The march below is demo 04's GT-VBAO (XXGSDd, Buffer C) verbatim in structure
// — same slice construction, same 32-bit visibility bitmask, same handedness
// bridge (reference axis from=(0,0,+1), see demo 04 README). The ONLY thing this
// lab changes is where the three per-pixel uniform randoms come from:
//   rnd.x -> slice-direction angle
//   rnd.y -> march-start jitter (rndZ)
//   rnd.z -> horizon jitter (rndW, 1/32 sector)
// selected by params.noiseMode:
//   0 white (PCG hash, control)         3 blue-noise texture (tile 0, golden temporal)
//   1 IGN (Jimenez), temporal advance   4 STBN-approx (cycle 16 blue tiles / frame)
//   2 R1-Hilbert (Salm's shadertoy default)
//
// Noise character is what this lab studies; the AO math is held fixed so any
// visible difference is attributable to the noise source alone.

struct Params {
  proj : mat4x4<f32>,
  invProj : mat4x4<f32>,
  resolution : vec2<f32>,
  near : f32,
  far : f32,
  slicesPerFrame : u32,
  stepsPerSlice : u32,
  frameSeed : u32,          // temporal index (0 when temporal advance is off)
  flags : u32,              // bit0 acos approx, bit1 slice importance, bit2 thickness normalize
  thickness : f32,
  marchWidthPx : f32,
  bias : f32,
  falloff : f32,
  noiseMode : u32,          // 0 white 1 ign 2 hilbert 3 blue 4 stbn
  atlasSize : f32,          // 512
  tileSize : f32,           // 128
  numTiles : u32,           // 16
};

@group(0) @binding(0) var depthTex : texture_depth_2d;
@group(0) @binding(1) var normalTex : texture_2d<f32>;
@group(0) @binding(2) var noiseAtlas : texture_2d<f32>;  // RG blue-noise tiles
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
const RCP_PI : f32 = 0.31830988618;
const PI05 : f32 = 1.57079632679;
const RCP_PI05 : f32 = 0.63661977236;

// golden-ratio (R1/R2/R3) low-discrepancy additive constants (Roberts).
const RPHI1 : f32 = 0.6180340;
const RPHI3 : vec3<f32> = vec3<f32>(0.8191725, 0.6710436, 0.5497005);

// --- white noise: PCG hash -> uniform floats ----------------------------------
fn pcg(x : u32) -> u32 {
  let state = x * 747796405u + 2891336453u;
  let word = ((state >> ((state >> 28u) + 4u)) ^ state) * 277803737u;
  return (word >> 22u) ^ word;
}
fn nextRand(seed : ptr<function, u32>) -> f32 {
  *seed = pcg(*seed);
  return f32(*seed) * (1.0 / 4294967296.0);
}

// --- interleaved gradient noise (Jimenez) -------------------------------------
fn ign(p : vec2<f32>) -> f32 {
  return fract(52.9829189 * fract(dot(p, vec2<f32>(0.06711056, 0.00583715))));
}
fn ignTemporal(p : vec2<f32>, n : u32) -> f32 {
  // temporal advance per Salm/Jimenez: shift uv by 5.588238 * (frame % 64).
  let f = f32(n % 64u);
  return ign(p + 5.588238 * f);
}

// --- R1-Hilbert: Hilbert-linearise the pixel, then Roberts R3 sequence ---------
// port of EvalHilbertCurve (XXGSDd common.glsl), tile dim = 2^N.
fn hilbert(uv : vec2<u32>, N : u32) -> u32 {
  let C : u32 = 0xB4361E9Cu;
  let P : u32 = 0xEC7A9107u;
  var c : u32 = 0u;
  var p : u32 = 0u;
  var i : u32 = N;
  loop {
    if (i == 0u) { break; }
    i = i - 1u;
    let m = (uv >> vec2<u32>(i)) & vec2<u32>(1u);
    let n = m.x ^ (m.y << 1u);
    let o = (p << 3u) ^ (n << 1u);
    c = c + (((C >> o) & 3u) << (i << 1u));
    p = (P >> o) & 3u;
  }
  return c;
}

// --- blue-noise atlas fetch ---------------------------------------------------
// tile t in [0,numTiles); within-tile coord = pixel & (tileSize-1).
fn atlasFetchRG(coord : vec2<i32>, tile : u32) -> vec2<f32> {
  let ts = i32(params.tileSize);
  let grid = i32(params.atlasSize) / ts;
  let tcol = i32(tile) % grid;
  let trow = i32(tile) / grid;
  let lx = coord.x & (ts - 1);
  let ly = coord.y & (ts - 1);
  let ax = tcol * ts + lx;
  let ay = trow * ts + ly;
  return textureLoad(noiseAtlas, vec2<i32>(ax, ay), 0).rg;
}

// The pluggable noise source: returns three uniform [0,1) randoms for a pixel,
// temporal index n (frame*slices+slice).
fn getNoise(coord : vec2<i32>, n : u32) -> vec3<f32> {
  let mode = params.noiseMode;
  if (mode == 0u) {
    // white: PCG hash of pixel XOR temporal index
    var seed = pcg(
      (u32(coord.x) * 3266489917u) ^
      (u32(coord.y) * 668265263u) ^
      (n * 374761393u) ^ 0x9CF617FAu,
    );
    let a = nextRand(&seed);
    let b = nextRand(&seed);
    let c = nextRand(&seed);
    return vec3<f32>(a, b, c);
  }
  if (mode == 1u) {
    // IGN: one scalar per channel, decorrelated via coordinate offsets.
    let p = vec2<f32>(coord);
    let a = ignTemporal(p, n);
    let b = ignTemporal(p + vec2<f32>(59.0, 17.0), n);
    let c = ignTemporal(p + vec2<f32>(11.0, 91.0), n);
    return vec3<f32>(a, b, c);
  }
  if (mode == 2u) {
    // R1-Hilbert: locality-preserving pixel index -> Roberts R3 additive seq,
    // temporally advanced by the frame index (Salm's shadertoy default noise).
    let h = hilbert(vec2<u32>(coord) & vec2<u32>(127u), 7u);
    return fract(vec3<f32>(0.5) + f32(h + n) * RPHI3);
  }
  if (mode == 3u) {
    // blue-noise texture, tile 0, temporally advanced by golden-ratio value
    // jitter (stratifies each pixel's values along the time axis).
    let rg = atlasFetchRG(coord, 0u);
    let w = fract(rg.x + rg.y);
    return fract(vec3<f32>(rg.x, rg.y, w) + RPHI3 * f32(n));
  }
  // mode 4: STBN-approx — cycle the 16 decorrelated blue tiles, one per frame.
  let tile = n % params.numTiles;
  let rg = atlasFetchRG(coord, tile);
  let w = fract(rg.x + rg.y);
  return vec3<f32>(rg.x, rg.y, w);
}

// --- acos approximation (Salm's improved GTAOFastAcos) ------------------------
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

// --- screen <-> view (three's real projection) --------------------------------
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

// --- quaternion utils (reference axis from = (0,0,+1) for three handedness) ----
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

fn arcToBits(hor01 : vec2<f32>) -> u32 {
  let horInt = vec2<u32>(vec2<i32>(floor(hor01 * 32.0)));
  let full = 0xFFFFFFFFu;
  let mX = select(0u, full << horInt.x, horInt.x < 32u);
  let mY = select(0u, full >> (32u - horInt.y), horInt.y != 0u);
  return mX & mY;
}

fn gtVBAO(coord : vec2<i32>, positionVS0 : vec3<f32>, normalVS : vec3<f32>) -> f32 {
  let useAcosApprox = (params.flags & 1u) != 0u;
  let useImportance = (params.flags & 2u) != 0u;
  let thickNormalize = (params.flags & 4u) != 0u;

  let positionVS = positionVS0 + normalVS * params.bias;
  let V = -normalize(positionVS);
  let rayStart = projectToPixel(positionVS);

  let Q_toV = getQuatToV(V);
  let Q_fromV = Q_toV * vec4<f32>(-1.0, -1.0, -1.0, 1.0);

  let count = f32(params.stepsPerSlice);
  let width = params.marchWidthPx;
  let sStep = pow(width, 1.0 / count);

  var ao = 0.0;
  let dirCount = max(1u, params.slicesPerFrame);

  for (var i = 0u; i < dirCount; i = i + 1u) {
    let n = params.frameSeed * dirCount + i;
    let rnd = getNoise(coord, n);
    let rndSlice = rnd.x;
    var rndZ = rnd.y;
    let rndW = rnd.z;

    var smplDirVS : vec3<f32>;
    var dir : vec2<f32>;
    var sliceWeight = 1.0;
    if (useImportance) {
      let normalVVS = transformQz0(normalVS, Q_fromV);
      let d2 = sampleSliceDir(normalVVS, rndSlice);
      smplDirVS = transformVz0Qz0(d2, Q_toV);
    } else {
      let d2 = vec2<f32>(cos(rndSlice * PI), sin(rndSlice * PI));
      smplDirVS = transformVz0Qz0(d2, Q_toV);
    }
    {
      let eps = 0.5 * params.near;
      let pe = projectToPixel(positionVS + smplDirVS * eps);
      var rd = pe - rayStart;
      let rl = length(rd);
      if (rl < 1e-6) { continue; }
      dir = rd / rl;
    }

    let sliceN = cross(V, smplDirVS);
    let projN = normalVS - sliceN * dot(normalVS, sliceN);
    let projNSqrLen = dot(projN, projN);
    if (projNSqrLen == 0.0) { ao = ao + sliceWeight; continue; }
    let projNRcpLen = inverseSqrt(projNSqrLen);
    let cosN = dot(projN, V) * projNRcpLen;
    let T = cross(sliceN, projN);
    let sgn = select(1.0, -1.0, dot(V, T) < 0.0);
    let angN = sgn * acosFast(cosN, useAcosApprox);
    let angOff = angN * RCP_PI + 0.5;

    if (!useImportance) {
      sliceWeight = max(0.0, (1.0 / projNRcpLen) * (cosN + angN * sin(angN)));
    }

    var occBits = 0u;
    var d = -1.0;
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
          let scale = (zc - params.thickness) / zc;
          deltaPosBack = samplePosVS * scale - positionVS;
        }

        let horCos = vec2<f32>(dot(normalize(deltaPosFront), V),
                               dot(normalize(deltaPosBack), V));
        let horAng = vec2<f32>(acosFast(horCos.x, useAcosApprox),
                               acosFast(horCos.y, useAcosApprox)) * d;
        var hor01 = clamp(horAng * RCP_PI + angOff, vec2<f32>(0.0), vec2<f32>(1.0));
        hor01 = select(hor01.yx, hor01.xy, d >= 0.0);

        hor01.x = sliceRelCDF_Cos(hor01.x, angN, cosN, d > 0.0);
        hor01.y = sliceRelCDF_Cos(hor01.y, angN, cosN, d > 0.0);
        hor01 = clamp(hor01 + rndW * (1.0 / 32.0), vec2<f32>(0.0), vec2<f32>(1.0));

        var occBits0 = arcToBits(hor01);

        if (params.falloff > 0.0) {
          let dist = length(deltaPosFront);
          let fo = clamp(1.0 - (dist / (params.thickness + params.marchWidthPx))
                         * params.falloff, 0.0, 1.0);
          if (fo <= 0.0) { occBits0 = 0u; }
        }

        occBits = occBits | occBits0;
      }

      d = d + 2.0;
      if (d > 1.0) { break; }
    }

    let occ0 = f32(countOneBits(occBits)) * (1.0 / 32.0);
    ao = ao + sliceWeight - sliceWeight * occ0;
  }

  return ao / f32(dirCount);
}

@fragment
fn fs(in : VOut) -> @location(0) vec4<f32> {
  let coord = vec2<i32>(floor(in.pos.xy));
  let d = textureLoad(depthTex, coord, 0);
  if (d >= 0.99999) {
    return vec4<f32>(0.0, 0.0, 0.0, 1.0);
  }
  let uv = in.pos.xy / params.resolution;
  let N = normalize(textureLoad(normalTex, coord, 0).xyz);
  let positionVS = viewPosFromDepth(uv, d);
  let ao = gtVBAO(coord, positionVS, N);
  return vec4<f32>(0.0, 0.0, 0.0, ao);
}
