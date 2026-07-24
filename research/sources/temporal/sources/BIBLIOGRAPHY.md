# Consolidated bibliography — temporal/TAA + denoising

Grouped by topic. ✅ = fetched/verified verbatim this session; 🔎 = search-confirmed
title/venue; ⚠️ = flagged unverifiable (see notes). Code repos marked **[code]**.

## Cross-topic master reference
- Yang, Liu, Salvi — *A Survey of Temporal Antialiasing Techniques* — CGF 39(2),
  EG 2020 STAR, pp.607–621. ✅ https://onlinelibrary.wiley.com/doi/abs/10.1111/cgf.14018
  · PDF http://behindthepixels.io/assets/files/TemporalAA.pdf

## 01 — Variance clipping
- Salvi — *An Excursion in Temporal Supersampling* — GDC 2016. ✅
  https://developer.download.nvidia.com/gameworks/events/GDC2016/msalvi_temporal_supersampling.pdf
- Karis — *High-Quality Temporal Supersampling* — SIGGRAPH 2014.
  https://advances.realtimerendering.com/s2014/ · PPTX .../epic/TemporalAA.pptx
- Pedersen (Playdead) — *Temporal Reprojection AA in INSIDE* — GDC 2016. 🔎
  https://github.com/playdeadgames/publications/blob/master/INSIDE/GDC2016_Temporal_Reprojection_AA_INSIDE.pdf
- Jimenez — *Filmic SMAA* — SIGGRAPH 2016. ✅
  https://research.activision.com/publications/archives/filmic-smaasharp-morphological-and-temporal-antialiasing
- **[code]** playdeadgames/temporal — TemporalReprojection.shader (HLSL) ✅
  https://github.com/playdeadgames/temporal/blob/master/Assets/Shaders/TemporalReprojection.shader
- **[code]** Alex Tardif — TAA.html (HLSL) ✅ https://alextardif.com/TAA.html
- **[code]** bevy taa.wgsl (WGSL) ✅
  https://github.com/bevyengine/bevy/blob/v0.13.0/crates/bevy_core_pipeline/src/taa/taa.wgsl
- **[code]** Intel GameTechDev/TAA — TAAResolve.hlsl
  https://github.com/GameTechDev/TAA/blob/main/MiniEngine/Core/Shaders/TAAResolve.hlsl

## 02 — Disocclusion / history rejection
- Schied et al. — *SVGF* — HPG 2017 (eqs 3–5 verbatim). ✅
  https://cg.ivd.kit.edu/publications/2017/svgf/svgf_preprint.pdf · https://cg.ivd.kit.edu/english/svgf.php
- FSR2 technique manual — GPUOpen.
  https://gpuopen.com/manuals/fidelityfx_sdk/techniques/super-resolution-temporal/
- UE5 TSR — Epic.
  https://dev.epicgames.com/documentation/en-us/unreal-engine/temporal-super-resolution-in-unreal-engine
- **[code]** FSR2 ffx_fsr2_depth_clip.h (HLSL) ✅
  https://github.com/GPUOpen-Effects/FidelityFX-FSR2/blob/master/src/ffx-fsr2-api/shaders/ffx_fsr2_depth_clip.h
- **[code]** FSR2 ffx_fsr2_reproject.h (HLSL) ✅ .../ffx_fsr2_reproject.h
- **[code]** FSR2→OpenGL port https://github.com/JuanDiegoMontoya/FidelityFX-FSR2-OpenGL
- **[code]** TheVaffel/spatiotemporal-variance-guided-filtering (GLSL)
  https://github.com/TheVaffel/spatiotemporal-variance-guided-filtering

## 03 — Spatiotemporal blue noise
- Wolfe, Morrical, Akenine-Möller, Ramamoorthi — *Spatiotemporal Blue Noise Masks*
  — EGSR 2022. https://research.nvidia.com/publication/2022-07_spatiotemporal-blue-noise-masks
  · PDF https://cseweb.ucsd.edu/~ravir/stbn.pdf · arXiv https://arxiv.org/abs/2112.09629
