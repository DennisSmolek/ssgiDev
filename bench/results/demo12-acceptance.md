# demo12-acceptance

- commit: 104aea5-dirty
- date: 2026-07-21T08:30:20.300Z
- baseUrl: http://localhost:5180/
- viewport: 1280x800
- bursts: 1
- itersPerBurst: 10
- mainSettleMs: 4000
- refSettleMs: 5000
- stabilityMs: 3000/1000
- demo03Reference: {"source":"bench/results/trackB-budget.json (total ms, default cfg) + trackA-quality.json (combined-vs-oracle MSE)","total_ms":{"C-wide":2.1449999999254943,"S-hall":4.5625},"mse":{"C-wide":0.06766196174554742,"C-graze":0.09652520762375046,"C-contact":0.06106415434178283,"S-hall":0.0033027697934449674,"S-column":0.002286506607899167,"Z-zoo":0.1148677790924217},"stability_framecount":0.31,"commitBudget":"7f80b84","commitQuality":"7f80b84-dirty"}
- acceptanceTargets: {"total":"total(half) ≤ demo 03 total at the same cell","mse":"MSE vs own reference ≤ 1.5× demo 03 MSE + 0.02 slack","stability":"stability ≤ 0.40 (demo 03 frame-count 0.31-ish + slack)"}
- bentDiff: P4 bent-normal angular error (bent_diff_mean255) is the screenshot mean of the bent-diff view read at diffAmp=1 (unsaturated); degrees = mean/255 * 45. It measures demo (bitmask-sector centroid) vs oracle (cosine-weighted-visibility) directional agreement; a weighting/estimator gap, not pure noise (invariant to rotationCount).
- caveat: GPU ms measured under the live rAF loop (shared buffers) — contention-prone; treat totals as smoke unless run in isolation. MSE is screenshot-space (tonemapped 8-bit) combined-vs-oracle, same methodology as trackA-quality.
- harnessQuirk: buildParams().importJSON() notifies ALL schema keys per applyConfig; the viewMode->reference switch resets the oracle, so the ref capture re-settles the full convergence window (refSettleMs), not a short repaint wait.
- note: quick smoke run — not a recorded number

| cell | scene | total_half_ms | total_full_ms | march_half_ms | chain_half_ms | demo03_total_ms | pass_total | mse_vs_ref | demo03_mse | pass_mse | stability | demo03_stability | pass_stability | bent_diff_mean255 | bent_diff_deg |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| C-wide | cornell | 2.08 | 3.48 | 0.66 | 1.1 | 2.145 | true | 0.0657 | 0.0677 | true | 0.3637 | 0.31 | true | 137.8045 | 24.3184 |
| S-hall | sponza | 2.35 | 4.72 | 0.88 | 1.07 | 4.5625 | true | 0.0031 | 0.0033 | true | 0.1686 | 0.31 | true | 184.0766 | 32.4841 |
