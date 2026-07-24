# GUIDES-HANDOFF response — consumer integration report 1

Consumer: ssgiDev bench, demo `16-fsr` (first full-pipeline consumer).
Against: `feat-temporal-guides` @ `34f784d`. Format per the M0 feedback loop:
accepted / friction / blocked per item.

> **Status 2026-07-22 (their `3e374fd`): both friction items RESOLVED.**
> Dead `_renderer` deleted (their src now passes `--noUnusedLocals`); our
> vite block is the canonical linked-build recipe in GUIDES-HANDOFF.md;
> `paths` → `dist/index.d.ts` is the documented recommendation with their
> commitment to rebuild dist whenever the public surface moves (dist rebuilt
> at that commit — verified fresh, bench tsc clean against it). No contract
> changes; sequencing unaffected. Items below kept for the record.

## Linked build (handoff option a) — ACCEPTED, one real hazard

The vite alias works, but the handoff's "no duplicate-three hazard" claim is
**wrong for out-of-root consumers**: your source imports bare `three` while
our app imports `three/webgpu`, and vite resolved them to two copies of core
(from two different node_modules — your 0.185.0, our 0.185.1) → the
"Multiple instances of Three.js" warning. All three of these were needed in
the consumer's vite config:

```ts
resolve: {
  alias: [
    { find: '@pmndrs/upscaler', replacement: '/Users/dex/Developer/fsr3/src/index.ts' },
    { find: /^three$/, replacement: 'three/webgpu' }, // collapse dual-entry core
  ],
  dedupe: ['three'], // pin to the CONSUMER's copy, not fsr3/node_modules
},
optimizeDeps: { exclude: ['three'] }, // vite pre-alias shortcut otherwise
                                      // beats the bare->bare alias
```

Suggest folding this block into GUIDES-HANDOFF.md §Linked build — anyone
consuming from outside your repo root will hit it.

## TypeScript surface — FRICTION (worked around)

- Aliasing tsconfig `paths` at `src/index.ts` pulls your sources into the
  consumer's program, where our `noUnusedLocals` fails on a genuinely dead
  field: `UpscalerNode.ts:141` `_renderer` is assigned (line 175) and never
  read. We now point `paths` at `dist/index.d.ts` instead — cleaner
  separation anyway — but the field is worth deleting.
- Consequence of the dist workaround: our tsc checks against your **built**
  declarations while runtime uses live src. Please keep `npm run build`
  current when the public surface moves, or flag the change in the handoff
  doc; a silent skew will surface on our side as confusing type errors.

## Guides bundle + split dispatch (M2) — ACCEPTED, verified live

Demo 16 drives the exact contract frame shape (beginFrame → MRT
color+velocity+float-depth at render res → endFrame → dispatchGuides →
dispatchUpscale → present). Headed verification on cornell + sponza, WGSL
console clean:

- temporal 2× reconstructs far-field detail bilinear 2× destroys (sponza
  hall: lion relief, banner fringes, floor tiling) — no ghosting observed
  on static + slow-orbit content;
- ratio 1 temporal (Native AA) — crisp; this bench renders
  `antialias: false`, so this is its first true AA, as planned;
- `DebugView.Disocclusion` under a slow orbit shows exactly thin
  trailing-silhouette strips; `AccumulationAge` shows the jitter-phase
  pattern with converged borders;
- ping-pong rule honored (getters re-read per frame) — no stale-half
  artifacts seen.

Not yet exercised: reactive (bench scenes have no transparents yet),
guides-only path, MomentsPass (next — see below).

## Sequencing on our side (your M6 dependency)

1. **D1 alignment next**: our private `TemporalGuidesPass` consumers still
   speak NDC-delta motion; we convert them to your UV-delta (`prevUV = uv −
   motion`) convention, then run the guides A/B (guides-fed SSGI temporal
   vs private logic) — your M6 exit criterion. One naming correction to how
   the handoff phrases it: our demos 00–13 are **frozen instruments** (their
   recorded baselines must stay comparable), so the A/B will not modify
   demo 10 — it lands as a new lab, **demo 17**, that reuses demo 10's rig
   (same temporal stack, scenarios, and metrics) with the guide source
   swapped. Functionally identical to "the demo-10 A/B" in your docs.
2. `14-svgf` per SVGF-SPEC consumes `upscaler.guides` + `MomentsPass`
   (ycocg) — first MomentsPass exercise will be reported the same way.

Nothing blocked.

---

# Report 2 — M6 recorded: PASS. SVGF/MomentsPass field report.

Consumer demos: `17-guides-ab` (M6 rig), `14-svgf` (MomentsPass consumer).
Against: `feat-temporal-guides` @ `3e374fd`. Recorded battery at our `4118871`,
results committed (`bench/results/lab17-guides-ab.*`, `lab14-svgf.*`,
`lab14-cost.*`).

## M6 — PASS. Drop `@experimental`.

Demo 17 runs the identical SSGI temporal stack fed by our private guides pass
vs your bundle (guides-only path, split shader differs by ONE uniform flag for
the D1 UV-delta convention). Recorded:

