// Demo 13 — optimization lab. Compile-time WGSL variant family for the MARCH
// kernel (ssrt13-main.wgsl). NEXTGEN P5 phase 1 (ALU family).
//
// A "variant" is a pure string transform of the pristine march source. Each
// variant compiles to a SEPARATE pipeline (RawComputePass) built from its
// transformed text, selected at runtime. `baseline` is the identity transform:
// its generated text is asserted BYTE-IDENTICAL to the pristine source (the
// frozen-fork control), so any measured delta is attributable to the transform,
// never to an accidental edit.
//
// Every transform anchors on an EXACT substring from the pristine shader and
// asserts the expected occurrence count, so upstream drift fails loudly at build
// time instead of silently no-op'ing (the frozen-fork lesson, WORKLOG 2026-07-21).
//
// Optimization principles applied (NEXTGEN "Optimization principles" — PERF GOALS,
// every one yields to the paired measurement in run-13.mjs):
//   trig      — principle 1 (trig avoidance): angle-sum slice recurrence +
//               exact cos/sin(acos) vector identities + branchless vec2 acos.
//   loop      — principle 4 (loop hygiene): hoist the invariant reciprocal, and
//               strength-reduce the affine march-offset argument to an add.
//   precision — principle 3 (precision discipline): f16 arithmetic for the
//               bounded [0,1] AO/sector/GI-weight quantities; depth + position
//               reconstruction STAY f32 (load-bearing). Requires shader-f16.
//   alu-all   — the three composed (precision dropped if f16 is unavailable).
//
// P5.2 BANDWIDTH family (NEXTGEN principle 5 "bandwidth before ALU" — where lab 09
// and P5.1's ALU near-zero both say the win lives; the march is FETCH-bound):
//   light-mips    — principle 5 (mip the light buffer): far march samples read a
//                   coarser (prefiltered) light mip via the SAME distance→mip map
//                   the base uses for depth. Cuts the uncorrelated global light
//                   fetches lab 09 named as the cap; prefiltering also cuts far
//                   fireflies. Normal deliberately left un-mipped (see note).
//   hiz-skip      — principle 5 (hierarchical empty-space skipping): a companion
//                   box-MAX depth pyramid brackets the coarse depth interval; the
//                   march skips spans it can prove contribute EXACTLY nothing. The
//                   exact realizations here: bitfield-saturation early-out (all 32
//                   sectors occluded ⇒ no later sample can add one) in the bitmask
//                   path, and a beyond-radius coarse skip in the classic AO path.
//                   Conservative by construction ⇒ output identical to baseline.
//   checkerboard  — principle 5 (halve marched pixels): march a frame-parity
//                   checkerboard; skipped pixels retain their prior march output
//                   and are refilled by the temporal frame-count accumulator (the
//                   fill machinery lab 09 lacked). ~2× fewer marched pixels at a
//                   measured stability cost. March-only transform (see note).
//   adaptive      — principle 6 (adaptive over uniform): the shared temporal-guides
//                   pass supplies per-pixel history length N; effort (rotationCount
//                   + stepCount) ramps from full (fresh, N<4) to ~0.4 (converged,
//                   N≥16). Converged pixels coast; disoccluded pixels get the full
//                   budget. Reads N via binding 12; effort can be forced to the
//                   fresh/converged endpoints for deterministic A/B (F_ADAPT_* bits).
//   bandwidth-all — light-mips ∘ hiz-skip ∘ adaptive composed (disjoint edits).
//                   checkerboard is deliberately EXCLUDED (see build note): it is an
//                   orthogonal temporal-rate trade that double-dips adaptive's
//                   stability budget, so it stays a standalone measured variant.
//
// P5.3 SCHEDULED-HEIR family (NEXTGEN P5 — the two production heirs LSAO's notes name):
//   deinterleave  — CACAO-style phase-bucket marching (Intel ASSAO → AMD FidelityFX
//                   CACAO), Dennis's MUST-DO. Split the march-res grid into 4 (2×2)
//                   phase buckets; each bucket marches its OWN compact quarter-res
//                   image (a stride-2 phase subsample of the G-buffer), so its fetches
//                   have 4× tighter spatial locality (neighbouring compact threads
//                   sample neighbouring world positions at the SAME phase — the
//                   production heir to LSAO's coherence goal, and bitmask-compatible
//                   since it reorganizes WHERE fetches land, not the estimator). This
//                   is a HOST-orchestrated variant (index.ts runDeinterleave): a
//                   deinterleave EXTRACT pass (ssrt13-deinterleave.wgsl) → 4 compact
//                   dispatches of the PRISTINE baseline march (so the variant's WGSL
//                   is byte-identical baseline — the reorganization is in the driver,
//                   not the shader) → an interleave SCATTER pass (ssrt13-interleave)
//                   back to march res. Noise: each bucket advances a decorrelated
//                   per-bucket frameSeed; the CONVERGED image is noise-phase-
//                   independent (Monte-Carlo expectation), so the converged output
//                   matches baseline up to the per-bucket depth DECIMATION (each pixel
//                   effectively marches a quarter-res-of-full depth field) + mipOpt
//                   disabled on the compact pass — both documented, relaxed 1e-3 gate.
//                   Measured march-only (4 compact dispatches) AND chain (incl. the
//                   de/interleave passes) per run-13 --family phase3.
//   subgroups     — barrier-free intra-wave sample sharing (`enable subgroups;`). Lab
//                   09's LDS-overhead argument does NOT transfer (no workgroup barrier).
//                   FEATURE-GATED as a variant PAIR (standing rule): built only when the
//                   adapter exposes `subgroups`; when absent it reports 'unavailable' and
//                   the BASELINE is the documented fallback (feature-free) — the pair
//                   requirement is satisfied by baseline being the no-feature path. The
//                   sharing is SCOPED to be provably-identical (never a wrong image): the
//                   GI light fetch shares one representative fetch across the subgroup ONLY
//                   when subgroupAll agrees every active lane wants the SAME texel; else
//                   each lane fetches itself. So it is bit-exact vs baseline (1e-4 gate).
//                   The sector march's fetches live inside data-dependent break/continue
//                   loops (non-uniform control flow), so we suppress the subgroup-
//                   uniformity diagnostic and rely on ACTIVE-lane semantics — the honest
//                   scope, expected near-zero on this fetch pattern (recorded, not hidden).
//
// SHARED-LAYOUT note: the bandwidth variants need extra textures (light pyramid,
// max-depth pyramid, guides history N). They are APPENDED as bindings 10/11/12 so
// the pristine march's bindings 0–9 are UNCHANGED — `baseline` stays byte-identical
// (the frozen-fork assertion still holds). Every variant's pipeline shares the one
// 13-entry layout; a shader that references only a subset of the bound textures is
// valid WebGPU (unused entries are ignored), so one resources[] array drives all.

