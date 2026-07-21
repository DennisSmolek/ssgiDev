// TemporalGuidesPass — stage 1 of 3: closest-depth velocity dilation.
//
// FSR3 "reconstruct & dilate": for each pixel pick the 3x3 neighbour whose
// device depth is CLOSEST to the camera and adopt its motion vector. This
// pulls the sharp foreground velocity out over the half-pixel-wide seam of
// disocclusion that a naive per-pixel MV leaves noisy, so the reprojection in
// stage 2 follows the moving surface instead of the (stale) background behind
// its silhouette.
//
// three MRT velocity convention: velocity = ndcCurrent - ndcPrevious (NDC
// delta); reprojection (stage 2) is prevUV = uv - vel.xy * vec2(0.5, -0.5).
// We only dilate here; the reprojection lives in temporal-guides.wgsl.
//
// Depth convention: `closestIsMin > 0.5` => nearest-to-camera == MIN device
// depth (standard [0,1] perspective, three's default). Flip the flag if the
// projection is reversed-Z. WebGPU top-left/y-down integer coords throughout
// (no y-mirror: depth, velocity and the output storage texture all share the
// same screen-space orientation — the FSR3-BRIEF trap only bites math that
// crosses view<->screen space, which this pass never does).

struct DParams {
  resX : f32,
  resY : f32,
  closestIsMin : f32,
  pad0 : f32,
};

@group(0) @binding(0) var depthTex : texture_depth_2d;
@group(0) @binding(1) var velTex : texture_2d<f32>;                        // three MRT velocity (NDC delta)
@group(0) @binding(2) var dstVel : texture_storage_2d<rg16float, write>;  // dilated velocity out
@group(0) @binding(3) var<uniform> p : DParams;

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) gid : vec3<u32>) {
  let dim = vec2<i32>(i32(p.resX), i32(p.resY));
  if (gid.x >= u32(dim.x) || gid.y >= u32(dim.y)) { return; }
  let coord = vec2<i32>(gid.xy);

  // Metric is arranged so the SMALLEST metric is always the closest surface:
  // min-depth convention uses d directly; reversed-Z uses -d.
  var bestMetric = 3.0e30;
  var bestVel = textureLoad(velTex, coord, 0).xy;
  for (var dy = -1; dy <= 1; dy = dy + 1) {
    for (var dx = -1; dx <= 1; dx = dx + 1) {
      let c = clamp(coord + vec2<i32>(dx, dy), vec2<i32>(0), dim - vec2<i32>(1));
      let d = textureLoad(depthTex, c, 0);
      let metric = select(-d, d, p.closestIsMin > 0.5);
      if (metric < bestMetric) {
        bestMetric = metric;
        bestVel = textureLoad(velTex, c, 0).xy;
      }
    }
  }

  textureStore(dstVel, coord, vec4<f32>(bestVel, 0.0, 0.0));
}
