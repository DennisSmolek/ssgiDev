# SSILVB Paper — Technical Notes

**Screen Space Indirect Lighting with Visibility Bitmask** — Olivier Therrien (CDRIN), Yannick Levesque (Cégep de Matane), Guillaume Gilet (Univ. of Sherbrooke). arXiv:2301.11376v2 (31 Jan 2023), accepted to The Visual Computer, DOI 10.1007/s00371-022-02703-y.

*These notes are transcribed directly from the paper PDF (`ssilvb-2301.11376.pdf`), pages 1–10.*

## Abstract (gist)

Horizon-based indirect illumination integrates the horizon angle difference between samples analytically, but cannot simulate light passing behind thin surfaces. The paper replaces the two horizon angles with a **bit field representing the binary state (occluded / un-occluded) of N sectors uniformly distributed around the hemisphere slice**. This lets light pass behind surfaces of constant thickness at horizon-method efficiency, and gives more accurate ambient lighting than bent normals by sampling more than one visibility cone. Demonstrated for AO, directional ambient occlusion, and indirect diffuse.

## Structure

1. **Introduction** — screen-space GI reduces dimensionality, cost constant vs scene complexity; SSR-style ray-march is noisy; HBIL/HBAO/GTAO integrate analytically but assume the depth buffer is a height-field with infinite thickness → halos and over-darkening on thin surfaces; falloff heuristics fail at large radius.
2. **Previous Work** — SSAO (Mittring 07), Alchemy/SAO, HBAO (Bavoil), GTAO (Jimenez et al. 16), LSAO (Timonen 13, shared-memory caching along azimuthal lines), HBIL (Mayaux 18), SSRTGI (noisy), Deep G-Buffers / Multi-layer SSRT / SDAO (multi-layer approaches — effective but expensive; they chose single layer + constant thickness instead), Bitmask Soft Shadows (Schwarz & Stamminger 07 — closest prior use of a visibility bit field, but for area-light visibility).
3. **Proposed Algorithm** — §3.1 AO, §3.2 Directionally Occluded Ambient, §3.3 Indirect Diffuse.
4. **Results and evaluation** — §4.1 AO, §4.2 ambient comparison, §4.3 indirect diffuse.
5. **Conclusion and future work.**

## §3.1 Core algorithm

AO as visibility integral (Eq. 1), decomposed into slices (Eq. 2) with per-slice inner integral (Eq. 3, the GTAO analytic form with horizons θ₁, θ₂). The proposal (Eq. 4): replace θ₁/θ₂ with a bit field of size N_b sectors uniformly distributed around the hemisphere slice, **centered on projected normal n**:

    AO₂(φᵢ) ≈ (1/N_b) · Σⱼ V(φᵢ, θⱼ)

Each depth sample is treated as local thin geometry of **constant thickness t**, occluding between angles θ_f (front — same angle GTAO uses) and θ_b (back — sample position pushed by thickness t). Sector activation uses the **hit criterion**: they chose the *round* criterion — a sector must be **at least half covered** by the (θ_f, θ_b) wedge to register. All occluded sectors are set at once → **O(1) in sector count**. Angles must be converted from cosine space to angular space for uniform sector distribution.

### Algorithm 1 (verbatim transcription)

