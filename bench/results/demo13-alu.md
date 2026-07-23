# demo13-alu

- commit: 4118871-dirty
- date: 2026-07-23T06:58:31.761Z
- baseUrl: http://localhost:5199/
- viewport: 1280x800
- family: alu
- bursts: 3
- itersPerBurst: 40
- mainSettleMs: 8000
- refSettleMs: 10000
- stabilityMs: 6000/2000
- variantFamily: ALU (P5.1): trig, loop, precision, alu-all vs baseline
- acceptance: {"pass_ms":"march_ms strictly < the paired (thermal-matched) baseline march_ms","pass_baseline":"MSE(variant combined, baseline combined) ≤ gate_mse — 1e-4 for exact/conservative variants (incl. hiz-skip), 1e-3 CONVERGED-only for the in-motion-lossy variants (checkerboard, adaptive, bandwidth-all)","pass_oracle":"MSE(variant, oracle) ≤ baseline's MSE(baseline, oracle) + 0.01 (quality unchanged)"}
- pairing: march ms is measured baseline-then-variant back-to-back per row so both share thermal state; ms_ratio = baseline_march_ms / march_ms (>1 = variant faster). For adaptive/bandwidth-all ms_ratio reflects the CONVERGED (still) effort; march_ms_converged / march_ms_fresh are the deterministic effort endpoints and march_ms_teleport is a live post-teleport burst (the honest motion cost).
- negativeResults: A variant slower than baseline is a VALID recorded result (pass_ms=false), not hidden — NEXTGEN principle 5 says the wins live in bandwidth; the measurement adjudicates which of these actually bank on this fetch-bound march.
- caveat: GPU ms measured under the live rAF loop (shared buffers) — contention-prone; treat as smoke unless run in isolation. MSE is screenshot-space (tonemapped 8-bit).

| cell | scene | variant | available | march_ms | baseline_march_ms | ms_ratio | pass_ms | chain_ms | baseline_chain_ms | chain_ratio | march_ms_converged | march_ms_fresh | march_ms_teleport | mse_vs_baseline | gate_mse | pass_baseline | mse_vs_oracle | baseline_mse_oracle | pass_oracle | stability | stability_delta | note |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| C-wide | cornell | baseline | true |  |  |  |  |  |  |  |  |  |  | 0 |  |  | 0.0662 | 0.0662 |  | 0.3548 | 0 | pristine demo-12 march (control) |
| C-wide | cornell | trig | true | 0.6475 | 0.665 | 1.027 | true |  |  |  |  |  |  | 0 | 0.0001 | true | 0.0662 | 0.0662 | true | 0.3519 | -0.0029 | angle-sum slice recurrence + exact cos/sin(acos) identities (bent/distant) + branchless vec2 acos |
| C-wide | cornell | loop | true | 0.6775 | 0.685 | 1.0111 | true |  |  |  |  |  |  | 0 | 0.0001 | true | 0.0662 | 0.0662 | true | 0.3619 | 0.0071 | hoisted invariant reciprocal + affine march-offset strength reduction |
| C-wide | cornell | precision | true | 0.68 | 0.675 | 0.9926 | false |  |  |  |  |  |  | 0 | 0.0001 | true | 0.0662 | 0.0662 | true | 0.3337 | -0.0211 | f16 arithmetic for AO/sector/GI [0,1] quantities (depth+position stay f32) |
| C-wide | cornell | alu-all | true | 0.63 | 0.675 | 1.0714 | true |  |  |  |  |  |  | 0 | 0.0001 | true | 0.0662 | 0.0662 | true | 0.3568 | 0.002 | trig + loop + precision (f16) combined |
| S-hall | sponza | baseline | true |  |  |  |  |  |  |  |  |  |  | 0 |  |  | 0.0143 | 0.0143 |  | 0.4585 | 0 | pristine demo-12 march (control) |
| S-hall | sponza | trig | true | 0.79 | 0.86 | 1.0886 | true |  |  |  |  |  |  | 0 | 0.0001 | true | 0.0143 | 0.0143 | true | 0.426 | -0.0324 | angle-sum slice recurrence + exact cos/sin(acos) identities (bent/distant) + branchless vec2 acos |
| S-hall | sponza | loop | true | 0.8325 | 0.825 | 0.991 | false |  |  |  |  |  |  | 0 | 0.0001 | true | 0.0143 | 0.0143 | true | 0.4489 | -0.0095 | hoisted invariant reciprocal + affine march-offset strength reduction |
| S-hall | sponza | precision | true | 0.84 | 0.8325 | 0.9911 | false |  |  |  |  |  |  | 0 | 0.0001 | true | 0.0143 | 0.0143 | true | 0.4268 | -0.0316 | f16 arithmetic for AO/sector/GI [0,1] quantities (depth+position stay f32) |
| S-hall | sponza | alu-all | true | 0.795 | 0.83 | 1.044 | true |  |  |  |  |  |  | 0 | 0.0001 | true | 0.0143 | 0.0143 | true | 0.4754 | 0.0169 | trig + loop + precision (f16) combined |
