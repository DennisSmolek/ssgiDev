// Demo 18 (temporal lab) — FORK of demo 12 (ssrt12-temporal). Demo 12 stays
// frozen; this fork is the temporal-accumulation experiment bed.
// Demo 03 stage (d) — temporal reprojection — extended with:
//
// ACCUMULATION MODES (accumMode):
//   capped   (0): demo 12's shipped behavior. Per-pixel frame counter N capped
//                 at accumFrameCap -> blendWeight = 1/min(N, cap), i.e. an EMA
//                 floor: the last `cap` frames always carry 1/cap weight each,
//                 so residual noise never drops below sigma/sqrt(cap). Soft
//                 4-neighborhood clamp (mix 0.25) kept — part of the frozen
//                 behavior being diagnosed.
//   oneOverN (1): true alpha = 1/N accumulation. N grows WITHOUT cap (stored in
//                 an r32float counter — f32 increments stay exact to 2^24; the
//                 old r16float channel would stall at 2048) and NO history clamp
//                 is applied (any clamp against the current noisy frame
//                 re-injects that frame's noise -> floor). On a still camera the
//                 mean converges toward zero residual. Disocclusion / off-screen
//                 / reset restarts N at 1 exactly like the capped path.
//
// AA MODES (aaMode):
//   off         (0): no camera jitter (demo 12 behavior).
//   jitter      (1): Halton(2,3) sub-pixel camera jitter is active (applied CPU-
//                 side via camera.setViewOffset). three's velocity node includes
//                 the jitter delta (it tracks the previous PROJECTION matrix),
//                 so per-pixel TRUE motion = velocityUV - jitterDeltaUV. Pixels
//                 whose true motion is sub-pixel take the STILL path: history is
//                 read at THIS texel and accepted unconditionally — at geometry
//                 edges the depth flip IS the sub-pixel coverage being
//                 integrated, and running the world-delta reject there resets N
//                 every frame (rolling accumAge, permanent shimmer — the demo-14
//                 jitter bug). Moving pixels fall through to the normal
//                 reproject + world-delta reject path.
//   jitterClamp (2): jitter + classic TAA 3x3 neighborhood min/max clamp of the
//                 reprojected history before blending. NOTE: the clamp
//                 INTENTIONALLY reintroduces a noise floor — clamping history
//                 into the current noisy frame's neighborhood bounds re-injects
//                 per-frame noise every frame. This arm exists to MEASURE that
//                 trade-off (ghosting control vs convergence), not to win it.
//
// BEAUTY/ALBEDO ACCUMULATION: with camera jitter the raw G-buffer beauty and
// albedo shimmer at every edge, which would swamp the converged GI/AO in the
// composite. The same blend (same N) therefore also accumulates beauty + albedo
// into their own history pairs; the composite reads the accumulated versions,
// so edges genuinely anti-alias as N grows. With aaMode == off both pass
// through untouched (demo 12 parity). On moving (non-still) pixels their blend
// weight is floored at 0.5 — beauty/albedo are clean signals that need slow AA
// integration only on stills; a fast response bounds ghost trails under motion.
//
// three velocity convention: velocity = ndcCurrent - ndcPrevious. UV reprojection
// (matches TRAANode): prevUV = uv - velocity.xy * vec2(0.5, -0.5). World
// reconstruction uses invViewProj (= camera.matrixWorld * projInverse) with
// WebGPU clip (ndc.y = 1 - 2*uv.y, clip z = depth in [0,1]). prevDepthTex is a
// real previous-depth copy (ssrt18-copydepth.wgsl, refreshed AFTER this pass).

