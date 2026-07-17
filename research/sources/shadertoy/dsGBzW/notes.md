# dsGBzW — Screen Space Horizon GI

- **Author:** Mathis
- **Published:** 2023-10-30 (unix 1698698709)
- **URL:** https://www.shadertoy.com/view/dsGBzW
- **Captured:** live from Shadertoy via Chrome (`gShaderToy` editor state), 2026-07-17 — current revision, not an archive snapshot
- **Tags:** global, illumination, space, integral, horizon, sceen

## Description (verbatim)

Screen space multibounce GI by integrating horizons with visibility bitmasks.
Simple temporal accumulation, fully dynamic scenes requires a better denoiser

Use the mouse to rotate the camera
Based on: https://arxiv.org/pdf/2301.11376.pdf

## Passes

- **Image** (image) — 1181 chars — inputs: ch0:buffer, ch1:buffer, ch2:buffer
- **Common** (common) — 19615 chars — inputs: none
- **Buffer A** (buffer) — 7473 chars — inputs: ch0:buffer, ch1:keyboard, ch2:buffer
- **Buffer B** (buffer) — 3799 chars — inputs: ch0:buffer, ch1:buffer
- **Buffer C** (buffer) — 4235 chars — inputs: ch0:buffer, ch1:buffer, ch2:buffer, ch3:buffer
- **Buffer D** (buffer) — 125 chars — inputs: ch0:buffer

## Defines

- `#define RES iResolution.xy` (Common)
- `#define IRES (1./iResolution.xy)` (Common)
- `#define ASPECT vec2(iResolution.x/iResolution.y,1.)` (Common)

## Links found in code

- https://arxiv.org/pdf/2301.11376.pdf
- https://www.baeldung.com/cs/integer-bitcount

## Related file

- `mirror-olivier-therrien-vbao.glsl` — Therrien's reference VBAO GLSL (via cybereality), saved here during the first gathering pass when this shader was still unfetchable. It is a *different* shader kept for comparison.
