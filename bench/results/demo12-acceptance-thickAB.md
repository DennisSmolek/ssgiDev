# demo12-acceptance-thickAB

- commit: 4118871-dirty
- date: 2026-07-23T06:55:15.196Z
- baseUrl: http://localhost:5199/
- viewport: 1280x800
- bursts: 3
- itersPerBurst: 40
- note: P4 thickness A/B (ottosson vs two-sided). MSE vs the SAME (thickness-independent) converged oracle per cell; march_half_ms is the fenced main-march-only cost (min-of-bursts). Two-sided adds one back-face depth-only pass at march res. Z-zoo carries the thin-fence/thick-plate artifacts.

| cell | scene | thickness | mse_vs_ref | march_half_ms |
|---|---|---|---|---|
| C-wide | cornell | ottosson | 0.0662 | 0.6875 |
| C-wide | cornell | two-sided | 0.0662 | 0.77 |
| Z-zoo | artifact-zoo | ottosson | 0.1126 | 0.6325 |
| Z-zoo | artifact-zoo | two-sided | 0.1126 | 0.6825 |
