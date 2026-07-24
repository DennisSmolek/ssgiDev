# lab18-temporal

- commit: cdbb280-dirty
- date: 2026-07-24T05:57:56.006Z
- baseUrl: http://localhost:5299/
- cam: 0,2.4,8.8,0,2.6,0
- scene: cornell
- settleMs: 2000
- windowMs: 12000
- stepMs: 1000
- shots: /private/tmp/claude-502/-Users-dex-Developer-ssgiDev/cc139dca-96ca-4dec-8943-dd5e876817c1/scratchpad/lab18
- rule: churnEarly/churnLate = mean of first/last 3 consecutive-frame meanAbsDiffs (1 s apart). Pass: oneOverN-jitter late < early AND late < 0.5 * capped64 late.
- failures: []

| demo | arm | view | churnEarly | churnLate |
|---|---|---|---|---|
| 18-temporal | capped64-jitter | combined | 0.58 | 0.5782 |
| 18-temporal | oneOverN-jitter | combined | 0.4471 | 0.2419 |
| 18-temporal | oneOverN-off | combined | 0.4135 | 0.2237 |
| 18-temporal | oneOverN-jitterClamp | combined | 1.278 | 1.2849 |
