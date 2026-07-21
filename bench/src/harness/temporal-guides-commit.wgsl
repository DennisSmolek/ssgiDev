// TemporalGuidesPass — stage 3 of 3: commit this frame's depth + history into
// the pass-owned "previous" copies for NEXT frame's reprojection.
//
// Runs AFTER stage 2 has consumed the prior prevDepth / histPrev (the demo 03
// copydepth ordering: refresh the previous-frame G-buffer copy only once the
// temporal reproject has read the old one). Folding both copies into one
// dispatch keeps the guides at three dispatches total. r32float preserves full
// depth precision for reconstruction; r16float is plenty for the small integer
// history count N.

struct CParams {
  resX : f32,
  resY : f32,
  pad0 : f32,
  pad1 : f32,
};

@group(0) @binding(0) var srcDepth : texture_depth_2d;
@group(0) @binding(1) var srcHist : texture_2d<f32>;                        // histCur (r16float)
@group(0) @binding(2) var dstDepth : texture_storage_2d<r32float, write>;  // prevDepth for next frame
@group(0) @binding(3) var dstHist : texture_storage_2d<r16float, write>;   // histPrev for next frame
@group(0) @binding(4) var<uniform> p : CParams;

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) gid : vec3<u32>) {
  let dim = vec2<u32>(u32(p.resX), u32(p.resY));
  if (gid.x >= dim.x || gid.y >= dim.y) { return; }
  let coord = vec2<i32>(gid.xy);
  let d = textureLoad(srcDepth, coord, 0);
  let n = textureLoad(srcHist, coord, 0).r;
  textureStore(dstDepth, coord, vec4<f32>(d, 0.0, 0.0, 0.0));
  textureStore(dstHist, coord, vec4<f32>(n, 0.0, 0.0, 0.0));
}
