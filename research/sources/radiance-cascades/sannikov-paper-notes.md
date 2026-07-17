# Sannikov — "Radiance Cascades: A Novel Approach to Efficient Global Illumination"

- **Primary source.** PDF downloaded to `./sannikov-paper.pdf` (60.6 MB, direct pull of the built PDF from the repo — many embedded figures/images account for the size).
- Source repo: https://github.com/Raikiri/RadianceCascadesPaper (LaTeX source: `RadianceCascades.tex`, built via `out_latexmk2/RadianceCascades.pdf`)
  - MIT licensed. 175 stars / 9 forks at time of research. Never submitted to a journal (uses the JCGT template for formatting only). Author's README: "This is a repo for my paper on Radiance Cascades... I do want the text to be available permanently for people who search it." PRs for grammar/wording welcomed.
  - Community discussion pointer: the Graphics Programming Discord's dedicated RC thread (not independently archived — see `talks-and-videos.md` and `screen-space-radiance-cascades.md` for what surfaced from it via secondary sources).

## Outline (from the .tex source)

1. **Introduction**
2. **Derivation**
   - The Penumbra Condition
   - The Penumbra Hypothesis
   - Radiance Interval
   - Radiance Cascades
   - Representing Radiance Cascades in Memory
3. **Analysis**
4. **Implementations**
   - Radiant 2D
   - Path of Exile 2 GI
   - Radiance 3D
   - Direct Radiance Field Renderer
   - **Screen Space Probes with World Space Radiance Intervals** ← directly relevant to this project, see `screen-space-radiance-cascades.md`
5. **Limitations**
6. **Conclusions and Further Work**

## Abstract (paraphrase + verbatim fragment)

"This work proposes a novel data structure called *radiance cascades* that allows effectively storing and calculating radiance field by decomposing it into multiple ranges (from near-field to far-field)." The scaling "remov[es] the total number of rays as the primary constraint for calculating global illumination in 2d and 3d."

## Core definitions (verbatim where quoted)

**The Penumbra Condition** — "In order to resolve radiance emitted by an object of a given size, one needs to have higher linear resolution with lower angular resolution near this object, and lower linear resolution with higher angular resolution farther away from it." Formally Δp ∝ D, Δω ∝ 1/D, where D is distance from the light source.

**The Penumbra Hypothesis** — "For a given discretization of radiance field to be representative of the field at every scale, it is necessary and sufficient for such discretization to satisfy the penumbra condition associated with such radiance field."

**Radiance Interval** — L_{a,b}(**p**, ω̂): incoming radiance at point **p** from direction ω̂, originating from points farther than `a` but closer than `b`. In the opaque case:
```
L_{a,b}(p, ω̂) = L_out(R(p + aω̂, ω̂), -ω̂)   if hit distance < b
              = 0                            otherwise
```

**Radiance Probes** — each cascade stores probes (like light probes) at uniform spacing, holding a directional radiance distribution (cubemap / octahedral map / spherical-harmonic-like) for a specific interval range `[a,b]`.

## Cascade scaling laws

- Flatland (2D pos + 1D dir): memory per cascade M_i ∝ 1/2^i; total over N cascades < 2·M₀ (converges — constant total memory).
- 3D space (3D pos + 2D dir): same M_i ∝ 1/2^i scaling; total < 2·M₀.
- Surface radiance (2D surface + 2D dir): M_i = M₀ constant per cascade → total memory scales *linearly* with cascade count (this is the case that matters for screen-space/surface-based GI, since the "surface" is the G-buffer).
- General relation: Δp ∝ 2^i, Δω ∝ 1/2^i, interval length t_i ∝ 2^i. Each cascade needs half the storage/compute of the previous cascade combined with double the angular density.

## Key operations

- **Merging** (adjacent intervals): `L_{a,c} = L_{a,b} + β_{a,b}·L_{b,c}` (β = transmittance over `[a,b]`).
- **Shifting**: `L_{a+x,b+x}(p, ω̂) = L_{a,b}(p + ω̂x, ω̂)` — translate the interval origin along its own ray direction.
- **Extending**: combine shift + merge to double an interval's range in O(1), avoiding a full re-raymarch.

## Ray-cost equivalence

"Adding each cascade increases the number of rays total twice, while being half the cost of the previous one" → `rays(N) = 2^N·rays(0)`, but `cost(N) < 2·cost(0)`. Framed by the author as approximating "casting infinitely many rays in a finite amount of time."

## Limitations (verbatim excerpts)

- "Calculating just cascade 0 in a high level of detail can take milliseconds, which can already be over budget."
- Manual tuning still required: cascade-0 spacing, angular resolution, interval range.
- **"PoE2's screenspace implementation cannot capture offscreen lighting or occluders."** — the single most load-bearing sentence for this project's screen-space-GI question.
- "Storing a 3d grid associated with just cascade 0 is practically equivalent to voxelizing the entire scene" — i.e. full world-space 3D RC at cascade-0 density is roughly as expensive as voxel GI, which is why PoE2 shipped the screen-space variant instead.

## Conclusion (paraphrase)

Radiance cascades remove ray count as the primary bottleneck for GI by storing *intervals* instead of individual rays, at the cost of blur: "normally sharp shadows become blurrier as if cast by an area light source" as cascade level increases (this graceful degradation is a feature, not strictly an artifact — it mirrors how real penumbrae behave).

## Why this matters for VBAO/near-field comparison

The paper's own scaling analysis (surface radiance case, §"Analysis") is the reason RC's constant-cost angular growth doesn't automatically transfer to arbitrary screen-space surface caches the way it does for volumetric/flatland cascades — memory grows linearly with cascade count for surface-based (G-buffer-anchored) storage, which is exactly the situation a three.js WebGPU SSGI implementation would be in. See `notes.md` primer for how this interacts with a VBAO-style near-field pass.
