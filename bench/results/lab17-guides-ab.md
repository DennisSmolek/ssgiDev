# lab17-guides-ab

- commit: 4118871-dirty
- date: 2026-07-23T06:09:56.536Z
- baseUrl: http://localhost:5199/
- settleMs: 6000
- gapMs: 2000
- cam: 0,2.4,8.8,0,2.6,0
- scene: cornell
- m6: the FSR3 upscaler guides API drops @experimental when this A/B (fsr-guides matches or beats private-guides) passes — see GUIDES-HANDOFF.md.
- reconvergence: {"stacks": ["private-guides", "fsr-guides"], "camWide": "0,2.4,8.8,0,2.6,0", "camGraze": "1.4,3.6,4.6,0.95,1.3,0.7", "reconvWindowMs": 8000, "captureIntervalMs": 500, "rule": "first k where diff[k] <= threshold AND diff[k+1] <= threshold, threshold = max(still*1.5, still+0.3); reported = frame[k+1].t (real elapsed s).", "note": "ghosting/smear is a visual judgment \u2014 reconv frames saved under bench/results/shots/lab17/<stack>/ for human review, not scored here."}

| demo | stack | view | stability | reconvergeSeconds | reconverged | threshold |
|---|---|---|---|---|---|---|
| 17-guides-ab | private-guides | combined | 2.065 |  |  |  |
| 17-guides-ab | private-guides | guides | 0 |  |  |  |
| 17-guides-ab | fsr-guides | combined | 1.4182 |  |  |  |
| 17-guides-ab | fsr-guides | guides | 0 |  |  |  |
| 17-guides-ab | private-guides | reconv | 1.3984 | 1.275 | True | 2.0976 |
| 17-guides-ab | fsr-guides | reconv | 1.3984 | 1.288 | True | 2.0976 |
