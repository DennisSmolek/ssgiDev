# FSR3-BRIEF.md — how the FSR3 port should decompose to flow with this pipeline

Audience: the agents working on Dennis's separate FSR3-for-three.js port. That
repo stays self-contained; this brief defines the *decomposition and contracts*
so its internals can be produced early and consumed by effects (SSGI temporal,
denoisers) well before the upscale — instead of shipping as one monolith that
only runs last.

## The architectural thesis (why decompose)

Disocclusion, dilated motion vectors, reactivity, and history validity are
**frame properties, not upscaler properties**. FSR3 computes them internally
and hides them; meanwhile every temporal effect upstream (our SSRT3 temporal
pass, bilateral denoisers, any TAA) re-derives worse versions privately. The
port should expose FSR3's early data products as standalone passes with clean
texture contracts, so one computation feeds everything. See
`advantagous-concepts.md` ("temporal guides") for the consumer-side motivation.

## Required decomposition (pass boundaries, not a monolith)

1. **Reconstruct & dilate** (early — immediately after G-buffer):
   - in: depth, motion vectors, prev depth
   - out: `dilatedVelocity` (closest-depth 3×3 dilation), `dilatedDepth`,
     `disocclusionMask` (graded 0..1, depth-reprojection based — NOT binary)
2. **Locks / reactivity** (early-mid):
   - in: luma, history, app-provided reactive hints
   - out: `reactiveMask`, `lockStatus` (or nearest FSR3 equivalents)
3. **Accumulate + upsample** (late): consumes 1+2 plus color; owns history.
4. **RCAS sharpen** (last): consumes 3 only.

Each pass = explicit input/output textures with documented formats and a
uniform block; no pass reaches into another's internals. Passes 1–2 must be
runnable WITHOUT 3–4 (that is the whole point): an app that never upscales can
still run them as its temporal-guides provider.

## Contracts this bench expects (the "temporal guides" bundle)

Produced once per frame, post-G-buffer, pre-effects:

| texture | format (suggested) | contents |
|---|---|---|
| `dilatedVelocity` | rg16float | closest-depth-dilated NDC delta |
| `disocclusion` | r16float | graded disocclusion 0 (stable) .. 1 (fresh) |
| `historyLength` | r16float | per-pixel valid-history frame count N |
| `reactive` | r8unorm | app/effect-flagged fast-changing pixels |

Notes:
- `historyLength` may be produced by the consumer instead (demo 03 already
  maintains one for frame-count accumulation); the contract just names it.
- `reactive` flows the other way too: GI/multibounce passes can WRITE into it
  (fast-changing GI ⇒ don't lock/ghost) — design the pass to accept an
  optional pre-populated mask and merge rather than overwrite.

## three.js r185 / WebGPU environment facts (traps we already paid for)

- `PostProcessing` is deprecated → `RenderPipeline`; after reassigning
  `outputNode` you MUST set `needsUpdate = true` or the graph silently keeps
  rendering the old output.
- Velocity convention (three MRT `velocity`): ndc delta; UV reprojection is
  `prevUV = uv - velocity.xy * vec2(0.5, -0.5)` (TRAANode convention).
- Compute/raw passes: top-left UV origin, y-down. Anything derived from Unity
  or Shadertoy (y-up) needs the y-mirror at the screen-step seam — this bug
  cost us the demo 03 "box-top speckle" hunt; check every direction that is
  used in BOTH view space and screen space.
- Raw WGSL passes never allocate GPU textures: allocate as three
  RenderTarget/StorageTexture, bridge via `renderer.backend.get(...)`
  (isolated in one file, see `bench/src/harness/three-internals.ts`), so
  outputs stay consumable as TSL `texture()` nodes.
- Camera jitter: `setViewOffset` (TRAANode convention); harness helpers exist
  (`bench/src/harness/temporal.ts`, Halton(2,3)).
- Known port bug from earlier work: **ACES tonemapping baked into RCAS** —
  RCAS must be tonemap-agnostic (sharpen in the same space FSR3 specifies,
  don't embed a display transform; three applies output encoding itself).
  Shadertoy-derived passes similarly must not carry a trailing `pow(x, 0.45)`.

## Verification expectations (same discipline as this bench)

- Headed browser only for WebGPU verification (headless chromium = software
  adapter = black canvas). `--enable-unsafe-webgpu`, no Vulkan flag on macOS.
- Each pass verified standalone with a scripted capture before integration;
  numbers recorded with config + commit (see TESTING.md methodology).
- The bench will consume passes 1–2 in a lab (demo 10 extension) A/B-ing
  guides-fed SSGI temporal vs its private logic — that lab is the acceptance
  test for the decomposition being real and not cosmetic.
