# WORKLOG

Append-only. Newest entry last. A fresh context must be able to resume from PLAN.md +
per-demo READMEs + this file alone.

---

## 2026-07-18 — Repo cleanup + plan locked

- PLAN.md finalized with Dennis: 12-demo ladder (00–11), execution protocol (model tiering,
  safety commits, context hygiene), interop rule (raw passes write into three-allocated
  targets), harness-level temporal contract.
- Root cleanup: 3 duplicate PDFs deleted (byte-identical to `research/sources/papers/` copies);
  unique color GTAO paper moved to `research/sources/papers/gtao-jimenez2016-color.pdf`;
  `chatnotes.md` + `ssao-vbao-ddgi-research-handoff.md` moved into `research/` (early-chat
  context docs, not plan).
- Next: M0 — pnpm workspace, `bench/` Vite+TS app, harness core, Cornell box, demo 00
  (G-buffer inspector). three pinned at 0.185.x.

**Validated:** nothing built yet. **Open bugs:** none.

---

## 2026-07-18 — M0: workspace scaffold, harness core, Cornell box, demo 00

Built the pnpm workspace + `bench/` (Vite + TS strict, vanilla), the harness
core, the procedural Cornell box, and demo 00 (G-buffer inspector) including the
raw-WGSL-interop smoke test.

- **Workspace**: `pnpm-workspace.yaml` + root scripts (`dev`/`build`/`typecheck`)
  proxying to `bench`. Deps pinned: `three@0.185.1` (verified latest 0.185.x),
  `tweakpane@^4.0.5`. Dev: `@types/three@0.185.1`, `@webgpu/types`, `typescript`,
  `vite`, plus **`@tweakpane/core@^2.0.5`** — required as an explicit devDep
  because tweakpane v4's `.d.ts` references `@tweakpane/core` as an external
  module (bundled at runtime, so not auto-installed → `Pane.addFolder` etc.
  otherwise missing at type-check).
- **Import paths (0.185.1, verified)**: `three/webgpu`, `three/tsl`, addons at
  `three/addons/tsl/display/{SSGINode,GTAONode,TRAANode}.js` (fns `ssgi`/`ao`/
  `traa`). `PostProcessing` is deprecated (r183) → use **`RenderPipeline`**.
- **Harness** (`bench/src/harness/`): WebGPU bootstrap + capability report
  (`hasFeature`); `DemoRegistry`/`SceneRegistry` URL-routed (`?demo=&scene=`,
  reload-to-switch); typed param schema → Tweakpane folder w/ JSON copy/paste;
  GPU timing via `trackTimestamp` + `resolveTimestampsAsync` +
  `info.render.timestamp` (degrades gracefully); OrbitControls + localStorage
  camera bookmarks (JSON-exportable); `renderScale` (0.25–1.0) plumbed to RT
  sizing; temporal contract **interfaces only** + working `HistoryTarget`
  ping-pong helper. G-buffer already carries velocity.
- **three internals** — ALL isolated in `harness/three-internals.ts`:
  `renderer.backend.device`, `renderer.backend.get(tex).texture`,
  `.textureDescriptorGPU.format`, `renderer.initRenderTarget(rt)`.
- **Raw-pass interop (the architecture bet) — WORKS.** `RawFragmentPass` runs
  handwritten WGSL (`depth-vis.wgsl`, `?raw`) on three's `GPUDevice`: reads the
  pass depth texture as `texture_depth_2d` via `backend.get().texture` (no copy —
  depth24plus has TEXTURE_BINDING; `textureLoad`, aspect depth-only), writes a
  three-allocated `RenderTarget` (pipeline format read from three's descriptor to
  avoid srgb guessing), displayed as a plain TSL `texture()` node. Mechanism:
  three ordered submissions on one queue per frame — `gbuffer.render()` →
  `rawPass.execute()` → `display.render()`; queue order gives read-after-write.
- **Cornell box**: SCALE = 5.5-unit interior cube (recorded in `cornell.ts`;
  world-space thickness params are per-scene). Red/green walls, white surfaces,
  emissive ceiling panel + PointLight (robust beauty lighting; area light is a
  later realism concern), toggleable short-box rotation for velocity/temporal.

