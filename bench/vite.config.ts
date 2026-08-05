import { existsSync } from 'node:fs';
import { defineConfig } from 'vite';

// Local fsr3 checkout (GUIDES-HANDOFF.md option a): when present, alias
// @pmndrs/upscaler straight at the library source for shader hot-reload while
// both repos iterate. The source imports `three`/`three/webgpu` as bare
// specifiers, so it resolves to THIS repo's three — no duplicate-three hazard.
// Everyone else gets the vendored build (bench/vendor/*.tgz, installed as a
// file: dependency — the upscaler isn't on npm yet). Set FSR3_LOCAL=0 to
// force the vendored package even when the local checkout exists.
const FSR3_DIR = '/Users/dex/Developer/fsr3';
const useLocalFsr3 = process.env.FSR3_LOCAL !== '0' && existsSync(`${FSR3_DIR}/src/index.ts`);

// .wgsl files are imported as raw strings via `?raw`. Vite handles ?raw natively.
export default defineConfig({
  server: {
    port: 5180,
    // The local upscaler alias points outside this package root.
    fs: { allow: ['..', ...(useLocalFsr3 ? [FSR3_DIR] : [])] },
  },
  resolve: {
    alias: [
      ...(useLocalFsr3
        ? [{ find: '@pmndrs/upscaler', replacement: `${FSR3_DIR}/src/index.ts` }]
        : []),
      // The upscaler source imports bare `three` for core math types while the
      // bench imports `three/webgpu`; vite pre-bundles those as two copies of
      // core ("Multiple instances of Three.js" warning). three/webgpu re-exports
      // all of core, so collapse the bare specifier onto it (exact match only —
      // three/tsl and three/addons must pass through untouched).
      { find: /^three$/, replacement: 'three/webgpu' },
    ],
    // The linked fsr3 source sits outside this root and has its own
    // node_modules/three — dedupe pins every three resolution to THIS repo's
    // copy so both codebases share one instance (also applies to the npm
    // package's own three imports).
    dedupe: ['three'],
  },
  // Without this, vite's pre-alias shortcut resolves bare `three` to its own
  // pre-bundled chunk BEFORE the alias above runs (bare->bare aliases don't
  // reach optimized deps), reintroducing the second core copy.
  optimizeDeps: { exclude: ['three'] },
  build: { target: 'esnext' },
});
