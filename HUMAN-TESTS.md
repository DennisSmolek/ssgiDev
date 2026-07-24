# HUMAN-TESTS.md — structured perceptual test protocol

Why this exists: the automated battery measures stability (2-s screenshot
diff) and MSE-vs-oracle. MSE is numerically blind to temporal shimmer (~1.5/255
of noise contributes ~3e-5 to an MSE dominated by ~0.06 of shared bias), and a
single stability number can't distinguish "noise floor" from "converging
slowly." Human eyes are the instrument for: does noise actually *go away*,
does motion shimmer, do textures flicker, does history ghost. This protocol
makes those observations reproducible and recordable instead of anecdotal.

**Recording convention:** every observation row = (experiment id, demo, scene,
cam string, exported config JSON via the pane's copy / `__benchParams`, verdict,
free-text note, date, commit). Append rows to
`bench/results/human/HUMAN-RESULTS.md`. A verdict is one of:
**CLEAN** (defect not visible), **FLOOR** (defect visible, stable — doesn't
grow or shrink), **DIVERGES** (defect grows / flickers), plus optional
seconds-to-clean for convergence tests. Use the GRID_CAMS poses (TESTING.md)
so rows line up with the recorded battery cells.

Reset discipline: before every convergence observation, force a history reset
(teleport via camera bookmark restore, or toggle the stack away and back) and
start timing from the reset.

**Verdicts, plain language** (judge after ~30 s of settling, still camera):
- **CLEAN** — you can't see noise anymore; it converged away.
- **FLOOR** — noise settles to a constant visible level and stays; waiting
  never helps. Stable but noisy.
- **DIVERGES** — never settles: boils, flickers, or worsens over time.

**Two modes — always in this order:**
1. **Observe at defaults.** Every experiment starts with a verdict at
   as-shipped settings. This is the row comparable across stacks and against
   the recorded battery (which ran at defaults). Never skip it to go tuning.
2. **Probe / tune, per the experiment:**
   - **H-1 probing = one knob at a time, ANY knob.** Change one thing from
     defaults, reset history, observe, revert before the next probe. Record
     which knob changes the verdict and at what value (e.g. "accum-frameCap
     raised → VANISHES") — and which knobs do nothing ("temporalResponse in
     frame-count mode: floor moves slightly, never vanishes" is a
     near-dead-knob finding). One-knob probes are still H-1, however many
     knobs you probe in sequence.
   - **H-2 = multi-knob free tuning** toward the best overall LOOK (noise vs
     blur vs lag traded together), judged against the tuned demo-03
     reference. The moment you're combining knobs for aesthetics, you're in
     H-2.
   - H-5 is a structured one-knob sweep. H-3/H-4/H-6/H-7 stay at defaults.
   Record the config JSON for EVERY row where you touched anything —
   including failed attempts; dead knobs are findings (and likely wiring
   bugs).

**Pre-registered prediction (2026-07-24, test in H-1):** demo 10
`ssrt3-guides` — sweeping `guidesHistoryCap` should change NOTHING visible,
because the guides' history length N is computed but never consumed by the
blend (debug-view only, per the code map). Confirming this dead knob proves
the wiring gap behind the EMA noise floor from a second direction.

---

## H-1 — Still-camera convergence ladder (the "does noise go away" question)

The core experiment behind the demo-03 vs downstream discrepancy.

Load-and-view only — touch NOTHING except the stack/mode selector, for every
row including demo 03 (the tuned demo-03 reference belongs to H-2, not here).
The only interaction is the single extreme-knob probe at the END of each
stack's observation.

For each (demo, stack) in:
- demo 03 — accumMode `frame-count` (expected CLEAN reference)
- demo 03 — accumMode `ssrt3-ema`
- demo 10 — `ssrt3`, `ssrt3-guides`, `mathis`, `xegtao`
- demo 17 — `private-guides`, `fsr-guides`
- demo 14 — `bilateral`, `svgf-lite`, `svgf`, `ssrt3-guides`, `mathis`
- demo 12 — default