export const VARIANTS = [
  'baseline', 'trig', 'loop', 'precision', 'alu-all',
  'light-mips', 'hiz-skip', 'checkerboard', 'adaptive', 'bandwidth-all',
  'deinterleave', 'subgroups',
] as const;
export type Variant = (typeof VARIANTS)[number];

// Bandwidth variants that read the appended bindings — the host builds the light
// pyramid / max-depth pyramid / guides only for these (lazy), and every march
// pipeline carries all three appended bindings regardless (unused = ignored).
export const BANDWIDTH_VARIANTS = ['light-mips', 'hiz-skip', 'checkerboard', 'adaptive', 'bandwidth-all'] as const;
export function needsLightPyramid(v: Variant): boolean { return v === 'light-mips' || v === 'bandwidth-all'; }
export function needsMaxPyramid(v: Variant): boolean { return v === 'hiz-skip' || v === 'bandwidth-all'; }
export function needsGuides(v: Variant): boolean { return v === 'adaptive' || v === 'bandwidth-all'; }

export interface BuiltVariant {
  variant: Variant;
  code: string;
  available: boolean; // false only when a required adapter feature is missing
  note: string; // human-readable summary of what was applied (or why unavailable)
}

// --- anchor helpers ----------------------------------------------------------
// replaceOnce: assert EXACTLY one occurrence, replace it. replaceAll: assert at
// least `min` occurrences, replace every one with the SAME replacement.

function replaceOnce(src: string, find: string, repl: string, label: string): string {
  const first = src.indexOf(find);
  if (first === -1) throw new Error(`[variants] anchor missing: ${label}`);
  const second = src.indexOf(find, first + find.length);
  if (second !== -1) throw new Error(`[variants] anchor not unique (expected 1): ${label}`);
  return src.slice(0, first) + repl + src.slice(first + find.length);
}

function replaceAll(src: string, find: string, repl: string, min: number, label: string): string {
  const parts = src.split(find);
  if (parts.length - 1 < min) {
    throw new Error(`[variants] anchor found ${parts.length - 1}× (expected >=${min}): ${label}`);
  }
  return parts.join(repl);
}

