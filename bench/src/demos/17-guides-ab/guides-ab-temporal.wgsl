// Demo 17 — guides-ab-temporal.wgsl. Fork of demo 10's
// `ssrt3-guides-temporal.wgsl` (which is itself a fork of the frozen SSRT3 EMA
// temporal, `10-denoise/ssrt3-temporal-ema.wgsl`). This is the M6 exit-criterion
// rig for the FSR3-BRIEF decomposition: the SAME temporal reprojection/blend
// logic fed by EITHER of two guide sources, selected per-dispatch by the host:
//
//   A) the bench's private `TemporalGuidesPass` (harness/temporal-guides.ts)
//   B) the FSR3 upscaler's guides bundle (`upscaler.guides`, @pmndrs/upscaler)
//
// ONE addition versus the demo-10 fork: the `motionIsUVDelta` flag (bit 2 of
// `p.flags`), because the two guide sources disagree on velocity convention:
//
//   - TemporalGuidesPass.dilatedVelocityTexture is an NDC delta (matches three's
//     raw `velocity` MRT channel) — reprojection scales it by (0.5, -0.5) to
//     turn it into a UV delta, same as every other temporal pass in this repo.
//   - upscaler.guides.dilatedMotion is ALREADY a UV delta with the y-flip baked
//     in (GUIDES-HANDOFF.md: "`.xy` is a UV delta ... `prevUV = uv - motion`") —
//     scaling it again would double-apply the flip and corrupt reprojection.
//
// `p.flags` bit0 enabled, bit1 reset (unchanged from the demo-10 fork), bit2
// motionIsUVDelta: 0 => NDC-delta convention (existing `vel * vec2(0.5,-0.5)`
// math, side A), 1 => `offsetUV = vel` directly (side B). Everything else is
// byte-for-byte identical to the demo-10 fork — same TParams layout, same
// 4-neighbourhood history clamp, same 0.25 clamp-blend, same
// `blendWeight = mix(temporalResponse, 1.0, disocclusion)` substitution — so any
// A/B delta between the two arms isolates the guide PRODUCTS (which pass wrote
// dilatedVelTex/disoccTex), not shader drift between the arms.
//
// disoccTex polarity matches on both sides: TemporalGuidesPass's graded
// disocclusion (r16float, 0 stable..1 fresh) and upscaler.guides.disocclusion
// (rgba8unorm `.r`, same 0..1 grading, GUIDES-HANDOFF.md) are read identically
// here — no per-side branching needed for that channel.

struct TParams {
  invViewProj : mat4x4<f32>,      // unused (kept for host-code layout parity)
  prevInvViewProj : mat4x4<f32>,  // unused
  resolution : vec2<f32>,
  near : f32,                     // unused
  far : f32,                      // unused
  temporalResponse : f32,
  flags : u32,                    // bit0 enabled, bit1 reset, bit2 motionIsUVDelta
  pad0 : f32,
  pad1 : f32,
};

@group(0) @binding(0) var curTex : texture_2d<f32>;         // this frame's raw GI/AO
@group(0) @binding(1) var histTex : texture_2d<f32>;        // previous resolved GI/AO
@group(0) @binding(2) var dilatedVelTex : texture_2d<f32>;  // guides: dilated velocity (NDC or UV delta, see flag)
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
  let motionIsUVDelta = (p.flags & 4u) != 0u;
  var offsetUV : vec2<f32>;
  if (motionIsUVDelta) {
    // Side B (FSR3 upscaler): already a UV delta, y-flip applied. Scaling it
    // again would double the flip — use it as-is.
    offsetUV = vel;
  } else {
    // Side A (private TemporalGuidesPass): NDC delta, three's convention.
    offsetUV = vel * vec2<f32>(0.5, -0.5);
  }
  let reprojUV = uv - offsetUV;

  // Off-screen history -> keep current.
  if (reprojUV.x < 0.0 || reprojUV.y < 0.0 || reprojUV.x > 1.0 || reprojUV.y > 1.0) {
    textureStore(outTex, coord, current);
    return;
  }

  let reprojCoord = vec2<i32>(floor(reprojUV * p.resolution));

  let disocc = textureLoad(disoccTex, coord, 0).r;
  let blendWeight = mix(p.temporalResponse, 1.0, clamp(disocc, 0.0, 1.0));

  // --- identical to the demo-10 fork below this line ---
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
