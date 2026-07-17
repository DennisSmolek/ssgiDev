// Demo 11 — one fixed joint-bilateral denoiser, applied identically to every
// noise's raw single-frame AO so the ONLY variable is the noise source (tests
// Salm's "IGN denoises better than R1-Hilbert" claim). Depth+normal-aware,
// separated only conceptually — here a single square kernel pass. Not tuned per
// noise; deliberately simple (borrowed structure from demo 06's 3x3 bilateral,
// widened to radius R).

struct Params {
  resolution : vec2<f32>,
  near : f32,
  far : f32,
  radius : i32,
  sigmaSpatial : f32,
  depthSigma : f32,   // view-space z difference tolerance
  normalPow : f32,    // normal similarity exponent
};

@group(0) @binding(0) var aoTex : texture_2d<f32>;      // raw AO in .a
@group(0) @binding(1) var depthTex : texture_depth_2d;
@group(0) @binding(2) var normalTex : texture_2d<f32>;
@group(0) @binding(3) var<uniform> params : Params;

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

fn linViewZ(d : f32) -> f32 {
  return (params.near * params.far) / (params.far - d * (params.far - params.near));
}

@fragment
fn fs(in : VOut) -> @location(0) vec4<f32> {
  let coord = vec2<i32>(floor(in.pos.xy));
  let dc = textureLoad(depthTex, coord, 0);
  if (dc >= 0.99999) {
    return vec4<f32>(1.0, 1.0, 1.0, 1.0); // background: fully open
  }
  let zc = linViewZ(dc);
  let Nc = normalize(textureLoad(normalTex, coord, 0).xyz);
  let res = vec2<i32>(params.resolution);

  var sum = 0.0;
  var wsum = 0.0;
  let R = params.radius;
  let s2 = 2.0 * params.sigmaSpatial * params.sigmaSpatial;

  for (var dy = -R; dy <= R; dy = dy + 1) {
    for (var dx = -R; dx <= R; dx = dx + 1) {
      let sc = coord + vec2<i32>(dx, dy);
      if (sc.x < 0 || sc.y < 0 || sc.x >= res.x || sc.y >= res.y) { continue; }
      let sd = textureLoad(depthTex, sc, 0);
      if (sd >= 0.99999) { continue; }
      let ws = exp(-f32(dx * dx + dy * dy) / s2);
      let zs = linViewZ(sd);
      let wz = exp(-abs(zs - zc) / max(1e-4, params.depthSigma));
      let Ns = normalize(textureLoad(normalTex, sc, 0).xyz);
      let wn = pow(max(0.0, dot(Ns, Nc)), params.normalPow);
      let w = ws * wz * wn;
      sum = sum + textureLoad(aoTex, sc, 0).a * w;
      wsum = wsum + w;
    }
  }

  let ao = select(sum / wsum, textureLoad(aoTex, coord, 0).a, wsum <= 0.0);
  return vec4<f32>(vec3<f32>(ao), ao);
}