// =============================================================================
// trig — NEXTGEN principle 1 (trig avoidance / IQ noacos)
// =============================================================================
function applyTrig(src: string): string {
  let s = src;

  // (1) Branchless vec2 fastAcos helper. Same Eberly polynomial as fastAcos,
  //     `select` instead of `if`, evaluating BOTH horizon angles at once. This is
  //     componentwise value-identical to two fastAcos() calls (no numerical
  //     change), so it removes the per-lane branch for free.
  s = replaceOnce(
    s,
    '  if (x >= 0.0) { return o; }\n  return PI - o;\n}',
    '  if (x >= 0.0) { return o; }\n  return PI - o;\n}\n' +
      '// [trig] Branchless vec2 form of fastAcos (identical Eberly polynomial,\n' +
      '// select over if). Value-identical to fastAcos() per component; debranches\n' +
      '// and vectorizes the two horizon-angle acos calls in the bitmask hotspot.\n' +
      'fn fastAcos2(xIn : vec2<f32>) -> vec2<f32> {\n' +
      '  let x = clamp(xIn, vec2<f32>(-1.0), vec2<f32>(1.0));\n' +
      '  let ax = abs(x);\n' +
      '  var o = -0.156583 * ax + HALF_PI;\n' +
      '  o = o * sqrt(vec2<f32>(1.0) - ax);\n' +
      '  return select(PI - o, o, x >= vec2<f32>(0.0));\n' +
      '}',
    'trig:fastAcos2-helper',
  );

  // (2) Per-sample horizon acos → branchless vec2 form. The angle itself is
  //     genuinely needed here (linear cosine→sector-index map), so NO vector
  //     identity removes the acos — we only debranch + vectorize it. Exact.
  s = replaceOnce(
    s,
    '    fbh = vec2<f32>(fastAcos(fbh.x), fastAcos(fbh.y));',
    '    fbh = fastAcos2(fbh); // [trig] branchless vec2 acos (value-identical); the\n' +
      '    // angle is needed for the linear sector map, so we vectorize+debranch only.',
    'trig:fbh-acos',
  );

  // (3) Per-slice sin/cos → incremental rotation (angle-sum recurrence). The slice
  //     angle is baseAngle + i·deltaAngle, so rotate the unit slice vector by
  //     (cosΔ,sinΔ) each iteration instead of calling sin/cos(angle) per slice.
  //     EXACT to float rounding; rotationCount ≤ 4 ⇒ ≤3 rotations, drift ~1e-7
  //     (far below the 1/32 sector quantization).
  s = replaceOnce(
    s,
    '  for (var i : u32 = 0u; i < rotationCount; i = i + 1u) {\n' +
      '    let rotationAngle = (f32(i) + noiseDirection + params.temporalDirection) * (PI / f32(rotationCount));\n' +
      '    let sliceDir = vec3<f32>(cos(rotationAngle), sin(rotationAngle), 0.0);\n' +
      '    let slideDir_TexelSize = vec2<f32>(sliceDir.x, -sliceDir.y) * (1.0 / params.resolution);',
    '  // [trig] slice rotation via angle-sum recurrence (precompute cosΔ/sinΔ once,\n' +
      '  // rotate the slice vector per iteration) — removes sin/cos per slice.\n' +
      '  let trigDelta = PI / f32(rotationCount);\n' +
      '  let trigBase = (noiseDirection + params.temporalDirection) * trigDelta;\n' +
      '  let cosDelta = cos(trigDelta);\n' +
      '  let sinDelta = sin(trigDelta);\n' +
      '  var sliceCos = cos(trigBase);\n' +
      '  var sliceSin = sin(trigBase);\n' +
      '  for (var i : u32 = 0u; i < rotationCount; i = i + 1u) {\n' +
      '    let sliceDir = vec3<f32>(sliceCos, sliceSin, 0.0);\n' +
      '    let slideDir_TexelSize = vec2<f32>(sliceDir.x, -sliceDir.y) * (1.0 / params.resolution);',
    'trig:slice-recurrence-head',
  );

  // (3b) Advance the recurrence at the end of the slice loop body.
  s = replaceOnce(
    s,
    '  }\n\n  var ao = clamp(visSum / f32(rotationCount), 0.0, 1.0);',
    '    // [trig] advance slice rotation by deltaAngle (angle-sum recurrence).\n' +
      '    let nextCos = sliceCos * cosDelta - sliceSin * sinDelta;\n' +
      '    let nextSin = sliceSin * cosDelta + sliceCos * sinDelta;\n' +
      '    sliceCos = nextCos;\n' +
      '    sliceSin = nextSin;\n' +
      '  }\n\n  var ao = clamp(visSum / f32(rotationCount), 0.0, 1.0);',
    'trig:slice-recurrence-advance',
  );

  // (4) Bent-normal per-bit direction: acos then cos/sin is the EXACT vector
  //     identity cos(θ)=frac·2−1 (by construction) and sin(θ)=√(1−c²). Removes
  //     fastAcos + cos + sin (3 transcendentals → 1 sqrt); MORE accurate than the
  //     baseline's fastAcos approximation.
  s = replaceOnce(
    s,
    '          let theta = fastAcos(frac * 2.0 - 1.0);\n' +
      '          var dir = normalize(realTangent * cos(theta) + normalVS * sin(theta));',
    '          // [trig] cos(θ)=frac·2−1 by construction; sin(θ)=√(1−c²). Exact vector\n' +
      '          // identity, removes fastAcos+cos+sin.\n' +
      '          let bc = frac * 2.0 - 1.0;\n' +
      '          let bs = sqrt(max(0.0, 1.0 - bc * bc));\n' +
      '          var dir = normalize(realTangent * bc + normalVS * bs);',
    'trig:bent-identity',
  );

  // (5) Distant-light per-cap direction (salm-caps AND ssrt-fallback share the
  //     identical two lines): same exact identity cos(acos(x))=x, sin(acos(x))=
  //     √(1−x²). Off by default, applied for family consistency (alu-all).
  s = replaceAll(
    s,
    '          let angleCosine = fastAcos(cosine);\n' +
      '          var rayDir = normalize(realTangent * cos(angleCosine) + normalVS * sin(angleCosine));',
    '          // [trig] cos(acos(x))=x, sin(acos(x))=√(1−x²): exact identity.\n' +
      '          let capSin = sqrt(max(0.0, 1.0 - cosine * cosine));\n' +
      '          var rayDir = normalize(realTangent * cosine + normalVS * capSin);',
    2,
    'trig:distant-identity',
  );

  return s;
}

