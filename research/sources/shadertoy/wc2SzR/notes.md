# wc2SzR — GT-VBAO [Distant Light Sampling]

- **Author:** TinyTexel
- **Published:** 2025-03-09 (unix 1741540193)
- **URL:** https://www.shadertoy.com/view/wc2SzR
- **Captured:** live from Shadertoy via Chrome (`gShaderToy` editor state), 2026-07-17 — current revision, not an archive snapshot
- **Tags:** ao, occlusion, ambient, gtao, vbao

## Description (verbatim)

This is an extension of GT-VBAO that also performs distant light sampling (i.e. unoccluded rays are used to sample a sky box).

Camera controls via mouse + shift key

## Passes

- **Image** (image) — 11136 chars — inputs: ch0:buffer, ch1:buffer, ch2:buffer, ch3:buffer
- **Buffer A** (buffer) — 6425 chars — inputs: ch1:keyboard, ch3:buffer
- **Common** (common) — 49169 chars — inputs: none
- **Buffer B** (buffer) — 2983 chars — inputs: ch1:keyboard, ch3:buffer
- **Buffer C** (buffer) — 34428 chars — inputs: ch0:buffer, ch1:texture, ch2:buffer, ch3:buffer
- **Buffer D** (buffer) — 10061 chars — inputs: ch0:buffer, ch1:texture, ch2:buffer, ch3:buffer

## Defines

- `#define KeyBoard iChannel3` (Image)
- `#define KeyBoardChannel w` (Image)
- `#define VarTex iChannel3` (Image)
- `#define OutCol outCol` (Image)
- `#define OutChannel w` (Image)
- `#define KeyBoard iChannel1` (Buffer A)
- `#define VarTex iChannel3` (Buffer A)
- `#define OutCol outCol` (Buffer A)
- `#define OutChannel w` (Buffer A)
- `#define WriteVar(v, cx, cy) {if(uv.x == uint(cx) && uv.y == uint(cy)) OutCol.OutChannel = v;}` (Buffer A)
- `#define WriteVar4(v, cx, cy) {WriteVar(v.x, cx, cy) WriteVar(v.y, cx, cy + 1) WriteVar(v.z, cx, cy + 2) WriteVar(v.w, cx, cy + 3)}` (Buffer A)
- `#define USE_TEMP_ACCU_COND                (ReadKeyToggle(KEY_TAB  ) != 0.0)` (Common)
- `#define USE_PERSPECTIVE_CAM_COND          (ReadKeyToggle(KEY_CTRL ) == 0.0)` (Common)
- `#define SHOW_UI_COND                      (ReadKeyToggle(KEY_U    ) == 0.0)` (Common)
- `#define VAR_ROW 4` (Common)
- `#define KEY_LEFT  37` (Common)
- `#define KEY_UP    38` (Common)
- `#define KEY_RIGHT 39` (Common)
- `#define KEY_DOWN  40` (Common)
- `#define KEY_TAB 9` (Common)
- `#define KEY_CTRL 17` (Common)
- `#define KEY_ALT 18` (Common)
- `#define KEY_SHIFT 16` (Common)
- `#define KEY_SPACE 32` (Common)
- `#define KEY_Q 81` (Common)
- `#define KEY_W 87` (Common)
- `#define KEY_E 69` (Common)
- `#define KEY_R 82` (Common)
- `#define KEY_T 84` (Common)
- `#define KEY_A 65` (Common)
- `#define KEY_S 83` (Common)
- `#define KEY_D 68` (Common)
- `#define KEY_F 70` (Common)
- `#define KEY_G 71` (Common)
- `#define KEY_N1 49` (Common)
- `#define KEY_N2 50` (Common)
- `#define KEY_N3 51` (Common)
- `#define KEY_N4 52` (Common)
- `#define KEY_N5 53` (Common)
- `#define KEY_N6 54` (Common)
- `#define KEY_N7 55` (Common)
- `#define KEY_N8 56` (Common)
- `#define KEY_M 77` (Common)
- `#define KEY_N 78` (Common)
- `#define KEY_O 79` (Common)
- `#define KEY_U 85` (Common)
- `#define clamp01(x) clamp(x, 0.0, 1.0)` (Common)
- `#define If(cond, resT, resF) mix(resF, resT, cond)` (Common)
- `#define SEED uvec4(0x5C995C6Du, 0x6A3C6A57u, 0xC65536CBu, 0x3563995Fu)` (Common)
- `#define KeyBoard iChannel1` (Buffer B)
- `#define VarTex iChannel3` (Buffer B)
- `#define OutCol outCol` (Buffer B)
- `#define OutChannel w` (Buffer B)
- `#define WriteVar(v, cx, cy) {if(uv.x == uint(cx) && uv.y == uint(cy)) OutCol.OutChannel = v;}` (Buffer B)
- `#define WriteVar4(v, cx, cy) {WriteVar(v.x, cx, cy) WriteVar(v.y, cx, cy + 1) WriteVar(v.z, cx, cy + 2) WriteVar(v.w, cx, cy + 3)}` (Buffer B)
- `#define GTVBAO_SLICE_SAMPLING_MODE 3` (Buffer C)
- `#define ACOS_QUALITY_MODE 2` (Buffer C)
- `#define USE_REFERENCE_DISTANT_LIGHT_SAMPLING` (Buffer C)
- `#define ACOS_QUALITY_MODE 3` (Buffer C)
- `#define GTVBAO_SLICE_SAMPLING_MODE 1` (Buffer C)
- `#define KeyBoard iChannel3` (Buffer C)
- `#define KeyBoardChannel w` (Buffer C)
- `#define VarTex iChannel3` (Buffer C)
- `#define OutCol outCol` (Buffer C)
- `#define OutChannel w` (Buffer C)
- `#define WriteVar(v, cx, cy) {if(uv.x == uint(cx) && uv.y == uint(cy)) OutCol.OutChannel = v;}` (Buffer C)
- `#define WriteVar4(v, cx, cy) {WriteVar(v.x, cx, cy) WriteVar(v.y, cx, cy + 1) WriteVar(v.z, cx, cy + 2) WriteVar(v.w, cx, cy + 3)}` (Buffer C)
- `#define KeyBoard iChannel3` (Buffer D)
- `#define KeyBoardChannel w` (Buffer D)
- `#define VarTex iChannel3` (Buffer D)
- `#define OutCol outCol` (Buffer D)
- `#define OutChannel w` (Buffer D)
- `#define WriteVar(v, cx, cy) {if(uv.x == uint(cx) && uv.y == uint(cy)) OutCol.OutChannel = v;}` (Buffer D)
- `#define WriteVar4(v, cx, cy) {WriteVar(v.x, cx, cy) WriteVar(v.y, cx, cy + 1) WriteVar(v.z, cx, cy + 2) WriteVar(v.w, cx, cy + 3)}` (Buffer D)

