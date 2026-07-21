// Demo 13 (optimization lab) — INTERLEAVE scatter (P5.3, CACAO-style phase-bucket
// marching). Companion to ssrt13-deinterleave.wgsl: after a bucket's compact march,
// scatter its output back to the march-res grid at the bucket's phase positions:
//
//   march-res texel (cx*2 + bx, cy*2 + by)  <-  compact texel (cx,cy)
//
// Run once per bucket; after all 4 buckets the march-res marchOut / marchBent are
// fully repopulated (the 4 phases tile the grid disjointly), then the normal
// upsample/temporal/denoise chain proceeds unchanged. Reorganizes only WHERE the
// results land, so the downstream chain is untouched (bitmask-compatible).

struct DIParams {
  compactRes : vec2<f32>, // this bucket's compact dims (source)
  bucket : vec2<u32>,     // (bx, by) ∈ {0,1}²
  marchRes : vec2<f32>,   // full march-res dims (destination grid)
  pad0 : f32,
  pad1 : f32,
};

@group(0) @binding(0) var srcOut : texture_2d<f32>;  // compact march output (rgba16: rgb GI, a AO)
@group(0) @binding(1) var srcBent : texture_2d<f32>; // compact bent normal (xyz + cone)
@group(0) @binding(2) var outGiao : texture_storage_2d<rgba16float, write>; // marchOut
@group(0) @binding(3) var outBent : texture_storage_2d<rgba16float, write>; // marchBent
@group(0) @binding(4) var<uniform> p : DIParams;

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) gid : vec3<u32>) {
  let cdim = vec2<u32>(u32(p.compactRes.x), u32(p.compactRes.y));
  if (gid.x >= cdim.x || gid.y >= cdim.y) { return; }

  let dst = vec2<i32>(gid.xy) * 2 + vec2<i32>(i32(p.bucket.x), i32(p.bucket.y));
  let m = vec2<i32>(i32(p.marchRes.x), i32(p.marchRes.y));
  if (dst.x >= m.x || dst.y >= m.y) { return; } // odd-dimension right/bottom edge
  let coord = vec2<i32>(gid.xy);

  textureStore(outGiao, dst, textureLoad(srcOut, coord, 0));
  textureStore(outBent, dst, textureLoad(srcBent, coord, 0));
}