// =============================================================================
// loop — NEXTGEN principle 4 (loop hygiene / strength reduction)
// =============================================================================
function applyLoop(src: string): string {
  // The march-offset line appears in BOTH marchHorizonCos and horizonBitmask
  // (identical text). offset = pow(abs(stepRadius·(j+initialRayStep)/radiusVS),
  // expFactor)·radiusVS. stepRadius/radiusVS/initialRayStep are loop-invariant.
  //   - hoist radiusVSInv = 1/radiusVS (one reciprocal instead of a per-step
  //     divide);
  //   - kStep = stepRadius·radiusVSInv (invariant argument scale);
  //   - argJ = kStep·(j+initialRayStep) is AFFINE in j → advance by adding kStep
  //     each step instead of the multiply; likewise the (j+1) term.
  // pow(abs(),expFactor) stays (general exponent — not incrementally reducible).
  // Additive drift over ≤32 steps ~2e-6 rel (verified below noise vs baseline).
  return replaceAll(
    src,
    '  for (var j : u32 = 0u; j < stepCount; j = j + 1u) {\n' +
      '    let offset = pow(abs((stepRadius * (f32(j) + initialRayStep)) / radiusVS), params.expFactor) * radiusVS;\n' +
      '    let uvOffset = slideDir_TexelSize * max(offset, f32(j) + 1.0);',
    '  // [loop] hoist invariant reciprocal + strength-reduce the affine offset\n' +
      '  // argument to an add (no per-step divide/multiply of j).\n' +
      '  let radiusVSInv = 1.0 / radiusVS;\n' +
      '  let kStep = stepRadius * radiusVSInv;\n' +
      '  var argJ = kStep * initialRayStep;\n' +
      '  var jPlus1 = 1.0;\n' +
      '  for (var j : u32 = 0u; j < stepCount; j = j + 1u) {\n' +
      '    let offset = pow(abs(argJ), params.expFactor) * radiusVS;\n' +
      '    let uvOffset = slideDir_TexelSize * max(offset, jPlus1);\n' +
      '    argJ = argJ + kStep;\n' +
      '    jPlus1 = jPlus1 + 1.0;',
    2,
    'loop:offset-strength-reduction',
  );
}

// =============================================================================
// precision — NEXTGEN principle 3 (precision discipline / f16 arithmetic)
// =============================================================================
function applyPrecision(src: string): string {
  let s = src;

  // enable the f16 extension (must precede declarations; comments may precede it).
  s = replaceOnce(
    s,
    'const PI : f32 = 3.14159265359;',
    'enable f16;\n\nconst PI : f32 = 3.14159265359;',
    'precision:enable-f16',
  );

  // AO visibility fraction (per slice) in f16 — range [0,1], already 1/32
  // quantized. Accumulator visSum stays f32.
  s = replaceOnce(
    s,
    '      visSum = visSum + (1.0 - f32(countOneBits(bitfield)) / f32(MAX_RAY));',
    '      // [precision] AO visibility fraction in f16 (range [0,1], 1/32 quantized).\n' +
      '      visSum = visSum + f32(f16(1.0) - f16(countOneBits(bitfield)) / f16(32.0));',
    'precision:visSum-f16',
  );

  // GI sector-weighted radiance product in f16. weight, ndl, lndl all in [0,1];
  // lightColor is firefly-clamped to maxLuminance. Accumulator `col` stays f32 —
  // only the per-sample product is half precision. Depth/position untouched.
  s = replaceOnce(
    s,
    '          *col = *col + (f32(numOccludedZones) / f32(MAX_RAY)) * lightColor * ndl * lndl;',
    '          // [precision] sector-weighted radiance product in f16 (weight/ndl/lndl\n' +
      '          // in [0,1]; lightColor firefly-clamped). Accumulator col stays f32.\n' +
      '          let w16 = f16(numOccludedZones) / f16(32.0);\n' +
      '          let prod16 = vec3<f16>(lightColor) * (w16 * f16(ndl) * f16(lndl));\n' +
      '          *col = *col + vec3<f32>(prod16);',
    'precision:gi-product-f16',
  );

  return s;
}