## Links found in code

- http://extremelearning.com.au/unreasonable-effectiveness-of-quasirandom-sequences/
- http://jcgt.org/published/0009/03/02/
- http://keycode.info/
- http://marc-b-reynolds.github.io/math/2016/03/29/weyl_hash.html
- http://unlicense.org/
- http://www.iryoku.com/next-generation-post-processing-in-call-of-duty-advanced-warfare
- http://www.jcgt.org/published/0009/04/01/
- https://arxiv.org/abs/2301.11376
- https://cdrinmatane.github.io/posts/cgspotlight-slides/
- https://cdrinmatane.github.io/posts/ssaovb-code/
- https://creativecommons.org/publicdomain/zero/1.0/
- https://github.com/Patapom/GodComplex/tree/master/Tests/TestHBIL
- https://github.com/TheRealMJP/BakingLab/blob/master/BakingLab/ACES.hlsl
- https://graphics.stanford.edu/%7Eseander/bithacks.html#CountBitsSetParallel
- https://issues.angleproject.org/issues/353039526
- https://nullprogram.com/blog/2018/07/31/
- https://probablydance.com/2018/06/16/fibonacci-hashing-the-optimization-that-the-world-forgot-or-a-better-alternative-to-integer-modulo/
- https://www.activision.com/cdn/research/Practical_Real_Time_Strategies_for_Accurate_Indirect_Occlusion_NEW%20VERSION_COLOR.pdf
- https://www.ams.org/journals/mcom/1999-68-225/S0025-5718-99-00996-5/S0025-5718-99-00996-5.pdf
- https://www.cs.hmc.edu/tr/hmc-cs-2014-0905.pdf
- https://www.shadertoy.com/view/3clGWB
- https://www.shadertoy.com/view/3lcczS
- https://www.shadertoy.com/view/3ldXzM
- https://www.shadertoy.com/view/4cdfzf
- https://www.shadertoy.com/view/4ctBRH
- https://www.shadertoy.com/view/XXGSDd
- https://www.shadertoy.com/view/Xc3yzs
- https://www.shadertoy.com/view/XcdBWf
- https://www.shadertoy.com/view/XfcBDl
- https://www.shadertoy.com/view/XlGcRh
- https://www.shadertoy.com/view/lctBzH
- https://www.shadertoy.com/view/lfdBWn
- https://www.shadertoy.com/view/wc2SzR
- https://www.shadertoy.com/view/wcBGRz
- https://www.shadertoy.com/view/wcfGWB
- https://www.shadertoy.com/view/wcsXDN
- https://x.com/Mirko_Salm/status/1949829873335259618
