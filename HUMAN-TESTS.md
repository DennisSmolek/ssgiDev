# HUMAN-TESTS — the perceptual test process (rewrite 2026-07-24)

Two passes, done separately. Pass 1 you touch nothing. Pass 2 is a guided
list of specific controls with plain-language explanations. Log rows go in
[bench/results/human/HUMAN-RESULTS.md](bench/results/human/HUMAN-RESULTS.md).

**Where to look (always):** the shadowed side faces of the two boxes (lit
only by bounced light — noise shows at full strength there) and the shadow
edges on the floor. NOT the brightly lit floor center.

**Verdict words:**
- **CLEAN** — no visible noise after settling.
- **FLOOR-static** — visible grain but frozen: nothing moves.
- **FLOOR-live** — quality stops improving but the grain visibly
  crawls/boils forever.
- **DIVERGES** — never settles; flickers or worsens.

**Reset before judging:** switch the stack away and back (or reload the
page). Then wait ~30 s before writing the verdict.

---

# PASS 1 — Look only (~20 min, touch nothing but the URL)

Load each link, wait 30 s, write ONE verdict + one sentence in the Pass-1
table. The dropdown named in [brackets] is the only thing you may change,
and only to select the row's stack.

Base URL: `http://localhost:5199/`  (all links use the same wide cornell pose)

| # | open | then set [dropdown] to | 
|---|---|---|
| 1 | `?demo=03-ssrt3&cam=0,2.4,8.8,0,2.6,0` | [accumulation] `ssrt3-ema` |
| 2 | same page | [accumulation] `frame-count` |
| 3 | `?demo=10-denoise&cam=0,2.4,8.8,0,2.6,0` | [denoiser stack] `ssrt3` |
| 4 | same page | [denoiser stack] `ssrt3-guides` |
| 5 | same page | [denoiser stack] `mathis` |
| 6 | same page | [denoiser stack] `xegtao` |
| 7 | `?demo=17-guides-ab&cam=0,2.4,8.8,0,2.6,0` | [guide source] `private-guides` |
| 8 | same page | [guide source] `fsr-guides` |
| 9 | `?demo=14-svgf&cam=0,2.4,8.8,0,2.6,0` | [denoiser arm] `bilateral` |
| 10 | same page | [denoiser arm] `svgf-lite` |
| 11 | same page | [denoiser arm] `svgf` |
| 12 | same page | [denoiser arm] `ssrt3-guides` |
| 13 | `?demo=12-distilled&cam=0,2.4,8.8,0,2.6,0` | (nothing — as loaded) |

That's the whole pass. Don't fix anything, don't explore.

---

# PASS 2 — Guided experiments (exact controls, plain words)

Each experiment says: which page, which control (by its on-screen label),
what that control actually does, what to do with it, and what to write
down. Do them in order; reset (stack away/back) between experiments.

## Mini-glossary (read once)

- **History / temporal accumulation** — the denoiser blends each new frame
  with an average of past frames. More history = calmer image, but slower to
  react when things change.
- **temporalResponse** — how much of each NEW frame gets mixed in (0–1).
  0.35 means 35% new. LOWER = calmer but laggier. Because it always mixes in
  a fixed slice of fresh noise, it can reduce the boil but never stop it.
- **accumFrameCap / history cap** — how many frames the running average is
  allowed to build up. The leftover boil shrinks as the cap grows (1/cap).
- **Disocclusion** ("disocc") — when the camera or an object moves, some
  pixels reveal surfaces that were hidden last frame. Those pixels have no
  valid history, and the detector marks them so stale color isn't smeared
  on. On a STILL camera this machinery should be doing nothing at all.
  - **disocc lo / hi** — how touchy the detector is (lo = ignore below,
    hi = fully flag above). Matters at edges during motion only.
  - **N-reset disocc** — how flagged a pixel must be before its history
    counter restarts from zero.
- **Bilateral / denoisingRadius** — a smart blur that avoids crossing
  edges. Radius = how wide it reaches. Kills leftover specks, adds softness.
- **à-trous K (atrousIterations)** — SVGF's blur applied K times with
  doubling reach. More K = wider cleanup, more cost.
- **sigmaLum** — how strongly a brightness difference blocks SVGF's blur.
  LOW = preserves detail, keeps more noise. HIGH = blurs across more.
- **alphaMin** — SVGF's floor on "how slow can accumulation get." LOWER =
  allowed to average longer = calmer. This is the closest thing to "let it
  fully converge."
- **noiseinject** — replaces the live noisy input with the clean reference
  plus KNOWN fake noise (noiseSigma = amount, fireflyRate = bright sparkle
  pixels). Lets you judge pure denoiser skill.

## Experiment A — demo 03: can the boil ever fully stop?
Page: `?demo=03-ssrt3&cam=0,2.4,8.8,0,2.6,0`
1. [accumulation] = `frame-count`. Drag **accumFrameCap** slowly 4 → 64.
   The boil should get quieter as you go up. Question: at 64, with 30 s of
   stillness, is it CLEAN or still FLOOR-live?
2. [accumulation] = `ssrt3-ema`. Drag **temporalResponse** down to ~0.02.
   Same question. (Expected: calmer, never CLEAN.)
3. Either mode: drag **denoisingRadius** 0 → 1. What does it trade?
   (Expected: specks vanish, image softens, boil dampens but survives.)
Write: the closest-to-CLEAN combo you found and whether ANY setting made
motion fully stop.

