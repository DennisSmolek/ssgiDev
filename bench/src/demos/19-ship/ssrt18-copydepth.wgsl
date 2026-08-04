// Demo 18 (temporal lab) — FORK of demo 12 (ssrt12-copydepth), copied verbatim.
// NOT ?raw-imported (frozen-fork lesson, WORKLOG 2026-07-21). See README provenance.
// Demo 03 stage (d) helper — copy the depth buffer into an r32float storage
// texture so NEXT frame's temporal pass has a real previous-depth buffer.
// SSRT3 keeps `previousDepthTexture` (SSRT_HDRP.cs) and refreshes it each frame
// AFTER the temporal reproject has consumed the prior copy. This tiny pass is
// that refresh. r32float preserves full depth precision.

struct CParams {
  resolution : vec2<f32>,
  pad0 : f32,
  pad1 : f32,
};

@group(0) @binding(0) var srcDepth : texture_depth_2d;
@group(0) @binding(1) var dstDepth : texture_storage_2d<r32float, write>;
@group(0) @binding(2) var<uniform> p : CParams;

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) gid : vec3<u32>) {
  let dim = vec2<u32>(u32(p.resolution.x), u32(p.resolution.y));
  if (gid.x >= dim.x || gid.y >= dim.y) { return; }
  let coord = vec2<i32>(gid.xy);
  let d = textureLoad(srcDepth, coord, 0);
  textureStore(dstDepth, coord, vec4<f32>(d, 0.0, 0.0, 0.0));
}
