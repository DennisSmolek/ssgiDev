// Demo 14 — variance estimate. SVGF-SPEC §2 pass chain, step 5.
// Var = E[x^2] - E[x]^2 from the temporal moments (svgf-temporal-moments.wgsl).
// Where the per-pixel history length N is below `nMin`, that temporal estimate
// is unreliable (too few samples), so this pass blends toward a SPATIAL
// estimate instead: the FSR3 MomentsPass `coarseMoments` (4x4 block means)
// dispatched on the demodulated irradiance directly (this frame's raw signal,
// not the temporally-smoothed one) — the addendum §B fallback.
//
// Deviation from a hard branch (spec text reads as an if/else at N<nMin): a
// straight select() pops visibly at the N==nMin boundary as pixels cross it
// frame to frame, so this smoothly ramps temporal-vs-spatial weight over
// [0, nMin] instead. At N=0 it is 100% spatial (matches "use spatial
// fallback"); by N>=nMin it is 100% temporal (matches the un-blended
// baseline). Documented simplification, not a spec violation.
//
// varianceBoostFromReactive: SVGF-SPEC config knob. Wired live via the shared
// TemporalGuidesPass's `reactiveTexture` (trivial: it's just another texture
// binding) — variance is boosted where the app/effect reactive mask fires,
// so a fast-changing signal doesn't get treated as falsely low-variance.
// NOTE: nothing in this demo currently WRITES into guides.reactive (SVGF is a
// reactive *producer* too per FSR3-BRIEF addendum §D, but that write-back loop
// is out of scope here — see README), so in practice this mask reads 0
// everywhere and the knob is inert today. The multiply is real, not a TODO
// stub, so it activates for free the moment any consumer starts writing
// guides.reactive.

struct VParams {
  resolution : vec2<f32>,
  nMin : f32,
  varianceBoost : f32,
};

@group(0) @binding(0) var momentsTex : texture_2d<f32>;       // temporal (E[x], E[x^2]) in .rg
@group(0) @binding(1) var historyLenTex : texture_2d<f32>;    // guides: N
@group(0) @binding(2) var coarseMomentsTex : texture_2d<f32>; // MomentsPass.coarseMoments, ceil(res/4)
@group(0) @binding(3) var reactiveTex : texture_2d<f32>;      // guides: reactive mask (r8unorm)
@group(0) @binding(4) var outVarianceTex : texture_storage_2d<r16float, write>;
@group(0) @binding(5) var<uniform> p : VParams;

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) gid : vec3<u32>) {
  let dim = vec2<u32>(u32(p.resolution.x), u32(p.resolution.y));
  if (gid.x >= dim.x || gid.y >= dim.y) { return; }
  let coord = vec2<i32>(gid.xy);

  let m = textureLoad(momentsTex, coord, 0).rg;
  let temporalVar = max(0.0, m.y - m.x * m.x);

  let coarseDim = vec2<i32>(textureDimensions(coarseMomentsTex));
  let coarseCoord = clamp(coord / 4, vec2<i32>(0), coarseDim - vec2<i32>(1));
  let cm = textureLoad(coarseMomentsTex, coarseCoord, 0).rg;
  let spatialVar = max(0.0, cm.y - cm.x * cm.x);

  let N = textureLoad(historyLenTex, coord, 0).r;
  let t = clamp(N / max(1.0, p.nMin), 0.0, 1.0);
  var variance = mix(spatialVar, temporalVar, t);

  let reactive = textureLoad(reactiveTex, coord, 0).r;
  variance = variance * (1.0 + p.varianceBoost * reactive);

  textureStore(outVarianceTex, coord, vec4<f32>(variance, 0.0, 0.0, 0.0));
}
