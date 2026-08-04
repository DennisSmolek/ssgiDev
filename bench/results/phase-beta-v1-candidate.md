# phase-beta-v1-candidate

- commit: be65721-dirty
- date: 2026-08-03T05:21:24.208Z
- baseUrl: http://localhost:5182/
- cam: 0,2.4,8.8,0,2.6,0
- scene: cornell
- settleMs: 1000
- windowMs: 6000
- shots: /Users/dex/Developer/ssgiDev/bench/results/shots/phase-beta
- rule: v1 gates: (1) convergence decline, (2) beats capped baseline, (3) low still-camera ghosting
- candidate: demo 18 oneOverN + jitter
- nextStep: Human eyes + motion test → Phase γ (v2 motion tuning) if pass
- failures: ["[GATE 2 SOFT] v1 late churn (0.4860) should be better than demo-12 baseline (0.3676)"]
- note: quick validation run

| testCase | purpose | churnEarly | churnLate | convergenceTrend | ghostingScore | edgeSharpness | heatmapPath |
|---|---|---|---|---|---|---|---|
| v1-candidate-demo18-oneOverN | Core v1 stack (temporal foundation + jitter AA) | 0.6914 | 0.486 | declining ✓ | 0.0025 | 0.014 | /Users/dex/Developer/ssgiDev/bench/results/shots/phase-beta/v1-candidate-heatmap.png |
| demo-12-capped-baseline | Baseline (non-shippable, perpetual boiling) | 0.3756 | 0.3676 | declining ✓ | 0 | 0.0148 |  |
| demo-14-svgf | Denoiser quality (SVGF converges, but different temporal path) | 0.0374 | 0.038 | flat/rising ✗ | 0 | 0.0146 |  |
