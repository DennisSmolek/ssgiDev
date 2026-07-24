# 01 — Variance clipping vs. neighborhood clamping (HIGH)

**Bench decision this feeds:** demo 18's `jitterClamp` arm measured the hard 3×3
clamp flat at ~2× the capped-EMA floor. Variance clipping is the successor arm.
This is the reference formulation to implement it from.

---

## Answer in one paragraph

Hard neighborhood **clamping** builds a color-space AABB from the componentwise
`min`/`max` of the 3×3 current-frame neighborhood and `clamp()`s the reprojected
history into it. It is cheap but conservative: one bright/dark outlier inflates
the box (ghosting leaks) and per-channel clamping can leave history colors that
are in-box on every axis yet far from the current color (hue shift). **Variance
clipping** (Salvi, GDC 2016) instead models the neighborhood as a distribution,
builds a *statistical* AABB `μ ± γ·σ` from the first two raw moments (in YCoCg),
and **clips** history toward the box center along the line from the current
color. The moment box is tighter and better-centered because a lone firefly
barely moves μ and only modestly inflates σ — so it reduces ghosting **and**
flicker relative to hard clamping. Recommended **γ = 1.0** (Salvi's slides; Alex
Tardif's and Bevy's implementations use 1.0).

---

## The math (implement from this)

### Baseline: neighborhood min/max clamp (Malan 2012 / Karis 2014)

```
cmin = min over 3x3 neighborhood   // per channel
cmax = max over 3x3 neighborhood
history = clamp(history, cmin, cmax)
```

Tight box → flicker; loose box → ghosting. Per-channel `clamp` (not a clip
toward current) is the source of the hue-shift artifact.

### Variance clipping (Salvi GDC 2016)

For an N-sample neighborhood (N = 9 for 3×3), per-channel vectors, in **YCoCg**:

```
m1    = Σ c                        // first raw moment (sum)
m2    = Σ (c * c)                  // second raw moment (sum of squares)
mu    = m1 / N                     // mean
sigma = sqrt( max(m2/N - mu*mu, 0) )   // std-dev; clamp radicand >= 0 (NaN guard)
aabb_min = mu - gamma * sigma
aabb_max = mu + gamma * sigma
```

- **γ = 1.0 recommended** (larger γ → more temporally stable but more ghosting;
  too small → loses the ability to integrate over time). 1.0–1.25 seen in the wild.
- Salvi additionally recommends **clamping the moment AABB against the raw
  min/max AABB** so the statistical box never grows larger than the min/max box.

### Clip, don't clamp (Karis / Playdead `clip_aabb`)

Intersect the segment from current color → history color with the AABB, projecting
out-of-box history onto the box surface along the line to the box center:

```
p_clip = 0.5 * (aabb_max + aabb_min)     // box center
e_clip = 0.5 * (aabb_max - aabb_min)     // half-extent (+ epsilon)
v_clip = history - p_clip
v_unit = v_clip / e_clip
ma     = max(|v_unit.x|, |v_unit.y|, |v_unit.z|)
history = (ma > 1.0) ? (p_clip + v_clip / ma) : history
```

### Why YCoCg + the chroma-shrink trick (Playdead `USE_YCOCG`)

Convert to YCoCg before building the box. Compute full luma (Y) extent from the
neighborhood, then shrink the chroma (Co,Cg) extent to **¼ of the luma extent**,
recentered on the current sample's chroma:

```
chroma_extent = 0.25 * 0.5 * (cmax.Y - cmin.Y)
cmin.CoCg = current.CoCg - chroma_extent
cmax.CoCg = current.CoCg + chroma_extent
```

This makes the box a thin luma-dominant slab: clipping mostly corrects brightness
(where aliasing lives) while tightly constraining chroma (suppresses color ghosting).

### Best-of-both in practice (Alex Tardif, Bevy)

Do both — hard-clamp to the raw box first, then variance-clip toward the moment
box center:

```
history = clip_aabb(mu - g*sigma, mu + g*sigma,
                    clamp(history, cmin, cmax));
```

---

## Primary sources

