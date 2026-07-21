// Demo 13 (optimization lab) — LIGHT mip pyramid (P5.2 bandwidth family).
// Box-AVERAGE of the march-res light buffer over a 2^mip block, one dispatch per
// level (mirrors ssrt13-depth-pyramid.wgsl, but average instead of box-min and
// rgba16float radiance instead of r32float depth). Consumed by the `light-mips`
// variant: far march samples read a coarser (prefiltered) light mip, cutting the
// uncorrelated global light fetches lab 09 identified as the win cap — and, as a
// bonus, the average is a low-pass prefilter (fewer fireflies from far samples).
//
// mip 0 (scale 1, 1x1 block) is a byte-for-byte copy of the source light buffer,
// so a mip-0 read is identical to sampling lightTex directly (the variant's near
// samples stay exact; only distance-selected coarse mips prefilter).

struct PParams {
  fullRes : vec2<f32>,   // MARCH-res dimensions (mip 0)
  mipLevel : u32,
  pad0 : f32,
};

@group(0) @binding(0) var srcLight : texture_2d<f32>; // march-res light (mip 0 source)
@group(0) @binding(1) var outMip : texture_storage_2d<rgba16float, write>;
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
  var sum = vec3<f32>(0.0);
  var cnt = 0.0;
  for (var dy = 0; dy < i32(scale); dy = dy + 1) {
    for (var dx = 0; dx < i32(scale); dx = dx + 1) {
      let c = base + vec2<i32>(dx, dy);
      if (c.x < full.x && c.y < full.y) {
        sum = sum + textureLoad(srcLight, c, 0).rgb; // box-average = prefilter
        cnt = cnt + 1.0;
      }
    }
  }
  textureStore(outMip, vec2<i32>(gid.xy), vec4<f32>(sum / max(1.0, cnt), 1.0));
}
