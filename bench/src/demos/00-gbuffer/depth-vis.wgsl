// Raw-pass interop smoke test (demo 00). Reads the three-managed depth texture
// and writes a grayscale linearized-depth visualization into a three-allocated
// RenderTarget. Runs on three's GPUDevice via RawFragmentPass.
//
// UV origin: WebGPU framebuffer origin is top-left. @builtin(position) in the
// fragment shader is in pixel coords with (0,0) at top-left, matching the depth
// texture's texel layout (three renders it with the same convention), so
// textureLoad(depthTex, vec2<i32>(pos.xy), 0) samples the corresponding texel.

struct Params {
  camNear : f32,
  camFar  : f32,
  vizNear : f32,
  vizFar  : f32,
};

@group(0) @binding(0) var depthTex : texture_depth_2d;
@group(0) @binding(1) var<uniform> params : Params;

struct VOut {
  @builtin(position) pos : vec4<f32>,
};

@vertex
fn vs(@builtin(vertex_index) vid : u32) -> VOut {
  // Fullscreen triangle.
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
  let d = textureLoad(depthTex, coord, 0); // non-linear clip depth in [0,1]

  // Perspective linearization (WebGPU clip z range 0..1): positive view-space
  // distance from the camera.
  let n = params.camNear;
  let f = params.camFar;
  let viewZ = (n * f) / (f - d * (f - n));

  // Map the chosen visualization range to grayscale; near = white, far = black.
  let g = clamp((viewZ - params.vizNear) / (params.vizFar - params.vizNear), 0.0, 1.0);
  let shade = 1.0 - g;
  return vec4<f32>(shade, shade, shade, 1.0);
}
