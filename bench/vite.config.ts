import { defineConfig } from 'vite';

// .wgsl files are imported as raw strings via `?raw`. Vite handles ?raw natively.
export default defineConfig({
  server: { port: 5180 },
  build: { target: 'esnext' },
});
