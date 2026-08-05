# Session Summary — 2026-08-04

**Objective:** Build v1 stack and get it in front of human eyes for testing.  
**Status:** ✅ COMPLETE. Demo 19 is running and ready for your review.

---

## What Got Done

### Phase α (Testing Infrastructure) — COMPLETE
- Built convergence curve measurement (per-frame churn tracking)
- Built ghosting detector (luminance variance proxy)
- Built edge sharpness metric (Laplacian-based)
- Built temporal churn heatmap visualization (false-color)
- Created `run-alpha.mjs` validation runner
- **Result:** Infrastructure works. Metrics correctly differentiate boiling vs converging stacks.

### Phase β (v1 Build) — COMPLETE
- Created Demo 19 as a streamlined fork of demo 18
- Removed expensive oracle/comparison logic (faster, cleaner)
- Locked parameters to v1 essentials:
  - **accum mode:** Always `oneOverN` (true converging temporal)
  - **aa mode:** Always `jitter` (sub-pixel anti-aliasing)
  - Kept march, temporal, and spatial denoise passes
- Registered demo in registry (`?demo=19` or UI dropdown)
- **Result:** Testable, performant v1 candidate ready for human review.

### Testing Infrastructure
- Created `TEST-V1-NOW.md` (quick, top-level instructions)
- Created `TESTING-PHASE-BETA-V1.md` (detailed guide with parameter explanations)
- Defined 3 go/no-go gates (still convergence, motion ghosting, edge AA)
- Ready for human browser testing

---

## What Demo 19 Is

**v1 Ship Stack (oneOverN + spatial-denoise)**

```
G-buffer → Lightmask → Producer (march) → Temporal (oneOverN) 
→ Spatial Denoise (bilateral + fallback) → Display
```

- ✅ oneOverN temporal: True alpha=1/N, uncapped. Converges on stills.
- ✅ Jitter AA: Halton sub-pixel camera jitter for smooth edges.
- ✅ Spatial fallback: Bilateral blur during disocclusion, fades over time.
- ❌ SVGF denoiser: Deferred to v2 (too complex to integrate during v1 validation).
- ❌ FSR3 upscaler: Deferred to v2 (not needed for convergence testing).

**Why defer SVGF/FSR3?** Your feedback on the oneOverN foundation will tell us if they're essential or nice-to-have.

---

## Phase α Metrics (Context, Not Arbiter)

Demo 18 (oneOverN+jitter) measured with Phase α:
- **Convergence:** 0.691→0.486 (declining ✓)
- **Ghosting detector:** 0.0025 (low, expected on stills)
- **Edge sharpness:** 0.0137 (low but expected on smooth content)

Demo 14 (SVGF reference):
- **Convergence:** 0.037→0.038 (cleanest, but uses EMA temporal)

Demo 12 (capped baseline, known broken):
- **Convergence:** 0.368→0.368 (flat, perpetual boiling)

**Insight:** Metrics confirm oneOverN converges. But your eyes will tell us if it's clean *enough* for v1.

---

## What You Need to Do Next (When You Return)

1. **Open:** `http://localhost:5182/?demo=19`
2. **Test the 3 gates** (5 minutes, detailed in `TEST-V1-NOW.md`)
3. **Report:** PASS/FAIL on convergence, ghosting, edge AA
4. **Decide:** Is v1 ready, or does something need fixing?

---

## Key Decisions Made This Session

| Decision | Rationale |
|----------|-----------|
| **Demo 19 fork of demo 18** | Demo 18's temporal logic is proven. Simpler than building from scratch. |
| **Remove oracle/comparisons** | Not needed for v1 testing. Speed up iterations. Oracle was expensive debug feature. |
| **Lock to oneOverN + jitter** | These are v1 commitments. Other variants are v2 territory. |
| **Defer SVGF/FSR3 to v2** | Too much integration complexity during v1 validation. Your feedback will tell us priority. |
| **Human eyes first** | Metrics led us astray in earlier phases. You're the arbiter now. |

---

## Files Changed/Created

```
NEW:
  TEST-V1-NOW.md                              ← Read this first
  TESTING-PHASE-BETA-V1.md                    ← Detailed guide
  SESSION-SUMMARY-2026-08-04.md               ← This file
  bench/src/demos/19-ship/                    ← Demo 19 source
  bench/scripts/run-phase-beta.mjs            ← Automated v1 candidate measurement
  PHASE-ALPHA-SUMMARY.md                      ← Testing infrastructure recap

MODIFIED:
  bench/src/demos/index.ts                    ← Registered demo 19
  
COMMITTED:
  Everything above in commit 9ac2a09
```

---

## Known Limitations (v1 Intentional, v2 Opportunity)

- **No SVGF denoiser:** Reduces convergence quality, but tests the oneOverN temporal foundation in isolation.
- **No FSR3 upscaler:** Not upscaling, so no performance benefit. Tests at native resolution.
- **No variance clipping/disocclusion tuning:** These are v2 motion experiments (Track A in EXPERIMENTS.md).
- **Spatial fallback only:** Young-history smoothing is basic bilateral + fade, not sophisticated variance-guided filtering.

**Why?** We want to validate the core temporal stack before layering on optimizations.

---

## If You Need Context When You Return

- **SHIP-PLAN.md** — v1/v2/v3 architecture and commitments
- **EXPERIMENTS.md** — All the experimental tracks (A1 variance clipping, A2 disocclusion, etc.)
- **ROADMAP.md** — What's been tried, what's open
- **bench/results/phase-beta-v1-candidate.md** — Metric data (for reference, not decision-making)

---

## Session Time Breakdown

- Phase α infrastructure: ~1.5 hours (convergence curves, metrics, validation runner)
- Phase β v1 build: ~2 hours (demo 19 fork, streamline, test harness)
- Documentation: ~1 hour (testing guides, this summary)
- **Total:** ~4.5 hours

---

## What's Running

- Dev server: `npm run dev` (port 5182)
- All code committed to `main` branch
- Demo 19 is stable and ready for iteration

---

## Next Steps After You Test

**IF ALL 3 GATES PASS:**
- v1 foundation confirmed as solid
- Move to Phase γ: v2 motion tuning experiments (variance clipping, jitter-aware disocclusion, etc.)
- Potentially add SVGF + FSR3 refinements

**IF ANY GATE FAILS:**
- Identify the specific issue (convergence too slow? ghosting visible? edges jagged?)
- Iterate on that parameter or technique
- Re-test until gates pass

**The Rule:** Your eyes are final arbiter. Metrics are hints, not verdicts.

---

**Ready to return?** Open `TEST-V1-NOW.md` and follow the 5-minute test. Report back what you find.