Protocol: cornell C-wide pose. Reset history. Sit perfectly still 30 s.
Watch where the indirect share of light is highest — that's where SSGI noise
lives (Dennis, 2026-07-24): the **shadowed side faces of both boxes** (lit
almost entirely by wall/floor bounce, with light/dark interplay), and the
**shadow interiors + penumbrae** on the floor. Do NOT judge by the directly
lit floor center — direct light masks producer noise there. Verdict per
stack: CLEAN / FLOOR / DIVERGES + seconds-to-clean (or "never" = FLOOR).
Then take the noisiest knob (temporalResponse / alpha / alphaMin) to its
extreme and record whether the floor MOVES or VANISHES.

Expected mechanism (verify, don't assume): count-based accumulators (03
frame-count, mathis, svgf's 1/N) should reach CLEAN; fixed-EMA stacks should
plateau at FLOOR no matter the knob. If an EMA stack reaches CLEAN, or a
count-based stack doesn't, that's a finding — write it down with the config.

## H-2 — Cross-demo parity hunt

Tune demo 03 frame-count to your best-looking cornell still. Copy the pose +
settings. Now spend up to 10 min in demo 10 (any stack) trying to match that
look by knobs alone. Record the closest config + what residual defect remains
(shimmer? blur? both?). Repeat in demo 17 and demo 14. This bounds "is the
downstream gap tunable or structural" — the answer feeds the accum-mode fix
decision.

## H-3 — Motion shimmer grade

Slow orbit (drag, ~5 s/rev) at C-wide and S-hall per stack. Grade 0–3 at
three surface classes: flat mid-tone, grazing-angle floor, high-contrast
texture (sponza banners). 0 = stable, 1 = faint shimmer only if you look for
it, 2 = obvious shimmer, 3 = boiling. Stop the orbit: note seconds until the
image stops changing.

## H-4 — Teleport ghosting

Save two camera bookmarks far apart (C-wide and C-graze work). Restore one
from the other while watching: ghost trails? how long until clean? Grade the
*character* of the recovery (fade = EMA-ish, fill-in-from-noisy = count reset,
smear = reprojection failure). Do per stack in demos 10 / 17 / 14. The
recorded reconvergeSeconds only measures WHEN diffs settle — this measures
WHAT it looks like on the way.

## H-5 — Texture flicker (the svgf-lite S-column finding)

S-column pose. Arms: svgf-lite, svgf at K=1..5 (atrousIterations knob),
ssrt3-guides. Watch the banner edges 15 s still + 5 s micro-orbit. Automated
result to check against: svgf-lite is unstable there (stability 0.9–2.7
across repeats), svgf@K=4 is the most stable arm; K=2 collapses on sponza.
Question for eyes only: is svgf-lite's instability a *flicker you'd notice in
use*, or a metric artifact? Is K=3 visually sufficient (cost midpoint)?

## H-6 — Noise-stress ladder (demo 14 noiseinject)

noiseInject on; σ ∈ {0.1, 0.3, 0.6}; fireflies on at 0.3. Per arm: does the
injected noise clean up, and — against the `reference` view — is the svgf
result softer (over-blur) at high σ? This is the human check on the spec §6
"à-trous over-blur" risk that our biased oracle cannot measure.

## H-7 — Real shading change (sponza torches)

Sponza, torch flicker toggle ON (deterministic sin). Per stack in demo 10/17:
do the bounce-lit surfaces track the flicker (good), lag it (EMA lag), or
ghost/boil (temporal failure)? This is the one scenario where LOW history is
correct — count-based accumulation that never forgets would smear here.
Note which stacks get it right; this is the counterweight to H-1 (any
accum-mode fix must not break this).

---

## Order of operations

H-1 and H-2 first — they directly test the EMA-floor hypothesis and decide
whether the α=1/N accum-mode fix is the answer. H-7 is the safety check on
that same fix. H-5/H-6 refine the SVGF verdict. H-3/H-4 round out motion.

When rows disagree with recorded battery numbers, the row wins for UX
decisions and triggers a metric review (what was the metric blind to?) — the
same way the shadow-bias episode was resolved by Dennis's observation
overruling the aliasing diagnosis.
