// Lab 10 `ssrt3-guides` stack — guides-fed fork of ssrt3-temporal-ema.wgsl.
//
// This is the FSR3-BRIEF acceptance test (NEXTGEN P2): the ONLY difference from
// the frozen SSRT3 EMA temporal (ssrt3-temporal-ema.wgsl) is where history
// validity comes from. Everything else — the 4-neighbourhood clamp, the 0.25
// clamp-blend, `temporalResponse`, the final mix — is byte-for-byte identical,
// so any A/B delta isolates the shared TemporalGuidesPass vs the EMA fork's own
// private world-position test.
//
// EXACT SUBSTITUTION (private world-pos reject  ->  temporal guides):
//   ema fork:
//     vel        = textureLoad(velTex, coord).xy            // per-pixel MV
//     reprojUV   = uv - vel * vec2(0.5, -0.5)
//     curWorld   = worldFromUV(invViewProj,     uv,       depthAt(coord))
//     prevWorld  = worldFromUV(prevInvViewProj, reprojUV, depthAt(reprojCoord))
//     posSim     = clamp(1 - distance(prevWorld, curWorld), 0, 1)
//     blendWeight= mix(1.0, temporalResponse, posSim)
//   guides fork (this file):
//     vel        = textureLoad(dilatedVelTex, coord).xy     // closest-depth DILATED MV
//     reprojUV   = uv - vel * vec2(0.5, -0.5)               // SAME reprojection form
//     disocc     = textureLoad(disoccTex, coord).r          // GRADED 0..1, precomputed
//     blendWeight= mix(temporalResponse, 1.0, disocc)
//
// The two blendWeights are equivalent by construction: the ema fork's posSim is
// exactly (1 - disocclusion), so mix(1, tR, posSim) == mix(tR, 1, disocc). Thus
// `temporalResponse` semantics are preserved; the guides only change HOW the
// disocclusion (and the motion vector used to fetch history) is computed —
// closest-depth-dilated + depth-reprojection graded, shared across all effects,
// instead of re-derived per pixel from full world-space matrices here.
//
// three velocity convention unchanged: prevUV = uv - vel.xy * vec2(0.5, -0.5).
// The uniform block is kept identical to the ema fork (same TParams, same host
// fill code) so the wiring difference is only the two swapped texture bindings;
// invViewProj / prevInvViewProj / near / far are now unused (the guides already
// consumed depth) but remain in the layout to keep the A/B host code shared.

struct TParams {
  invViewProj : mat4x4<f32>,      // unused (kept for layout parity with ema fork)
  prevInvViewProj : mat4x4<f32>,  // unused
  resolution : vec2<f32>,
  near : f32,                     // unused
  far : f32,                      // unused
  temporalResponse : f32,
  flags : u32,                    // bit0 enabled, bit1 reset
  pad0 : f32,
  pad1 : f32,
};

@group(0) @binding(0) var curTex : texture_2d<f32>;         // this frame's raw GI/AO
@group(0) @binding(1) var histTex : texture_2d<f32>;        // previous resolved GI/AO
@group(0) @binding(2) var dilatedVelTex : texture_2d<f32>;  // guides: closest-depth dilated velocity
@group(0) @binding(3) var disoccTex : texture_2d<f32>;      // guides: graded disocclusion 0..1
@group(0) @binding(4) var outTex : texture_storage_2d<rgba16float, write>;
@group(0) @binding(5) var<uniform> p : TParams;

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

  // --- guides substitution: dilated MV + precomputed graded disocclusion ---
  let vel = textureLoad(dilatedVelTex, coord, 0).xy;
  let offsetUV = vel * vec2<f32>(0.5, -0.5);
  let reprojUV = uv - offsetUV;

  // Off-screen history -> keep current.
  if (reprojUV.x < 0.0 || reprojUV.y < 0.0 || reprojUV.x > 1.0 || reprojUV.y > 1.0) {
    textureStore(outTex, coord, current);
    return;
  }

  let reprojCoord = vec2<i32>(floor(reprojUV * p.resolution));

  let disocc = textureLoad(disoccTex, coord, 0).r;
  // Equivalent to the ema fork's mix(1.0, temporalResponse, posSimilarity) with
  // posSimilarity == 1 - disocclusion. temporalResponse semantics identical.
  let blendWeight = mix(p.temporalResponse, 1.0, clamp(disocc, 0.0, 1.0));

  // --- identical to the ema fork below this line ---
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