struct TParams {
  invViewProj : mat4x4<f32>,
  prevInvViewProj : mat4x4<f32>,
  resolution : vec2<f32>,
  near : f32,
  far : f32,
  flags : u32,          // bit0 enabled, bit1 reset
  accumMode : u32,      // 0 capped (demo 12 behavior), 1 oneOverN
  aaMode : u32,         // 0 off, 1 jitter, 2 jitterClamp
  accumFrameCap : f32,  // capped mode: max effective history length
  jitterDeltaUV : vec2<f32>, // (jitterCurUV - jitterPrevUV): velocity component due to jitter alone
  pad0 : f32,
  pad1 : f32,
};

@group(0) @binding(0) var curTex : texture_2d<f32>;       // this frame's raw GI/AO
@group(0) @binding(1) var histTex : texture_2d<f32>;      // previous resolved GI/AO
@group(0) @binding(2) var velTex : texture_2d<f32>;       // velocity (NDC delta, includes jitter)
@group(0) @binding(3) var depthTex : texture_depth_2d;    // current depth
@group(0) @binding(4) var prevDepthTex : texture_2d<f32>; // real previous depth (r32float copy)
@group(0) @binding(5) var countHistTex : texture_2d<f32>; // previous frame-count N (r32float)
@group(0) @binding(6) var beautyTex : texture_2d<f32>;    // this frame's raw beauty (jittered)
@group(0) @binding(7) var beautyHistTex : texture_2d<f32>;// previous accumulated beauty
@group(0) @binding(8) var albedoTex : texture_2d<f32>;    // this frame's raw albedo (jittered)
@group(0) @binding(9) var albedoHistTex : texture_2d<f32>;// previous accumulated albedo
@group(0) @binding(10) var outTex : texture_storage_2d<rgba16float, write>;
@group(0) @binding(11) var countOutTex : texture_storage_2d<r32float, write>;
@group(0) @binding(12) var beautyOutTex : texture_storage_2d<rgba16float, write>;
@group(0) @binding(13) var albedoOutTex : texture_storage_2d<rgba16float, write>;
@group(0) @binding(14) var<uniform> p : TParams;

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
  let curBeauty = textureLoad(beautyTex, coord, 0);
  let curAlbedo = textureLoad(albedoTex, coord, 0);

  let enabled = (p.flags & 1u) != 0u;
  let reset = (p.flags & 2u) != 0u;
  let aaOn = p.aaMode != 0u;

  // Disabled or reset: no history to trust -> emit current, restart the counter.
  if (!enabled || reset) {
    textureStore(outTex, coord, current);
    textureStore(countOutTex, coord, vec4<f32>(1.0, 0.0, 0.0, 0.0));
    textureStore(beautyOutTex, coord, curBeauty);
    textureStore(albedoOutTex, coord, curAlbedo);
    return;
  }

  let vel = textureLoad(velTex, coord, 0).xy;
  let velUV = vel * vec2<f32>(0.5, -0.5);           // uvCur - uvPrev (incl. jitter)
  let reprojUV = uv - velUV;

  // True (unjittered) per-pixel motion in pixels. With aaMode off jitterDeltaUV
  // is zero, so this degenerates to the raw velocity magnitude.
  let trueMotionPx = length((velUV - p.jitterDeltaUV) * p.resolution);
  // STILL path (jitter modes only): camera + surface static, motion is jitter
  // raster shift alone -> history lives at THIS texel; accept unconditionally
  // (see header — running the world-delta reject here is the demo-14 bug).
  let stillPixel = aaOn && trueMotionPx < 0.75;

  var reprojCoord = coord;
  var disocclusion = false;
  if (!stillPixel) {
    // Off-screen history -> disocclusion: keep current, restart the counter.
    if (reprojUV.x < 0.0 || reprojUV.y < 0.0 || reprojUV.x > 1.0 || reprojUV.y > 1.0) {
      textureStore(outTex, coord, current);
      textureStore(countOutTex, coord, vec4<f32>(1.0, 0.0, 0.0, 0.0));
      textureStore(beautyOutTex, coord, curBeauty);
      textureStore(albedoOutTex, coord, curAlbedo);
      return;
    }
    reprojCoord = vec2<i32>(floor(reprojUV * p.resolution));

    let d = depthAt(coord);
    let dPrev = prevDepthAt(reprojCoord);
    let curWorld = worldFromUV(p.invViewProj, uv, d);
    let prevWorld = worldFromUV(p.prevInvViewProj, reprojUV, dPrev);

    let posSimilarity = clamp(1.0 - distance(prevWorld, curWorld), 0.0, 1.0);
    // Under jitter the nearest-texel prev-depth fetch carries up to a texel of
    // sub-pixel reconstruction error — widen the reject threshold slightly so
    // slow camera drift does not mass-reject valid history (0.5 -> 0.35).
    let rejectBelow = select(0.5, 0.35, aaOn);
    disocclusion = posSimilarity < rejectBelow;
  }

  // Frame counter: grow while history is valid, restart on disocclusion.
  // capped mode min()s against accumFrameCap (the EMA floor being diagnosed);
  // oneOverN grows unbounded -> true 1/N convergence.
  let prevN = loadClamped(countHistTex, reprojCoord).x;
  var N : f32;
  if (disocclusion) {
    N = 1.0;
  } else if (p.accumMode == 0u) {
    N = min(prevN + 1.0, p.accumFrameCap);
  } else {
    N = prevN + 1.0;
  }
  let blendWeight = 1.0 / N;

  var prevGI = loadClamped(histTex, reprojCoord);

  if (p.accumMode == 0u) {
    // capped (demo 12): soft clamp of history to the current 4-neighborhood
    // corners (mix 0.25) — kept verbatim as part of the frozen control arm.
    var mn = loadClamped(curTex, coord + vec2<i32>(1, 1));
    var mx = mn;
    var s = loadClamped(curTex, coord + vec2<i32>(1, -1)); mn = min(mn, s); mx = max(mx, s);
    s = loadClamped(curTex, coord + vec2<i32>(-1, 1)); mn = min(mn, s); mx = max(mx, s);
    s = loadClamped(curTex, coord + vec2<i32>(-1, -1)); mn = min(mn, s); mx = max(mx, s);
    prevGI = mix(prevGI, clamp(prevGI, mn, mx), 0.25);
  }
  if (p.aaMode == 2u) {
    // jitterClamp: classic TAA hard 3x3 min/max clamp. Intentional noise floor
    // (see header) — the measured trade-off this arm exists for.
    var mn3 = current;
    var mx3 = current;
    for (var dy = -1; dy <= 1; dy = dy + 1) {
      for (var dx = -1; dx <= 1; dx = dx + 1) {
        if (dx == 0 && dy == 0) { continue; }
        let s3 = loadClamped(curTex, coord + vec2<i32>(dx, dy));
        mn3 = min(mn3, s3);
        mx3 = max(mx3, s3);
      }
    }
    prevGI = clamp(prevGI, mn3, mx3);
  }

  let result = mix(prevGI, current, blendWeight);
  textureStore(outTex, coord, result);
  textureStore(countOutTex, coord, vec4<f32>(N, 0.0, 0.0, 0.0));

  // Beauty/albedo AA accumulation (jitter modes; pass-through when aa off).
  if (aaOn) {
    // Moving pixels: floor the response at 0.5 (clean signal, ghost control).
    let bw = select(max(blendWeight, 0.5), blendWeight, stillPixel);
    let prevBeauty = loadClamped(beautyHistTex, reprojCoord);
    let prevAlbedo = loadClamped(albedoHistTex, reprojCoord);
    textureStore(beautyOutTex, coord, mix(prevBeauty, curBeauty, bw));
    textureStore(albedoOutTex, coord, mix(prevAlbedo, curAlbedo, bw));
  } else {
    textureStore(beautyOutTex, coord, curBeauty);
    textureStore(albedoOutTex, coord, curAlbedo);
  }
}
