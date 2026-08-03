# alpha-metrics

- commit: 9d21307-dirty
- date: 2026-08-03T04:16:44.515Z
- baseUrl: http://localhost:5182/
- cam: 0,2.4,8.8,0,2.6,0
- scene: cornell
- settleMs: 500
- windowMs: 6000
- shots: /Users/dex/Developer/ssgiDev/bench/results/shots/alpha
- rule: convergenceCurve = per-frame churn; ghosting = luminance variance detector; sharpness = Laplacian energy; heatmap = false-color churn.
- failures: ["[SOFT] ghosting metric did not differentiate: demo12=0.0000 should be > demo14=0.0000","[SOFT] demo-14 edge sharpness is low: 0.0146 (SVGF should smooth, but not to 0)"]
- note: quick smoke run — not a recorded number

| testCase | verdict | description | churnEarly | churnLate | ghostingScore | edgeSharpness | heatmapPath |
|---|---|---|---|---|---|---|---|
| demo-12-capped-baseline | fail | Capped EMA (baseline bug): forever boiling, no convergence | 0.3542 | 0.3634 | 0 | 0.0147 | /Users/dex/Developer/ssgiDev/bench/results/shots/alpha/demo-12-capped-baseline-heatmap.png |
| demo-14-svgf-clean | pass | SVGF + EMA: converges clean at rest | 0.0408 | 0.0406 | 0 | 0.0146 | /Users/dex/Developer/ssgiDev/bench/results/shots/alpha/demo-14-svgf-clean-heatmap.png |
| demo-18-oneOverN-jitter | pass | 1/N + jitter AA: converges, should measure well below capped | 0.4369 | 0.3745 | 0.0034 | 0.0137 | /Users/dex/Developer/ssgiDev/bench/results/shots/alpha/demo-18-oneOverN-jitter-heatmap.png |
