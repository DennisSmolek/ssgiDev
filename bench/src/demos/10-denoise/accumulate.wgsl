// Demo 10 — pseudo-reference converged accumulation of the SAME noisy producer.
// A demo-02-style long accumulation used as the "ground truth" the denoiser stacks
// are scored against under a static camera. Running mean of the raw producer:
//   out = mix(hist, raw, 1/(count+1))
// with `count` an INTEGER driven from the CPU (it resets to 0 on any camera move
// or producer change and increments each still frame), so no per-pixel count
// texture is needed. Over hundreds of still frames this converges to the producer's
// expected value, exactly like demo 02's brute-force reference but for THIS march.
// (No reprojection: the reference is only meaningful with a static camera, and the
// CPU resets it the moment the camera moves.)

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
