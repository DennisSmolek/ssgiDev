# HUMAN-RESULTS — perceptual observation log

Protocol: [HUMAN-TESTS.md](../../../HUMAN-TESTS.md). Append-only, newest at
the bottom of each section. One row per observation.

How to fill a row:
- **verdict**: CLEAN / FLOOR / DIVERGES (+ `Ns` seconds-to-clean where the
  experiment asks; "never" = FLOOR). H-3 uses grade 0–3 instead.
- **config**: paste the exported JSON from the pane (copy button /
  `__benchParams`). At defaults, just write `defaults`. REQUIRED whenever you
  touched any knob — including failed attempts (dead knobs are findings).
- **cam**: the GRID_CAMS id (C-wide, S-column, …) or a `?cam=` string if
  custom.
- **note**: what you saw, in your words. Where the defect is, what it looks
  like, what a knob did or failed to do.

Get the date+commit for a session header with:
`date "+%Y-%m-%d" && git rev-parse --short HEAD`

---

## Session template (copy this block per sitting)

### Session YYYY-MM-DD @ <commit>

#### H-1 — Still convergence ladder
| demo | stack/mode | cam | verdict | secs-to-clean | knob probe (moved/vanished) | config | note |
|---|---|---|---|---|---|---|---|
| 03 | frame-count | C-wide |  |  |  | defaults |  |
| 03 | ssrt3-ema | C-wide |  |  |  | defaults |  |
| 10 | ssrt3 | C-wide |  |  |  | defaults |  |
| 10 | ssrt3-guides | C-wide |  |  |  | defaults |  |
| 10 | mathis | C-wide |  |  |  | defaults |  |
| 10 | xegtao | C-wide |  |  |  | defaults |  |
| 17 | private-guides | C-wide |  |  |  | defaults |  |
| 17 | fsr-guides | C-wide |  |  |  | defaults |  |
| 14 | bilateral | C-wide |  |  |  | defaults |  |
| 14 | svgf-lite | C-wide |  |  |  | defaults |  |
| 14 | svgf | C-wide |  |  |  | defaults |  |
| 14 | ssrt3-guides | C-wide |  |  |  | defaults |  |
| 12 | default | C-wide |  |  |  | defaults |  |

#### H-2 — Parity hunt (tuning mode)
| demo | stack | cam | closest-to-reference? | residual defect | config (REQUIRED) | note |
|---|---|---|---|---|---|---|
|  |  |  |  |  |  |  |

#### H-3 — Motion shimmer (grade 0–3: flat / grazing / texture)
| demo | stack | cam | flat | grazing | texture | secs-to-settle after stop | note |
|---|---|---|---|---|---|---|---|
|  |  |  |  |  |  |  |  |

#### H-4 — Teleport ghosting
| demo | stack | from→to | ghost? | secs-to-clean | recovery character (fade/fill/smear) | note |
|---|---|---|---|---|---|---|
|  |  |  |  |  |  |  |

#### H-5 — Texture flicker sweep (S-column)
| arm | K | verdict | note |
|---|---|---|---|
| svgf-lite | — |  |  |
| svgf | 1 |  |  |
| svgf | 2 |  |  |
| svgf | 3 |  |  |
| svgf | 4 |  |  |
| svgf | 5 |  |  |
| ssrt3-guides | — |  |  |

#### H-6 — Noise ladder (demo 14, defaults per arm)
| arm | σ | fireflies | cleans up? | over-blur vs reference? | note |
|---|---|---|---|---|---|
|  |  |  |  |  |  |

#### H-7 — Torch flicker (sponza, defaults)
| demo | stack | tracks/lags/ghosts | note |
|---|---|---|---|
|  |  |  |  |

#### Free findings
Anything that didn't fit a row: dead knobs, wiring suspicions, "this demo
looks broken", ideas.

---

<!-- Sessions append below this line -->
