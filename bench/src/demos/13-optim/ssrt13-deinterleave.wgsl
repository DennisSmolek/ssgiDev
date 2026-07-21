// Demo 13 (optimization lab) — DEINTERLEAVE extract (P5.3, CACAO-style phase-bucket
// marching). The production heir to LSAO's coherence goal (Intel ASSAO → AMD
// FidelityFX CACAO): split the march-res grid into 4 (2×2) phase buckets and pack
// each bucket into its OWN compact (quarter-res) image, so the bucket's march
// dispatch touches only 1/4 of the depth/normal/light texels — neighbouring compact
// threads sample neighbouring world positions at the SAME phase, giving 4× tighter
// spatial fetch locality (the bandwidth thesis). This pass EXTRACTS one bucket:
//
//   compact texel (cx,cy)  <-  march-res texel (cx*2 + bx, cy*2 + by)
//
// where (bx,by) ∈ {0,1}² is the bucket. It is a stride-2 phase subsample of the
// march-res G-buffer (produced by ssrt13-downsample). The companion scatter pass
// (ssrt13-interleave.wgsl) reassembles the bucket's march output back to march res.
//
// Reorganizing WHERE fetches happen (not the estimator) keeps this bitmask-
// compatible; the residual difference vs the baseline half-res march is the per-
// bucket depth DECIMATION (each pixel effectively marches a quarter-res-of-full
// depth field) — documented, relaxed 1e-3 converged gate (variants.ts / run-13).

struct DIParams {
  marchRes : vec2<f32>,    // full march-res dims (source grid)
  compactRes : vec2<f32>,  // (ceil(marchW/2), ceil(marchH/2)) — this bucket's dims
  bucket : vec2<u32>,      // (bx, by) ∈ {0,1}²
  pad0 : f32,
  pad1 : f32,
};

@group(0) @binding(0) var srcDepth : texture_2d<f32>;  // r32float march-res depth
@group(0) @binding(1) var srcNormal : texture_2d<f32>; // march-res view normal
@group(0) @binding(2) var srcLight : texture_2d<f32>;  // march-res radiance source
@group(0) @binding(3) var outDepth : texture_storage_2d<r32float, write>;
@group(0) @binding(4) var outNormal : texture_storage_2d<rgba16float, write>;
@group(0) @binding(5) var outLight : texture_storage_2d<rgba16float, write>;
@group(0) @binding(6) var<uniform> p : DIParams;

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) gid : vec3<u32>) {
  let cdim = vec2<u32>(u32(p.compactRes.x), u32(p.compactRes.y));
  if (gid.x >= cdim.x || gid.y >= cdim.y) { return; }

  // Phase-subsample: compact (cx,cy) gathers the march-res texel at 2× stride,
  // offset by this bucket's phase. Clamp guards the odd-dimension right/bottom edge.
  let src = vec2<i32>(gid.xy) * 2 + vec2<i32>(i32(p.bucket.x), i32(p.bucket.y));
  let m = vec2<i32>(i32(p.marchRes.x), i32(p.marchRes.y));
  let c = clamp(src, vec2<i32>(0), m - vec2<i32>(1));
  let coord = vec2<i32>(gid.xy);

  textureStore(outDepth, coord, vec4<f32>(textureLoad(srcDepth, c, 0).r, 0.0, 0.0, 0.0));
  textureStore(outNormal, coord, vec4<f32>(textureLoad(srcNormal, c, 0).xyz, 1.0));
  textureStore(outLight, coord, vec4<f32>(textureLoad(srcLight, c, 0).rgb, 1.0));
}
