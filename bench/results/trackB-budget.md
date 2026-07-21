# trackB-budget

- commit: 7f80b84
- date: 2026-07-21T04:44:31.854Z
- baseUrl: http://localhost:5180/
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
| 02 | C-wide | cornell | default | accumFrame | 3.6225 | 3 | 40 |
| 02 | C-wide | cornell | default | total | 3.6175 | 3 | 40 |
| 02 | S-hall | sponza | default | accumFrame | 5.5375 | 3 | 40 |
| 02 | S-hall | sponza | default | total | 5.5425 | 3 | 40 |
| 03 | C-wide | cornell | default | total | 2.145 | 3 | 40 |
| 03 | C-wide | cornell | heavy | total | 7.15 | 3 | 40 |
| 03 | S-hall | sponza | default | total | 4.5625 | 3 | 40 |
| 03 | S-hall | sponza | heavy | total | 10.6775 | 3 | 40 |
| 04 | C-wide | cornell | default | march | 4.7425 | 3 | 40 |
| 04 | C-wide | cornell | default | total | 4.755 | 3 | 40 |
| 04 | C-wide | cornell | heavy | march | 27.37 | 3 | 10 |
| 04 | C-wide | cornell | heavy | total | 25.71 | 3 | 10 |
| 04 | S-hall | sponza | default | march | 5.505 | 3 | 40 |
| 04 | S-hall | sponza | default | total | 5.9375 | 3 | 40 |
| 04 | S-hall | sponza | heavy | march | 33.55 | 3 | 10 |
| 04 | S-hall | sponza | heavy | total | 33.65 | 3 | 10 |
| 05 | C-wide | cornell | default | march | 6.38 | 3 | 40 |
| 05 | C-wide | cornell | default | total | 6.5925 | 3 | 40 |
| 05 | C-wide | cornell | heavy | march | 37.76 | 3 | 10 |
| 05 | C-wide | cornell | heavy | total | 36.75 | 3 | 10 |
| 05 | S-hall | sponza | default | march | 8.795 | 3 | 40 |
| 05 | S-hall | sponza | default | total | 8.905 | 3 | 40 |
| 05 | S-hall | sponza | heavy | march | 50.13 | 3 | 10 |
| 05 | S-hall | sponza | heavy | total | 48.11 | 3 | 10 |
| 06 | C-wide | cornell | default | source | 0.0625 | 3 | 40 |
| 06 | C-wide | cornell | default | march | 13.8475 | 3 | 40 |
| 06 | C-wide | cornell | default | accum | 0.185 | 3 | 40 |
| 06 | C-wide | cornell | default | gcopy | 0.0475 | 3 | 40 |
| 06 | C-wide | cornell | default | compose | 0.095 | 3 | 40 |
| 06 | C-wide | cornell | default | total | 13.55 | 3 | 40 |
| 06 | C-wide | cornell | heavy | source | 2.855 | 3 | 40 |
| 06 | C-wide | cornell | heavy | march | 36.57 | 3 | 10 |
| 06 | C-wide | cornell | heavy | accum | 3.105 | 3 | 40 |
| 06 | C-wide | cornell | heavy | gcopy | 2.7175 | 3 | 40 |
| 06 | C-wide | cornell | heavy | compose | 2.6425 | 3 | 40 |
| 06 | C-wide | cornell | heavy | total | 36.55 | 3 | 10 |
| 06 | S-hall | sponza | default | source | 1.8625 | 3 | 40 |
| 06 | S-hall | sponza | default | march | 31.25 | 3 | 10 |
| 06 | S-hall | sponza | default | accum | 2.475 | 3 | 40 |
| 06 | S-hall | sponza | default | gcopy | 2.3675 | 3 | 40 |
| 06 | S-hall | sponza | default | compose | 2.3725 | 3 | 40 |
| 06 | S-hall | sponza | default | total | 31.31 | 3 | 10 |
| 06 | S-hall | sponza | heavy | source | 4.9175 | 3 | 40 |
| 06 | S-hall | sponza | heavy | march | 71.19 | 3 | 10 |
| 06 | S-hall | sponza | heavy | accum | 19.45 | 3 | 10 |
| 06 | S-hall | sponza | heavy | gcopy | 4.925 | 3 | 40 |
| 06 | S-hall | sponza | heavy | compose | 18.65 | 3 | 10 |
| 06 | S-hall | sponza | heavy | total | 67.63 | 3 | 10 |
