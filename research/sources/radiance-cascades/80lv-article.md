# 80.lv — "Radiance Cascades: New Approach to Calculating Global Illumination"

- URL: https://80.lv/articles/radiance-cascades-new-approach-to-calculating-global-illumination
- Author: Gloria Levine, Head of Content, 80.lv. Published November 9, 2023.
- Also linked from the PoE forum announcement thread: https://www.pathofexile.com/forum/view-thread/3448733 (that thread itself carries almost no independent technical content beyond linking to this article — WebFetch could not retrieve Sannikov's original technical post text from the PoE forum; see fetch-failures note in `notes.md`).

## Content captured

Announces Alexander Sannikov (Senior Programmer, Grinding Gear Games) introducing radiance cascades as a new data structure for real-time GI.

Quotes attributed to Sannikov's research: requires "higher linear resolution next to" objects and "higher angular resolution farther away" — press paraphrase of the penumbra condition.

**Performance claims reported**:
- "asymptotic scaling equivalent to casting infinitely many rays in finite time with finite memory"
- Constant cost "independent of scene complexity, number of light sources or polygons" — demoed at identical ~12 ms across scenes with 2, 102, and 1,002 particles.
- Demo footage: **0.3 ms/frame on a GTX 970**, no denoising, no temporal accumulation, full radiance-field recompute every frame.

## Why this is worth keeping
This is the earliest mainstream press coverage (Nov 2023, right after ExileCon) and is one of the only places the GTX 970 timing figure and the 2/102/1002-particle constant-cost demo appear together — useful as a citable "here's the original pitch" reference distinct from the more technical community writeups.
