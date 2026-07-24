// Demo 18 (temporal lab) — FORK of demo 12 (ssrt12-upsample), copied verbatim.
// NOT ?raw-imported (frozen-fork lesson, WORKLOG 2026-07-21). See README provenance.
// Demo 09 — bandwidth lab. Joint bilateral upsample (Kopf et al. 2007 style):
// take the low-res GI/AO marched result up to full resolution, GUIDED by the
// full-res depth + normal G-buffer. This is the "half-res + bilateral upsample"
// step the SSILVB paper (Table 2, config f) recommends but that no engine ships
// as a node (research/sources/denoising/threejs-nodes.md: three has depthAwareBlur
// and BilateralBlurNode, but NO joint-bilateral-upsample node — we build one).
//
// For each full-res pixel we gather the 2x2 low-res texels around its projected
// low-res position; each low-res tap is weighted by
//   bilinear(spatial) * depthSimilarity(fullDepth, tapDepth) * normalSimilarity.
// Depth similarity uses linear (view) depth normalized by the center depth, so it
// is scale-invariant. If every weight collapses (a disocclusion / thin silhouette
// where no low-res tap agrees with the full-res guide) we fall back to the
// nearest low-res tap — the classic joint-bilateral edge case.

struct UParams {
  fullRes : vec2<f32>,
  lowRes : vec2<f32>,
  near : f32,
  far : f32,
  normalPhi : f32,  // exponent on normal dot (higher = stricter)
  depthPhi : f32,   // relative depth tolerance (lower = tighter)
  pad0 : f32,
  pad1 : f32,
};

@group(0) @binding(0) var giaoLow : texture_2d<f32>;
@group(0) @binding(1) var lowDepth : texture_2d<f32>;   // r32float raw depth (march res)
@group(0) @binding(2) var lowNormal : texture_2d<f32>;  // view normal (march res)
@group(0) @binding(3) var fullDepth : texture_depth_2d; // full-res raw depth guide
@group(0) @binding(4) var fullNormal : texture_2d<f32>; // full-res view normal guide
@group(0) @binding(5) var outFull : texture_storage_2d<rgba16float, write>;
@group(0) @binding(6) var<uniform> p : UParams;

fn linearize(d : f32) -> f32 {
  return (p.near * p.far) / (p.far - d * (p.far - p.near));
}
fn clampLow(c : vec2<i32>) -> vec2<i32> {
  return clamp(c, vec2<i32>(0), vec2<i32>(p.lowRes) - vec2<i32>(1));
}

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) gid : vec3<u32>) {
  let dim = vec2<u32>(u32(p.fullRes.x), u32(p.fullRes.y));
  if (gid.x >= dim.x || gid.y >= dim.y) { return; }
  let coord = vec2<i32>(gid.xy);
  let uv = (vec2<f32>(gid.xy) + 0.5) / p.fullRes;

  let cD = textureLoad(fullDepth, coord, 0);
  if (cD >= 0.99999) {
    textureStore(outFull, coord, vec4<f32>(0.0, 0.0, 0.0, 1.0));
    return;
  }
  let cLin = linearize(cD);
  let cN = normalize(textureLoad(fullNormal, coord, 0).xyz);

  // Continuous low-res texel coordinate of this full-res pixel.
  let lp = uv * p.lowRes - vec2<f32>(0.5);
  let base = floor(lp);
  let f = lp - base;

  var sum = vec4<f32>(0.0);
  var wsum = 0.0;
  var bestW = -1.0;
  var nearest = vec4<f32>(0.0, 0.0, 0.0, 1.0);
  for (var j = 0; j < 2; j = j + 1) {
    for (var i = 0; i < 2; i = i + 1) {
      let lc = clampLow(vec2<i32>(base) + vec2<i32>(i, j));
      let wx = select(1.0 - f.x, f.x, i == 1);
      let wy = select(1.0 - f.y, f.y, j == 1);
      let wBilin = wx * wy;

      let lLin = linearize(textureLoad(lowDepth, lc, 0).r);
      let lN = normalize(textureLoad(lowNormal, lc, 0).xyz);
      let wDepth = exp(-abs(cLin - lLin) / max(1e-3, cLin * p.depthPhi));
      let wNormal = pow(max(0.0, dot(cN, lN)), p.normalPhi);

      let giao = textureLoad(giaoLow, lc, 0);
      let w = wBilin * wDepth * wNormal;
      sum = sum + giao * w;
      wsum = wsum + w;
      // Track the best edge-aware tap (ignoring bilinear weight) for fallback.
      let edgeW = wDepth * wNormal;
      if (edgeW > bestW) { bestW = edgeW; nearest = giao; }
    }
  }

  let result = select(nearest, sum / wsum, wsum > 1e-4);
  textureStore(outFull, coord, result);
}
