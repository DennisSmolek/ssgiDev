# 11 — Real-time denoising direction for WebGPU (NEW)

**Why this topic:** the bench has tried several denoisers (incl. a mini neural one),
has an **OIDN port that's very slow on WebGPU**, and a **good SVGF that's only fast
enough when it feeds the FSR3-ported upscaler**. Question: where to invest.

> ⚠️ **Finding worth flagging first (Dennis):** the "OIDN port is very slow"
> premise looks out of date relative to the current state of your own
> **`DennisSmolek/Denoiser`** repo. Its README describes a rewrite from
> TensorFlow.js to **WebGPU + onnxruntime-web** with a stateless API and a
> **zero-copy GPU pipeline** (ONNX U-Net on the WebGPU EP, all pre/post as WGSL
> compute on the same `GPUDevice`, models built directly from OIDN `.tza` weights,
> fp16). Reported: **512² ≈ 14 ms, 1080p ≈ 104 ms warm (fp16, M-series)** — "fast
> enough to denoise progressively while a path tracer accumulates." That's viable
> as a **settle/progressive** denoiser (camera stops → converge), just not a
> per-frame 60 fps/1080p filter. This changes the calculus: you may already have
> solved more of the OIDN-speed problem than the brief assumes.

---

## The landscape (roughly by GPU cost)

1. **À-trous / edge-avoiding wavelet (Dammertz 2010)** — the cheap primitive. A
   hierarchical cross-bilateral filter with an à-trous B3-spline kernel, edge-
   stopping on color+normal+depth. 5 iterations = 80×80 effective footprint; **cost
   is data-independent and tiny** (sub-ms to low-single-digit ms on modern HW/WGSL).
   This is the literal spatial core of SVGF and your cheapest fallback.

2. **SVGF (2017) / A-SVGF (2018)** — SVGF = temporal reprojection/accumulation (raise
   effective spp) + per-pixel **luminance-variance** estimate driving the à-trous
   edge-stopping (blur more where noisy, preserve where confident). ~1 spp → stable
   1080p in ~10 ms. A-SVGF adds gradient-based adaptive α to kill ghosting/lag
   (see topic 07). **This is the standard real-time baseline and what you have.**

3. **NVIDIA NRD (ReBLUR, RELAX, SIGMA)** — production, **open-source (MIT)**,
   spatio-temporal, low-rpp. **RELAX is explicitly SVGF-derived** (adds fast-history
   clamping to minimize lag; tuned for ReSTIR/RTXDI). ReBLUR = spatio-temporal
   accumulation blur, strong at very low spp. SIGMA = shadows. Full HLSL/compute
   source public — the best reference for a "better SVGF."

4. **Neural denoisers**
   - **Intel OIDN** — a comparatively **large conv U-Net** autoencoder (color +
     optional albedo/normal). Quality-first, not latency-first. Slow on WebGPU
     because: big U-Net with many channels, **no tensor-core/DP4a acceleration via
     WebGPU**, and it's **memory-bandwidth-bound** (large feature maps through a
     modest WGSL matmul path). OIDN 2.x added native GPU backends — SYCL (2.0),
     CUDA/HIP (2.0), **Metal (2.2)** — but **none are reachable from a browser**.
     No official "OIDN-lite," though it ships smaller "fast/balanced" weight sets.
   - **DLSS Ray Reconstruction** (3.5 CNN → 4.x transformer) — unifies denoise +
     upscale in one trained net; **tensor-core-locked, not portable**. Direction
     signal only.
   - **Lightweight neural** — kernel-prediction networks (KPCN; Fan 2021 weight-
     sharing KPN), compact-MLP denoisers, mobile MLP+LUT. Realistic "small neural"
     middle ground, but still assume efficient matmul WebGPU lacks.

5. **Temporal upscalers as denoisers (your current strategy)** — FSR2/FSR3 / TAAU
   temporal accumulation *is* a denoiser: it raises effective spp over frames and
   low-pass-filters residual noise in time. Your "SVGF just enough, then let FSR3's
   accumulation finish it" is **well-founded and mainstream** — it's exactly what
   c-none's Web-RTRT does (SVGF+RELAX → FSR2) and conceptually what NRD+DLSS
   pipelines do.

