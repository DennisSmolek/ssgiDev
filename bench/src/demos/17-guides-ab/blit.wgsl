// Demo 17 — trivial copy compute. Copied verbatim from 10-denoise/blit.wgsl
// (demos 00-13 are frozen; this lab owns its copy). Bridges a ping-pong
// output (whichever slot is current this frame) into a STABLE StorageTexture
// the TSL display graph can sample without a per-frame graph rebuild.

@group(0) @binding(0) var inTex : texture_2d<f32>;
@group(0) @binding(1) var outTex : texture_storage_2d<rgba16float, write>;

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) gid : vec3<u32>) {
  let dim = textureDimensions(inTex);
  if (gid.x >= dim.x || gid.y >= dim.y) { return; }
  let coord = vec2<i32>(gid.xy);
  textureStore(outTex, coord, textureLoad(inTex, coord, 0));
}
