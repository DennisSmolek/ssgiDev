// Demo 06 — SSHGI — G-buffer copy for next-frame reprojection (Mathis Buffer D).
//
// Stores this frame's linear view depth + view normal so the NEXT frame's source
// and accum passes can validate a velocity-reprojected history sample (depth +
// normal disocclusion rejection). Only meaningful when reprojectMode == 1; cheap
// enough to always run.

struct Params {
  resolution : vec2<f32>,
  near : f32,
  far : f32,
};

@group(0) @binding(0) var depthTex : texture_depth_2d;
@group(0) @binding(1) var normalTex : texture_2d<f32>;
@group(0) @binding(2) var<uniform> params : Params;

struct VOut { @builtin(position) pos : vec4<f32> };

@vertex
fn vs(@builtin(vertex_index) vid : u32) -> VOut {
  var verts = array<vec2<f32>, 3>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>( 3.0, -1.0),
    vec2<f32>(-1.0,  3.0),
  );
  var out : VOut;
  out.pos = vec4<f32>(verts[vid], 0.0, 1.0);
  return out;
}

@fragment
fn fs(in : VOut) -> @location(0) vec4<f32> {
  let coord = vec2<i32>(floor(in.pos.xy));
  let d = textureLoad(depthTex, coord, 0);
  let n = params.near;
  let f = params.far;
  let linZ = (n * f) / (f - d * (f - n));
  let N = normalize(textureLoad(normalTex, coord, 0).xyz);
  return vec4<f32>(linZ, N);
}
