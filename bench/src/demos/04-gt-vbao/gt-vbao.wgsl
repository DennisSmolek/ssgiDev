// Demo 04 — GT-VBAO (cosine-weighted, visibility-bitmask AO).
//
// Lineage: Mirko Salm / TinyTexel "GT-VBAO" (Shadertoy XXGSDd), Buffer C
// `GTVBAO()`. Ported from GLSL to raw WGSL against our real perspective
// G-buffer (three MRT: nonlinear depth + view-space normal). The Shadertoy
// renders a toy analytic g-buffer with a hand-rolled projection; the port
// swaps in three's real projectionMatrix / inverse and reconstructs view
// positions from the depth buffer (same machinery demo 02 validated).
//
// == Coordinate conventions (the trap) =====================================
// Salm's view space: right-handed, +z INTO the scene (camera looks down +z),
// so a visible surface has positionVS.z > 0 and V = -normalize(pos) has V.z<0.
// His LIVE GetQuaternion fix (live-refresh-2026-07-17.md) sets the reference
// direction from = (0,0,-1) precisely BECAUSE his V points toward -z — that
// keeps the from->V quaternion well-conditioned (s = dot(from,V) ~ +1 for a
// central pixel instead of the singular ~ -1).
//
// THREE's view space: right-handed, +z toward the viewer (camera looks down
// -z), so a visible surface has viewPos.z < 0 and V = -normalize(viewPos) has
// V.z > 0 (V ~ (0,0,+1) for a central pixel). To port the LIVE fix faithfully
// under three's handedness the reference direction must be its mirror,
// from = (0,0,+1): the SAME fix (reference axis aligned with V), reflected for
// the opposite z convention. Everything else (slice construction, cross/dot
// products, screen-space marching) is kept in three view space and stays
// internally consistent because the screen-space slice direction is derived by
// projecting smplDirVS through three's real projection matrix — so the
// screen<->view orientation is pinned by the projection, not by hand.
//
// WebGPU conventions inherited from demo 02: framebuffer/UV origin top-left
// (ndc.y = 1 - 2*uv.y); clip z in [0,1]; depth reconstructed via inverse proj.

struct Params {
  proj : mat4x4<f32>,       // camera.projectionMatrix
  invProj : mat4x4<f32>,    // camera.projectionMatrixInverse
  resolution : vec2<f32>,
  near : f32,
  far : f32,
  slicesPerFrame : u32,     // slice directions marched this frame (accumulated)
  stepsPerSlice : u32,      // depth samples per march direction
  frameSeed : u32,          // accumulation frame index (noise decorrelation)
  flags : u32,              // bit0: acos approx, bit1: slice importance sampling,
                            // bit2: thickness = normalize variant
  thickness : f32,          // world/view-space slab depth (scene-scale dependent)
  marchWidthPx : f32,       // screen-space geometric march extent (Salm: 512 px)
  bias : f32,               // normal-offset on ray origin (world/view units)
  falloff : f32,            // distance falloff strength (0 = off, Salm has none)
  pad0 : f32,
  pad1 : f32,
  pad2 : f32,
};

@group(0) @binding(0) var depthTex : texture_depth_2d;
@group(0) @binding(1) var normalTex : texture_2d<f32>;  // view-space normal, [-1,1]
@group(0) @binding(2) var<uniform> params : Params;

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

// --- RNG: PCG hash -> uniform floats (white noise; converges under accum) ------
fn pcg(x : u32) -> u32 {
  let state = x * 747796405u + 2891336453u;
  let word = ((state >> ((state >> 28u) + 4u)) ^ state) * 277803737u;
  return (word >> 22u) ^ word;
}
fn nextRand(seed : ptr<function, u32>) -> f32 {
  *seed = pcg(*seed);
  return f32(*seed) * (1.0 / 4294967296.0);
}

