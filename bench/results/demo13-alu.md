# demo13-alu

- commit: a781a03-dirty
- date: 2026-07-21T08:59:55.640Z
- baseUrl: http://localhost:5180/
- viewport: 1280x800
- bursts: 2
- itersPerBurst: 15
- mainSettleMs: 4000
- refSettleMs: 5000
- stabilityMs: 3000/1000
- variantFamily: ALU (NEXTGEN P5 phase 1): trig, loop, precision, alu-all vs baseline
- acceptance: {"pass_ms":"march_ms strictly < the paired (thermal-matched) baseline march_ms","pass_baseline":"MSE(variant combined, baseline combined) ≤ 0.0001 (variant matches its own control)","pass_oracle":"MSE(variant, oracle) ≤ baseline's MSE(baseline, oracle) + 0.01 (quality unchanged)"}
- pairing: march ms is measured baseline-then-variant back-to-back per row so both share thermal state; ms_ratio = baseline_march_ms / march_ms (>1 = variant faster).
- negativeResults: A variant slower than baseline is a VALID recorded result (pass_ms=false), not hidden — NEXTGEN principle 5 predicts pure-ALU wins are small on a fetch-bound march; the measurement adjudicates.
- caveat: GPU ms measured under the live rAF loop (shared buffers) — contention-prone; treat as smoke unless run in isolation. MSE is screenshot-space (tonemapped 8-bit).
- note: quick smoke run — not a recorded number

| cell | scene | variant | available | march_ms | baseline_march_ms | ms_ratio | pass_ms | mse_vs_baseline | pass_baseline | mse_vs_oracle | baseline_mse_oracle | pass_oracle | stability | note |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| C-wide | cornell | baseline | true |  |  |  |  | 0 |  | 0.0657 | 0.0657 |  | 0.3637 | pristine demo-12 march (control) |
| C-wide | cornell | trig | true | 0.66 | 0.78 | 1.1818 | true | 0 | true | 0.0657 | 0.0657 | true | 0.3732 | angle-sum slice recurrence + exact cos/sin(acos) identities (bent/distant) + branchless vec2 acos |
| C-wide | cornell | loop | true | 0.7467 | 0.74 | 0.9911 | false | 0 | true | 0.0657 | 0.0657 | true | 0.3693 | hoisted invariant reciprocal + affine march-offset strength reduction |
| C-wide | cornell | precision | true | 0.6867 | 0.6667 | 0.9709 | false | 0 | true | 0.0657 | 0.0657 | true | 0.3468 | f16 arithmetic for AO/sector/GI [0,1] quantities (depth+position stay f32) |
| C-wide | cornell | alu-all | true | 0.6333 | 0.7733 | 1.2211 | true | 0 | true | 0.0657 | 0.0657 | true | 0.343 | trig + loop + precision (f16) combined |
| S-hall | sponza | baseline | true |  |  |  |  | 0 |  | 0.0031 | 0.0031 |  | 0.1773 | pristine demo-12 march (control) |
| S-hall | sponza | trig | true | 0.7733 | 0.9467 | 1.2241 | true | 0 | true | 0.0031 | 0.0031 | true | 0.1777 | angle-sum slice recurrence + exact cos/sin(acos) identities (bent/distant) + branchless vec2 acos |
| S-hall | sponza | loop | true | 0.96 | 0.8 | 0.8333 | false | 0 | true | 0.0031 | 0.0031 | true | 0.1734 | hoisted invariant reciprocal + affine march-offset strength reduction |
| S-hall | sponza | precision | true | 0.9467 | 0.9333 | 0.9859 | false | 0 | true | 0.0031 | 0.0031 | true | 0.1715 | f16 arithmetic for AO/sector/GI [0,1] quantities (depth+position stay f32) |
| S-hall | sponza | alu-all | true | 0.7733 | 0.94 | 1.2155 | true | 0 | true | 0.0031 | 0.0031 | true | 0.1632 | trig + loop + precision (f16) combined |
