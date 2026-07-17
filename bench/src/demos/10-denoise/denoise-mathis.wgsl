// Demo 10 stack 3 — Mathis accumulation + adaptive bilateral.
// Adapted from demo 06's sshgi-accum.wgsl (Mathis Buffer C), but operating on the
// demo-03 producer's packed GI/AO signal (rgb = GI, a = AO) instead of Mathis's
// own march output, and WITHOUT the albedo modulation (the lab keeps the signal
// pre-albedo like demo 03; the display composite applies albedo). His two
// defining behaviours are preserved verbatim:
//   1. count-based temporal accumulation: out = (hist*count + denoisedRaw)/(count+1),
//      count capped — NOT a fixed EMA alpha.
//   2. adaptive spatial bilateral whose radius shrinks as the per-pixel history
//      count grows (5x5 fresh -> 3x3 converged), plane + normal edge stops.
// Count is stored per-pixel in a SEPARATE r32float texture (Mathis packs count in
// alpha, but here alpha carries AO), so this pass writes TWO storage outputs.
//
// Velocity reprojection uses three's convention (prevUV = uv - vel*vec2(0.5,-0.5),
// matching ssrt-temporal.wgsl); disocclusion is rejected on a depth-relative delta
// using the current depth at the reprojected coord as the previous-depth proxy
// (documented simplification, same as demo 03 — avoids a prev-gbuffer copy pass).

struct Params {
  invProj : mat4x4<f32>,
  resolution : vec2<f32>,
  near : f32,
  far : f32,
  reset : u32,
  countCap : u32,
  bilateralScale : f32,
  depthThresh : f32,
};

@group(0) @binding(0) var rawTex : texture_2d<f32>;       // producer GI/AO (rgb=GI, a=AO)
@group(0) @binding(1) var histColorTex : texture_2d<f32>; // prev accumulated (rgb=GI, a=AO)
@group(0) @binding(2) var histCountTex : texture_2d<f32>; // prev per-pixel count (r)
@group(0) @binding(3) var depthTex : texture_depth_2d;
@group(0) @binding(4) var normalTex : texture_2d<f32>;    // view-space normal
@group(0) @binding(5) var velTex : texture_2d<f32>;       // velocity (NDC delta)
@group(0) @binding(6) var outColorTex : texture_storage_2d<rgba16float, write>;
@group(0) @binding(7) var outCountTex : texture_storage_2d<r32float, write>;
@group(0) @binding(8) var<uniform> p : Params;

fn linearDist(coord : vec2<i32>) -> f32 {
  let d = textureLoad(depthTex, coord, 0);
  return (p.near * p.far) / (p.far - d * (p.far - p.near));
}
fn viewPos(uv : vec2<f32>, d : f32) -> vec3<f32> {
  let ndc = vec2<f32>(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0);
  let vp = p.invProj * vec4<f32>(ndc, d, 1.0);
  return vp.xyz / vp.w;
}

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) gid : vec3<u32>) {
  let dim = vec2<u32>(u32(p.resolution.x), u32(p.resolution.y));
  if (gid.x >= dim.x || gid.y >= dim.y) { return; }
  let coord = vec2<i32>(gid.xy);
  let uv = (vec2<f32>(gid.xy) + 0.5) / p.resolution;

  let d = textureLoad(depthTex, coord, 0);
  let raw = textureLoad(rawTex, coord, 0);
  if (d >= 0.99999) {
    textureStore(outColorTex, coord, raw);
    textureStore(outCountTex, coord, vec4<f32>(1.0));
    return;
  }

  let N = normalize(textureLoad(normalTex, coord, 0).xyz);
  let originVS = viewPos(uv, d);

  // --- Temporal history (reproject) ---
  var lastColor = vec4<f32>(0.0);
  var lastCount = 0.0;
  if (p.reset == 0u) {
    let vel = textureLoad(velTex, coord, 0).xy;
    let reprojUV = uv - vel * vec2<f32>(0.5, -0.5);
    if (reprojUV.x >= 0.0 && reprojUV.x < 1.0 && reprojUV.y >= 0.0 && reprojUV.y < 1.0) {
      let sc = vec2<i32>(floor(reprojUV * p.resolution));
      // Disocclusion reject: current depth at reproj coord vs this pixel's depth.
      let curLinZ = linearDist(coord);
      let reprojLinZ = linearDist(sc);
      let dRel = abs(reprojLinZ - curLinZ) / max(1e-3, curLinZ);
      if (dRel <= p.depthThresh) {
        lastColor = textureLoad(histColorTex, sc, 0);
        lastCount = textureLoad(histCountTex, sc, 0).r;
      }
    }
  }

  // --- Adaptive spatial bilateral of the raw signal ---
  var acc = raw;
  var wSum = 1.0;
  let radius = max(1.0, ceil(1.99 - lastCount * 0.25));       // 5x5 fresh -> 3x3 converged
  let radiusCoeff = max(1.0, (2.25 - lastCount * 0.25)) * p.bilateralScale;
  let r = i32(radius);
  for (var y = -r; y <= r; y = y + 1) {
    for (var x = -r; x <= r; x = x + 1) {
      if (x == 0 && y == 0) { continue; }
      let sPix = vec2<f32>(gid.xy) + 0.5 + vec2<f32>(f32(x), f32(y)) * radiusCoeff;
      if (sPix.x < 1.0 || sPix.y < 1.0 || sPix.x >= p.resolution.x - 1.0 || sPix.y >= p.resolution.y - 1.0) {
        continue;
      }
      let sCoord = vec2<i32>(floor(sPix));
      let sd = textureLoad(depthTex, sCoord, 0);
      if (sd >= 0.99999) { continue; }
      let sVP = viewPos(sPix / p.resolution, sd);
      let sN = normalize(textureLoad(normalTex, sCoord, 0).xyz);
      let planeW = select(0.0, 1.0, dot(N, sVP - originVS) < 0.01);
      let normW = select(0.01, 1.0, dot(N, sN) > 0.9);
      let w = max(0.0001, planeW) * normW;
      acc += textureLoad(rawTex, sCoord, 0) * w;
      wSum += w;
    }
  }
  let denoised = acc / wSum;

  // --- Count-based accumulate ---
  let outColor = (lastColor * lastCount + denoised) / (lastCount + 1.0);
  let outCount = min(f32(p.countCap), lastCount + 1.0);
  textureStore(outColorTex, coord, outColor);
  textureStore(outCountTex, coord, vec4<f32>(outCount));
}
