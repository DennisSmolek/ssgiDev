# Hacker News thread — "Fundamentals of Radiance Cascades"

- URL: https://news.ycombinator.com/item?id=41957008
- Discussion of m4xc.dev's article (see `m4xc-fundamentals-of-rc.md`).

## Key points extracted from the thread

- RC originated with Alex Sannikov for Path of Exile 2.
- Reported cost: ~0.8 ms on high-end GPUs, constant regardless of scene complexity; zero latency since there's no temporal accumulation.
- A nice side effect noted: particle effects can naturally emit indirect light with no artist-side light-probe placement.

**Framing quote from a commenter** on why RC is a genuinely new point in the design space, not just "yet another probe technique":
> "ambient occlusion computes light intensity with high spatial resolution, but completely handwaves the direction... environment maps... have precise light intensity for every angle" but lack spatial resolution. RC computes "very few sample points × all angles" + "some sample points × some angles" + "all sample points × very few angles" — i.e. it spans the full spatial/angular tradeoff space that AO and env-maps each only occupy one corner of.

## Screen-space limitations — directly relevant to this project
> "offscreen light sources don't contribute to lighting in screen-space implementations" — works "great" for fixed-perspective dungeons/2D games, "but a light source behind a column or in another room will cast no light on the scene."

Proposed community mitigations (unverified, raised as suggestions in the thread, not shipped solutions):
- Render to a larger-than-viewport texture margin.
- Add extra cascades dedicated to distant/off-screen lighting contributions.

## Comparisons to other GI techniques
- RC "brute-force traces fixed sets of rays in regular grids" rather than importance-sampling like a path tracer.
- Full 3D RC (world-space grid at cascade-0 density) is judged impractical beyond voxelized scenes — consistent with the paper's own limitation statement.
- Screen-space variants are judged "highly practical" despite the offscreen-light gap.

## Open questions raised (unresolved in-thread)
- Scaling to outdoor/large-distant-visibility scenes.
- Whether the diffuse-only limitation (no specular GI in the base technique) matters much in practice for most game art styles.
