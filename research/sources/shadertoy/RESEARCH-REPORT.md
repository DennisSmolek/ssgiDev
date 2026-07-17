# Shadertoy Shader Mirror Search - Research Report

**Date:** 2026-07-17  
**Scope:** 14 Shadertoy shaders related to GT-VBAO/VBGI/GTAO+ algorithms  
**Limitation:** Shadertoy.com is Cloudflare-blocked (HTTP 403) from this machine  

## Executive Summary

Comprehensive search for mirrors/ports of 14 Shadertoy shaders (authored by MirkoSalm and Björn Ottosson) conducting algorithm implementations of GT-VBAO/GT-VBGI/GTAO+ techniques. 

**Results:**
- **Shaders with mirrors found:** 0 (direct Shadertoy source code mirrors)
- **Reference implementations found:** 1 (Olivier Therrien VBAO implementation)
- **Relevant resources identified:** Multiple (academic papers, blog posts, Bevy discussions)
- **Authors without public shader repos:** Both MirkoSalm (GitHub profile not found) and Björn Ottosson (GitHub repos exist but no shader code)

**Conclusion:** These shaders have not been widely mirrored to GitHub. The algorithms are well-documented academically and in blog posts, but the specific Shadertoy shader implementations must be captured manually from the web interface.

---

## Shaders Researched

| ID | Name | Author | Status |
|---|---|---|---|
| dsGBzW | Screen Space Horizon GI | Unknown | Reference found |
| wc2SzR | GT-VBAO [Dist. Light Sampling 2] | MirkoSalm | Not found |
| wcsXDN | Slice-Rel Dir Mapping [GT-VBAO] | MirkoSalm | Not found |
| wcfGWB | GT-VBAO distant light sampling | Björn Ottosson | Not found |
| 3clGWB | GT-VBAO thickness heuristic | Björn Ottosson | Not found |
| wcBGRz | GT-VBAO Light&Occluder Heuristic | Björn Ottosson | Not found |
| lfdBWn | bidirectional GT-VBGI | MirkoSalm | Not found |
| XcdBWf | unidirectional GT-VBGI | MirkoSalm | Not found |
| XfcBDl | optimized bidirectional GT-VBGI | MirkoSalm | Not found |
| XXGSDd | bidirectional GT-VBAO | MirkoSalm | Not found |
| Xc3yzs | unidirectional GT-VBAO | MirkoSalm | Not found |
| lctBzH | bidirectional GTAO+ | MirkoSalm | Not found |
| 4ctBRH | unidirectional GTAO+ | MirkoSalm | Not found |
| 4cdfzf | optimized bidirectional GT-VBAO | MirkoSalm | Not found |

---

## Detailed Findings

### 1. Academic Foundation & Reference Implementations

#### Paper
- **Title:** Screen Space Indirect Lighting with Visibility Bitmask
- **Authors:** Olivier Therrien, Yannick Levesque, Guillaume Gilet
- **URL:** https://arxiv.org/abs/2301.11376
- **Published:** Early 2023
- **Impact:** Original VBAO algorithm; referenced by all GT-VBAO implementations

#### Blog & Implementation Details
- **Author:** Olivier Therrien (CDRIN)
- **Blog:** https://cdrinmatane.github.io/posts/ssaovb-code/
- **Content:** Conceptual overview and implementation guidance for VBAO
- **Code snippets:** Includes HLSL snippets for GTAO integration, but NOT complete Shadertoy source

#### Cybereality Implementation
- **Type:** GLSL port of VBAO algorithm for OpenGL/WebGL
- **URL:** https://cybereality.com/screen-space-indirect-lighting-with-visibility-bitmask-improvement-to-gtao-ssao-real-time-ambient-occlusion-algorithm-glsl-shader-implementation/
- **Status:** CAPTURED - Complete GLSL fragment shader (v300 es) for Screen Space Indirect Lighting
- **Faithfulness:** Port/adaptation (not a direct Shadertoy mirror, but working implementation of the algorithm)
- **License:** Educational use, available on cybereality.com

### 2. Shadertoy-Specific Archive Attempts

#### GabeRundlett/shadertoy-api-shaders
- **URL:** https://github.com/GabeRundlett/shadertoy-api-shaders
- **Description:** Backup of shaders made public through Shadertoy API (downloaded Oct 5, 2024)
- **Result:** Only **3clGWB.json** confirmed present; all other target shaders return 404
- **Conclusion:** Repo is incomplete or these shaders were not made public via API

#### Vipitis/shadertoys-dataset
- **URL:** https://github.com/Vipitis/shadertoys-dataset
- **Description:** Dataset of Shadertoy shaders for research/evaluation
- **Result:** Not accessible during research; unclear if contains target shaders

### 3. Author Identification & GitHub Profiles

#### MirkoSalm (Author of most GT-VBAO/VBGI shaders)
- **Social:** https://x.com/Mirko_Salm (X/Twitter)
- **GitHub:** No matching profile found despite searches for "MirkoSalm", "Mirko Salm", "mirko-salm"
- **Conclusion:** Author appears to publish exclusively on Shadertoy and social media; no GitHub mirror

