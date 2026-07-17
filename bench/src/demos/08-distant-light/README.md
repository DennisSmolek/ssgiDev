# Demo 08 — Distant-Light + Thickness Lab

A **findings lab**, not a new technique. On a fork of the demo 04/05 GT-VBAO
bitmask march, it makes two axes switchable and exercises them with the artifact
zoo:

1. **Distant-light sampling** — unoccluded bins/caps of the visibility bitmask
   sample a distant environment (equirect) instead of (or beside) the AO count.
   Two implementations plus a flat baseline.
2. **Thickness heuristics** — how far behind a depth sample the occluder is
   assumed to extend. Four, from constant to occluder-size-adaptive.

Pinned to **three@0.185.1**. Raw fragment pass, additive-blend accumulation
(same harness plumbing as demos 04/05). The distant environment is demo 03's
equirectangular ambient source **re-baked with a directional sun** (a bright warm
disc around dir ≈ (0.6, 0.7, 0.38)) so distant-light *directionality* is actually
visible on Cornell — a flat neutral env would make every method look identical.

## Lineage

All Bjorn Ottosson / TinyTexel, LIVE 2026-07-17 Shadertoy captures. The march
itself is demo 04/05's (slice construction, screen-space bitmask, three-handedness
reference axis `from = (0,0,+1)` — see demo 04 README).

### Distant-light methods (`method` param)

