// Demo 06 — SSHGI (Mathis, Shadertoy dsGBzW) — Buffer B analog: bitmask horizon GI march.
//
// Direct port of Mathis's "Tracing horizons" pass (buffer-b.glsl) onto our real
// G-buffer. Per pixel: cast `slices` single-sided screen-space horizon rays, and
// for each 32-step march accumulate the light arriving through the newly-visible
// elevation sectors using a 32-bit visibility bitmask. Radiance is read from a
// pre-injected "source radiance" texture (our source pass = his Buffer A `.x`:
// beauty + multibounce feedback), so this pass is a pure gather.
//
// Preserved from Mathis (his semantic choices, kept even where they differ from
// the paper / SSRT3 / Salm — see README):
//   - 4 single-sided horizons at 90 deg azimuth spacing (NOT 2 double-sided
//     slices), each integrating elevations in [0, pi/2] on one side only.
//   - 32-bit mask spans the [0, pi/2] elevation quarter (bin = angle/(pi/2)*32),
//     but the cosine weight uses cos(angle/64*pi)^2 — his 1/64 constant, so the
//     weighting maps the 32 bins onto [0, pi/2] of the cosine curve.
//   - per-sample contribution = (newlyVisibleBits / spanBits) * radiance
//     * (cos(lo)^2 - cos(hi)^2) * sqrt(max(0, dot(sampleN, -dirToSample)))
//   - geometric screen-space step schedule with per-pixel + temporal jitter.
//
// Deviations from the toy (logged):
//   - Sample view positions reconstructed EXACTLY via invProj (his toy used the
//     cheaper normalize(rayDir)*depth approximation). More accurate on a real
//     perspective G-buffer.
//   - Bitmask built with guarded shifts instead of int(pow(2,x))-1, which relied
//     on GLSL 32-bit int overflow at span==32 (undefined in WGSL).
//   - Firefly clamp on gathered radiance (PLAN trap; SSGINode hardcodes 7).
//   - AO (his shader emits none) derived from final bitmask coverage into .a.
//
// WebGPU conventions: UV origin top-left (ndc.y = 1 - 2*uv.y); clip z in [0,1];
// right-handed view space, camera down -z. Our normalView + reconstructed view
// positions live in the SAME consistent view space, so Mathis's dot/length-based
// horizon math ports directly (the +z-forward vs -z-forward handedness cancels).

struct Params {
  invProj : mat4x4<f32>,
  resolution : vec2<f32>,
  near : f32,
  far : f32,
  slices : u32,
  steps : u32,
  frameSeed : u32,
  pad0 : u32,
  thickness : f32,       // world-space slab, maps to his 0.03 constant
  bias : f32,            // horizon normal bias, his 0.001
  giStrength : f32,
  maxLum : f32,          // firefly clamp
  stepScale : f32,       // his 0.15 step-growth base
  thicknessFalloff : f32,// his 0.07 (thickness grows with screen distance)
  pad1 : f32,
  pad2 : f32,
};

@group(0) @binding(0) var depthTex : texture_depth_2d;
@group(0) @binding(1) var normalTex : texture_2d<f32>;   // view-space normal [-1,1]
@group(0) @binding(2) var sourceTex : texture_2d<f32>;   // injected radiance (beauty + feedback)
@group(0) @binding(3) var<uniform> params : Params;

const PI : f32 = 3.141592653;
const I64 : f32 = 1.0 / 64.0;

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

fn aRand21(uv : vec2<f32>) -> f32 {
  return fract(sin(uv.x * uv.y) * 403.125 + cos(dot(uv, vec2<f32>(13.18273, 51.2134))) * 173.137);
}

// Reconstruct view-space position from clip depth (WebGPU 0..1).
fn viewPosFromDepth(uv : vec2<f32>, d : f32) -> vec3<f32> {
  let ndc = vec2<f32>(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0);
  let vp = params.invProj * vec4<f32>(ndc, d, 1.0);
  return vp.xyz / vp.w;
}

// Build a 32-bit mask covering elevation bins [lo, hi) (clamped to [0,32]).
fn sectorMask(loF : f32, hiF : f32) -> u32 {
  let lo = u32(clamp(loF, 0.0, 32.0));
  let hi = u32(clamp(hiF, 0.0, 32.0));
  if (hi <= lo || lo >= 32u) { return 0u; }
  let span = hi - lo;
  var ones : u32 = 0xFFFFFFFFu;
  if (span < 32u) { ones = (1u << span) - 1u; }
  return ones << lo;
}

