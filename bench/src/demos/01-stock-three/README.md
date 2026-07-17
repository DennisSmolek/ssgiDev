# Demo 01 — stock three.js pipeline (the baseline)

**This IS the floor every other demo compares against.** It wires three.js r185's
*shipped* SSGI/GTAO/SSR/TRAA/Denoise TSL nodes exactly as three intends, changing
nothing about the algorithms. Demos 02–11 must beat what this produces; if a port
looks worse than demo 01, the port is wrong.

Pinned to **three@0.185.1**. Lineage: three's own `webgpu_postprocessing_ssgi` and
`webgpu_postprocessing_ssr` examples (compositing copied from them verbatim — see
the wiring below). SSGINode itself descends from cdrinmatane/SSRT3 (SSAO-VB /
SSILVB); see `research/sources/threejs/SSGINode.js` and PLAN.md demo-ladder notes.

## What it does

One scene pass (MRT) feeds a small node graph. The AO source is switchable
(SSGI ↔ GTAO), SSR is a toggle we add on top, and a post AA/denoise stage is
selectable. All of it is stock nodes — no raw WGSL here (that starts at demo 03).

### Node chain (wiring diagram)

```
                 scene (three.Scene) + PerspectiveCamera
                                 │
                          pass(scene, cam)         ← RenderPipeline, r185 (not PostProcessing)
                                 │  MRT:
             ┌───────────────────┼────────────────────────────────┐
        output(RGBA16F)   diffuseColor(RGBA8)   normal(RGBA8)   velocity(RGBA16F)
          =beauty            =albedo         =packNormalToRGB   xy = motion vector
                                              (normalView)      z  = metalness   ┐ packed for
                                                                w  = roughness   ┘ SSR (see note)
                                 │
        sceneNormal = sample(uv → unpackRGBToNormal(normal.sample(uv)))   // view-space [-1,1]
                                 │
   ┌─────────────── AO mode = "ssgi" (default) ───────────────┐   ┌──── AO mode = "gtao" (control) ────┐
   │  giPass = ssgi(output, depth, sceneNormal, cam)          │   │  aoPass = ao(depth, sceneNormal,cam)│
   │    ao = giPass.getAONode()   gi = giPass.getGINode()     │   │    aoTex = aoPass.getTextureNode()  │
   │  base = output.rgb * ao.r  +  diffuseColor.rgb * gi.rgb  │   │  base = output * vec4(vec3(aoTex.r),1)│
   │         └── AO on direct ──┘  └─ GI modulated by ALBEDO ─┘   │         └─ AO-modulated beauty ────┘ │
   └──────────────────────────────────────────────────────────┘   └────────────────────────────────────┘
                                 │  base (vec4)
                    ssrEnabled ? base.rgb + ssr(...).rgb : base        ← SSR added (our one change)
                                 │  composite
             post = "traa"  → traa(composite, depth, velocity, cam)
             post = "denoise" → denoise(composite, depth, sceneNormal, cam)
             post = "none"  → composite
                                 │
                     RenderPipeline.outputNode  → canvas
```