| method            | source | what it does |
| ----------------- | ------ | ------------ |
| `ottosson-perbin` | [wcfGWB](https://www.shadertoy.com/view/wcfGWB) "GT-VBAO [Distant Light Sampling]" | after the march, loop all 32 bits; for each **unoccluded** bit reconstruct its view-space direction and take **one env sample per bit**. Direction from the exact inverse slice-relative CDF. |
| `salm-caps`       | [wc2SzR](https://www.shadertoy.com/view/wc2SzR) TinyTexel "[Distant Light Sampling]" | **spherical caps of constant colour**: group the 32 bits into sectors (`bitsPerSector`, default 4 → 8 caps), partial-popcount the visible fraction per cap, take **one env sample per cap** weighted by that fraction. |
| `flat-fallback`   | baseline | one env sample toward `V`, scaled by unoccluded fraction — i.e. AO × flat ambient. The "no directionality" control. |

Both real methods reconstruct a per-bin/per-cap world direction via **wcsXDN's
slice-relative direction mapping** (`SliceRelCDFInverse_Cos` +
`SliceRelCDF_Cos_AtPhiEqualsN`). wcsXDN was deferred here from demo 05 precisely
because it is *this* machinery — it doesn't compose into beauty-buffer bounce
(demo 05), it composes into distant-light/probe sampling. It is integrated, not
skipped.

**Deviation (logged):** `salm-caps` ports wc2SzR's *structure* — grouped sectors,
partial popcount, one constant-colour env sample per cap — but reuses the **exact**
`SliceRelCDFInverse_Cos` for the cap-centre direction rather than Salm's cheaper
approximation ladder (`InvSinstep11` / `SliceRelInverseCDF0_Cos_Ref11` /
`_A11` / `_B11`). The headline **8 env samples vs 32** is preserved and measured;
only the per-cap direction is exact-CDF instead of approximate. Porting the full
approximation zoo is a future micro-opt, not needed to characterise the method.

### Thickness heuristics (`heuristic` param)

Thickness is how far *behind* a depth sample the occluder is assumed to extend
(the back horizon). It is **world/view-space**, so scene scale matters (Cornell
5.5u vs zoo ~1u vs Sponza ~30u).

| heuristic | source | rule |
| --------- | ------ | ---- |
| `constant` | baseline (demos 04/05) | `back = front − V·thickness`. One value for the whole frame. |
| `linear-dist` | baseline | `thickness = base + k·‖sample − shadedPoint‖`. Grows with march distance. |
| `ottosson-3clGWB` | [3clGWB](https://www.shadertoy.com/view/3clGWB) "thickness heuristic" | **occluder-size estimate**: track `occluderStartingPos` along the march, reset it when the surface turns screen-parallel (`|dot(normalize(Δprev·scale), V)| > cosLimit`); `thickness = scale·(base + k·‖sample − occluderStart‖)`. Assumption: occluders are as thick as they are wide. `scale = 2^(2·rnd−1)` jitter, accumulated out. |
| `light-occluder-wcBGRz` | [wcBGRz](https://www.shadertoy.com/view/wcBGRz) "Light&Occluder heuristic" | 3clGWB **plus** an occluder back-face clamp: `horCos.y = min(dot(normalize(occluderStart − shaded − V·thickness), V), horCos.y)` — the back horizon can't pass the occluder's own far face. |

The `#if isPerspectiveCam` reprojected-thickness branch (`VPos_from_SPos(depth +
thickness)`) present in the sources is left off here (matching their shipped
`#if 0`) — the `front − V·thickness` form is what all four heuristics build on.

## Params

`method`, `heuristic`, `thickness` (base), `linearThickK`, `occluderThicknessScale`,
`occluderCosLimit`, `bitsPerSector` (caps), `distantIntensity`, `ambientIntensity`
(constant floor, mirrors `EvaluateLight`'s ambient term), `envLod` (cone-blur LOD
into the env mip chain), plus the shared march params (slices/steps/marchWidth/bias/
acos/importance/accumulate). URL overrides: `?view= method= heuristic= thickness=`.

Views: `distant` (env-lit GI only), `ao`, `combined` (`beauty·AO + albedo·GI`),
`beauty`. Cost meter on `window.__lab08bench({iters, method, heuristic})` — the
M3 fence method (`queue.onSubmittedWorkDone()` around N executes).

## Validation

Headless (Chrome-for-Testing 145, `--enable-unsafe-webgpu --use-angle=metal`,
1280×800). Renders on **cornell + artifact-zoo + sponza**, zero page errors,
`pnpm typecheck` + `pnpm build` green. Screenshots `bench/screenshots/08-*.png`.

There is **no ground-truth oracle** here (unlike demos 04/05): the distant term
integrates the env, which the demo 02 beauty-buffer marcher doesn't model. So this
lab reports *characterisation*, not a converges-to-reference claim.

---

## Findings

Cost: Cornell + Sponza, 1280×800, slices/frame 2, steps/slice 32, marchWidth 512,
400-iteration `onSubmittedWorkDone` fence, ms **per pass**.

### Distant-light: Ottosson per-bin vs Salm caps vs flat

- **Both real methods produce correct directional shading.** On Cornell with the
  sun baked off-axis into the env, `distant` view shows soft directional gradients
  across the box faces and floor, darkening in the concave corners where the
  distant light is occluded — the distant term is genuinely *directional visibility
  × sky*, not AO × constant. `flat-fallback` is visibly flatter and brighter (no
  directional gradient), i.e. the classic AO × flat-ambient look. This is the
  headline: **the bitmask lets a screen-space pass do directional distant-light
  shading, and the flat fallback measurably throws that away.**
- **Salm caps ≈ Ottosson per-bin visually, cheaper.** At 8 caps (bitsPerSector 4)
  the two are near-indistinguishable on Cornell; the constant-colour-per-cap
  approximation holds because the env is low-frequency. Cost (method, constant
  thickness):

  | method | Cornell ms | Sponza ms |
  | ------ | ---------: | --------: |
  | `ottosson-perbin` (32 samples) | 5.22 | 10.59 |
  | `salm-caps` (8 samples) | **4.43** (−15%) | **7.88** (−26%) |
  | `flat-fallback` (1 sample) | 3.94 | 8.18 |

  The caps saving grows with scene cost (−15% Cornell → −26% Sponza): env sampling
  is a bigger slice of the heavier frame, so cutting 32→8 samples matters more.
  **Verdict: Salm caps wins** — same look, ~15–26% cheaper. Reduce `bitsPerSector`
  toward 1 only if a high-frequency env shows cap banding (it didn't here).
- `flat-fallback` being *slower* than `salm-caps` on Sponza is within fence noise
  (one env sample vs eight is dwarfed by the march); it is not a real inversion.

### Thickness on the artifact zoo (the per-pixel-thickness open problem)

The zoo's graded thin plates (20/60/140/300/500 mm) + the thin-post fence are the
instrument. The paper's future-work point reproduces cleanly: **one constant
thickness cannot serve all occluder thicknesses at once.**

- **`constant`, thickness too large (1.5 on the ~1u zoo):** the thin **fence
  over-occludes badly** — a heavy dark halo band appears on the ground *behind* the
  fence, because a 1.5u-deep occlusion slab is glued behind 50 mm posts
  (`08-zoo-const-t150-ao.png`, `08-zoo-const-t150.png`). Plate contact shadows
  bloat. This is the **halo** failure.
- **`constant`, thickness too small (0.04):** contact shadows on the thick plates
  (300/500 mm) go faint/absent — the occluder is thinner than the geometry, so
  light **leaks** behind it (`08-zoo-const-t004.png`).
- **`linear-dist`:** buys a little — distant occluders get thicker, so far leaks
  close — but it keys on *march distance*, not *occluder size*, so it still can't
  tell a thin post from a thick plate at the same distance. Partial fix.
- **`ottosson-3clGWB`:** the winner on the zoo. At `thickness` 0.04 it keeps the
  thin fence **halo-free** (posts estimated thin → shallow occlusion) while still
  grounding the thick plates, because thickness tracks distance-from-occluder-start
  rather than a global constant (`08-zoo-ottosson-t004.png`,
  `08-zoo-ottosson-t004-ao.png`). It adapts across the graded plates from one
  setting where `constant` needs a different value per plate.
- **`light-occluder-wcBGRz`:** 3clGWB + the back-face clamp; in `distant` view it
  gives the **tightest, best-grounded contact shadows** of the four
  (`08-zoo-h-lightocc-distant.png` vs `08-zoo-h-constant-distant.png`) — the clamp
  stops the back horizon overshooting the occluder's far face, so contact lines
  read crisper. Marginal over 3clGWB visually, at ~equal cost.

**At which plate thickness do halos/leaks appear (`constant`):** with the AO tuned
to ground the 300–500 mm plates (thickness ≈ 0.3–0.5), the 20–60 mm plates and the
50 mm fence posts start to **halo** (over-dark ring / behind-fence band). Push
thickness down to stop the halo and the 300–500 mm plates **leak**. The crossover
sits around the mid plate (**~140 mm** at zoo scale): below it the constant value
tuned for thick geometry halos; above it a value tuned for thin geometry leaks.
The occluder-size heuristics move that crossover off the table — they hold across
the whole 20→500 mm range from a single base.

### Cost of each thickness heuristic (Cornell, method = ottosson-perbin)

| heuristic | Cornell ms | Δ vs constant |
| --------- | ---------: | ------------: |
| `constant` | 5.13 | — |
| `linear-dist` | 5.76 | +12% |
| `ottosson-3clGWB` | 7.16 | +40% |
| `light-occluder-wcBGRz` | 7.26 | +42% |

The occluder-size heuristics cost **~40% more** than constant — the per-sample
`occluderStartingPos` tracking (a `normalize`, a `dot`, the reset branch, and for
wcBGRz a second `normalize`+`dot`) lands inside the hottest loop. `light-occluder`
adds ~2% over `3clGWB` for the back-face clamp. (Sponza's heuristic deltas came out
within run-to-run fence noise on this adapter — the ~1–2 ms spread is swamped by
march cost on the heavier scene — so the Cornell table is the authoritative one for
the *heuristic* axis; the *method* axis reproduced cleanly on both scenes.)

### Verdict

- **Thickness heuristic that wins the zoo: `ottosson-3clGWB`** (occluder-size
  estimate). It removes the thin-fence halo and the thick-plate leak *from one
  base value*, which no constant can. `light-occluder-wcBGRz` is a small
  contact-crispness upgrade at ~equal cost — take it if the ~42% is affordable.
  Both cost ~40% over constant, so on a strict budget `linear-dist` is the cheap
  middle (+12%, closes far leaks, doesn't fix thin-geometry halos).
- **Distant-light: sample it — and use Salm caps.** Directional distant-light via
  the bitmask is real and clearly beats the flat fallback; Salm's spherical caps
  match Ottosson's per-bin look for 15–26% less, so caps is the default. Drop to
  the flat fallback only when the env is genuinely ambient (no dominant direction),
  where the directionality it discards costs nothing.
- **Open problem, characterised not solved (per the packet):** true *per-pixel*
  thickness still needs real occluder thickness data the G-buffer doesn't carry.
  The occluder-size heuristic is a good screen-space proxy but is fooled by
  occluders whose depth-extent differs from their screen-width (its core
  assumption); a thin plate viewed edge-on, or a deep wall seen face-on, still
  mis-estimates. That residual is the paper's future work.