## Experiment B — demo 10: the dead-knob test (the one I most need)
Page: `?demo=10-denoise&cam=0,2.4,8.8,0,2.6,0`, [denoiser stack] = `ssrt3-guides`
1. Drag **guides history cap** end to end, 4 → 256, slowly, watching the
   boxes' shadowed faces. MY PREDICTION: absolutely nothing changes. Write
   down whether you see ANY difference (if yes, at what value).
2. Now drag **ssrt temporalResponse** down to ~0.05. (Expected: this one
   DOES calm it — it's the knob that actually reaches the blend.)
3. Still camera: drag **guides disocc lo/hi** anywhere. (Expected: no
   visible change while still — this machinery only acts under motion.)
Write: dead or alive for each of the three, one line each.

## Experiment C — demo 10 vs 03: the rotation-noise gap you found
1. In demo 10, stack `ssrt3`, defaults: rotate the camera slowly (drag).
   Note the noise level DURING rotation.
2. Toggle **subpixel AA jitter (off under TRAA)** on and off while
   rotating — difference?
3. Toggle **TRAA after (combined)** on — difference?
4. Same rotation in demo 03 (defaults). Is 03 really calmer during motion
   at the same settings? Write what you see — this is a suspected real bug.

## Experiment D — demo 17: the two guide sources must be twins
Page: `?demo=17-guides-ab&cam=0,2.4,8.8,0,2.6,0`
1. Flip [guide source] `private-guides` ↔ `fsr-guides` several times, still
   camera, then during slow rotation. They should be indistinguishable.
   ANY visible difference (noise, lag, edges) = finding, write it down.

## Experiment E — demo 14: SVGF's knobs, one at a time
Page: `?demo=14-svgf&cam=0,2.4,8.8,0,2.6,0`, [denoiser arm] = `svgf`
1. **atrousIterations K (svgf only)**: step 1→2→3→4→5. At which K does the
   image stop visibly improving?
2. **alphaMin**: drag 0.05 → 0.01. Does the remaining boil quiet further /
   stop? Then drag to 1.0 (accumulation off) to see the raw noise for
   contrast.
3. **sigmaLum**: 0.5 vs 4 vs 15. LOW should look crisper but noisier;
   HIGH softer but cleaner. Which is the best tradeoff to your eye?
4. Turn **noiseinject enabled** ON, **noiseSigma** 0.3, **fireflyRate**
   0.01. Compare arms [denoiser arm]: `bilateral` vs `svgf` under identical
   fake noise. Which cleans it, which leaves residue, does svgf over-soften?
Write: best-looking svgf settings (paste config JSON — keeper), K verdict,
alphaMin verdict, noiseinject comparison in a sentence.

## Anything else
Free findings section in the log: dead knobs, "this looks broken,"
surprises. One line each is plenty.

## Experiment F — demo 18: the α=1/N + jitter candidate (added 2026-07-24)

Page: `?demo=18-temporal&cam=0,2.4,8.8,0,2.6,0`. All controls are in the
**temporal & denoise** group. Defaults = the candidate arm:
[accumulation] `oneOverN`, [AA] `jitter`, bluenoise, [denoising] OFF.

Your 2026-07-24 verbal report already answered F1 (still: "looks amazing")
and half of F4 (rotation: heavy ghosting, artifacts persist). The
remaining steps below are the ones that still change decisions.

**Why the ghosting happens (so F4 makes sense):** `oneOverN` keeps
UNCLAMPED history with uncapped age — that's exactly why stills converge
to zero. But GI is screen-space and view-dependent: when you rotate, the
bounce lighting *itself* changes, and a pixel with age N=1000 blends the
new correct shading in at 1/1000 per frame. Nothing rejects the stale
history because the *geometry* still reprojects correctly — only the
shading is wrong. Ghosts that "stay visible" are stale history draining
at 1/N. This is the known, measured trade of the unclamped arm, not a
broken build — and the A/B in F4 exists to see the other side of the
trade.

1. **F1 — still convergence (done, formalize the row):** defaults, hands
   off, 60 s. Verdict word + secs-to-clean in the log.
2. **F2 — edge AA:** after it settles, look at the box top edges and
   corners (the "terrible aliasing" you flagged in 12). Smooth now? Then
   set [AA] `off`, wait ~10 s — edges should re-alias while noise stays
   converged. Back to `jitter`. Write: does jitter visibly fix the edges?
3. **F3 — see the old floor (the root-cause A/B):** [accumulation]
   `capped`, wait 30 s — this is demo 12's shipped behavior; the grain
   should crawl forever (FLOOR-live). Back to `oneOverN` — the grain
   should drain away completely. This one A/B is the whole diagnosis.
4. **F4 — the motion trade (MOST NEEDED):** rotate the camera the same
   way that ghosted, then set [AA] `jitterClamp` and rotate the SAME way.
   Expected: ghost trails mostly gone (the clamp forcibly evicts stale
   history), but live grain returns in the shadowed faces — measured at
   ~2× the capped floor. Write TWO lines: (a) does jitterClamp kill the
   ghosting in motion? (b) how bad is its standing grain on stills vs
   `oneOverN`? This decides whether ship needs a motion-adaptive clamp
   (the variance-clipping experiment, EXPERIMENTS.md A1).
5. **F5 — recovery ramp:** from defaults, rotate then stop dead. Count
   seconds until the shadowed faces look clean. Then [spatial fallback]
   OFF and repeat — is the ramp visibly uglier (raw boil) without it?
   Then try [fallback nMin] 8 → 32 — does the hand-off get smoother?
6. **F6 (optional) — capped ladder:** [accumulation] `capped`,
   [accumFrameCap] 64 → 256 → 1024, ~20 s each. Does the standing grain
   visibly drop as the cap rises (it should — floor ~ 1/√cap), and is
   1024 "clean enough" to your eye?