- NVIDIA blog Part 1/2 — https://developer.nvidia.com/blog/rendering-in-real-time-with-spatiotemporal-blue-noise-textures-part-1
- Peters — *The problem with 3D blue noise* — https://momentsingraphics.de/3DBlueNoise.html
- Georgiev & Fajardo — *Blue-noise Dithered Sampling* — SIGGRAPH 2016 Talks.
  https://www.arnoldrenderer.com/research/dither_abstract.pdf
- Roberts — *Unreasonable Effectiveness of Quasirandom Sequences* (R1/R2).
  https://extremelearning.com.au/unreasonable-effectiveness-of-quasirandom-sequences/
- Heitz & Belcour — EGSR 2019.
  https://belcour.github.io/blog/research/publication/2019/06/18/animation-bluenoise.html
- **[code]** NVIDIA-RTX/STBN (textures at Assets/STBN.zip; old repo redirects) ✅
  https://github.com/NVIDIA-RTX/STBN
- **[code]** bartwronski/BlueNoiseGenerator · joshbainbridge/blue-noise-generator
- Demofox — *Thresholding Modern Blue Noise Textures* (2025)
  https://blog.demofox.org/2025/05/27/thresholding-modern-blue-noise-textures/

## 04 — History resampling
- Karis 2014 (above) · Jimenez 2016 (above) ·
  CoD *Dynamic Temporal AA and Upsampling*
  https://www.activision.com/cdn/research/Dynamic_Temporal_Antialiasing_and_Upsampling_in_Call_of_Duty_v4.pdf
- vec3.ca — *Bicubic Filtering in Fewer Taps* — http://vec3.ca/bicubic-filtering-in-fewer-taps/
- **[code]** TheRealMJP SampleTextureCatmullRom gist (HLSL) ✅
  https://gist.github.com/TheRealMJP/c83b8c0f46b63f3a88a5986f4fa982b1
- **[code]** bevy taa.wgsl (5-tap) · TheRealMJP/MSAAFilter Resolve.hlsl

## 05 — Velocity dilation
- Karis 2014 · Jimenez 2016 · CoD paper (above)
- FSR2 manual "Reconstruct & dilate" (above) · GDC 2022 FSR 2.0
  https://gpuopen.com/download/GDC_FidelityFX_Super_Resolution_2_0.pdf
- **[code]** ⚠️ FSR2 ffx_fsr2_reconstruct_previous_depth.h (body unretrievable this session)
  https://github.com/GPUOpen-Effects/FidelityFX-FSR2/blob/master/src/ffx-fsr2-api/shaders/ffx_fsr2_reconstruct_previous_depth.h

## 06 — HDR / firefly
- Karis — *Tone mapping* (Graphic Rants, 2013) http://graphicrants.blogspot.com/2013/12/tone-mapping.html
- Lottes (AMD) — *Optimized Reversible Tonemapper for Resolve* ✅
  https://gpuopen.com/learn/optimized-reversible-tonemapper-for-resolve/
- **[code]** bevy taa.wgsl · Alex Tardif TAA.html · gkjohnson/three-gpu-pathtracer
  https://github.com/gkjohnson/three-gpu-pathtracer

## 07 — A-SVGF
- Schied, Peters, Dachsbacher — *Gradient Estimation for Real-Time Adaptive Temporal
  Filtering* — HPG 2018. DOI https://doi.org/10.1145/3233301 · https://momentsingraphics.de/HPG2018.html
- **[code]** NVIDIA/Q2RTX asvgf.glsl / asvgf_gradient_img.comp / asvgf_temporal.comp
  https://github.com/NVIDIA/Q2RTX/tree/master/src/refresh/vkpt/shader
- **[code]** paper shaders https://momentsingraphics.de/Media/HPG2018/Schied2018-AdaptiveTemporalFilteringCode.zip

## 08 — Upscaling rectification
- FSR2 manual · FSR3.1 upscaler manual
  https://gpuopen.com/manuals/fidelityfx_sdk/techniques/super-resolution-upscaler/
