# HUMAN-RESULTS — perceptual observation log

Protocol: [HUMAN-TESTS.md](../../../HUMAN-TESTS.md). Append-only, newest at
the bottom of each section. One row per observation.

How to fill a row:

- **verdict**: CLEAN / FLOOR-static (frozen grain — a screenshot now and in
ten seconds would match) / FLOOR-live (noise LEVEL constant but the pattern
visibly crawls/shimmers) / DIVERGES (the amount itself never settles). Plus
`Ns` seconds-to-clean where the experiment asks; "never" = one of the FLOORs.
H-3 uses grade 0–3 instead.
- **config**: paste the exported JSON from the pane (copy button /
`__benchParams`). At defaults, just write `defaults`. REQUIRED whenever you
touched any knob — including failed attempts (dead knobs are findings).
- **cam**: the GRID_CAMS id (C-wide, S-column, …) or a `?cam=` string if
custom.
- **note**: what you saw, in your words. Where the defect is, what it looks
like, what a knob did or failed to do.

Get the date+commit for a session header with:
`date "+%Y-%m-%d" && git rev-parse --short HEAD`

---



## Session template (copy this block per sitting)



### Session YYYY-MM-DD @



#### H-1 — Still convergence ladder

Column meanings: **verdict** = at defaults, touching nothing.
**secs-to-clean** = only if that verdict is CLEAN; else "never".
**probes** = one-at-a-time knob results, written `knob → effect`
(e.g. `frameCap 4→16 improves, 16→60 negligible, boil never stops`).
No config column here — probes are transient; if a tuned state is worth
reproducing exactly, that's an H-2 row (paste its JSON there).

| demo | stack/mode     | cam    | verdict (defaults) | secs-to-clean | probes: knob → effect | note |
| ---- | -------------- | ------ | ------------------ | ------------- | --------------------- | ---- |
| 03   | frame-count    | C-wide |                    |               |                       |      |
| 03   | ssrt3-ema      | C-wide |                    |               |                       |      |
| 10   | ssrt3          | C-wide |                    |               |                       |      |
| 10   | ssrt3-guides   | C-wide |                    |               |                       |      |
| 10   | mathis         | C-wide |                    |               |                       |      |
| 10   | xegtao         | C-wide |                    |               |                       |      |
| 17   | private-guides | C-wide |                    |               |                       |      |
| 17   | fsr-guides     | C-wide |                    |               |                       |      |
| 14   | bilateral      | C-wide |                    |               |                       |      |
| 14   | svgf-lite      | C-wide |                    |               |                       |      |
| 14   | svgf           | C-wide |                    |               |                       |      |
| 14   | ssrt3-guides   | C-wide |                    |               |                       |      |
| 12   | default        | C-wide |                    |               |                       |      |




#### H-2 — Parity hunt (tuning mode)


| demo | stack | cam | closest-to-reference? | residual defect | config (REQUIRED) | note |
| ---- | ----- | --- | --------------------- | --------------- | ----------------- | ---- |
|      |       |     |                       |                 |                   |      |




#### H-3 — Motion shimmer (grade 0–3: flat / grazing / texture)


| demo | stack | cam | flat | grazing | texture | secs-to-settle after stop | note |
| ---- | ----- | --- | ---- | ------- | ------- | ------------------------- | ---- |
|      |       |     |      |         |         |                           |      |




#### H-4 — Teleport ghosting


| demo | stack | from→to | ghost? | secs-to-clean | recovery character (fade/fill/smear) | note |
| ---- | ----- | ------- | ------ | ------------- | ------------------------------------ | ---- |
|      |       |         |        |               |                                      |      |




#### H-5 — Texture flicker sweep (S-column)


| arm          | K   | verdict | note |
| ------------ | --- | ------- | ---- |
| svgf-lite    | —   |         |      |
| svgf         | 1   |         |      |
| svgf         | 2   |         |      |
| svgf         | 3   |         |      |
| svgf         | 4   |         |      |
| svgf         | 5   |         |      |
| ssrt3-guides | —   |         |      |




#### H-6 — Noise ladder (demo 14, defaults per arm)


| arm | σ   | fireflies | cleans up? | over-blur vs reference? | note |
| --- | --- | --------- | ---------- | ----------------------- | ---- |
|     |     |           |            |                         |      |




#### H-7 — Torch flicker (sponza, defaults)


| demo | stack | tracks/lags/ghosts | note |
| ---- | ----- | ------------------ | ---- |
|      |       |                    |      |




#### Free findings

Anything that didn't fit a row: dead knobs, wiring suspicions, "this demo
looks broken", ideas.

---

First test:  

Session 2026-07-24 @ 8c064c8

#### H-1 — Still convergence ladder


| demo | stack/mode     | cam    | verdict    | secs-to-clean | knob probe (moved/vanished)         | config   | note                                                                                                                                                                                                                                                                     |
| ---- | -------------- | ------ | ---------- | ------------- | ----------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 03   | frame-count    | C-wide | FLOOR-live | Never         | accum-frameCap, denoisingRadius     | defaults | FrameCap had measurable quality changes from 4-16 but 16-60 the differnces were neglegable. The denoising radius had some improvement but even when slight the boiling effect could still be percieved. MUST NOTE: its very high quality visibly. It just never settles. |
| 03   | ssrt3-ema      | C-wide | FLOOR-Live | Never         | temporalAccumulation, denoiseRadius | defaults | fro 0-0.1 give the most stable response but some motion is always visible. again the radius helps. Similar quality to the other mode.                                                                                                                                    |
| 10   | ssrt3          | C-wide |            |               |                                     | defaults |                                                                                                                                                                                                                                                                          |
| 10   | ssrt3-guides   | C-wide |            |               |                                     | defaults |                                                                                                                                                                                                                                                                          |
| 10   | mathis         | C-wide |            |               |                                     | defaults |                                                                                                                                                                                                                                                                          |
| 10   | xegtao         | C-wide |            |               |                                     | defaults |                                                                                                                                                                                                                                                                          |
| 17   | private-guides | C-wide |            |               |                                     | defaults |                                                                                                                                                                                                                                                                          |
| 17   | fsr-guides     | C-wide |            |               |                                     | defaults |                                                                                                                                                                                                                                                                          |
| 14   | bilateral      | C-wide |            |               |                                     | defaults |                                                                                                                                                                                                                                                                          |
| 14   |                |        |            |               |                                     |          |                                                                                                                                                                                                                                                                          |


