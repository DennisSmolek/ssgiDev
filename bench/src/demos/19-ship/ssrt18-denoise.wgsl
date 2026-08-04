// Demo 18 (temporal lab) — FORK of demo 12 (ssrt12-denoise). Demo 03 stage (d)
// bilateral denoise (SSRT3 DiffuseDenoiser lineage — see demo 12 provenance),
// extended with the demo-18 SPATIAL FALLBACK and the accumulated beauty/albedo
// copy-through:
//
// SPATIAL FALLBACK (flags bit1): oneOverN accumulation is exact but slow to
// warm up — the first few frames after a camera move / disocclusion show the
// raw-noise boil. When the per-pixel age N (countTex, written by
// ssrt18-temporal this frame) is below nMin, blend the bilateral-filtered
// result toward the unfiltered one with t = clamp(N / nMin, 0, 1):
//   result = mix(filtered, unfiltered, t)
// so young pixels are smoothed and the filter fades out entirely by N == nMin
// (a converged still frame is untouched — no resolution cost at equilibrium).
// The always-on `denoising` toggle (flags bit0) is kept from demo 12 and wins
// over the fade when enabled.
//
// BEAUTY/ALBEDO COPY-THROUGH: the temporal pass accumulates beauty/albedo into
// ping-pong pairs (AA under camera jitter); the display node needs a STABLE
// texture identity, so this pass (which already runs right after temporal)
// copies the current write side into beautyFinal/albedoFinal. Two extra
// full-res copies — cheap, and it keeps the display pipeline static.

struct DParams {
  resolution : vec2<f32>,
  near : f32,
  far : f32,
  denoisingRadius : f32,
  flags : u32,          // bit0 denoising always-on, bit1 spatial fallback
  nMin : f32,           // spatial fallback: age at which the filter has faded out
  pad0 : f32,
};

@group(0) @binding(0) var srcTex : texture_2d<f32>;    // GI/AO to filter (temporal output)
@group(0) @binding(1) var depthTex : texture_depth_2d;
@group(0) @binding(2) var normalTex : texture_2d<f32>; // view-space normal
@group(0) @binding(3) var countTex : texture_2d<f32>;  // per-pixel age N (this frame's write)
@group(0) @binding(4) var beautyAccTex : texture_2d<f32>; // accumulated beauty (temporal write side)
@group(0) @binding(5) var albedoAccTex : texture_2d<f32>; // accumulated albedo (temporal write side)
@group(0) @binding(6) var outTex : texture_storage_2d<rgba16float, write>;
@group(0) @binding(7) var beautyFinalTex : texture_storage_2d<rgba16float, write>;
@group(0) @binding(8) var albedoFinalTex : texture_storage_2d<rgba16float, write>;
@group(0) @binding(9) var<uniform> p : DParams;

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

  // Stable-identity copy of the accumulated beauty/albedo (see header).
  textureStore(beautyFinalTex, coord, textureLoad(beautyAccTex, coord, 0));
  textureStore(albedoFinalTex, coord, textureLoad(albedoAccTex, coord, 0));

  let center = textureLoad(srcTex, coord, 0);
  let denoiseOn = (p.flags & 1u) != 0u;
  let fallbackOn = (p.flags & 2u) != 0u;
  // Spatial-fallback fade: 0 -> fully filtered (young pixel), 1 -> untouched.
  let age = textureLoad(countTex, coord, 0).x;
  let t = clamp(age / max(1.0, p.nMin), 0.0, 1.0);
  if (!denoiseOn && (!fallbackOn || t >= 1.0)) {
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

  let filtered = colorSum / wSum;
  if (denoiseOn) {
    textureStore(outTex, coord, filtered);
  } else {
    // Spatial fallback: fade the filter out as the pixel ages toward nMin.
    textureStore(outTex, coord, mix(filtered, center, t));
  }
}
