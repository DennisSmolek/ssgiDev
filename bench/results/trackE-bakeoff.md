# Track E — cross-demo bake-off (2026-07-21)

Synthesis of tracks B (trackB-budget), A (trackA-quality), C (trackC-temporal),
D (WORKLOG 2026-07-21) at commit 7f80b84. Every number below is re-runnable
from `bench/scripts/run-*.mjs`; configs + commit stamped in the per-track JSON.

## The table (grid cells C-wide / S-hall, as-shipped defaults)

| demo | SSGI GPU ms (default) | heavy | still stability | reconverge | vs oracle (profile) |
|---|---|---|---|---|---|
| 01 stock three | n/a fenced¹ | — | — | — | cross-demo screenshot only¹ |
| 02 oracle | 3.62 / 5.54 per accum frame | — | — | — | is the oracle |
| 03 SSRT3-complete | **2.15 / 4.56** (incl. temporal+denoise) | 7.15 / 10.68 | ema 1.06 · **frame-count 0.31** | ≤2 s² | near-oracle on sponza cells (0.002–0.003); error concentrates cornell interior (0.06–0.10) + zoo (0.11) |
| 04 GT-VBAO | 4.74 / 5.51 (march only) | 27.4 / 33.6 | 0.80 | ≤2 s² | AO-only; composite-vs-AO-oracle MSE not comparable cross-demo³ |
| 05 GT-VBGI | 6.38 / 8.80 (march only) | 37.8 / 50.1 | 0.92 | ≤2 s² | best cornell-cell diff profile (0.046–0.077); sponza near-oracle (0.002–0.004) |
| 06 SSHGI | 13.55 / **31.31** (march 13.8/31.3 dominates) | 36.6 / 67.6 | **0.34** | ≤2 s² | cross-demo screenshot only³ |

¹ Demo 01's fenced total (0.05 ms) is invalid: three's per-frame render-list
caching makes same-frame TSL re-renders skip the real work (documented in
`__bench01`). Use the live gpu-ms readout for demo 01's cost.
² All demos reconverge below threshold at the metric's floor (0.5 s capture
cadence × 2-interval hold ⇒ min detectable ≈ 1.5–2 s). Reconvergence is NOT a
differentiator at this resolution; tighten cadence if we ever need one.
³ Track A MSEs compare different quantities per demo (03: composite vs
alpha-scale oracle; 04: vs AO-only; 05: vs rgb-scale; 01/06: vs demo 02's
screenshot) — the within-demo cell profile and the converged diff screenshots
(`results/shots/trackA/`) are the valid signal; cross-demo MSE ranking is not.
A channel-matched MSE upgrade (ao-view vs oracle-alpha per demo) is the known
follow-up.

## Verdicts (input to NEXTGEN Phase D ingredient gate)

1. **Algorithm base: demo 03's SSRT3-style compute march wins quality-per-ms.**
   It is the cheapest march in the bench *while including* its temporal+denoise
   chain (2.15 ms C-wide vs 4.74 march-only for GT-VBAO), restores the most
   paper features (§3.2 fallback, multibounce, mips), and its mip toggle is
   worth up to 2× at heavy configs (demo03-compute: C-wide heavy 7.98 vs 17.5).
2. **Accumulation: count-based, decisively.** Track C stills (frame-count 0.31,
   SSHGI's count-based 0.34 vs EMA 1.06) agree with lab 10's re-rank (mathis
   0.10 vs ssrt3-EMA 2.07). SSHGI's accumulation idea survives even though its
   march cost doesn't.
3. **The march is the budget everywhere.** Demo 06: 13.8 of 13.55 ms total is
   march; demos 04/05 are march-only by construction; demo 03's chain is
   main-march dominated. Lab 09's half-res+joint-bilateral lever (3.8–5.4×,
   re-validated) applies to precisely this dominant term.
4. **GT-VBGI is the quality reference among implementations, at 3–5× the
   cost.** Its cornell diff profile is the cleanest; its progressive gather is
   why Dennis saw 160→40 fps during accumulation. Keep it as the quality bar
   demo 12 must match, not the base to build on.
5. **SSHGI's cost explains the observed drag.** 31 ms compute at S-hall default
   (67 ms heavy) — the constant 35–50 fps and cross-window GPU contention
   Dennis observed are the measured march, not a bench mistake.
