import { defineConfig } from 'vite';

// .wgsl files are imported as raw strings via `?raw`. Vite handles ?raw natively.
export default defineConfig({
  server: {
    port: 5180,
    // The upscaler alias points outside this package root.
    fs: { allow: ['..', '/Users/dex/Developer/fsr3'] },
  },
  resolve: {
    alias: [
      // Linked build of the FSR3 upscaler (GUIDES-HANDOFF.md option a): alias
      // straight at the library source for shader hot-reload while both repos
      // iterate. The source imports `three`/`three/webgpu` as bare specifiers,
      // so it resolves to THIS repo's three — no duplicate-three hazard.
      { find: '@pmndrs/upscaler', replacement: '/Users/dex/Developer/fsr3/src/index.ts' },
      // The upscaler source imports bare `three` for core math types while the
      // bench imports `three/webgpu`; vite pre-bundles those as two copies of
      // core ("Multiple instances of Three.js" warning). three/webgpu re-exports
      // all of core, so collapse the bare specifier onto it (exact match only —
      // three/tsl and three/addons must pass through untouched).
      { find: /^three$/, replacement: 'three/webgpu' },
    ],
    // The linked fsr3 source sits outside this root and has its own
    // node_modules/three (0.185.0) — dedupe pins every three resolution to
    // THIS repo's copy so both codebases share one instance.
    dedupe: ['three'],
  },
  // Without this, vite's pre-alias shortcut resolves bare `three` to its own
  // pre-bundled chunk BEFORE the alias above runs (bare->bare aliases don't
  // reach optimized deps), reintroducing the second core copy.
  optimizeDeps: { exclude: ['three'] },
  build: { target: 'esnext' },
});
