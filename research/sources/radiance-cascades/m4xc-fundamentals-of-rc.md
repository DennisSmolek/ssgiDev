# MΛX (mxcop) — "Fundamentals of Radiance Cascades"

- URL: https://m4xc.dev/articles/fundamental-rc/
- Author: Max (mxcop). Published 2024-10-22. ~3,815 words / 20 min read.
- Discussed on Hacker News: https://news.ycombinator.com/item?id=41957008 (see `hn-discussion-fundamentals.md`)
- Rated (by this survey) as one of the clearer from-scratch derivations of *why* RC works, not just *how* — good second stop after tmpvar's interactive explainer.

## Structure captured

### 1. Foundational observations (derives the penumbra hypothesis from scratch, independent of the paper's notation)
- **Angular observation**: the angle between evenly spaced rays must stay smaller than object-size / distance, or angular resolution becomes insufficient as probes move away from objects.
- **Spatial observation**: penumbrae can be resolved with just two interpolated probes, with required probe spacing set by distance-to-nearest-object and object size.
- **Penumbra theorem**: spatial-resolution need and angular-resolution need are inversely proportional as distance grows — this is the same relationship as Sannikov's penumbra condition, independently re-derived.

### 2. Technical implementation strategy
- Angular exploitation: discretize a probe's surrounding circle into "rings," each ring given progressively higher angular resolution for more distant objects.
- Spatial exploitation: treat rings as independent probes with increasing spacing per distance window.

### 3. Cascade architecture
- A cascade = a uniform grid of probes with equal properties (spacing, ray count, interval range).
- Probe count typically halves per axis between levels (¼ the count in 2D) while angular resolution scales inversely.
- Storage: 2D textures packing probes together.

### 4. Computational workflow
- **Gathering**: cast intervals (range-limited rays) from each probe texel into the scene.
- **Merging**: top-down, cascade N+1 → N, using: interval merging with an explicit visibility term to suppress merging across occlusion; bilinear interpolation across the 4 nearest probes; cone-based radiance aggregation for diffuse extraction.

### 5. Final integration
Merged cascade-0 sampled via bilinear interpolation per screen pixel, summing radiance across all directional cones.

## Key insight (verbatim-adjacent)
RC works because near objects need high spatial / low angular resolution, and distant objects need the inverse — the hierarchy just encodes that asymmetry directly instead of paying for full resolution everywhere.
