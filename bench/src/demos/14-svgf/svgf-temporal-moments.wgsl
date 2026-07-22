// Demo 14 — temporal + moments. SVGF-SPEC §2 pass chain, step 4 (fork of demo
// 10's `ssrt3-guides-temporal.wgsl`, extended with 2 moment channels and a
// DIFFERENT blend rule).
//
// Deviation from the ssrt3-guides-temporal ema fork (documented, per the task
// brief item 5): that fork mixes with a FIXED `temporalResponse` graded by
// disocclusion (`mix(temporalResponse, 1.0, disocc)`). This pass instead
// consumes the guides' per-pixel history length N directly for a classic SVGF
// exponential-moving-average alpha: `alpha = max(alphaMin, 1/N)` — history
// dominates while N is large, the newest sample dominates while N is small.
// Disocclusion still gates full history invalidation (>= historyRejectThresh
// or off-screen reprojection => treat as N=1, alpha=1, moments reset to the
// current single-sample estimate) — same disocclusion source as demo 10, just
// a different consumption rule downstream of it.
//
// Colour history source is chosen by the HOST, not this shader: the caller
// binds either last frame's own output (raw temporal result) or last frame's
// à-trous first-iteration output (the SVGF-paper "tighter" feedback, atrousFeedback
// knob, SVGF-SPEC §8.2) as `histTex` — the shader is unaware of the difference,
// it only knows "the previous frame's resolved (irr, ao)".
//
// Moments track SCALAR luminance of irr (momentsSpace: linear Rec.709 luma, or
// YCoCg-Y) — SVGF-SPEC §8 decision 1. Var = E[x^2] - E[x]^2 is NOT computed
// here (svgf-variance.wgsl owns that + the short-history spatial fallback);
// this pass only maintains the two accumulated moment channels.

struct TParams {
  resolution : vec2<f32>,
  alphaMin : f32,
  historyRejectThresh : f32, // disocclusion >= this => history invalid this frame
  flags : u32,               // bit0 enabled, bit1 reset, bit2 ycocg moments space
  pad0 : f32,
  pad1 : f32,
  pad2 : f32,
};

@group(0) @binding(0) var curIrrAoTex : texture_2d<f32>;    // this frame's demodulated (irr, ao)
@group(0) @binding(1) var histIrrAoTex : texture_2d<f32>;   // previous resolved (irr, ao) — host-selected source
@group(0) @binding(2) var histMomentsTex : texture_2d<f32>; // previous (E[x], E[x^2]) in .rg
@group(0) @binding(3) var dilatedVelTex : texture_2d<f32>;  // guides: closest-depth dilated velocity
@group(0) @binding(4) var disoccTex : texture_2d<f32>;      // guides: graded disocclusion 0..1
@group(0) @binding(5) var historyLenTex : texture_2d<f32>;  // guides: per-pixel history length N
@group(0) @binding(6) var outIrrAoTex : texture_storage_2d<rgba16float, write>;
@group(0) @binding(7) var outMomentsTex : texture_storage_2d<rgba16float, write>;
@group(0) @binding(8) var<uniform> p : TParams;

fn loadClamped(t : texture_2d<f32>, coord : vec2<i32>) -> vec4<f32> {
  let c = clamp(coord, vec2<i32>(0), vec2<i32>(p.resolution) - vec2<i32>(1));
  return textureLoad(t, c, 0);
}

fn scalarOf(c : vec3<f32>, ycocg : bool) -> f32 {
  if (ycocg) {
    return (c.r + 2.0 * c.g + c.b) * 0.25; // YCoCg Y — matches the MomentsPass convention
  }
  return dot(c, vec3<f32>(0.2126, 0.7152, 0.0722)); // Rec.709 luma
}

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) gid : vec3<u32>) {
  let dim = vec2<u32>(u32(p.resolution.x), u32(p.resolution.y));
  if (gid.x >= dim.x || gid.y >= dim.y) { return; }
  let coord = vec2<i32>(gid.xy);
  let uv = (vec2<f32>(gid.xy) + 0.5) / p.resolution;

  let current = textureLoad(curIrrAoTex, coord, 0);
  let ycocg = (p.flags & 4u) != 0u;
  let curLum = scalarOf(current.rgb, ycocg);

  let enabled = (p.flags & 1u) != 0u;
  let reset = (p.flags & 2u) != 0u;
  if (!enabled || reset) {
    textureStore(outIrrAoTex, coord, current);
    textureStore(outMomentsTex, coord, vec4<f32>(curLum, curLum * curLum, 0.0, 0.0));
    return;
  }

  let vel = textureLoad(dilatedVelTex, coord, 0).xy;
  let reprojUV = uv - vel * vec2<f32>(0.5, -0.5);
  let onScreen = reprojUV.x >= 0.0 && reprojUV.y >= 0.0 && reprojUV.x <= 1.0 && reprojUV.y <= 1.0;
  let disocc = textureLoad(disoccTex, coord, 0).r;
  let historyValid = onScreen && disocc < p.historyRejectThresh;

  if (!historyValid) {
    textureStore(outIrrAoTex, coord, current);
    textureStore(outMomentsTex, coord, vec4<f32>(curLum, curLum * curLum, 0.0, 0.0));
    return;
  }

  let reprojCoord = vec2<i32>(floor(reprojUV * p.resolution));
  let N = max(1.0, textureLoad(historyLenTex, coord, 0).r);
  let alpha = max(p.alphaMin, 1.0 / N);

  // Neighborhood clamp of history colour to the current 4-neighbourhood
  // (reduces ghosting on the colour channel — same shape as the ema fork).
  var mn = loadClamped(curIrrAoTex, coord + vec2<i32>(1, 1));
  var mx = mn;
  var s = loadClamped(curIrrAoTex, coord + vec2<i32>(1, -1)); mn = min(mn, s); mx = max(mx, s);
  s = loadClamped(curIrrAoTex, coord + vec2<i32>(-1, 1)); mn = min(mn, s); mx = max(mx, s);
  s = loadClamped(curIrrAoTex, coord + vec2<i32>(-1, -1)); mn = min(mn, s); mx = max(mx, s);

  var histColor = loadClamped(histIrrAoTex, reprojCoord);
  histColor = mix(histColor, clamp(histColor, mn, mx), 0.25);
  let colorOut = mix(histColor, current, alpha);

  let histMoments = loadClamped(histMomentsTex, reprojCoord).rg;
  let momentsOut = mix(histMoments, vec2<f32>(curLum, curLum * curLum), alpha);

  textureStore(outIrrAoTex, coord, colorOut);
  textureStore(outMomentsTex, coord, vec4<f32>(momentsOut, 0.0, 0.0));
}
