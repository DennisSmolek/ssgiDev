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
