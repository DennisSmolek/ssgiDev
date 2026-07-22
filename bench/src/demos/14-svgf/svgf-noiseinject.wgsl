// Demo 14 — noiseinject mode. SVGF-SPEC §5 "cheaper pre-validator": take the
// CONVERGED reference (accumulate.wgsl running mean of the live producer,
// same oracle every arm scores against) and synthesize a controllable-noise
// input with EXACT ground truth (the reference itself, before noise). This is
// the "svgf-noiseinject" sequence step 1 — validates the implementation and
// the sqrt(Var) math on a known signal, cheaply, before any real path-tracer
// noise-stress harness (deferred demo 15).
//
// Noise model: variance-scaled per-channel Gaussian (Poisson-like: stddev
// grows with sqrt(signal), the shape Monte-Carlo estimator noise actually
// has) via Box-Muller from a per-pixel-per-frame PCG hash — a NEW random draw
// every frame (not a spatially-fixed dither), so temporal accumulation sees
// genuinely uncorrelated noise, the thing that lets EMA/à-trous converge.
// Optional firefly spikes (fireflyRate probability per pixel per frame) add
// occasional large positive outliers — still idealized/uncorrelated noise,
// NOT the correlated Monte-Carlo firefly distribution a real path tracer
// produces (spec §5's explicit caveat on this pre-validator's limits).
//
// AO (alpha) is left un-noised: the SVGF chain under test targets GI
// luminance/variance, not AO, and noising both would conflate two signals in
// one validation pass.

struct Params {
  resolution : vec2<f32>,
  sigma : f32,
  fireflyRate : f32,
  frameSeed : u32,
  flags : u32, // bit0 enabled
  pad0 : f32,
  pad1 : f32,
};

@group(0) @binding(0) var refTex : texture_2d<f32>;
@group(0) @binding(1) var outTex : texture_storage_2d<rgba16float, write>;
@group(0) @binding(2) var<uniform> p : Params;

fn hashU32(x : u32) -> u32 {
  var v = x;
  v = v ^ (v >> 16u); v = v * 0x7feb352du;
  v = v ^ (v >> 15u); v = v * 0x846ca68bu;
  v = v ^ (v >> 16u);
  return v;
}

fn rand01(seed : u32) -> f32 {
  return f32(hashU32(seed)) / 4294967295.0;
}

fn seedFor(coord : vec2<i32>, salt : u32) -> u32 {
  return hashU32(u32(coord.x) * 1973u + u32(coord.y) * 9277u + p.frameSeed * 26699u + salt * 101u + 1u);
}

// Box-Muller: two independent uniforms -> two independent standard normals.
fn gaussianPair(seedA : u32, seedB : u32) -> vec2<f32> {
  let u1 = max(rand01(seedA), 1e-6);
  let u2 = rand01(seedB);
  let r = sqrt(-2.0 * log(u1));
  let theta = 6.28318530718 * u2;
  return vec2<f32>(r * cos(theta), r * sin(theta));
}

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) gid : vec3<u32>) {
  let dim = vec2<u32>(u32(p.resolution.x), u32(p.resolution.y));
  if (gid.x >= dim.x || gid.y >= dim.y) { return; }
  let coord = vec2<i32>(gid.xy);

  let refColor = textureLoad(refTex, coord, 0);
  let enabled = (p.flags & 1u) != 0u;
  if (!enabled) {
    textureStore(outTex, coord, refColor);
    return;
  }

  let lum = dot(refColor.rgb, vec3<f32>(0.2126, 0.7152, 0.0722));
  let noiseStd = p.sigma * sqrt(max(lum, 1e-4));

  let g01 = gaussianPair(seedFor(coord, 0u), seedFor(coord, 1u));
  let g23 = gaussianPair(seedFor(coord, 2u), seedFor(coord, 3u));
  var noisy = refColor.rgb + vec3<f32>(g01.x, g01.y, g23.x) * noiseStd;

  let fireflyRoll = rand01(seedFor(coord, 4u));
  if (fireflyRoll < p.fireflyRate) {
    noisy = noisy + vec3<f32>(lum + 0.1) * 8.0;
  }

  textureStore(outTex, coord, vec4<f32>(max(noisy, vec3<f32>(0.0)), refColor.a));
}
