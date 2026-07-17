# SSGI Bench — Build Plan

The "make a bunch of SSGI setups" pass. Goal: a three.js WebGPU test bench with many
independent-but-layered SSGI implementations, built on the `research/` base, ready for a later
benchmark/review pass. Priorities: **Performance → Quality → Realism**.

Decisions locked 2026-07-17 with Dennis:
- Bench lives **in this repo** (pnpm workspace, `bench/` app).
- **TypeScript**, Vite, vanilla three.js (no framework), pinned latest three (`0.185.x`).
- Sponza: web-optimized Intel/Frostbite "new Sponza" base scene — first candidate
  [toji/sponza-optimized](https://github.com/toji/sponza-optimized) (KTX2 + meshopt, built for WebGPU
  demos). Alternative: [Castaño's updated Sponza glTF](https://www.ludicon.com/castano/blog/2026/02/an-updated-sponza-gltf/)
  — base model repo: [ludicon/sponza-gltf](https://github.com/ludicon/sponza-gltf) (plain glTF, so
  likely no Spark-texturing dependency, but confirm standard PBR textures at fetch time). Size/speed
  beats fidelity; compare both candidates when fetching and run the winner through
  gltf-transform → KTX2 + meshopt if it isn't already.
- Ground truth: **in-harness brute-force screen-space ray-march reference** (the Salm-style control —
  same G-buffer input, isolates algorithm error) + **frame-accumulation mode** (frozen camera,
  converge over N frames). three-gpu-pathtracer is out (poor WebGPU/lighting support today);
  absolute-truth stills via **headless Blender Cycles** are deferred to the benchmark pass — the
  harness's saved camera poses get exported so Cycles renders can match 1:1 later.
- FSR/upscaler ([pmndrs/upscaler](https://github.com/pmndrs/upscaler)): OFF until the update removing
  ACES/tonemapping from RCAS lands. But the harness is **renderScale-aware from day one** — every
  pass must run correctly at half-res (paper Table 2: half-res + bilateral upsample ≈ 4× faster).

Caveat: `research/ssao-vbao-ddgi-research-handoff.md` is from an early exploratory chat, NOT this plan.
Its SSGINode code review (§4) and GT-VBAO sequencing are still useful; ignore its DDGI framing.

---

## Repo layout

```
bench/                     # Vite + TS app (pnpm workspace member)
  assets/                  # downloaded, not committed — `pnpm assets` fetch script
  src/
    harness/               # shared infra (see below)
    passes/                # reusable pass implementations + .wgsl files
    demos/                 # one folder per demo, registered in a demo registry
  index.html               # demo picker; demos routed via ?demo=x&scene=y
research/                  # existing research base (INDEX.md is the map)
PLAN.md                    # this file
```

## Integration strategy: three for the scene, raw WGSL for our passes

- **Demo 01 uses three's stock TSL nodes as-shipped** (that's the point — it's the baseline).
- **Our own implementations are raw WGSL compute/fragment passes** running on three's `GPUDevice`,
  with three producing the G-buffer (depth, normals, velocity, beauty via `PassNode` MRT).
  A thin harness layer (`RawComputePass` / `RawFragmentPass`) owns bind groups, formats, resize,
  and per-pass timestamp queries.
  - Pro: full WGSL control — workgroup shared memory (required for LSAO-style caching; SSGINode
    can't do it as a fragment quad), storage buffers, no TSL codegen semantics to fight, shaders
    port cleanly from the Shadertoy/HLSL sources.
  - Con: we own the glue, and reaching three's internal GPU textures (`renderer.backend.get()`)
    is semi-private API — acceptable for a research bench pinned to one three version.
  - Escape hatch: `wgslFn` TSL wrappers if a pass needs to sit inside three's post chain.
  - **Interop rule (both directions):** raw passes never allocate their own inter-pass textures —
    they write into three-allocated targets (`RenderTarget`/`StorageTexture`), reached via
    `backend.get()`. This keeps every raw output consumable as a plain TSL `texture()` node
    downstream, so stock TRAANode / DenoiseNode / the future FSR chain can sit after our raw
    pipeline without special casing. The node graph and the raw passes share one texture pool.

## Scenes (harness-level, every demo gets all of them)

1. **Cornell box** — procedural, known dimensions, emissive area light; toggleable dynamic objects.
   The canonical GI-readability scene (zalo proposed exactly this for the three.js demo).
2. **Sponza** — the web-optimized new Sponza above.
3. **Artifact zoo** — small procedural scene of VBAO's headline cases: fences, railings, thin
   plates at graded thicknesses, chair-leg contact points, a camera-facing wall. This is where
   thickness heuristics and thin-geometry wins/losses become visible instead of anecdotal.

## Harness features (Phase 0, grown as needed)

- Demo + scene registries, URL-routed; Tweakpane panels generated from typed pass-param schemas;
  presets; settings import/export as JSON (embedded in screenshots for the benchmark pass).
- GPU timing via `timestamp-query` per pass, rolling averages; CPU stats.
- Debug views: AO-only, GI-only, raw vs denoised, G-buffer channels; **split-screen A/B slider**
  between any two pipelines; pixel-diff view (simple abs-diff now, FLIP later).
- Camera: orbit + named bookmarked poses per scene + deterministic scripted flythrough
  (temporal-stability torture test; doubles as the benchmark path later).
- Accumulation/freeze mode for converged comparisons; render-scale slider.
- Required WebGPU features handled up front: `rg11b10ufloat-renderable` (SSGINode errors without
  it), `timestamp-query`; graceful capability report when missing.
- **Temporal contract (harness-level, every demo):** motion vectors, per-target history buffers
  with automatic resize/invalidations, reprojection + disocclusion-rejection WGSL utilities, and
  camera-jitter control are harness services available from M0 — not features individual demos
  reimplement. Every technique demo (03–09) must declare its temporal inputs/outputs against this
  contract; unidirectional variants (05) and multibounce (03f, 06) are denoiser-dependent by
  design and simply don't work without it. Demo 10 then swaps denoiser *stacks* on top of this
  shared plumbing rather than each stack bringing its own reprojection.

## Demo ladder

Each demo is independent, documented with a README stating lineage (which research source, which
variant, what differs), so the later benchmark pass has provenance.

- **00-gbuffer** — scene viewer + G-buffer inspector. Sanity: normals, depth, velocity, UV origin.
- **01-stock-three** — the shipped pipeline: `SSGINode` + TRAA (or DenoiseNode) **+ `SSRNode`
  added to the chain** (our one change), `GTAONode` toggle as the AO control. What three gives
  you today; the floor everything else must beat.
- **02-reference** — brute-force screen-space ray-march reference + accumulation mode. The truth
  machine every later demo A/Bs against.
- **03-ssrt3-wgsl** — the full SSRT3 port as WebGPU compute, restoring everything the TSL port
  dropped. Built in stages (validate each before the next — per Therrien the bitmask swap itself
  is ~10 lines once plumbing is right):
  a. GTAO plumbing (depth linearize, view-space normals, slice march) → validate vs GTAONode
  b. Visibility bitmask (VBAO) → validate AO vs 02
  c. GI gather → validate vs 02 converged
  d. SSRT3's own denoise stack (temporal reprojection w/ world-pos rejection + bilateral)
  e. **Probe fallback (§3.2)** — the big missing feature (see 06)
  f. **Multibounce GI + multibounce AO** (watch the feedback loop; ~50% damping per cybereality)
  g. **Bandwidth opts**: depth/light mip pyramid, normal-from-position approximation
- **04-gt-vbao** — Salm's cosine-weighted GT-VBAO (`XXGSDd`) with his toggles (acos approx,
  slice importance sampling). AO-only.
- **05-gt-vbgi** — the successor family, as variant switches in one demo: bidirectional `lfdBWn`,
  unidirectional `Xc3yzs`/`4ctBRH` (half the depth samples, denoiser-dependent), uniform-weighted
  `4cdfzf`/`XfcBDl` (no acos in inner loop), slice-relative mapping `wcsXDN`. Note the shadertoys
  render their own toy scenes — porting to a real G-buffer is the actual work; core loops carry over.
  Includes the post-snapshot `GetQuaternion` +z→−z fix (see `live-refresh-2026-07-17.md`).
- **06-sshgi-mathis** — Mathis's Screen Space Horizon GI (`dsGBzW`, Oct 2023). An **independent
  third branch of the lineage**: implements the SSILVB paper directly (cites arXiv 2301.11376),
  predates Salm's GT-VBGI shaders, shares no code with SSRT3. The only captured source shipping
  the complete loop self-contained and known-stable: bitmask GI + multibounce + temporal
  accumulation + 3×3 bilateral. Port as its own pipeline; serves as the stability anchor for
  validating 03(f) multibounce and as a baseline recipe in the denoise lab.
- **07-ambient-lab** — paper §3.2 subregion-weighted directional ambient on top of 03/05.
  Compare the three three.js ambient sources from `research/sources/probes/threejs-probe-options.md`:
  (A) `pmremTexture(scene.environment)` directional, (B) `LightProbeGrid` (new, immature),
  (C) global `LightProbe` SH. Also: paper-correct per-subregion weighting vs SSRT3's shipped
  normalization, and cone→mip selection vs SSRT3's hardcoded mip 3.
- **08-distant-light-lab** — Ottosson's `wcfGWB`/`3clGWB`/`wcBGRz` (distant-light sampling,
  thickness heuristics, light/occluder classification) + Salm's `wc2SzR` (spherical-caps
  distant light). Thickness experiments live here, exercised by the artifact zoo.
- **09-bandwidth-lab** — the cost structure is bandwidth, not ALU (paper Table 1). LSAO-style
  depth caching via workgroup shared memory (compute-only; open problem — LSAO's
  largest-occluder trick doesn't map 1:1 to a bitmask), half-res + joint bilateral upsample
  (no engine ships the paper's recommended stack — open gap), fragment vs compute dispatch of
  the same shader, interleaved rendering.
- **10-denoise-lab** — pluggable denoiser stack: SSRT3 temporal+bilateral, Mathis's accumulation
  recipe (from 06), XeGTAO's denoiser, three's DenoiseNode/BilateralBlurNode/depthAwareBlur,
  evaluated standalone AND feeding TRAA/upscaler (the signal handed to TRAA matters as much as
  the standalone result).
- **11-sampling-lab** — IGN vs R1/Hilbert vs blue noise vs spatiotemporal blue noise.
  Per Salm: noise choice and denoiser interact (IGN denoises better; Hilbert is more isotropic
  raw) — so this cross-cuts 10.

Later tracks (explicitly out of this pass): radiance cascades exploration, Blender-Cycles
benchmark stills.

## Execution protocol (how we run this, to keep cost and context sane)

**Model tiering** — match the model to the altitude of the work:
- **Fable** — orchestrator and reviewer only: architecture decisions, plan updates, debugging the
  gnarly stuff (coordinate-space bugs, bitmask semantics, temporal feedback issues), reviewing
  diffs against the trap list before commits. Not for grinding out files.
- **Opus** — primary implementation workhorse: the actual ports (demo 03 stages, GT family,
  harness passes), anything requiring sustained correctness over a large diff.
- **Sonnet / Haiku** — legwork: scaffolding, asset pipeline scripts, config, mechanical
  GLSL→WGSL transliteration first-drafts, README/provenance writing, research lookups.

Pattern: Fable plans a work packet with explicit spec + acceptance criteria → delegates to
Opus/Sonnet subagents → Fable reviews the result (against trap list + validation demo) → commit.

**Safety commits** — commit at every green boundary, not at the end of a session:
- First commit: the current untracked research base + PLAN.md (before any bench code).
- Then: one commit minimum per milestone stage — each demo, and each internal stage of demo 03
  (a–g each get a commit once validated). Broken exploration happens on branches; `main` stays
  demo-runnable at every commit.

**Context hygiene** — the repo, not the chat, is the source of truth:
- Each work packet starts fresh (new session or compaction); no marathon contexts dragging
  full file histories through every call.
- Handoff state lives in-repo: PLAN.md (direction), per-demo READMEs (lineage + deviations +
  current status), and a `WORKLOG.md` (append-only: what was done, what's validated, what's next,
  open bugs). A fresh context must be able to resume from those three files alone.
- Update WORKLOG + relevant README in the same commit as the code they describe.

## Milestones

- **M0** — workspace scaffold, harness core, Cornell box, demo 00.
- **M1** — demo 01 (stock pipeline + SSR), Sponza fetched/compressed, GPU timings live.
- **M2** — demo 02 (reference + accumulation) + A/B comparator. From here every port is testable.
- **M3** — demo 03 SSRT3-complete (the biggest single lift, staged a→g).
- **M4** — demos 04–06 (GT family + Mathis SSHGI).
- **M5** — labs 07–11, order driven by what M3/M4 reveal.

## Known traps (collected from the research; check against every port)

- PI vs PI2 slice-rotation constant (issue #29668 bug history)
- Bitfield corruption pattern fixed in three PR #31873
- WebGPU UV origin top-left + view-space handedness vs GL-based sources
- SSRT3's stepRadius double-divide bug (three's port fixes it — don't re-import it)
- GI must be modulated by albedo at composite (PR #31839 fix)
- Thickness is world-space — scene scale matters (Cornell box scale vs Sponza scale!)
- Firefly clamp (SSGINode hardcodes maxLuminance=7 — make it a tunable)
- Multibounce energy feedback loop — needs damping
- `_halfProjScale` assumes perspective camera
