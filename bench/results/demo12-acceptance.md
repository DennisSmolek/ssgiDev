# demo12-acceptance

- commit: df2e232-dirty
- date: 2026-07-21T09:31:52.192Z
- baseUrl: http://localhost:5180/
- viewport: 1280x800
- bursts: 3
- itersPerBurst: 40
- mainSettleMs: 8000
- refSettleMs: 10000
- stabilityMs: 6000/2000
- demo03Reference: {"source":"bench/results/trackB-budget.json (total ms, default cfg) + trackA-quality.json (combined-vs-oracle MSE)","total_ms":{"C-wide":2.1449999999254943,"S-hall":4.582499999925494},"mse":{"C-wide":0.06766196174554742,"C-graze":0.09652668143493016,"C-contact":0.06111794819318111,"S-hall":0.014503088460301641,"S-column":0.018267136437870563,"Z-zoo":0.1148677790924217},"stability_framecount":0.31,"commitBudget":"df2e232-dirty","commitQuality":"df2e232-dirty"}
- acceptanceTargets: {"total":"total(half) ≤ demo 03 total at the same cell","mse":"MSE vs own reference ≤ 1.5× demo 03 MSE + 0.02 slack","stability":"stability ≤ 1.25× demo 03 frame-count measured in-session at the same cell (paired; absolute gates go stale on scene changes)"}
- bentDiff: P4 bent-normal angular error (bent_diff_mean255) is the screenshot mean of the bent-diff view read at diffAmp=1 (unsaturated); degrees = mean/255 * 45. It measures demo (bitmask-sector centroid) vs oracle (cosine-weighted-visibility) directional agreement; a weighting/estimator gap, not pure noise (invariant to rotationCount).
- caveat: GPU ms measured under the live rAF loop (shared buffers) — contention-prone; treat totals as smoke unless run in isolation. MSE is screenshot-space (tonemapped 8-bit) combined-vs-oracle, same methodology as trackA-quality.
- harnessQuirk: buildParams().importJSON() notifies ALL schema keys per applyConfig; the viewMode->reference switch resets the oracle, so the ref capture re-settles the full convergence window (refSettleMs), not a short repaint wait.

| cell | scene | total_half_ms | total_full_ms | march_half_ms | chain_half_ms | demo03_total_ms | pass_total | mse_vs_ref | demo03_mse | pass_mse | stability | demo03_stability | pass_stability | bent_diff_mean255 | bent_diff_deg |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| C-wide | cornell | 1.2475 | 3.16 | 0.6875 | 0.875 | 2.145 | true | 0.0662 | 0.0677 | true | 0.3553 | 0.3058 | true | 140.0394 | 24.7128 |
| S-hall | sponza | 1.6525 | 4.45 | 0.8575 | 1.065 | 4.5825 | true | 0.0143 | 0.0145 | true | 0.459 | 0.4242 | true | 184.6893 | 32.5922 |
