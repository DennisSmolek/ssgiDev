# Demo 17 — Guides A/B (M6)

The FSR3 upscaler's **M6 exit criterion**: does exposing disocclusion + dilated
motion as a **standalone shared guides bundle** (`@pmndrs/upscaler`'s
`upscaler.guides`, `path: 'guides'`) feed a temporal SSGI stack as well as this
bench's own private guides producer (`harness/temporal-guides.ts`,
`TemporalGuidesPass`)? Per `GUIDES-HANDOFF.md`: *"Your demo-10 A/B (guides-fed
SSGI temporal vs private logic) is M6 — the program's exit criterion. The
guides API drops `@experimental` when it passes."* This lab is that A/B,
extended to compare the FSR bundle against the private pass directly, not just
against the SSRT3 EMA fork's own inline logic.

Cloned from demo 10's rig (producer, temporal, denoise, accumulate reference,
Comparator, blit, param plumbing, reset logic) — demos 00–13 are frozen, so
this lab owns copies of the small utility passes (`accumulate.wgsl`,
`blit.wgsl`) rather than importing demo 10's. The producer and bilateral
denoise (`ssrt-main.wgsl`, `ssrt-denoise.wgsl`) are reused **live** from demo
03, same pattern demo 10 uses. NOT cloned from demo 10: TRAA, camera AA
jitter, the mathis/xegtao/denoise-node stacks — none of those bear on which
guide **source** feeds the temporal pass, which is the only question this lab
asks.

## The rig

One fixed noisy producer (demo 03's SSRT3 march, rc1/sc8, jitter on — the
experimental control, same as demo 10) feeds **one** temporal shader
(`guides-ab-temporal.wgsl`) through **either** of two guide sources, selected
by `?stack=`:

| id | guide source | history |
|---|---|---|
| `none` | — (control: raw producer, no denoise) | — |
| `private-guides` | this bench's `TemporalGuidesPass` (`harness/temporal-guides.ts`) | dedicated ping-pong pair |
| `fsr-guides` | `@pmndrs/upscaler`'s `Upscaler` in guides-only mode (`path: 'guides'`) | dedicated ping-pong pair |

Both guide producers consume the **identical** G-buffer (depth + velocity from
the same scene pass) — no camera jitter is applied anywhere in this demo, so
the A/B isolates the guide products, not incidental G-buffer differences.
Producers run **lazily** (like `ReferencePass`): only the active arm's
producer executes each frame.

## The convention flag (`guides-ab-temporal.wgsl`)

Forked from demo 10's `ssrt3-guides-temporal.wgsl` with exactly one addition:
`p.flags` bit 2, `motionIsUVDelta`. The two guide sources disagree on velocity
convention:

