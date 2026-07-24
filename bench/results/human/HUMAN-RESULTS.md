# HUMAN-RESULTS — perceptual observation log

Protocol: [HUMAN-TESTS.md](../../../HUMAN-TESTS.md) (rewrite 2026-07-24:
Pass 1 look-only, Pass 2 guided experiments A–E). Append-only.

Verdicts: CLEAN / FLOOR-static (frozen grain) / FLOOR-live (quality stops
improving but the grain visibly crawls) / DIVERGES (never settles).

Session header: `date "+%Y-%m-%d" && git rev-parse --short HEAD`

---

## Session template (copy per sitting)

### Session YYYY-MM-DD @ commit

#### Pass 1 — look only (defaults, 30 s, one sentence each)

| # | demo | stack | verdict | one sentence |
| --- | ---- | ----- | ------- | ------------ |
| 1 | 03 | ssrt3-ema | | |
| 2 | 03 | frame-count | | |
| 3 | 10 | ssrt3 | | |
| 4 | 10 | ssrt3-guides | | |
| 5 | 10 | mathis | | |
| 6 | 10 | xegtao | | |
| 7 | 17 | private-guides | | |
| 8 | 17 | fsr-guides | | |
| 9 | 14 | bilateral | | |
| 10 | 14 | svgf-lite | | |
| 11 | 14 | svgf | | |
| 12 | 14 | ssrt3-guides | | |
| 13 | 12 | default | | |

#### Pass 2 — experiments (freeform, one block per experiment)

**A — demo 03 boil-stop attempt:**
(closest-to-CLEAN combo; did ANY setting fully stop motion?)

**B — demo 10 dead-knob test** (dead/alive one line each):
- guides history cap 4→256:
- ssrt temporalResponse →0.05:
- guides disocc lo/hi (still camera):

**C — rotation-noise gap (10 vs 03):**
(noise during rotation; jitter toggle effect; TRAA effect; 03 comparison)

**D — demo 17 twins check:**
(any visible difference private vs fsr, still + rotating?)

**E — demo 14 SVGF knobs:**
- K ladder — stops improving at K=
- alphaMin 0.05→0.01 / →1.0:
- sigmaLum 0.5 / 4 / 15 — best tradeoff:
- noiseinject σ0.3+fireflies — bilateral vs svgf:

#### Keeper configs (paste pane JSON for settings worth keeping)

| demo/stack | why it's a keeper | config JSON |
| ---------- | ----------------- | ----------- |
| | | |

#### Free findings
(one line each: dead knobs, looks-broken, surprises)

---

## Archive — session 1 (2026-07-24 @ 8c064c8, pre-rewrite format)

| demo | stack/mode     | cam    | verdict    | secs-to-clean | knob probe (moved/vanished)           | config   | note |
| ---- | -------------- | ------ | ---------- | ------------- | ------------------------------------- | -------- | ---- |
| 03   | frame-count    | C-wide | FLOOR-live | Never         | accum-frameCap, denoisingRadius       | defaults | FrameCap had measurable quality changes from 4-16 but 16-60 the differnces were neglegable. The denoising radius had some improvement but even when slight the boiling effect could still be percieved. MUST NOTE: its very high quality visibly. It just never settles. |
| 03   | ssrt3-ema      | C-wide | FLOOR-Live | Never         | temporalAccumulation, denoiseRadius   | defaults | fro 0-0.1 give the most stable response but some motion is always visible. again the radius helps. Similar quality to the other mode. |
| 10   | ssrt3          | C-wide | Floor-Live | Never         | ssrt temporalResponse denoisingRadius | defaults | similar to demo03 it remains high quality but never settles. Changing to 0.05 gets good results and adjusting the radius makes improvements but when looking at edges motion is perceptible (not a huge problem if quality is high) This demo also has serious noise when rotating the camera that the 03 demo does not have when at the same settings. If I turn TRAA on its less noticable. |
| 10   | ssrt3-guides   | C-wide | Floor-live | never         |                                       | defaults | |

---

<!-- Sessions append below this line -->
