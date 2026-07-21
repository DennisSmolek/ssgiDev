# demo13-alu

- commit: df2e232-dirty
- date: 2026-07-21T09:27:25.528Z
- baseUrl: http://localhost:5180/
- viewport: 1280x800
- bursts: 3
- itersPerBurst: 40
- mainSettleMs: 8000
- refSettleMs: 10000
- stabilityMs: 6000/2000
- variantFamily: ALU (NEXTGEN P5 phase 1): trig, loop, precision, alu-all vs baseline
- acceptance: {"pass_ms":"march_ms strictly < the paired (thermal-matched) baseline march_ms","pass_baseline":"MSE(variant combined, baseline combined) ≤ 0.0001 (variant matches its own control)","pass_oracle":"MSE(variant, oracle) ≤ baseline's MSE(baseline, oracle) + 0.01 (quality unchanged)"}
- pairing: march ms is measured baseline-then-variant back-to-back per row so both share thermal state; ms_ratio = baseline_march_ms / march_ms (>1 = variant faster).
- negativeResults: A variant slower than baseline is a VALID recorded result (pass_ms=false), not hidden — NEXTGEN principle 5 predicts pure-ALU wins are small on a fetch-bound march; the measurement adjudicates.
- caveat: GPU ms measured under the live rAF loop (shared buffers) — contention-prone; treat as smoke unless run in isolation. MSE is screenshot-space (tonemapped 8-bit).

| cell | scene | variant | available | march_ms | baseline_march_ms | ms_ratio | pass_ms | mse_vs_baseline | pass_baseline | mse_vs_oracle | baseline_mse_oracle | pass_oracle | stability | note |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| C-wide | cornell | baseline | true |  |  |  |  | 0 |  | 0.0662 | 0.0662 |  | 0.356 | pristine demo-12 march (control) |
| C-wide | cornell | trig | true | 0.6525 | 0.7075 | 1.0843 | true | 0 | true | 0.0662 | 0.0662 | true | 0.3472 | angle-sum slice recurrence + exact cos/sin(acos) identities (bent/distant) + branchless vec2 acos |
| C-wide | cornell | loop | true | 0.675 | 0.6975 | 1.0333 | true | 0 | true | 0.0662 | 0.0662 | true | 0.3682 | hoisted invariant reciprocal + affine march-offset strength reduction |
| C-wide | cornell | precision | true | 0.6825 | 0.695 | 1.0183 | true | 0 | true | 0.0662 | 0.0662 | true | 0.3337 | f16 arithmetic for AO/sector/GI [0,1] quantities (depth+position stay f32) |
| C-wide | cornell | alu-all | true | 0.645 | 0.685 | 1.062 | true | 0 | true | 0.0662 | 0.0662 | true | 0.3504 | trig + loop + precision (f16) combined |
| S-hall | sponza | baseline | true |  |  |  |  | 0 |  | 0.0143 | 0.0143 |  | 0.4671 | pristine demo-12 march (control) |
| S-hall | sponza | trig | true | 0.8275 | 0.8575 | 1.0363 | true | 0 | true | 0.0143 | 0.0143 | true | 0.4248 | angle-sum slice recurrence + exact cos/sin(acos) identities (bent/distant) + branchless vec2 acos |
| S-hall | sponza | loop | true | 0.8675 | 0.8625 | 0.9942 | false | 0 | true | 0.0143 | 0.0143 | true | 0.4351 | hoisted invariant reciprocal + affine march-offset strength reduction |
| S-hall | sponza | precision | true | 0.865 | 0.85 | 0.9827 | false | 0 | true | 0.0143 | 0.0143 | true | 0.453 | f16 arithmetic for AO/sector/GI [0,1] quantities (depth+position stay f32) |
| S-hall | sponza | alu-all | true | 0.825 | 0.8525 | 1.0333 | true | 0 | true | 0.0143 | 0.0143 | true | 0.4413 | trig + loop + precision (f16) combined |
