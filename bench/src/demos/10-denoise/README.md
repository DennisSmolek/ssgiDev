# Demo 10 — Denoise lab

Pinned to **three@0.185.1**. One **fixed noisy producer** feeds pluggable,
A/B-comparable denoiser **stacks**. The producer is the experimental control:
every stack sees the *identical* input signal, so quality differences are the
denoiser's, not the sampler's.

## Producer (the control)

Demo 03's SSRT3 WebGPU-compute march (`../03-ssrt3/ssrt-main.wgsl`, reused
verbatim) at deliberately noisy settings: **rotationCount 1, stepCount 8, jitter
on, VBAO bitmask + GI gather on, fallback off, no multibounce**. It writes a
packed `rgba16float` GI/AO buffer (`rgb` = indirect radiance, `a` = AO), exactly
as demo 03's stage (c) does. Multibounce off means the march light source is the
beauty buffer directly (no lightmask pass); fallback off isolates the bounced GI
so the denoisers work on the raw noisy signal. Per-frame the producer cycles
SSRT3's `temporalOffset`/`temporalDirection` so successive frames sample
different points (needed for the temporal stacks to converge).

## Stacks (switchable, `?stack=`)

| id | what | source |
|---|---|---|
| `none` | control — raw producer, no denoise | — |
| `ssrt3` | temporal reprojection + 16-tap bilateral | demo 03 `ssrt-temporal.wgsl` + `ssrt-denoise.wgsl`, **reused verbatim**; exposes `temporalResponse` + `denoisingRadius` |
| `mathis` | count-based accumulation + adaptive bilateral | `denoise-mathis.wgsl`, adapted from demo 06 `sshgi-accum.wgsl` |
| `xegtao` | 5×5 symmetric depth-aware spatial + light temporal EMA | `denoise-xegtao-{spatial,temporal}.wgsl`, best-effort port of Intel XeGTAO's denoiser (see fidelity note) |
| `denoise-node` | three's stock `DenoiseNode` (TSL) over the raw GI texture | `three/addons/tsl/display/DenoiseNode.js` |

Every stack's noisy input comes from the same `giAoTex` storage texture consumed
as a plain TSL `texture()` node — including `denoise-node`, which wraps the stock
TSL addon directly over that raw texture. That proves the **raw → node-graph
interop direction end to end** (PLAN interop rule): a hand-written compute pass's
output feeds an unmodified TSL post node with no special casing.

**+ TRAA after (toggle, `?traa=1`, combined view):** the selected stack's
composite is fed to three's stock `TRAANode`. `traa()` wraps its beauty input in
`convertToTexture` (→ RTT), so the composite node is passed directly (as demo 01
does). Measures how each stack's output feeds a TAA consumer.

## Reference (`?view=reference`)

`accumulate.wgsl` — a demo-02-style long accumulation of the **same** producer
(running mean, CPU-driven frame count, reset on camera move). This is the
converged pseudo-ground-truth the stacks are scored against under a static camera.

## Coordinate / reuse notes

- Producer view-space + bitmask math is demo 03's, unchanged (see that README).
- Stack temporals use three's velocity convention `prevUV = uv − vel·(0.5,−0.5)`
  (matches `ssrt-temporal.wgsl`); disocclusion is a relative-depth reject using
  the current depth at the reprojected coord as the previous-depth proxy — the
  same documented simplification demo 03 uses (avoids a prev-G-buffer copy pass).
- Ping-pong stack outputs are bridged to a **stable** `stackOut` storage texture
  via a trivial `blit.wgsl` each frame, so the TSL display graph samples a fixed
  texture without a per-frame recompile (same ping-pong→stable bridge demo 06's
  compose pass does).
- Views: `combined` (beauty·AO + albedo·GI), `gi`, `ao`, `raw-gi`, `reference`,
  `split` (active stack vs reference, draggable divider / abs-diff). URL:
  `?demo=10-denoise&scene=&stack=&view=&traa=1`.

## Fidelity notes (best-effort ports)

- **XeGTAO**: the real XeGTAO carries a packed 4-bit-per-pixel edge mask emitted
  by its main AO pass; this producer doesn't emit one, so the 5×5 filter
  reconstructs XeGTAO's deliberately-*symmetric* edge stop from the depth buffer
  (relative-depth delta shaped by `sharpness`) plus a normal stop for the RGB
  channels. The temporal half is a light fixed-α EMA standing in for the host TAA
  XeGTAO assumes. Best-effort approximation, documented.
- **Mathis**: adapted to operate on the demo-03 packed GI/AO signal (not Mathis's
  own march) and *without* his albedo modulation (the lab keeps the signal
  pre-albedo; the composite applies albedo). Count is stored in a separate
  `r32float` texture (his alpha carries AO here), so the pass writes two storage
  outputs. His two defining behaviours — count-based accumulation and the
  count-adaptive bilateral radius (5×5 fresh → 3×3 converged) — are preserved.
- **TRAA**: the raw producer is **not** camera-jittered (TRAANode's Halton jitter
  only reaches the composite it wraps, not our upstream compute march), so TRAA
  here acts as a temporal *stabilizer* of each stack's output rather than a full
  jittered-AA resolve. That is exactly the "how does this signal feed a TAA
  consumer" question the lab is built to answer.
- **Reference**: it is the producer's converged *temporal mean* — NOT an
  independent brute-force truth like demo 02. Because the producer's spatial
  jitter (`rand(uv)`) is frame-static, the temporal mean retains a static
  per-pixel residue that only a *spatial* filter removes (see Findings). The
  reference is therefore a fair target for the temporal component but is itself
  slightly noisier than the spatial-bearing stacks.

