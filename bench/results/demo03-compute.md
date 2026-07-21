# demo03-compute

- commit: 6f5b91e-dirty
- date: 2026-07-21T03:39:44.969Z
- baseUrl: http://localhost:5180/
- viewport: 1280x800
- bursts: 3
- itersPerBurst: 40

| cell | scene | cam | mipOptimization | rotationCount | stepCount | ms |
|---|---|---|---|---|---|---|
| C-wide | cornell | 0,2.4,8.8,0,2.6,0 | true | 2 | 12 | 2.1325 |
| C-wide | cornell | 0,2.4,8.8,0,2.6,0 | false | 2 | 12 | 2.755 |
| C-wide | cornell | 0,2.4,8.8,0,2.6,0 | true | 4 | 32 | 7.9825 |
| C-wide | cornell | 0,2.4,8.8,0,2.6,0 | false | 4 | 32 | 17.505 |
| C-graze | cornell | 1.4,3.6,4.6,0.95,1.3,0.7 | true | 2 | 12 | 3.58 |
| C-graze | cornell | 1.4,3.6,4.6,0.95,1.3,0.7 | false | 2 | 12 | 3.7275 |
| C-graze | cornell | 1.4,3.6,4.6,0.95,1.3,0.7 | true | 4 | 32 | 13.7425 |
| C-graze | cornell | 1.4,3.6,4.6,0.95,1.3,0.7 | false | 4 | 32 | 19.1125 |
| C-contact | cornell | 3.0,1.6,3.6,0.3,0.5,0.1 | true | 2 | 12 | 4.68 |
| C-contact | cornell | 3.0,1.6,3.6,0.3,0.5,0.1 | false | 2 | 12 | 3.9725 |
| C-contact | cornell | 3.0,1.6,3.6,0.3,0.5,0.1 | true | 4 | 32 | 13.865 |
| C-contact | cornell | 3.0,1.6,3.6,0.3,0.5,0.1 | false | 4 | 32 | 16.24 |
| S-hall | sponza | 11,1.8,-0.3,-10,2.6,-0.3 | true | 2 | 12 | 4.8575 |
| S-hall | sponza | 11,1.8,-0.3,-10,2.6,-0.3 | false | 2 | 12 | 6.14 |
| S-hall | sponza | 11,1.8,-0.3,-10,2.6,-0.3 | true | 4 | 32 | 18.9175 |
| S-hall | sponza | 11,1.8,-0.3,-10,2.6,-0.3 | false | 4 | 32 | 24.435 |
| S-column | sponza | 2.0,1.6,0.0,3.4,1.4,-2.6 | true | 2 | 12 | 4.135 |
| S-column | sponza | 2.0,1.6,0.0,3.4,1.4,-2.6 | false | 2 | 12 | 4.315 |
| S-column | sponza | 2.0,1.6,0.0,3.4,1.4,-2.6 | true | 4 | 32 | 9.9375 |
| S-column | sponza | 2.0,1.6,0.0,3.4,1.4,-2.6 | false | 4 | 32 | 19.7025 |
| Z-zoo | artifact-zoo | default | true | 2 | 12 | 1.8425 |
| Z-zoo | artifact-zoo | default | false | 2 | 12 | 1.7775 |
| Z-zoo | artifact-zoo | default | true | 4 | 32 | 8.7625 |
| Z-zoo | artifact-zoo | default | false | 4 | 32 | 10.4925 |
