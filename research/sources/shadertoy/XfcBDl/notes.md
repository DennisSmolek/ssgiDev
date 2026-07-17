# GT-VBGI (uniformly weighted)

- **ID**: XfcBDl
- **Author**: TinyTexel
- **URL**: https://www.shadertoy.com/view/XfcBDl
- **Published**: 2024-12-07
- **Tags**: ao, occlusion, ambient, gtao, vbao
- **Source of capture**: [GabeRundlett/shadertoy-api-shaders](https://github.com/GabeRundlett/shadertoy-api-shaders) API dump (NOT live Shadertoy — snapshot may predate the latest revision; the live page was Cloudflare-blocked at gather time)

## Description (verbatim)

Optimized version of uniformly weighted GT-VBGI (https://www.shadertoy.com/view/lfdBWn).
No more acos calls.

Camera controls via mouse + shift key

## Files

- `image.glsl` (304 lines)
- `buffer-a.glsl` (185 lines)
- `common.glsl` (1418 lines)
- `buffer-b.glsl` (72 lines)
- `buffer-c.glsl` (564 lines)
- `buffer-d.glsl` (314 lines)

## Defines / tunables found in code

```glsl
#define KeyBoard iChannel3
#define KeyBoardChannel w
#define VarTex iChannel3
#define OutCol outCol
#define OutChannel w
#define KeyBoard iChannel1
#define WriteVar(v, cx, cy) {if(uv.x == uint(cx) && uv.y == uint(cy)) OutCol.OutChannel = v;}
#define WriteVar4(v, cx, cy) {WriteVar(v.x, cx, cy) WriteVar(v.y, cx, cy + 1) WriteVar(v.z, cx, cy + 2) WriteVar(v.w, cx, cy + 3)}
#define USE_TEMP_ACCU_COND                (ReadKeyToggle(KEY_TAB  ) != 0.0)
#define USE_PERSPECTIVE_CAM_COND          (ReadKeyToggle(KEY_CTRL ) == 0.0)
#define SHOW_UI_COND                      (ReadKeyToggle(KEY_U    ) == 0.0)
#define VAR_ROW 4
#define KEY_LEFT  37
#define KEY_UP    38
#define KEY_RIGHT 39
#define KEY_DOWN  40
#define KEY_TAB 9
#define KEY_CTRL 17
#define KEY_ALT 18
#define KEY_SHIFT 16
#define KEY_SPACE 32
#define KEY_Q 81
#define KEY_W 87
#define KEY_E 69
#define KEY_R 82
#define KEY_T 84
#define KEY_A 65
#define KEY_S 83
#define KEY_D 68
#define KEY_F 70
#define KEY_G 71
#define KEY_N1 49
#define KEY_N2 50
#define KEY_N3 51
#define KEY_N4 52
#define KEY_N5 53
#define KEY_N6 54
#define KEY_N7 55
#define KEY_N8 56
#define KEY_M 77
#define KEY_N 78
#define KEY_O 79
#define KEY_U 85
#define clamp01(x) clamp(x, 0.0, 1.0)
#define If(cond, resT, resF) mix(resF, resT, cond)
#define SEED uvec4(0x5C995C6Du, 0x6A3C6A57u, 0xC65536CBu, 0x3563995Fu)
```

## Discovered links (from code/description)

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
- https://twitter.com/Mirko_Salm/status/1865464707282243843
- https://www.activision.com/cdn/research/Practical_Real_Time_Strategies_for_Accurate_Indirect_Occlusion_NEW%20VERSION_COLOR.pdf
- https://www.ams.org/journals/mcom/1999-68-225/S0025-5718-99-00996-5/S0025-5718-99-00996-5.pdf
- https://www.cs.hmc.edu/tr/hmc-cs-2014-0905.pdf
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

## Update 2026-07-17 — refreshed from live Shadertoy

Captured directly from the live page via Chrome (`gShaderToy` editor state),
replacing the GabeRundlett archive snapshot. Per-pass result of the diff:

  - `image.glsl`: identical
  - `buffer-a.glsl`: identical
  - `common.glsl`: identical
  - `buffer-b.glsl`: identical
  - `buffer-c.glsl`: CHANGED (+7/-0 lines)
  - `buffer-d.glsl`: identical