## Cost (fence timing)

`window.__denoise10bench(n)` runs producer + active stack `n` times and fences on
`queue.onSubmittedWorkDone()` (the vsync rAF loop hides sub-frame compute cost).
Cornell, 1280×800, producer rc1/sc8:

| stack | ms/frame (producer + stack) |
|---|---|
| none | 0.93 |
| denoise-node | 1.03 * |
| mathis | 1.33 |
| ssrt3 | 1.43 |
| xegtao | 1.48 |

\* `denoise-node`'s 16-tap spatial pass runs inside the TSL **display** pipeline,
not in the fenced `runStack`, so this row is essentially producer-only; its true
cost is a single 16-tap spatial filter (no temporal), i.e. lighter than the
two-pass compute stacks above it. All numbers are close because the Cornell
producer is cheap — the stack ordering (2-pass xegtao/ssrt3 > 1-pass mathis) is
the signal, not the absolute ms.

---

## Findings

Screenshots: `bench/screenshots/10-cornell-*.png` (per-stack `combined`/`gi`,
`reference`, `raw-gi`, `*-traa`, `*-moving`, `ssrt3-split`).

### Static camera — converged quality
The raw producer (`none`, `10-cornell-none-gi.png`) is pure salt-and-pepper. All
four denoisers remove the bulk of it:
- **Mathis** and **SSRT3** are the cleanest — count/EMA temporal accumulation
  plus a spatial bilateral drives residual noise to near-zero with smooth,
  correctly-coloured bleed (red left, green right).
- **XeGTAO** is close but retains slightly more fine grain on flat walls — by
  design it is spatial-dominant with only a light temporal, so it leans on the
  (here weak) temporal stage less than SSRT3/Mathis.
- **DenoiseNode** (spatial-only) removes high-frequency noise but leaves the
  characteristic *streaky/blotchy* residue of a filter with no temporal term — it
  redistributes noise energy rather than reducing it over time (exactly the
  survey's §2 caveat).
- **Reference finding:** the pure-temporal-mean reference (`10-cornell-reference.png`)
  is *noisier* than SSRT3/Mathis, because the producer's `rand(uv)` jitter is
  frame-static and so survives temporal averaging. **Temporal accumulation alone
  cannot fully denoise this producer; a spatial filter is required** — which is
  why every stack that carries a bilateral beats the pure-temporal reference on
  static per-pixel noise.

### Moving camera — ghosting / lag
Scripted orbit (`10-cornell-*-moving.png`): under motion the world-position /
relative-depth reject in the SSRT3, Mathis and XeGTAO temporals invalidates
history, so all three fall back toward their **spatial** filter for freshly
disoccluded pixels — SSRT3/Mathis show a brief noise increase but **no ghost
trails**; `none` is full raw noise; DenoiseNode (no temporal) is motion-invariant
(same spatial result moving or still). No stack smears geometry edges under the
tested motion.

### Interaction with TRAA (the headline)
`10-cornell-{none,ssrt3,xegtao}-traa.png`. **The signal handed to TRAA matters as
much as the standalone result:**
- **`none` + TRAA** is surprisingly usable — TRAANode's variance-clipping temporal
  blend is itself a strong denoiser and removes most of the raw noise. But it
  **cannot fully clean a very noisy input**: floor/ceiling speckle survives,
  because variance clipping bounds history to the *noisy* current-frame
  neighbourhood statistics.
- **`ssrt3` (or `mathis`) + TRAA** is the **cleanest overall** — a
  pre-temporally-denoised, low-variance signal gives TRAA tight neighbourhood
  statistics to clip against, so residual noise disappears without visible smear.
- **`xegtao` / `denoise-node` + TRAA**: a heavily *spatially* smoothed input feeds
  TRAA an already-blurred signal; TRAA then adds its own temporal blur on top, so
  the risk shifts from residual noise to **over-smear** / detail loss rather than
  flicker.
- Net: TRAA rewards a **low-variance, temporally-stable** input (SSRT3/Mathis) and
  punishes both extremes — too noisy (`none`: residual speckle) and too blurred
  (spatial-only: compounded smear).

### Ranking

| stack | quality (static) | quality (motion) | cost | TRAA-compatibility |
|---|---|---|---|---|
| SSRT3 | **A** | A− (brief noise, no ghost) | B (2-pass) | **A** (low-variance in) |
| Mathis | **A** | A− | **A−** (1-pass) | **A** |
| XeGTAO | B+ | A− | B (2-pass) | B (over-smear risk) |
| DenoiseNode | B− (streaky, no temporal) | B (motion-invariant) | A− (1 spatial pass) | B− (compounded blur) |
| none (control) | F (raw) | F | **A** (0-pass) | B+ (TRAA carries it, but speckle) |

### Provisional default recommendation
**SSRT3 (temporal reprojection + bilateral), with Mathis a very close second.**
Both reach the cleanest static quality, handle motion without ghosting, and — the
deciding factor — hand TRAA the low-variance signal it needs to finish the job
without smear. Mathis is ~7% cheaper (one compute pass vs two) and nearly
indistinguishable in quality, so it is the pick when cost dominates; SSRT3 is the
default because its `temporalResponse`/`denoisingRadius` knobs give finer control
and it is the signal TRAA pairs best with. XeGTAO and DenoiseNode are viable when
a temporal history is unavailable (spatial-only), but both trade toward blur.