6. **ReSTIR (variance reduction *before* denoise)** — not a denoiser; importance
   resampling that spatio-temporally reuses reservoirs to feed the denoiser a much
   lower-variance 1-spp signal (6×–60× equal-error sampling speedup). **Reducing
   input variance is often higher ROI than a fancier denoiser.** Ideal architecture:
   **ReSTIR → cheap SVGF/à-trous → temporal upscaler accumulation.**

---

## Recommendation framework (WebGPU, no tensor cores)

Constraints that dominate: WebGPU exposes no tensor cores / cooperative-matrix;
big conv U-Nets are bandwidth-bound and miss per-frame budgets at 1080p; but
temporal accumulation (SVGF history + FSR3) is cheap and already in the pipeline.

**Ranked options:**

1. **Double down on SVGF → FSR3 (your current path). Best default.** Industry-
   standard architecture. Improvements *before* changing direction:
   - Adopt **A-SVGF gradient-adaptive α** (topic 07) to cut ghosting/lag → run
     *fewer* à-trous iterations (cheaper) at equal stability.
   - Put **ReSTIR (DI at minimum, GI if affordable) upstream** — usually a bigger
     win than a better filter; directly reduces how hard SVGF/FSR3 must work.
   - Use a **tCSF budget (topic 09 / elaTCSF)** to allow more residual noise in
     high-spatial-frequency/masked regions and spend filter budget on smooth,
     high-luminance, peripheral regions where flicker is visible. *(This is where
     topics 09 and 11 meet.)*
   - Inherent tradeoff: FSR3 accumulation is temporal — fails on disocclusion/fast
     motion; needs solid MVs + rectification. Not a defect of the choice.

2. **Cheap à-trous (Dammertz) as pre-pass / fallback** — for the essentially-free,
   data-independent case: first-frame / disocclusion fallback where temporal
   history is invalid. Keep it in the toolbox regardless (sub-ms class).

3. **OIDN-on-WebGPU as a "settle"/progressive denoiser, not per-frame** — given your
   repo's rewrite (~104 ms/1080p warm fp16, zero-copy), OIDN is now viable for still
   frames / when the camera stops, running progressively while the tracer converges.
   Legitimate hybrid: **SVGF+FSR3 in motion, OIDN U-Net on settle.** Guided
   (albedo+normal) model for quality, fp16, tile >1080p. Tradeoff: two denoisers to
   maintain; OIDN latency precludes real-time.

4. **Small/lightweight neural (KPCN / compact-MLP)** — only if you accept training +
   the WebGPU matmul ceiling. **Lower ROI than 1–3 on a no-tensor-core target** —
   same bandwidth wall as OIDN, less mature weights. Revisit if/when WebGPU exposes
   **cooperative-matrix / subgroup-matmul** (on the standards track) — that single
   capability is what would make in-browser neural denoising competitive.

5. **DLSS-RR-style unified neural denoise+upscale** — aspirational; tensor-core-
   locked, not portable. North star that validates the "let the upscaler denoise"
   instinct.

**Bottom line:** keep SVGF→FSR3 as the real-time spine; upgrade it with A-SVGF
adaptive accumulation and ReSTIR upstream; keep Dammertz à-trous as the cheap
disocclusion fallback; repurpose the (now much faster) WebGPU OIDN port as a
settle-time quality pass rather than forcing a U-Net into frame budget; treat small
neural denoisers as effectively blocked on WebGPU matmul acceleration.

---

## Primary sources

- **Edge-Avoiding À-Trous Wavelet Transform for Fast GI Filtering** — Dammertz,
  Sewtz, Hanika, Lensch, HPG 2010 (full paper incl. GLSL shader).
  https://jo.dreggn.org/home/2010_atrous.pdf ✅ fetched.
- **SVGF** — Schied et al., HPG 2017.
  https://cg.ivd.kit.edu/english/svgf.php ·
  https://cg.ivd.kit.edu/publications/2017/svgf/svgf_preprint.pdf
