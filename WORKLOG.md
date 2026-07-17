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
