# Demo 12 — Distilled SSGI v0 (NEXTGEN Phase D)

**Our own SSGI**, first cut. Demo 03's SSRT3 compute-pipeline *shape* with the
measured Phase-T winners swapped in, **UNOPTIMIZED** — the academic-style code of
each parent kept verbatim wherever possible (no trig identities, no branch
restructuring, no precision tricks). This is the **Phase-O control**: the thing
every optimization variant (demo 13) must be measured against.

It is a **frozen fork**, not an import: every WGSL/TS file it builds on was
*copied* into `12-distilled/` (`ssrt12-*.wgsl`), never `?raw`-imported from demo
03/09. Cross-demo `?raw` is silent interface coupling — the frozen-fork lesson
from lab 10 (WORKLOG 2026-07-21). The bench (00–11) stays a faithful measuring
instrument; our work happens here.

## Ingredient provenance

Each ingredient, its parent demo/lab, the track/lab that validated it, and the
verdict commit (`bench/results/trackE-bakeoff.md`, synthesized at `7f80b84`).

| ingredient | parent | validated by | verdict |
| --- | --- | --- | --- |
| **base pipeline** (fixed y-mirror marcher, VBAO 32-bit bitmask, §3.2 probe fallback, lightmask multibounce, depth-mip pyramid, temporal, copydepth, bilateral denoise, composite) | `03-ssrt3` | trackE verdict 1 — "SSRT3-style compute march wins quality-per-ms" | trackE-bakeoff.md, `7f80b84` |
| **half-res chain** (downsample → march at march-res → joint-bilateral upsample), default **half** | `09-bandwidth` (`ssrt09-downsample.wgsl`, `ssrt09-upsample.wgsl`) | lab 09 / trackE verdict 3 — "the march is the budget everywhere; half-res+joint-bilateral 3.8–5.4× on the dominant term" | lab09-bandwidth, trackE `7f80b84` |
| **noise: IGN + per-frame temporal advance**, default **ign** (enum {ign, white}) | `11-sampling` (`sampling.wgsl` `ign`/`ignTemporal`) | lab 11 verdict | lab11-noise-mse, `7f80b84` |
| **accumulation: frame-count 1/N**, default **frame-count** (ssrt3-ema kept as toggle) | `03-ssrt3` own `accumMode` | trackC / trackE verdict 2 — "count-based, decisively" (frame-count 0.31 vs ema 1.06) | trackC-temporal, trackE `7f80b84` |
| **thickness: Ottosson occluder-adaptive (3clGWB)**, default **ottosson** (constant/linear kept as toggles) | `08-distant-light` (`gt-distant.wgsl` heuristic 2) | lab 08 verdict — "removes the thin-fence halo + thick-plate leak from one base" | lab08-shots, `7f80b84` |
| **distant light: salm-caps spherical caps** alongside SSRT3 §3.2 fallback (enum {off, ssrt-fallback, salm-caps}) | `08-distant-light` (`gt-distant.wgsl` lightMethod 1) | lab 08 verdict — "sample it — and use Salm caps" | lab08-shots, `7f80b84` |
| **reference views + A/B comparator** (reference/split/diff, divider drag) | shared `harness/reference-pass.ts` + `compare.ts` (demo 03 wiring) | — | — |

## Pipeline (per frame)

1. G-buffer (full res).
2. **Lightmask** (full res): `beauty + reproject(prev denoised GI)·mbDamping`.
3. **Downsample** (full → march res, lab 09): box-MIN depth (r32float),
   min-depth normal, box-avg light.
4. **Depth pyramid** (march res): box-MIN mips 0..4 built from the *march-res*
   depth (so `mipOptimization` stays self-consistent at half/quarter res).
5. **Main march** (march res): VBAO bitmask + GI gather + distant light, reading
   the downsampled G-buffer + pyramid + env. IGN noise, Ottosson thickness.
6. **Joint-bilateral upsample** (march → full res, lab 09), guided by the
   full-res depth+normal. Skipped at `marchScale=full` (march is already full res).
7. **Temporal** reproject (full res): frame-count 1/N accumulation (default).
8. **Copy-depth** refresh (full res) for next frame's reprojection reject.
9. **Bilateral denoise** (full res) → `finalTex`.
10. Composite / oracle comparator / display.

At `marchScale=full` the downsample is 1:1 and the upsample is skipped, so the
chain **degenerates to demo 03** (plus one downsample copy) — the equal-quality
control point.