// =============================================================================
// bandwidth family — shared binding-append helper
// =============================================================================
// Every appended binding is inserted right after the pristine params binding, so
// bindings 0–9 (and thus `baseline`) are never touched. Each decl carries its own
// fixed @binding index, so applying several appends in any order is safe.
const PARAMS_BINDING = '@group(0) @binding(9) var<uniform> params : Params;';
function appendBinding(src: string, decl: string, label: string): string {
  return replaceOnce(src, PARAMS_BINDING, PARAMS_BINDING + '\n' + decl, label);
}

// =============================================================================
// light-mips — NEXTGEN principle 5 (mip the light buffer for far samples)
// =============================================================================
function applyLightMips(src: string): string {
  let s = src;
  s = appendBinding(
    s,
    '// [light-mips] box-average light mip pyramid (ssrt13-light-pyramid.wgsl). mip 0\n' +
      '// is a copy of the march-res light, so near samples stay exact; far samples read\n' +
      '// a coarser (prefiltered) mip selected by the SAME distance→mip map as depth.\n' +
      '@group(0) @binding(10) var lightPyramid : texture_2d<f32>;',
    'light-mips:binding',
  );
  // GI light fetch → distance-selected light mip. lightMip = min((j+1)/2, 4) is the
  // base's own depth distance→mip formula (posSSToVSMip / mipOffset). Normal is NOT
  // mipped: averaging then re-normalizing view normals corrupts the ndl/lndl sector
  // geometry (a measured-risk we decline); the win lab 09 named is the light fetch.
  s = replaceOnce(
    s,
    '      let c = vec2<i32>(floor(sampleUV * params.resolution));\n' +
      '      var lightColor = textureLoad(lightTex, c, 0).rgb;',
    '      // [light-mips] read the light at a distance-selected mip (prefiltered far\n' +
      '      // radiance; identical to lightTex at mip 0). Same j→mip map as depth mipOpt.\n' +
      '      let lightMip = min((j + 1u) / 2u, 4u);\n' +
      '      let lmDim = vec2<f32>(params.resolution / f32(1u << lightMip));\n' +
      '      let c = vec2<i32>(floor(sampleUV * lmDim));\n' +
      '      var lightColor = textureLoad(lightPyramid, c, i32(lightMip)).rgb;',
    'light-mips:gi-fetch',
  );
  return s;
}

