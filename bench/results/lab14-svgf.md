# lab14-svgf

- commit: 4118871-dirty
- date: 2026-07-23T06:14:53.655Z
- baseUrl: http://localhost:5199/
- settleMs: 6000
- gapMs: 2000
- grids: ["C-wide", "C-graze", "C-contact", "S-hall", "S-column", "Z-zoo"]
- stacks: ["bilateral", "svgf-lite", "svgf", "ssrt3-guides", "mathis"]
- note: SVGF-SPEC §4: MSE ranks denoisers against the demo's own biased-producer oracle, not unbiased GI — see README caveat.
- flagCorrection: notRunForRecordedNumbers removed 2026-07-23: it was hardcoded in run-14.mjs (leftover deferred-run marker, fixed same day) — this IS the recorded run.

| demo | grid | stack | view | stability | mse |
|---|---|---|---|---|---|
| 14-svgf | C-wide | bilateral | combined | 6.3175 |  |
| 14-svgf | C-wide | bilateral | mse-vs-reference |  | 0.1052 |
| 14-svgf | C-wide | svgf-lite | combined | 0.3531 |  |
| 14-svgf | C-wide | svgf-lite | mse-vs-reference |  | 0.1042 |
| 14-svgf | C-wide | svgf | combined | 0.2195 |  |
| 14-svgf | C-wide | svgf | mse-vs-reference |  | 0.1041 |
| 14-svgf | C-wide | ssrt3-guides | combined | 2.2173 |  |
| 14-svgf | C-wide | ssrt3-guides | mse-vs-reference |  | 0.1042 |
| 14-svgf | C-wide | mathis | combined | 0.1517 |  |
| 14-svgf | C-wide | mathis | mse-vs-reference |  | 0.1067 |
| 14-svgf | C-graze | bilateral | combined | 4.7393 |  |
| 14-svgf | C-graze | bilateral | mse-vs-reference |  | 0.1145 |
| 14-svgf | C-graze | svgf-lite | combined | 0.2338 |  |
| 14-svgf | C-graze | svgf-lite | mse-vs-reference |  | 0.1126 |
| 14-svgf | C-graze | svgf | combined | 0.19 |  |
| 14-svgf | C-graze | svgf | mse-vs-reference |  | 0.1125 |
| 14-svgf | C-graze | ssrt3-guides | combined | 1.983 |  |
| 14-svgf | C-graze | ssrt3-guides | mse-vs-reference |  | 0.1136 |
| 14-svgf | C-graze | mathis | combined | 0.3626 |  |
| 14-svgf | C-graze | mathis | mse-vs-reference |  | 0.1129 |
| 14-svgf | C-contact | bilateral | combined | 3.853 |  |
| 14-svgf | C-contact | bilateral | mse-vs-reference |  | 0.0621 |
| 14-svgf | C-contact | svgf-lite | combined | 0.1704 |  |
| 14-svgf | C-contact | svgf-lite | mse-vs-reference |  | 0.0613 |
| 14-svgf | C-contact | svgf | combined | 0.1092 |  |
| 14-svgf | C-contact | svgf | mse-vs-reference |  | 0.0612 |
| 14-svgf | C-contact | ssrt3-guides | combined | 1.6018 |  |
| 14-svgf | C-contact | ssrt3-guides | mse-vs-reference |  | 0.0616 |
| 14-svgf | C-contact | mathis | combined | 0.2197 |  |
| 14-svgf | C-contact | mathis | mse-vs-reference |  | 0.0611 |
| 14-svgf | S-hall | bilateral | combined | 5.439 |  |
| 14-svgf | S-hall | bilateral | mse-vs-reference |  | 0.0142 |
| 14-svgf | S-hall | svgf-lite | combined | 0.2411 |  |
| 14-svgf | S-hall | svgf-lite | mse-vs-reference |  | 0.0134 |
| 14-svgf | S-hall | svgf | combined | 0.0764 |  |
| 14-svgf | S-hall | svgf | mse-vs-reference |  | 0.0134 |
| 14-svgf | S-hall | ssrt3-guides | combined | 2.0408 |  |
| 14-svgf | S-hall | ssrt3-guides | mse-vs-reference |  | 0.0138 |
| 14-svgf | S-hall | mathis | combined | 0.3112 |  |
| 14-svgf | S-hall | mathis | mse-vs-reference |  | 0.0134 |
| 14-svgf | S-column | bilateral | combined | 1.4998 |  |
| 14-svgf | S-column | bilateral | mse-vs-reference |  | 0.0214 |
| 14-svgf | S-column | svgf-lite | combined | 2.6947 |  |
| 14-svgf | S-column | svgf-lite | mse-vs-reference |  | 0.0211 |
| 14-svgf | S-column | svgf | combined | 0.0347 |  |
| 14-svgf | S-column | svgf | mse-vs-reference |  | 0.0212 |
| 14-svgf | S-column | ssrt3-guides | combined | 3.0606 |  |
| 14-svgf | S-column | ssrt3-guides | mse-vs-reference |  | 0.0212 |
| 14-svgf | S-column | mathis | combined | 0.108 |  |
| 14-svgf | S-column | mathis | mse-vs-reference |  | 0.0215 |
| 14-svgf | Z-zoo | bilateral | combined | 1.2409 |  |
| 14-svgf | Z-zoo | bilateral | mse-vs-reference |  | 0.1783 |
| 14-svgf | Z-zoo | svgf-lite | combined | 0.2943 |  |
| 14-svgf | Z-zoo | svgf-lite | mse-vs-reference |  | 0.1776 |
| 14-svgf | Z-zoo | svgf | combined | 0.2396 |  |
| 14-svgf | Z-zoo | svgf | mse-vs-reference |  | 0.1779 |
| 14-svgf | Z-zoo | ssrt3-guides | combined | 0.7583 |  |
| 14-svgf | Z-zoo | ssrt3-guides | mse-vs-reference |  | 0.178 |
| 14-svgf | Z-zoo | mathis | combined | 0.3219 |  |
| 14-svgf | Z-zoo | mathis | mse-vs-reference |  | 0.1767 |
