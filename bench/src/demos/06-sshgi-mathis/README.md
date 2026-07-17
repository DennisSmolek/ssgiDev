# Demo 06 — SSHGI (Mathis's Screen Space Horizon GI)

A full port of **Mathis's "Screen Space Horizon GI"** (Shadertoy
[dsGBzW](https://www.shadertoy.com/view/dsGBzW), Oct 2023) onto our real G-buffer.
Captured source in `research/sources/shadertoy/dsGBzW/`.

This is an **independent third branch** of the SSILVB lineage: it implements the
paper [arXiv 2301.11376](https://arxiv.org/pdf/2301.11376.pdf) *directly* (cites
it in-shader), predates Salm's GT-VBGI shaders, and shares no code with SSRT3.
Its value to the bench: the only captured source shipping the **complete loop
self-contained and known-stable** — bitmask GI + multibounce + temporal
accumulation + a bilateral denoiser all working together. It is the **stability
anchor** for validating demo 03(f) multibounce and a baseline recipe for the
denoise lab (10).

Pinned to **three@0.185.1**.

## Buffer graph: Mathis's toy → our real G-buffer

Mathis is a 5-pass Shadertoy that ray-traces its own analytic room. We keep his
pass structure verbatim but replace the ray-traced scene with three's MRT
(depth + view-normal + beauty + albedo + velocity):

| Mathis pass | role | our pass |
| ----------- | ---- | -------- |
| **Buffer A** | scene G-buffer; packs `.x` = reprojected accumulated GI (multibounce feedback) / emission | `sshgi-source.wgsl` — three gives the G-buffer, so this only reproduces the `.x` packing: `source = beauty + feedback·reproject(accumGI)` |
| **Buffer B** | bitmask horizon GI march | `sshgi-march.wgsl` — the core algorithm, direct port |
| **Buffer C** | reproject + adaptive bilateral + accumulate (albedo modulation here) | `sshgi-accum.wgsl` |
| **Buffer D** | copy G-buffer for next-frame reprojection | `sshgi-gcopy.wgsl` — stores (linearZ, normal) |
| **Image**    | ACES tonemap of accumulated GI | `sshgi-compose.wgsl` — view select + tonemap, resolves the ping-pong into a stable target the TSL display blits |

Per frame: `gbuffer → source → march → accum → gcopy → compose → display`, then
`histGI`/`histG` ping-pong `advance()`. Two `HistoryTarget`s: `histGI`
(rgb = albedo-modulated indirect, a = per-pixel accumulation count) and `histG`
(the Buffer D copy). Everything runs at `renderSize` via `textureLoad`; the TSL
display upscales.

## His semantic choices (preserved even where they differ from the paper / SSRT3 / Salm)

These are Mathis's *interpretation* of Algorithm 1. Per the milestone brief they
are preserved as-is; the differences are the finding.

1. **4 single-sided horizons at 90° azimuth spacing** — NOT 2 double-sided
   slices. Each horizon integrates elevations in `[0, π/2]` on **one side only**
   (`+SSDir`); the 4 directions tile the azimuth circle. GTAO / the paper's usual
   framing integrate each slice bidirectionally.
2. **Two different angular scales in one sample.** The 32-bit mask spans the
   `[0, π/2]` elevation quarter (`bin = angle/(π/2)·32`), but the energy weight
   uses `cos(angle/64·π)²` — his `I64 = 1/64` constant. So the occlusion mask and
   the cosine weight are on **different divisors (32 vs 64)**. Kept verbatim.
3. **Weight = `(newBits/spanBits)·radiance·(cos(lo)²−cos(hi)²)·sqrt(max(0, dot(sampleN,−dirToSample)))`.**
   The facing term is `sqrt` of the **emitter's** facing (a soft backface reject
   on the light sample), and there is **no explicit receiver `N·L` cosine** in the
   inner loop — the projected-solid-angle `cos²` difference plays that role. Salm
   / demo 02 instead cosine-sample the receiver hemisphere. Different estimator.
4. **Straight screen-space horizons.** His own note: horizons are "straight in
   screen space but not necessarily in world space" (true horizons curve). Shared
   family limitation.
