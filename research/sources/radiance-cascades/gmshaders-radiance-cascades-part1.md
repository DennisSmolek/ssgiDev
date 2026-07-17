# GM Shaders Guest: Radiance Cascades (Part 1) — by Xor and Alex (Yaazarai)

- URL: https://mini.gmshaders.com/p/radiance-cascades
- Comments: https://mini.gmshaders.com/p/radiance-cascades/comments
- Authors: **Xor** and **Alex** (Yaazarai). Companion GitHub repo: https://github.com/Yaazarai/GMShaders-Radiance-Cascades (GameMaker-targeted, but shader logic is engine-agnostic GLSL/HLSL-style).
- Explicitly framed as Part One: introduces concepts; defers shader-code deep dive to Part Two (see `gmshaders-radiance-cascades-part2.md`).

## Content captured

**Framing**: RC replaces "cast numerous random rays per pixel" (expensive, noisy) with a structured multi-cascade approach balancing spatial vs. angular resolution by distance.

**Penumbra hypothesis restated**: shadows need higher linear resolution close to a light source and higher angular resolution further away; these are inversely proportional.

**Cascade structure with concrete numeric example** (16×16 base resolution):
- Cascade 0: 256 probes, 64 rays each → 16,384 total rays
- Cascade 3: 4 probes, 4,096 rays each → 16,384 total rays
- Constant total ray count per cascade — this is the "constant memory footprint across cascades" the paper's flatland scaling law predicts.

**Ray setup**: `ray_angle = ray_index / ray_count * PI * 2`

**Distance/interval calculation** via geometric sequence for 4× branching factor:
```
origin = (interval * (1 - pow(4, cascadeIndex))) / (1 - 4)
```

**Cascade merging**: worked backward from highest to lowest cascade; finds matching probe + ray directions between levels; bilinear interpolation blends data; a visibility term (0 or 1) suppresses merging across occlusion boundaries.

**Final composite**: cascade 0 downsampled to probe count, then upscaled with interpolation to screen resolution → per-pixel diffuse GI.

**Cascade count bound** (prevents rays from originating off-screen):
```
cascadeCount = ceil(log4(intervalStart)) - 1
```

## Extensions mentioned (teased, some covered elsewhere in the ecosystem)
- Volumetric lighting via fluids
- Skybox integration (deferred to Part 2)
- Gravity simulation (unrelated fun aside)
- 3D screen-space GI variants

## Known limitations noted by the authors
- Occasional light leaks
- Non-linear attenuation transitions between cascades
- Explicitly called "actively researched and developed" — same maturity signal as jason.today.
