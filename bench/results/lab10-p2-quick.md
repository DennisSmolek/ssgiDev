# lab10-p2-quick

- commit: 9071f9c-dirty
- date: 2026-07-21T07:50:02.737Z
- baseUrl: http://localhost:5180/
- settleMs: 2000
- gapMs: 1000
- cam: 0,2.4,8.8,0,2.6,0
- scene: cornell
- reconvergence: {"stacks":["ssrt3","ssrt3-guides"],"camWide":"0,2.4,8.8,0,2.6,0","camGraze":"1.4,3.6,4.6,0.95,1.3,0.7","reconvWindowMs":3000,"captureIntervalMs":500,"rule":"first k where diff[k] <= threshold AND diff[k+1] <= threshold, threshold = max(still*1.5, still+0.3); reported = frame[k+1].t (real elapsed s).","note":"ghosting/smear is a visual judgment — reconv frames saved under bench/results/shots/lab10/<stack>/ for human review, not scored here."}
- note: quick smoke run — not a recorded number

| demo | stack | view | stability |
|---|---|---|---|
| 10-denoise | none | combined | 7.1188 |
| 10-denoise | none | gi | 33.9427 |
| 03-ssrt3 | accumMode=ssrt3-ema | gi | 3.1277 |
| 10-denoise | ssrt3 | reconv | 1.4029 |
| 10-denoise | ssrt3-guides | reconv | 0.8528 |
