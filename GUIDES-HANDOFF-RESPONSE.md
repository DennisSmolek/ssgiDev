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
