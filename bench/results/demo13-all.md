# demo13-all

- commit: eacdc2d-dirty
- date: 2026-07-21T10:09:10.433Z
- baseUrl: http://localhost:5180/
- viewport: 1280x800
- family: all
- bursts: 3
- itersPerBurst: 40
- mainSettleMs: 8000
- refSettleMs: 10000
- stabilityMs: 6000/2000
- variantFamily: ALU (P5.1) + BANDWIDTH (P5.2) vs baseline
- acceptance: {"pass_ms":"march_ms strictly < the paired (thermal-matched) baseline march_ms","pass_baseline":"MSE(variant combined, baseline combined) ≤ gate_mse — 1e-4 for exact/conservative variants (incl. hiz-skip), 1e-3 CONVERGED-only for the in-motion-lossy variants (checkerboard, adaptive, bandwidth-all)","pass_oracle":"MSE(variant, oracle) ≤ baseline's MSE(baseline, oracle) + 0.01 (quality unchanged)"}
- pairing: march ms is measured baseline-then-variant back-to-back per row so both share thermal state; ms_ratio = baseline_march_ms / march_ms (>1 = variant faster). For adaptive/bandwidth-all ms_ratio reflects the CONVERGED (still) effort; march_ms_converged / march_ms_fresh are the deterministic effort endpoints and march_ms_teleport is a live post-teleport burst (the honest motion cost).
- negativeResults: A variant slower than baseline is a VALID recorded result (pass_ms=false), not hidden — NEXTGEN principle 5 says the wins live in bandwidth; the measurement adjudicates which of these actually bank on this fetch-bound march.
- caveat: GPU ms measured under the live rAF loop (shared buffers) — contention-prone; treat as smoke unless run in isolation. MSE is screenshot-space (tonemapped 8-bit).

