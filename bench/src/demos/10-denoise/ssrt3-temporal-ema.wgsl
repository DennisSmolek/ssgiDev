// Lab 10 fork of demo 03's stage (d) temporal, frozen at the faithful SSRT3
// EMA version (git c77e960^). Demo 03's ssrt-temporal.wgsl has since been
// rewritten (frame-count accumulation, real prev-depth, new binding layout
// 0-8) and no longer matches this lab's pass wiring — importing it live
// silently broke the `ssrt3` stack (validation failure -> black output,
// caught by run-10's stability=0.0000 on 2026-07-21). The lab wants the
// as-shipped SSRT3 EMA anyway: this file IS the faithful baseline.
//
// Port of SSRT3 SSRT.shader `TemporalReprojPass`: reproject previous resolved
// GI/AO along motion vectors, reject on world-position delta, neighborhood-clamp
// the history, blend by temporalResponse.
//
// three velocity convention: velocity = ndcCurrent - ndcPrevious. UV reprojection
// (matches TRAANode): prevUV = uv - velocity.xy * vec2(0.5, -0.5).
// World reconstruction uses invViewProj (= camera.matrixWorld * projInverse) with
// WebGPU clip (ndc.y = 1 - 2*uv.y, clip z = depth in [0,1]). We use the CURRENT
// depth at the reprojected coord as the previous-depth proxy (documented
// simplification — avoids a prev-depth copy pass; the world-delta reject still
// catches disocclusions).

struct TParams {
  invViewProj : mat4x4<f32>,
  prevInvViewProj : mat4x4<f32>,
  resolution : vec2<f32>,
  near : f32,
  far : f32,
  temporalResponse : f32,
  flags : u32,          // bit0 enabled, bit1 reset
  pad0 : f32,
  pad1 : f32,
};

@group(0) @binding(0) var curTex : texture_2d<f32>;   // this frame's raw GI/AO
@group(0) @binding(1) var histTex : texture_2d<f32>;  // previous resolved GI/AO
@group(0) @binding(2) var velTex : texture_2d<f32>;   // velocity (NDC delta)
@group(0) @binding(3) var depthTex : texture_depth_2d;
@group(0) @binding(4) var outTex : texture_storage_2d<rgba16float, write>;
@group(0) @binding(5) var<uniform> p : TParams;

fn depthAt(coord : vec2<i32>) -> f32 {
  let c = clamp(coord, vec2<i32>(0), vec2<i32>(p.resolution) - vec2<i32>(1));
  return textureLoad(depthTex, c, 0);
}
fn worldFromUV(m : mat4x4<f32>, uv : vec2<f32>, depth : f32) -> vec3<f32> {
  let clip = vec4<f32>(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0, depth, 1.0);
  let w = m * clip;
  return w.xyz / w.w;
}
fn loadClamped(t : texture_2d<f32>, coord : vec2<i32>) -> vec4<f32> {
  let c = clamp(coord, vec2<i32>(0), vec2<i32>(p.resolution) - vec2<i32>(1));
  return textureLoad(t, c, 0);
}

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) gid : vec3<u32>) {
  let dim = vec2<u32>(u32(p.resolution.x), u32(p.resolution.y));
  if (gid.x >= dim.x || gid.y >= dim.y) { return; }
  let coord = vec2<i32>(gid.xy);
  let uv = (vec2<f32>(gid.xy) + 0.5) / p.resolution;

  let current = textureLoad(curTex, coord, 0);

  let enabled = (p.flags & 1u) != 0u;
  let reset = (p.flags & 2u) != 0u;
  if (!enabled || reset) {
    textureStore(outTex, coord, current);
    return;
  }

  let vel = textureLoad(velTex, coord, 0).xy;
  let offsetUV = vel * vec2<f32>(0.5, -0.5);
  let reprojUV = uv - offsetUV;

  // Off-screen history -> keep current.
  if (reprojUV.x < 0.0 || reprojUV.y < 0.0 || reprojUV.x > 1.0 || reprojUV.y > 1.0) {
    textureStore(outTex, coord, current);
    return;
  }

  let reprojCoord = vec2<i32>(floor(reprojUV * p.resolution));

  let d = depthAt(coord);
  let dPrev = depthAt(reprojCoord);
  let curWorld = worldFromUV(p.invViewProj, uv, d);
  let prevWorld = worldFromUV(p.prevInvViewProj, reprojUV, dPrev);

  let posSimilarity = clamp(1.0 - distance(prevWorld, curWorld), 0.0, 1.0);
  let blendWeight = mix(1.0, p.temporalResponse, posSimilarity);

  // Neighborhood clamp of history to current 4-neighborhood (reduce ghosting).
  var mn = loadClamped(curTex, coord + vec2<i32>(1, 1));
  var mx = mn;
  var s = loadClamped(curTex, coord + vec2<i32>(1, -1)); mn = min(mn, s); mx = max(mx, s);
  s = loadClamped(curTex, coord + vec2<i32>(-1, 1)); mn = min(mn, s); mx = max(mx, s);
  s = loadClamped(curTex, coord + vec2<i32>(-1, -1)); mn = min(mn, s); mx = max(mx, s);

  var prevGI = loadClamped(histTex, reprojCoord);
  prevGI = mix(prevGI, clamp(prevGI, mn, mx), 0.25);

  let result = mix(prevGI, current, blendWeight);
  textureStore(outTex, coord, result);
}
