// Demo 10 stack 4 — XeGTAO-style denoise (pass 2 of 2): the temporal component.
// XeGTAO ships spatial-only and expects the host engine's TAA to supply temporal
// stability (techniques-survey.md §2). Here we approximate that with a light
// fixed-alpha EMA over the spatially-filtered signal: reproject last frame's
// resolved value along velocity, and blend toward the current spatially-filtered
// frame at `alpha`, discarding history on disocclusion (relative-depth reject).
// This is intentionally simpler than SSRT3's world-pos-delta + neighbourhood
// clamp — the point of the stack is "XeGTAO's strong symmetric spatial filter +
// a minimal temporal", to contrast against the heavier SSRT3/Mathis temporals.

struct Params {
  resolution : vec2<f32>,
  near : f32,
  far : f32,
  alpha : f32,        // EMA blend toward current (higher = less ghosting, more noise)
  depthThresh : f32,
  reset : u32,
  pad0 : f32,
};

@group(0) @binding(0) var curTex : texture_2d<f32>;   // spatially-filtered current (pass 1)
@group(0) @binding(1) var histTex : texture_2d<f32>;  // previous resolved
@group(0) @binding(2) var velTex : texture_2d<f32>;
@group(0) @binding(3) var depthTex : texture_depth_2d;
@group(0) @binding(4) var outTex : texture_storage_2d<rgba16float, write>;
@group(0) @binding(5) var<uniform> p : Params;

fn linZ(coord : vec2<i32>) -> f32 {
  let d = textureLoad(depthTex, coord, 0);
  return (p.near * p.far) / (p.far - d * (p.far - p.near));
}

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) gid : vec3<u32>) {
  let dim = vec2<u32>(u32(p.resolution.x), u32(p.resolution.y));
  if (gid.x >= dim.x || gid.y >= dim.y) { return; }
  let coord = vec2<i32>(gid.xy);
  let uv = (vec2<f32>(gid.xy) + 0.5) / p.resolution;

  let current = textureLoad(curTex, coord, 0);
  if ((p.reset != 0u)) { textureStore(outTex, coord, current); return; }

  let vel = textureLoad(velTex, coord, 0).xy;
  let reprojUV = uv - vel * vec2<f32>(0.5, -0.5);
  if (reprojUV.x < 0.0 || reprojUV.y < 0.0 || reprojUV.x > 1.0 || reprojUV.y > 1.0) {
    textureStore(outTex, coord, current);
    return;
  }
  let sc = vec2<i32>(floor(reprojUV * p.resolution));
  let curZ = linZ(coord);
  let reprojZ = linZ(sc);
  let dRel = abs(reprojZ - curZ) / max(1e-3, curZ);
  if (dRel > p.depthThresh) {
    textureStore(outTex, coord, current);
    return;
  }
  let hist = textureLoad(histTex, sc, 0);
  let result = mix(hist, current, clamp(p.alpha, 0.0, 1.0));
  textureStore(outTex, coord, result);
}
