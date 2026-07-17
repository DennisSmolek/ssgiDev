# Asset fetch

Assets live in `bench/assets/` (gitignored) and decoders in
`bench/public/decoders/` (gitignored). Both are populated by the fetch script:

```
pnpm assets              # from repo root
# or: bench/scripts/fetch-assets.sh
```

`scripts/fetch-assets.sh` is idempotent (skips anything already present) and:

1. Downloads toji/sponza-optimized **`Sponza-KTX-Draco.glb`** (~9.3 MB, standard
   glTF: `KHR_draco_mesh_compression` + `KHR_texture_basisu`/KTX2) into
   `bench/assets/`. Asset decision + URL: `research/sponza-asset-comparison.md`.
2. Copies the **Draco + Basis/KTX2 decoders** out of the installed
   `three@0.185.1` package (`node_modules/three/examples/jsm/libs/{draco,basis}`)
   into `bench/public/decoders/`. We copy from node_modules rather than a CDN so
   the transcoder version always matches the pinned three (a mismatch silently
   corrupts textures), and so the app has no external runtime dependency.

The Cornell box and the artifact-zoo scene are fully procedural — no assets needed.
Only the Sponza scene consumes the downloaded glb + decoders.