- **A-SVGF** — Schied et al., HPG 2018. https://cg.ivd.kit.edu/english/atf.php ·
  https://cg.ivd.kit.edu/publications/2018/adaptive_temporal_filtering/adaptive_temporal_filtering.pdf
- **ReSTIR DI** — Bitterli et al., SIGGRAPH 2020.
  https://cs.dartmouth.edu/~wjarosz/publications/bitterli20spatiotemporal.html
- **Intel OIDN** — https://www.openimagedenoise.org/ ·
  2.0 GPU backends: https://www.phoronix.com/news/Open-Image-Denoise-2.0
- **DLSS 3.5 Ray Reconstruction** —
  https://www.nvidia.com/en-us/geforce/news/nvidia-dlss-3-5-ray-reconstruction/
- **AMD neural supersampling + denoising** —
  https://gpuopen.com/learn/neural_supersampling_and_denoising_for_real-time_path_tracing/
- **Fan et al. 2021, weight-sharing KPN** — https://arxiv.org/pdf/2202.05977

## Code / implementations

**WebGPU / WGSL (most relevant to the target):**
- **DennisSmolek/Denoiser** ⭐ (yours) — OIDN U-Nets via **ONNX on WebGPU EP**, WGSL
  pre/post, zero-copy three.js WebGPU interop, `.tza`→ONNX (fp16/fp32).
  https://github.com/DennisSmolek/Denoiser (demo: webgpu-basic.vercel.app) ✅ README fetched.
- **C-none/Web-RTRT** ⭐ — WGSL: **ReSTIR DI+GI → SVGF+RELAX → FSR2 upscaler**;
  closest public analog to your exact stack.
  https://github.com/C-none/Web-RTRT · blog https://c-none.github.io/ray-tracing-on-WebGPU/
- **DavidPeicho/loupiote** (Rust/WebGPU path tracer w/ SVGF).
  https://github.com/DavidPeicho/loupiote
- **gnikoloff/webgpu-raytracer** (WGSL, temporal accumulation).
  https://github.com/gnikoloff/webgpu-raytracer
- **JamesRandall/webgpu-doom-pathtracer** (TS/WGSL, temporal reproj + spatial
  denoise, ~2.5k LOC compact reference).
  https://github.com/JamesRandall/webgpu-doom-pathtracer
- **pissang/oidn-web** (OIDN via TFJS on WebGPU backend, tiled, GPU-buffer I/O).
  https://github.com/pissang/oidn-web
- **gkjohnson/three-gpu-pathtracer** (GLSL/WebGL2; the tracer your Denoiser demo
  integrated with). https://github.com/gkjohnson/three-gpu-pathtracer

**Reference (native, for porting/tuning):**
- **NVIDIA-RTX/NRD** (HLSL, MIT) — ReBLUR, RELAX (SVGF-derived), SIGMA.
  https://github.com/NVIDIA-RTX/NRD · sample https://github.com/NVIDIA-RTX/NRD-Sample
- **foray-denoiser-asvgf** (Vulkan A-SVGF port).
  https://github.com/Vulkemp/foray-denoiser-asvgf
- **ZheyuanXie/CUDA-Path-Tracer-Denoising** (readable SVGF).
  https://github.com/ZheyuanXie/CUDA-Path-Tracer-Denoising
- **RenderKit/oidn** — https://github.com/RenderKit/oidn

## Confidence

Verified: NRD repo, Dammertz full paper+GLSL, c-none WebGPU stack, your
DennisSmolek/Denoiser rewrite + perf numbers, SVGF KIT page. Search-confirmed:
SVGF/A-SVGF papers, OIDN 2.x backend timeline, ReSTIR, DLSS-RR, the other WebGPU
repos, Fan 2021 KPN. **Inferred:** exact SVGF "10 ms/1080p" and A-SVGF "9×–166×
MSE" are the papers' own abstract figures; the recommendation ranking is synthesis.
No head-to-head WebGPU denoiser benchmark on identical hardware was found — a real
gap worth closing on the bench itself.
