# GM Shaders Guest: Radiance Cascades 2 — Optimizations & Code Deep Dive — by Alex and Xor

- URL: https://mini.gmshaders.com/p/radiance-cascades2
- Comments (Substack mirror): https://open.substack.com/pub/xordev/p/radiance-cascades2?comments=true
- Companion repo: https://github.com/Yaazarai/GMShaders-Radiance-Cascades (folder `RadianceCascades-Optimized/`). Unlicensed repo (no explicit license file per the GitHub metadata pulled).

## Problems with the Part-1 implementation (as stated by the authors)
- Shaders split across two passes → duplicate pipeline setup cost
- Fixed to square resolutions; non-square formats broke
- Missing texture-cache-friendly layout
- ~75% memory overhead from storing rays redundantly

## Optimization 1 — Pre-Averaging
Instead of storing 4 individual rays per probe-direction-group separately, cast 4 rays and **average them before storing**, since the merge step averages them anyway. Quote: *"If we're just going to average the results anyways, why even bother storing all four rays individually?"* Cuts merge-time texture lookups from 16 → 4 and memory by 75%.

## Optimization 2 — Direction-First Layout
Reorganize probe storage so that rays pointing in the *same direction* across different probes sit in adjacent memory (instead of the traditional position-first layout), which lets hardware bilinear filtering do double duty during the merge. Combined with pre-averaging, reduces merge texture samples from 16 down to 1.

## Measured results (RTX 3080)
- Position-first: 1024×1024, 4 probes/px, 4 rays/probe → **29.91 ms/frame**
- Direction-first: 1920×1080 (higher res!), same probe/ray density → **25.95 ms/frame**

## Shader architecture (single consolidated pass)
1. `cascadeTexelInfo()` — abstracts angular resolution, linear spacing, probe grouping, ray indexing, offsets, and range, all computed from geometric-sequence cascade scaling.
2. Raymarch function — traces through a signed distance field; operates in **pixel space, not UV space**, to support non-square resolutions; SDF distances are stored scaled by the render-extent diagonal `sqrt(w²+h²)` for precision.
3. Merge logic — merges cascade N with N+1: computes bilinear interpolation weights from relative probe positions; explicitly guards against merging when a ray hit a surface or when processing the top cascade.

Per-texel main-shader flow:
```
1. probeInfo = cascadeTexelInfo(texel)
2. origin = probe position in screen space
3. rayBase = preAveragedIndex * 4   // expand back to 4 raw ray indices
4. for i in 0..3: angle = index_to_angle(rayBase+i); raymarch(angle)
5. merge with cascade N+1
6. average the 4 samples (× 0.25)
```

## Notable engineering details
- SDF stored as 2-byte floats scaled by screen diagonal to keep precision across non-square resolutions while working in pixel-space.
- Texel→index conversion is row-major, enabling direction-first lookups.
- Border clamping at probe-group boundaries to prevent bleed across direction-first block edges.
- End result: "nearly 100 lines of shader code" for the full RC pass — a useful complexity budget reference for a from-scratch implementation.