## Capability adds (NEXTGEN P4)

Additive capabilities (Phase D allows them — they are not optimizations). Each
is a toggle; with all off the demo is bit-identical to pre-P4.

- **Bent normals + visible cone from the bitmask** (`bentNormals`, default ON).
  During the slice loop, for each UNOCCLUDED sector bit the demo rebuilds that
  sector's slice-plane direction with the SAME `realTangent`/`normalVS` basis the
  occlusion test + salm-caps use (bit *i* → hemisphere fraction (i+0.5)/32 →
  θ = acos(2f−1); dir = realTangent·cos θ + normalVS·sin θ, then project out
  planeNormal — deriving from that exact basis, never from re-computed raw
  angles, is the y-convention safeguard). Summed over slices → centroid = bent
  normal; visible-bit fraction = `visibleCone`. Written to a NEW rgba16float
  texture (xyz = **standard three view-space** bent normal, w = cone); near-free
  at march time. When OFF the extra binding is still present (no pipeline
  permutation) but never written, and the demo is bit-identical to pre-P4.
- **Specular occlusion in the composite** (`specOcclusion`, default OFF — see
  Decisions). Adds a directionally-correct ambient (bent-normal diffuse) + env
  specular term, the specular attenuated by Lagarde specular occlusion
  (`so = saturate(pow(NoV+cone, exp2(−16·rough−1)) − 1 + cone)`, Frostbite PBR
  3.0, 2014). The old composite path is kept verbatim when off.
- **Two-sided depth thickness** (`thicknessHeuristic = two-sided`, default stays
  `ottosson`). A back-face depth-only prepass (BackSide override material,
  rendered at MARCH resolution) gives the real occluder interval [frontZ, backZ];
  the march marks sectors only within it. Samples with no back face (sky) fall
  back to Ottosson per-sample. Kills the halo/leak tradeoff instead of tuning it.
- **Oracle bent normal + comparison views.** The shared `ReferencePass`,
  constructed here with `{ accumulateBentNormals: true }`, accumulates a
  ground-truth bent normal (2nd MRT target: xyz = Σ unoccluded ray dirs, w =
  count) via a `fsBent` variant of `reference-marcher.wgsl` (the base `fs` is
  byte-identical, so demos 02/04/05 are untouched). New views: `bent` (demo bent
  normal ·0.5+0.5), `bent-ref` (oracle, lazy), `bent-diff` (angular error
  0°..45° → black..white, ×diffAmp).

## Params & URL overrides

Tweakpane groups: `distillation` (marchScale, noise, thicknessHeuristic,
distantLight), `sampling`, `GI`, `occlusion`, `distant light`, `bent normals`
(bentNormals, specOcclusion, specRoughness, spec/ambient gains), `temporal &
denoise`, `reference`. Every control carries a `hint:` tooltip.

URL overrides (deterministic capture): `view` (incl. `bent`/`bent-ref`/
`bent-diff`), `mscale` (full/half/quarter), `noise` (ign/white), `thick`
(constant/linear/ottosson/two-sided), `distant` (off/ssrt-fallback/salm-caps),
`accum` (ssrt3-ema/frame-count), `bitmask`, `gi`, `temporal`, `denoise`, `mbao`,
`mip`, `na`, `bn` (bentNormals), `so` (specOcclusion), `mb`, `sc`, `rc`,
`radius`, `thickness`.

Fenced bench hook `window.__bench12`: `config({scale,rc,sc,radius})`, `march(n)`
(main march only), `chain(n)` (down+march+up), `total(n)` (full compute chain
incl. lightmask+temporal+denoise). M3 `onSubmittedWorkDone` fence, avg ms/iter.

## Acceptance

`node scripts/run-12.mjs [--quick]` → `bench/results/demo12-acceptance.{json,md}`.
Cells C-wide + S-hall: fenced `total` at half + full, screenshot MSE of combined
vs the demo's own converged oracle, and the still-camera stability metric — each
row scored pass/fail against demo 03's recorded numbers (quoted in the JSON
`meta` from trackB-budget + trackA-quality). GPU ms under the live rAF loop is
contention-prone; treat totals as smoke unless run in isolation.

## Decisions logged for review (best-guess, not silent)