5. **Albedo modulation at the *accumulation* step** (`NewPixel·albedo` in Buffer
   C), not at final composite — so `histGI` stores **outgoing** indirect radiance,
   which is exactly what the feedback re-gathers for multibounce. Satisfies the
   PLAN albedo-modulation trap (PR #31839), just at a different stage than demo 01/02.
6. **Adaptive bilateral up to 5×5** despite the in-shader "3×3 bilateral" comment:
   the radius shrinks as the temporal history grows (`ceil(1.99 − count·0.25)`),
   so fresh pixels blur wider and converged pixels tighten to 3×3. We port the
   code (adaptive), not the comment.
7. **Multibounce is implicit-feedback = 1.0 in the toy.** He stores/reads the
   *full* accumulated GI each frame; convergence is guaranteed only by
   `albedo < 1` attenuating the geometric series. See "feedback" below.

## Our adaptations (logged)

- **Beauty as the light source.** Mathis's toy has no direct-lighting pass — his
  lights are emissive surfaces, and geometry's outgoing radiance is *only* its
  gathered GI. Our scenes are directly lit by three, so the injected source is
  `beauty + feedback·accumGI`: the march's first bounce gathers the direct-lit
  surfaces (beauty), and the feedback term adds the previous indirect →
  multibounce. Note this means our surfaces re-emit their **direct** reflection
  too (his don't), which is the correct behaviour for a real lit scene.
- **Exact sample reconstruction.** Sample view positions come from `invProj`
  (his toy used the cheaper `normalize(rayDir)·depth`). More accurate on a real
  perspective G-buffer.
- **Guarded bitmask shifts** instead of `int(pow(2,x))−1`, which in GLSL relied on
  32-bit int overflow at `span==32` (undefined in WGSL).
- **Firefly clamp** on gathered radiance (PLAN trap; SSGINode hardcodes 7). Mathis
  has none.
- **AO output.** His shader emits no AO; we derive it from the final bitmask
  coverage (`1 − popcount/(slices·32)`) into `.a`, 3×3-smoothed for the debug view
  (raw single-frame — not temporally accumulated).
- **Velocity reprojection is a TOGGLE.** `accumulation = static` is Mathis's
  original behaviour (sample the same pixel — correct while the camera is still).
  `accumulation = velocity` is **our addition**: with the G-buffer velocity that
  the toy lacked, we reproject history by the motion vector with depth+normal
  disocclusion rejection (using the Buffer D copy). See stability findings.

## `feedback` (bounce damping) — the one knob that changes his math

Mathis has no explicit feedback factor; his effective feedback is **1.0**,
relying on `albedo < 1` to converge. We expose `bounce feedback` (default **0.5**)
as an explicit damping multiplier on the fed-back indirect (PLAN trap: multibounce
energy feedback loop needs damping) and a `multibounce` on/off toggle. `feedback =
1.0` reproduces his behaviour (still plateaus — albedo attenuation guarantees it);
`0.5` is a faster, more conservative plateau and makes the multibounce
contribution a clean on/off knob.

## View modes (`view` dropdown or `?view=<mode>`)

| mode | content |
| ---- | ------- |
| `combined` | `ACES(beauty·aoTerm + accumGI)` — lit scene + albedo-modulated indirect |
| `gi` | denoised accumulated indirect (`accumGI`) × `GI display gain` |
| `raw` | single-frame march output (pre-denoise, pre-albedo) × gain — shows the bitmask noise |
| `ao` | bitmask AO (3×3 smoothed) |
| `beauty` | passthrough |
| `split` | A/B comparator: **raw** single-frame (left) vs **denoised** accumulation (right) |

## Params

`slices` (horizons), `steps/horizon`, `thickness` (world), `horizon bias`,
`GI strength`, `firefly clamp`, `step growth`, `thickness falloff`, `multibounce`,
`bounce feedback`, `accumulation` (static/velocity), `bilateral footprint`,
`accum cap`, `reproj depth/normal reject`, `AO in combined`, `GI display gain`,
plus comparator `A/B mode`/`diff amp`. All copy/paste-able as JSON.

**Scene scale**: `thickness`/`thickness falloff` are world-space (PLAN trap). The
default `thickness 0.06` is tuned for Cornell's 5.5-unit scale (maps to Mathis's
`0.03` constant on his ~3-unit room). Sponza (~30 units) renders stably at the
same value but wants a per-scene retune for tighter contact.

## Validation (headless, cached Playwright chromium-1228, `--enable-unsafe-webgpu`)

Screenshots in `bench/screenshots/06-*.png`. **No page errors.**

- **Cornell red/green bleed** (`06-cornell-gi`, `-combined`): correct — reddish
  fill on left-facing surfaces, green on right; smooth (denoised) vs demo 01's
  noisy single-bounce SSGI. `06-cornell-raw` shows the pre-denoise bitmask noise
  (the 4×4 interleaved dither is visible); `06-cornell-split` puts raw|denoised
  side by side.
- **Multibounce on/off** (`06-cornell-mb-on` / `-mb-off`): `on` is slightly
  brighter / more colour-bled in the indirect regions; the delta is subtle in a
  Cornell box because most energy is first-bounce — physically expected.
- **Plateau / no runaway** (`06-cornell-plateau-early` @0.8 s vs `-late` @9 s):
  **brightness is essentially identical** — the multibounce feedback converges and
  plateaus over a static hold. No runaway with `feedback 0.5`. ✅ (the headline
  stability finding; also confirms `albedo<1` + count-weighted average is a fixed
  point, per §7 above.)
- **Dynamic-scene degradation** (`06-cornell-rotate-static` vs `-rotate-velocity`):
  with **static** accumulation the rotating short box **smears/ghosts** — exactly
  Mathis's documented "fully dynamic scenes require a better denoiser." It
  degrades *gracefully* (blurs, does not explode/NaN). Switching to **velocity**
  reprojection resolves most of the smear: the box is sharp with clean green/red
  bleed on its faces. ✅
- **Sponza** (`06-sponza-combined`, `-gi`): the atrium renders with stable GI at
  the Cornell-tuned defaults; no artifacts, no runaway.
- Typecheck + production build pass (build needs `pnpm assets` for the Sponza glb).

## Reference agreement vs demo 02 (documented, not a live cross-demo split)

Qualitative comparison of `06-combined`/`06-gi` against demo 02's converged
reference on Cornell: the **bleed direction and contact/corner darkening agree**.
Demo 06 reads **brighter and more saturated** than the reference because it is a
fundamentally different estimator — a *biased* horizon integrator gathering full
beauty as Lambertian radiance **plus multibounce**, versus demo 02's *unbiased*
single-bounce cosine-weighted Monte-Carlo irradiance (`E/π · albedo`). Mathis's
`cos²` horizon weight + `sqrt`-facing term (§3) also carries a different
normalization than Salm's cosine hemisphere. **The delta is the finding**: this
recipe is a fast, stable, biased approximation — not a match to ground truth, and
it is not meant to be. A live pixel-diff would require embedding demo 02's marcher
as a sibling pass; deferred (see Decisions).

## Decisions for review

- **Screenshot-based reference A/B, not a live cross-demo split.** A true
  split+diff vs demo 02 needs its brute-force marcher running inside this demo
  (its own accumulation buffer, camera-reset logic, etc.). Given the biased-vs-
  unbiased gap is expected and qualitative, I compared via captures and documented
  the delta. The in-demo `split` view instead A/Bs **raw vs denoised** (the
  denoiser demonstration, analogous to demo 02's live-vs-converged split). If a
  numeric reference-agreement metric is wanted later, promote demo 02's marcher to
  a shared harness pass and diff against it.
- **Explicit `feedback` knob (default 0.5)** added on top of Mathis's implicit-1.0
  feedback, per the PLAN damping trap. `1.0` reproduces his behaviour.
- **Stable-target compose pass.** The accumulated GI is ping-ponged, so the TSL
  display can't sample it by identity across the `advance()` swap. `sshgi-compose`
  resolves the selected view into a fixed `outRT` that the display blits — this
  also gives us the view-select + ACES tonemap in one place (Mathis's Image pass).
  Raw passes rebind textures per-frame so they consume the ping-pong directly.
- **Second `HistoryTarget` for the Buffer D G-buffer copy** (linearZ + normal),
  used only by velocity reprojection's disocclusion rejection. Always written
  (cheap); a no-op for static accumulation.
- **AO is single-frame** (bitmask coverage, 3×3 smoothed), not temporally
  accumulated — `histGI.a` holds the accumulation count, and Mathis's shader has
  no AO channel at all. A denoised AO would need a second accumulation buffer;
  deferred as low value here (this is a GI-focused recipe).
- **`split` scales raw and denoised by the same display gain** for a like-for-like
  noise comparison; the denoised side is albedo-modulated and the raw side is not,
  so a slight brightness/tint offset between halves is expected.

## Known limitations / open bugs

- Screen-space only (shared family limitation): off-screen / depth-occluded
  geometry neither lights nor occludes.
- Static accumulation ghosts on dynamic geometry (Mathis's own caveat); velocity
  reprojection mitigates but disoccluded edges still need a frame or two to
  resettle. Continuous camera motion falls back to a single noisy frame (every
  moving frame is an accumulation reset, like demo 02).
- Sponza thickness/radius are Cornell-tuned defaults — retune per scene for
  tighter contact shadows.
- **Open bug:** none.
