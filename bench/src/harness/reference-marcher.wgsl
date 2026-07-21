// Demo 02 — brute-force screen-space ray-march reference.
//
// Lineage: Mirko Salm / TinyTexel "GT-VBAO" (Shadertoy XXGSDd), Buffer C
// `ReferenceAO()` — the brute-force marcher that GT-VBAO validates against.
// Semantics inherited from that reference and adapted to our real G-buffer:
//   - cosine-weighted hemisphere sampling via normalize(sphereSample + N)
//   - per-sample thickness slab hit test:  surf < rayDepth < surf + Thickness
//   - geometric step distribution with a jittered start (concentrates samples
//     near the origin, matching the reference's exponential t)
//   - first hit wins (break); miss = sky / no contribution
//   - a small normal-bias offset on the ray origin to avoid self-occlusion
//
// Deviations (see README "Semantics"):
//   - Salm marches in screen-texel space using reciprocal-w interpolation
//     against his toy g-buffer. We march in VIEW SPACE (reconstructed from our
//     depth buffer via the inverse projection) and re-project each sample to a
//     pixel. Same limitations (screen-space depth samples, thickness slab,
//     bounded march length) — cleaner with a real perspective projection.
//   - We additionally gather GI: on hit, accumulate beauty-buffer radiance
//     (firefly-clamped). Cosine sampling makes the per-ray mean an irradiance
//     estimator (∝ E/pi); GI is modulated by albedo at composite (PLAN trap:
//     PR #31839), not here.
//
// WebGPU conventions: framebuffer/UV origin top-left; NDC y is +up (so
// ndc.y = 1 - 2*uv.y); clip z in [0,1]; view space is right-handed, camera looks
// down -z, so positive distance from camera = -viewPos.z.

struct Params {
  proj : mat4x4<f32>,       // camera.projectionMatrix (column-major)
  invProj : mat4x4<f32>,    // camera.projectionMatrixInverse
  resolution : vec2<f32>,
  near : f32,
  far : f32,
  raysPerPixel : u32,
  stepsPerRay : u32,
  sampleCount : u32,        // accumulation frame index (0 = first / reset)
  frameSeed : u32,          // per-frame noise decorrelation
  radius : f32,             // max march length, world/view units
  thickness : f32,          // world-space slab depth (PLAN: scene-scale dependent)
  bias : f32,               // normal-offset on ray origin, world/view units
  maxLuminance : f32,       // firefly clamp on gathered radiance
  giStrength : f32,
  skyIntensity : f32,       // radiance added on a miss (0 for closed Cornell)
  pad0 : f32,
  pad1 : f32,
};

@group(0) @binding(0) var depthTex : texture_depth_2d;
@group(0) @binding(1) var normalTex : texture_2d<f32>;  // view-space normal, [-1,1]
@group(0) @binding(2) var beautyTex : texture_2d<f32>;  // HDR lit output
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

// --- RNG: PCG hash -> uniform floats ------------------------------------------
fn pcg(x : u32) -> u32 {
  let state = x * 747796405u + 2891336453u;
  let word = ((state >> ((state >> 28u) + 4u)) ^ state) * 277803737u;
  return (word >> 22u) ^ word;
}
fn nextRand(seed : ptr<function, u32>) -> f32 {
  *seed = pcg(*seed);
  return f32(*seed) * (1.0 / 4294967296.0);
}

// Positive linear distance from the camera for a clip-space depth (WebGPU 0..1).
fn linearDist(d : f32) -> f32 {
  let n = params.near;
  let f = params.far;
  return (n * f) / (f - d * (f - n));
}

// Reconstruct view-space position of a pixel from its clip depth.
fn viewPosFromDepth(uv : vec2<f32>, d : f32) -> vec3<f32> {
  let ndc = vec2<f32>(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0);
  let clip = vec4<f32>(ndc, d, 1.0);
  let vp = params.invProj * clip;
  return vp.xyz / vp.w;
}