```
 1: t ← constant thickness
 2: N_b ← bitmask size
 3: p ← view space fragment position
 4: n_p ← view space fragment normal
 5: r ← projected radius onto image plane
 6: Determine stepsize as r/(N_s + 1)
 7: Determine directions with random offset
 8: AO, GI ← 0
 9: for direction d_i where i = 0 to N_d do
10:   t_p ← slice plane tangent vector in direction d_i
11:   t_θ ← angle of t_p with XY-plane
12:   Bitmask b_i ← 0
13:   for step s_j where j = 0 to N_s do
14:     Front sample s_f ← view-space position at step j
15:     Back sample s_b ← s_f − (p/‖p‖)·t
16:     θ_f, θ_b ← angles of s_f and s_b on XY-plane
17:     θ_min, θ_max ← min(θ_f, θ_b), max(θ_f, θ_b)
18:     a, b ← ⌊((θ_min + π/2)/π)·N_b⌋ , ⌈((θ_max − θ_min)/π)·N_b⌉
19:     b_j ← (2^b − 1) ≪ a
20:     c_j ← direct lighting at step j (from GBuffer)
21:     n_j ← normal at step j (from GBuffer)
22:     l_j ← (s_j − p)/‖s_j − p‖
23:     GI ← GI + (COUNTBITS(b_j & ~b_i)/N_b) · c_j · (n_p·l_j) · (n_j·−l_j)
24:     b_i ← b_i | b_j
25:   end for
26:   AO ← AO + 1 − COUNTBITS(b_i)/N_b
27: end for
28: return AO/N_d , GI/N_d
```

Key line: **23** — `b_j & ~b_i` counts only *newly covered* sectors, i.e. how much of this sample is actually visible; a closer object that already claimed those sectors zeroes the contribution. Line 24 then ORs the sample in.

### Thickness t

- t → ∞ reproduces GTAO (no falloff). Ideal would be true per-pixel thickness — unknowable from a single depth layer.
- They use a **small constant**, optionally **increasing linearly with distance** (counteracts over-attenuation for far objects; causes slight occlusion change under camera motion, "barely noticeable").
- Rationale: over-occlusion around thin objects is much more noticeable than a light leak behind a thick one (big objects usually occlude completely behind themselves; a leak "can still look plausible").
- A per-sample thickness heuristic is **explicitly left as future work**.
- Table 2 benchmarks use **t = 0.2**. Figure 7 sweeps t = 1, 0.5, 0.25, 0.1 vs GTAO and ray-traced reference (radius 2).

## §3.2 Directionally Occluded Ambient Lighting

- Sampling ambient along the surface normal ignores directional occlusion; **screen-space bent normal** (Klehm et al. 11) points toward the largest un-occluded direction but is limited to a **single** ambient direction and doesn't handle thickness.
- Their method: divide the hemisphere (slice) into **as many subregions as ambient samples**; generate a sampling direction vector **at the center of each subregion**; sample the ambient source with that vector; **multiply the lighting intensity by (un-occluded sectors in that subregion / total sector count)** (Figure 8 shows 4 ambient samples per slice per pixel → 4 subregions).
- Result: ambient color varies smoothly with occlusion directionality; handles surfaces enclosed by thin geometry (bent normal misrepresents these); ambient samples weighted per-direction rather than averaged-then-multiplied by scalar AO ("if the ambient color had been simply averaged out and then multiplied by ambient occlusion, a lot of the color variation in the lighting would have been lost").
- Figure 12 compares G-Buffer normal vs bent normal vs visibility bitmask sampling.

## §3.3 Indirect Diffuse

- Per sample: count newly covered un-occluded sectors in O(1) → lighting contribution; set those sectors occluded in O(1) → handles partial/total occlusion of subsequent samples (Figure 9).
- Also samples the **HDR light buffer** (direct lighting only, with shadows) and the **screen-space normal buffer** per step; weights by n·l and n_l·−l and by covered-sector fraction.
- **32 sectors observed to give good quality** and fits one unsigned integer.
- **Multi-bounce**: inject the indirect illumination into the light buffer used as input next frame. **Warning (verbatim gist): "Light intensity needs to be properly balanced when using multi-bounce, or it can cause a feedback loop resulting in lighting accumulation over time."**
- Limitation: if direct light leaves the screen, indirect lighting disappears (definitional screen-space caveat).
- Samples are **distributed exponentially** around the shaded pixel (near surfaces matter more).
- **Banding**: evenly spaced samples band; **jitter samples along the sampling direction** (Figure 14).

## §4 Results

### Table 1 — AO sampling pass, 1920×1080, 32 sectors/slice, RTX 2080

