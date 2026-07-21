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

export const VARIANTS = ['baseline', 'trig', 'loop', 'precision', 'alu-all'] as const;
export type Variant = (typeof VARIANTS)[number];

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
// build
// =============================================================================
/**
 * Build the WGSL for a variant from the pristine march source.
 * @param baseSource  the imported ssrt13-main.wgsl text (pristine).
 * @param variant     which specialization to build.
 * @param hasF16      whether the adapter exposes shader-f16.
 */
export function buildVariant(baseSource: string, variant: Variant, hasF16: boolean): BuiltVariant {
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
  }
}

/**
 * Build every variant. `baseline` is asserted byte-identical to the pristine
 * source (the frozen-fork invariant). Unavailable variants carry available=false
 * and their pristine (baseline) code so the demo never compiles a broken shader.
 */
export function buildAllVariants(baseSource: string, hasF16: boolean): Record<Variant, BuiltVariant> {
  const out = {} as Record<Variant, BuiltVariant>;
  for (const v of VARIANTS) out[v] = buildVariant(baseSource, v, hasF16);
  // Frozen-fork assertion: baseline generated text === pristine source string.
  if (out.baseline.code !== baseSource) {
    throw new Error('[variants] baseline is not byte-identical to the pristine march source');
  }
  return out;
}
