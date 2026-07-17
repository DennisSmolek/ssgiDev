// Demo 03 stage (d) — bilateral denoise.
// Distilled from SSRT3 DiffuseDenoiser.compute (HDRP diffuse denoiser): an
// edge-aware bilateral filter over a disk of taps, weighting by a spatial
// gaussian and depth/normal discontinuity stops so GI/AO is smoothed without
// bleeding across geometry edges. denoisingRadius (0..1) scales the pixel
// footprint (SSRT3's ComputeMaxDenoisingRadius is distance-based; we use a
// screen-space footprint that shrinks with distance — documented simplification).
// GI (rgb) and AO (a) are filtered together with the same weights.

struct DParams {
  resolution : vec2<f32>,
  near : f32,
  far : f32,
  denoisingRadius : f32,
  flags : u32,          // bit0 enabled
  pad0 : f32,
  pad1 : f32,
};

@group(0) @binding(0) var srcTex : texture_2d<f32>;    // GI/AO to filter (temporal output)
@group(0) @binding(1) var depthTex : texture_depth_2d;
@group(0) @binding(2) var normalTex : texture_2d<f32>; // view-space normal
@group(0) @binding(3) var outTex : texture_storage_2d<rgba16float, write>;
@group(0) @binding(4) var<uniform> p : DParams;

fn linearDepth(coord : vec2<i32>) -> f32 {
  let dv = textureLoad(depthTex, coord, 0);
  return (p.near * p.far) / (p.far - dv * (p.far - p.near));
}

// 16-tap disk (SSRT3 uses a low-discrepancy disk of 16 samples full-res).
const TAPS : array<vec2<f32>, 16> = array<vec2<f32>, 16>(
  vec2<f32>( 0.0,  0.0),  vec2<f32>( 1.0,  0.0),  vec2<f32>( 0.0,  1.0),  vec2<f32>(-1.0,  0.0),
  vec2<f32>( 0.0, -1.0),  vec2<f32>( 0.7,  0.7),  vec2<f32>(-0.7,  0.7),  vec2<f32>( 0.7, -0.7),
  vec2<f32>(-0.7, -0.7),  vec2<f32>( 1.7,  0.4),  vec2<f32>(-0.4,  1.7),  vec2<f32>(-1.7, -0.4),
  vec2<f32>( 0.4, -1.7),  vec2<f32>( 1.3, -1.3),  vec2<f32>(-1.3,  1.3),  vec2<f32>( 1.5,  1.5),
);

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) gid : vec3<u32>) {
  let dim = vec2<u32>(u32(p.resolution.x), u32(p.resolution.y));
  if (gid.x >= dim.x || gid.y >= dim.y) { return; }
  let coord = vec2<i32>(gid.xy);

  let center = textureLoad(srcTex, coord, 0);
  let enabled = (p.flags & 1u) != 0u;
  if (!enabled) {
    textureStore(outTex, coord, center);
    return;
  }

  let centerDepth = linearDepth(coord);
  // Background (far plane): passthrough.
  if (centerDepth >= p.far * 0.999) {
    textureStore(outTex, coord, center);
    return;
  }
  let centerN = normalize(textureLoad(normalTex, coord, 0).xyz);

  // Screen-space footprint: up to ~8px at full radius, shrinking with distance.
  let maxPx = mix(1.0, 8.0, clamp(p.denoisingRadius, 0.0, 1.0));
  let footprint = maxPx / max(1.0, centerDepth * 0.25);
  let radiusPx = max(1.0, footprint);
  let sigma = 0.5 * radiusPx;

  var colorSum = center;
  var wSum = 1.0;
  for (var i = 1; i < 16; i = i + 1) {
    let off = TAPS[i] * radiusPx;
    let sc = coord + vec2<i32>(round(off));
    if (sc.x < 0 || sc.y < 0 || sc.x >= i32(dim.x) || sc.y >= i32(dim.y)) { continue; }
    let sd = linearDepth(sc);
    if (sd >= p.far * 0.999) { continue; }
    let sn = normalize(textureLoad(normalTex, sc, 0).xyz);

    let r = length(off);
    let wSpatial = exp(-(r * r) / (2.0 * sigma * sigma));
    let wDepth = exp(-abs(sd - centerDepth) / max(0.01, centerDepth * 0.05));
    let wNormal = pow(max(0.0, dot(sn, centerN)), 32.0);
    let w = wSpatial * wDepth * wNormal;

    colorSum = colorSum + textureLoad(srcTex, sc, 0) * w;
    wSum = wSum + w;
  }

  textureStore(outTex, coord, colorSum / wSum);
}
