# radiance.wiki — community hub

- URL: https://radiance.wiki/
- Also referenced: interactive playground at https://radiance-cascades.com (separate site, see below)
- Positioned as the closest thing to a canonical index for the whole RC ecosystem — start here when hunting for something not captured in this folder.

## Content captured

RC described as: real-time GI method by Alexander Sannikov at Grinding Gear Games for Path of Exile 2, debuted ExileCon 2023, since evolved through community contribution.

Restates the penumbra hypothesis as: "resolving light from an object requires higher spatial resolution nearby and higher angular resolution far away." Cascades progressively double ray counts while reducing probe density; merging reconstructs the full radiance field cheaply.

**Characterization of maturity** (the wiki's own framing, useful as a maturity-assessment anchor):
- "Noiseless 2D results" — 2D is described as settled/solved.
- "Open 3D challenge: Extending the technique to three dimensions remains an active research area" — explicit community acknowledgment that 3D is unsolved, not merely under-documented.

## Resource categories on the wiki
- Learning materials: video intros, interactive walkthroughs, guides, presentations.
- Academic resources: papers and technical docs.
- Implementation code across GLSL, HLSL, WGSL, Rust, C++, JavaScript, CUDA.
- Technical refinements: optimizations, experimental variants.

## Community access
Two active Discords develop the technique further (not independently archived by this research pass — treat the wiki + secondary summaries as the best available proxy for that discussion).

## radiance-cascades.com (separate interactive playground, WIP)
Adjustable parameters exposed: 2D sRGB falloff, bilinear-fix toggle, mipmap controls, non-linear accumulation, naive-GI-noise comparison, ringing fix, sun angle, "reduce demand" (bi-frame calculation option — i.e. amortizing cascade computation across two frames).
Links out to: the WIP formal paper, the non-LTE radiative-transfer arXiv paper (unrelated field, same name coincidence — see `academic-followups.md` caveat), the "2D Global Illumination" arXiv work, GM Shaders' two-part guide, SimonDev's video+repo, jason.today's writeup.
Lists 6 working demo/implementation categories: Shadertoy demos, Unity URP integration, LegitScript implementations, Volumetric HRC versions, a WebGL-based shader editor, plus community-built calculators/visualization/bug-fix tools.
