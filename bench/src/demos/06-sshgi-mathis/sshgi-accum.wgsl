// Demo 06 — SSHGI — temporal accumulation + adaptive bilateral (Mathis Buffer C).
//
// Port of his "Accumulation" pass:
//   1. Reproject last frame's accumulated GI (history) to this pixel.
//   2. ADAPTIVE spatial bilateral of the raw march output: the radius shrinks as
//      the temporal history grows (few history samples -> wider blur, up to 5x5;
//      converged -> 3x3). Weights are a plane test + normal test (his SampleMB).
//   3. Blend: out.rgb = (histGI*histCount + denoisedRaw*ALBEDO) / (histCount+1),
//      count capped. Albedo modulation happens HERE (PLAN trap PR #31839): the
//      stored value is the surface's outgoing indirect radiance, which the source
//      pass feeds back for multibounce.
//
// Reprojection is the SAME toggle as the source pass: 0 = static (Mathis's
// original — sample same pixel, correct while the camera is still), 1 = velocity
// reprojection with depth+normal disocclusion rejection (our addition).
//
// The image.glsl comment calls this a "3x3 bilateral"; the code is adaptive up to
// 5x5. We port the code (adaptive) and note the discrepancy.

struct Params {
  invProj : mat4x4<f32>,
  resolution : vec2<f32>,
  near : f32,
  far : f32,
  reprojectMode : u32,
  reset : u32,
  countCap : u32,
  pad0 : u32,
  depthThresh : f32,
  normalThresh : f32,
  bilateralScale : f32,   // multiplies the adaptive radius footprint
  pad1 : f32,
};

@group(0) @binding(0) var depthTex : texture_depth_2d;
@group(0) @binding(1) var normalTex : texture_2d<f32>;
@group(0) @binding(2) var albedoTex : texture_2d<f32>;
@group(0) @binding(3) var rawTex : texture_2d<f32>;      // march output (rgb=GI, a=AO)
@group(0) @binding(4) var histGiTex : texture_2d<f32>;   // accumGI history (rgb=GI, a=count)
@group(0) @binding(5) var velocityTex : texture_2d<f32>;
@group(0) @binding(6) var histGTex : texture_2d<f32>;    // prev gbuffer (r=linZ, gba=normal)
@group(0) @binding(7) var<uniform> params : Params;

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

fn viewPosFromDepth(uv : vec2<f32>, d : f32) -> vec3<f32> {
  let ndc = vec2<f32>(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0);
  let vp = params.invProj * vec4<f32>(ndc, d, 1.0);
  return vp.xyz / vp.w;
}

@fragment
fn fs(in : VOut) -> @location(0) vec4<f32> {
  let coord = vec2<i32>(floor(in.pos.xy));
  let d = textureLoad(depthTex, coord, 0);
  if (d >= 0.99999) {
    // Background: pass the (sky/emissive) source radiance straight through, count 1.
    return vec4<f32>(textureLoad(rawTex, coord, 0).rgb, 1.0);
  }

  let uv = in.pos.xy / params.resolution;
  let N = normalize(textureLoad(normalTex, coord, 0).xyz);
  let originVS = viewPosFromDepth(uv, d);
  let albedo = textureLoad(albedoTex, coord, 0).rgb;

  // --- Temporal history (reproject) ---
  var lastGI = vec3<f32>(0.0);
  var lastCount = 0.0;
  if (params.reset == 0u) {
    var srcUV = uv;
    if (params.reprojectMode == 1u) {
      let vel = textureLoad(velocityTex, coord, 0).xy;
      srcUV = uv - vel;
    }
    if (srcUV.x >= 0.0 && srcUV.x < 1.0 && srcUV.y >= 0.0 && srcUV.y < 1.0) {
      let sCoord = vec2<i32>(floor(srcUV * params.resolution));
      var accept = true;
      if (params.reprojectMode == 1u) {
        let curLinZ = linearDist(d);
        let prevG = textureLoad(histGTex, sCoord, 0);
        let dRel = abs(prevG.r - curLinZ) / max(1e-3, curLinZ);
        if (dRel > params.depthThresh || dot(prevG.gba, N) < params.normalThresh) {
          accept = false;
        }
      }
      if (accept) {
        let h = textureLoad(histGiTex, sCoord, 0);
        lastGI = h.rgb;
        lastCount = h.a;
      }
    }
  }

  // --- Adaptive spatial bilateral of the raw march output ---
  var newPixel = textureLoad(rawTex, coord, 0).rgb;
  var newWeight = 1.0;
  let radius = max(1.0, ceil(1.99 - lastCount * 0.25));       // 5x5 fresh -> 3x3 converged
  let radiusCoeff = max(1.0, (2.25 - lastCount * 0.25)) * params.bilateralScale;
  let r = i32(radius);
  for (var y = -r; y <= r; y = y + 1) {
    for (var x = -r; x <= r; x = x + 1) {
      if (x == 0 && y == 0) { continue; }
      let sPix = in.pos.xy + vec2<f32>(f32(x), f32(y)) * radiusCoeff;
      if (sPix.x < 1.0 || sPix.y < 1.0 || sPix.x >= params.resolution.x - 1.0 || sPix.y >= params.resolution.y - 1.0) {
        continue;
      }
      let sCoord = vec2<i32>(floor(sPix));
      let sd = textureLoad(depthTex, sCoord, 0);
      if (sd >= 0.99999) { continue; }
      let sVP = viewPosFromDepth(sPix / params.resolution, sd);
      let sN = normalize(textureLoad(normalTex, sCoord, 0).xyz);
      let planeW = select(0.0, 1.0, dot(N, sVP - originVS) < 0.01);
      let normW = select(0.01, 1.0, dot(N, sN) > 0.9);
      let w = max(0.0001, planeW) * normW;
      newPixel += textureLoad(rawTex, sCoord, 0).rgb * w;
      newWeight += w;
    }
  }
  newPixel = newPixel / newWeight;

  // --- Accumulate (albedo-modulated) ---
  let outGI = (lastGI * lastCount + newPixel * albedo) / (lastCount + 1.0);
  let outCount = min(f32(params.countCap), lastCount + 1.0);
  return vec4<f32>(outGI, outCount);
}
