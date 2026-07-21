# demo13-bandwidth

- commit: a6f35a8-dirty
- date: 2026-07-21T09:57:05.821Z
- baseUrl: http://localhost:5180/
- viewport: 1280x800
- family: bandwidth
- bursts: 2
- itersPerBurst: 15
- mainSettleMs: 4000
- refSettleMs: 5000
- stabilityMs: 3000/1000
- variantFamily: BANDWIDTH (P5.2): light-mips, hiz-skip, checkerboard, adaptive, bandwidth-all vs baseline
- acceptance: {"pass_ms":"march_ms strictly < the paired (thermal-matched) baseline march_ms","pass_baseline":"MSE(variant combined, baseline combined) ≤ gate_mse — 1e-4 for exact/conservative variants (incl. hiz-skip), 1e-3 CONVERGED-only for the in-motion-lossy variants (checkerboard, adaptive, bandwidth-all)","pass_oracle":"MSE(variant, oracle) ≤ baseline's MSE(baseline, oracle) + 0.01 (quality unchanged)"}
- pairing: march ms is measured baseline-then-variant back-to-back per row so both share thermal state; ms_ratio = baseline_march_ms / march_ms (>1 = variant faster). For adaptive/bandwidth-all ms_ratio reflects the CONVERGED (still) effort; march_ms_converged / march_ms_fresh are the deterministic effort endpoints and march_ms_teleport is a live post-teleport burst (the honest motion cost).
- negativeResults: A variant slower than baseline is a VALID recorded result (pass_ms=false), not hidden — NEXTGEN principle 5 says the wins live in bandwidth; the measurement adjudicates which of these actually bank on this fetch-bound march.
- caveat: GPU ms measured under the live rAF loop (shared buffers) — contention-prone; treat as smoke unless run in isolation. MSE is screenshot-space (tonemapped 8-bit).
- note: quick smoke run — not a recorded number

| cell | scene | variant | available | march_ms | baseline_march_ms | ms_ratio | pass_ms | march_ms_converged | march_ms_fresh | march_ms_teleport | mse_vs_baseline | gate_mse | pass_baseline | mse_vs_oracle | baseline_mse_oracle | pass_oracle | stability | stability_delta | note |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| C-wide | cornell | baseline | true |  |  |  |  |  |  |  | 0 |  |  | 0.0657 | 0.0657 |  | 0.3729 | 0 | pristine demo-12 march (control) |
| C-wide | cornell | light-mips | true | 0.68 | 0.7533 | 1.1078 | true |  |  |  | 0 | 0.001 | true | 0.0659 | 0.0657 | true | 0.3439 | -0.0291 | far light samples read a distance-selected prefiltered light mip (normal left un-mipped) |
| C-wide | cornell | hiz-skip | true | 0.68 | 0.7333 | 1.0784 | true |  |  |  | 0 | 0.0001 | true | 0.0657 | 0.0657 | true | 0.3693 | -0.0036 | conservative empty-space skip: exact bitfield-saturation early-out + beyond-radius AO skip (min/max pyramid) |
| C-wide | cornell | checkerboard | true | 0.6333 | 0.66 | 1.0421 | true |  |  |  | 0 | 0.001 | true | 0.0657 | 0.0657 | true | 0.7781 | 0.4051 | CONVERGED-only gate; frame-parity checkerboard march (~2× fewer marched pixels); temporal accumulator refills |
| C-wide | cornell | adaptive | true | 0.22 | 0.7467 | 3.3939 | true | 0.22 | 0.6667 | 0.175 | 0.0006 | 0.001 | true | 0.0663 | 0.0657 | true | 0.4854 | 0.1125 | CONVERGED-only gate; guides-driven per-pixel effort: N≥16 coasts (rot 1 / 0.4× steps), N<4 full; needs TemporalGuidesPass |
| C-wide | cornell | bandwidth-all | true | 0.24 | 0.76 | 3.1667 | true | 0.24 | 0.8067 | 0.1667 | 0.0006 | 0.001 | true | 0.0663 | 0.0657 | true | 0.544 | 0.1711 | CONVERGED-only gate; light-mips + hiz-skip + adaptive composed (checkerboard excluded) |
| S-hall | sponza | baseline | true |  |  |  |  |  |  |  | 0 |  |  | 0.0144 | 0.0144 |  | 0.4692 | 0 | pristine demo-12 march (control) |
| S-hall | sponza | light-mips | true | 0.9467 | 0.9467 | 1 | false |  |  |  | 0 | 0.001 | true | 0.0145 | 0.0144 | true | 0.4308 | -0.0384 | far light samples read a distance-selected prefiltered light mip (normal left un-mipped) |
| S-hall | sponza | hiz-skip | true | 0.9733 | 0.9333 | 0.9589 | false |  |  |  | 0 | 0.0001 | true | 0.0144 | 0.0144 | true | 0.4684 | -0.0008 | conservative empty-space skip: exact bitfield-saturation early-out + beyond-radius AO skip (min/max pyramid) |
| S-hall | sponza | checkerboard | true | 0.9 | 0.8733 | 0.9704 | false |  |  |  | 0 | 0.001 | true | 0.0144 | 0.0144 | true | 0.7797 | 0.3104 | CONVERGED-only gate; frame-parity checkerboard march (~2× fewer marched pixels); temporal accumulator refills |
| S-hall | sponza | adaptive | true | 0.32 | 0.92 | 2.875 | true | 0.32 | 0.9533 | 0.2833 | 0.0002 | 0.001 | true | 0.0153 | 0.0144 | true | 0.5174 | 0.0482 | CONVERGED-only gate; guides-driven per-pixel effort: N≥16 coasts (rot 1 / 0.4× steps), N<4 full; needs TemporalGuidesPass |
| S-hall | sponza | bandwidth-all | true | 0.3267 | 0.9467 | 2.898 | true | 0.3267 | 0.9733 | 0.2667 | 0.0002 | 0.001 | true | 0.0153 | 0.0144 | true | 0.5264 | 0.0572 | CONVERGED-only gate; light-mips + hiz-skip + adaptive composed (checkerboard excluded) |
