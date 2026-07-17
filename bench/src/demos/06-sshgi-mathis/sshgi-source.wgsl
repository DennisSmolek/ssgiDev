// Demo 06 — SSHGI — source-radiance injection (Mathis Buffer A `.x` analog).
//
// In the toy, Buffer A packs each pixel's OUTGOING radiance into `.x`: emission
// for lights, or last-frame's reprojected accumulated GI for geometry. The march
// (Buffer B) gathers that channel, so reading a neighbour's `.x` re-injects last
// frame's bounce -> multibounce.
//
// Our three MRT already gives the G-buffer, so this pass only reproduces the `.x`
// packing against real inputs:
//     source = beauty  +  feedback * reproject(accumulated GI history)
// beauty (three's direct-lit output, incl. the emissive ceiling) is the light
// source; the accumulated-GI history term is the damped multibounce feedback
// (feedback < 1 keeps the loop convergent — PLAN trap: energy feedback loop).
// accumGI history is already albedo-modulated (see accum pass), i.e. the surface's
// outgoing indirect radiance, so beauty + feedback*accumGI = total outgoing.
//
// Reprojection is a TOGGLE (reprojectMode): 0 = static (sample same pixel, Mathis's
// original behaviour, correct while the camera is still); 1 = velocity reprojection
// with depth+normal disocclusion rejection (our addition — G-buffer velocity lets
// us reproject where the toy could only accumulate statically).

struct Params {
  resolution : vec2<f32>,
  near : f32,
  far : f32,
  feedback : f32,
  reprojectMode : u32,   // 0 static, 1 velocity-reproject
  reset : u32,           // 1 = history invalid -> no feedback
  pad0 : u32,
  depthThresh : f32,     // relative linear-depth reject threshold
  normalThresh : f32,    // dot(prevN, curN) reject threshold
  pad1 : f32,
  pad2 : f32,
};

@group(0) @binding(0) var beautyTex : texture_2d<f32>;
@group(0) @binding(1) var histGiTex : texture_2d<f32>;   // accumGI history (rgb=GI, a=count)
@group(0) @binding(2) var velocityTex : texture_2d<f32>; // screen-space motion vector
@group(0) @binding(3) var histGTex : texture_2d<f32>;    // prev gbuffer copy (r=linZ, gba=normal)
@group(0) @binding(4) var depthTex : texture_depth_2d;
@group(0) @binding(5) var normalTex : texture_2d<f32>;
@group(0) @binding(6) var<uniform> params : Params;

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

fn linearDist(d : f32) -> f32 {
  let n = params.near;
  let f = params.far;
  return (n * f) / (f - d * (f - n));
}

@fragment
fn fs(in : VOut) -> @location(0) vec4<f32> {
  let coord = vec2<i32>(floor(in.pos.xy));
  let beauty = textureLoad(beautyTex, coord, 0).rgb;

  var feedbackTerm = vec3<f32>(0.0);
  if (params.reset == 0u && params.feedback > 0.0) {
    let uv = in.pos.xy / params.resolution;
    var srcUV = uv;
    if (params.reprojectMode == 1u) {
      let vel = textureLoad(velocityTex, coord, 0).xy;
      srcUV = uv - vel;
    }

    if (srcUV.x >= 0.0 && srcUV.x < 1.0 && srcUV.y >= 0.0 && srcUV.y < 1.0) {
      let sCoord = vec2<i32>(floor(srcUV * params.resolution));
      var accept = true;
      if (params.reprojectMode == 1u) {
        let d = textureLoad(depthTex, coord, 0);
        let curLinZ = linearDist(d);
        let curN = normalize(textureLoad(normalTex, coord, 0).xyz);
        let prevG = textureLoad(histGTex, sCoord, 0);
        let dRel = abs(prevG.r - curLinZ) / max(1e-3, curLinZ);
        if (dRel > params.depthThresh || dot(prevG.gba, curN) < params.normalThresh) {
          accept = false;
        }
      }
      if (accept) {
        feedbackTerm = params.feedback * textureLoad(histGiTex, sCoord, 0).rgb;
      }
    }
  }

  return vec4<f32>(beauty + feedbackTerm, 1.0);
}