// =============================================================================
// hiz-skip — NEXTGEN principle 5 (hierarchical empty-space skipping, conservative)
// =============================================================================
function applyHizSkip(src: string): string {
  let s = src;
  s = appendBinding(
    s,
    '// [hiz-skip] box-MAX depth pyramid (ssrt13-depth-pyramid-max.wgsl), companion to\n' +
      '// the box-MIN depthPyramid. [min,max] brackets a coarse tile depth interval —\n' +
      '// the Hi-Z structure for conservative empty-space skipping.\n' +
      '@group(0) @binding(11) var depthPyramidMax : texture_2d<f32>;',
    'hiz-skip:binding',
  );
  // (bitmask/GI path — the default) EXACT bitfield-saturation early-out: once all 32
  // sectors are occluded no later sample can add one (current = angleBits & ~0xFFFFFFFF
  // = 0 ⇒ numOccludedZones = 0, GI gather guarded by >0, bent/distant read the final
  // bitfield unchanged). Bit-identical to running the rest of the loop.
  s = replaceOnce(
    s,
    '    lastSamplePosVS = samplePosVS;\n  }\n}',
    '    lastSamplePosVS = samplePosVS;\n' +
      '    // [hiz-skip] all 32 sectors occluded ⇒ no later sample can contribute. Exact.\n' +
      '    if (*globalBitfield == 0xFFFFFFFFu) { break; }\n  }\n}',
    'hiz-skip:saturation-break',
  );
  // (classic AO horizon path) EXACT beyond-radius coarse skip. A sample contributes
  // to cHorizon only via mix(..., distFacSq) and is EXACTLY zero once dist ≥ radius.
  // The coarse tile's CLOSEST surface (min pyramid) is a lower bound on the fine
  // sample's distance; if even that is ≥ radius the fine sample is too ⇒ skip its
  // fetch. depthPyramidMax gives the far bound so we require the WHOLE tile beyond
  // radius (both bounds) before skipping — belt-and-suspenders conservative.
  s = replaceOnce(
    s,
    '    let samplePosVS = posSSToVS(sampleUV);\n' +
      '    let pixelToSample = samplePosVS - posVS;',
    '    // [hiz-skip] coarse empty-span skip: if the tile\'s nearest surface is already\n' +
      '    // beyond the world radius, every fine sample in it contributes exactly 0.\n' +
      '    let hzMip = 3u;\n' +
      '    let hzNear = posSSToVSMip(sampleUV, hzMip); // reconstructs from min pyramid (closest)\n' +
      '    let hzDim = vec2<f32>(params.resolution / f32(1u << hzMip));\n' +
      '    let hzC = vec2<i32>(floor(sampleUV * hzDim));\n' +
      '    let hzFarD = textureLoad(depthPyramidMax, hzC, i32(hzMip)).r; // farthest in tile\n' +
      '    let hzFar = vec3<f32>(viewPosStd(sampleUV, hzFarD).xy, -viewPosStd(sampleUV, hzFarD).z);\n' +
      '    if (length(hzNear - posVS) >= params.radius && length(hzFar - posVS) >= params.radius) { continue; }\n' +
      '    let samplePosVS = posSSToVS(sampleUV);\n' +
      '    let pixelToSample = samplePosVS - posVS;',
    'hiz-skip:ao-radius-skip',
  );
  return s;
}

// =============================================================================
// checkerboard — NEXTGEN principle 5 (halve marched pixels; accumulator refills)
// =============================================================================
function applyCheckerboard(src: string): string {
  // Frame-parity checkerboard: half the pixels early-out BEFORE writing outTex, so
  // their previous march output survives one frame; the temporal frame-count
  // accumulator reprojects/averages history to refill them (advantagous-concepts:
  // demo 12/13 has the accumulator lab 09 lacked, so no temporal-stage transform is
  // needed — the fill is the existing 1/N convergence). ~2× fewer marched pixels.
  // On a still camera every pixel is marched every OTHER frame, so the accumulated
  // still converges to the baseline image (relaxed converged-only gate); the cost is
  // in-motion stability (measured as the stability delta).
  return replaceOnce(
    src,
    '  let coord = vec2<i32>(gid.xy);\n' +
      '  let uv = (vec2<f32>(gid.xy) + 0.5) / params.resolution;',
    '  let coord = vec2<i32>(gid.xy);\n' +
      '  let uv = (vec2<f32>(gid.xy) + 0.5) / params.resolution;\n' +
      '  // [checkerboard] march a frame-parity checkerboard; skipped pixels keep their\n' +
      '  // prior outTex and are refilled by the temporal accumulator. ~2× march saving.\n' +
      '  if (((u32(coord.x) + u32(coord.y) + params.frameSeed) & 1u) == 1u) { return; }',
    'checkerboard:parity-skip',
  );
}

