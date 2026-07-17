# tmpvar — 3D explainer + "Implementing Radiance Cascades" notes

## Radiance Cascades 3D (interactive)
- URL: https://tmpvar.com/poc/radiance-cascades-3d/
- Requires WebGPU (Chrome/Edge).
- Three interactive sections:
  1. **Probe Ray Distribution (3D)** — lets you compare sphere-sampling strategies for a probe's angular basis: Cube Face Subdivision, Lat/Lon Subdivision, Golden Spiral, Kogan Spiral, Golden Hemisphere, Random Hemisphere Uniform, Random Hemisphere, Uniform Hemisphere. Directly useful if this project needs to pick a 3D angular basis for probes (vs. the 2D case's trivial equal-angle-slice rays).
  2. **Screen Space (3D)** — explicitly marked **work-in-progress**; offers "Screen Space Brute Force" vs. "World Space Brute Force" raycasting toggles for side-by-side comparison. This is the closest thing found in the wild to a purpose-built SS-vs-WS RC comparison tool.
  3. **Fuzz World (3D)** — experimental scene-configuration playground.
  - Exposes branching factor, ray count, interval radius, and per-level probe lattice controls.

## "Implementing Radiance Cascades" article
- URL: https://tmpvar.com/articles/implementing-radiance-cascades/
- Framed explicitly as informal research notes, not a tutorial — useful precisely because it captures the *uncertainty* of a first-principles implementer, which is closer to this project's position than the more polished writeups.
- Screen-space probes: tmpvar hypothesizes the approach as "render the scene and then break up the screen into a uniform probe distribution," then explores two ray-casting strategies:
  - screen space: march the depth buffer
  - world space: position probes at surfaces and march world-space rays
- References NVIDIA GPU Gems' volume-rendering opacity-correction formula: `A = 1 - (1 - A_0)^(s_0/s)` for adjusting accumulated opacity when step size changes between cascade levels (relevant if intervals are marched at different step sizes per cascade).
- States plainly that **world-space implementations hit significant memory constraints** — echoes the paper's "storing a 3d grid for cascade 0 ≈ voxelizing the whole scene" limitation.

## Takeaway
tmpvar's own notes independently arrive at the same screen-space-vs-world-space fork the paper documents formally, and flag memory as the deciding factor against a naive world-space 3D grid — reinforcing that a screen-space-probe / world-space-ray-interval hybrid (as in `three-rc`, see `three-rc-implementation.md`) is the pragmatic path for a three.js WebGPU project.
