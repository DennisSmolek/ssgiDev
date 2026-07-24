// Demo 18 (temporal lab) — FORK of demo 12 (ssrt12-downsample), copied verbatim.
// NOT ?raw-imported (frozen-fork lesson, WORKLOG 2026-07-21). See README provenance.
// Demo 09 — bandwidth lab. G-buffer downsample: produce a march-resolution
// depth / normal / light buffer from the full-res G-buffer. This is what makes
// the half-res (Table 2) recipe honest: the march then reads a self-consistent
// low-res G-buffer (1/4 the texels at 0.5x, 1/16 at 0.25x) — the bandwidth win —
// instead of point-sampling the full-res buffers at fractional coords.
//
// At scale 1.0 the block is 1x1, so this is a straight copy (the full-res
// baseline still routes through the same march code path -> fair comparison).
//
//   depth  : box-MIN of raw clip depth over the block (closest surface, a
//            conservative occluder, matches demo 03's depth-pyramid choice).
//   normal : the view normal of the MIN-depth texel (closest surface's normal).
//   light  : box-average of the beauty buffer over the block.

struct DSParams {
  fullRes : vec2<f32>,
  outRes : vec2<f32>,
  blockSize : u32,   // fullRes / outRes, integer (1, 2, 4)
  pad0 : f32,
  pad1 : f32,
  pad2 : f32,
};

@group(0) @binding(0) var depthTex : texture_depth_2d;
@group(0) @binding(1) var normalTex : texture_2d<f32>;
@group(0) @binding(2) var lightTex : texture_2d<f32>;
@group(0) @binding(3) var outDepth : texture_storage_2d<r32float, write>;
@group(0) @binding(4) var outNormal : texture_storage_2d<rgba16float, write>;
@group(0) @binding(5) var outLight : texture_storage_2d<rgba16float, write>;
@group(0) @binding(6) var<uniform> p : DSParams;

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) gid : vec3<u32>) {
  let outDim = vec2<u32>(u32(p.outRes.x), u32(p.outRes.y));
  if (gid.x >= outDim.x || gid.y >= outDim.y) { return; }

  let full = vec2<i32>(p.fullRes);
  let bs = i32(p.blockSize);
  let base = vec2<i32>(gid.xy) * bs;

  var minD = 1.0;
  var bestC = base;
  var lightSum = vec3<f32>(0.0);
  var cnt = 0.0;
  for (var dy = 0; dy < bs; dy = dy + 1) {
    for (var dx = 0; dx < bs; dx = dx + 1) {
      let c = base + vec2<i32>(dx, dy);
      if (c.x < full.x && c.y < full.y) {
        let d = textureLoad(depthTex, c, 0);
        if (d < minD) { minD = d; bestC = c; }
        lightSum = lightSum + textureLoad(lightTex, c, 0).rgb;
        cnt = cnt + 1.0;
      }
    }
  }

  let normal = textureLoad(normalTex, bestC, 0).xyz;
  let coord = vec2<i32>(gid.xy);
  textureStore(outDepth, coord, vec4<f32>(minD, 0.0, 0.0, 0.0));
  textureStore(outNormal, coord, vec4<f32>(normal, 1.0));
  textureStore(outLight, coord, vec4<f32>(lightSum / max(1.0, cnt), 1.0));
}