**Validated (visual + build):** `pnpm install`, `pnpm typecheck`, `pnpm build`
all pass. Visually verified headless via cached Playwright chromium-1228 (WebGPU
worked with `--enable-unsafe-webgpu`) — screenshots in `bench/screenshots/00-*.png`.
All 6 view modes render correctly; **`rawDepth` (handwritten WGSL) matches
`depthLinear` (three-side TSL) → interop confirmed**. Normals correct in view
space (back=blue/+z, floor=green/+y, ceiling=magenta/−y, red wall=pink/+x). GPU
timestamps live (gpu ~0.79 ms, timestamp-query present). No page errors.

**Deviations / notes:**
- `gbuffer.render()` writes beauty to canvas before `display.render()` overwrites
  it — one wasted blit/frame (documented in demo 00 README).
- Raw-pass GPU time is CPU-measured (submitted outside `renderer.render()`); the
  `gpu ms (render)` stat aggregates the two three-driven passes.
- Suggest PLAN.md note: raw passes should target `RenderPipeline` (not the
  deprecated `PostProcessing`) name going forward.

**Open bugs:** none. **Not committed** (left for review).
**Next:** M1 — demo 01 (stock SSGINode + SSR + GTAO), Sponza fetch/compress,
per-pass GPU timings.

---

## 2026-07-18 — M2: demo 02 reference marcher + A/B comparator (worktree merge)

Built in a parallel worktree (Opus agent), merged into main by the orchestrator
(one conflict, `demos/index.ts` registry lines). Full detail in
`bench/src/demos/02-reference/README.md`.

- **Demo 02**: brute-force screen-space ray-march reference, semantics from
  Salm's XXGSDd reference (cosine weighting via `normalize(uniformSphere + N)`;
  finite-slab thickness `surfZ < rayZ < surfZ + t`, default 0.5 on Cornell's
  5.5-unit scale; view-space march; miss = sky). Additive-blend accumulation
  (rgb=GI sum, a=AO sum, display divides by count) — deliberate deviation from
  HistoryTarget ping-pong, logged for review. Converges by 512 frames; verified
  screenshots `02-*.png`.
- **A/B comparator**: `harness/compare.ts` + `compare.wgsl` — generic
  two-texture split/abs-diff raw pass with per-input scale + channel select.
- **New harness class `RawRenderPass`** (`harness/raw-pass.ts`): generalized
  declarative-bindings raw fragment pass; demo 00's `RawFragmentPass` is now
  the narrow ancestor. **Decision for review:** M3 (in flight, branched
  pre-merge) builds its own `RawComputePass`; reconcile the three raw-pass
  classes in the polish pass.
- **New traps found:** WGSL needs parens mixing `*`/`^`; Float32Array pose
  snapshots quantize (~0.004) and self-reset accumulation — use Float64Array +
  2e-4 move threshold.

**Validated:** typecheck/build (re-run post-merge by orchestrator) + headless
screenshots on Cornell. **Open:** Cornell-only so far; thickness/radius need
per-scene retune on Sponza/zoo.

---

## 2026-07-18 — M1: demo 01 (stock pipeline + SSR), Sponza + artifact zoo

Built the shipped-baseline demo (demo 01), the Sponza scene, and the procedural
artifact-zoo scene. All three scenes render in demo 00 and demo 01, headless-
verified, no page errors.

- **Asset pipeline** (`bench/scripts/fetch-assets.sh`, `pnpm assets`): idempotent
  curl of toji `Sponza-KTX-Draco.glb` (9.3 MB) → `bench/assets/` (gitignored) +
  copies the Draco/Basis decoders **out of the pinned three package**
  (`node_modules/three/examples/jsm/libs/{draco,basis}`) into
  `bench/public/decoders/` (also gitignored). Chose copy-from-node_modules over
  CDN so transcoder/three versions can't drift (a mismatch corrupts textures) and
  the app has no external runtime dep. Ran it; Sponza + decoders present.
- **Sponza scene** (`scenes/sponza.ts`): GLTFLoader + DRACOLoader
  (`/decoders/draco/gltf/`) + KTX2Loader (`/decoders/basis/`,
  `.detectSupport(renderer)`). glb referenced via Vite `?url` (emits the gitignored
  asset, self-contained — KTX2 embedded). Async load, populates scene on ready.
  Added `renderer` to `SceneContext` (KTX2Loader needs it). Lighting: angled
  directional sun through the atrium + low hemisphere + faint ambient.
  **WORLD SCALE (measured): size (29.8 X, 12.4 Y, 18.3 Z), longest edge ≈ 29.8
  units, atrium floor y≈0** — ~5.4× the Cornell box; logged fresh each load,
  recorded in a comment. Thickness params are world-space → retune per scene.
