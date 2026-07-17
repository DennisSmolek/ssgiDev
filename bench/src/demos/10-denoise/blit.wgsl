// Demo 10 — trivial copy compute. Bridges a ping-pong stack output (whichever
// slot is current this frame, rebound per-execute) into a STABLE StorageTexture
// the TSL display graph can sample without a per-frame graph rebuild (same
// ping-pong -> stable bridge demo 06 does with its compose pass).

@group(0) @binding(0) var inTex : texture_2d<f32>;
@group(0) @binding(1) var outTex : texture_storage_2d<rgba16float, write>;

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) gid : vec3<u32>) {
  let dim = textureDimensions(inTex);
  if (gid.x >= dim.x || gid.y >= dim.y) { return; }
  let coord = vec2<i32>(gid.xy);
  textureStore(outTex, coord, textureLoad(inTex, coord, 0));
}