// Project a view-space point to a [0,1] uv (top-left origin).
fn projectToUV(vp : vec3<f32>) -> vec2<f32> {
  let clip = params.proj * vec4<f32>(vp, 1.0);
  let ndc = clip.xyz / clip.w;
  return vec2<f32>(ndc.x * 0.5 + 0.5, 0.5 - ndc.y * 0.5);
}

// Uniform point on the unit sphere from two [0,1) randoms.
fn sampleSphere(u0 : f32, u1 : f32) -> vec3<f32> {
  let z = u0 * 2.0 - 1.0;
  let a = u1 * 6.28318530718;
  let r = sqrt(max(0.0, 1.0 - z * z));
  return vec3<f32>(r * cos(a), r * sin(a), z);
}

@fragment
fn fs(in : VOut) -> @location(0) vec4<f32> {
  let coord = vec2<i32>(floor(in.pos.xy));
  let d = textureLoad(depthTex, coord, 0);

  // Background / sky: no occlusion, no GI (matches reference sky skip).
  if (d >= 0.99999) {
    return vec4<f32>(0.0, 0.0, 0.0, 0.0);
  }

  let uv = (in.pos.xy) / params.resolution;
  let N = normalize(textureLoad(normalTex, coord, 0).xyz);
  let originVS = viewPosFromDepth(uv, d) + N * params.bias;

  let rays = max(1u, params.raysPerPixel);
  let steps = max(1u, params.stepsPerRay);

  // Geometric step schedule: t runs tMin -> ~radius over `steps` (jittered).
  let tMin = max(params.radius * 0.02, params.bias);
  let width = params.radius / tMin;
  let stepRatio = pow(width, 1.0 / f32(steps));

  var giSum = vec3<f32>(0.0);
  var occSum = 0.0;

  for (var i = 0u; i < rays; i = i + 1u) {
    var seed = pcg(
      (u32(coord.x) * 3266489917u) ^
      (u32(coord.y) * 668265263u) ^
      (i * 374761393u) ^
      (params.frameSeed * 2246822519u),
    );
    let u0 = nextRand(&seed);
    let u1 = nextRand(&seed);
    let jitter = nextRand(&seed);

    // Cosine-weighted hemisphere about N (Salm's normalize(sphere + N)).
    var dir = sampleSphere(u0, u1) + N;
    let dl = length(dir);
    if (dl < 1e-4) { dir = N; } else { dir = dir / dl; }

    var t = tMin * pow(stepRatio, jitter);
    var hit = false;

    for (var s = 0u; s < steps; s = s + 1u) {
      let p = originVS + dir * t;
      t = t * stepRatio;

      let suv = projectToUV(p);
      if (suv.x < 0.0 || suv.x >= 1.0 || suv.y < 0.0 || suv.y >= 1.0) { break; }

      let sc = vec2<i32>(floor(suv * params.resolution));
      let sd = textureLoad(depthTex, sc, 0);
      if (sd >= 0.99999) { continue; } // sky sample: never an occluder

      let surfDist = linearDist(sd);
      let rayDist = -p.z; // positive distance from camera

      if (rayDist > surfDist && rayDist < surfDist + params.thickness) {
        occSum += 1.0;
        var rad = textureLoad(beautyTex, sc, 0).rgb;
        let lum = dot(rad, vec3<f32>(0.2126, 0.7152, 0.0722));
        if (lum > params.maxLuminance) { rad = rad * (params.maxLuminance / lum); }
        giSum += rad;
        hit = true;
        break;
      }
    }

    if (!hit) {
      giSum += vec3<f32>(params.skyIntensity);
    }
  }

  let ao = 1.0 - occSum / f32(rays);
  let gi = giSum / f32(rays) * params.giStrength;

  // rgb = GI radiance estimate, a = AO. Additive blend across frames; the
  // display divides by sampleCount to recover the running mean.
  return vec4<f32>(gi, ao);
}

