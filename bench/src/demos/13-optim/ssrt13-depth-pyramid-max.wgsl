// Demo 13 (optimization lab) — MAX depth pyramid (P5.2 bandwidth family).
// The base already builds a box-MIN depth pyramid (ssrt13-depth-pyramid.wgsl,
// closest surface = conservative occluder). This is its companion box-MAX chain:
// per level, the FARTHEST surface over a 2^mip block. Together they bracket the
// depth interval [min, max] of a coarse screen tile — the Hi-Z structure the
// `hiz-skip` variant uses for conservative empty-space skipping (advantagous-
// concepts.md: "adding max gives empty-space skipping"). Second pyramid (kept
// separate rather than packing min/max into rg) so the existing min pyramid pass
// and its consumers are untouched — the frozen-fork discipline.
//
// Box-MAX over the block; texels outside the buffer are simply not counted (init
// 0.0 = nearest possible raw clip depth, so an all-out-of-range tile stays 0).

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
  var m = 0.0;
  for (var dy = 0; dy < i32(scale); dy = dy + 1) {
    for (var dx = 0; dx < i32(scale); dx = dx + 1) {
      let c = base + vec2<i32>(dx, dy);
      if (c.x < full.x && c.y < full.y) {
        m = max(m, textureLoad(marchDepthTex, c, 0).r); // max raw depth = farthest
      }
    }
  }
  textureStore(outMip, vec2<i32>(gid.xy), vec4<f32>(m, 0.0, 0.0, 0.0));
}