- **Still-camera stability: bit-identical** (both arms 1.3984197255291004 —
  full-float equality; at convergence disocc≈0/vel≈0 make the blend
  independent of guide source, so this is the strongest possible parity
  statement, not a measurement artifact).
- **Teleport reconvergence: 1.275 s vs 1.288 s** (yours) — inside one 500 ms
  sampling interval. Post-teleport traces identical ~3 s (total disocclusion
  → producer passthrough), marginal divergence as history rebuilds.
- Functional pre-check: across-arm meanAbsDiff 0.84 < within-arm temporal
  noise 1.40 on stills.

Your guides bundle is a drop-in replacement for our private temporal
front-end. By GUIDES-HANDOFF.md's own criterion, the guides API can drop
`@experimental`. The private `TemporalGuidesPass` stays only as the A/B
control; new consumers here will bind `upscaler.guides`.

## MomentsPass field report (demo 14 SVGF)

- Integrated exactly per your §MomentsPass docs (`space: 'ycocg'`, dispatch
  per frame on demodulated GI irradiance; `coarseMoments` as the short-history
  spatial variance fallback, smooth-ramped over history length instead of the
  spec's hard branch). No contract friction: formats, sizes, and the
  rgba16float `.rg` deviation all behaved as documented.
- Validation: GPU-readback `Var = E[x²]−E[x]² ≥ 0` held everywhere; with
  injected σ=0.3 noise the measured variance is the right magnitude; the
  variance-guided à-trous visibly denoises σ=0.3+firefly input that a plain
  bilateral cannot (your §E identity-check ask is satisfied in-consumer).
- Measured outcome on our signal, for your interest: variance-guided SVGF is
  the new stability champion (0.035–0.24 across all grid cells, 7–88× better
  than our incumbent) at 2.4–2.8× a 1-pass bilateral's cost; MSE vs our
  biased oracle is tied across all denoiser arms (the spec's predicted H0 on
  a low-noise producer). MomentsPass is real and load-bearing, not cosmetic.

## Open on our side

15-ptref (unbiased PT ground truth) remains deferred — it is the only way to
turn the MSE tie into a real quality ranking. No asks on your side. M4 (TSL
surface) still deferred per our raw-first priority; we'll signal when
composite-side consumption becomes next.

---

# Report 3 — upscale-path convergence defect (human-observed, then quantified)

Dennis observed the demo-16 output visibly jittering on a STILL camera, the
`Disocclusion` debug view flickering silhouette outlines, and `AccumulationAge`
never resolving (rolling ring/moiré patterns forever). We quantified:

- **Still-camera output never converges.** Consecutive-frame meanAbsDiff
  (0–255 scale, 250 ms apart, after 6–8 s settle), cornell C-wide pose:
  sustained **0.19–0.76** at defaults. Reference point: our SVGF demo after
  its own jitter fix sits at **0.039** flat on the same pose. Sponza S-hall:
  steady 0.15–0.18 — better, still far from converged.
- **AccumulationAge drifts ~5.5–6.2** meanAbsDiff over any 5 s window — the
  age pattern rolls forever; history is being continuously re-aged.
- **No exposed knob stops it**: `detectShadingChanges` off (no change — and
  output slightly worse), `autoExposure` off (no change), `sharpness=0`
  (RCAS off — no improvement), `lockThinFeatures` off (no change),
  **ratio 1 NativeAA** (no upscaling at all): still 0.15–0.42.
- **Scene-dependent aggravator, not cause**: cornell is worse than sponza.
  Our cornell point light uses three's IGN-dithered Vogel shadow filter,
  which is screen-anchored — under your camera jitter the penumbra dither
  re-rolls every frame, i.e. we feed genuinely unstable luminance in
  penumbrae. That explains cornell>sponza but not the sponza floor, nor
  NativeAA churn on flat walls.

Repro on our side: demo 16, `?demo=16-fsr&scene=cornell&cam=0,2.4,8.8,0,2.6,0`,
any consecutive-frame differ (our meter script is
`scratchpad/jitter-meter.mjs` pattern — 5 grabs at 250 ms, meanAbsDiff).

Expectation check: FSR2/3-class temporal accumulation on a static scene +
still camera should converge to a supersampled stable image (frame diff
→ ~0). If your reference example shows the same on a frozen camera, this is
in the accumulation/rectification core; if not, tell us what input contract
we're violating — depth/velocity/deltaTime all follow GUIDES-HANDOFF.md and
demo 16 passed its M2 field verification for image quality (report 1).

**Program impact on our side**: the upscale+AA acceptance work (FSR3-BRIEF
Req 2; jitterAA default-on plans) is BLOCKED on this. **M6/guides are NOT
implicated** — demo 17 consumes the guides-only path (no upscale
accumulation), its A/B numbers stand, and report 2's drop-`@experimental`
verdict for the guides API is unaffected.

## Report 3 addendum (2026-07-24) — converging counter-example + likely mechanism

We have since built our own sub-pixel-jittered temporal accumulator (demo
`18-temporal`, commit `67e924c`) over the same scenes, camera poses, and
churn meter. It **converges**: still-camera consecutive-frame meanAbsDiff
0.447 → 0.242 over 12 s and still falling (α = 1/N arm), teleport recovery
0.57 → 0.18 over 10 s, no ghosting. So jitter + temporal accumulation over
this exact content is convergent — the demo-16 churn is not something our
scenes force.

Two implementation facts were REQUIRED to get there; offered as debugging
hints because the failure mode without them reproduces demo 16's symptom set
exactly (rolling `AccumulationAge`, silhouette `Disocclusion` flicker,
permanent output shimmer):

1. **Velocity includes the jitter delta** (three's velocity node tracks the
   previous *projection* matrix). True per-pixel motion is
   `velocityUV − jitterDeltaUV`; any disocclusion/rectification test that
   consumes raw velocity sees every pixel "moving" every frame.
2. **Sub-pixel-motion pixels must accept same-texel history unconditionally.**
   At geometry edges the per-frame depth flip under jitter IS the coverage
   being integrated; running a depth/world-delta reject there resets history
   age every frame. We also had to widen the reject threshold for genuinely
   moving pixels under jitter (nearest-texel prev-depth carries up to a texel
   of sub-pixel reconstruction error).

If the upscaler's rectification or disocclusion logic under-compensates
jitter in either of these two ways, that would produce precisely the
observed non-convergence, including at NativeAA ratio 1. Converging repro
for comparison: `?demo=18-temporal`, defaults, still camera.

### Verification note (2026-07-24, in response to your "jitter-free velocity" suspect)

We re-audited the consumer side against that suspect. **Demo 16's velocity
IS jitter-free per contract** — all three links verified:

- Demo 16 calls `velocity.setProjectionMatrix(upscaler.unjitteredProjectionMatrix)`
  at init (`16-fsr/index.ts:105`), per GUIDES-HANDOFF.md:85, cleared in dispose.
- `unjitteredProjectionMatrix` is a stable `Matrix4` instance
  (`Upscaler.ts:129`) mutated in place, and `beginFrame` snapshots it
  BEFORE applying the jitter view offset (`Upscaler.ts:580–595`), with
  `endFrame` clearing the offset each frame — so init-once wiring stays
  live and the snapshot is clean.
- three's `VelocityNode` applies the override to BOTH current and previous
  projection (`VelocityNode.js:127,137`), so previous-frame reprojection is
  unjittered too.

That eliminates hint 1 and narrows to hint 2, now locatable concretely: on
a still camera with jitter-free velocity, reprojection is same-texel — the
only per-frame-varying input left is the **jittered depth buffer**, which
flips at silhouettes every frame by construction. Any disocclusion /
rectification test that compares current vs previous depth (or
depth-reconstructed position) without jitter compensation will re-flag
edge pixels every frame → exactly the observed `Disocclusion`-view
silhouette flicker and rolling `AccumulationAge`, at every ratio including
NativeAA. That's where we'd look first.

### Research package (2026-07-24) — FSR2 reference material for the depth suspect

A temporal/TAA research pass just landed in our repo at
`research/sources/temporal/` (index: `00-INDEX.md`, summary: `HANDOFF.md`).
Three files are directly relevant to your side and quote the upstream FSR2
source verbatim:

- **`02-disocclusion-history-rejection.md`** — FSR2's depth-clip test from
  `ffx_fsr2_depth_clip.h`, verbatim: the view-space required-separation
  test (`Ksep = 1.37e-05`, FOV-compensated, resolution-scaled `pow`),
  evaluated against **reconstructed previous depth**, producing a soft
  `depthClipFactor ∈ [0,1]` rather than a hard reject. This is upstream
  FSR2's answer to exactly the jittered-depth problem named above: it
  never compares raw current-vs-previous depth.
- **`05-velocity-dilation.md`** — the "reconstruct & dilate" pass
  (`ffx_fsr2_reconstruct_previous_depth.h`): 3×3 closest-depth
  depth/MV dilation + atomic forward reprojection of depth. Caveat flagged
  in the file: the pass body is manual-sourced (the raw mirror wouldn't
  render), so check the GitHub blob for the byte-exact loop.
- **`08-taa-upscaling-rectification.md`** — `ffx_fsr2_accumulate.h` /
  `ffx_fsr2_lock.h` verbatim: `RectifyHistory` box scaling (disocclusion/
  velocity/reactivity tighten, locks/luma-instability loosen),
  thin-feature locks, 4-frame luma-instability history, base accumulation
  weights.

The concrete debugging lead this gives: if your disocclusion path
simplified or skipped the reconstructed-previous-depth stage (or feeds it
non-dilated depth/velocity), the depth comparison degenerates to raw
jittered depths at silhouettes — which reproduces your Report-3 symptom
set (silhouette `Disocclusion` flicker, rolling `AccumulationAge`,
non-convergence at every ratio including NativeAA). Comparing your
depth-clip stage against the `02`/`05` extracts is probably the fastest
route to the defect.
