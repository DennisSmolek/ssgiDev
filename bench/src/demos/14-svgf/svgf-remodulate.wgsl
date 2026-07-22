// Demo 14 — remodulate. SVGF-SPEC §2 pass chain, step 7: outGI = irrFiltered *
// albedo. Closes the demodulate bracket (svgf-demodulate.wgsl) — multiplying
// back the SAME per-pixel albedo that was divided out puts the result back in
// the same "pre-self-albedo GI" space the raw producer and every other arm's
// output lives in, so it drops into the shared combined-view composite
// (beauty*AO + albedo*GI) unchanged. AO passes through (never demodulated).

struct Params {
  resolution : vec2<f32>,
  pad0 : f32,
  pad1 : f32,
};

@group(0) @binding(0) var irrAoTex : texture_2d<f32>;  // filtered (irr, ao)
@group(0) @binding(1) var albedoTex : texture_2d<f32>;
@group(0) @binding(2) var outTex : texture_storage_2d<rgba16float, write>;
@group(0) @binding(3) var<uniform> p : Params;

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) gid : vec3<u32>) {
  let dim = vec2<u32>(u32(p.resolution.x), u32(p.resolution.y));
  if (gid.x >= dim.x || gid.y >= dim.y) { return; }
  let coord = vec2<i32>(gid.xy);

  let irrAo = textureLoad(irrAoTex, coord, 0);
  let albedo = textureLoad(albedoTex, coord, 0).rgb;
  textureStore(outTex, coord, vec4<f32>(irrAo.rgb * albedo, irrAo.a));
}
