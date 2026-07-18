// Demo 06 — SSHGI — compose / view select (Mathis Image pass).
//
// Writes the selected debug view into a STABLE output target (the accumulated-GI
// history is ping-ponged, so the TSL display node cannot sample it directly by
// identity — this pass resolves it into a fixed texture the display blits).
//
// Mathis's Image pass is just ACES(accumGI). We keep that for the lit views and
// expose the intermediate channels for inspection:
//   0 combined : ACES(beauty*aoTerm + accumGI)   (accumGI already albedo-modulated)
//   1 gi       : denoised accumGI * exposure       (indirect only)
//   2 raw      : single-frame march GI * exposure  (pre-denoise, pre-albedo)
//   3 ao       : bitmask AO (3x3 smoothed)
//   4 beauty   : passthrough

struct Params {
  resolution : vec2<f32>,
  viewMode : u32,
  aoStrength : f32,
  giExposure : f32,
  tonemap : u32,     // 1 = ACES+gamma (combined)
  pad0 : f32,
  pad1 : f32,
};

@group(0) @binding(0) var histGiTex : texture_2d<f32>;   // accumGI (rgb, a=count)
@group(0) @binding(1) var rawTex : texture_2d<f32>;      // march (rgb=GI, a=AO)
@group(0) @binding(2) var beautyTex : texture_2d<f32>;
@group(0) @binding(3) var albedoTex : texture_2d<f32>;
@group(0) @binding(4) var<uniform> params : Params;

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

fn acesFilm(x : vec3<f32>) -> vec3<f32> {
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), vec3<f32>(0.0), vec3<f32>(1.0));
}

fn smoothAO(coord : vec2<i32>) -> f32 {
  var s = 0.0;
  var n = 0.0;
  for (var y = -1; y <= 1; y = y + 1) {
    for (var x = -1; x <= 1; x = x + 1) {
      s += textureLoad(rawTex, coord + vec2<i32>(x, y), 0).a;
      n += 1.0;
    }
  }
  return s / n;
}

@fragment
fn fs(in : VOut) -> @location(0) vec4<f32> {
  let coord = vec2<i32>(floor(in.pos.xy));
  let gi = textureLoad(histGiTex, coord, 0).rgb;
  let beauty = textureLoad(beautyTex, coord, 0).rgb;

  var col = vec3<f32>(0.0);
  if (params.viewMode == 0u) {
    let ao = smoothAO(coord);
    let aoTerm = mix(1.0, ao, params.aoStrength);
    col = beauty * aoTerm + gi;
  } else if (params.viewMode == 1u) {
    col = gi * params.giExposure;
  } else if (params.viewMode == 2u) {
    col = textureLoad(rawTex, coord, 0).rgb * params.giExposure;
  } else if (params.viewMode == 3u) {
    col = vec3<f32>(smoothAO(coord));
  } else {
    col = beauty;
  }

  if (params.tonemap == 1u && params.viewMode == 0u) {
    // ACES only, in linear. Mathis's Shadertoy also applied pow(0.45) gamma
    // here, but our output goes through three's display pipeline which does
    // the linear->sRGB encode itself — keeping the manual gamma double-encodes
    // and washes out the combined view.
    col = acesFilm(max(vec3<f32>(0.0), col));
  }
  return vec4<f32>(col, 1.0);
}
