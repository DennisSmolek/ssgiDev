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

## Phase-2 variant family (BANDWIDTH — NEXTGEN principle 5/6)

Where the wins actually live: lab 09 and P5.1 both proved the march is **fetch-
bound**, so the P5.2 family attacks the *fetches* (and per-pixel effort), not the
ALU. The bandwidth variants need extra fetch structures (a prefiltered light mip
pyramid, a companion box-MAX depth pyramid, and the shared temporal-guides history
buffer). These are wired as **appended march bindings 10/11/12**, so the pristine
bindings 0–9 — and thus `baseline`'s byte-identical assertion — are untouched;
every variant shares the one 13-entry layout and a shader that references only a
subset of the bound textures is valid WebGPU. The pyramids/guides are built **lazily**
(only when the active variant reads them), mirroring `ReferencePass`.

### `light-mips` — principle 5 (mip the light buffer for far samples)

New pass `ssrt13-light-pyramid.wgsl` (box-**average** rgba16float, one dispatch per
level; mip 0 is a copy so near samples stay exact). The GI light fetch selects the
mip by step distance using the **same `j→mip` map the base uses for depth**
(`min((j+1)/2, 4)`). Cuts the uncorrelated global light fetches lab 09 named as the
win cap; the average is also a prefilter (fewer far-sample fireflies). **Normal is
deliberately NOT mipped** — averaging then re-normalizing view normals corrupts the
`ndl`/`lndl` sector geometry (a measured-risk we decline). Converged MSE-vs-baseline
~1.6e-5.

### `hiz-skip` — principle 5 (conservative empty-space skipping)

New pass `ssrt13-depth-pyramid-max.wgsl` builds the **box-MAX** companion to the
existing box-MIN pyramid (second pyramid, kept separate rather than packing min/max
into `rg`, so the min pass + consumers stay frozen). `[min,max]` brackets a coarse
tile's depth interval — the Hi-Z structure. The skip is realized as two **provably
contribution-free** early-outs so the output is **bit-identical to baseline**
(measured MSE 9.3e-6, within the temporal noise floor):

- **bitmask/GI path (default):** once all 32 sectors are occluded, `current =
  angleBits & ~0xFFFFFFFF = 0` for every later sample ⇒ `numOccludedZones = 0` (GI
  gather guarded, bent/distant read the final bitfield) — an **exact** `break`.
- **classic AO path:** a sample contributes to `cHorizon` only via `mix(…, distFacSq)`
  and is exactly zero once `dist ≥ radius`. The coarse tile's nearest surface (min
  pyramid) lower-bounds the fine sample's distance; if even that (and the max-pyramid
  far bound) is beyond `radius`, the fine fetch is skipped. Exact.

The full angular-interval Hi-Z traversal (the max bound's larger payoff, non-trivial
under the flip/remap) is scoped as a documented follow-up; the exact wins above are
what ship. Note: the AO-path skip reads the min pyramid, so it assumes
`mipOptimization` (on by default; the bandwidth path force-builds it otherwise).

### `checkerboard` — principle 5 (halve marched pixels)

A **frame-parity checkerboard**: `((x+y+frameSeed)&1)` pixels early-out *before*
writing `outTex`, so their previous march output survives one frame and the temporal
**frame-count accumulator** reprojects/averages history to refill them — the fill
machinery lab 09 lacked (demo 12/13 has it). **March-only transform**: no temporal-
stage edit is needed because the accumulator IS the fill (the alternative two-file
transform was available but redundant). ~2× fewer marched pixels; a still camera
marches every pixel every *other* frame so the accumulated still converges to the
baseline (converged MSE 2.5e-5). The cost is in-motion stability — the recorded
**`stability_delta`** column.

### `adaptive` — principle 6 (guides-driven per-pixel effort)

Wires the shared `TemporalGuidesPass` (**lazy** — only when this variant is active).
The march reads per-pixel history length `N` (binding 12, full-res guides sampled at
march res via the `pad1` block scale) and scales a per-invocation `gEffort`:
`N<4 ⇒ 1.0` (fresh/disoccluded, full budget), `N≥16 ⇒ 0.4` (converged, coasts),
linear between. `gEffort` scales **rotationCount** (converged ⇒ 1 slice) and
**stepCount** in both march functions. The `F_ADAPT_FRESH`/`F_ADAPT_CONVERGED` flag
bits let the runner pin the effort endpoints for a deterministic ms A/B without
waiting on the live guides. Converged MSE 6e-4 (below the 1e-3 relaxed gate); the
still march is ~2.8× cheaper than fresh (measured).

### `bandwidth-all` — the composable subset

`light-mips ∘ hiz-skip ∘ adaptive` (disjoint edits, sequential like `alu-all`).
**`checkerboard` is deliberately excluded**: it is an orthogonal temporal-rate trade
that double-dips adaptive's temporal stability budget (stacking half-rate marching on
top of reduced-effort marching compounds the in-motion instability), so it stays a
standalone measured variant.

## Phase-3 variant family (SCHEDULED HEIRS — NEXTGEN P5)

