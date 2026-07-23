# demo12-acceptance

- commit: 4118871-dirty
- date: 2026-07-23T06:55:15.179Z
- baseUrl: http://localhost:5199/
- viewport: 1280x800
- bursts: 3
- itersPerBurst: 40
- mainSettleMs: 8000
- refSettleMs: 10000
- stabilityMs: 6000/2000
- demo03Reference: {"source":"bench/results/trackB-budget.json (total ms, default cfg) + trackA-quality.json (combined-vs-oracle MSE)","total_ms":{"C-wide":2.1149999998509883,"S-hall":4.3574999995529655},"mse":{"C-wide":0.06762909825338172,"C-graze":0.09633445021511515,"C-contact":0.06098624997197295,"S-hall":0.014493316545907802,"S-column":0.01821604947803201,"Z-zoo":0.11485168027181311},"stability_framecount":0.31,"commitBudget":"4118871-dirty","commitQuality":"4118871-dirty"}
- acceptanceTargets: {"total":"total(half) ≤ demo 03 total at the same cell","mse":"MSE vs own reference ≤ 1.5× demo 03 MSE + 0.02 slack","stability":"stability ≤ 1.25× demo 03 frame-count measured in-session at the same cell (paired; absolute gates go stale on scene changes)"}
- bentDiff: P4 bent-normal angular error (bent_diff_mean255) is the screenshot mean of the bent-diff view read at diffAmp=1 (unsaturated); degrees = mean/255 * 45. It measures demo (bitmask-sector centroid) vs oracle (cosine-weighted-visibility) directional agreement; a weighting/estimator gap, not pure noise (invariant to rotationCount).
- caveat: GPU ms measured under the live rAF loop (shared buffers) — contention-prone; treat totals as smoke unless run in isolation. MSE is screenshot-space (tonemapped 8-bit) combined-vs-oracle, same methodology as trackA-quality.
- harnessQuirk: buildParams().importJSON() notifies ALL schema keys per applyConfig; the viewMode->reference switch resets the oracle, so the ref capture re-settles the full convergence window (refSettleMs), not a short repaint wait.

| cell | scene | total_half_ms | total_full_ms | march_half_ms | chain_half_ms | demo03_total_ms | pass_total | mse_vs_ref | demo03_mse | pass_mse | stability | demo03_stability | pass_stability | bent_diff_mean255 | bent_diff_deg |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| C-wide | cornell | 1.215 | 3.12 | 0.6625 | 0.8575 | 2.115 | true | 0.0662 | 0.0676 | true | 0.3548 | 0.3048 | true | 137.5172 | 24.2677 |
| S-hall | sponza | 1.6175 | 4.3175 | 0.83 | 1.0475 | 4.3575 | true | 0.0143 | 0.0145 | true | 0.4941 | 0.42 | true | 185.6996 | 32.7705 |
