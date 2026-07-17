# Demo 05 — GT-VBGI

Salm's **Ground-Truth Visibility-Bitmask GI** — the diffuse single-bounce GI
successor to GT-VBAO — ported to our real G-buffer as one demo with a **variant
switch**. AO comes with it for free (same bitmask). Validated against demo 02's
converged reference GI on Cornell.

Pinned to **three@0.185.1**. Built directly on demo 04's GT-VBAO groundwork
(shared slice construction, screen-space bitmask march, handedness handling).

## Lineage & variants (`variant` param)

All from the LIVE 2026-07-17 Shadertoy captures (post `GetQuaternion` +z→−z fix),
Buffer C:

| variant            | source            | what differs                                        |
| ------------------ | ----------------- | --------------------------------------------------- |
| `bidirectional`    | [lfdBWn](https://www.shadertoy.com/view/lfdBWn) `GTVBGI()` | full ±dir march, cosine weighting (default) |
| `unidirectional`   | [XcdBWf](https://www.shadertoy.com/view/XcdBWf) `uniGTVBGI()` | **single** march dir, half the depth samples; full-2π slice-dir sampling picks the side per pixel/frame, `w0` partial-slice remap compensates |
| `uniform-weighted` | [XfcBDl](https://www.shadertoy.com/view/XfcBDl) / [4cdfzf](https://www.shadertoy.com/view/4cdfzf) | uniform hemisphere weighting via `SliceRelCDF_Uniform` (polynomial — no acos in the slice weighting) |

The GI extension over GT-VBAO is the **bidirectional-gather bit trick**: at each
depth sample the *newly-visible* bits (`occBits0 & ~occBits`) weight that sample's
beauty-buffer radiance — so radiance arriving through the not-yet-occluded part of
the hemisphere is integrated in one screen-space march. AO is `1 − popcount(occBits)/32`
from the same mask.

Coordinate conventions and the handedness trap are identical to demo 04 — see its
README (reference axis `from = (0,0,+1)`, the mirror of Salm's LIVE `(0,0,-1)` fix
for three's opposite view-space z convention; screen-space slice direction derived
by projecting `smplDirVS` through three's real projection matrix).

Implemented as a **raw fragment pass** with additive-blend accumulation; the demo
02 reference marcher runs alongside as the GI oracle.

## GI compositing (the PR #31839 trap)

GT-VBGI gathers **unmodulated** radiance (`radiance · visibility`); **albedo
modulation happens at composite**:

```
combined = beauty · AO  +  albedo · GI · giStrength
```

This is the three PR #31839 requirement (GI must be modulated by surface albedo at
composite, not added raw). Firefly clamp is a per-sample luminance cap (`fireflyClamp`,
default 10 — PLAN trap: SSGINode hardcodes 7, here it's tunable).

## Validation

Converged (512 frames) on Cornell, screenshots `bench/screenshots/05-*.png`
(cached Playwright chromium-1228, `--enable-unsafe-webgpu`):

- `05-cornell-gi-bi` (GT-VBGI bidirectional, raw GI) vs `05-cornell-reference-gi`
  (demo 02 reference GI): **both show the canonical Cornell color bleed** — red
  from the left wall onto the tall box's left face and floor, green from the right
  wall onto the short box and floor — at comparable magnitude. The dominant GI
  signal (wall/floor/tall-box bleed) converges to the reference.
- `05-cornell-split-gi` — split (GT left, reference right): the wall/floor color
  bleed **crosses the divider seamlessly**. Honest caveat: the **short box** (a
  bright surface near the ceiling light) gathers a little *less* near-field
  top-face bounce than the brute-force reference — screen-space horizon GI
  under-reaches the bright near-light region within `marchWidthPx`. The bulk GI
  agrees; this near-field surface is the visible residual.
- `05-cornell-combined` — `beauty·AO + albedo·GI`: a convincing Cornell render
  (red/green walls, lit boxes, contact AO, soft indirect fill).
- **Variant comparison** (same view, `05-cornell-gi-{bi,uni,uniform}`): converged,
  all three land on the same GI. **Unidirectional is visibly noisier per-frame**
  (half the depth samples, single march dir) — as expected and as Salm notes; it
  is *denoiser-dependent* by design (PLAN: 05 unidirectional needs the temporal
  contract). **Uniform-weighted** is a touch softer/flatter (uniform vs cosine
  hemisphere weighting) and slightly cheaper (no acos in the weighting).
- `05-zoo-combined` / `05-sponza-combined` — both render (Sponza at `renderScale
  0.5`), no errors: zoo shows colored plate-to-plate/floor bleed; Sponza shows
  banner color bleed onto stone + arch/pillar contact AO.

## Params

Demo-04 set (slices/steps, march width, thickness, bias, acos approx, slice
importance, thickness normalize, accumulate/max frames, reference oracle) plus:

- `variant` — bidirectional / unidirectional / uniform-weighted (above). URL:
  `?variant=<name>`.
- `backface reject` — reject radiance from back-facing samples (light emitted away
  from the receiver). Salm's non-simple heuristic: project the sample normal into
  the slice, build a visibility sub-mask, AND it with the visible bits. Improves GI
  correctness; on by default.
- `firefly clamp` — per-sample max luminance (tunable, default 10).
- `GI strength` — composite multiplier on the albedo-modulated bounce.
- `GI display gain` — view-only exposure for the (dim) raw-GI/`reference` debug
  views; does not affect stored values.
- `A/B channel` — `rgb` (GI) or `alpha` (AO) for the comparator. URL: `?view=` /
  `?cmp=split|diff`.

## Decisions for review

- **Unidirectional slice-dir sampling = uniform full-2π (mode 1)**, not Salm's
  `SamplePartialSliceDir` importance sampler (mode 3). Salm's partial-slice
  importance sampler pulls in `SamplePartialSlice` + `ArcTan11` + their own
  approximations — a meaningful extra surface for a noise-only win. Uniform 2π
  sampling + the `w0` partial-slice remap + the mode-1 `slice_weight`
  (`projNLen·(cosN + angN·sinN)`) and `w = 2−2·w0` corrections **converge to the
  same result**, just noisier per frame — which is the honest per-variant tradeoff
  we want to show anyway. Upgrading unidirectional to mode-3 importance sampling
  is a clean follow-up if its converged noise matters.
- **`wcsXDN` slice-relative direction mapping — LOGGED AND SKIPPED for demo 05.**
  wcsXDN's mapping is explicitly *"for distant light sampling and light probe
  sampling"* (its own description) — it belongs to the ambient/distant-light labs
  (07/08, `wc2SzR`/`wcfGWB` territory), not the core screen-space GI gather. It
  doesn't compose into the beauty-buffer bounce this demo does without pulling in
  the distant-light machinery, so per the "compose cleanly else skip" instruction
  it's deferred to those labs.
- **March-direction start bug (found & fixed during bring-up):** the shared march
  loop starts at `d = -1.0` for the bidirectional ±dir sweep; unidirectional must
  start at `d = +1.0` (its horizon math drops the `·d` sign and uses the
  `SliceRelCDF_Cos(…, true)` far-half branch). Starting unidirectional at `−1.0`
  marched backwards and produced a near-black frame — fixed via
  `d = select(-1.0, 1.0, unidirectional)`. Kept as a note because it's an easy
  regression to reintroduce.
- **White-noise RNG**, background AO = 1 / GI = 0, reference marcher imported from
  demo 02 — same rationale as demo 04 (see its README).
- **Near-field short-box GI under-gather** (validation above) is a genuine
  screen-space-GI limitation, not a coordinate bug (the color bleed is seamless);
  documented rather than hidden.

## Known limitations

- Screen-space single bounce; no multibounce (that's demo 03f / 06).
- Unidirectional is denoiser-dependent by design (noisy per-frame); the harness
  temporal contract (reprojection/accumulation) is where it becomes practical.
- `thickness` / `march width` are Cornell-tuned; retune per scene.