// --- acos approximation (Salm's improved GTAOFastAcos) -------------------------
fn acosPoly(x : f32) -> f32 {
  // higher-quality GTAOFastAcos: minimizes max abs(ACos_Approx(cos(x)) - x)
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

// --- Screen <-> view (three's real projection) ---------------------------------
fn linearDist(d : f32) -> f32 {
  return (params.near * params.far) / (params.far - d * (params.far - params.near));
}
fn viewPosFromDepth(uv : vec2<f32>, d : f32) -> vec3<f32> {
  let ndc = vec2<f32>(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0);
  let vp = params.invProj * vec4<f32>(ndc, d, 1.0);
  return vp.xyz / vp.w;
}
// view-space point -> pixel coords (top-left origin).
fn projectToPixel(vp : vec3<f32>) -> vec2<f32> {
  let clip = params.proj * vec4<f32>(vp, 1.0);
  let ndc = clip.xyz / clip.w;
  return vec2<f32>(ndc.x * 0.5 + 0.5, 0.5 - ndc.y * 0.5) * params.resolution;
}

// --- quaternion utils (reference axis from = (0,0,+1) for three handedness) -----
fn getQuatToV(V : vec3<f32>) -> vec4<f32> {
  // xyz = cross((0,0,1), V); s = dot((0,0,1), V)
  var xyz = vec3<f32>(-V.y, V.x, 0.0);
  var s = V.z;
  let u = inverseSqrt(max(0.0, s * 0.5 + 0.5));
  s = 1.0 / u;
  xyz = xyz * (u * 0.5);
  return vec4<f32>(xyz, s);
}
// transform v by unit quaternion q with q.z == 0
fn transformQz0(v : vec3<f32>, q : vec4<f32>) -> vec3<f32> {
  let k = v.y * q.x - v.x * q.y;
  let g = 2.0 * (v.z * q.w + k);
  var r : vec3<f32>;
  r.x = v.x + q.y * g;
  r.y = v.y - q.x * g;
  r.z = v.z + 2.0 * (q.w * k - v.z * dot(q.xy, q.xy));
  return r;
}
// transform (v.x, v.y, 0) by unit quaternion q with q.z == 0
fn transformVz0Qz0(v : vec2<f32>, q : vec4<f32>) -> vec3<f32> {
  let o = q.x * v.y;
  let c = q.y * v.x;
  let b = vec3<f32>(o - c, -o + c, o - c);
  return vec3<f32>(v, 0.0) + 2.0 * (b * vec3<f32>(q.y, q.x, q.w));
}

// --- slice-direction importance sampling (mode 3, HQ approx acos variant) -------
fn sampleSliceDir(vvsN : vec3<f32>, rnd01 : f32) -> vec2<f32> {
  let ang0 = rnd01 * PI;
  var dir0 = vec2<f32>(cos(ang0), sin(ang0));
  let l = length(vvsN.xy);
  if (l == 0.0) { return dir0; }
  if (dot(dir0, vvsN.xy) < 0.0) { dir0 = -dir0; }
  let n = vvsN.xy / l;
  let x0 = dir0.x * n.y - dir0.y * n.x; // dir0 x n
  var s = l;
  s = s + (s - s * s) * 0.15; // quadratic bias
  let y = acos(clamp(x0 * sin(s * PI05), -1.0, 1.0)) * RCP_PI05; // stretched acos
  let ys = 1.0 / s;
  let dy = ys - ys * y;
  let dx = sqrt(clamp(1.0 - dy * dy, 0.0, 1.0));
  return vec2<f32>(dx * n.x - dy * n.y, dy * n.x + dx * n.y);
}

// --- slice-relative CDF remaps (cosine / uniform hemisphere weighting) ----------
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

fn countBits32(x : u32) -> u32 { return countOneBits(x); }

// Occlusion arc [hor01.x, hor01.y] rasterized into a 32-bit sector mask.
fn arcToBits(hor01 : vec2<f32>) -> u32 {
  let horInt = vec2<u32>(vec2<i32>(floor(hor01 * 32.0)));
  let full = 0xFFFFFFFFu;
  let mX = select(0u, full << horInt.x, horInt.x < 32u);
  let mY = select(0u, full >> (32u - horInt.y), horInt.y != 0u);
  return mX & mY;
}

struct VBResult { ao : f32 };

// Core GT-VBAO for one pixel. Returns AO in [0,1] (1 = fully open).
fn gtVBAO(coord : vec2<i32>, positionVS0 : vec3<f32>, normalVS : vec3<f32>) -> f32 {
  let useAcosApprox = (params.flags & 1u) != 0u;
  let useImportance = (params.flags & 2u) != 0u;
  let thickNormalize = (params.flags & 4u) != 0u;

  // ray origin lifted off the surface to reduce self-occlusion
  let positionVS = positionVS0 + normalVS * params.bias;
  let V = -normalize(positionVS); // toward camera; three: V.z > 0
  let rayStart = projectToPixel(positionVS);

  let Q_toV = getQuatToV(V);
  // conjugate: maps V -> reference axis
  let Q_fromV = Q_toV * vec4<f32>(-1.0, -1.0, -1.0, 1.0);

  let count = f32(params.stepsPerSlice);
  let width = params.marchWidthPx;
  let sStep = pow(width, 1.0 / count);

  var ao = 0.0;
  let dirCount = max(1u, params.slicesPerFrame);

  for (var i = 0u; i < dirCount; i = i + 1u) {
    let n = params.frameSeed * dirCount + i;
    var seed = pcg(
      (u32(coord.x) * 3266489917u) ^
      (u32(coord.y) * 668265263u) ^
      (n * 374761393u) ^ 0x9CF617FAu,
    );
    let rndSlice = nextRand(&seed); // slice direction
    var rndZ = nextRand(&seed);     // march start jitter
    let rndW = nextRand(&seed);     // horizon jitter

    // -------- slice-direction sampling --------
    var smplDirVS : vec3<f32>;
    var dir : vec2<f32>;
    var sliceWeight = 1.0;
    if (useImportance) {
      // mode 3: approximate importance sampling via 1 rnd number
      let normalVVS = transformQz0(normalVS, Q_fromV);
      let d2 = sampleSliceDir(normalVVS, rndSlice);
      smplDirVS = transformVz0Qz0(d2, Q_toV);
    } else {
      // mode 1: uniform slice dir, analytic slice weight applied later
      let d2 = vec2<f32>(cos(rndSlice * PI), sin(rndSlice * PI));
      smplDirVS = transformVz0Qz0(d2, Q_toV);
    }
    // screen-space slice direction = projection of smplDirVS (1 px step)
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
    if (projNSqrLen == 0.0) { ao = ao + sliceWeight; continue; }
    let projNRcpLen = inverseSqrt(projNSqrLen);
    let cosN = dot(projN, V) * projNRcpLen;
    let T = cross(sliceN, projN);
    let sgn = select(1.0, -1.0, dot(V, T) < 0.0);
    let angN = sgn * acosFast(cosN, useAcosApprox);
    let angOff = angN * RCP_PI + 0.5;

    if (!useImportance) {
      // mode 1 uniform-slice weight (cosine hemisphere normalisation)
      sliceWeight = max(0.0, (1.0 / projNRcpLen) * (cosN + angN * sin(angN)));
    }

    // -------- find horizons (bidirectional) --------
    var occBits = 0u;
    var d = -1.0;
    loop {
      let rayDir = dir * d;
      var t = pow(sStep, rndZ); // init t in [1, s]
      rndZ = 1.0 - rndZ;

      for (var st = 0u; st < params.stepsPerSlice; st = st + 1u) {
        let samplePos = rayStart + rayDir * t;
        t = t * sStep;
        if (samplePos.x < 0.0 || samplePos.x >= params.resolution.x ||
            samplePos.y < 0.0 || samplePos.y >= params.resolution.y) { break; }

        let sc = vec2<i32>(floor(samplePos));
        let sd = textureLoad(depthTex, sc, 0);
        if (sd >= 0.99999) { continue; } // sky: never an occluder
        let suv = samplePos / params.resolution;
        let samplePosVS = viewPosFromDepth(suv, sd);

        let deltaPosFront = samplePosVS - positionVS;
        var deltaPosBack : vec3<f32>;
        if (thickNormalize) {
          // 'normalize' variant (Salm's faster alternative)
          deltaPosBack = deltaPosFront + normalize(samplePosVS) * params.thickness;
        } else {
          // 'VPos_from_SPos' default: same screen pos, view-z pushed back by
          // Thickness. Under perspective the view pos scales with view-z; three
          // camera looks down -z so "further" = more negative z.
          let zc = samplePosVS.z;
          let scale = (zc - params.thickness) / zc;
          deltaPosBack = samplePosVS * scale - positionVS;
        }

        let horCos = vec2<f32>(dot(normalize(deltaPosFront), V),
                               dot(normalize(deltaPosBack), V));
        let horAng = vec2<f32>(acosFast(horCos.x, useAcosApprox),
                               acosFast(horCos.y, useAcosApprox)) * d;
        var hor01 = clamp(horAng * RCP_PI + angOff, vec2<f32>(0.0), vec2<f32>(1.0));
        // sampling direction flips min/max angles
        hor01 = select(hor01.yx, hor01.xy, d >= 0.0);

        // map to slice-relative (cosine-weighted) distribution + jitter
        hor01.x = sliceRelCDF_Cos(hor01.x, angN, cosN, d > 0.0);
        hor01.y = sliceRelCDF_Cos(hor01.y, angN, cosN, d > 0.0);
        hor01 = clamp(hor01 + rndW * (1.0 / 32.0), vec2<f32>(0.0), vec2<f32>(1.0));

        var occBits0 = arcToBits(hor01);

        // optional smooth distance falloff on far occluders
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

    let occ0 = f32(countBits32(occBits)) * (1.0 / 32.0);
    ao = ao + sliceWeight - sliceWeight * occ0;
  }

  return ao / f32(dirCount);
}

@fragment
fn fs(in : VOut) -> @location(0) vec4<f32> {
  let coord = vec2<i32>(floor(in.pos.xy));
  let d = textureLoad(depthTex, coord, 0);
  if (d >= 0.99999) {
    // background: fully open (matches reference sky skip -> AO = 1)
    return vec4<f32>(0.0, 0.0, 0.0, 1.0);
  }
  let uv = in.pos.xy / params.resolution;
  let N = normalize(textureLoad(normalTex, coord, 0).xyz);
  let positionVS = viewPosFromDepth(uv, d);
  let ao = gtVBAO(coord, positionVS, N);
  // rgb reserved for GI (demo 05); a = AO. Additive accumulation; display /count.
  return vec4<f32>(0.0, 0.0, 0.0, ao);
}
