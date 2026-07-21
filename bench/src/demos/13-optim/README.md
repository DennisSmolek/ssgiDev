# Demo 13 — Optimization Lab (NEXTGEN Phase O)

Demo 12 (distilled SSGI v0) **frozen-forked again**, plus ONE addition: a
compile-time `variant` mechanism that specializes the march kernel per NEXTGEN
optimization principle. Each variant is measured back-to-back against `baseline`
(the pristine demo-12 march) in `bench/scripts/run-13.mjs`.

This is a **lab**, not a shipping demo: variants are hypotheses, and a variant
that measures no faster (or slower) is a valid **recorded negative result**
(NEXTGEN standing rule; lab 09 is the model). Numbers here are the correctness
gate + a smoke signal; the recorded perf numbers come from the orchestrator's
isolated run.

## Frozen-fork provenance

`ssrt13-*.wgsl` are **byte-identical copies** of demo 12's `ssrt12-*.wgsl`
(verified `diff`). The other passes (temporal / denoise / lightmask / pyramid /
downsample / upsample / copydepth) are used verbatim. Only the **march**
(`ssrt13-main.wgsl`) is specialized, and only at build time via string transforms
in `variants.ts` — the file on disk is never edited, so `baseline` is asserted
**byte-identical to the pristine source** (`buildAllVariants` throws otherwise).
This is the frozen-fork rule: cross-demo `?raw` coupling breaks silently when a
source's bindings drift (WORKLOG 2026-07-21), so demo 13 owns its own copies.

All of demo 12's P4 capabilities (bent normals, spec occlusion, two-sided
thickness, oracle bent view) are carried over unchanged and default to their P4
values. Variants touch **only the march**.

## The `variant` mechanism

`variants.ts` turns the pristine march text into per-variant WGSL by anchoring on
**exact substrings** and asserting the expected occurrence count (so upstream
drift fails loudly at build time, never silently no-ops). Each variant compiles
to its **own `RawComputePass` pipeline**; the binding layout is identical across
all of them, so one `resources[]` array drives any. The active pipeline is
selected by the `variant` enum param (group "optimization") or `?variant=` URL
override; `__bench13.setVariant()` drives it from the runner.

`baseline` → the pristine demo-12 march (the Phase-O control).

## Phase-1 variant family (ALU)

### `trig` — NEXTGEN principle 1 (trig avoidance / IQ noacos)

| replacement | identity | exactness |
|---|---|---|
| per-slice `sin/cos(rotationAngle)` → incremental **angle-sum recurrence** (precompute `cosΔ/sinΔ`, rotate the slice vector each iteration) | rotationAngle(i) = base + i·Δ | **exact** to float rounding; ≤3 rotations, drift ~1e-7 ≪ 1/32 sector |
| bent-normal per-bit `dir = realTangent·cos(acos(2f−1)) + normalVS·sin(acos(2f−1))` → `c = 2f−1; s = √(1−c²)` | `cos(acos(x))=x`, `sin(acos(x))=√(1−x²)` | **exact** vector identity — removes fastAcos+cos+sin; *more* accurate than baseline's fastAcos |
| distant-light per-cap (salm-caps + ssrt-fallback, same 2 lines) `acos`→`cos/sin` | same identity | **exact** (default OFF; applied for family consistency) |
| per-sample horizon `fastAcos(fbh.x/.y)` → branchless `fastAcos2(fbh)` (vec2, `select` over `if`) | same Eberly polynomial | **value-identical** — the angle is genuinely needed for the linear cosine→sector map, so no vector identity removes it; we only vectorize + debranch |

The bent/distant identities remove an *approximation* (fastAcos) in favour of the
*exact* form, so `combined` (default: bent normals write a separate texture, spec
occlusion OFF) is unaffected — measured MSE-vs-baseline ~1e-6.

### `loop` — NEXTGEN principle 4 (loop hygiene / strength reduction)

