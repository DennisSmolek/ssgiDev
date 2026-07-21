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

---

## 2026-07-18 — M3: demo 03 SSRT3-complete WebGPU compute port (staged a–g)

The biggest single lift: a full WebGPU **compute** port of cdrinmatane/SSRT3,
restoring everything three's TSL `SSGINode` dropped. Built in a worktree branch
`m3-demo-03-ssrt3` off `main` (which already carried M0–M2; the requested
`git merge main` was a no-op). Committed per validated stage. Full lineage,
wiring, params, and validation evidence in `bench/src/demos/03-ssrt3/README.md`.

- **New harness class `RawComputePass`** (`harness/raw-compute-pass.ts`):
  declarative-binding sibling of M2's `RawRenderPass`, dispatches 8×8-workgroup
  WGSL (matching SSRT3 `[numthreads(8,8,1)]`). Bind kinds: depth / tex /
  sampledTex / sampler / storage / uniform; `execute()` gained an optional
  `storageMip` for the pyramid downsample. `three-internals.ts` gained
  `ensureTexture()` (`renderer.initTexture`) to force-allocate standalone
  StorageTextures. Compute outputs are three `StorageTexture`s (STORAGE_BINDING |
  TEXTURE_BINDING) — interop rule holds, outputs stay TSL `texture()` nodes.
- **Pipeline** (6 compute passes/frame): gbuffer → lightmask(f) → depth-pyramid(g)
  → main march(a-c,e,g) → temporal(d) → bilateral denoise(d) → TSL composite(f).
- **All 23 SSRT3 tunables** exposed via the harness schema (SSRT3 defaults),
  firefly clamp as a **param** not hardcoded, plus `mbDamping`. Debug views
  combined/ao/gi/beauty + ao-raw/gi-raw (raw-vs-denoised). Per-scene world-space
  radius/thickness (cornell 5/0.5, sponza 8/2, zoo 3/0.3).

### Per-stage status — ALL VALIDATED (headless Playwright, cached chromium-1228,
`--enable-unsafe-webgpu`; screenshots `bench/screenshots/03*`):
- **(a) GTAO plumbing** — Jimenez-2016 slice integral; AO structure matches demo
  01 GTAO on cornell.
- **(b) VBAO bitmask** — 32-bit sector mask; thin plates over-darken far less than
  GTAO on artifact-zoo (occlusion at true contact lines).
- **(c) GI gather** — newly-revealed-sector radiance; red/green bleed on cornell
  like demo 01/02.
- **(d) temporal + bilateral denoise** — world-pos-reject reprojection + 16-tap
  depth/normal bilateral; converged still-camera GI far cleaner than raw, camera
  orbit clean with no ghosting.
- **(e) probe fallback §3.2** — the headline missing feature; per-slice bitmask
  split into K ranges, directional equirect ambient weighted by unoccluded
  fraction. With fallback the ceiling/camera-facing surfaces that go BLACK
  without it hold a dim ambient floor. Both weightings + cone→mip toggles wired.
- **(f) multibounce** — GI feedback via a lightmask pass (damped, convergent:
  mean luminance 99.7→103.8, early==late so it plateaus) + Activision analytic
  multibounce AO at composite.
- **(g) bandwidth opts** — depth mip pyramid + `mipOptimization`,
  `normalApproximation`. No visual regression; compute-only GPU timing (sponza,
  1280×800, rc4/sc32, `onSubmittedWorkDone` fence): baseline 15.61 ms →
  mipOpt 8.85 (−43%) → normalApprox 13.59 (−13%) → both 8.21 (−47%).

Also verified: works on **cornell + sponza + artifact-zoo** and at **renderScale
0.5** (`03-cornell-halfres.png`), zero page errors, typecheck + build green after
every stage.

### Decisions for review
- **Fallback ambient = equirect, not three's cube-uv PMREM.** three's PMREM atlas
  packing is impractical to sample from raw WGSL, so I sample a procedural
  per-scene equirect radiance texture directionally at the cone LOD (option A
  adapted). Not wired to `scene.environment` (keeps beauty unchanged, isolates
  the fallback term). The paper-vs-SSRT3 normalization divergence and cone-mip vs
  mip-3 are shipped as toggles (future experiments, per the packet).
- **Temporal prev-depth proxy** (current depth at reprojected coord; no prev-depth
  copy pass) — world-delta reject still catches disocclusion.
- **Standard-three view space reconstructed then flipped** to SSRT3's convention
  so the horizon/bitmask/fallback math ports verbatim. Perspective-only
  (`halfProjScale`), documented.
