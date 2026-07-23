# trackB-budget

- commit: 4118871-dirty
- date: 2026-07-23T06:26:19.447Z
- baseUrl: http://localhost:5199/
- viewport: 1280x800
- cells: C-wide, S-hall
- demos: 01, 02, 03, 04, 05, 06
- heavyConfigs: {"01":"default-only (fixed stock TSL pipeline)","02":"default-only (brute-force oracle; rays/steps are a convergence dial)","03":"rotationCount 4 / stepCount 32 (rc4/sc32)","04":"slicesPerFrame 4 / stepsPerSlice 64","05":"slicesPerFrame 4 / stepsPerSlice 64","06":"slices 8 / steps 64"}
- totalSemantics: {"01":"full TSL pipeline render (Gbuffer+SSGI+SSR+post+composite) — UNDER-REPORTS: TSL FRAME-node render-list caching under the live rAF loop means extra same-frame renders skip the gated effect passes; read the live gpu-ms for demo 01 (see __bench01 comment)","02":"single reference march pass (== accumFrame; the demo's whole SSGI work)","03":"compute chain only (grandfathered __ssrt3bench)","04":"single VBAO march pass (== march; the demo's whole SSGI work)","05":"single VBGI march pass (== march; the demo's whole SSGI work)","06":"source->march->accum->gcopy->compose raw-pass chain"}
- burstPolicy: default 3x40; entries slower than ~20ms/iter drop to 3x10 (per-row iters recorded)

| demo | cell | scene | cfg | pass | ms | bursts | iters |
|---|---|---|---|---|---|---|---|
| 01 | C-wide | cornell | default | total | 0.05 | 3 | 40 |
| 01 | S-hall | sponza | default | total | 0.045 | 3 | 40 |
| 02 | C-wide | cornell | default | accumFrame | 3.5625 | 3 | 40 |
| 02 | C-wide | cornell | default | total | 3.5775 | 3 | 40 |
| 02 | S-hall | sponza | default | accumFrame | 5.495 | 3 | 40 |
| 02 | S-hall | sponza | default | total | 5.48 | 3 | 40 |
| 03 | C-wide | cornell | default | total | 2.115 | 3 | 40 |
| 03 | C-wide | cornell | heavy | total | 7.1575 | 3 | 40 |
| 03 | S-hall | sponza | default | total | 4.3575 | 3 | 40 |
| 03 | S-hall | sponza | heavy | total | 9.565 | 3 | 40 |
| 04 | C-wide | cornell | default | march | 4.375 | 3 | 40 |
| 04 | C-wide | cornell | default | total | 4.3825 | 3 | 40 |
| 04 | C-wide | cornell | heavy | march | 23.7 | 3 | 10 |
| 04 | C-wide | cornell | heavy | total | 23.66 | 3 | 10 |
| 04 | S-hall | sponza | default | march | 5.48 | 3 | 40 |
| 04 | S-hall | sponza | default | total | 5.58 | 3 | 40 |
| 04 | S-hall | sponza | heavy | march | 29.5 | 3 | 10 |
| 04 | S-hall | sponza | heavy | total | 30.12 | 3 | 10 |
| 05 | C-wide | cornell | default | march | 6.005 | 3 | 40 |
| 05 | C-wide | cornell | default | total | 5.9825 | 3 | 40 |
| 05 | C-wide | cornell | heavy | march | 33.26 | 3 | 10 |
| 05 | C-wide | cornell | heavy | total | 32.69 | 3 | 10 |
| 05 | S-hall | sponza | default | march | 7.8925 | 3 | 40 |
| 05 | S-hall | sponza | default | total | 7.89 | 3 | 40 |
| 05 | S-hall | sponza | heavy | march | 45.98 | 3 | 10 |
| 05 | S-hall | sponza | heavy | total | 42.67 | 3 | 10 |
| 06 | C-wide | cornell | default | source | 0.0525 | 3 | 40 |
| 06 | C-wide | cornell | default | march | 10.8025 | 3 | 40 |
| 06 | C-wide | cornell | default | accum | 0.4375 | 3 | 40 |
| 06 | C-wide | cornell | default | gcopy | 0.04 | 3 | 40 |
| 06 | C-wide | cornell | default | compose | 0.045 | 3 | 40 |
| 06 | C-wide | cornell | default | total | 11.1075 | 3 | 40 |
| 06 | C-wide | cornell | heavy | source | 2.3225 | 3 | 40 |
| 06 | C-wide | cornell | heavy | march | 31.14 | 3 | 10 |
| 06 | C-wide | cornell | heavy | accum | 2.4425 | 3 | 40 |
| 06 | C-wide | cornell | heavy | gcopy | 1.765 | 3 | 40 |
| 06 | C-wide | cornell | heavy | compose | 2.315 | 3 | 40 |
| 06 | C-wide | cornell | heavy | total | 31.77 | 3 | 10 |
| 06 | S-hall | sponza | default | source | 2.055 | 3 | 40 |
| 06 | S-hall | sponza | default | march | 27.41 | 3 | 10 |
| 06 | S-hall | sponza | default | accum | 2.2625 | 3 | 40 |
| 06 | S-hall | sponza | default | gcopy | 1.5575 | 3 | 40 |
| 06 | S-hall | sponza | default | compose | 2.045 | 3 | 40 |
| 06 | S-hall | sponza | default | total | 27.66 | 3 | 10 |
| 06 | S-hall | sponza | heavy | source | 4.2575 | 3 | 40 |
| 06 | S-hall | sponza | heavy | march | 58.07 | 3 | 10 |
| 06 | S-hall | sponza | heavy | accum | 17.16 | 3 | 10 |
| 06 | S-hall | sponza | heavy | gcopy | 4.23 | 3 | 40 |
| 06 | S-hall | sponza | heavy | compose | 4.275 | 3 | 40 |
| 06 | S-hall | sponza | heavy | total | 57.85 | 3 | 10 |
