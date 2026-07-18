# Demo 04 — GT-VBAO

Mirko Salm's **cosine-weighted Ground-Truth Visibility-Bitmask AO** ported to our
real perspective G-buffer as a raw WGSL fragment pass. GT-VBAO's founding claim is
that it **converges to the same result a brute-force screen-space ray marcher
converges to** — so this demo pairs it with the shared **ground-truth reference**
(`src/harness/reference-pass.ts`, `ReferencePass`) and can show it directly,
wipe it against GT-VBAO, or heat-map their difference.

## Reference views (`reference` / `split` / `diff`)

Three view modes drive the shared `ReferencePass`:

- `reference` — the converged brute-force ground-truth AO on its own.
- `split` — GT-VBAO (left of a draggable divider) | reference (right).
- `diff` — `|GT-VBAO − reference|` amplified by `diff amp` (alpha/AO channel).

**Lazy-run contract:** the reference marcher is expensive, so it only runs while
one of these three views is the active view (parked otherwise — `combined`/`ao`/
`beauty` pay zero reference cost). On activation it restarts accumulation from
the current camera pose; it converges over ~2-4s on a static camera and resets on
any camera movement. GT-VBAO and the reference accumulate **independently** (each
divided by its own sample count). Reference sampling params live in the
`reference` sub-folder (`ref rays/frame`, `ref steps`, `ref radius`, `diff amp`).

Pinned to **three@0.185.1**.

## Lineage

Ported from **Mirko Salm / TinyTexel "GT-VBAO"** (Shadertoy
[XXGSDd](https://www.shadertoy.com/view/XXGSDd)), **Buffer C `GTVBAO()`**
(`research/sources/shadertoy/XXGSDd/{buffer-c,common}.glsl`), the **LIVE**
2026-07-17 capture (post `GetQuaternion` +z→−z fix). Salm's shader renders a toy
analytic g-buffer with a hand-rolled projection; here it drives three's real
`projectionMatrix`/inverse + depth buffer + view-space normals (three MRT). The
reference oracle is the shared `ReferencePass` (`src/harness/reference-pass.ts`,
wrapping `reference-marcher.wgsl`), unchanged from demo 02's algorithm.

Implemented as a **raw fragment pass** (`RawRenderPass`, additive-blend
accumulation) — same mechanism demo 02 validated, and it keeps the door open to a
compute variant in the bandwidth lab (09) without changing the algorithm.

## The algorithm (what GT-VBAO does per pixel, per slice)

1. Pick a **slice** — a screen-space direction `dir` plus the view-space vector
   `smplDirVS` it projects from. With *slice importance sampling* on (default) the
   direction is drawn from Salm's approximate cosine-lobe distribution
   (`SampleSliceDir`, mode 3); off → uniform, with an analytic per-slice weight
   (mode 1).
2. Build the slice frame: `sliceN = cross(V, smplDirVS)`, project the normal into
   the slice plane (`projN`), get the signed normal angle `angN`.
3. **March the depth buffer bidirectionally** (`±dir`) in screen space, geometric
   step schedule out to `marchWidthPx` pixels. Each depth sample becomes a
   front/back angular interval (via `thickness`), remapped through the
   cosine-weighted **slice-relative CDF**, and rasterised into a **32-bit
   occlusion bitmask** (`occBits`).
4. AO for the slice = `1 − popcount(occBits)/32`. Average over slices, accumulate
   over frames.

The bitmask is the whole point: overlapping occluders along a slice merge in the
mask instead of each subtracting AO independently, so thin/near geometry doesn't
over-darken (see the artifact-zoo plates below).

## Coordinate conventions — the handedness trap (read this)

Salm's view space is right-handed with **+z INTO the scene** (camera looks down
+z); a visible surface has `positionVS.z > 0` and `V = -normalize(pos)` has
`V.z < 0`. His LIVE `GetQuaternion` fix sets the reference direction
`from = (0,0,-1)` **precisely because his V points to −z** — that keeps the
`from→V` rotation well-conditioned (`dot(from,V) ≈ +1` for a central pixel; the
old `from=(0,0,+1)` gave `≈ −1`, a singular quaternion → the NaNs the fix cured).

**three's view space is right-handed with +z toward the viewer** (camera looks
down −z): a visible surface has `viewPos.z < 0`, and `V` has `V.z > 0`
(`V ≈ (0,0,+1)` centrally). To port the LIVE fix faithfully under three's opposite
z-convention, the reference direction must be **mirrored to `from = (0,0,+1)`** —
the *same* fix (reference axis aligned with V, well-conditioned), reflected for
the handedness. That is `getQuatToV()` in `gt-vbao.wgsl`. Everything else stays in
three view space; the screen-space slice direction is derived by **projecting
`smplDirVS` through three's real projection matrix**, so the screen↔view
orientation is pinned by the projection (not hand-signed) and the bidirectional
march / horizon signs stay internally consistent regardless of handedness.

Other conventions inherited from demo 02: framebuffer/UV origin **top-left**
(`ndc.y = 1 − 2·uv.y`), clip-z in `[0,1]`, view positions reconstructed via the
inverse projection.

## Validation (the point of this demo)

Converged GT-VBAO A/B-diffed against demo 02's converged reference AO on Cornell,
512 accumulated frames each (`bench/screenshots/04-*.png`, cached Playwright
chromium-1228, `--enable-unsafe-webgpu`):