- **Trap list honoured:** UV top-left, view-space flip bridge, PI (not PI2) slice
  rotation, NO stepRadius double-divide (matched SSGINode's fix), albedo
  modulation at composite, firefly clamp as a param, multibounce damped.
- **Three raw-pass classes now coexist** (`RawFragmentPass`/`RawRenderPass`/
  `RawComputePass`) — reconcile in the polish pass (flagged since M2).
- **Timing method:** a `queue.onSubmittedWorkDone()` fence around N compute
  iterations (exposed on `window.__ssrt3bench`), NOT a custom timestamp-query set
  — the vsync-locked rAF loop couldn't reveal sub-8ms compute cost, and the
  harness three-side timestamp doesn't cover raw compute submissions.

**Open bugs:** none. **Branch:** `m3-demo-03-ssrt3` (7 stage commits, a→g).
**Next:** M4 — demos 04–06 (GT family + Mathis SSHGI).

---

## 2026-07-18 — M4 merged: demos 04 GT-VBAO, 05 GT-VBGI, 06 SSHGI (Mathis)

Two parallel worktree agents (M4a: 04+05 on `m4-gt-family`; M4b: 06), merged into
main by the orchestrator after M3 landed (conflicts: registry lines only).
Combined typecheck/build re-verified post-merge. Full detail in the per-demo READMEs.

- **Demo 04 GT-VBAO**: Salm XXGSDd (LIVE semantics incl. GetQuaternion fix,
  mirrored for three's opposite view-space z). **Converged AO diffs seamlessly
  vs demo 02 reference** (8× amplified diff = uncorrelated MC noise, no bias
  regions) — the founding "converges to reference" claim holds in our port.
- **Demo 05 GT-VBGI**: one demo, variant switch — bidirectional (cleanest),
  unidirectional (half samples, noisier per-frame as designed), uniform-weighted
  (no acos, slightly flatter). All converge to reference GI; honest caveat:
  slightly less near-field bounce on short-box top vs brute-force (screen-space
  limitation, documented). wcsXDN slice-relative mapping deferred to labs 07/08
  (it's distant-light sampling, doesn't compose into beauty-buffer bounce).
- **Demo 06 SSHGI**: Mathis dsGBzW 5-pass graph ported 1:1 (source/march/accum/
  gcopy/compose). Preserved his divergent estimator verbatim: 4 single-sided
  horizons @90°, 32-vs-64 bin/weight divisor mismatch, sqrt emitter-facing
  weight with no receiver N·L. Multibounce plateaus (no runaway); added explicit
  feedback damping (default 0.5; 1.0 = his original). Added optional velocity
  reprojection (toggle; off = his static accumulate) — fixes his documented
  dynamic-scene ghosting.
- **Traps found**: unidirectional march must start d=+1 (not −1) or near-black
  frame; esbuild binary needs pnpm onlyBuiltDependencies on fresh installs
  (workaround note in M4a report).

**Validated:** all three demos headless-screenshot on cornell (+sponza/zoo for
04/05); typecheck + build green on merged main (7 demos registered).
**Open:** three raw-pass classes (RawFragmentPass/RawRenderPass/RawComputePass)
to reconcile in polish; live cross-demo pixel-diff needs demo 02's marcher
promoted to a shared harness pass.
**Next:** M5 — labs 07–11, five parallel worktrees.

---

## 2026-07-18 — M5 merged: labs 07–11 (five parallel worktrees)

All five labs delivered with Findings sections (see per-demo READMEs — they are
the primary record; this is the digest). Two agents (08, 09) died at launch and
were restarted into hand-provisioned worktrees (m5-lab08/m5-lab09).

- **07 ambient-lab**: §3.2 source comparison. **SSRT3's shipped normalization
  beats the paper-literal reading** (paper version blows out up to K×);
  **hardcoded mip 3 beats cone→mip** (which over-blurs). Default: equirect
  source (A). LightProbeGrid is WebGL-only in 0.185.1 (WebGPU PR #33913 not in
  release) — hand-rolled SH grid used instead; revisit on a future three bump.
  Physics split found: directional-occlusion sources tint away from the near
  wall; positional probes tint toward it. Fallback ≈ +1.2–1.6 ms at heavy
  settings. Harness gained `?cam=` pose override.
- **08 distant-light**: per-pixel thickness problem reproduced on graded plates
  (constant t fails across 20→500 mm; crossover ≈ mid-plate). **Winner:
  Ottosson 3clGWB occluder-size heuristic** (~+40% cost, holds full range);
  wcBGRz adds crisper contact +2%. **Distant light: Salm caps default** (matches
  per-bin at 15–26% cheaper). wcsXDN slice-relative mapping integrated here.
  RawRenderPass gained sampledTex/sampler binding kinds.
- **09 bandwidth**: **half-res + joint bilateral upsample = ship it** (4.1–6.3×
  chain speedup, <0.5 ms fixed overhead, no silhouette halos; quarter-res 21×
  usable for previews). **LSAO shared-memory caching: honest negative**
  (0.87–1.06×; bitmask needs full-sector occupancy, exponential far steps miss
  the tile). **Fragment vs compute: no speed difference** (bandwidth-bound);
  compute's value is capability only.
- **10 denoise**: fixed noisy producer (demo 03 @ rc1/sc8) + 5 stacks.
  **Default: SSRT3 temporal+bilateral (A/A−/1.43 ms); Mathis close second, ~7%
  cheaper.** TRAA headline: rewards low-variance temporally-stable input;
  spatial-only stacks + TRAA over-smear; none+TRAA leaves unclippable speckle.
  Found: demo 03's producer jitter is FRAME-STATIC (rand(uv) never advances) —
  temporal mean can't converge it; polish-pass fix queued.
- **11 sampling**: quantitative (readback MSE). **Both Salm claims held**
  (Hilbert more isotropic raw; IGN denoises best). **Default: IGN when
  denoising; blue-noise texture when not.** STBN-approx (16 tiles) plateaus
  under deep accumulation. Blue-noise atlas generated offline
  (bench/scripts/gen-bluenoise.mjs, committed PNG). pnpm-workspace gained
  onlyBuiltDependencies: esbuild (fixes fresh-install builds).

**State: all 12 demos (00–11) on main, typecheck/build green after every merge.**

**Consolidated polish-pass queue (from all Decisions-for-review):**
1. Reconcile RawFragmentPass / RawRenderPass / RawComputePass into one family.
2. Fix demo 03 frame-static jitter (rand(uv) → per-frame advance); re-run lab
   10's reference after.
3. Promote demo 02's marcher to a shared harness pass (live cross-demo diffs).
4. Demo 01 velocity.zw metal/rough packing — revisit vs raising
   maxColorAttachmentBytesPerSample at device init.
5. Demo 03 temporal uses current-depth proxy for prev-depth — consider real
   prev-depth copy.
6. three bump watch: LightProbeGrid WebGPU (lab 07 Source B), SSGINode updates.
7. Wasted beauty blit in demo 00's pass ordering (minor).

---

## 2026-07-18 — Live-testing fixes (Dennis's first hands-on pass)

Three defects found by actual interactive use that headless URL-param
screenshots structurally could not catch (each screenshot was a fresh page
load, so runtime state changes were never exercised):

1. **FPS readout was 1000/cpu-work-ms** (reported 2200+ "fps" on a 160 Hz
   display). Now measured as wall-clock interval between frame starts,
   >500 ms gaps dropped. Verified headed: 165 fps on a 165 Hz display.
2. **Live view switching did nothing in demo 00** (and was unreliable
   repo-wide): three's RenderPipeline only re-reads outputNode when
   `needsUpdate` is set. All 12 demos now set `pipeline.needsUpdate = true`
   at their view-update site. Some demos appeared to work because their
   param changes rebuild enough graph to trigger recompiles indirectly;
   the flag is now explicit everywhere.
3. **Beauty/scene quality gap vs the official three.js SSGI example**: our
   5.5-unit cornell has no shadow-casting light and gray boxes, and demo 01's
   default radius (~12) is tuned for the official 20-unit room — on the small
   box it over-reaches and reads far noisier. Added `cornell3` scene
   ("Cornell (three.js example)"): faithful replica of
   webgpu_postprocessing_ssgi.html's scene (20×15×20 room, PointLight 100
   w/ 1024² shadows, white MeshPhysicalMaterial boxes, fixture cylinder,
   ambient 0x0c0c0c, camera fov 40 @ (0,10,30)). Demo 01 on cornell3 now
   visually matches the official demo (verified headed). The 5.5-unit
   cornell stays — all lab-tuned world-space defaults reference it.

Also: DEMOS.md demo-01 row clarified — TRAA IS wired (default), selector
TRAA/Denoise/none; "BYO" only describes upstream three, not our demo.

**Verification note for future sessions:** headless chromium here falls back
to software WebGPU (black canvas, ~200 ms GPU) — use `headless: false` for
render verification; `--enable-unsafe-webgpu` alone, no Vulkan flag.

---

## 2026-07-18 — Shadow maps enabled across all scenes (Dennis's catch)

No scene except cornell3 cast shadows: renderer.shadowMap was only enabled
inside cornell3, and cornell/sponza/artifact-zoo had no castShadow flags at
all. This is not cosmetic: SSGI gathers from the beauty buffer — direct-light
shadows come from shadow maps, never from screen-space GI, so a shadowless
beauty hands every technique (including demo 02's combined view) a physically
wrong input. Sponza's "arcades fall into shadow" scene comment was
aspirational until now.

- Harness: `renderer.shadowMap.enabled = true` at bootstrap (app.ts).
- cornell: point light casts (1024²), walls receive, boxes cast+receive
  (emissive panel excluded, like the official example's fixture).
- artifact-zoo: sun casts (2048², bounds ±10), all objects cast+receive —
  thin-geometry contact shadows are half the scene's purpose.
- sponza: sun casts (2048², bounds ±20, normalBias 0.03), all glTF meshes
  cast+receive. Corridor now properly dark with sunlit atrium beyond — the
  GI/fallback test environment the scene was designed to be.

Verified headed on all four scenes (cornell shows the official demo's two box
shadows; fps reads 165 on the 165 Hz display). NOTE: all pre-shadow
screenshots in bench/screenshots/ are historical — lab quality comparisons
against a shadowless beauty remain valid A/B-internally but don't represent
current beauty output.

---

## 2026-07-18 — Demo 06 combined-view blowout fix (Dennis's catch)

Combined view was washed out while the GI view looked correct: the compose
shader kept Mathis's Shadertoy output transform verbatim — ACES + manual
pow(0.45) gamma — but only in combined mode, and the result then passes
through three's display pipeline which applies its own linear→sRGB encode.
Combined was gamma-encoded TWICE; GI view (no manual transform) was encoded
once, hence the asymmetry. Shadertoy has no output encoding stage, so the
manual gamma was correct in Mathis's context and wrong in ours. Fix: ACES
stays (in linear), manual gamma removed. Verified headed on cornell —
contrast/saturation restored. Grep confirmed no other demo WGSL carries a
manual gamma.

Trap added to the list: when porting Shadertoy code, its final pass always
includes display encoding (gamma/tonemap) that must be REMOVED when the
output feeds three's pipeline, which encodes on its own.

---

## 2026-07-18 — Demo 03 grazing-surface artifact (Dennis's catch) — two defects

Symptom: dark noisy veil on grazing surfaces (ceiling, box tops, side walls
depending on view) that never accumulates away; absent from demos 01/02/04.

1. **Stage-(a) falloff math bug**: `cHorizon = max(cHorizon, c * falloff)`
   scales the sample COSINE by the distance falloff — for negative cosines
   (geometry below the tangent plane) that drags values toward 0 and RAISES
   the horizon, manufacturing occlusion on flat grazing surfaces; jittered
   step distances modulate it per frame (the un-accumulatable boil).
   Canonical GTAO (GTAONode.js:519) fades the RESULT toward the previous
   horizon: `cHorizon = mix(max(cHorizon, c), cHorizon, distFacSq)`. Fixed in
   demo 03's ssrt-main.wgsl AND lab 09's forked march (same inherited line).
   Diagnosis matrix: artifact invariant to temporal/radius/thickness toggles,
   confirmed via matched-camera A/B vs demo 02 (?cam= override).
2. **Wrong boot defaults**: demo 03 defaulted to useBitmask=false,
   gatherGI=false, mip=false — i.e. it booted into the stage-(a) DEBUG path
   (custom GTAO scaffolding), not SSRT3. With the bitmask on, grazing walls
   are clean and match the reference's structure. Defaults now match shipped
   SSRT3: bitmask ON, GI ON, mipOptimization ON.

Known residual (logged, low priority): stage (a) — the debug path — still
over-darkens somewhat at grazing even with the falloff fixed; likely needs
GTAONode's full sample treatment. It's validation scaffolding, not the
algorithm under test.

---

## 2026-07-18 — Sub-pixel projection jitter (TAA-style AA) in accumulation demos

Feature: a `jitterAA` control (label "subpixel AA jitter", **default ON**) in
every accumulation demo. Our accumulation demos jittered only the
hemisphere-sampling noise, so the G-buffer rasterized identically every frame
and converged output kept aliased edges. Jittering the projection sub-pixel per
frame (exactly TRAANode's mechanism) makes a static-camera accumulation
integrate the pixel footprint over time — supersampled, AA'd, more-correct
reference quality.

**Harness (bench/src/harness/temporal.ts):** added `HALTON_JITTER` (16 centered
Halton(2,3) offsets in [-0.5,0.5) px, mirroring TRAANode's `_halton(i+1,base)`
convention), `applyCameraJitter(cam,w,h,jx,jy)` → `cam.setViewOffset(w,h,jx,jy,
w,h)`, and `clearCameraJitter(cam)`. Verified in three source that setViewOffset
sets `aspect = w/h` (unchanged here) and calls updateProjectionMatrix()
internally — no extra call needed.

**Demos done: 02, 04, 05, 06, 10, 11** (all six). Each: added the param, a
`jitterIndex`/`jitterActive` pair, and an `applyJitter()` that advances the
Halton sequence when enabled or clears the offset exactly once when disabled
(state-tracked, not cleared every frame). Jitter is applied with the CURRENT
`ctx.renderSize()` BEFORE the G-buffer pass renders, so the scene rasterizes and
the marchers (which read `cam.projectionMatrix[Inverse]`) share the same
jittered projection. dispose() clears any leftover offset (camera is shared
across demos). `?jitter=0`/`?jitter=1` URL override on all six for deterministic
captures.

**Guard verification — cameraMoved() does NOT trip on jitter:** every demo's
reset predicate hashes only position/quaternion/fov/aspect (never
projectionMatrix or .view). setViewOffset touches only the projection matrix (+
aspect, which stays w/h), so jitter never resets accumulation. Confirmed live:
demo 02 & 05 "accum samples" climb to the 512 cap with jitter ON.

**Demo-specific guards:**
- **06 (Mathis):** jitter enabled only in `static` accumulation mode
  (`v.jitterAA && v.reproject === 'static'`). Velocity-reprojection mode leaves
  the camera unjittered — the velocity MRT would read the jittered projection
  and register the sub-pixel offset as fake motion. Param label documents this.
- **10 (denoise):** jitter forced OFF when `v.traa` is true
  (`v.jitterAA && !v.traa`) — three's traa() drives its OWN onBeforeRenderPipeline
  Halton view-offset, so ours would double-jitter. updateOutputNode() already
  calls camera.clearViewOffset() on rebuild; that's harmless vs our ordering
  (the enabled path re-applies next frame). Toggling jitterAA or traa restarts
  the converged accumulate reference (this.reset). Param label documents it.
- **04/05/11:** straight demo-02 accumulate pattern.

**Verification (headed playwright, localhost:5180, --enable-unsafe-webgpu):**
pnpm typecheck + build both green. Demo 02 cornell, converged 9s, AO view:
jitter OFF shows a hard STAIR-STEPPED box top edge (classic aliasing);
jitter ON shows the same silhouette as a smooth AA'd gradient — conclusive at
5× crop. Evidence in bench/screenshots/aa-jitter-*.png (02 ao/combined on+off,
05 gi on, 06 static on; *-crop5x.png are the zoomed silhouettes). Demos 05 & 06
render correctly with jitter on, converged, no reset artifacts.

**Decisions for review:**
1. Combined-view caveat: the displayed beauty/albedo are single-frame (not
   accumulated), so silhouette AA is visible in the accumulated AO/GI channels
   (and any downstream A/B against those buffers), NOT in the live beauty
   multiplier of the "combined" composite. A whole-frame supersample would also
   need beauty accumulation — out of scope; the reference buffers are the point.
2. Toggling jitterAA resets accumulation in all demos (not a NON_RESET key) so
   the converged buffer never mixes jittered + unjittered samples.
3. Left the pre-existing (not mine) GTAO-falloff fix in demos 03/09 untouched.

Tree left uncommitted for review (no commit per instructions).

---

## 2026-07-18 — Demo 03: tangent-phantom sectors on flat surfaces (Dennis's catch #2)

Bitmask mode veiled flat surfaces (box tops) with rotation-modulated gray
speckle the temporal pass can't converge; reference renders them near-white.
Root cause: coplanar samples land exactly on the mapped hemisphere boundary,
where `ceil(span * 32)` stamps a phantom sector (1/32 AO per march step).
Faithful to SSRT3 — and SSRT3's own cure exists COMMENTED OUT in their
shipped compute (SSRTCS.compute L265, "remap bitfield on one sector narrower
hemisphere"); SSGINode inherits the same omission. Implemented that remap as
`sectorRemap` (default ON; off = shipped-SSRT3-faithful). Verified on a
box-top camera: veil gone with remap, matches reference structure.

Also added `freezeNoise` (default off): SSRT3's temporal rotation/offset
cycle advances EVERY frame by design (denoiser food) — that's the "flicker
with jitter off" report; the toggle pins it for static inspection.

Note for comparisons: `gatherGI` implies the bitmask in the WGSL (GI needs
sector counts), so gatherGI ON + bitmask UNCHECKED still marches in bitmask
mode — identical AO to bitmask-on is by design, not a bug.

## 2026-07-18 — Demo 03 box-top speckle: REAL root cause (screen-y vs view-y mirror)

Dennis disproved the phantom-sector/ceil() theory experimentally (endpoint-floor
quantization and ceil removal changed nothing) and supplied the winning clue:
GT-VBAO/VBGI (also bitmask) are clean, and Unity flips textures vs WebGPU.
Root cause: SSRT3 uses `sliceDir.xy` as BOTH the view-space slice direction
(builds planeNormal / projected normal angle n) AND the screen-space march step.
Legal in Unity (uv y-up == view y-up); in our compute port uv is y-DOWN
(top-left origin, viewPosStd flips y), so the marcher physically walked in
view direction (cos a, -sin a) while the hemisphere mapping assumed
(cos a, +sin a) — every slice mirrored about its own frame. Error scales with
grazing angle and varies with the per-pixel rotation noise → dark speckle on
flat tops, quantization-independent (why ceil/floor experiments were null).
Fix: mirror y in the screen step only —
`slideDir_TexelSize = vec2(sliceDir.x, -sliceDir.y) / resolution` — in
demo 03 ssrt-main.wgsl and the forked marchers in demos 07 and 09.
Verified headed on the box-top camera (diag-03e.mjs): raw AO clean/near-white,
combined shows correct green-wall bounce, no speckle.
Retraction: the 2026-07-17 sector-remap entry over-claimed — the remap only
slightly attenuated the artifact; it remains as an SSRT3-faithful toggle but is
NOT the cure. Stage-(a) "edges super dark" residual likely shared this cause;
re-check before treating it as a separate bug.
Also: subpixel AA jitter now defaults OFF in all demos (02/04/05/06/10/11) —
without a reprojecting TRAA/FSR resolve it never settles (Dennis request).

## 2026-07-18 — Stage-(a) re-verify after y-mirror fix; polish pass launched

Stage (a) (classic GTAO path: bitmask OFF, GI OFF) re-checked post y-fix on
box-top + wide cameras. The broad grazing over-darkening reported earlier is
GONE (shared the y-mirror root cause, as suspected). Remaining stage-(a)
character: dark noisy silhouette halos (classic GTAO thin-occluder full-horizon
blocking — exactly the failure the bitmask exists to fix) and a noisy dark
frame at screen borders. Verified NOT mip-pyramid related (identical with
mipOptimization off). Root cause of the border frame not chased — stage (a) is
validation scaffolding, not a shipping path; bitmask path on the same cameras
is clean. Logged under Decisions for review.
Polish pass in flight (two Opus worktree agents): (A) demo 03 real prev-depth
pass + frame-count accumulation toggle (default off, SSRT3-faithful default) +
per-frame jitterSamples advance; (B) demo 02 reference marcher promoted to a
shared harness ReferencePass + reference/split/diff views in demos 04/05.
Demo 03 reference-view wiring happens at merge (avoids worktree conflict).

## 2026-07-18 — Demo 03 temporal: real prev-depth, frame-count accumulation, per-frame jitter

Three targeted changes to `bench/src/demos/03-ssrt3/` (temporal stage d + march
jitter). Typecheck clean; verified headed (Cornell, box-top cam) — see below.

**Task 1 — real previous-depth pass.** `ssrt-temporal.wgsl` used the CURRENT
depth at the reprojected coord as a prev-depth proxy. Now a real prev-depth
buffer, like SSRT3's `previousDepthTexture` (SSRT_HDRP.cs). Added an r32float
single-mip StorageTexture `prevDepthTex` and a tiny copy pass
`ssrt-copydepth.wgsl` (`RawComputePass`) that copies the current depth buffer
into it each frame AFTER the temporal pass consumes the prior copy. Temporal now
binds `prevDepthTex` and uses it for `dPrev`. First frame / resize: the temporal
reset short-circuit (`frameCounter < 2` / `resetTemporal`) stores current and
returns before reading `dPrev`, so the uninitialized copy never rejects startup
history; by frame 2 the copy holds frame 1's depth. Resize + dispose handled
like the other storage textures.

**Task 2 — frame-count accumulation toggle (our improvement, DEFAULT OFF).**
New param `accumMode` ['ssrt3-ema','frame-count'] (default ssrt3-ema =
SSRT3-faithful) + `accumFrameCap` 4..64 default 16, both in the
'temporal & denoise' group. `ssrt3-ema` keeps the fixed-`temporalResponse` EMA
(~3-frame memory) that can't converge SSRT3's 12-frame (6 rotations x 4 offsets)
noise cycle -> boil. `frame-count` keeps a per-pixel counter N in an r16float
ping-pong pair (`countA`/`countB`), reprojected alongside the GI history: N=1 on
disocclusion (`posSimilarity < 0.5`), off-screen reproj, or reset; else
N=min(N+1, accumFrameCap); blend weight = 1/N. Soft neighborhood clamp (mix 0.25)
kept in both modes. N is written in both modes so switching needs no reset. Packed
`accumMode` as flags bit2 and `accumFrameCap` as f32 into TParams' trailing pad
(16-byte alignment preserved).

**Task 3 — per-frame jitter advance.** `ssrt-main.wgsl` F_JITTER used
`rand(uv)` (frame-static -> temporal accumulator can never average it out, lab
10). Now `rand(uv + vec2(f32(frameSeed % 64u)) * 0.6180339887)` so the jitter
decorrelates per frame. `frameSeed` (uniform) is now driven from `fc` (the
freeze-aware frame counter) instead of the raw `frameCounter`, so `freezeNoise`
pins the jitter too. Deliberate deviation from SSRT3 (ships frame-static rand) —
documented in the WGSL comment + README.

**Verification (headed, Cornell, cam=1.4,3.6,4.6,0.95,1.3,0.7, 5182):** no
WebGPU/pipeline errors (r16float + r32float storage formats both valid on this
device). gi view, mean abs per-pixel diff between two shots 2s apart after 6s
settle: frame-count = 0.83 (converged, near-identical), ssrt3-ema = 3.38 (~4x,
visible boil) — the intended contrast. combined view identical & correct in both
modes (red/green wall bleed, soft AO, no ghosting/regression on the static scene).
Screenshots: scratchpad/{fc,ema}-{gi-a,gi-b,combined}.png.

### Decisions for review
- **Counter texture is r16float** (per packet). r16float IS storage-capable on
  the test device (Chrome/Metal) — pipeline built, no validation error. If a
  target device lacks r16float storage, swap `makeR16` + the WGSL/binding format
  to r32float (values are small integers 1..64, no precision concern).
- **Prev-depth first-frame** relies on the existing reset short-circuit rather
  than an extra pre-first-frame copy — simpler, and history is never read during
  reset anyway. No separate "copy before first temporal" pass.
- **Jitter advance uses `frameSeed % 64`** golden-ratio-scaled — bounded,
  low-discrepancy, and pinned by `freezeNoise` via `fc`. Period 64 frames is far
  longer than the accumulator's memory so it reads as decorrelated.

## 2026-07-18 — Shared ReferencePass: ground-truth comparison as a harness feature

Promoted demo 02's brute-force reference marcher into a shared harness pass so any
demo can show a ground-truth comparison, and wired it into demos 04/05 with three
new view modes.

What moved where:
- `bench/src/demos/02-reference/reference-marcher.wgsl` → `bench/src/harness/
  reference-marcher.wgsl` (now the ONE copy).
- New `bench/src/harness/reference-pass.ts` — `ReferencePass` class: owns the
  marcher `RawRenderPass` (additive-blend), the accumulation `RenderTarget`
  (`accumRT`, rgb = GI sum / a = AO sum), the running `sampleCount`, and the
  camera-pose-reset logic (the float64 pose snapshot + 2e-4 EPS trap, copied
  verbatim from demo 02). API: `setSize` / `configure` / `reset` / `update(camera,
  inputs, params, w, h)` / `renderSingle(target, …, seed)` / `sampleCount` /
  `outputTexture`. `ReferenceInputs` = {depth, normal, beauty}; `ReferenceParams`
  = the marcher's tunables.
- Demo 02 refactored to consume it: `update()` for the converged accumulation
  (its primary output), `renderSingle()` for the 1-sample live split buffer.
  Behaviour unchanged (verified: combined converges to 512, split shows live-vs-
  converged wipe).
- Demos 04/05: `VIEW_MODES` gained `reference` | `split` | `diff` (split/diff are
  view modes now, not an `A/B mode` param). `viewMode` enum carries a `hint:`
  explaining them. Reference sampling params moved into a `reference` sub-folder
  via `group:`. Demo 11's marcher import repointed to the harness copy (one line,
  to keep the one-copy invariant + build green).
- Interop rule honoured: `ReferencePass` allocates its accumulation target as a
  three `RenderTarget` (+`ensureRenderTarget`); the raw pass only writes into it.

Lazy-run contract: `ReferencePass` does not decide when it runs — the host demo
does. Demo 02 (reference IS its output) calls `update()` every frame. Demos 04/05
call it ONLY while `viewMode ∈ {reference, split, diff}` and call `reset()` on the
frame such a view is (re)activated (tracked via `wasRefActive`) so a parked pass
never shows stale samples. GT-VBAO/VBGI and the reference accumulate independently,
each divided by its own count (`uCount` vs new `uRefCount`).

Verification (headed chromium, cornell, cam=0,2.4,8.8,0,2.6,0, 5-6s settle):
- Demo 02 combined: converged Cornell (512 samples), AO + color bleed — unchanged.
- Demo 02 split: noisy 1-sample live (left) | clean converged (right), divider OK.
- Demo 04 split: GT-VBAO | reference AO wipe, divider visible, halves match.
- Demo 04 diff (×12): bright along creases/box edges/contact shadows (structural
  GT-VBAO-vs-reference divergence) + amplified residual MC noise.
- Demo 05 split (rgb): GT-VBGI | reference GI, color bleed both sides.
- Demo 05 diff (×12): red box face + ceiling show the largest GI divergence.
- Perf gating: gpu ms (render) with reference PARKED vs ACTIVE — demo 04
  4.74 → 9.13 ms, demo 05 6.52 → 11.59 ms. `combined`/`ao`/`beauty` pay zero
  reference cost, confirming the lazy contract. (fps is vsync-capped at 60, so
  gpu ms is the load signal.)
- `npx tsc --noEmit` clean.

Decisions for review:
- **ReferencePass constructed eagerly, run lazily.** The task said "instantiate
  lazily"; I read the intent (from its rationale — "the marcher is EXPENSIVE, so
  it must only run while a reference view is active") as lazy *execution*, and
  construct the object eagerly so its `outputTexture` is a stable node for the TSL
  display graph (built once in `updateOutputNode`). The expensive per-frame
  marcher is fully gated. If true deferred GPU-resource construction is wanted, it
  needs the display nodes rebuilt on first activation — happy to switch.
- **split/diff promoted from an `A/B mode` param to `viewMode` values** in 04/05
  (kept as-is in 02, whose split is a different live-vs-converged comparison). The
  old `?cmp=split|diff` URL still works (maps to the view).
- **`diff` at the default amp is not pitch-black** on 04/05 — GT-VB* are horizon
  approximations, so there is genuine systematic divergence from the brute-force
  reference (creases, grazing edges, near-field GI), which is exactly what the
  diff view should surface. The uniform grain is residual MC noise × amp.
- **Independent accumulation counts** (uRefCount): when a reference view opens
  mid-session the reference starts from 0 while GT-VB* may already be converged, so
  the split briefly compares a noisy reference against a clean demo side until it
  settles. Correct, but worth knowing when reading an early split.
- **Local dev-env only (not committed):** the worktree lacked `bench/assets/` and
  `bench/public/decoders/` (both gitignored), so the Sponza scene 500'd and vite's
  error overlay covered the cornell canvas — symlinked them from the main checkout
  to verify. Does not affect cornell/the shipped code.

## 2026-07-18 — Demo 03 wired to the shared ReferencePass (orchestrator)

Added reference/split/diff views to demo 03 using agent B's harness
ReferencePass + Comparator (same lazy-run contract as 04/05: oracle only runs
while a reference view is active; divider draggable in split). A/B channel
param defaults to 'alpha' (AO — cleanest apples-to-apples); 'rgb' divides the
demo side by GIIntensity to undo SSRT3's non-physical gather gain before
comparing. Verified headed (cornell, wide cam), zero page errors.
Findings the new views immediately surface (real signal, not bugs — logged for
the testing phase):
- rgb split: SSRT3's sector-weighted GI at unit gain is much dimmer than the
  cosine-weighted brute-force gather — this is WHY Therrien ships
  GIIntensity=10; the normalized comparison makes the gap visible.
- alpha diff at default amp 8 saturates white from a systematic ~0.1 AO offset
  on open surfaces (uniform sector visibility vs cosine-weighted MC AO);
  lower diff amp to ~2 to see structure. Same class as 04/05's
  "diff not pitch-black by design".

## 2026-07-19 — Phase docs: TESTING.md, NEXTGEN.md, FSR3-BRIEF.md

Wrote the three phase documents Dennis requested:
- TESTING.md — testing-phase plan: measurement grid (scenes × cameras),
  test matrix (quality-vs-oracle, perf budget map, temporal behavior,
  cross-demo bake-off), and CRITICALLY a lab re-validation pass FIRST: labs
  07/09/10/11 recorded findings before the y-mirror fix + jitter advance
  (lab 09 perf ratios safe; lab 10's frame-static-rand finding now stale;
  lab 11 MSE table needs re-running on the fixed marcher).
- NEXTGEN.md — distillation plan + Dennis's dictated principles: faithfulness
  boundary (demos/labs stay source-faithful FOREVER, our own work goes in
  new demos 12+ AFTER testing), optimization principles as perf GOALS not
  hard rules (IQ noacos-style trig avoidance, branch/loop/precision hygiene,
  bandwidth-before-ALU per lab 09, adaptive-over-uniform), success measures
  (targets pinned after Phase T baselines), measurement-or-no-merge rule.
- FSR3-BRIEF.md — decomposition contract for Dennis's separate FSR3 port:
  4 pass boundaries (reconstruct&dilate / locks&reactivity / accumulate+
  upsample / RCAS), temporal-guides texture bundle contract, r185/WebGPU
  trap list (needsUpdate, velocity convention, y-mirror seam, RCAS must be
  tonemap-agnostic re: the known ACES-in-RCAS bug), acceptance = bench lab
  A/B-ing guides-fed temporal vs private logic.
PLAN.md got a phase pointer at the top. advantagous-concepts.md (Dennis's
paste of the improvement inventory) is referenced as the concept backlog.

## 2026-07-19 — WebGPU capability probe (live, Chrome 149 / Apple metal-3)

Headed probe of the actual dev machine adapter: `subgroups` PRESENT and
device-grantable (plus WGSL `subgroup_id`/`subgroup_uniformity`);
`shader-f16` PRESENT (real f16 arithmetic available for the NEXTGEN precision
pass); `timestamp-query` PRESENT (GPU-timestamp option for P0 runners);
also `chromium-experimental-subgroup-matrix`. Consequences folded into
NEXTGEN P5: subgroup experiment confirmed viable today; CACAO-style
deinterleaved marching promoted to MUST-DO (Dennis); new standing rule:
feature-gated optimizations ship as variant pairs with runtime detection and
a fallback that stays in the regression matrix. Probe script:
scratchpad/probe-subgroups.mjs (trivially re-runnable on other browsers to
fill the support matrix — Safari/Firefox status unverified).

## 2026-07-21 — P0: committed lab runners (bench/scripts)

**Packet P0 (NEXTGEN workplan) — "Lets go!" greenlight from Dennis.**

**Methodology core (Fable):** `bench/scripts/lib/harness.mjs` pins the recorded
methodology in one importable place: headed Chrome launch (`channel:'chrome'`,
`--enable-unsafe-webgpu`; falls back to bundled chromium), config driving via a
new `window.__benchParams` hook in harness `params.ts` (import/export JSON —
no clipboard permission games), the WORKLOG stability metric (6s settle / 2s
gap / pane-clipped mean-abs-diff via pngjs), lab 09's min-of-3×40 fenced
bursts, and `writeResults()` stamping every table with commit hash + the
config exported back FROM the page (ground truth, not intent). New
`window.__resolved` hook in `app.ts` because the registry silently falls back
to demo 00 on unknown ids — a runner recording numbers against the wrong demo
is the nightmare scenario; `openDemo()` now asserts. Deps: playwright-core +
pngjs as bench devDeps (real Chrome, no browser downloads).

**Grid cams pinned (Fable, visual pick from headed candidate shots):**
`GRID_CAMS` in the lib + TESTING.md table updated. New poses: C-contact
`3.0,1.6,3.6,0.3,0.5,0.1` (short-box/floor contact + inter-box gap), S-hall =
the sponza default corridor pose `11,1.8,-0.3,-10,2.6,-0.3` (it already IS the
atrium length view), S-column `2.0,1.6,0.0,3.4,1.4,-2.6` (banner edges,
hanging pot on chains, vines against a column — the thin-occluder cell).
Sponza world bounds logged during the pick: size (29.8, 12.4, 18.3).

**Runners (two Sonnet agents, Fable review):**
- `run-09.mjs` — drives `__bench09` (scene × rc/sc × marchScale × dispatch),
  compute/fragment paired back-to-back per cell; up-pass only measured sub-full-res.
- `run-03bench.mjs` — `__ssrt3bench` over the full GRID_CAMS grid × default/
  heavy × mip on/off paired; rc/sc re-read from exportConfig after applying.
- `run-10.mjs` — stability metric per stack (none/ssrt3/mathis/xegtao/
  denoise-node) × combined+gi views + demo 03 ema/frame-count cross-ref rows,
  with a >3×-off-ballpark warning against the WORKLOG 3.38/0.83 anchors.
- `run-11.mjs` — drives `__lab11.measure()` (found: attaches only after the
  async blue-noise atlas load — runner waits on the function, not just page
  ready; returns a JSON *string*: {truthFrames, frames, mse{noise→frame→v},
  shimmer{noise→v}}).
- `run-07.mjs` / `run-08.mjs` — screenshot spot-check grids + manifest tables.
All six verified headed with `--quick` against the live server; quick runs
stamp `meta.note = 'quick smoke run — not a recorded number'`.

**Review fixes (Fable):** run-03bench rewired to GRID_CAMS (was 3 hand-listed
cells); per-row `config` JSON kept in results .json but excluded from the .md
tables (readability).

**Smoke observations (not recorded numbers):** lab 09's shape reproduces
post-y-fix even in the 1×10-iter smoke (half-res march ~4.6× cheaper at
default config); lab 11's shimmer ordering already matches the pre-fix
qualitative ranking (ign highest, hilbert/blue lowest) at truthFrames=16.
Track D full runs are next and are the recorded numbers.

## 2026-07-21 — P1 Track D: lab re-validation on the fixed base (COMPLETE)

All via the P0 runners, full methodology, strictly serial (no GPU contention).
Results committed under `bench/results/` (tables stamped with commit + page-
exported config; screenshots under `results/shots/`).

**Lab 09 — HOLDS.** Post-y-fix: half-res chain 3.8–5.4× vs recorded 4.1–6.3×
(sponza heavy 23.97→4.66 ms, cornell heavy 11.96→2.23 ms), quarter ~22×,
down/up machinery still <0.5 ms, frag/comp within noise except one 1.13×
outlier (cornell heavy fragment march). Absolutes drifted up on sponza heavy
(20→24 ms) — fixed marcher does more correct grazing-angle work + thermal
±15%; ratios are the recorded signal and they hold. Verdict unchanged: ship
half-res + joint bilateral.

**Lab 10 — verdict refined + bench bug found/fixed.** run-10's first pass
returned stability 0.0000 for the ssrt3 stack — black canvas, not
convergence: lab 10 imports demo 03's `ssrt-temporal.wgsl` verbatim and
c77e960's frame-count rewrite changed that file's binding layout (bindings
0-8, prev-depth + count textures), silently killing the lab's pass. Fix:
frozen fork `10-denoise/ssrt3-temporal-ema.wgsl` at c77e960^ (the faithful
SSRT3 EMA is what the lab wants anyway), README updated. Post-fix stability
re-rank (combined / gi): mathis 0.10/0.46, xegtao 0.21/1.11, ssrt3-EMA
2.07/6.83, denoise-node 4.83/8.42, raw 10.05/47.51. Demo 03 cross-refs same
methodology: ema 4.90, frame-count 1.50. The pre-fix "Mathis and SSRT3
cleanest" headline splits: count-based accumulation (mathis / our
frame-count) is decisively steadier than EMA; EMA's boil is now quantified,
not just visible. LESSON (standing): cross-demo `?raw` WGSL imports are
interface coupling — when a source file's bindings change, forks must be
frozen copies (demo 07 pattern) or they break silently.

**Lab 11 — REPRODUCES + measure-hook race found/fixed.** First runs showed
non-monotone MSE (mse32 > mse8 every noise) with a false trail: I first
blamed rAF pollution, "fixed" it by backgrounding the tab, and the numbers
didn't change — because playwright's newPage opens a separate WINDOW, so the
demo kept rendering (retracted). The truth-size experiment (truthFrames 64 vs
512, frames [8,24,48,96]) showed the polluted batch VARIES by run/noise while
mse8 is always clean — the await-window race signature: measure() shares
vbaoRT with the live frame loop, and any live frame landing inside a readback
await clears/rewrites the accumulator (loadOp 'clear' when accumulate is
off). mse8 is enqueued with no interior await -> always clean. Fix: a
`measuring` flag set around measure() (at the __lab11 hook site, cleared in
.finally) makes frame() a no-op for the duration — also stops live jitter
perturbing the camera matrices measure reads. Post-fix, full 512-frame truth:
monotone, and within ~3% of the recorded table (×10⁻³ — white 3.59/2.04/1.40
vs 3.49/2.00/1.38; ign 2.07/1.64/1.36; hilbert 2.40/1.63/1.33; blue same;
stbn 3.65/2.61/2.34; shimmer ranking identical, ign 0.139 top, hilbert/blue
0.095 floor). All Salm-claim verdicts stand on the fixed base. (Expected:
lab 11's marcher is the demo 04 fork, which never had the y-bug — now
empirically confirmed rather than assumed.)

**Lab 07/08 — HOLD (visual spot-check).** Lab 07 A-source: fallback-on lifts
shadowed faces with directionally-correct color (green pickup toward the
green wall) vs flat dark fallback-off; C-graze framing shows no box-top
speckle (y-fix confirmed in the 07 fork). Lab 08: salm-caps shows warm
directional distant light with occlusion grading; flat-fallback washes it
uniformly. Black strip at frame left = the room's open face at the default
cam, identical across variants (not a defect).

### Decisions for review
- Lab 10's ssrt3 stack now uses the frozen EMA fork rather than tracking demo
  03's live temporal. If we ever want the lab to ALSO A/B the frame-count
  temporal, that's a new stack id, not a re-point of `ssrt3`.
- `bench/results/` (incl. ~28 MB of shots) is committed — same precedent as
  bench/screenshots; every claim re-runnable from the runners regardless.

## 2026-07-21 — P1 Tracks B/A/C/E: testing phase COMPLETE

**Tooling (committed 7f80b84):** fenced hooks `__bench01/02/04/05/06` (Opus
agent; demo 06 fully separable — source/march/accum/gcopy/compose; demo 01
total-only and documented INVALID under TSL render-list caching — same-frame
re-renders skip the real work, so demo 01's cost = live gpu-ms readout);
runners run-bench-all / run-quality / run-temporal (Sonnet agent);
`window.__cam` teleport hook (track C disocclusion event); params.ts
importJSON now notifies only actually-changed keys (blanket notify was firing
ref-view listeners on every applyConfig → silent oracle resets; caught by the
Track A runner).

**Recorded runs (serial, headed):** trackB-budget / trackA-quality /
trackC-temporal + synthesis trackE-bakeoff.md, all in bench/results/.

**Headlines (full reasoning in trackE-bakeoff.md + DEMOS.md verdicts):**
- Demo 03 wins quality-per-ms: 2.15/4.56 ms (C-wide/S-hall default) INCLUDING
  temporal+denoise, vs 4.7-8.8 ms march-only for GT-VBAO/VBGI and 13.6/31.3 ms
  for SSHGI. Phase D base = SSRT3-style compute march.
- Count-based accumulation beats EMA in every appearance: Track C stills
  frame-count 0.31 / SSHGI 0.34 vs EMA 1.06; lab 10 mathis 0.10 vs ssrt3 2.07.
- The march dominates every demo's budget → lab 09's half-res+joint-bilateral
  lever (re-validated 3.8-5.4×) attacks the dominant term.
- GT-VBGI = the quality bar (cleanest cornell diffs, 3-5× cost); SSHGI's cost
  (31 ms S-hall default, 68 heavy) is the measured cause of Dennis's observed
  fps drag — bench exonerated.
- Reconvergence ≤2 s for ALL demos = the metric's floor (0.5 s cadence,
  2-interval hold), not a differentiator. Tighten cadence if Phase D needs it.

### Decisions for review
- Track A MSEs compare per-demo-different quantities (composite vs
  alpha/AO/rgb-scale oracle) — recorded per row; treated as within-demo
  profiles + visual diff evidence, NOT a cross-demo ranking. Follow-up if
  Phase D wants ranking: channel-matched captures (ao view vs oracle alpha).
- Demo 01 heavy config skipped (fixed stock pipeline), demo 02 heavy skipped
  (rays/steps are a convergence dial, not a per-frame tier).

**GATE: TESTING.md complete. Phase D (demo 12 distillation) ingredient list is
now measurable-fact-backed: SSRT3-compute base + frame-count accumulation +
IGN-under-denoiser + half-res joint-bilateral chain + Ottosson thickness +
salm-caps distant light + §3.2 fallback; GT-VBGI as the quality acceptance
bar. Awaiting Dennis's go for P2/P3.**

## 2026-07-21 — P2 + P3 landed and accepted (recorded, serial, no contention)

**P2 — TemporalGuidesPass + demo 10 A/B (e69f90b). ACCEPTED.** Recorded
lab10-stability: ssrt3-guides combined 1.49 vs ssrt3 2.06 (28% steadier — the
closest-depth-dilated MV + graded disocclusion beat the private world-pos
test), gi 7.20 vs 7.09 (equal within noise), teleport reconvergence 1.50 vs
1.52 s (equal). Verdict: the FSR3-BRIEF decomposition is REAL — a shared
guides pass feeds a temporal effect at least as well as its private logic
while computing frame properties once. This is the acceptance signal for
Dennis's FSR3 port to decompose per the brief; the bench-side consumption
point (demo 10 stack + guides debug view) is live. Note for P7: when the
port's passes 1–2 exist, they can replace harness TemporalGuidesPass behind
the same texture contract.

**P3 — demo 12 "distilled SSGI v0" (d6e441f). ACCEPTED, one honest near-miss.**
Recorded demo12-acceptance:
- C-wide: total 1.12 ms half-res vs demo 03's 2.15 (**1.91×**), MSE-vs-oracle
  0.0662 vs 0.0677 (equal-or-better ✓), stability 0.361 (vs demo 03
  frame-count 0.306 — slightly above, within run-to-run drift of that metric).
- S-hall: 1.75 vs 4.56 ms (**2.61×**), MSE 0.0032 vs 0.0033 ✓, stability 0.174.
- Full-res control point: 2.78/5.20 ms — slightly above demo 03 (extra
  downsample copy + Ottosson), confirming half-res is where the win lives.
NEXTGEN success measure "≥2× at equal-or-better MSE on C-wide AND S-hall":
**met at S-hall (2.61×), near-miss at C-wide (1.91×)** — before Phase O has
touched a single line. Logged honestly; quarter-res or any Phase-O lever
closes the C-wide gap.

### Decisions for review (P3 agent's, ratified by Fable)
- Distant light integrated but default OFF in the control: the oracle models
  skyIntensity=0, so defaulting salm-caps ON would inflate the control's MSE
  with ambient the oracle can't see. One toggle away (`distant=salm-caps`).
- IGN replaces the random source but SSRT3's 6/4 temporal cycle structure is
  kept; Ottosson thickness coexists with the mip pyramid (interaction flagged
  for the Phase-O matrix); salm-caps per-cap direction uses demo 03's basis
  (mirrors lab 08's logged simplification).

---

## 2026-07-21 — P4: demo 12 capability adds (bent normals, spec occlusion, two-sided depth, oracle bent view)

Additive Phase-D capabilities on demo 12 (`12-distilled/`) + the shared
`ReferencePass` (additive only — demos 02/03/04/05 verified byte-identical).
Not optimizations; each is a toggle, all-off == pre-P4.

**Files touched:** `12-distilled/ssrt12-main.wgsl`, `12-distilled/index.ts`,
`12-distilled/README.md`; `harness/reference-marcher.wgsl` (+`fsBent` MRT entry,
`fs` untouched), `harness/reference-pass.ts` (`accumulateBentNormals` option),
`harness/raw-pass.ts` (optional MRT: `fragmentEntryPoint` + `extraTargets`/
`extraOutputs`); `scripts/run-12.mjs`.

**Bent normal + cone (march):** in the slice loop, per UNOCCLUDED bit rebuild the
sector direction with the SAME `realTangent`/`normalVS` basis the occlusion test
+ salm-caps use — bit *i* → hemisphere fraction f=(i+0.5)/32 → θ=fastAcos(2f−1) →
`dir = realTangent·cos θ + normalVS·sin θ`, minus its planeNormal component.
Summed over slices → `normalize(Σ)` = bent normal (fallback to surface normal
when Σ≈0); `visibleCone = Σ-unoccluded-bits / (32·rotationCount)`. Written to a
NEW rgba16float (xyz = **standard three view space** — the flipped posVS bent dir
gets its z negated on write, matching the oracle + composite), gated by
`F_BENT_NORMALS` (default ON). Extra binding always present (no permutation);
when off, never written → combined bit-identical (parity MSE vs pre-P4 capture
≈ 8e-6, meanAbsDiff ≈ 0.33/255).

**Spec occlusion (composite, TSL):** ambient diffuse switches to the bent normal;
env specular attenuated by Lagarde `so = saturate(pow(NoV+cone, exp2(−16·rough−1))
− 1 + cone)` (Frostbite "Moving to PBR 3.0", 2014). View pos reconstructed from
depth via a new invProj uniform; view→world via a mat3(camera.matrixWorld)
uniform. **Default OFF** (logged deviation — it adds env energy the closed-Cornell
oracle `skyIntensity=0` can't see, same reasoning as distant-light-off; keeps the
P3 control clean, one toggle away).

**Two-sided thickness:** `thicknessHeuristic=two-sided` (default stays ottosson).
A BackSide `scene.overrideMaterial` depth-only pass at MARCH res gives the real
[frontZ, backZ] interval; sectors marked only within it; sky/no-backface samples
fall back to Ottosson per-sample. Bound to the march always (placeholder = full-
res scene depth when off, never read). BackSide override worked cleanly (no fight
with three's material system).

**Oracle bent + views:** `ReferencePass({accumulateBentNormals:true})` accumulates
a ground-truth bent normal into a 2nd additive MRT target (xyz = Σ miss-ray dirs
view space, w = count) via `fsBent` — `fs` byte-identical so 02/04/05 untouched
(verified: their ref views render, no error overlay, non-black). New demo 12
views: `bent`, `bent-ref` (lazy), `bent-diff` (0..45°→black..white ×diffAmp).

**Verification (headed, live server):** tsc clean. Parity: combined at C-wide
matches a pre-edit capture at MSE ≈8e-6 both bentNormals-on and -off. bent vs
bent-ref are orientation-identical (no convention bug). bent-diff mid-grey
~24°(C-wide)/~32°(S-hall) at diffAmp=1 — a weighting/estimator gap (uniform-
sector centroid vs cosine-weighted oracle, slice-plane-confined; invariant to
rotationCount), documented, not a bug. Two-sided renders clean at C-wide (tighter
contacts, no leaks) and engages on the zoo (meanAbsDiff 0.12–0.56 vs ottosson;
small at default poses — needs a grazing close-up for the thin-fence win). Spec
occlusion composite renders sensibly. `run-12.mjs --quick` completes with the new
columns (bent_diff per cell + thickness A/B rows for C-wide + Z-zoo); all
acceptance rows still pass (total-half ≤ d03, MSE ≤ 1.5×d03, stability ≤ 0.40).

**Validated:** demo 12 (all views, both thickness A/B, spec occlusion),
demos 02/03/04/05 reference views, tsc, run-12 --quick.
**Open bugs:** none. **Decisions for review:** specOcclusion default OFF;
demo bent uses salm-caps' approximate direction reconstruction (→ ~24° oracle
gap); demo bent normal un-denoised (temporal accumulation of the bent buffer is
a follow-up). Not committed (per packet).

---

## 2026-07-21 — P5 phase 1/3: demo 13 optimization lab + ALU variant family

Demo 12 frozen-forked AGAIN into `13-optim/` (`ssrt13-*.wgsl` = byte-identical
copies of `ssrt12-*.wgsl`, verified `diff`), plus ONE addition: a compile-time
`variant` mechanism specializing the MARCH kernel per NEXTGEN optimization
principle. Phase 1 = the ALU family. Full detail in `13-optim/README.md`.

**Variant mechanism (`13-optim/variants.ts`).** The pristine `ssrt13-main.wgsl`
text is transformed into per-variant WGSL by anchoring on EXACT substrings with
asserted occurrence counts (drift fails loudly at build, never silent no-op —
frozen-fork lesson). Each variant compiles to its OWN `RawComputePass` pipeline
(identical binding layout, so one resources[] drives any); active pipeline picked
by a `variant` enum param (group "optimization") + `?variant=` override +
`__bench13.setVariant()`. `baseline` = identity transform, ASSERTED byte-identical
to the pristine source (`buildAllVariants` throws otherwise). Variants touch only
the march; all P4 capabilities carried over at their P4 defaults.

**ALU family + exact WGSL transforms:**
- **`trig`** (principle 1): (1) per-slice `sin/cos(rotationAngle)` → angle-sum
  recurrence (precompute cosΔ/sinΔ, rotate the slice vector per iter) — EXACT to
  float, ≤3 rotations drift ~1e-7. (2) bent-normal per-bit + distant-light per-cap
  `acos`-then-`cos/sin` → exact identity `c=2f−1; s=√(1−c²)` (removes fastAcos+
  cos+sin; MORE accurate than baseline's fastAcos). (3) per-sample horizon
  `fastAcos(fbh.x/.y)` → branchless vec2 `fastAcos2` (value-identical; the angle
  is genuinely needed for the linear sector map, so only vectorize+debranch).
- **`loop`** (principle 4): the named `pow(abs(stepRadius·(j+off)/radiusVS),
  expFactor)·radiusVS` per step (both marchers) — hoist `radiusVSInv=1/radiusVS`,
  `kStep=stepRadius·radiusVSInv`; the affine `argJ=kStep·(j+off)` advances by
  adding kStep (strength-reduce the multiply), likewise `(j+1)`. pow stays. Drift
  over 32 steps ~2e-6 rel, verified below noise.
- **`precision`** (principle 3): `enable f16;` + f16 for the GI sector-weighted
  radiance product (weight/ndl/lndl∈[0,1], lightColor firefly-clamped; accumulator
  col stays f32) and the per-slice AO visibility fraction. Depth+position STAY f32
  (load-bearing). Feature-gated: generated only when `shader-f16` present, else
  reports `unavailable` + falls back to baseline pipeline (standing rule).
  Conservative scope (positions/directions f32) — logged for review.
- **`alu-all`**: trig∘loop∘precision (disjoint lines). Drops precision (→trig∘loop)
  when f16 absent.

**Runner `bench/scripts/run-13.mjs`.** Paired A/B per variant vs baseline,
back-to-back (thermal), cells C-wide+S-hall: fenced `__bench13` march ms
(warm-up + min-of-bursts, baseline-then-variant), screenshot MSE vs BASELINE's
combined (primary correctness gate ≤1e-4), MSE vs oracle (quality-unchanged),
stability. `writeResults('demo13-alu', …)` with pass_ms/pass_baseline/pass_oracle;
a slower variant is recorded, not hidden. `--quick` (2 bursts). Registered:
`demos/index.ts` (+optimDemo), `scripts/lib/harness.mjs` (`DEMO_IDS['13']`).

**Verification (headed, live server 5180; tsc + build green).** Demo 13 resolves
(`13-optim`); all 5 variants available (shader-f16 CONFIRMED on adapter); every
variant renders non-black and visually indistinguishable from baseline (combined
meanBright 106.33–106.34; MSE-vs-baseline 7–9e-6 = temporal-cycle noise floor).
`precision` reports available here; the unavailable-path (no f16) verified by
`buildAllVariants(src,false)` → precision available=false, alu-all drops precision.
`run-13 --quick` completes; all correctness gates pass every cell.

**Smoke finding (NOT a recorded number — orchestrator's isolated run is the
verdict).** At FULL methodology (bursts=3×40 + warm-up) a base-vs-base control
gives ratio 1.00 (no measurement-order bias), and `trig` vs baseline is ~equal
(~2%). Exactly NEXTGEN principle 5's prediction: the march is fetch-bound, so
pure-ALU rearrangement is ~0× (lab 09). The ALU family is shaping up as an honest
near-zero/negative result; recorded per-variant numbers await isolation.

### Decisions for review
- **`precision` f16 scope is conservative** — only the GI radiance product +
  AO visibility fraction (proven [0,1]) go f16; positions, depth, AND
  direction-vectors-derived-from-positions stay f32. A deeper conversion
  (normalized directions, sector-mapping arithmetic) is the follow-up IF the
  scoped version shows any promise. Chose safety-first given string-transform
  fragility + the fetch-bound prior (a null result either way).
- **`trig`'s per-sample fbh `fastAcos` is NOT removed** — the horizon angle feeds a
  linear cosine→sector-index map, so the angle itself is needed (no exact vector
  identity). Only vectorized + debranched (value-identical). The exact-identity
  wins land on the bent-normal / distant-light `cos/sin(acos)` sites instead.
- **`--quick` bumped to 2 bursts** (run-12 uses 1) — a single rAF frame landing in
  a 1-burst window doubles the reading and manufactures a fake ratio; min-of-2
  filters it. Recorded run still uses 3×40.
- **Committed a `--quick` `demo13-alu.{json,md}`** (stamped "quick smoke run — not
  a recorded number"); orchestrator's isolated run overwrites it.

**Open bugs:** none. **Not committed** (per packet).

## 2026-07-21 — Sponza scene v2 (RE-BASELINE BOUNDARY)

Dennis: the sponza cells were "pretty weak — under an overhang, the sun only
barely goes into the hall" — correct, and it starved screen-space GI of bright
beauty content (part of why trackA's sponza MSEs were suspiciously tiny).
Changes (bench/src/scenes/sponza.ts):
- Sun retargeted (picked visually from 3 candidates at S-hall + S-column):
  (8,19,4)→(4,0,0) @ 4.0 — a real shaft on the corridor floor, right
  colonnade directly lit, banners bounce-lit. New `?sun=px,py,pz,tx,ty,tz[,i]`
  override (deterministic capture, same spirit as ?cam=).
- Three static torch braziers at colonnade bases (emissive bowls + shadowless
  point lights): strong LOCAL bounce sources — stress firefly clamps, GI
  leak/halo around small emitters, lightmask multibounce. Pane: torches
  intensity, flicker toggle (deterministic sin, DEFAULT OFF — flicker corrupts
  the stability metric + oracle accumulation). `?torch=<i>` override, 0=off.

**EVERY recorded sponza number before this entry is scene-v1.** Re-baseline
battery (serial) re-records: lab09-bandwidth, trackB-budget, trackA-quality,
trackC-temporal, demo12-acceptance(+thickAB), demo13-alu. Cornell/zoo rows
re-record with them (same-commit freshness, no scene change there).

## 2026-07-21 — Scene-v2 re-baseline recorded + P5.1 ALU verdict

**Re-baseline battery (df2e232, serial):** all six runners re-recorded on
sponza v2. The relight did its job: trackA sponza cells now carry real GI
signal (demo 03 S-hall MSE 0.0033→0.0145, S-column 0.0023→0.0183; demo 05
similar) instead of noise-floor values. Lab 09 ratios unchanged (half-res
lever intact). Demo 12 acceptance on v2: C-wide 1.72×, S-hall 2.77× vs demo
03 at equal-or-better MSE — the ≥2× measure is MET at S-hall; C-wide sits at
1.7-1.9× across runs (still pre-Phase-O; unchanged verdict).

**run-12 stability gate fixed:** the absolute 0.40 gate (calibrated on dim v1
sponza) false-failed S-hall v2. Verified paired: demo 03 frame-count measures
0.421 at S-hall v2, demo 12 0.433 — parity. Gate is now RELATIVE: demo 03
measured in-session at the same cell, pass = ≤1.25×. Lesson recorded in the
runner: absolute gates go stale on scene changes; pair them.

**P5.1 ALU family — RECORDED VERDICT: honest near-zero (lab 09's prediction
confirmed on our own base).** demo13-alu (v2, isolated): C-wide trig 1.08×,
alu-all 1.06×, loop 1.03×, precision 1.02×; S-hall trig 1.04×, loop 0.99×,
precision 0.98×. All variants pass correctness (MSE-vs-base ~1e-5, oracle
MSE unchanged). Adjudication: **keep `trig` available** (exact identities,
small consistent win, zero risk), do NOT default loop/precision — the march
is fetch-bound and ALU polish is not where demo 12's remaining gap lives.
NEXTGEN principle 5 ("bandwidth before ALU") is now empirically validated on
our own code, not just lab 09's forks. P5.2 (bandwidth family) is where the
C-wide 2× gap should close.

## 2026-07-21 — P5.2 BANDWIDTH family implemented (demo 13) — smoke verdict

**Five new march variants (compile-time WGSL transforms, same mechanism as P5.1),
plus runner `--family`.** All land against `baseline`'s byte-identical assertion:
the extra fetch structures are **appended** as march bindings 10/11/12 (light mip
pyramid, box-MAX depth pyramid, guides history N), so the pristine bindings 0–9 are
untouched — every variant shares one 13-entry layout and a shader that reads a
subset of the bound textures is valid WebGPU. Pyramids/guides build **lazily** (only
when the active variant needs them), `ReferencePass`-style. tsc clean; all 10
variants compile + render non-black; no WGSL errors.

**Smoke A/B (`--quick --family bandwidth`, live rAF — NOT recorded numbers):**

| variant | C-wide ms_ratio | S-hall ms_ratio | MSE-vs-base | stability Δ |
|---|---|---|---|---|
| light-mips | 1.11× | 1.00× | 1.6e-5 | −0.03 (fewer fireflies) |
| hiz-skip | 1.08× | 0.96× | **7–11e-6 (bit-identical)** | ~0 |
| checkerboard | 1.04× | 0.97× | 2.4e-5 | **+0.31…+0.41** |
| adaptive | **3.39×** | **2.88×** | 5.9e-4 / 1.6e-4 | +0.11 / +0.05 |
| bandwidth-all | 3.17× | 2.90× | 6.0e-4 / 1.7e-4 | +0.17 / +0.06 |

All pass their correctness gates (hiz-skip held to the exact 1e-4; the in-motion-
lossy trio to a 1e-3 CONVERGED-only gate — documented in the runner). MSE-vs-oracle
unchanged for the fetch-exact variants; adaptive/bw-all nudge it +0.0006–0.0009
(reduced effort on converged pixels, still within slack).

**Verdict (smoke, awaiting orchestrator isolation):** the win is **adaptive effort
(principle 6), not raw fetch reduction.** On this already-half-res march the pure
bandwidth cuts are a wash-to-small — light-mips ~0–11%, hiz-skip bit-identical but
~0× (the sector bitfield rarely fully saturates at stepCount 12, so the exact
early-out fires seldom; it is a correctness-free freebie, not a lever). checkerboard's
early-out saves little march ms (skipped invocations still dispatch; the workgroup
schedules all 64 threads and half just `return`) while costing real in-motion
stability (Δ +0.3–0.4) — a **documented negative**: the 2× it promises needs a
compacted dispatch, not a per-thread early-out. **adaptive banks ~3× on stills**
(converged pixels drop to rotationCount 1 / 0.4× steps via guides N) and honestly
**degrades to ≈baseline when fresh** (deterministic `fresh` endpoint 0.67–0.97ms ≈
baseline 0.75–0.92ms) — exactly principle 6's promise (coast when converged, full
budget on disocclusion). This is the lever that closes the C-wide 2× gap NEXTGEN
flagged, and it is *free on motion*.

Measurement notes: adaptive ms is measured at both deterministic effort endpoints
(`F_ADAPT_FRESH`/`F_ADAPT_CONVERGED` flag bits pin gEffort=1.0/0.4) AND via a live
`window.__cam.set` teleport + immediate burst. The deterministic **fresh** endpoint
is the reliable honest-worst-case; the teleport burst is a noisier live cross-check
(the offset pose can land in a cheaper scene region and the 150 ms window may let the
guides partially recover, so it read *lower* than fresh in some cells — recorded as
`march_ms_teleport`, not used for the ratio). hiz-skip's AO-path coarse skip reads
the MIN pyramid (assumes mipOptimization, on by default; the bandwidth path force-
builds it otherwise); the full angular-interval Hi-Z traversal (the max pyramid's
larger payoff) is scoped as a follow-up — the shipped exact wins are the bitfield-
saturation break + beyond-radius AO skip. bandwidth-all = light-mips∘hiz-skip∘adaptive
(disjoint edits); checkerboard is excluded from it (double-dips adaptive's temporal
budget). Files: variants.ts (+5 transforms), index.ts (appended bindings, 2 pyramid
passes + lazy TemporalGuidesPass, effort-mode bench hook), ssrt13-light-pyramid.wgsl,
ssrt13-depth-pyramid-max.wgsl, run-13.mjs (`--family`, endpoint + teleport ms,
stability delta, per-variant gates). Recorded verdict is the orchestrator's isolated
run; do-not-commit per packet.

## 2026-07-21 — P5.2 bandwidth family RECORDED VERDICT (isolated run, demo13-all)

**adaptive (guides-driven effort) is the flagship optimization.** Converged
march 3.17× (C-wide 0.657→0.207 ms) / 2.37× (S-hall), with fresh-pixel cost
= baseline (0.68/0.86 ms) — exactly the principle-6 shape: converged pixels
coast, disoccluded pixels pay full. Costs recorded, not hidden: stability
+0.17 at C-wide (0.527 vs 0.356 — the effort floor 0.4 trades boil for ms;
tunable), oracle MSE +0.0006. With the march at 0.21 ms, demo 12+adaptive's
estimated C-wide total ≈ 0.80 ms vs demo 03's 2.145 → **the ≥2× C-wide
success measure is now met on converged frames** (fresh frames ~1.7× — the
demo 12 baseline). This is also the LSAO story's ending: the paper's
complaint (every pixel pays full march cost) solved with temporal guides
instead of line sweeps, bitmask-compatible.
- light-mips: ms 0.98–0.99× (smoke 1.11× did NOT survive isolation) but
  stability −0.05 (prefilter) — verdict: quality tool, not a perf lever at
  default settings; revisit at heavy configs.
- hiz-skip: 0.98× — honest zero in the scoped exact-conservative realization
  (bitfield-saturation break + beyond-radius skip); full angular Hi-Z remains
  a documented follow-up.
- checkerboard: recorded NEGATIVE — per-thread return doesn't compact the
  dispatch (ms ~1.0×) while stability degrades +0.26..+1.0. A true 2× needs
  compacted dispatch; parked.
- ALU family re-confirmed near-zero under the new binding layout.
Adjudication: `adaptive` becomes demo 12's headline Phase-O graduate
(integration decision deferred to post-P5.3 so the E-table updates once);
light-mips graduates as a stability option; checkerboard/hiz-skip parked
with recorded reasons.
