# tmpvar — "Radiance Cascades" interactive explainer (2D)

- URL: https://tmpvar.com/poc/radiance-cascades/
- Author: tmpvar. Credits explicitly given on-page to **Suslik** (credited by tmpvar as originating the RC approach — note: this may be a discord handle/alias rather than distinct from Sannikov; treat as tmpvar's own attribution and verify against the paper if it matters), **fad** (initial Shadertoy implementation), **Yaazarai**, and **SimonDev** (educational content).
- Requires WebGPU (Chrome/Edge).
- License: text and images CC BY 4.0; linked source code MIT.

## Content captured

Builds intuition through a live, parameter-driven 2D playground rather than static prose:

- **Radiance Intervals** are visualized as "bands / shells / annuluses / crusts" of radiance carried by each probe — i.e. the same `L_{a,b}` interval concept as the paper, made literally visible as an annulus around each probe.
- **Cascade progression**: each level doubles the inner radius and band width of the interval while doubling the number of rays per probe, which — combined with halving probe density — keeps total ray count per cascade level roughly flat; rays are angularly offset per level to avoid directional overlap between cascades.
- **Probe interpolation**: interactive visualization of how radiance values interpolate across probe rays across cascade levels (the bilinear-of-4-nearest-probes merge step from the paper, made tactile).
- **3D section on the same page**: presents two approaches side by side —
  1. screen-space probes with world-space intervals
  2. world-space probes with ping-pong buffers
  both with live, adjustable storage-cost calculators.
- Interactive controls include probe diameter, level-0 interval radius, and branching factor — good for building intuition about the tuning knobs the paper says still require manual tuning.

## Why relevant

This is the best hands-on, no-install way to build cascade/probe/interval intuition before touching real GPU code — recommended as the first stop for a new implementer (see `notes.md` "best 3 sources").
