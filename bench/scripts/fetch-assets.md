# Asset fetch (placeholder)

`bench/assets/` is gitignored. No assets are needed for M0 (Cornell box is fully procedural).

## M1 — Sponza

The web-optimized "new Sponza" scene arrives in M1. Candidates (see PLAN.md):

- **toji/sponza-optimized** — https://github.com/toji/sponza-optimized (KTX2 + meshopt, built for WebGPU).
- **Castaño's updated Sponza glTF** — https://www.ludicon.com/castano/blog/2026/02/an-updated-sponza-gltf/
  (base repo https://github.com/ludicon/sponza-gltf).

M1 will replace this file with a real `pnpm assets` fetch script that downloads the chosen
candidate into `bench/assets/sponza/` and, if needed, runs it through
`gltf-transform` → KTX2 + meshopt.
