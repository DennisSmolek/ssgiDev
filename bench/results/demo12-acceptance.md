# demo12-acceptance

- commit: d6e441f-dirty
- date: 2026-07-21T07:56:39.125Z
- baseUrl: http://localhost:5180/
- viewport: 1280x800
- bursts: 3
- itersPerBurst: 40
- mainSettleMs: 8000
- refSettleMs: 10000
- stabilityMs: 6000/2000
- demo03Reference: {"source":"bench/results/trackB-budget.json (total ms, default cfg) + trackA-quality.json (combined-vs-oracle MSE)","total_ms":{"C-wide":2.1449999999254943,"S-hall":4.5625},"mse":{"C-wide":0.06766196174554742,"C-graze":0.09652520762375046,"C-contact":0.06106415434178283,"S-hall":0.0033027697934449674,"S-column":0.002286506607899167,"Z-zoo":0.1148677790924217},"stability_framecount":0.31,"commitBudget":"7f80b84","commitQuality":"7f80b84-dirty"}
- acceptanceTargets: {"total":"total(half) ≤ demo 03 total at the same cell","mse":"MSE vs own reference ≤ 1.5× demo 03 MSE + 0.02 slack","stability":"stability ≤ 0.40 (demo 03 frame-count 0.31-ish + slack)"}
- caveat: GPU ms measured under the live rAF loop (shared buffers) — contention-prone; treat totals as smoke unless run in isolation. MSE is screenshot-space (tonemapped 8-bit) combined-vs-oracle, same methodology as trackA-quality.
- harnessQuirk: buildParams().importJSON() notifies ALL schema keys per applyConfig; the viewMode->reference switch resets the oracle, so the ref capture re-settles the full convergence window (refSettleMs), not a short repaint wait.

| cell | scene | total_half_ms | total_full_ms | march_half_ms | chain_half_ms | demo03_total_ms | pass_total | mse_vs_ref | demo03_mse | pass_mse | stability | demo03_stability | pass_stability |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| C-wide | cornell | 1.1225 | 2.7775 | 0.5975 | 0.8175 | 2.145 | true | 0.0662 | 0.0677 | true | 0.3614 | 0.31 | true |
| S-hall | sponza | 1.75 | 5.1975 | 0.93 | 1.2275 | 4.5625 | true | 0.0032 | 0.0033 | true | 0.1744 | 0.31 | true |