// --- P4 oracle bent-normal variant --------------------------------------------
// ADDITIVE-ONLY: a SECOND entry point that duplicates fs() verbatim and ALSO
// accumulates the ground-truth bent normal into a second color attachment.
// location(0) is byte-identical to fs() (same math, same order) so demos that
// bind only one target and entryPoint 'fs' are completely untouched; this entry
// point is compiled but never referenced by their pipelines. Only ReferencePass
// constructed with { accumulateBentNormals: true } builds a two-target pipeline
// using 'fsBent'. location(1): xyz = sum of UNOCCLUDED (miss) cosine-weighted
// ray directions in VIEW SPACE (same standard three view space the demo writes
// its bent normal in), w = unoccluded-ray count. Divide xyz by any positive
// scalar and normalize to recover the mean visible direction.
struct BentOut {
  @location(0) giao : vec4<f32>,
  @location(1) bent : vec4<f32>,
};

@fragment
fn fsBent(in : VOut) -> BentOut {
  let coord = vec2<i32>(floor(in.pos.xy));
  let d = textureLoad(depthTex, coord, 0);

  if (d >= 0.99999) {
    return BentOut(vec4<f32>(0.0, 0.0, 0.0, 0.0), vec4<f32>(0.0));
  }

  let uv = (in.pos.xy) / params.resolution;
  let N = normalize(textureLoad(normalTex, coord, 0).xyz);
  let originVS = viewPosFromDepth(uv, d) + N * params.bias;

  let rays = max(1u, params.raysPerPixel);
  let steps = max(1u, params.stepsPerRay);

  let tMin = max(params.radius * 0.02, params.bias);
  let width = params.radius / tMin;
  let stepRatio = pow(width, 1.0 / f32(steps));

  var giSum = vec3<f32>(0.0);
  var occSum = 0.0;
  var bentSum = vec3<f32>(0.0);
  var missCount = 0.0;

  for (var i = 0u; i < rays; i = i + 1u) {
    var seed = pcg(
      (u32(coord.x) * 3266489917u) ^
      (u32(coord.y) * 668265263u) ^
      (i * 374761393u) ^
      (params.frameSeed * 2246822519u),
    );
    let u0 = nextRand(&seed);
    let u1 = nextRand(&seed);
    let jitter = nextRand(&seed);

    var dir = sampleSphere(u0, u1) + N;
    let dl = length(dir);
    if (dl < 1e-4) { dir = N; } else { dir = dir / dl; }

    var t = tMin * pow(stepRatio, jitter);
    var hit = false;

    for (var s = 0u; s < steps; s = s + 1u) {
      let p = originVS + dir * t;
      t = t * stepRatio;

      let suv = projectToUV(p);
      if (suv.x < 0.0 || suv.x >= 1.0 || suv.y < 0.0 || suv.y >= 1.0) { break; }

      let sc = vec2<i32>(floor(suv * params.resolution));
      let sd = textureLoad(depthTex, sc, 0);
      if (sd >= 0.99999) { continue; }

      let surfDist = linearDist(sd);
      let rayDist = -p.z;

      if (rayDist > surfDist && rayDist < surfDist + params.thickness) {
        occSum += 1.0;
        var rad = textureLoad(beautyTex, sc, 0).rgb;
        let lum = dot(rad, vec3<f32>(0.2126, 0.7152, 0.0722));
        if (lum > params.maxLuminance) { rad = rad * (params.maxLuminance / lum); }
        giSum += rad;
        hit = true;
        break;
      }
    }

    if (!hit) {
      giSum += vec3<f32>(params.skyIntensity);
      // Unoccluded ray -> a visible direction. Accumulate for the bent normal.
      bentSum += dir;
      missCount += 1.0;
    }
  }

  let ao = 1.0 - occSum / f32(rays);
  let gi = giSum / f32(rays) * params.giStrength;
  return BentOut(vec4<f32>(gi, ao), vec4<f32>(bentSum, missCount));
}
