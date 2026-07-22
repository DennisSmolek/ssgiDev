// Demo 17 — pseudo-reference converged accumulation of the SAME noisy producer
// both arms consume. Copied verbatim from 10-denoise/accumulate.wgsl (demos
// 00-13 are frozen; this lab owns its copy rather than depending on a frozen
// demo's file). Running mean of the raw producer:
//   out = mix(hist, raw, 1/(count+1))
// with `count` an INTEGER driven from the CPU (resets to 0 on camera move or
// stack switch, increments each still frame). Over hundreds of still frames
// this converges to the producer's expected value — the oracle the two guide
// arms are A/B'd against under a static camera. No reprojection: only
// meaningful with a static camera, reset the moment the camera moves.

struct Params {
  resolution : vec2<f32>,
  count : f32,   // frames already accumulated (0 on reset)
  reset : u32,
};

@group(0) @binding(0) var rawTex : texture_2d<f32>;
@group(0) @binding(1) var histTex : texture_2d<f32>;
@group(0) @binding(2) var outTex : texture_storage_2d<rgba16float, write>;
@group(0) @binding(3) var<uniform> p : Params;

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) gid : vec3<u32>) {
  let dim = vec2<u32>(u32(p.resolution.x), u32(p.resolution.y));
  if (gid.x >= dim.x || gid.y >= dim.y) { return; }
  let coord = vec2<i32>(gid.xy);
  let raw = textureLoad(rawTex, coord, 0);
  if (p.reset != 0u) {
    textureStore(outTex, coord, raw);
    return;
  }
  let hist = textureLoad(histTex, coord, 0);
  let a = 1.0 / (p.count + 1.0);
  textureStore(outTex, coord, mix(hist, raw, a));
}