| cell | scene | variant | available | march_ms | baseline_march_ms | ms_ratio | pass_ms | march_ms_converged | march_ms_fresh | march_ms_teleport | mse_vs_baseline | gate_mse | pass_baseline | mse_vs_oracle | baseline_mse_oracle | pass_oracle | stability | stability_delta | note |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| C-wide | cornell | baseline | true |  |  |  |  |  |  |  | 0 |  |  | 0.0662 | 0.0662 |  | 0.356 | 0 | pristine demo-12 march (control) |
| C-wide | cornell | trig | true | 0.63 | 0.6625 | 1.0516 | true |  |  |  | 0 | 0.0001 | true | 0.0662 | 0.0662 | true | 0.3472 | -0.0088 | angle-sum slice recurrence + exact cos/sin(acos) identities (bent/distant) + branchless vec2 acos |
| C-wide | cornell | loop | true | 0.6725 | 0.6825 | 1.0149 | true |  |  |  | 0 | 0.0001 | true | 0.0662 | 0.0662 | true | 0.3682 | 0.0122 | hoisted invariant reciprocal + affine march-offset strength reduction |
| C-wide | cornell | precision | true | 0.6775 | 0.6725 | 0.9926 | false |  |  |  | 0 | 0.0001 | true | 0.0662 | 0.0662 | true | 0.3349 | -0.0211 | f16 arithmetic for AO/sector/GI [0,1] quantities (depth+position stay f32) |
| C-wide | cornell | alu-all | true | 0.6275 | 0.6725 | 1.0717 | true |  |  |  | 0 | 0.0001 | true | 0.0662 | 0.0662 | true | 0.3538 | -0.0022 | trig + loop + precision (f16) combined |
| C-wide | cornell | light-mips | true | 0.69 | 0.68 | 0.9855 | false |  |  |  | 0 | 0.001 | true | 0.0664 | 0.0662 | true | 0.3037 | -0.0523 | far light samples read a distance-selected prefiltered light mip (normal left un-mipped) |
| C-wide | cornell | hiz-skip | true | 0.6825 | 0.67 | 0.9817 | false |  |  |  | 0 | 0.0001 | true | 0.0662 | 0.0662 | true | 0.3552 | -0.0009 | conservative empty-space skip: exact bitfield-saturation early-out + beyond-radius AO skip (min/max pyramid) |
| C-wide | cornell | checkerboard | true | 0.655 | 0.6625 | 1.0115 | true |  |  |  | 0 | 0.001 | true | 0.0662 | 0.0662 | true | 1.3556 | 0.9996 | CONVERGED-only gate; frame-parity checkerboard march (~2× fewer marched pixels); temporal accumulator refills |
| C-wide | cornell | adaptive | true | 0.2075 | 0.6575 | 3.1687 | true | 0.2075 | 0.6775 | 0.148 | 0.0006 | 0.001 | true | 0.0668 | 0.0662 | true | 0.5272 | 0.1712 | CONVERGED-only gate; guides-driven per-pixel effort: N≥16 coasts (rot 1 / 0.4× steps), N<4 full; needs TemporalGuidesPass |
| C-wide | cornell | bandwidth-all | true | 0.215 | 0.6775 | 3.1512 | true | 0.215 | 0.705 | 0.156 | 0.0006 | 0.001 | true | 0.0668 | 0.0662 | true | 0.5615 | 0.2054 | CONVERGED-only gate; light-mips + hiz-skip + adaptive composed (checkerboard excluded) |
| S-hall | sponza | baseline | true |  |  |  |  |  |  |  | 0 |  |  | 0.0143 | 0.0143 |  | 0.4671 | 0 | pristine demo-12 march (control) |
| S-hall | sponza | trig | true | 0.79 | 0.8475 | 1.0728 | true |  |  |  | 0 | 0.0001 | true | 0.0143 | 0.0143 | true | 0.45 | -0.0171 | angle-sum slice recurrence + exact cos/sin(acos) identities (bent/distant) + branchless vec2 acos |
| S-hall | sponza | loop | true | 0.8325 | 0.845 | 1.015 | true |  |  |  | 0 | 0.0001 | true | 0.0143 | 0.0143 | true | 0.4622 | -0.0048 | hoisted invariant reciprocal + affine march-offset strength reduction |
| S-hall | sponza | precision | true | 0.835 | 0.835 | 1 | false |  |  |  | 0 | 0.0001 | true | 0.0143 | 0.0143 | true | 0.4488 | -0.0182 | f16 arithmetic for AO/sector/GI [0,1] quantities (depth+position stay f32) |
| S-hall | sponza | alu-all | true | 0.79 | 0.835 | 1.057 | true |  |  |  | 0 | 0.0001 | true | 0.0143 | 0.0143 | true | 0.4528 | -0.0143 | trig + loop + precision (f16) combined |
| S-hall | sponza | light-mips | true | 0.855 | 0.8375 | 0.9795 | false |  |  |  | 0 | 0.001 | true | 0.0144 | 0.0143 | true | 0.4087 | -0.0584 | far light samples read a distance-selected prefiltered light mip (normal left un-mipped) |
| S-hall | sponza | hiz-skip | true | 0.8525 | 0.835 | 0.9795 | false |  |  |  | 0 | 0.0001 | true | 0.0143 | 0.0143 | true | 0.4866 | 0.0196 | conservative empty-space skip: exact bitfield-saturation early-out + beyond-radius AO skip (min/max pyramid) |
| S-hall | sponza | checkerboard | true | 0.795 | 0.8375 | 1.0535 | true |  |  |  | 0 | 0.001 | true | 0.0143 | 0.0143 | true | 0.7308 | 0.2638 | CONVERGED-only gate; frame-parity checkerboard march (~2× fewer marched pixels); temporal accumulator refills |
| S-hall | sponza | adaptive | true | 0.355 | 0.8425 | 2.3732 | true | 0.355 | 0.855 | 0.252 | 0.0002 | 0.001 | true | 0.0152 | 0.0143 | true | 0.5016 | 0.0345 | CONVERGED-only gate; guides-driven per-pixel effort: N≥16 coasts (rot 1 / 0.4× steps), N<4 full; needs TemporalGuidesPass |
| S-hall | sponza | bandwidth-all | true | 0.3275 | 0.835 | 2.5496 | true | 0.3275 | 0.8825 | 0.268 | 0.0002 | 0.001 | true | 0.0152 | 0.0143 | true | 0.5633 | 0.0963 | CONVERGED-only gate; light-mips + hiz-skip + adaptive composed (checkerboard excluded) |
