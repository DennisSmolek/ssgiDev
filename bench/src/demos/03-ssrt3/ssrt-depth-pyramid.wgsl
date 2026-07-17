// Demo 03 stage (g) — depth pyramid downsample.
// SSRT3 samples a depth pyramid at coarser mips over distance (mipOptimization)
// to cut sampling bandwidth. We build the pyramid from the raw device-depth
// buffer with a box-MIN over a 2^mip block (min raw depth = closest surface, a
// conservative occluder representation). One dispatch per mip level, writing that
// level's storage view (RawComputePass storageMip); the source is the full-res
// depth buffer (a different texture), so there is no same-texture read+write.

struct PParams {
  fullRes : vec2<f32>,   // full-res dimensions
  mipLevel : u32,
  pad0 : f32,
};

@group(0) @binding(0) var depthTex : texture_depth_2d;
@group(0) @binding(1) var outMip : texture_storage_2d<r32float, write>;
@group(0) @binding(2) var<uniform> p : PParams;

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) gid : vec3<u32>) {
  let scale = 1u << p.mipLevel;
  let mipDim = vec2<u32>(
    max(1u, u32(p.fullRes.x) / scale),
    max(1u, u32(p.fullRes.y) / scale),
  );
  if (gid.x >= mipDim.x || gid.y >= mipDim.y) { return; }

  let base = vec2<i32>(gid.xy) * i32(scale);
  let full = vec2<i32>(p.fullRes);
  var m = 1.0;
  for (var dy = 0; dy < i32(scale); dy = dy + 1) {
    for (var dx = 0; dx < i32(scale); dx = dx + 1) {
      let c = base + vec2<i32>(dx, dy);
      if (c.x < full.x && c.y < full.y) {
        m = min(m, textureLoad(depthTex, c, 0)); // min raw depth = closest
      }
    }
  }
  textureStore(outMip, vec2<i32>(gid.xy), vec4<f32>(m, 0.0, 0.0, 0.0));
}
