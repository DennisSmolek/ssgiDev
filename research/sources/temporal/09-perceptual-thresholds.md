# 09 — Perceptual thresholds for temporal noise (LOW, high leverage)

**Bench decision this feeds:** HUMAN-TESTS.md verdicts are currently subjective; a
perceptual threshold would let the recorded churn metric predict the human verdict
— closing the metric-vs-eye gap that started this program.

---

## Summary

The question "what residual frame-to-frame fluctuation is perceptually invisible?"
maps onto ~70 years of temporal vision science.

- **Temporal contrast sensitivity function (tCSF) / de Lange curves.** De Lange
  (1958) measured vision as a linear filter (modulation depth at threshold vs
  temporal frequency). Photopic tCSF is **band-pass** (peak ~8–15 Hz, falling off
  toward DC and high freq); at low luminance it becomes **low-pass**. Residual
  noise is invisible when its temporal-frequency content, at its contrast, falls
  **below** the tCSF.
- **Critical Flicker Frequency (CFF)** = the high-frequency zero of the tCSF. Not
  a single number.
- **Ferry–Porter law**: CFF rises **linearly with log retinal illuminance**,
  ~10–20 Hz/decade. ~20–30 Hz dim, >60–90 Hz at high luminance/periphery. Recent
  work (Vision 2023) shows peripheral high-luminance CFF exceeds the classic
  linear extrapolation (~90+ Hz) — relevant to bright HDR displays.
- **Spatial frequency (Kelly's spatiotemporal CSF, 1979)**: temporal sensitivity
  is highest at **low spatial frequencies**. So flat, low-frequency regions (large
  diffuse GI areas) are where residual shimmer is *most* detectable; high-frequency
  texture masks it.
- **Eccentricity**: the periphery is *more* flicker-sensitive (higher CFF) despite
  worse spatial detail. Full-screen noise is judged by the most sensitive region,
  often peripheral for a large FOV.
- **Refresh rate / fps — Watson's Window of Visibility**: a sampled display creates
  spectral replicas at multiples of the frame rate; artifacts are invisible only if
  replicas fall outside the spatiotemporal window. Higher fps pushes replicas out.
  This is the rigorous bridge from "fps" to "perceptually clean."

## Is there a defensible numeric JND threshold?

Qualified yes — but it's a **function, not a scalar**. A residual fluctuation is
below threshold when its temporal contrast at its dominant temporal frequency is
below `1/tCSF` at that frequency, at the local mean luminance, area, and
eccentricity. Modern models make this computable:

- **stelaCSF** (Mantiuk 2022) and **castleCSF** (2024): S(spatial, temporal,
  luminance, area, eccentricity[, color]); threshold contrast = 1/S.
- **elaTCSF** (SIGGRAPH Asia 2024) ⭐: purpose-built for *flicker detection*
  (luminance/eccentricity/area), validated on a VRR flicker dataset, emits a
  detection probability (JND-scaled). **The one to port** if you want a runtime
  "is this residual flicker visible?" predictor.

Engineering rule of thumb (defensible synthesis, **not** a single cited constant):
at ~100–200 cd/m² SDR and normal viewing, temporal modulation below ~0.2–0.5%
contrast in the low-frequency band, or any modulation whose energy sits above CFF
(~50–70+ Hz photopic), is at/below threshold. **But the number moves by a factor of
several across luminance/eccentricity — run elaTCSF/stelaCSF per-region rather than
committing to one scalar.** This is the honest answer for HUMAN-TESTS.md: replace
"is churn < X" with "does the tCSF model predict this region's temporal contrast is
below detection, weighted by its luminance/spatial-frequency/eccentricity."

Display industry has operationalized flicker JNDs: ICDM IDMS TCSF, SID "Flicker
Visibility" JND, and VESA Adaptive-Sync/VRR flicker metrics (JEITA VRRF) express
margins in JND units from a tCSF — the closest thing to a standardized number.

**Game-industry TAA consensus** (Tardif; López "…Quest for the Holy Trail") is
empirical: stability↔ghosting is a direct trade-off ("the least-shimmering method
ghosts the most"), tuned by eye. The perceptual literature explains *why* smooth,
low-spatial-frequency, high-luminance (and peripheral) regions shimmer first, and
why higher fps + temporal accumulation (pushing residual energy up in temporal
frequency, reducing amplitude) is the principled fix.

## Primary sources

- **de Lange (1958)**, "Attenuation Characteristics…", JOSA 48(11):777.
  https://opg.optica.org/josa/abstract.cfm?uri=josa-48-11-777
- **Kelly (1979)**, "Motion and vision II: stabilized spatio-temporal threshold
  surface", JOSA 69(10):1340. (DOI 10.1364/JOSA.69.001340)
- **Watson, Ahumada & Farrell (1986)**, "Window of visibility", JOSA A 3(3):300.
  https://opg.optica.org/josaa/abstract.cfm?uri=josaa-3-3-300
- **Watson (2013)**, "High Frame Rates and Human Vision", SMPTE.
- **stelaCSF** — Mantiuk et al., ToG 2022. https://dl.acm.org/doi/10.1145/3528223.3530115
- **castleCSF** — J. Vision 2024. https://jov.arvojournals.org/article.aspx?articleid=2793530
- **elaTCSF** — SIGGRAPH Asia 2024 ⭐. arXiv: https://arxiv.org/abs/2503.16759
  · ACM: https://dl.acm.org/doi/full/10.1145/3680528.3687586
- **Peripheral Flicker Fusion at High Luminance: Beyond Ferry–Porter** — Vision 2023.
  https://www.mdpi.com/2411-5150/7/1/26
- **Denes et al. (2019)**, Temporal Resolution Multiplexing.
  https://www.cl.cam.ac.uk/~rkm38/pdfs/denes2019trm.pdf
- **Denes et al.**, "Predicting visible flicker in temporally changing images",
  HVEI — closest flicker-JND predictor to this use case.
  https://library.imaging.org/ei/articles/32/11/art00012
- **VESA Adaptive-Sync Display CTS r1.0** (flicker JND limits).
  https://vesa.org/wp-content/uploads/2022/05/Adaptive-Sync-Display-CTS-r1.0.pdf
- Game-industry: Tardif https://alextardif.com/TAA.html ·
  López https://www.elopezr.com/temporal-aa-and-the-quest-for-the-holy-trail/

## Code / implementations

- **stelaCSF / castleCSF / elaTCSF** ship as models (MATLAB + code, Cambridge
  "Rainbow" group repos + elaTCSF supplement). elaTCSF's arXiv/ACM page links
  dataset+model — port this for a runtime visibility predictor.
- No WGSL tCSF exists; these are offline perceptual models, not shaders. A practical
  bench path: dump frame sequences + luminance, score offline, then fit a cheap
  per-region approximation to gate the churn metric.

## Confidence

Verified: de Lange abstract, elaTCSF abstract, Denes 2019 PDF. Search-confirmed:
stelaCSF, castleCSF, Watson WoV, Ferry–Porter-2023, VESA CTS. **Inferred (do not
cite as a constant):** Kelly 1979 exact URL; the "~0.2–0.5% / >50–70 Hz" rule of
thumb — a reasonable tCSF synthesis, not a single cited number. Defensible report
position: "use elaTCSF/stelaCSF to compute the threshold per-region; there is no
universal scalar."
