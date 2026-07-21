# demo12-acceptance-thickAB

- commit: 32bbd5e-dirty
- date: 2026-07-21T08:35:16.026Z
- baseUrl: http://localhost:5180/
- viewport: 1280x800
- bursts: 3
- itersPerBurst: 40
- note: P4 thickness A/B (ottosson vs two-sided). MSE vs the SAME (thickness-independent) converged oracle per cell; march_half_ms is the fenced main-march-only cost (min-of-bursts). Two-sided adds one back-face depth-only pass at march res. Z-zoo carries the thin-fence/thick-plate artifacts.

| cell | scene | thickness | mse_vs_ref | march_half_ms |
|---|---|---|---|---|
| C-wide | cornell | ottosson | 0.0662 | 0.665 |
| C-wide | cornell | two-sided | 0.0662 | 0.77 |
| Z-zoo | artifact-zoo | ottosson | 0.1127 | 0.625 |
| Z-zoo | artifact-zoo | two-sided | 0.1127 | 0.6875 |