- `TemporalGuidesPass.dilatedVelocityTexture` is an **NDC delta** (matches
  three's raw `velocity` MRT channel) — reprojection scales it by
  `(0.5, -0.5)` to become a UV delta, same as every other temporal pass in
  this repo (`motionIsUVDelta = 0`).
- `upscaler.guides.dilatedMotion` is **already a UV delta with the y-flip
  applied** (`GUIDES-HANDOFF.md`: `.xy` is a UV delta, `prevUV = uv - motion`)
  — scaling it again would double the flip (`motionIsUVDelta = 1`, `offsetUV
  = vel` directly).

Everything else is byte-for-byte identical between the two arms — same TParams
layout, same 4-neighbourhood history clamp, same 0.25 clamp-blend, same
`blendWeight = mix(temporalResponse, 1.0, disocclusion)` substitution — so any
A/B delta isolates the guide **products** (which pass computed
dilatedVel/disocclusion), not shader drift. Full derivation in the WGSL file's
header comment.

Disocclusion polarity matches on both sides without translation:
`TemporalGuidesPass.disocclusionTexture` (r16float, graded 0 stable..1 fresh)
and `upscaler.guides.disocclusion` (rgba8unorm `.r`, same 0..1 grading) are
read identically.

## Side B: the FSR3 upscaler, guides-only

```ts
this.upscaler = new Upscaler({ renderer: ctx.renderer });
this.upscaler.init();
// resize(): RENDER resolution (displayWidth/Height = render size), ratio 1 —
// both arms consume the identical G-buffer, no upscale.
this.upscaler.configure({ displayWidth, displayHeight, customUpscaleRatio: 1, path: 'guides' });
// frame(), only when stack === 'fsr-guides':
this.upscaler.dispatchGuides({ depth, velocity, deltaTime, reset }, camera);
```

`path: 'guides'` means `dispatchGuides()` is the whole frame — no color, no
jitter (verified: `Upscaler.beginFrame` only applies jitter on the `temporal`
path, so this demo never calls `beginFrame`/`endFrame` — they are no-ops for a
guides-only consumer that never touches `upscaler.outputTexture`), no output
texture (the accessor throws, per contract). `upscaler.guides.dilatedMotion`
and `.disocclusion` are **not** ping-ponged (confirmed against
`Upscaler.ts`: single `StorageTexture` objects, rewritten in place each
dispatch) — but `configure()` **does** reallocate them as brand-new JS objects
on every call (unlike `TemporalGuidesPass`, which keeps the same objects and
only reallocates their GPU backing on `setSize()`). The guides-view debug
nodes (`fsrDisoccNode`/`fsrMotionNode`) are built once and never rebuilt;
`frame()` re-points their `.value` to the live texture every frame the `fsr`
arm is active, before that frame renders — this sidesteps the
reallocate-on-resize hazard without needing to track a "stale node" flag.

## Views (`?view=`)

`combined` (beauty·AO + albedo·GI), `gi`, `reference` (converged mean of the
SAME producer, demo-02/10-style pseudo ground truth), `split` (active arm vs
reference — draggable divider, or `compareMode: diff` for amplified abs-diff),
`guides` (debug: R = graded disocclusion, lights up on a teleport; G =
historyLength/cap — **side A only**, the FSR guides path has no
history-length product, it's a late/temporal-path product that's `null` on
`'guides'`, so G is pinned to 0 for the `fsr-guides` arm; B = |dilatedVelocity|
· gain, bright under motion). The `guides` view always shows the **active
arm's** products (`stack` selects which producer ran this frame).

## Runner

`scripts/run-17.mjs` — cloned from `run-10.mjs`'s stability sweep + teleport
reconvergence protocol (`STACKS = ['private-guides', 'fsr-guides']`, `--out
lab17-guides-ab`, shots under `bench/results/shots/lab17/`). Registered in
`bench/scripts/lib/harness.mjs`'s `DEMO_IDS['17'] = '17-guides-ab'`.

**Recorded numbers are deferred to a quiet-GPU window** — this build was
verified functionally only (both arms produce a lit GI image, WGSL console
clean, screenshots match visually across arms on a still camera); the GPU was
in use by other work at build time (2026-07-22), so no stability/reconvergence
numbers have been recorded yet. Run `node scripts/run-17.mjs` once the GPU is
free to produce the actual M6 evidence.

## Coordinate / reuse notes

- Producer view-space + bitmask math is demo 03's, unchanged.
- Both temporal arms use three's velocity convention
  `prevUV = uv − vel·(0.5,−0.5)` for NDC-delta input (`motionIsUVDelta = 0`);
  the FSR arm's UV-delta input needs no such scaling (`motionIsUVDelta = 1`).
- Ping-pong stack outputs are bridged to **stable** storage textures
  (`privateFinal`, `fsrFinal`, `noneOut`) via a trivial `blit.wgsl` each frame,
  so the TSL display graph samples a fixed texture without a per-frame
  recompile — same pattern demo 06/10 use.
- URL: `?demo=17-guides-ab&scene=&stack=&view=`.
