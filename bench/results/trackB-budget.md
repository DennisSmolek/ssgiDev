# trackB-budget

- commit: df2e232-dirty
- date: 2026-07-21T09:09:08.083Z
- baseUrl: http://localhost:5180/
- viewport: 1280x800
- cells: C-wide, S-hall
- demos: 01, 02, 03, 04, 05, 06
- heavyConfigs: {"01":"default-only (fixed stock TSL pipeline)","02":"default-only (brute-force oracle; rays/steps are a convergence dial)","03":"rotationCount 4 / stepCount 32 (rc4/sc32)","04":"slicesPerFrame 4 / stepsPerSlice 64","05":"slicesPerFrame 4 / stepsPerSlice 64","06":"slices 8 / steps 64"}
- totalSemantics: {"01":"full TSL pipeline render (Gbuffer+SSGI+SSR+post+composite) — UNDER-REPORTS: TSL FRAME-node render-list caching under the live rAF loop means extra same-frame renders skip the gated effect passes; read the live gpu-ms for demo 01 (see __bench01 comment)","02":"single reference march pass (== accumFrame; the demo's whole SSGI work)","03":"compute chain only (grandfathered __ssrt3bench)","04":"single VBAO march pass (== march; the demo's whole SSGI work)","05":"single VBGI march pass (== march; the demo's whole SSGI work)","06":"source->march->accum->gcopy->compose raw-pass chain"}
- burstPolicy: default 3x40; entries slower than ~20ms/iter drop to 3x10 (per-row iters recorded)

| demo | cell | scene | cfg | pass | ms | bursts | iters |
|---|---|---|---|---|---|---|---|
| 01 | C-wide | cornell | default | total | 0.055 | 3 | 40 |
| 01 | S-hall | sponza | default | total | 0.0375 | 3 | 40 |
| 02 | C-wide | cornell | default | accumFrame | 3.57 | 3 | 40 |
| 02 | C-wide | cornell | default | total | 3.5725 | 3 | 40 |
| 02 | S-hall | sponza | default | accumFrame | 5.4625 | 3 | 40 |
| 02 | S-hall | sponza | default | total | 5.5025 | 3 | 40 |
| 03 | C-wide | cornell | default | total | 2.145 | 3 | 40 |
| 03 | C-wide | cornell | heavy | total | 7.135 | 3 | 40 |
| 03 | S-hall | sponza | default | total | 4.5825 | 3 | 40 |
| 03 | S-hall | sponza | heavy | total | 9.765 | 3 | 40 |
| 04 | C-wide | cornell | default | march | 4.365 | 3 | 40 |
| 04 | C-wide | cornell | default | total | 4.3675 | 3 | 40 |
| 04 | C-wide | cornell | heavy | march | 25.57 | 3 | 10 |
| 04 | C-wide | cornell | heavy | total | 23.97 | 3 | 10 |
| 04 | S-hall | sponza | default | march | 5.475 | 3 | 40 |
| 04 | S-hall | sponza | default | total | 5.61 | 3 | 40 |
| 04 | S-hall | sponza | heavy | march | 31.63 | 3 | 10 |
| 04 | S-hall | sponza | heavy | total | 32.1 | 3 | 10 |
| 05 | C-wide | cornell | default | march | 5.985 | 3 | 40 |
| 05 | C-wide | cornell | default | total | 6.005 | 3 | 40 |
| 05 | C-wide | cornell | heavy | march | 33.46 | 3 | 10 |
| 05 | C-wide | cornell | heavy | total | 33.96 | 3 | 10 |
| 05 | S-hall | sponza | default | march | 8.3975 | 3 | 40 |
| 05 | S-hall | sponza | default | total | 8.4175 | 3 | 40 |
| 05 | S-hall | sponza | heavy | march | 50.63 | 3 | 10 |
| 05 | S-hall | sponza | heavy | total | 45.73 | 3 | 10 |
| 06 | C-wide | cornell | default | source | 0.0375 | 3 | 40 |
| 06 | C-wide | cornell | default | march | 13.555 | 3 | 40 |
| 06 | C-wide | cornell | default | accum | 0.455 | 3 | 40 |
| 06 | C-wide | cornell | default | gcopy | 0.0475 | 3 | 40 |
| 06 | C-wide | cornell | default | compose | 0.045 | 3 | 40 |
| 06 | C-wide | cornell | default | total | 13.6775 | 3 | 40 |
| 06 | C-wide | cornell | heavy | source | 2.5975 | 3 | 40 |
| 06 | C-wide | cornell | heavy | march | 37.73 | 3 | 10 |
| 06 | C-wide | cornell | heavy | accum | 2.855 | 3 | 40 |
| 06 | C-wide | cornell | heavy | gcopy | 2.735 | 3 | 40 |
| 06 | C-wide | cornell | heavy | compose | 2.71 | 3 | 40 |
| 06 | C-wide | cornell | heavy | total | 37.23 | 3 | 10 |
| 06 | S-hall | sponza | default | source | 2.31 | 3 | 40 |
| 06 | S-hall | sponza | default | march | 31.71 | 3 | 10 |
| 06 | S-hall | sponza | default | accum | 2.66 | 3 | 40 |
| 06 | S-hall | sponza | default | gcopy | 2.49 | 3 | 40 |
| 06 | S-hall | sponza | default | compose | 2.445 | 3 | 40 |
| 06 | S-hall | sponza | default | total | 32.59 | 3 | 10 |
| 06 | S-hall | sponza | heavy | source | 20.24 | 3 | 10 |
| 06 | S-hall | sponza | heavy | march | 69.72 | 3 | 10 |
| 06 | S-hall | sponza | heavy | accum | 21.27 | 3 | 10 |
| 06 | S-hall | sponza | heavy | gcopy | 21.05 | 3 | 10 |
| 06 | S-hall | sponza | heavy | compose | 21.13 | 3 | 10 |
| 06 | S-hall | sponza | heavy | total | 78.1 | 3 | 10 |
