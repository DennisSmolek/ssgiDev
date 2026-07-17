# wcsXDN — Slice-Rel Dir Mapping [GT-VBAO]

- **Author:** TinyTexel
- **Published:** 2025-03-02 (unix 1740934805)
- **URL:** https://www.shadertoy.com/view/wcsXDN
- **Captured:** live from Shadertoy via Chrome (`gShaderToy` editor state), 2026-07-17 — current revision, not an archive snapshot
- **Tags:** shader

## Description (verbatim)

Approximations for the slice-relative direction mapping used by GT-VBAO/GI to implement distant light sampling and light probe sampling.

GT-VBAO [Distant Light Sampling]: https://www.shadertoy.com/view/wc2SzR

## Passes

- **Image** (image) — 22013 chars — inputs: ch1:keyboard
- **Common** (common) — 5726 chars — inputs: none

## Defines

- `#define PixelCount iResolution.xy` (Common)
- `#define clamp01(x) clamp(x, 0.0, 1.0)` (Common)
- `#define rsqrt inversesqrt` (Common)
- `#define KEY_LEFT  37` (Common)
- `#define KEY_UP    38` (Common)
- `#define KEY_RIGHT 39` (Common)
- `#define KEY_DOWN  40` (Common)
- `#define KEY_TAB 9` (Common)
- `#define KEY_CTRL 17` (Common)
- `#define KEY_SHIFT 16` (Common)
- `#define KEY_SPACE 32` (Common)
- `#define KEY_A 0x41` (Common)
- `#define KEY_D 0x44` (Common)
- `#define KEY_S 0x53` (Common)
- `#define KEY_W 0x57` (Common)
- `#define KEY_Q 81` (Common)
- `#define KEY_E 69` (Common)
- `#define KEY_R 82` (Common)
- `#define KEY_T 84` (Common)
- `#define KEY_Z 90` (Common)
- `#define KEY_U 85` (Common)
- `#define KEY_I 73` (Common)
- `#define KEY_O 79` (Common)
- `#define KEY_P 80` (Common)
- `#define KEY_F 70` (Common)
- `#define KEY_G 71` (Common)
- `#define KEY_H 72` (Common)
- `#define KEY_J 74` (Common)
- `#define KEY_K 75` (Common)
- `#define KEY_L 76` (Common)
- `#define KEY_Y 89` (Common)
- `#define KEY_X 88` (Common)
- `#define KEY_C 67` (Common)
- `#define KEY_V 86` (Common)
- `#define KEY_B 66` (Common)
- `#define KEY_N 78` (Common)
- `#define KEY_M 77` (Common)
- `#define KEY_N0 48` (Common)
- `#define KEY_N1 49` (Common)
- `#define KEY_N2 50` (Common)
- `#define KEY_N3 51` (Common)
- `#define KEY_N4 52` (Common)
- `#define KEY_N5 53` (Common)
- `#define KEY_N6 54` (Common)
- `#define KEY_N7 55` (Common)
- `#define KEY_N8 56` (Common)
- `#define KEY_N9 57` (Common)

## Links found in code

- http://keycode.info/
- https://arxiv.org/abs/2301.11376
- https://cdrinmatane.github.io/posts/cgspotlight-slides/
- https://cdrinmatane.github.io/posts/ssaovb-code/
- https://creativecommons.org/publicdomain/zero/1.0/
- https://github.com/Patapom/GodComplex/tree/master/Tests/TestHBIL
- https://www.activision.com/cdn/research/Practical_Real_Time_Strategies_for_Accurate_Indirect_Occlusion_NEW%20VERSION_COLOR.pdf
- https://www.shadertoy.com/view/3clGWB
- https://www.shadertoy.com/view/4cdfzf
- https://www.shadertoy.com/view/4ctBRH
- https://www.shadertoy.com/view/XXGSDd
- https://www.shadertoy.com/view/Xc3yzs
- https://www.shadertoy.com/view/XcdBWf
- https://www.shadertoy.com/view/XfcBDl
- https://www.shadertoy.com/view/lctBzH
- https://www.shadertoy.com/view/lfdBWn
- https://www.shadertoy.com/view/wc2SzR
- https://www.shadertoy.com/view/wcBGRz
- https://www.shadertoy.com/view/wcfGWB
- https://x.com/Mirko_Salm/status/1949829873335259618
