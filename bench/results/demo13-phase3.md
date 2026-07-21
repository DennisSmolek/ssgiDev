# demo13-phase3

- commit: 46abb76-dirty
- date: 2026-07-21T10:34:47.853Z
- baseUrl: http://localhost:5180/
- viewport: 1280x800
- family: phase3
- bursts: 3
- itersPerBurst: 40
- mainSettleMs: 8000
- refSettleMs: 10000
- stabilityMs: 6000/2000
- variantFamily: PHASE3 (P5.3): deinterleave (CACAO-style, march + chain), subgroups (feature-gated pair) vs baseline
- acceptance: {"pass_ms":"march_ms strictly < the paired (thermal-matched) baseline march_ms","pass_baseline":"MSE(variant combined, baseline combined) ≤ gate_mse — 1e-4 for exact/conservative variants (incl. hiz-skip), 1e-3 CONVERGED-only for the in-motion-lossy variants (checkerboard, adaptive, bandwidth-all)","pass_oracle":"MSE(variant, oracle) ≤ baseline's MSE(baseline, oracle) + 0.01 (quality unchanged)"}
- pairing: march ms is measured baseline-then-variant back-to-back per row so both share thermal state; ms_ratio = baseline_march_ms / march_ms (>1 = variant faster). For adaptive/bandwidth-all ms_ratio reflects the CONVERGED (still) effort; march_ms_converged / march_ms_fresh are the deterministic effort endpoints and march_ms_teleport is a live post-teleport burst (the honest motion cost).
- negativeResults: A variant slower than baseline is a VALID recorded result (pass_ms=false), not hidden — NEXTGEN principle 5 says the wins live in bandwidth; the measurement adjudicates which of these actually bank on this fetch-bound march.
- caveat: GPU ms measured under the live rAF loop (shared buffers) — contention-prone; treat as smoke unless run in isolation. MSE is screenshot-space (tonemapped 8-bit).

| cell | scene | variant | available | march_ms | baseline_march_ms | ms_ratio | pass_ms | chain_ms | baseline_chain_ms | chain_ratio | march_ms_converged | march_ms_fresh | march_ms_teleport | mse_vs_baseline | gate_mse | pass_baseline | mse_vs_oracle | baseline_mse_oracle | pass_oracle | stability | stability_delta | note |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| C-wide | cornell | baseline | true |  |  |  |  |  |  |  |  |  |  | 0 |  |  | 0.0662 | 0.0662 |  | 0.3553 | 0 | pristine demo-12 march (control) |
| C-wide | cornell | deinterleave | true | 0.7575 | 0.675 | 0.8911 | false | 0.94 | 0.8625 | 0.9176 |  |  |  | 0.0001 | 0.001 | true | 0.0674 | 0.0662 | true | 0.4292 | 0.074 | CONVERGED-only gate; CACAO-style phase-bucket marching: 4 compact quarter-res dispatches (host-orchestrated de/interleave); march-only + chain measured |
| C-wide | cornell | subgroups | true | 0.69 | 0.6825 | 0.9891 | false |  |  |  |  |  |  | 0 | 0.0001 | true | 0.0662 | 0.0662 | true | 0.3668 | 0.0115 | barrier-free intra-wave GI-light fetch sharing (provably-identical subgroup broadcast; bit-exact vs baseline) |
| S-hall | sponza | baseline | true |  |  |  |  |  |  |  |  |  |  | 0 |  |  | 0.0143 | 0.0143 |  | 0.4671 | 0 | pristine demo-12 march (control) |
| S-hall | sponza | deinterleave | true | 1.085 | 0.8225 | 0.7581 | false | 1.315 | 1.03 | 0.7833 |  |  |  | 0 | 0.001 | true | 0.0146 | 0.0143 | true | 0.4381 | -0.0289 | CONVERGED-only gate; CACAO-style phase-bucket marching: 4 compact quarter-res dispatches (host-orchestrated de/interleave); march-only + chain measured |
| S-hall | sponza | subgroups | true | 0.8525 | 0.8425 | 0.9883 | false |  |  |  |  |  |  | 0 | 0.0001 | true | 0.0143 | 0.0143 | true | 0.4903 | 0.0232 | barrier-free intra-wave GI-light fetch sharing (provably-identical subgroup broadcast; bit-exact vs baseline) |