// =============================================================================
// adaptive — NEXTGEN principle 6 (guides-driven per-pixel effort)
// =============================================================================
function applyAdaptive(src: string): string {
  let s = src;
  s = appendBinding(
    s,
    '// [adaptive] per-pixel valid-history length N from the shared TemporalGuidesPass\n' +
      '// (full-res r16float). High N ⇒ converged ⇒ coast on less effort.\n' +
      '@group(0) @binding(12) var historyLength : texture_2d<f32>;',
    'adaptive:binding',
  );
  // Per-invocation effort scale (set in main from N, read in the march functions).
  s = replaceOnce(
    s,
    'fn hasFlag(f : u32) -> bool { return (params.flags & f) != 0u; }',
    '// [adaptive] per-invocation effort scale in [0.4, 1.0]; set in main from history\n' +
      '// length N, read where rotationCount/stepCount are established.\n' +
      'var<private> gEffort : f32 = 1.0;\n' +
      '// [adaptive] deterministic A/B endpoint flags (host toggles for the paired ms\n' +
      '// measurement): fresh ⇒ full effort (post-teleport worst case); converged ⇒ min.\n' +
      'const F_ADAPT_FRESH : u32 = 65536u;\n' +
      'const F_ADAPT_CONVERGED : u32 = 131072u;\n' +
      'fn hasFlag(f : u32) -> bool { return (params.flags & f) != 0u; }',
    'adaptive:geffort-decl',
  );
  // Read N and set the effort ramp, once, in main after the view basis is known.
  s = replaceOnce(
    s,
    '  let viewDir = normalize(-posVS);\n',
    '  let viewDir = normalize(-posVS);\n' +
      '  // [adaptive] guides-driven effort ramp. N = valid history frames at this pixel\n' +
      '  // (full-res guides sampled at march-res via the pad1 block scale). N<4 ⇒ full\n' +
      '  // effort (fresh/disoccluded); N≥16 ⇒ 0.4 (converged coasts); linear between.\n' +
      '  let advCoord = vec2<i32>(vec2<f32>(coord) * max(params.pad1, 1.0));\n' +
      '  let advN = textureLoad(historyLength, advCoord, 0).r;\n' +
      '  gEffort = mix(1.0, 0.4, clamp((advN - 4.0) / 12.0, 0.0, 1.0));\n' +
      '  if ((params.flags & F_ADAPT_FRESH) != 0u) { gEffort = 1.0; }\n' +
      '  if ((params.flags & F_ADAPT_CONVERGED) != 0u) { gEffort = 0.4; }\n',
    'adaptive:effort-ramp',
  );
  // Scale the slice count (biggest cost knob after steps): converged ⇒ 1 rotation.
  s = replaceOnce(
    s,
    '  let rotationCount = max(1u, params.rotationCount);',
    '  let rotationCount = max(1u, u32(round(f32(params.rotationCount) * gEffort))); // [adaptive]',
    'adaptive:rotation-scale',
  );
  // Scale the step count in BOTH march functions (identical line in each).
  s = replaceAll(
    s,
    '  let stepCount = max(1u, params.stepCount);',
    '  let stepCount = max(1u, u32(round(f32(params.stepCount) * gEffort))); // [adaptive]',
    2,
    'adaptive:step-scale',
  );
  return s;
}

// =============================================================================
// subgroups — barrier-free intra-wave sample sharing (`enable subgroups;`)
// =============================================================================
function applySubgroups(src: string): string {
  let s = src;
  // Enable the extension and turn OFF the subgroup-uniformity diagnostic: the GI
  // light fetch we share lives inside data-dependent break/continue loops (non-
  // uniform control flow). With the diagnostic off, the subgroup builtins use
  // ACTIVE-lane semantics — subgroupAll considers only active lanes and
  // subgroupBroadcastFirst broadcasts from the first ACTIVE lane — which is exactly
  // what makes the guarded share provably-identical for the lanes that use it.
  s = replaceOnce(
    s,
    'const PI : f32 = 3.14159265359;',
    'enable subgroups;\n' +
      'diagnostic(off, subgroup_uniformity);\n\n' +
      'const PI : f32 = 3.14159265359;',
    'subgroups:enable',
  );
  // GI light fetch → subgroup coherent-fetch sharing. When the WHOLE (active)
  // subgroup wants the SAME light texel, one lane fetches and broadcasts —
  // provably identical, so bit-exact vs baseline; otherwise each lane fetches its
  // own. subgroupAll gates the broadcast so the shared value is used only when
  // every active lane agrees on the texel. (Same 2-line anchor as light-mips; the
  // two variants are never composed.)
  s = replaceOnce(
    s,
    '      let c = vec2<i32>(floor(sampleUV * params.resolution));\n' +
      '      var lightColor = textureLoad(lightTex, c, 0).rgb;',
    '      let c = vec2<i32>(floor(sampleUV * params.resolution));\n' +
      '      // [subgroups] coherent-fetch sharing (barrier-free — lab 09\'s LDS overhead\n' +
      '      // does NOT transfer). One representative fetch broadcast across the subgroup\n' +
      '      // when every active lane wants the SAME texel (provably identical ⇒ bit-exact).\n' +
      '      let cFirst = subgroupBroadcastFirst(c);\n' +
      '      let allSame = subgroupAll(c.x == cFirst.x && c.y == cFirst.y);\n' +
      '      var lightColor : vec3<f32>;\n' +
      '      if (allSame) {\n' +
      '        var lv = vec3<f32>(0.0);\n' +
      '        if (subgroupElect()) { lv = textureLoad(lightTex, cFirst, 0).rgb; }\n' +
      '        lightColor = subgroupBroadcastFirst(lv);\n' +
      '      } else {\n' +
      '        lightColor = textureLoad(lightTex, c, 0).rgb;\n' +
      '      }',
    'subgroups:gi-fetch-share',
  );
  return s;
}

// =============================================================================
// build
// =============================================================================
/**
 * Build the WGSL for a variant from the pristine march source.
 * @param baseSource  the imported ssrt13-main.wgsl text (pristine).
 * @param variant     which specialization to build.
 * @param hasF16      whether the adapter exposes shader-f16.
 */
