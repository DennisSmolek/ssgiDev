// Demo 14 — the à-trous body. SVGF-SPEC §2 pass chain, step 6. The ONE
// genuinely new pass in this demo (thesis, spec §1): everything upstream is
// wiring existing passes (TemporalGuidesPass, MomentsPass); this is the
// multi-pass increasing-stride edge-aware filter with the luminance/variance
// term that makes it SVGF instead of a plain bilateral.
//
// One dispatch = one iteration. The host calls this K times (svgf arm) or
// once (svgf-lite, SVGF-SPEC §3 fallback: "single-pass bilateral + √Var term
// only"), doubling `stride` each call (1, 2, 4, 8, ...) and ping-ponging
// colour+variance between two buffer pairs — atrousIterations K, sigmaLum,
// sigmaDepth, sigmaNormal config knobs.
//
// Weight: w = w_depth * w_normal * w_lum (spec formula), each multiplied by a
// fixed 5x5 binomial spatial kernel (the paper's à-trous "hole-punched"
// B3-spline weights [1,4,6,4,1]/16, separable, scaled by `stride`).
//   w_lum = exp(-|l_p - l_q| / (sigmaLum * sqrt(g * Var) + eps))
// `g * Var` is a 3x3-box-prefiltered local variance (SVGF paper §4.2): using
// the RAW per-pixel variance directly inside sqrt() is itself noisy at low
// sample counts, which destabilizes the very weight meant to reduce noise.
//
// Variance is filtered ALONGSIDE colour with the SAME weights, using the
// closed-form "variance of a weighted mean of independent samples":
//   newVar = sum(w^2 * varTap) / sum(w)^2
// (a plain re-average, sum(w*varTap)/sum(w), would NOT shrink — it treats
// variance as if it were the signal itself instead of a spread estimate).

struct AParams {
  resolution : vec2<f32>,
  near : f32,
  far : f32,
  stride : f32,
  sigmaLum : f32,
  sigmaDepth : f32,   // relative depth-discontinuity threshold (fraction of centerDepth)
  sigmaNormal : f32,  // normal-cosine exponent
};

@group(0) @binding(0) var colorIn : texture_2d<f32>;    // (irr.rgb, ao)
@group(0) @binding(1) var varianceIn : texture_2d<f32>; // r
@group(0) @binding(2) var depthTex : texture_depth_2d;
@group(0) @binding(3) var normalTex : texture_2d<f32>;  // view-space normal
@group(0) @binding(4) var outColor : texture_storage_2d<rgba16float, write>;
@group(0) @binding(5) var outVariance : texture_storage_2d<r16float, write>;
@group(0) @binding(6) var<uniform> p : AParams;

const KERNEL : array<f32, 5> = array<f32, 5>(1.0 / 16.0, 4.0 / 16.0, 6.0 / 16.0, 4.0 / 16.0, 1.0 / 16.0);

fn linearDepth(coord : vec2<i32>) -> f32 {
  let dv = textureLoad(depthTex, coord, 0);
  return (p.near * p.far) / (p.far - dv * (p.far - p.near));
}

fn luma(c : vec3<f32>) -> f32 {
  return dot(c, vec3<f32>(0.2126, 0.7152, 0.0722));
}

fn clampCoord(c : vec2<i32>, dim : vec2<i32>) -> vec2<i32> {
  return clamp(c, vec2<i32>(0), dim - vec2<i32>(1));
}

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) gid : vec3<u32>) {
  let dim = vec2<u32>(u32(p.resolution.x), u32(p.resolution.y));
  if (gid.x >= dim.x || gid.y >= dim.y) { return; }
  let coord = vec2<i32>(gid.xy);
  let dimI = vec2<i32>(dim);

  let centerColor = textureLoad(colorIn, coord, 0);
  let centerVar = textureLoad(varianceIn, coord, 0).r;
  let centerDepth = linearDepth(coord);

  // Background: passthrough (same convention as ssrt-denoise.wgsl).
  if (centerDepth >= p.far * 0.999) {
    textureStore(outColor, coord, centerColor);
    textureStore(outVariance, coord, vec4<f32>(centerVar, 0.0, 0.0, 0.0));
    return;
  }

  let centerNormal = normalize(textureLoad(normalTex, coord, 0).xyz);
  let centerLum = luma(centerColor.rgb);

  // 3x3 box prefilter of variance ("g" in the weight formula) — stabilizes
  // sqrt(Var) before it divides the luminance weight.
  var gVar = 0.0;
  var gCount = 0.0;
  for (var dy = -1; dy <= 1; dy = dy + 1) {
    for (var dx = -1; dx <= 1; dx = dx + 1) {
      let sc = clampCoord(coord + vec2<i32>(dx, dy), dimI);
      gVar = gVar + textureLoad(varianceIn, sc, 0).r;
      gCount = gCount + 1.0;
    }
  }
  gVar = gVar / max(1.0, gCount);
  let lumDenom = p.sigmaLum * sqrt(max(0.0, gVar)) + 1e-4;

  var sumColor = vec4<f32>(0.0);
  var sumVarNumerator = 0.0;
  var sumW = 0.0;
  let strideI = max(1, i32(p.stride));

  for (var dy = -2; dy <= 2; dy = dy + 1) {
    for (var dx = -2; dx <= 2; dx = dx + 1) {
      let sc = coord + vec2<i32>(dx, dy) * strideI;
      if (sc.x < 0 || sc.y < 0 || sc.x >= dimI.x || sc.y >= dimI.y) { continue; }

      let kw = KERNEL[dx + 2] * KERNEL[dy + 2];
      let sColor = textureLoad(colorIn, sc, 0);
      let sVar = textureLoad(varianceIn, sc, 0).r;
      let sDepth = linearDepth(sc);
      if (sDepth >= p.far * 0.999) { continue; }
      let sNormal = normalize(textureLoad(normalTex, sc, 0).xyz);
      let sLum = luma(sColor.rgb);

      let wDepth = exp(-abs(sDepth - centerDepth) / max(1e-4, centerDepth * p.sigmaDepth));
      let wNormal = pow(max(0.0, dot(sNormal, centerNormal)), p.sigmaNormal);
      let wLum = exp(-abs(sLum - centerLum) / lumDenom);
      let w = kw * wDepth * wNormal * wLum;

      sumColor = sumColor + sColor * w;
      sumVarNumerator = sumVarNumerator + w * w * sVar;
      sumW = sumW + w;
    }
  }

  let outC = select(centerColor, sumColor / sumW, sumW > 1e-6);
  let outV = select(centerVar, sumVarNumerator / (sumW * sumW), sumW > 1e-6);
  textureStore(outColor, coord, outC);
  textureStore(outVariance, coord, vec4<f32>(outV, 0.0, 0.0, 0.0));
}
