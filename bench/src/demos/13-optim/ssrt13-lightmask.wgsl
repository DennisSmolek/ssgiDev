// Demo 12 (distilled SSGI v0) — FROZEN FORK of demo 03 (ssrt-lightmask). Copied verbatim,
// NOT ?raw-imported (frozen-fork lesson, WORKLOG 2026-07-21). See README provenance.
// Demo 03 stage (f) — multibounce light buffer.
// Port of SSRT3 SSRT.shader `GetLightmaskPass`: the radiance source the GI gather
// samples becomes  beauty + reproject(previousGI) * multiBounceGI.  Feeding the
// denoised GI of the previous frame back in gives second and subsequent bounces.
// The feedback is damped (mbDamping, ~0.5 typical) and the weight is folded on
// the CPU (weight = multiBounceGI * mbDamping) so the loop converges instead of
// running away. (SSRT3 ships this un-albedo-modulated — the `* albedo` variant is
// commented out there — so we match: light = beauty + prevGI*weight.)

struct LParams {
  resolution : vec2<f32>,
  weight : f32,   // multiBounceGI * mbDamping
  pad0 : f32,
};

@group(0) @binding(0) var beautyTex : texture_2d<f32>;
@group(0) @binding(1) var prevGiTex : texture_2d<f32>;  // previous frame's denoised GI/AO
@group(0) @binding(2) var velTex : texture_2d<f32>;
@group(0) @binding(3) var outTex : texture_storage_2d<rgba16float, write>;
@group(0) @binding(4) var<uniform> p : LParams;

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) gid : vec3<u32>) {
  let dim = vec2<u32>(u32(p.resolution.x), u32(p.resolution.y));
  if (gid.x >= dim.x || gid.y >= dim.y) { return; }
  let coord = vec2<i32>(gid.xy);

  var light = textureLoad(beautyTex, coord, 0).rgb;

  if (p.weight > 0.0) {
    let uv = (vec2<f32>(gid.xy) + 0.5) / p.resolution;
    let vel = textureLoad(velTex, coord, 0).xy;
    let reprojUV = uv - vel * vec2<f32>(0.5, -0.5);
    if (reprojUV.x >= 0.0 && reprojUV.y >= 0.0 && reprojUV.x <= 1.0 && reprojUV.y <= 1.0) {
      let rc = vec2<i32>(floor(reprojUV * p.resolution));
      let prevGI = textureLoad(prevGiTex, rc, 0).rgb;
      light = light + prevGI * p.weight;
    }
  }

  textureStore(outTex, coord, vec4<f32>(light, 1.0));
}
