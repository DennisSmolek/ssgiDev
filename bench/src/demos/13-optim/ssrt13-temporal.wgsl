// Demo 12 (distilled SSGI v0) — FROZEN FORK of demo 03 (ssrt-temporal). Copied verbatim,
// NOT ?raw-imported (frozen-fork lesson, WORKLOG 2026-07-21). See README provenance.
// Demo 03 stage (d) — temporal reprojection.
// Port of SSRT3 SSRT.shader `TemporalReprojPass`: reproject previous resolved
// GI/AO along motion vectors, reject on world-position delta, neighborhood-clamp
// the history, blend.
//
// three velocity convention: velocity = ndcCurrent - ndcPrevious. UV reprojection
// (matches TRAANode): prevUV = uv - velocity.xy * vec2(0.5, -0.5).
// World reconstruction uses invViewProj (= camera.matrixWorld * projInverse) with
// WebGPU clip (ndc.y = 1 - 2*uv.y, clip z = depth in [0,1]).
//
// PREV DEPTH (Task 1): dPrev now reads a REAL previous-depth buffer
// (prevDepthTex, an r32float copy of last frame's depth refreshed by
// ssrt-copydepth.wgsl AFTER this pass runs) — matching SSRT3's
// previousDepthTexture — instead of the old "current depth at the reprojected
// coord" proxy. The world-delta reject is now accurate under camera motion.
//
// ACCUMULATION MODES (Task 2):
//   ssrt3-ema   (flag bit2 = 0): SSRT3-faithful. blendWeight = mix(1, temporalResponse,
//               posSimilarity) — a ~3-frame EMA that cannot fully converge the
//               12-frame (6 rotations x 4 offsets) noise cycle -> residual boil.
//   frame-count (flag bit2 = 1): "our" convergence-aware improvement. A per-pixel
//               frame counter N (r16float ping-pong, reprojected alongside GI) is
//               incremented while history stays valid and reset to 1 on
//               disocclusion / off-screen / reset. blendWeight = 1/N, so a static
//               pixel keeps averaging (up to accumFrameCap frames) and the cycle
//               converges. Soft neighborhood clamp (mix 0.25) bounds ghosting in
//               BOTH modes. N is written in both modes so switching needs no reset.

struct TParams {
  invViewProj : mat4x4<f32>,
  prevInvViewProj : mat4x4<f32>,
  resolution : vec2<f32>,
  near : f32,
  far : f32,
  temporalResponse : f32,
  flags : u32,          // bit0 enabled, bit1 reset, bit2 accumMode (1=frame-count)
  accumFrameCap : f32,  // frame-count mode: max effective history length
  pad1 : f32,
};

@group(0) @binding(0) var curTex : texture_2d<f32>;      // this frame's raw GI/AO
@group(0) @binding(1) var histTex : texture_2d<f32>;     // previous resolved GI/AO
@group(0) @binding(2) var velTex : texture_2d<f32>;      // velocity (NDC delta)
@group(0) @binding(3) var depthTex : texture_depth_2d;   // current depth
@group(0) @binding(4) var prevDepthTex : texture_2d<f32>;// real previous depth (r32float copy)
@group(0) @binding(5) var countHistTex : texture_2d<f32>;// previous frame-count N (r16float)
@group(0) @binding(6) var outTex : texture_storage_2d<rgba16float, write>;
@group(0) @binding(7) var countOutTex : texture_storage_2d<r16float, write>;
@group(0) @binding(8) var<uniform> p : TParams;

fn depthAt(coord : vec2<i32>) -> f32 {
  let c = clamp(coord, vec2<i32>(0), vec2<i32>(p.resolution) - vec2<i32>(1));
  return textureLoad(depthTex, c, 0);
}
fn prevDepthAt(coord : vec2<i32>) -> f32 {
  let c = clamp(coord, vec2<i32>(0), vec2<i32>(p.resolution) - vec2<i32>(1));
  return textureLoad(prevDepthTex, c, 0).x;
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
  let frameCountMode = (p.flags & 4u) != 0u;

  // Disabled or reset: no history to trust -> emit current, restart the counter.
  if (!enabled || reset) {
    textureStore(outTex, coord, current);
    textureStore(countOutTex, coord, vec4<f32>(1.0, 0.0, 0.0, 0.0));
    return;
  }

  let vel = textureLoad(velTex, coord, 0).xy;
  let offsetUV = vel * vec2<f32>(0.5, -0.5);
  let reprojUV = uv - offsetUV;

  // Off-screen history -> disocclusion: keep current, restart the counter.
  if (reprojUV.x < 0.0 || reprojUV.y < 0.0 || reprojUV.x > 1.0 || reprojUV.y > 1.0) {
    textureStore(outTex, coord, current);
    textureStore(countOutTex, coord, vec4<f32>(1.0, 0.0, 0.0, 0.0));
    return;
  }

  let reprojCoord = vec2<i32>(floor(reprojUV * p.resolution));

  let d = depthAt(coord);
  let dPrev = prevDepthAt(reprojCoord);                 // Task 1: real prev depth
  let curWorld = worldFromUV(p.invViewProj, uv, d);
  let prevWorld = worldFromUV(p.prevInvViewProj, reprojUV, dPrev);

  let posSimilarity = clamp(1.0 - distance(prevWorld, curWorld), 0.0, 1.0);
  let disocclusion = posSimilarity < 0.5;

  // Frame counter reproject (Task 2): grow while history is valid, reset on
  // disocclusion. Written in both modes so a mode switch never needs a reset.
  let prevN = loadClamped(countHistTex, reprojCoord).x;
  var N : f32;
  if (disocclusion) {
    N = 1.0;
  } else {
    N = min(prevN + 1.0, p.accumFrameCap);
  }

  // Blend weight: SSRT3 EMA vs 1/N convergence.
  var blendWeight : f32;
  if (frameCountMode) {
    blendWeight = 1.0 / N;
  } else {
    blendWeight = mix(1.0, p.temporalResponse, posSimilarity);
  }

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
  textureStore(countOutTex, coord, vec4<f32>(N, 0.0, 0.0, 0.0));
}