@fragment
fn fs(in : VOut) -> @location(0) vec4<f32> {
  let coord = vec2<i32>(floor(in.pos.xy));
  let d = textureLoad(depthTex, coord, 0);
  if (d >= 0.99999) {
    // Sky/background: no gather. (Emissive geometry is handled via source tex.)
    return vec4<f32>(0.0, 0.0, 0.0, 1.0);
  }

  let fragCoord = in.pos.xy;
  let uv = fragCoord / params.resolution;
  let N = normalize(textureLoad(normalTex, coord, 0).xyz);
  let originVS = viewPosFromDepth(uv, d);

  let frameF = f32(params.frameSeed);
  let modFC = fragCoord - floor(fragCoord / 4.0) * 4.0;
  let randPhiOffset = aRand21(vec2<f32>(1.234) + vec2<f32>(fract(frameF * 3.26346 / 7.2634) * 7.2634));
  let base = floor(modFC.x) + floor(modFC.y) * 4.0 + frameF * 5.0;
  var randPhi = (base - floor(base / 16.0) * 16.0 + randPhiOffset) * 2.0 * PI * I64;

  let slices = max(1u, params.slices);
  let steps = max(1u, params.steps);
  let azStep = 2.0 * PI / f32(slices);

  var giSum = vec3<f32>(0.0);
  var occBits = 0.0;

  for (var i = 0u; i < slices; i = i + 1u) {
    randPhi += azStep;
    let ssDir = vec2<f32>(cos(randPhi), sin(randPhi));
    var stepDist = 1.0;
    let stepCoeff = params.stepScale
      + params.stepScale * aRand21(uv * (1.4 + fract(frameF * 3.26346 / 6.2634) * 6.2634));
    var bitMask : u32 = 0u;

    for (var s = 0u; s < steps; s = s + 1u) {
      let sPix = fragCoord + ssDir * stepDist;
      let curStep = max(1.0, stepDist * stepCoeff);
      stepDist += curStep;
      if (sPix.x < 1.0 || sPix.y < 1.0 || sPix.x >= params.resolution.x - 1.0 || sPix.y >= params.resolution.y - 1.0) {
        break;
      }
      let sCoord = vec2<i32>(floor(sPix));
      let sd = textureLoad(depthTex, sCoord, 0);
      if (sd >= 0.99999) { continue; }

      let sVP = viewPosFromDepth(sPix / params.resolution, sd);
      let toSample = sVP - originVS;
      let norDot = dot(N, toSample) - params.bias;
      let tanDist = length(toSample - norDot * N);
      let slab = params.thickness * max(1.0, stepDist * params.thicknessFalloff);
      let angle1f = atan2(norDot, tanDist);
      let angle2f = atan2(norDot - slab, tanDist);
      let angle1 = max(0.0, ceil(angle1f / (PI * 0.5) * 32.0));
      let angle2 = max(0.0, floor(angle2f / (PI * 0.5) * 32.0));

      let sMask = sectorMask(angle2, angle1);
      let newBits = f32(countOneBits(sMask & (~bitMask)));

      let sN = normalize(textureLoad(normalTex, sCoord, 0).xyz);
      let sNView = vec3<f32>(sN);
      var rad = textureLoad(sourceTex, sCoord, 0).rgb;
      let lum = dot(rad, vec3<f32>(0.2126, 0.7152, 0.0722));
      if (lum > params.maxLum) { rad = rad * (params.maxLum / lum); }

      let cosWeight = pow(cos(angle2 * I64 * PI), 2.0) - pow(cos(angle1 * I64 * PI), 2.0);
      let facing = sqrt(max(0.0, dot(sNView, -normalize(toSample))));

      giSum += newBits / max(1.0, angle1 - angle2) * rad * cosWeight * facing;
      bitMask = bitMask | sMask;
    }
    occBits += f32(countOneBits(bitMask));
  }

  let ao = 1.0 - occBits / (f32(slices) * 32.0);
  return vec4<f32>(giSum * params.giStrength, ao);
}
