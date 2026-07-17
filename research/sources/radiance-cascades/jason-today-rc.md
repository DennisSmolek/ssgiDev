# jason.today — "Radiance Cascades: Building Real-Time Global Illumination"

- URL: https://jason.today/rc
- Author: Jason (jason.today). Implementation-focused, incremental WebGL tutorial — explicitly builds up from naive raymarched GI to full radiance cascades.
- Highly recommended as an implementer's on-ramp (see `notes.md`).

## Structure / content captured

**Motivation**: naive approach casts 32+ rays/pixel uniformly, needing hundreds of millions of rays/frame at typical resolutions — establishes why RC exists before introducing it.

**Core idea introduced via the penumbra hypothesis**: light sources need higher angular resolution but lower spatial resolution as distance increases, so instead of dynamically branching during raymarching, split computation into discrete passes:
- upper cascades: low resolution, many rays (e.g. 256 rays at 1/16 resolution)
- lower cascades / cascade 0: full resolution, few rays (e.g. 16 rays/pixel)

**Pass organization / cascade count formula**:
```
cascadeCount = ceil(log(diagonal) / log(baseRayCount)) + 1
```
Ping-pong rendering merges coarse → fine cascades.

**Probe-based ray encoding**: rays are distributed spatially across probe groups (e.g. 16×16-pixel regions) rather than cast redundantly per pixel — one probe casts rays collectively for its whole tile.

**Color space handling** (a real gotcha the article calls out explicitly):
```glsl
// on read
pow(colorSample.rgb, vec3(2.2))
// on write
pow(result.rgb, vec3(1.0/2.2))
```
Converting sRGB↔linear around the sampling step is necessary to avoid lighting inaccuracies — worth remembering for a three.js/WebGPU pipeline since color-space handling differs from raw WebGL.

**Interval management** per cascade:
```glsl
intervalStart  = pow(base, cascadeIndex - 1) / shortestSide
intervalLength = pow(base, cascadeIndex)     / shortestSide
```

**Merging with clamping** to avoid light leaking across edges when reading the upper cascade:
```glsl
vec2 clamped = clamp(offset, vec2(0.5), upperSize - 0.5)
```

## Known artifacts / open issues (per the article)
- Ringing artifacts, especially visible with point lights when sRGB correction is enabled.
- Explicitly flagged as "an active research area with ongoing work in the graphics programming community" — i.e. even the best implementation-focused writeup treats RC as unfinished, not a settled recipe.

## Performance framing
Distributing 16+256 rays across cascades (rather than densely per-pixel) claims comparable cost to a naive 32-ray approach while eliminating temporal noise.