- **Distant light defaults OFF.** Lab 08's verdict is "sample it, use salm-caps",
  but the fork's Cornell env is a dim *neutral* (near-ambient, no dominant
  direction) and the oracle models `skyIntensity=0` (closed box). Defaulting
  distant light ON would add ambient energy the oracle doesn't model and inflate
  the control's MSE-vs-oracle. So the ingredient is **integrated and one toggle
  away** (salm-caps is the recommended non-off mode per lab 08), but the *default*
  is the safe control value `off`. Confirm whether the shipped control should
  carry distant light on.
- **salm-caps direction reconstruction.** salm-caps ports lab 08's *structure*
  (grouped caps, partial popcount, one env sample per cap weighted by visible bit
  count) but reconstructs each cap-centre direction with demo 03's own
  `realTangent`/`normalVS` basis, **not** the exact `SliceRelCDFInverse_Cos` from
  wcsXDN. This mirrors lab 08's own logged deviation (it too swapped the per-cap
  direction). Faithful structure; the exact-CDF direction is a follow-up.
- **IGN advance on top of the SSRT3 cycle.** IGN's per-frame temporal advance
  (frameSeed) replaces demo 03's `rand`/`gradientNoise`, but demo 03's
  6-rotation/4-offset `temporalOffset/temporalDirection` cycle is kept *added on
  top* (it is demo 03's structure, not a random source). The IGN advance
  decorrelates within a frame; the SSRT3 cycle across frames. Both feed temporal
  accumulation. Redundant but faithful — not silently dropped.
- **Ottosson thickness × mip pyramid coexist.** The occluder-size estimate tracks
  `occluderStartingPos`/`previousPos` across march samples; with `mipOptimization`
  those samples come from coarser mips over distance. They coexist (no extra
  fetch — the heuristic reads whatever mip the march already read); the
  screen-parallel reset can be slightly noisier across mip transitions. Kept both
  at their verdict defaults (ottosson + mip on); flagged for the Phase-O interaction
  matrix. The occluder-scale jitter (`2^(2·rnd−1)`) is drawn from IGN channel w
  and averaged out temporally, per gt-distant.wgsl.
- **F_LINEAR_THICKNESS / F_FALLBACK flag bits retired.** Both are now enums
  (`thicknessHeuristic`, `distantLightMode`); the flag constants are kept in the
  WGSL for bit-position stability but unused.

### P4 capability adds

- **`specOcclusion` defaults OFF (deviation from the P4 packet's "default ON when
  bentNormals on").** Same reasoning as distant light: the specular-occlusion
  path adds ambient/env energy the closed-Cornell oracle (`skyIntensity=0`) does
  not model, which would inflate the P3 control's combined-vs-oracle MSE and
  defeat the control's purpose. `bentNormals` stays ON by default (it only writes
  a texture — the combined composite is unchanged while `specOcclusion` is off,
  verified: parity MSE vs a pre-P4 capture ≈ 8e-6, noise-floor). The capability
  is one toggle away and A/B-able. Confirm whether the shipped default should
  carry specular occlusion on.
- **Demo bent normal reuses salm-caps' direction reconstruction.** The per-sector
  direction uses the same `realTangent`/`normalVS` basis and uniform-in-cosine
  sector spacing (`θ = acos(2·(i+0.5)/32 − 1)`) that salm-caps uses — inheriting
  its documented approximation (not the exact CDF-inverse). This is the *closest*
  in-codebase match to the cosine-weighted oracle. `bent-diff` shows a mid-grey
  ~20–25° mean angular error (at diffAmp=1) that is **invariant to
  rotationCount**, i.e. a weighting/estimator gap (uniform-sector centroid vs
  cosine-weighted visibility, confined to slice planes), NOT a convention bug —
  `bent` and `bent-ref` are orientation-identical. The demo bent normal is
  un-denoised (single-frame); a temporally-accumulated bent buffer would tighten
  the comparison (follow-up, not implemented).
- **Two-sided depth renders at MARCH resolution** (a BackSide `overrideMaterial`
  depth-only pass), not full-res-then-downsampled — simpler and correct (the
  march reads it at march-res coords; no extra downsample pass). Bound to the
  march always (as a `depth` binding); when the heuristic isn't `two-sided` the
  full-res scene depth is bound as a never-read placeholder, so no pipeline
  permutation and near-zero cost when off. At the tested poses (C-wide, Z-zoo
  default) the ottosson-vs-two-sided delta is small (screenshot meanAbsDiff
  0.12–0.56, MSE-vs-oracle within rounding) — the thin-fence/thick-plate wins
  need a grazing close-up to manifest; the A/B row is wired for that graded run.
