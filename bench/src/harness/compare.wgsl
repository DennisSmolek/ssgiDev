// A/B comparator (harness feature). Generic split-screen / abs-diff of any two
// textures at the same resolution. Runs as a raw WGSL fullscreen pass writing
// into a three-allocated RenderTarget (interop rule), consumed downstream as a
// plain TSL texture() node. Used by demo 02 for live-vs-accumulated, but kept
// generic (channel select + per-input scale) for any two textures later.

struct Params {
  resolution : vec2<f32>,
  splitX : f32,    // divider x in pixels (mode 0)
  mode : u32,      // 0 = split, 1 = abs-diff
  amp : f32,       // diff amplification (mode 1)
  scaleA : f32,    // per-input scale (e.g. 1/sampleCount for accumulated sums)
  scaleB : f32,
  channel : u32,   // 0 = rgb, 1 = alpha replicated (AO)
};

@group(0) @binding(0) var texA : texture_2d<f32>;
@group(0) @binding(1) var texB : texture_2d<f32>;
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

fn pick(t : vec4<f32>, scale : f32) -> vec3<f32> {
  if (params.channel == 1u) { return vec3<f32>(t.a * scale); }
  return t.rgb * scale;
}

@fragment
fn fs(in : VOut) -> @location(0) vec4<f32> {
  let coord = vec2<i32>(floor(in.pos.xy));
  let a = pick(textureLoad(texA, coord, 0), params.scaleA);
  let b = pick(textureLoad(texB, coord, 0), params.scaleB);

  if (params.mode == 1u) {
    let diff = abs(a - b) * params.amp;
    return vec4<f32>(diff, 1.0);
  }

  // split: A left of divider, B right, with a thin marker line.
  let x = in.pos.x;
  if (abs(x - params.splitX) < 1.0) {
    return vec4<f32>(1.0, 0.9, 0.2, 1.0);
  }
  let v = select(b, a, x < params.splitX);
  return vec4<f32>(v, 1.0);
}