- **Artifact-zoo scene** (`scenes/artifact-zoo.ts`): procedural, ~metre scale to
  match Cornell. Four VBAO cases (dims in comments): graded thin plates
  (0.02/0.06/0.14/0.30/0.50 units thick), a 10-post fence + rail (posts 0.05),
  a 4-thin-leg chair (leg r=0.04) on the ground for contact-point AO, and a
  camera-facing wall + concave return corner.
- **Demo 01** (`demos/01-stock-three/`): one `pass()` MRT →
  SSGINode composited per three's `webgpu_postprocessing_ssgi` example
  (**`output.rgb*ao.r + diffuseColor.rgb*gi.rgb`** — GI modulated by albedo, the
  PR #31839 requirement). Toggles: AO mode SSGI↔GTAO (GTAONode control), **SSR
  added** (SSRNode, additive over composite, default off), post stage
  TRAA/DenoiseNode/none. Debug views final/ao/gi (SSGINode `getAONode()`/
  `getGINode()`). Full SSGI param set exposed (sliceCount…backfaceLighting) as live
  uniforms; mode/view changes rebuild the graph. URL overrides
  `?aoMode=&post=&ssr=1&view=` for deterministic captures. rg11b10 capability
  checked → on-page ERROR blade + console + GTAO fallback if missing.
- **Timing**: reused harness `trackTimestamp` (`ctx.timing.sampleGPU`); no custom
  query sets.

**Validated:** `pnpm typecheck` + `pnpm build` pass. Headless Playwright (cached
chromium, `--enable-unsafe-webgpu`): demo 01 on **cornell + sponza + artifact-zoo**,
views beauty/ao/gi, plus mode variants (gtao / ssr / denoise / post=none) — all
render, **zero page errors**. Screenshots in `bench/screenshots/01-*.png`. Cornell
GI shows correct red/green color bleed; GTAO mode shows clean AO w/o bleed; Sponza
loads with correct KTX2 textures + Draco geometry (classic atrium corridor).

**SSR outcome:** **IN.** three@0.185.1 ships `SSRNode.js` (`ssr()`); wired as a
toggleable additive stage. First-gen (blur-based) since a `roughnessNode` is passed.

### Decisions for review
- **MRT byte budget**: a 5th color attachment (separate metal/rough for SSR)
  overflows Dawn's `maxColorAttachmentBytesPerSample=32` on this adapter (40>32,
  pipeline creation fails). **Packed metalness→velocity.z, roughness→velocity.w**
  (velocity is a vec2 motion vector in RGBA16F; TRAANode reads only `.xy`, verified
  `TRAANode.js:664`). Stays at 4 attachments / 24 bytes. Alternative if this bites
  later: request a higher `maxColorAttachmentBytesPerSample` limit at device init
  (adapter supports 128) — but that's a harness/three-init change, deferred.
- **Graph rebuild on mode/view change** (dispose old post wrapper each time) rather
  than a static graph with uniform-driven branches — so an un-toggled effect
  (e.g. SSGI while in GTAO mode) costs zero GPU (its `updateBefore` only fires when
  referenced). Right call for a perf bench; sliders stay uniform-only (no rebuild).
- **`SceneContext` gained `renderer`** (additive; KTX2Loader.detectSupport needs
  it). Procedural scenes ignore it.
- **glb via Vite `?url`** (not `public/`) so `bench/assets/` stays gitignored and
  the fetch script owns it; Vite emits it on build (confirmed in `dist/`).
- **Decoders in `public/decoders/`** served at `/decoders/…` (gitignored, staged by
  the fetch script). DRACOLoader uses the `draco/gltf/` subdir.
- Sponza default camera: harness `OrbitControls` retargets to `(0, camY, 0)` after
  scene create, so the scene's `lookAt` only sets initial orientation — fine here
  (target lands mid-atrium).

**Open bugs:** none. **Not committed** (left for review).
**Next:** M2 — demo 02 (reference + accumulation) + A/B comparator (owned by
another agent).
