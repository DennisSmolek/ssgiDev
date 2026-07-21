# demo13-phase3-smoke

- commit: 40c93ca-dirty
- date: 2026-07-21T10:28:10.010Z
- baseUrl: http://localhost:5180/
- viewport: 1280x800
- family: phase3
- bursts: 2
- itersPerBurst: 15
- mainSettleMs: 4000
- refSettleMs: 5000
- stabilityMs: 3000/1000
- variantFamily: PHASE3 (P5.3): deinterleave (CACAO-style, march + chain), subgroups (feature-gated pair) vs baseline
- acceptance: {"pass_ms":"march_ms strictly < the paired (thermal-matched) baseline march_ms","pass_baseline":"MSE(variant combined, baseline combined) ≤ gate_mse — 1e-4 for exact/conservative variants (incl. hiz-skip), 1e-3 CONVERGED-only for the in-motion-lossy variants (checkerboard, adaptive, bandwidth-all)","pass_oracle":"MSE(variant, oracle) ≤ baseline's MSE(baseline, oracle) + 0.01 (quality unchanged)"}
- pairing: march ms is measured baseline-then-variant back-to-back per row so both share thermal state; ms_ratio = baseline_march_ms / march_ms (>1 = variant faster). For adaptive/bandwidth-all ms_ratio reflects the CONVERGED (still) effort; march_ms_converged / march_ms_fresh are the deterministic effort endpoints and march_ms_teleport is a live post-teleport burst (the honest motion cost).
- negativeResults: A variant slower than baseline is a VALID recorded result (pass_ms=false), not hidden — NEXTGEN principle 5 says the wins live in bandwidth; the measurement adjudicates which of these actually bank on this fetch-bound march.
- caveat: GPU ms measured under the live rAF loop (shared buffers) — contention-prone; treat as smoke unless run in isolation. MSE is screenshot-space (tonemapped 8-bit).
- note: quick smoke run — not a recorded number

| cell | scene | variant | available | march_ms | baseline_march_ms | ms_ratio | pass_ms | chain_ms | baseline_chain_ms | chain_ratio | march_ms_converged | march_ms_fresh | march_ms_teleport | mse_vs_baseline | gate_mse | pass_baseline | mse_vs_oracle | baseline_mse_oracle | pass_oracle | stability | stability_delta | note |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| C-wide | cornell | baseline | true |  |  |  |  |  |  |  |  |  |  | 0 |  |  | 0.0657 | 0.0657 |  | 0.3637 | 0 | pristine demo-12 march (control) |
| C-wide | cornell | deinterleave | true | 0.8467 | 0.9067 | 1.0709 | true | 1.0333 | 0.96 | 0.929 |  |  |  | 0.0001 | 0.001 | true | 0.0667 | 0.0657 | true | 0.5155 | 0.1518 | CONVERGED-only gate; CACAO-style phase-bucket marching: 4 compact quarter-res dispatches (host-orchestrated de/interleave); march-only + chain measured |
| C-wide | cornell | subgroups | true | 0.6667 | 0.7933 | 1.19 | true |  |  |  |  |  |  | 0 | 0.0001 | true | 0.0657 | 0.0657 | true | 0.3747 | 0.0109 | barrier-free intra-wave GI-light fetch sharing (provably-identical subgroup broadcast; bit-exact vs baseline) |
| S-hall | sponza | baseline | true |  |  |  |  |  |  |  |  |  |  | 0 |  |  | 0.0144 | 0.0144 |  | 0.4603 | 0 | pristine demo-12 march (control) |
| S-hall | sponza | deinterleave | true | 1.2267 | 0.9733 | 0.7935 | false | 1.4667 | 1.14 | 0.7773 |  |  |  | 0 | 0.001 | true | 0.0146 | 0.0144 | true | 0.4887 | 0.0285 | CONVERGED-only gate; CACAO-style phase-bucket marching: 4 compact quarter-res dispatches (host-orchestrated de/interleave); march-only + chain measured |
| S-hall | sponza | subgroups | true | 0.9067 | 0.9733 | 1.0735 | true |  |  |  |  |  |  | 0 | 0.0001 | true | 0.0144 | 0.0144 | true | 0.4419 | -0.0184 | barrier-free intra-wave GI-light fetch sharing (provably-identical subgroup broadcast; bit-exact vs baseline) |