- GDC 2022 FSR 2.0 · AMD FSR3 https://gpuopen.com/fidelityfx-super-resolution-3/
- AMD FSR Redstone https://gpuopen.com/learn/amd-fsr-redstone-developers-neural-rendering/
- FSR SDK 2.3 https://gpuopen.com/learn/amd-fsr-sdk-2-3-blog/
- Intel XeSS (GDC 2022) https://www.techspot.com/news/93921-intel-gdc-presentation-sheds-more-light-xess-upscaler.html
- **[code]** FSR2 ffx_fsr2_accumulate.h ✅ · ffx_fsr2_lock.h ✅ · ffx_fsr2.h
- **[code]** FidelityFX-SDK (FSR3.1) https://github.com/GPUOpen-LibrariesAndSDKs/FidelityFX-SDK
- **[code]** intel/xess https://github.com/intel/xess (headers/samples only)

## 09 — Perceptual thresholds
- de Lange 1958 https://opg.optica.org/josa/abstract.cfm?uri=josa-48-11-777 ✅
- Kelly 1979 ⚠️ (DOI 10.1364/JOSA.69.001340) · Watson WoV 1986
  https://opg.optica.org/josaa/abstract.cfm?uri=josaa-3-3-300
- stelaCSF (Mantiuk 2022) https://dl.acm.org/doi/10.1145/3528223.3530115
- castleCSF (2024) https://jov.arvojournals.org/article.aspx?articleid=2793530
- elaTCSF (SIGGRAPH Asia 2024) ✅ https://arxiv.org/abs/2503.16759
- Ferry–Porter beyond, Vision 2023 https://www.mdpi.com/2411-5150/7/1/26
- Denes TRM 2019 ✅ https://www.cl.cam.ac.uk/~rkm38/pdfs/denes2019trm.pdf
- VESA Adaptive-Sync CTS r1.0 https://vesa.org/wp-content/uploads/2022/05/Adaptive-Sync-Display-CTS-r1.0.pdf
- López — *TAA and the Quest for the Holy Trail* https://www.elopezr.com/temporal-aa-and-the-quest-for-the-holy-trail/

## 10 — Test scenes + metrics
- Yang survey (above) · k-DOP Clipping SIGGRAPH Asia 2024 https://dl.acm.org/doi/10.1145/3681758.3697996
- ꟻLIP — Andersson et al. HPG 2020 https://dl.acm.org/doi/10.1145/3406183
- TecoGAN (tOF) https://arxiv.org/abs/1811.09393
- **[code]** NVlabs/flip https://github.com/NVlabs/flip · gfxdisp/FovVideoVDP
  https://github.com/gfxdisp/FovVideoVDP · thunil/TecoGAN

## 11 — Denoising
- Dammertz et al. — *Edge-Avoiding À-Trous* — HPG 2010 ✅ https://jo.dreggn.org/home/2010_atrous.pdf
- SVGF / A-SVGF (above) · ReSTIR DI (Bitterli 2020)
  https://cs.dartmouth.edu/~wjarosz/publications/bitterli20spatiotemporal.html
- OIDN https://www.openimagedenoise.org/ · 2.0 backends https://www.phoronix.com/news/Open-Image-Denoise-2.0
- DLSS 3.5 RR https://www.nvidia.com/en-us/geforce/news/nvidia-dlss-3-5-ray-reconstruction/
- AMD neural SS+denoise https://gpuopen.com/learn/neural_supersampling_and_denoising_for_real-time_path_tracing/
- Fan 2021 KPN https://arxiv.org/pdf/2202.05977
- **[code]** DennisSmolek/Denoiser ✅ https://github.com/DennisSmolek/Denoiser
- **[code]** C-none/Web-RTRT ✅ https://github.com/C-none/Web-RTRT
- **[code]** NVIDIA-RTX/NRD (MIT) https://github.com/NVIDIA-RTX/NRD
- **[code]** loupiote · gnikoloff/webgpu-raytracer · JamesRandall/webgpu-doom-pathtracer
  · pissang/oidn-web · Vulkemp/foray-denoiser-asvgf · ZheyuanXie/CUDA-Path-Tracer-Denoising