export function buildVariant(baseSource: string, variant: Variant, hasF16: boolean, hasSubgroups: boolean): BuiltVariant {
  switch (variant) {
    case 'baseline':
      // Identity transform. Asserted byte-identical to the pristine source in
      // buildAllVariants (the frozen-fork invariant).
      return { variant, code: baseSource, available: true, note: 'pristine demo-12 march (frozen-fork control)' };
    case 'trig':
      return {
        variant,
        code: applyTrig(baseSource),
        available: true,
        note: 'angle-sum slice recurrence + exact cos/sin(acos) identities (bent/distant) + branchless vec2 acos',
      };
    case 'loop':
      return {
        variant,
        code: applyLoop(baseSource),
        available: true,
        note: 'hoisted invariant reciprocal + affine march-offset strength reduction',
      };
    case 'precision': {
      if (!hasF16) {
        return { variant, code: baseSource, available: false, note: 'unavailable: adapter lacks shader-f16' };
      }
      return {
        variant,
        code: applyPrecision(baseSource),
        available: true,
        note: 'f16 arithmetic for AO/sector/GI [0,1] quantities (depth+position stay f32)',
      };
    }
    case 'alu-all': {
      // Compose trig + loop, then precision when f16 is available. The three
      // transforms touch disjoint lines, so sequential application is safe.
      let code = applyLoop(applyTrig(baseSource));
      if (hasF16) {
        code = applyPrecision(code);
        return { variant, code, available: true, note: 'trig + loop + precision (f16) combined' };
      }
      return { variant, code, available: true, note: 'trig + loop combined (precision dropped: no shader-f16)' };
    }
    case 'light-mips':
      return {
        variant,
        code: applyLightMips(baseSource),
        available: true,
        note: 'far light samples read a distance-selected prefiltered light mip (normal left un-mipped)',
      };
    case 'hiz-skip':
      return {
        variant,
        code: applyHizSkip(baseSource),
        available: true,
        note: 'conservative empty-space skip: exact bitfield-saturation early-out + beyond-radius AO skip (min/max pyramid)',
      };
    case 'checkerboard':
      return {
        variant,
        code: applyCheckerboard(baseSource),
        available: true,
        note: 'frame-parity checkerboard march (~2× fewer marched pixels); temporal accumulator refills',
      };
    case 'adaptive':
      return {
        variant,
        code: applyAdaptive(baseSource),
        available: true,
        note: 'guides-driven per-pixel effort: N≥16 coasts (rot 1 / 0.4× steps), N<4 full; needs TemporalGuidesPass',
      };
    case 'bandwidth-all': {
      // light-mips ∘ hiz-skip ∘ adaptive — disjoint edits, sequential is safe.
      // checkerboard is EXCLUDED (documented): it double-dips adaptive's temporal
      // stability budget, so it stays a standalone measured variant.
      const code = applyAdaptive(applyHizSkip(applyLightMips(baseSource)));
      return { variant, code, available: true, note: 'light-mips + hiz-skip + adaptive composed (checkerboard excluded)' };
    }
    case 'deinterleave':
      // HOST-orchestrated (index.ts runDeinterleave): the variant's shader is the
      // PRISTINE baseline march — the CACAO reorganization (extract → 4 compact
      // dispatches → scatter) lives in the driver, not the WGSL. Its own pipeline
      // here is a baseline-identical compile (unused by the frame path, which
      // branches to the compact dispatches); kept so the enum/UI selection is valid.
      return {
        variant,
        code: baseSource,
        available: true,
        note: 'CACAO-style phase-bucket marching: 4 compact quarter-res dispatches (host-orchestrated de/interleave); march-only + chain measured',
      };
    case 'subgroups': {
      if (!hasSubgroups) {
        return { variant, code: baseSource, available: false, note: 'unavailable: adapter lacks subgroups (baseline is the documented fallback pair)' };
      }
      return {
        variant,
        code: applySubgroups(baseSource),
        available: true,
        note: 'barrier-free intra-wave GI-light fetch sharing (provably-identical subgroup broadcast; bit-exact vs baseline)',
      };
    }
  }
}

/**
 * Build every variant. `baseline` is asserted byte-identical to the pristine
 * source (the frozen-fork invariant). Unavailable variants carry available=false
 * and their pristine (baseline) code so the demo never compiles a broken shader.
 */
export function buildAllVariants(baseSource: string, hasF16: boolean, hasSubgroups: boolean): Record<Variant, BuiltVariant> {
  const out = {} as Record<Variant, BuiltVariant>;
  for (const v of VARIANTS) out[v] = buildVariant(baseSource, v, hasF16, hasSubgroups);
  // Frozen-fork assertion: baseline generated text === pristine source string.
  if (out.baseline.code !== baseSource) {
    throw new Error('[variants] baseline is not byte-identical to the pristine march source');
  }
  return out;
}
