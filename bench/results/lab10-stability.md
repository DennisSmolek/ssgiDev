# lab10-stability

- commit: 6f5b91e-dirty
- date: 2026-07-21T03:45:36.473Z
- baseUrl: http://localhost:5180/
- settleMs: 6000
- gapMs: 2000
- cam: 0,2.4,8.8,0,2.6,0
- scene: cornell

| demo | stack | view | stability |
|---|---|---|---|
| 10-denoise | none | combined | 10.0531 |
| 10-denoise | none | gi | 47.5124 |
| 10-denoise | ssrt3 | combined | 2.0663 |
| 10-denoise | ssrt3 | gi | 6.8338 |
| 10-denoise | mathis | combined | 0.0959 |
| 10-denoise | mathis | gi | 0.4591 |
| 10-denoise | xegtao | combined | 0.2087 |
| 10-denoise | xegtao | gi | 1.1103 |
| 10-denoise | denoise-node | combined | 4.8303 |
| 10-denoise | denoise-node | gi | 8.4185 |
| 03-ssrt3 | accumMode=ssrt3-ema | gi | 4.895 |
| 03-ssrt3 | accumMode=frame-count | gi | 1.4992 |