The two production heirs the LSAO notes name (`research/sources/papers/lsao-
timonen2013-notes.md`): CACAO-style deinterleaved marching and a WebGPU subgroup
experiment. Both run against the frozen `baseline` (byte-identical assertion intact).

### `deinterleave` — CACAO-style phase-bucket marching (Dennis's MUST-DO)

Splits the march-res grid into 4 (2×2) **phase buckets**; each bucket marches its
OWN **compact quarter-res image** — a stride-2 phase subsample of the downsampled
G-buffer — so its fetches have **4× tighter spatial locality** (neighbouring compact
threads sample neighbouring world positions at the SAME phase). The production heir
(Intel ASSAO → AMD FidelityFX CACAO) to LSAO's coherence goal, and bitmask-compatible:
it reorganizes WHERE fetches land, not the estimator.

**Host-orchestrated** (`index.ts` `runDeinterleave`), so the variant's WGSL is the
**pristine baseline march** — the reorganization is in the driver:

1. `ssrt13-deinterleave.wgsl` EXTRACT: bucket `(bx,by)` → compact texel `(cx,cy)` ←
   march-res texel `(cx*2+bx, cy*2+by)` (depth/normal/light).
2. 4 dispatches of the pristine baseline pipeline on the compact buffers, at compact
   res (compact `halfProjScale`, mipOpt cleared, a decorrelated per-bucket `frameSeed`).
3. `ssrt13-interleave.wgsl` SCATTER: compact output → march-res `(cx*2+bx, cy*2+by)`.
   After 4 buckets `marchOut`/`marchBent` are fully repopulated → shared upsample.

