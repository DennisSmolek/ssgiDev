# demo12-acceptance-thickAB

- commit: 104aea5-dirty
- date: 2026-07-21T08:30:20.323Z
- baseUrl: http://localhost:5180/
- viewport: 1280x800
- bursts: 1
- itersPerBurst: 10
- note: P4 thickness A/B (ottosson vs two-sided). MSE vs the SAME (thickness-independent) converged oracle per cell; march_half_ms is the fenced main-march-only cost (min-of-bursts). Two-sided adds one back-face depth-only pass at march res. Z-zoo carries the thin-fence/thick-plate artifacts.
- quick: smoke run — not a recorded number

| cell | scene | thickness | mse_vs_ref | march_half_ms |
|---|---|---|---|---|
| C-wide | cornell | ottosson | 0.0657 | 1.79 |
| C-wide | cornell | two-sided | 0.0657 | 1.85 |
| Z-zoo | artifact-zoo | ottosson | 0.1116 | 1.25 |
| Z-zoo | artifact-zoo | two-sided | 0.1116 | 1.66 |