- `04-cornell-ao` (GT-VBAO) vs `04-cornell-reference` — visually near-identical:
  contact darkening at box bases, corner/edge darkening, soft floor occlusion.
- `04-cornell-split` — split-screen (GT left, reference right): **the AO gradient
  crosses the divider with no seam** — the founding claim, demonstrated.
- `04-cornell-diff` — amplified abs-diff (×8): **dominated by high-frequency
  sampling noise, no solid systematic-bias regions.** The two estimators sample
  differently (bitmask slices vs. cosine rays) so their residual Monte-Carlo noise
  differs; the *means* agree. The largest structured residual is at grazing wall
  edges, from the subtly different finite-thickness behaviour of a bitmask horizon
  vs. a first-hit slab (expected; see thickness note).
- `04-zoo-ao` / `04-zoo-split` — artifact-zoo graded thin plates: contact AO at
  the plate/floor and plate/wall seams **without darkening the thin plate faces
  themselves** — the bitmask win over naive over-darkening. Geometry matches the
  reference seamlessly across the split.
- `04-sponza-ao` — renders at `renderScale 0.5`, no errors; local AO in the vault
  creases and arch contacts (subtle because `thickness 0.5` is small on Sponza's
  ~30-unit scale — thickness is per-scene).

## Params

- `slices/frame`, `steps/slice` — samples (compound with accumulated frames).
- `march width (px)` — screen-space geometric march extent (Salm's
  `Raymarching_Width`, 512). GT-VBAO is horizon/screen-space; there is no world
  radius, this is the analog.
- `thickness (world)` — finite-slab depth. **World-space, scene-scale dependent**
  (0.5 tuned to Cornell's 5.5-unit box; Sponza/zoo differ).
- `normal bias` — ray-origin offset off the surface (self-occlusion guard).
- `falloff` — optional smooth distance attenuation of far occluders (0 = off;
  Salm has none — kept as a bench knob).
- `acos approx` — Salm's improved `ACos_Approx` vs. real `acos` in the inner loop.
  Per Salm the improved approximation is accurate enough that "there is basically
  no reason not to" use it; the toggle is here to show it.
- `slice importance` — mode 3 (approx cosine importance sampling) vs. mode 1
  (uniform + analytic slice weight). Both converge to the same AO; mode 3 has the
  better per-frame noise profile.
- `thickness: normalize` — Salm's two `deltaPosBack` variants. Default (off) is
  the `VPos_from_SPos` behaviour (view-z pushed back by `thickness`, matches the
  reference marcher); on is the faster `normalize` variant (a slightly different
  finite-thickness assumption — Salm's own note, `threejs/notes.md`).
- `accumulate` / `max frames` — frozen-camera convergence (reset on camera move /
  param change / resize).
- `ref rays/frame`, `ref steps`, `ref radius` — the shared oracle's params
  (its `thickness` is slaved to GT-VBAO's for a fair AO comparison). Changing them
  restarts only the reference accumulation, not GT-VBAO's.
- `diff amp` — diff-view amplification. `split`/`diff` are now **view modes**
  (not a separate `A/B mode` param). URL: `?view=reference|split|diff`;
  `?cmp=split|diff` still selects the matching view for back-compat.

## Decisions for review

- **Reference axis `from = (0,0,+1)`** (mirror of the LIVE `(0,0,-1)` fix) — the
  faithful port of the fix under three's z-convention, see the handedness section.
  The alternative (rebase every G-buffer vector into Salm's +z-into-scene frame
  and use `(0,0,-1)` literally) needs a handedness-preserving 180° rotation, not a
  bare z-negation (a z-flip alone reflects handedness and breaks the cross
  products) — more moving parts, same result. Chose the mirror.
- **White-noise RNG** (PCG hash of pixel⊕frame⊕slice), not Salm's blue-noise
  texture / R1-Hilbert. We accumulate to convergence, where the noise *source*
  doesn't change the converged value (Salm: mode 2 + white noise converges exactly
  to the reference). Blue/IGN/spatiotemporal noise is demo 11's job; the harness
  has no blue-noise texture yet.
- **`thickness: normalize` default OFF** (the `VPos_from_SPos` variant) so GT-VBAO
  and the reference marcher share the *same* finite-thickness assumption — the
  fairest convergence test. Salm defaults the same way and for the same reason.
- **Background/void AO = 1** (fully open) — physically sensible for compositing
  (`beauty·AO` leaves the background unchanged). Demo 02's reference marcher
  outputs **0** for sky, so in `split`/`diff` the *empty void* (e.g. above the zoo
  back wall) reads as a spurious difference. Ignore the void — the geometry, which
  is what the AO comparison is about, agrees seamlessly.
- **Reference marcher is the shared `ReferencePass`** (`src/harness/reference-pass.ts`,
  wrapping `src/harness/reference-marcher.wgsl`) rather than duplicated, so the
  oracle can't drift from demo 02's validated one.
- **Falloff** is a bench addition (not in Salm's GT-VBAO). Left at 0 by default so
  the converged result matches the reference; it exists for later quality tuning.

## Known limitations

- Screen-space only (shares the reference's own limits by design).
- `thickness` / `march width` are Cornell-tuned defaults; retune per scene.
- The amplified diff looks noisy because it amplifies residual Monte-Carlo noise
  ×`diffAmp`; that is noise, not bias (the split is seamless).