| Radius | Sample count | GTAO | Visibility bitmask |
|---|---|---|---|
| 0.8 | 8 | 0.49 ms | 0.51 ms |
| 1 | 12 | 0.75 ms | 0.77 ms |
| 1 | 16 | 0.95 ms | 0.97 ms |
| 2 | 16 | 1.12 ms | 1.13 ms |
| 3 | 16 | 1.12 ms | 1.13 ms |

- Overhead ≈ **0.01–0.02 ms**, fixed ALU cost of **~15 GPU instructions per sample**; "increasing the radius masks this overhead as the execution becomes bandwidth-limited." Denoising pass constant 0.3 ms at 1080p (excluded from table).
- **Sector count**: 32 chosen because it "just crossed the threshold where the artifacts became almost invisible" and fits one uint; **128 sectors needs four uints + vector instructions, limiting compiler instruction packing → 5–10% overhead**. Too few sectors → banding around thin objects.
- Implemented **on top of Unity's GTAO** — θ₁/θ₂ swapped for a single bitmask (drop-in patch; Figure 10 Bistro comparisons vs ray-traced reference at radius 0.8–3).
- Figure 11: fence scene — GTAO traps light behind bars (over-occlusion + halos); bitmask lets light pass.

### Table 2 — Indirect diffuse, 1920×1080, thickness 0.2

| Configuration | Sampling | Denoising | Total |
|---|---|---|---|
| a) 8 samples, radius 1, const. steps, full res. | 0.9 ms | 0.33 ms | 1.23 ms |
| b) 8 samples, radius 4, const. steps, full res. | 1.7 ms | 0.33 ms | 2.03 ms |
| c) 16 samples, radius 4, const. steps, full res. | 2.3 ms | 0.33 ms | 2.63 ms |
| d) 16 samples, radius 4, exp. steps, full res. | 2.6 ms | 0.33 ms | 2.93 ms |
| e) 32 samples, radius 4, exp. steps, full res. | 4.0 ms | 0.33 ms | 4.33 ms |
| f) 16 samples, radius 4, exp. steps, half res. | 0.97 ms | 0.1 ms | 1.07 ms |

- **Half-res + classic bilateral upsample ≈ 4× faster** (2.93 → 1.07 ms) "but can introduce more flickering in the image and a blurrier result."
- **Bandwidth-intensive**: samples HDR light buffer + normal buffer per step at uncorrelated locations, impairing caching. Wider radius → sparser on-screen samples → more cache misses; execution time scales ~linearly with sample count.
- Figure 16: vs 2-rays-per-pixel SSR tracing at same max sample count — bitmask far less noisy (SSR does at most one accumulation per ray; bitmask accumulates every visible sample).

## §5 Conclusion / future work (as stated in the paper)

1. **Per-pixel thickness heuristic** — "would help the occlusion leaks around some very thin objects or light leaks behind very thick ones... a difficult problem we leave for future work."
2. **Bandwidth/caching** — "SSGI can be an expensive algorithm because it is very demanding on GPU bandwidth and utilizes the cache poorly. Using a caching method similar to LSAO could potentially improve this." **[TESTED 2026-07: negative for the literal reading, structural reading incompatible with bitmasks — see lsao-timonen2013-notes.md "EXPERIMENTAL OUTCOME" + bench lab 09. Modern alternatives listed there.]**
3. **Dynamic low-frequency ambient irradiance** — "the common ambient light sources are either static (constant color, light probes) or expensive to update at runtime. We might investigate in the future ways to approximate low-frequency ambient irradiance dynamically."

## Notable references for follow-up

- [JWPJ16] Jimenez et al. — GTAO (basis; multi-bounce AO approximation)
- [Tim13] Timonen — Line-Sweep Ambient Obscurance (the shared-memory caching idea cited as the bandwidth fix)
- [KRES11] Klehm et al. — screen-space bent normals (the §3.2 baseline being beaten)
- [SS07] Schwarz & Stamminger — Bitmask Soft Shadows (prior art for the bit-field visibility idea)
- [VSE21] SDAO — stochastic depth (the multi-layer alternative they rejected on cost)
- [May18] Mayaux — HBIL
