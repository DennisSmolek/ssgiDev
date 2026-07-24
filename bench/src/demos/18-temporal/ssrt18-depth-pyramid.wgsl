// Demo 18 (temporal lab) — FORK of demo 12 (ssrt12-depth-pyramid), copied verbatim.
// FORK of demo 03 ssrt-depth-pyramid.wgsl, with ONE change: the source is the
// MARCH-RESOLUTION depth (an r32float texture produced by the downsample pass),
// not the full-res device depth buffer. In demo 12 the march runs at march res
// (half by default, lab 09 verdict), so its mip pyramid must be built from the
// march-res depth to stay self-consistent (posSSToVSMip reads pyramid level k at
// march_res / 2^k). Box-MIN over a 2^mip block (closest surface = conservative
// occluder), one dispatch per level writing that level's storage view.

struct PParams {
  fullRes : vec2<f32>,   // MARCH-res dimensions (mip 0)
  mipLevel : u32,
  pad0 : f32,
};

@group(0) @binding(0) var marchDepthTex : texture_2d<f32>; // r32float march-res depth (mip 0)
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
        m = min(m, textureLoad(marchDepthTex, c, 0).r); // min raw depth = closest
      }
    }
  }
  textureStore(outMip, vec2<i32>(gid.xy), vec4<f32>(m, 0.0, 0.0, 0.0));
}
