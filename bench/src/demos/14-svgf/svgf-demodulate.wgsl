// Demo 14 — demodulate. SVGF-SPEC §2 pass chain, step 3.
// irr = rawGI / max(albedo, eps). AO (alpha) is NOT albedo-modulated (matches
// the demo 03/10 composite convention: beauty*AO + albedo*GI), so it passes
// through unchanged in the alpha channel — every downstream svgf pass carries
// (irr.rgb, ao) as one rgba16float texture rather than two.
// Dividing out the CURRENT pixel's own albedo before filtering is the whole
// point of the demodulate/remodulate bracket (SVGF-SPEC §2, H4): a textured
// surface's albedo pattern would otherwise get filtered together with the
// noise, blurring texture detail. remodulate multiplies the same albedo back
// after the à-trous chain, so the round trip is a no-op in signal space, only
// changing what the filter kernel actually sees in between.

struct Params {
  resolution : vec2<f32>,
  epsilon : f32,
  pad0 : f32,
};

@group(0) @binding(0) var rawTex : texture_2d<f32>;    // rgb = GI (indirect radiance), a = AO
@group(0) @binding(1) var albedoTex : texture_2d<f32>; // this pixel's own surface albedo
@group(0) @binding(2) var outTex : texture_storage_2d<rgba16float, write>;
@group(0) @binding(3) var<uniform> p : Params;

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) gid : vec3<u32>) {
  let dim = vec2<u32>(u32(p.resolution.x), u32(p.resolution.y));
  if (gid.x >= dim.x || gid.y >= dim.y) { return; }
  let coord = vec2<i32>(gid.xy);

  let raw = textureLoad(rawTex, coord, 0);
  let albedo = textureLoad(albedoTex, coord, 0).rgb;
  let irr = raw.rgb / max(albedo, vec3<f32>(p.epsilon));
  textureStore(outTex, coord, vec4<f32>(irr, raw.a));
}
