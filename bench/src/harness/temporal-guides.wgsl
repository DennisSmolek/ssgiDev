// TemporalGuidesPass — stage 2 of 3: reproject, grade disocclusion, advance
// history length, seed the reactive mask. This is the core "temporal guides"
// product per FSR3-BRIEF.md, produced once per frame post-G-buffer.
//
// Inputs (all this frame unless noted):
//   depthTex        current device depth
//   dilatedVelTex   rg16float dilated velocity from stage 1 (NDC delta)
//   prevDepthTex    r32float device depth from the PREVIOUS frame (owned copy)
//   histPrevTex     r16float valid-history count N from the PREVIOUS frame
//   reactiveInTex   r8unorm optional app/effect reactive hints (see below)
//
// Outputs:
//   disoccOut  r16float  GRADED disocclusion 0 (stable) .. 1 (fresh)
//   histOut    r16float  this-frame valid-history count N
//   reactiveOut r8unorm  merged reactive mask (see reactive note)
//
// DISOCCLUSION GRADING (documented, simple + monotonic):
//   reproject with the dilated MV: prevUV = uv - vel.xy * vec2(0.5, -0.5).
//   Off-screen history => 1 (fully fresh). On-screen: linearise this pixel's
//   current depth and the PREVIOUS-frame depth sampled at the reprojected coord
//   to positive eye-space distances zCur, zPrev, then
//       relErr = |zCur - zPrev| / max(zCur, EPS)
//       disocclusion = smoothstep(disoccLo, disoccHi, relErr)
//   relErr is scale-invariant (a fraction of the surface's own distance), so
//   one lo/hi pair works across the depth range; smoothstep makes the 0..1
//   grade monotonic in the reprojection error. A surface that reprojects onto
//   itself has relErr~0 => 0; a newly revealed background (prev depth was the
//   near foreground) has large relErr => 1.
//
// HISTORY LENGTH: N follows the surface — read at the reprojected coord. If the
//   pixel is disoccluded past `disoccResetThresh` (or a global reset), N := 0;
//   otherwise N := min(N_prev + 1, historyCap).
//
// REACTIVE: seeded from an optional app/effect mask, MERGE-not-overwrite:
//   reactiveOut = max(reactiveInTex, 0). The caller binds either a real
//   full-res mask or the pass's 1x1 zero fallback; WebGPU textureLoad returns 0
//   out of bounds, so the 1x1 fallback yields 0 everywhere. Downstream GI /
//   multibounce passes that want to flag fast-changing pixels max() their own
//   contribution into this same texture AFTER the guides run (FSR3-BRIEF: the
//   mask flows both ways) — this pass only establishes the app-hint floor.
//
// WebGPU y-down integer coords; no view<->screen y-mirror (all reads and the
// reprojection stay in screen space; depth linearisation is a scalar).

struct GParams {
  resX : f32,
  resY : f32,
  near : f32,
  far : f32,
  disoccLo : f32,
  disoccHi : f32,
  disoccResetThresh : f32,
  historyCap : f32,
  flags : u32,          // bit0 = global reset (clear history + force fresh)
  pad0 : u32,
  pad1 : u32,
  pad2 : u32,
};

@group(0) @binding(0) var depthTex : texture_depth_2d;
@group(0) @binding(1) var dilatedVelTex : texture_2d<f32>;
@group(0) @binding(2) var prevDepthTex : texture_2d<f32>;
@group(0) @binding(3) var histPrevTex : texture_2d<f32>;
@group(0) @binding(4) var reactiveInTex : texture_2d<f32>;
@group(0) @binding(5) var disoccOut : texture_storage_2d<r16float, write>;
@group(0) @binding(6) var histOut : texture_storage_2d<r16float, write>;
@group(0) @binding(7) var reactiveOut : texture_storage_2d<r8unorm, write>;
@group(0) @binding(8) var<uniform> p : GParams;

const EPS = 1.0e-4;

// Device depth [0,1] -> positive eye-space distance. Standard perspective:
// zEye = near*far / (far - d*(far-near)). Monotonic in d; used only for the
// relative-error ratio so the exact projection constant is not load-bearing.
fn linearDepth(d : f32) -> f32 {
  return (p.near * p.far) / max(p.far - d * (p.far - p.near), EPS);
}

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) gid : vec3<u32>) {
  let dim = vec2<i32>(i32(p.resX), i32(p.resY));
  if (gid.x >= u32(dim.x) || gid.y >= u32(dim.y)) { return; }
  let coord = vec2<i32>(gid.xy);
  let res = vec2<f32>(p.resX, p.resY);
  let uv = (vec2<f32>(gid.xy) + 0.5) / res;

  let reactive = max(textureLoad(reactiveInTex, coord, 0).r, 0.0);
  let reset = (p.flags & 1u) != 0u;

  if (reset) {
    textureStore(disoccOut, coord, vec4<f32>(1.0, 0.0, 0.0, 0.0));
    textureStore(histOut, coord, vec4<f32>(0.0, 0.0, 0.0, 0.0));
    textureStore(reactiveOut, coord, vec4<f32>(reactive, 0.0, 0.0, 0.0));
    return;
  }

  let vel = textureLoad(dilatedVelTex, coord, 0).xy;
  let reprojUV = uv - vel * vec2<f32>(0.5, -0.5);

  var disocc = 1.0;
  var n = 0.0;

  let onScreen = reprojUV.x >= 0.0 && reprojUV.y >= 0.0 && reprojUV.x <= 1.0 && reprojUV.y <= 1.0;
  if (onScreen) {
    let reprojCoord = clamp(vec2<i32>(floor(reprojUV * res)), vec2<i32>(0), dim - vec2<i32>(1));
    let zCur = linearDepth(textureLoad(depthTex, coord, 0));
    let zPrev = linearDepth(textureLoad(prevDepthTex, reprojCoord, 0).r);
    let relErr = abs(zCur - zPrev) / max(zCur, EPS);
    disocc = smoothstep(p.disoccLo, p.disoccHi, relErr);

    let nPrev = textureLoad(histPrevTex, reprojCoord, 0).r;
    let stable = disocc <= p.disoccResetThresh;
    n = select(0.0, min(nPrev + 1.0, p.historyCap), stable);
  }

  textureStore(disoccOut, coord, vec4<f32>(disocc, 0.0, 0.0, 0.0));
  textureStore(histOut, coord, vec4<f32>(n, 0.0, 0.0, 0.0));
  textureStore(reactiveOut, coord, vec4<f32>(reactive, 0.0, 0.0, 0.0));
}