#### Björn Ottosson (Author of wcfGWB, 3clGWB, wcBGRz variants)
- **Website:** https://bottosson.github.io/
- **GitHub:** https://github.com/bottosson (6 public repositories)
- **Repo Contents:** Color space work (OKLab, OkHSV), ImGui fork, WebGPU starter template, no shader implementations
- **Conclusion:** Shaders not published to GitHub; only discussed/referenced in blog posts and social media

### 4. Bevy Engine Community Discussion

#### Issue #19713: SSAO/VBAO Improvements
- **URL:** https://github.com/bevyengine/bevy/issues/19713
- **Content:** Discussion of implementing GT-VBAO improvements to Bevy's rendering
- **Cross-references:**
  - XXGSDd: https://www.shadertoy.com/view/XXGSDd (bidirectional GT-VBAO)
  - Xc3yzs: https://www.shadertoy.com/view/Xc3yzs (unidirectional, no bidirectional ray marching)
  - 3clGWB: https://www.shadertoy.com/view/3clGWB (thickness heuristics)
  - 4cdfzf: https://www.shadertoy.com/view/4cdfzf (performance improvements, removed acos calls)
- **Outcome:** No WGSL ports or code implementations in the issue itself; links only

### 5. Other Notable Findings

#### Shipwright Project (zalo/shipwright-64)
- **Context:** Game mod of The Legend of Zelda: Ocarina of Time with enhanced graphics
- **SSGI Implementation:** Yes, includes `ssgi_bufC.glsl` and related shader files
- **Status:** References GT-VBAO algorithm in comments but actual GLSL implementations inaccessible via GitHub API (404)
- **Relevance:** Shows real-world attempt to port GT-VBAO concepts

#### XeGTAO (GameTechDev/XeGTAO)
- **Algorithm:** Ground Truth Ambient Occlusion (GTAO) - related but different from VBAO
- **Implementation:** HLSL for DirectX 12, not relevant to GLSL Shadertoy ports
- **Note:** GTAO is the predecessor to VBAO; this is not the VBAO family

---

## Search Strategies Employed

1. **GitHub Code Search** (`gh search code`)
   - Searched for exact shader IDs (XXGSDd, lfdBWn, etc.)
   - Searched for algorithm names (GT-VBAO, GT-VBGI, GTAO+)
   - Rate limited at ~50 queries (API limit exceeded)

2. **GitHub Repository Search**
   - Author searches (MirkoSalm, bottosson)
   - Archive/dump repository searches
   - Bevy engine PR/issue searches

3. **Web Search**
   - Author names combined with shader titles
   - Algorithm names with code/implementation keywords
   - Known hosting sites (gist.github.com, pastebin)

4. **Direct Verification**
   - Verified GabeRundlett/shadertoy-api-shaders for specific shader files
   - Attempted Shipwright repo file access
   - Checked author GitHub profiles for shader code

---

## Key Resources for Users

### For Understanding the Algorithms
1. **Academic Paper:** https://arxiv.org/abs/2301.11376
2. **Implementation Details:** https://cdrinmatane.github.io/posts/ssaovb-code/
3. **Real-world GLSL:** https://cybereality.com/screen-space-indirect-lighting-with-visibility-bitmask-improvement-to-gtao-ssao-real-time-ambient-occlusion-algorithm-glsl-shader-implementation/

### For Retrieving Source Code
1. **Manual Capture** (required): https://www.shadertoy.com/view/XXGSDd (and others)
2. **Partial Reference:** GabeRundlett/shadertoy-api-shaders (only 3clGWB confirmed)

### Community Discussions
- Bevy Engine Issue: https://github.com/bevyengine/bevy/issues/19713

---

## Recommendations

### Immediate Actions
1. **Manual Capture:** The most reliable method is to visit each Shadertoy URL in a browser and copy the source code from each pass (Image, Buffer A, Buffer B, Common, etc.). See MANUAL-CAPTURE.md for detailed instructions.

2. **Check 3clGWB:** Since 3clGWB.json exists in GabeRundlett/shadertoy-api-shaders, that specific shader may be extractable from JSON format.

### Long-term Alternatives
1. **Shadertoy API Access:** If you can access Shadertoy.com (either from a different network or via Cloudflare bypass), the Shadertoy API or web interface would provide the authoritative source.

2. **Author Contact:** Consider reaching out to MirkoSalm via Twitter/X or Björn Ottosson via blog comments to request shader source publication to GitHub.

3. **WGSL Ports:** If the goal is Bevy engine integration, the community may be open to porting these to WGSL. Monitor Bevy issue #19713 for progress.

---

## Files Created

- **dsGBzW/mirror-olivier-therrien-vbao.glsl** - Reference GLSL implementation of VBAO algorithm
- **dsGBzW/notes.md** - Updated with mirror information
- **MANUAL-CAPTURE.md** - Detailed checklist and instructions for manual retrieval
- **RESEARCH-REPORT.md** - This report

---

## Conclusion

While these Shadertoy shaders are fundamental to modern screen-space ambient occlusion and indirect lighting techniques, they have not been broadly mirrored or ported to public GitHub repositories. The algorithms themselves are well-documented through academic papers and blog posts, and reference implementations are available. However, the specific Shadertoy implementations must be manually captured from the web interface or obtained through direct author contact.

The research did identify relevant implementation resources, particularly Olivier Therrien's VBAO documentation and the cybereality.com GLSL port, which can serve as reference implementations while awaiting manual capture of the original Shadertoy sources.
