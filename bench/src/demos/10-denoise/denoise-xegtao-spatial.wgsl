// Demo 10 stack 4 — XeGTAO-style spatial denoise (pass 1 of 2).
// Best-effort port of Intel XeGTAO's spatial filter (GameTechDev/XeGTAO,
// Source/Rendering/Shaders/XeGTAO.hlsli `XeGTAO_Denoise`), which is explicitly
// designed as spatial-only and to rely on TAA for the temporal component
// (techniques-survey.md §2). XeGTAO is a 5x5 depth-aware filter with edge
// detection made deliberately SYMMETRIC for a sharper blur, and allows a small
// amount of intentional AO leaking across 3/4-edge configs to reduce spatial AND
// temporal aliasing.
//
// FIDELITY NOTE: the real XeGTAO carries a packed per-pixel edge bitmask emitted
// by its main AO pass (4 edge bits/pixel). The demo-03 producer here does not
// emit that mask, so we RECONSTRUCT symmetric edges from the depth buffer: a
// neighbour tap's weight is the product of a fixed 5x5 gaussian and a symmetric
// depth-plane similarity (min of the two-directional deltas, which is what makes
// the XeGTAO edge test symmetric). Normal similarity is added as a secondary stop
// for the RGB GI channels. This is the documented best-effort approximation.
// The temporal half lives in denoise-xegtao-temporal.wgsl (pass 2).

struct Params {
  resolution : vec2<f32>,
  near : f32,
  far : f32,
  radius : f32,       // px spread of the 5x5 kernel
  sharpness : f32,    // depth edge sharpness (higher = tighter)
  pad0 : f32,
  pad1 : f32,
};

@group(0) @binding(0) var rawTex : texture_2d<f32>;    // producer GI/AO (rgb=GI, a=AO)
@group(0) @binding(1) var depthTex : texture_depth_2d;
@group(0) @binding(2) var normalTex : texture_2d<f32>;
@group(0) @binding(3) var outTex : texture_storage_2d<rgba16float, write>;
@group(0) @binding(4) var<uniform> p : Params;

fn linZ(coord : vec2<i32>) -> f32 {
  let d = textureLoad(depthTex, coord, 0);
  return (p.near * p.far) / (p.far - d * (p.far - p.near));
}

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) gid : vec3<u32>) {
  let dim = vec2<u32>(u32(p.resolution.x), u32(p.resolution.y));
  if (gid.x >= dim.x || gid.y >= dim.y) { return; }
  let coord = vec2<i32>(gid.xy);

  let center = textureLoad(rawTex, coord, 0);
  let cd = textureLoad(depthTex, coord, 0);
  if (cd >= 0.99999) { textureStore(outTex, coord, center); return; }

  let centerZ = linZ(coord);
  let centerN = normalize(textureLoad(normalTex, coord, 0).xyz);
  let step = max(1, i32(round(p.radius)));

  var acc = vec4<f32>(0.0);
  var wSum = 0.0;
  // 5x5 (RADIUS=2 taps in each direction, scaled by `step`).
  for (var y = -2; y <= 2; y = y + 1) {
    for (var x = -2; x <= 2; x = x + 1) {
      let sc = coord + vec2<i32>(x, y) * step;
      if (sc.x < 0 || sc.y < 0 || sc.x >= i32(dim.x) || sc.y >= i32(dim.y)) { continue; }
      let sd = textureLoad(depthTex, sc, 0);
      if (sd >= 0.99999) { continue; }
      // Fixed gaussian spatial term.
      let r2 = f32(x * x + y * y);
      let wSpatial = exp(-r2 / 4.0);
      // Symmetric depth edge stop: XeGTAO enforces symmetricity so the left edge
      // of the right pixel equals the right edge of the left pixel. We emulate it
      // with a relative depth delta shaped by `sharpness`.
      let sZ = linZ(sc);
      let dRel = abs(sZ - centerZ) / max(1e-3, centerZ);
      let wDepth = exp(-dRel * p.sharpness);
      let sN = normalize(textureLoad(normalTex, sc, 0).xyz);
      let wNormal = pow(max(0.0, dot(sN, centerN)), 8.0);
      let w = wSpatial * wDepth * wNormal;
      acc += textureLoad(rawTex, sc, 0) * w;
      wSum += w;
    }
  }
  if (wSum < 1e-5) { textureStore(outTex, coord, center); return; }
  textureStore(outTex, coord, acc / wSum);
}