**GI is modulated by albedo** (`diffuseColor.rgb * gi.rgb`) and **AO multiplies
direct light** (`output.rgb * ao.r`) — this is three's canonical SSGI composite
(PR #31839 fix; PLAN.md trap "GI must be modulated by albedo at composite"). Get
this wrong and GI double-counts surface color or washes out.

### MRT note — why metal/rough ride in velocity.zw

three's SSGI example uses 4 attachments (output/diffuse/normal/velocity). SSR
additionally wants per-pixel metalness + roughness. A *fifth* RGBA attachment
overflows Dawn's `maxColorAttachmentBytesPerSample = 32` on this adapter
(output 8 + diffuse 4 + normal 4 + velocity 8 + a 5th = 40 > 32 → pipeline
creation fails). Velocity is a 2-component motion vector in an RGBA16F target and
`TRAANode` reads only `.xy` (verified `TRAANode.js:664`), so we pack
`metalness→.z`, `roughness→.w` for free and stay at 4 attachments / 24 bytes.

### Debug views (`?view=` or the panel)

- `final` — the full composite through the selected post stage.
- `ao` — the AO factor as grayscale (SSGI's `ao.r`, or GTAO's `aoTex.r`).
- `gi` — SSGI's raw GI (`gi.rgb`); shows the indirect-light color bleed. In GTAO
  mode there is no GI, so this slot falls back to the AO-modulated beauty.

## Parameters (harness schema)

Mode toggles rebuild the node graph; everything else is a live uniform (no
recompile). SSGI uniforms mirror `SSGINode.js` 1:1.

| group | params |
| --- | --- |
| mode | `aoMode` (ssgi/gtao), `ssrEnabled`, `post` (traa/denoise/none), `viewMode` |
| SSGI | `sliceCount`, `stepCount`, `radius`, `thickness`, `useLinearThickness`, `useScreenSpaceSampling`, `expFactor`, `aoIntensity`, `giIntensity`, `backfaceLighting` |
| GTAO | `gtaoRadius`, `gtaoThickness`, `gtaoScale`, `gtaoSamples` |
| SSR | `ssrIntensity`, `ssrMaxDistance`, `ssrThickness` |

URL overrides (deterministic screenshots / benchmark configs):
`?view=final|ao|gi` · `?aoMode=ssgi|gtao` · `?post=traa|denoise|none` · `?ssr=1`.

**Thickness is world-space** (PLAN.md trap). The default `thickness=1` is tuned
for the Cornell box (5.5-unit interior). Sponza is ~5.4× larger (measured longest
edge ≈ 29.8 units — see `scenes/sponza.ts`), and the artifact zoo grades plates
from 0.02→0.5 units specifically to make a single thickness value visibly wrong at
one end. Retune per scene.

## Did SSR make it in?

**Yes.** three@0.185.1 ships `three/addons/tsl/display/SSRNode.js` (`ssr()`); it's
wired as a toggleable additive stage (`composite = base.rgb + ssr(...).rgb`) using
the packed metal/rough. Default **off** (it's an addition to the SSGI baseline, not
part of it). First-generation SSR (blur-based; `stochastic:false`) since we pass a
`roughnessNode`.

## Runs on

All three scenes (cornell / sponza / artifact-zoo) and at `renderScale` 0.5 (effect
nodes size from `renderer.getDrawingBufferSize()` each frame). Requires the
`rg11b10ufloat-renderable` WebGPU feature (SSGINode errors without it) — if absent,
the demo shows an on-screen ERROR blade, logs to console, and falls back to the
GTAO AO path (GI unavailable).

## Known limitations (these are what the later demos exist to fix)

Straight from `research/` and PLAN.md — three's stock SSGINode is a *reduced* port
of SSRT3:

- **No probe fallback.** Rays that leave the screen or find no on-screen occluder
  contribute nothing — off-screen GI is simply missing. SSRT3's §3.2 probe
  fallback was dropped in the TSL port (PLAN.md demo 03e / 07).
- **No multibounce.** Single-bounce GI only; no multibounce GI or multibounce AO
  (PLAN.md demo 03f, 06).
- **No bandwidth/mip optimization.** No depth/light mip pyramid, no half-res +
  joint-bilateral upsample, no workgroup depth caching — the cost structure is
  bandwidth, and none of it is addressed here (PLAN.md demo 03g, 09; paper Table 1).
- **Firefly clamp is hardcoded** (`maxLuminance = 7` in SSGINode) — not exposed as a
  tunable here because it isn't a uniform in stock SSGINode (PLAN.md trap; demo 03
  makes it tunable).
- **Temporal-dependent.** SSGI is noisy per-frame by design; it needs TRAA (or a
  denoiser) to converge. The single-frame `gi`/`ao` screenshots look grainy — that
  is expected raw signal, not a bug.
- `_halfProjScale` assumes a perspective camera (PLAN.md trap).

## Screenshots

`bench/screenshots/01-*.png` — cornell/sponza/zoo × {beauty, ao, gi} plus mode
variants (gtao, ssr, denoise, postnone). Captured headless via Playwright
(cached chromium, `--enable-unsafe-webgpu`). No page errors on any scene/mode.
