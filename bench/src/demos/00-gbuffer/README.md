# Demo 00 — G-buffer inspector

Scene viewer + G-buffer channel inspector. Sanity-checks the harness: MRT
outputs, depth, velocity, view-space normals, UV origin, and — critically — the
**raw-WGSL-on-three's-GPUDevice interop** the whole project depends on.

Pinned to **three@0.185.1**. Lineage: none (harness demo, not a technique port).

## What it shows

The Cornell box rendered through three's `pass()` with an MRT of
`{ output, albedo, normal, velocity }` plus the pass's depth texture. View modes
(Tweakpane `view` dropdown, or `?view=<mode>` URL param):

| mode          | source                                                            |
| ------------- | ----------------------------------------------------------------- |
| `beauty`      | lit output (MRT `output`)                                          |
| `albedo`      | material `diffuseColor` (MRT)                                      |
| `normal`      | view-space `normalView`, encoded `n*0.5+0.5`                       |
| `depthLinear` | linearized via TSL `perspectiveDepthToViewZ` (three-side)         |
| `velocity`    | screen-space motion vectors, signed-encoded (`0.5` = no motion)   |
| `rawDepth`    | **linearized by the handwritten WGSL raw pass** (see below)       |

`depthLinear` and `rawDepth` should look identical — that equivalence is the
raw-pass validation. Rotate the short box (`Scene (Cornell) > rotate short box`)
to see a nonzero velocity field.

### Conventions (traps)

- **UV origin is WebGPU top-left.** The raw pass indexes the depth texture with
  `vec2<i32>(floor(pos.xy))` (fragment `@builtin(position)`, top-left origin),
  matching three's render-attachment texel layout — no Y flip needed.
- **Normals are view-space, right-handed.** Back wall (facing camera) → blue
  (+z), floor → green (+y), ceiling → magenta (−y), red wall → pink (+x).

## Import paths (verified against 0.185.1)

- `three/webgpu` → `RenderPipeline` (NOT `PostProcessing` — renamed r183,
  deprecated), `WebGPURenderer`, `RenderTarget`, `HalfFloatType`, `TimestampQuery`.
- `three/tsl` → `pass`, `mrt`, `output`, `diffuseColor`, `normalView`,
  `velocity`, `texture`, `uniform`, `perspectiveDepthToViewZ`, `screenUV`, …
- Stock display addons live at `three/addons/tsl/display/*.js`
  (`SSGINode.js` → `ssgi`, `GTAONode.js` → `ao`, `TRAANode.js` → `traa`). Not
  used in demo 00 but the path is confirmed for M1.

## Raw-pass mechanism (the architecture bet)

`RawFragmentPass` (`src/harness/raw-fragment-pass.ts`) runs handwritten WGSL
(`depth-vis.wgsl`, imported via Vite `?raw`) on three's own `GPUDevice`:

1. **Device** — `renderer.backend.device`.
2. **Depth GPUTexture** — `renderer.backend.get(depthTexture).texture`, bound as
   `texture_depth_2d` (view `aspect: 'depth-only'`) and read with `textureLoad`
   (no sampler; works on `depth24plus`, which is what three allocates for the
   pass's default `DepthTexture`). No copy required — three creates every texture
   with `TEXTURE_BINDING` usage.
3. **Output** — writes into a **three-allocated** `RenderTarget` (interop rule:
   raw passes never allocate their own inter-pass textures). The pipeline's
   color-attachment format is read from three's own texture descriptor
   (`textureDescriptorGPU.format`) so it matches exactly — no srgb guessing. The
   target is `rgba16float` / `NoColorSpace` to keep that unambiguous.
4. **Display** — the RenderTarget's texture is sampled downstream as a plain TSL
   `texture()` node, so any stock node (TRAA/Denoise/FSR later) can consume raw
   output with no special-casing.

**Timing / order.** Each frame runs three submissions on one queue, in order:
`gbufferPipeline.render()` (fills MRT + depth) → `rawPass.execute()` (reads
depth, writes rawVisRT) → `displayPipeline.render()` (samples the RTs to canvas).
GPU command ordering on `device.queue` guarantees read-after-write between them;
no explicit fences needed. This two-invocation pattern is the template for all
future raw passes.

**three internals touched** (all isolated in `src/harness/three-internals.ts`):
`renderer.backend.device`, `renderer.backend.get(tex).texture`,
`renderer.backend.get(tex).textureDescriptorGPU.format`,
`renderer.initRenderTarget(rt)`.

## Known limitations (M0)

- `gbufferPipeline.render()` blits beauty to the canvas before
  `displayPipeline.render()` overwrites it — one wasted fullscreen blit per
  frame. Harmless (same-frame overwrite); revisit if it ever shows.
- Raw-pass GPU time is **CPU-measured** (`raw ms (cpu)`); it is submitted outside
  `renderer.render()` so three's timestamp pool doesn't cover it. `gpu ms
  (render)` is the aggregate of the two three-driven passes.
- `albedo` uses `diffuseColor` (includes maps); for the untextured Cornell box it
  equals the flat base color.
- Depth-texture sampling for `depthLinear` relies on TSL sampling the
  `DepthTexture` directly; if a future three version restricts that, fall back to
  the `rawDepth` path (which does not).