**Semantics vs baseline (relaxed 1e-3 CONVERGED gate).** The converged image matches
baseline closely (measured MSE 1.5e-4 / 3.5e-5, oracle unchanged). Documented sources
of the residual difference: (a) per-bucket **stride-2 depth decimation** — each pixel
effectively marches a quarter-res-of-full depth field; (b) a **half-compact-texel
phase-registration offset** (the pristine march reconstructs from compact uv, not the
bucket's exact march-res uv); (c) **mipOpt disabled** on the compact pass; (d) the
**decorrelated per-bucket noise seed** — the converged image is noise-phase-independent
(Monte-Carlo expectation), so this costs transient stability, not converged accuracy.
Runner reports **march_ms** (the 4 compact dispatches) AND **chain_ms** (incl. the
de/interleave passes) — the overhead only shows in the chain.

### `subgroups` — barrier-free intra-wave sample sharing (feature-gated PAIR)

`enable subgroups;` + `diagnostic(off, subgroup_uniformity);`. The GI light fetch shares
one representative fetch across the subgroup **only when `subgroupAll` agrees every
active lane wants the SAME texel** (one lane `subgroupElect`s + fetches,
`subgroupBroadcastFirst` distributes); else each lane fetches itself. **Provably
identical ⇒ bit-exact vs baseline** (exact 1e-4 gate). Barrier-free, so lab 09's
LDS-overhead argument does not transfer. The subgroup builtins sit inside the GI
gather's data-dependent (non-uniform) control flow; with the uniformity diagnostic off
they use ACTIVE-lane semantics, which the `subgroupAll` guard makes safe.

**Feature-gated (standing rule).** Built only when `adapter.features.has('subgroups')`
(CONFIRMED on this adapter); when absent it reports **`unavailable`** and **the BASELINE
is the documented fallback** — the pair requirement is satisfied by baseline being the
feature-free path.

## Measurement — `run-13.mjs`

Paired A/B per variant vs baseline, **back-to-back for thermal pairing**, cells
C-wide + S-hall:

`--family alu|bandwidth|phase3|all` (default `all`) selects the variant set; the
output name defaults to `demo13-<family>` (override with `--out`). `phase3` also
records **chain_ms** for `deinterleave` (baseline vs variant, incl. de/interleave).

- **(a)** fenced `__bench13` march ms — baseline then variant back-to-back, each a
  warm-up dispatch + min-of-bursts; `ms_ratio = baseline/variant` (>1 = faster).
  For **adaptive/bandwidth-all** the ratio uses the CONVERGED (still) effort;
  `march_ms_converged`/`march_ms_fresh` are the deterministic effort endpoints and
  `march_ms_teleport` is a live **post-teleport** burst (via `window.__cam.set`) —
  the honest motion cost while the guides read 'fresh'.
- **(b)** screenshot **MSE of the variant's CONVERGED combined view vs BASELINE's**
  — the primary correctness gate. `gate_mse` is 1e-4 for exact/conservative variants
  (**incl. hiz-skip**, which must be bit-identical) and 1e-3 **converged-only** for
  the in-motion-lossy variants (checkerboard, adaptive, bandwidth-all).
- **(c)** screenshot MSE vs the **oracle** reference (quality-unchanged check).
- **(d)** stability metric + **`stability_delta`** vs baseline (checkerboard's cost).

Acceptance per variant (recorded pass/fail, misses **not hidden**):
`pass_ms` (march strictly < paired baseline), `pass_baseline` (MSE-vs-baseline ≤
`gate_mse`), `pass_oracle` (MSE-vs-oracle within noise of baseline's). Output:
`writeResults('demo13-<family>', …)`. `--quick` for a smoke run (stamped "not a
recorded number"; 2 bursts so a contended burst is filtered).

Fenced hook `window.__bench13`: `config({scale,rc,sc,radius})`, `march(n)`,
`chain(n)`, `total(n)` (all on the active variant), plus `variants()`,
`setVariant(name)`, `activeVariant()`, `setEffortMode('auto'|'fresh'|'converged')`
(adaptive effort-endpoint pin for deterministic A/B).

## Findings so far (smoke — not recorded numbers)

**ALU (P5.1, recorded):** base-vs-base control ratio **1.00** (no order bias);
`trig` ~equal (±2%), loop/precision ~0×. Exactly principle 5's prediction — the
march is **fetch-bound**, so pure-ALU rearrangement is ~0× (lab 09). `trig` kept
available (exact, zero-risk); loop/precision not defaulted.

**BANDWIDTH (P5.2, smoke — not recorded numbers):** the win is **adaptive effort
(principle 6), not raw fetch reduction.**

| variant | C-wide | S-hall | MSE-vs-base | stability Δ |
|---|---|---|---|---|
| light-mips | 1.11× | 1.00× | 1.6e-5 | −0.03 |
| hiz-skip | 1.08× | 0.96× | ~1e-5 (bit-identical) | ~0 |
| checkerboard | 1.04× | 0.97× | 2.4e-5 | +0.31…+0.41 |
| adaptive | **3.39×** | **2.88×** | 6e-4 / 1.6e-4 | +0.11 / +0.05 |
| bandwidth-all | 3.17× | 2.90× | 6e-4 / 1.7e-4 | +0.17 / +0.06 |

On this already-half-res march the pure fetch cuts are a wash (light-mips small,
hiz-skip bit-identical but ~0× — the sector bitfield rarely fully saturates at
stepCount 12, so the exact early-out fires seldom). **checkerboard is a documented
negative**: a per-thread `return` saves little march ms (the workgroup still
dispatches all threads) while costing real in-motion stability (Δ +0.3–0.4); a true
2× needs a compacted dispatch. **adaptive banks ~3× on stills** and honestly
degrades to ≈baseline when fresh (deterministic fresh endpoint ≈ baseline ms) — the
lever that closes the C-wide 2× gap, free on motion. All variants pass their gates.
Recorded verdict is the orchestrator's isolated run.

**PHASE3 (P5.3, smoke — not recorded numbers):** the two scheduled heirs work but
neither banks a perf win on this half-res march.

| variant | cell | march ratio | chain ratio | MSE-vs-base | gate |
|---|---|---|---|---|---|
| deinterleave | C-wide | 0.77–1.07× | **0.93×** | 1.5e-4 | 1e-3 ✓ |
| deinterleave | S-hall | **0.79×** | **0.78×** | 3.5e-5 | 1e-3 ✓ |
| subgroups | C-wide | 1.19× | — | **1.0e-5** | 1e-4 ✓ |
| subgroups | S-hall | 1.07× | — | 1.2e-5 | 1e-4 ✓ |

**deinterleave is a documented perf NEGATIVE, correct on image**: the converged
image matches baseline (oracle unchanged) but the **chain is consistently slower**
(0.78–0.93×) — the 4-dispatch split + extract/scatter overhead exceeds the cache
gain on an already-half-res march (the compact quarter-res images already fit L2 —
lab 09's LDS ceiling again). CACAO earns its keep at full-res AO with cache-hostile
radii; here the coherence headroom was already spent by half-res + P5.2 `adaptive`.
Run for completeness (Dennis's must-do); a compacted single-dispatch (quadrant-tiled)
bucket layout is the noted follow-up. **subgroups is a small zero-risk WIN, bit-exact**
(passes the exact 1e-4 gate): the guarded provably-identical broadcast is correct, and
the ~1.07–1.19× march win is a freebie like `trig` (low coherent far-fetch hit-rate on
a per-pixel march), not a lever. The `enable subgroups;` availability path is exercised
and correct on this adapter; the feature-gated fallback pair (baseline) is wired.

## Provenance addendum (P5.3)

New WGSL passes owned by demo 13: `ssrt13-deinterleave.wgsl` (extract one 2×2 phase
bucket to a compact quarter-res G-buffer), `ssrt13-interleave.wgsl` (scatter a bucket's
compact march output back to march res). `deinterleave` reuses the pristine baseline
march pipeline (no new march shader — the CACAO reorganization is host-side in
`runDeinterleave`). `subgroups` is a string transform of the pristine march
(`applySubgroups`), feature-gated on `subgroups` with baseline as the fallback pair.

## Provenance addendum (P5.2)

New WGSL passes owned by demo 13: `ssrt13-light-pyramid.wgsl` (box-average light mip
pyramid), `ssrt13-depth-pyramid-max.wgsl` (box-MAX companion to the box-MIN
`ssrt13-depth-pyramid.wgsl`). The `adaptive` variant consumes the shared
`harness/temporal-guides.ts` `TemporalGuidesPass` (FSR3-BRIEF product) exactly as
demo 10 does — constructed always (cheap), `update()` only while active.