- **An Excursion in Temporal Supersampling** — Marco Salvi, NVIDIA, GDC 2016.
  https://developer.download.nvidia.com/gameworks/events/GDC2016/msalvi_temporal_supersampling.pdf
  — Slides 22–28 define variance clipping (moments → μ,σ → AABB = μ±γσ, "we
  typically use gamma = 1", clamp moment box vs min/max box). Slide 38: VC-induced
  flicker (excessive aliasing shrinks variance and resets the accumulator). ✅ fetched.
- **High-Quality Temporal Supersampling** — Brian Karis, Epic, SIGGRAPH 2014
  (Advances in Real-Time Rendering). Index: https://advances.realtimerendering.com/s2014/
  · slides PPTX: https://advances.realtimerendering.com/s2014/epic/TemporalAA.pptx
  — origin of YCoCg neighborhood clipping and clip-toward-AABB (vs clamp).
- **Temporal Reprojection Anti-Aliasing in INSIDE** — Playdead, GDC 2016.
  https://github.com/playdeadgames/publications/blob/master/INSIDE/GDC2016_Temporal_Reprojection_AA_INSIDE.pdf
  — production clip-vs-clamp + YCoCg chroma-shrink.
- **Filmic SMAA** — Jorge Jimenez, Activision, SIGGRAPH 2016.
  https://research.activision.com/publications/archives/filmic-smaasharp-morphological-and-temporal-antialiasing
- **A Survey of Temporal Antialiasing Techniques** — Yang, Liu, Salvi, EG 2020.
  http://behindthepixels.io/assets/files/TemporalAA.pdf — best single overview of
  clamp vs clip vs variance clip.

## Code / implementations

- **playdeadgames/temporal — TemporalReprojection.shader** (HLSL/Cg, Unity).
  https://github.com/playdeadgames/temporal/blob/master/Assets/Shaders/TemporalReprojection.shader
  — canonical `clip_aabb` (optimized center-clip + full per-plane), `RGB_YCoCg`,
  chroma-extent shrink, `USE_CLIPPING` vs `clamp()` switch. (Box is min/max here;
  the moment box is Salvi's layer on top.) ✅ fetched.
- **Alex Tardif — TAA Starter Pack** (HLSL). https://alextardif.com/TAA.html
  — full worked resolve: `m1/m2` loop, `sigma = sqrt(abs(m2/N - mu*mu))`,
  `minc/maxc = mu ± gamma*sigma` with **gamma=1.0**, then
  `clip_aabb(minc, maxc, clamp(history, nMin, nMax))`. ✅ fetched.
- **Intel GameTechDev/TAA — TAAResolve.hlsl**.
  https://github.com/GameTechDev/TAA/blob/main/MiniEngine/Core/Shaders/TAAResolve.hlsl
- **bevyengine/bevy — taa.wgsl** ⭐ (WGSL/WebGPU — most directly reusable).
  https://github.com/bevyengine/bevy/blob/v0.13.0/crates/bevy_core_pipeline/src/taa/taa.wgsl
  — variance box with **γ=1 implicit** (`variance = m2/9 - mean*mean`,
  box = `mean ± sqrt(max(variance,0))`), `clip_towards_aabb_center`, YCoCg, and
  a 5-tap Catmull-Rom history fetch, all in ~200 lines. ✅ fetched.

## WGSL gotchas

- `sqrt` of a slightly-negative variance (float error) → NaN that **poisons the
  accumulator forever**. Guard with `max(variance, 0)` / `abs(...)` (Bevy & Tardif do).
  Also `max(0, sample)` on the current fetch to stop negative/NaN bleed.
- WGSL has `saturate()` but no `rcp` — define `fn rcp(x:f32)->f32 { return 1.0/x; }`.
- Build the moment box and clip in the **same** color space; Bevy Catmull-Rom-
  samples history in RGB then converts to YCoCg for the clip — don't cross the streams.

## Confidence

Formulas and γ=1 quoted verbatim from Salvi's PDF, Tardif's HLSL, and Bevy's WGSL
(all fetched). The "clamp then clip" fusion is directly from Tardif/Bevy. Karis
PPTX page numbers relied on the s2014 index + secondary citations rather than
opening the 27 MB deck.