Named target (both `marchHorizonCos` and `horizonBitmask`):
`offset = pow(abs(stepRadius·(j+initialRayStep)/radiusVS), expFactor)·radiusVS`.

- hoist `radiusVSInv = 1/radiusVS` (one reciprocal instead of a per-step divide);
- `kStep = stepRadius·radiusVSInv` (invariant argument scale);
- `argJ = kStep·(j+initialRayStep)` is **affine in j** → advance by adding `kStep`
  each step (strength-reduce the multiply); likewise the `(j+1)` term.
- `pow(abs(),expFactor)` stays — general exponent, not incrementally reducible.

Additive drift over ≤32 steps ~2e-6 rel — **verified below noise** (MSE-vs-baseline
~1e-6). The recurrence advances immediately after use, before any `break`/`continue`.

### `precision` — NEXTGEN principle 3 (precision discipline / f16)

`enable f16;` + f16 arithmetic for the **value-range-proven** hot quantities:

- the GI **sector-weighted radiance product** (weight = occludedZones/32, `ndl`,
  `lndl` all ∈ [0,1]; `lightColor` firefly-clamped) — accumulator `col` stays f32;
- the per-slice **AO visibility fraction** (∈ [0,1], 1/32 quantized) — `visSum`
  stays f32.

**Depth + position reconstruction STAY f32** (load-bearing, NEXTGEN principle 3).
This is a deliberately *conservative* f16 scope (directions derived from positions
also stay f32); a deeper conversion is the natural follow-up if this shows promise.

**Feature-gated (standing rule):** the variant is generated only when the adapter
exposes `shader-f16` (probed via `ctx.capabilities.features` / `device.features`).
When absent it reports **`unavailable`** in the UI + runner and falls back to the
baseline pipeline rather than compiling a broken shader. (`shader-f16` is CONFIRMED
on the dev adapter — WORKLOG 2026-07-21.)

### `alu-all` — the three composed

`trig ∘ loop ∘ precision` (the transforms touch disjoint lines, so sequential
application is safe). When `shader-f16` is absent, precision is dropped and
`alu-all` = `trig ∘ loop` (reported in its note).

## Measurement — `run-13.mjs`

Paired A/B per variant vs baseline, **back-to-back for thermal pairing**, cells
C-wide + S-hall:

- **(a)** fenced `__bench13` march ms — baseline then variant back-to-back, each a
  warm-up dispatch + min-of-bursts; `ms_ratio = baseline/variant` (>1 = faster).
- **(b)** screenshot **MSE of the variant's combined view vs BASELINE's** — the
  primary correctness gate (target ≤ ~1e-4 at identical settings/noise).
- **(c)** screenshot MSE vs the **oracle** reference (quality-unchanged check).
- **(d)** stability metric.

Acceptance per variant (recorded pass/fail, misses **not hidden**):
`pass_ms` (march strictly < paired baseline), `pass_baseline` (MSE-vs-baseline ≤
1e-4), `pass_oracle` (MSE-vs-oracle within noise of baseline's). Output:
`writeResults('demo13-alu', …)`. `--quick` for a smoke run (stamped "not a
recorded number"; 2 bursts so a contended burst is filtered).

Fenced hook `window.__bench13`: `config({scale,rc,sc,radius})`, `march(n)`,
`chain(n)`, `total(n)` (all on the active variant), plus `variants()`,
`setVariant(name)`, `activeVariant()`.

## Findings so far (smoke — not recorded numbers)

At the **full methodology** (bursts=3×40 + warm-up), a base-vs-base control shows
ratio **1.00** (no measurement-order bias), and `trig` vs baseline is **~equal**
(within ~2%). This is exactly NEXTGEN principle 5's prediction — the march is
**fetch-bound**, so pure-ALU rearrangement is ~0× (lab 09). All variants pass the
correctness gates (MSE-vs-baseline ~1e-6, MSE-vs-oracle unchanged). The recorded
verdict — win, wash, or documented negative — is the orchestrator's isolated run.
