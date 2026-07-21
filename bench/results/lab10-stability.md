# lab10-stability

- commit: d6e441f-dirty
- date: 2026-07-21T07:55:34.124Z
- baseUrl: http://localhost:5180/
- settleMs: 6000
- gapMs: 2000
- cam: 0,2.4,8.8,0,2.6,0
- scene: cornell
- reconvergence: {"stacks":["ssrt3","ssrt3-guides"],"camWide":"0,2.4,8.8,0,2.6,0","camGraze":"1.4,3.6,4.6,0.95,1.3,0.7","reconvWindowMs":8000,"captureIntervalMs":500,"rule":"first k where diff[k] <= threshold AND diff[k+1] <= threshold, threshold = max(still*1.5, still+0.3); reported = frame[k+1].t (real elapsed s).","note":"ghosting/smear is a visual judgment — reconv frames saved under bench/results/shots/lab10/<stack>/ for human review, not scored here."}

| demo | stack | view | stability |
|---|---|---|---|
| 10-denoise | none | combined | 11.0481 |
| 10-denoise | none | gi | 9.6577 |
| 10-denoise | ssrt3 | combined | 2.0619 |
| 10-denoise | ssrt3 | gi | 7.0936 |
| 10-denoise | ssrt3-guides | combined | 1.4864 |
| 10-denoise | ssrt3-guides | gi | 7.1999 |
| 10-denoise | mathis | combined | 0.0788 |
| 10-denoise | mathis | gi | 0.2978 |
| 10-denoise | xegtao | combined | 0.2126 |
| 10-denoise | xegtao | gi | 1.1156 |
| 10-denoise | denoise-node | combined | 4.7363 |
| 10-denoise | denoise-node | gi | 8.0029 |
| 03-ssrt3 | accumMode=ssrt3-ema | gi | 4.6214 |
| 03-ssrt3 | accumMode=frame-count | gi | 1.8608 |
| 10-denoise | ssrt3 | reconv | 2.3014 |
| 10-denoise | ssrt3-guides | reconv | 2.3019 |
