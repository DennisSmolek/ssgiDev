# SSGI Bench — Strategic Audit & Outline for Final Product

**Purpose:** A clean-slate reset after reading the full history (ROADMAP, EXPERIMENTS, HUMAN-TESTS, GUIDE, NEXTGEN, WORKLOG, and three detailed audits of demos, testing infrastructure, and FSR3 integration). This document synthesizes current state into explicit goals, failure modes, and a phased path to ship.

**Status:** For user review and approval before execution spawns. Framed per standing rule: metric wins are *candidates* pending eye validation; only Dennis's human pass confirms a fix is actually solved.

---

## PART 1: AUDIT — Where We Are



### 1.1 Working Research & Infrastructure

**Core pieces for v1 ship:**

- **Converging temporal accumulation (demo 18's oneOverN arm)** — α=1/N unclamped accumulation converges to zero noise (metric: 0.447→0.242 falling vs capped control flat at 0.58). Still-camera verdict: "looks amazing." Motion introduces smearing (stale history drains at 1/N per frame). This is the temporal foundation for v1; it solves demo 12's perpetual-boiling floor.
- **SVGF denoiser (demo 14)** — Spatio-Temporal Variance-Guided Filter. Converges boiling during motion, **resolves when camera stops** (unlike capped EMA's perpetual floor). Render quality is excellent. Aliasing exists (edges jagged) but SVGF solves the *boiling* problem. This is the **key quality uplift** that makes v1 ship-ready. Paired with oneOverN, gives still-camera convergence + motion robustness.
- **FSR3 upscaler (ported, @pmndrs/upscaler v0.2.0)** — the native-standard temporal upscaler. Used in shipping games/engines. Handles both anti-aliasing (temporal AA, jitter) and performance (lower-res rendering). Integration has issues (demo 16 is broken), but the library itself is solid. Core to achieving native-class performance on web.
- **TemporalGuidesPass** — shared pre-pass (dilated velocity, disocclusion, history length), consumed by SVGF and FSR3. Validated in demo 17-guides-ab (M6 PASSED: bit-identical still-camera, same reconvergence timing). Proven, load-bearing.
- **FSR3 guides API (M0–M6)** — fully resolved, shipped, no longer `@experimental`. Not in dispute.

**Research foundation (for v2 and beyond):**

- **Demos 03–11** — frozen measurement instruments. Valid references.
- **Publication drafts** — six complete drafts (methodology, negative results, temporal mechanics, upsampling, adaptive march, distillation). Ready for final revision once v1 results are in.
- **Temporal mechanics survey (research/sources/temporal/)** — 11 topics, literature grounded, mapped to experiments in EXPERIMENTS.md. v2 motion tuning will draw from this.



### 1.2 Current Demos — All Non-Shippable (Fail Verdict)

- **Demo 12 (capped-EMA accumulator, current baseline)** — Boils at rest, never settles. Mathematically cannot converge (finite floor is structural). Aliasing is "terrible" on edges. **Verdict: FAIL.** This is what we're trying to beat, not build upon.
- **Demo 16 (FSR3 full-pipeline integration)** — Jittery, blurry, GI quality non-functional or unclear. **Verdict: FAIL.** FSR3's own SSGI demo is significantly better, indicating either our GI producer, our integration, or both need rethinking.
- **Demo 18 (oneOverN + SVGF)** — Still-camera convergence works (metric + visual "looks amazing"). But smearing persists after motion stops and happens during motion (stale history draining at 1/N under view-dependent shading changes). Missing probe fallbacks. **Verdict: FAIL on motion trade.** High potential if smearing resolved + fallbacks added, but currently non-functional as a ship product.



### 1.3 Gaps & Open Design Questions

- **Aliasing solution at upscaler level** — Demo 14 has high render quality but jagged edges. Demo 18's jitter AA fixes aliasing on the still frame but introduces smearing under motion. The challenge: how do we use FSR3 upscaling for performance without introducing smearing? Can FSR3's temporal logic work better with our temporal accumulation? Can we leverage FSR3's other passes (dilated depth, disocclusion, etc.) to solve this?
- **Motion boiling tuning** — Demo 14 boils during motion but settles at rest (unlike demo 12's perpetual floor). Motion boiling is tunable, likely via motion vector data and fallback strategies. Not yet explored systematically.
- **Residual noise under motion / young history** — every stack has some noise during camera movement. Demo 18's spatialFallback is a first attempt. Comprehensive "young history" fallbacks may be needed for lower-end hardware tiers.
- **IGN vs bluenoise sampling default** — banding vs floor trade. Lab 11's ranking (IGN superior) is suspect because it was measured with a broken IGN temporal advance. Lab 11 re-rank needed post-fix (P2 task).
- **Convergence metrics across all demos** — Only lab 18 measures boiling as a time-series. Everywhere else is single-snapshot, which cannot distinguish "converged" from "boiling at a constant rate." This measurement gap caused false verdicts before and makes it hard to validate new work.



### 1.4 Testing/Measurement Gaps (Critical — This Is Why You Rely on Eyes)

**Automated convergence metric:**

- Only demo lab 18 measures noise as a convergence-curve (per-second churn over time, churnEarly vs churnLate slope).
- Everywhere else: single before/after snapshot, cannot distinguish "converged" from "boiling at a constant rate."
- Precedent: an ssrt3 stack once returned stability 0.0000 from a *black canvas* (broken binding), metric said "perfect," human eye said "something's very wrong."

**Aliasing / edge-quality metric:**

- Zero automated measurement exists anywhere.
- Only lab 18 has box-crop screenshots (t≈1s vs t≈10s) meant for human eyeballing.
- No frequency-domain, gradient, or edge-sharpness scalar.

**Noise visualization:**

- No per-pixel diff heatmap (to see WHERE boiling concentrates vs aggregating to a scalar).
- No false-color temporal-churn heatmap.
- No side-by-side / GIF / video comparison tool (frames are saved as PNG sequences but not stitched).

**Regression coverage:**

- All runners are manual (`node scripts/run-XX.mjs`).
- Require headed Chrome + idle GPU (explicit caveat: "never run against a busy GPU").
- Zero CI / automated cadence.
- Regressions caught opportunistically (Dennis notices by eye first, THEN the metric is diagnosed).

**Reconvergence metric is non-differentiator:**

- 0.5s capture cadence → ~1.5–2s detection floor.
- All tested demos reconverge at this floor.
- Cannot distinguish fast vs slow reconvergence at resolution that matters.

**History of false verdicts:**

- Lab 11: measure-hook race produced non-monotone MSE, misdiagnosed, caught only by inconsistency.
- run-12: absolute stability gate (0.40) false-failed a legitimate result after scene change.
- demo 14: stability recorded with camera-jitter bug in all arms; absolute values inflated, only ranking salvageable (caught by Dennis verbal "SUPER jittery").
- Capped-EMA floor itself: passed automated gates while human called it FLOOR-live (never settles).

**Bottom line:** Automated metrics measure one dimension (noise floor, cost, MSE vs oracle) reasonably well. They fail catastrophically at distinguishing "actually solved" from "looks solved on this one number." Convergence, aliasing, and boiling require time-series visibility + human eye. This is why you've had to review everything manually.

---



## PART 2: OUTLINE — "Make the Next Great SSGI on the Web"



### 2.1 Vision & Architecture

**Vision:** Native-quality SSGI ported to the web. Production workhorse that ships, converges at rest, prevents ghosting, runs efficiently via upscaling, with fallback tiers for hardware variance.

**Ship Strategy: v1 → (optional v2)**

**v1 (Stable, Ship-Ready Target):**

- VBAO base + converging temporal (oneOverN) + FSR3 upscaling + **SVGF denoising**
- Still camera: **converges clean** (fixes demo 12's perpetual boiling via SVGF)
- Motion: **acceptable temporal grain/noise** (not optimized), **ZERO ghosting** (no stale GI drifting into open space or obscuring detail)
- Anti-aliased via FSR3 + jitter AA
- Performant via lower-res render + FSR3 upscale
- Fallback: if v2 doesn't work out, v1 ships anyway and is usable

**v2 (Ambitious Reach Goal, Optional):**

- Same v1 stack + motion-boiling tuning (variance clipping, jitter-aware disocclusion, spatial fallbacks for young history)
- Goal: reduce motion temporal grain while maintaining zero ghosting
- If lands: even better motion quality; if not, v1 is the win

**Core Success Criteria (v1):**

1. **Still-camera convergence** — no perpetual boiling (unlike demo 12).
2. **Zero ghosting** — no stale GI artifacts (unlike demo 18's smearing).
3. **Anti-aliased** — no jagged edges (unlike demo 14).
4. **Performant** — upscaler-driven (not full-rez).
5. **Motion robustness** — acceptable noise/grain during motion is fine; ghosting is not.

**Architecture (v1 full stack):**

1. **Producer:** VBAO base (bitmask visibility).
2. **Temporal accumulation:** oneOverN (converges to zero floor, unlike capped EMA).
3. **Denoising:** SVGF (fixes still-camera boiling, handles motion robustly).
4. **Upscaling:** FSR3 (standard native library, handles both AA + perf).
5. **Spatial fallback:** for young history under motion (optional, tunable in v2).

**Progressive Hardware Tiers:**

- **High-end:** VBAO + oneOverN + SVGF + FSR3 upscale (full v1)
- **Mid-tier:** VBAO + oneOverN + FSR3 upscale, SVGF optional or off
- **Low-end:** VBAO + EMA temporal (if oneOverN doesn't fit), spatial fallback, no upscale or upscale at 1/4 res
- **Mobile:** Basic VBAO + spatial denoise (if applicable)

**Outputs:**

- v1 ship demo (clean-slate integration of VBAO + oneOverN + FSR3 + SVGF).
- Separate branch or package: isolated ship track.
- Measurement infrastructure (convergence curves, ghosting/aliasing metrics).
- v2 experimentation ground (motion tuning, if v1 succeeds and motivation remains).
- Research artifact & updated publications (methodology, findings, results).

**Ambitions:**

- Three.js ecosystem: production-grade SSGI, native-quality for the web.
- Prove that converging temporal + SVGF + FSR3 is a solid v1 baseline.
- Document the measurement methodology (how to validate GI algorithms, catch ghosting, perceptual gates).
- Optional: push to v2 with motion tuning if time/energy allows.



### 2.2 Key Design Questions for v1 (P0)

**v1 target: VBAO + oneOverN + FSR3 + SVGF. Prove it ships.**

1. **Do oneOverN + SVGF + FSR3 converge cleanly at rest?**
  - Demo 18 (oneOverN alone) converges but smears in motion.
  - Demo 14 (SVGF alone) converges at rest but has aliasing.
  - **Question:** Do they work together cleanly, or does SVGF + upscaler introduce new problems?
  - **Approach:** Build clean demo with all three. Measure still-camera convergence (churn curves). Eyes: does it converge as expected?
2. **Does FSR3 introduce ghosting?**
  - Demo 16 (current FSR3 integration) is broken (jittery/blurry), but that may be integration fault, not FSR itself.
  - **Question:** When integrated correctly with oneOverN + SVGF, does FSR3 avoid ghosting (stale GI drifting into wrong places)?
  - **Measurement:** Specifically detect ghosting artifacts (GI appearing where no object exists, or obscuring detail where it shouldn't). This is the hard failure mode to catch.
  - **Approach:** Build demo, test motion + camera rotation, eyes + metric for "ghosting present/absent."
3. **Anti-aliasing: FSR3 AA + jitter AA, or one or the other?**
  - Demo 14 (no AA) has jagged edges but converges.
  - Demo 18 (jitter AA) has smooth edges but smears.
  - **Question:** What's the cleanest AA strategy? FSR3's temporal AA alone? Jitter only? Both?
  - **Approach:** Build aliasing measurement (edge-sharpness scalar), A/B AA strategies, validate with eyes.
4. **Testing infrastructure: can we measure convergence + ghosting + aliasing?**
  - Current metrics gave false verdicts before (capped EMA passed gates but looked broken).
  - **Critical:** convergence curves (per-frame churn over time), ghosting detection (artifacts moving wrong), aliasing/edge-sharpness.
  - **Approach:** Build Phase α infrastructure. Validate that measurements correlate with your eye judgments.



### 2.3 Phased Plan: v1 Ship + Optional v2 Motion Tuning



#### Phase α: Testing Infrastructure (P0, ~2–3 days)

**Blocking everything else.** Without this, we can't validate anything.

1. **Convergence-curve logging (per-frame churn over time)**
  - Generalize lab 18's churn: per-second over 12s, churnEarly/churnLate, slope.
  - Pass gate: churnLate ≤ floor + ε, monotonic decline.
  - **Output:** convergence curves + pass/fail per run.
2. **Ghosting detection (visual artifact metric)**
  - Identify frame regions where GI appears where it shouldn't (empty space, wrong surfaces).
  - Metric: frame-to-frame reprojection mismatch + luminance anomaly (bright GI in dark regions).
  - **Output:** ghosting score (low = good, high = artifacts present).
3. **Aliasing measurement (edge-sharpness scalar)**
  - Frequency-domain or Laplacian-gradient-magnitude for edge quality.
  - **Output:** edge-sharpness scalar logged to results.
4. **Per-pixel temporal-churn heatmap (where boiling concentrates)**
  - False-color visualization (red=high churn, blue=low).
  - **Output:** heatmap PNG per run.



#### Phase β: v1 Ship Demo — VBAO + oneOverN + FSR3 + SVGF (P1, ~4–5 days)

**Goal:** Build a clean, integrated demo that converges at rest, prevents ghosting, anti-aliases, ships.

1. **Architecture**
  - VBAO base (producer).
  - oneOverN converging temporal accumulation.
  - SVGF denoising (fixes still-camera boiling + motion robustness).
  - FSR3 upscaling (AA + perf).
  - Jitter AA at temporal level (coordinate with FSR3's AA).
2. **Build & measure (using Phase α infrastructure)**
  - Still camera: measure convergence (churn curves). Target: zero perpetual floor.
  - Motion: measure ghosting (is stale GI drifting into wrong places?). Target: ZERO.
  - Aliasing: measure edge-sharpness. Target: smooth edges (no jagging like demo 14).
  - **Output:** demo code + curves + ghosting scores + edge-sharpness + heatmaps.
3. **Human eyes (you)**
  - Still: does it converge clean? (compare to demo 12 "forever boiling")
  - Motion: any ghosting? (stale GI drifting?)
  - Edges: smooth? (compare to demo 14 "terrible aliasing")
  - **Verdict:** ship-ready, or needs iteration?
4. **If Phase β passes:** v1 is done, proceed to Phase ε (re-record) + Phase ζ (isolate).



#### Phase γ: Optional — v2 Motion Tuning (P1.5, conditional)

**Only if v1 passes AND you want to push for better motion quality.**

Goal: reduce motion temporal grain (but keep zero ghosting).

1. **Motion-boiling experiments (from EXPERIMENTS.md Track A)**
  - Variance clipping (A1): motion-robust floor between capped and jitterClamp.
  - Jitter-aware disocclusion (A2): principled depth-weighted test vs ad-hoc thresholds.
  - Spatial fallback tuning: when/how to reject young history.
2. **Measure carefully**
  - Still camera: must still converge (don't regress v1).
  - Motion: must still have ZERO ghosting. Acceptable: temporal grain/noise.
  - **Output:** churn curves, ghosting scores (must stay zero), motion-quality verdict (eyes).
3. **If v2 passes:** incorporate into ship track. If not: ship v1 as-is.



#### Phase δ: Fallback Tiers (P2, ~2–3 days)

**For each hardware tier, tune parameters + measure cost + validate quality.**

1. **High-end:** VBAO + oneOverN + SVGF + FSR3 full (v1 full stack)
2. **Mid-tier:** VBAO + oneOverN + FSR3, SVGF optional
3. **Low-end:** VBAO + oneOverN, FSR3 upscale off or reduced res, spatial fallback for motion
4. **Mobile:** Basic VBAO + EMA temporal, no upscale, spatial denoise

Per tier: tune parameters, measure FPS/memory, validate visual vs Phase α metrics.

#### Phase ε: Quiet-GPU Re-record (P2, ~1 day runtime)

Final battery on idle GPU:

- High-end tier: convergence curves, ghosting scores, edge-sharpness, FPS, quality baseline.
- Mid-tier: cost delta, quality delta vs high-end.
- Low-end: cost/quality tradeoff.
- **Output:** final numbers for ship release notes.



#### Phase ζ: Separate Ship Track (branch or package)

Create isolated v1 ship track:

- **Branch:** `feature/ship` off main (easier, faster).
- **Package:** new repo `ssgi-ship` (harder wall, own CI, cleanest artifact).



#### Phase η: Documentation & Release

- Update publication drafts with v1 results.
- Document what worked, what failed, lessons learned.
- Release v1 as three.js contribution.
- (Optional: if v2 landed, add v2 findings + plan for future work.)

---



## PART 3: Open Questions for Your Approval

Before we start Phase α, these decisions need your sign-off:

### Q1: Ship-Track Isolation Strategy

- **Branch:** `feature/ship` off main (easier, faster, shared CI).
- **Package:** new repo `ssgi-ship` (harder wall, own CI, cleanest artifact).
- **Your prior answer:** "separate branch or package" (harder wall preferred). Start with branch or jump to package?

Answer: We can do it off main in this repo. I just dont want it to be a demo level item or be bound to shared code within demos. Demos can be stand-alone and fail and we may make tons of changes. If we think we have a good "core" and then we change something in a future demo 33 to some shared code that breaks our output I'll be pissed. So it can stay on main but understood that duplication and etc is critical. If thats a pain in the ass then at least a split folder for all its items, and if thats still hard then yeah we need to do a new repo to keep it clean. My original mention of "Package" was in comparisson to mono-repos with shared core packages. I just dont want to bleed with demos. 

### Q2: Ghosting Metric Priority

- Phase α proposes detecting ghosting as a critical failure mode (stale GI drifting into wrong places).
- Is frame-to-frame reprojection mismatch + luminance anomaly detection a good starting point, or do you want a different approach?
- **Recommendation:** start with reprojection-based detection, refine from user feedback.

Answer: This is fine for me. I have no idea how to judge this and maybe using wrong terms so lets start here and review. Maybe intentionally setup a "fail" that a human and machine agree is a fail with then making it "pass" and again agreeing. 

### Q3: Motion Grain vs Ghosting Trade

- v1 accepts motion temporal grain (pixel noise during motion) as acceptable, but ZERO ghosting is non-negotiable.
- If Phase β shows unavoidable motion grain + ghosting trade, what's the priority? (grain acceptable, ghosting not; or neither acceptable, needs more work?)
- **Recommendation:** grain acceptable, ghosting never. But confirm this aligns with your tolerance.

Answer: Noise/grain is usually seen as part of the trade. Ghosting can happen to minor degrees with things like fast motion or big disocclusion etc, and I suppose we cant say be 100% because we get that. However slow turns having ghosts or smears that feel like blending paint, and worse dont temporal out so it looks like a smeared face is bad. High speed ghosting may be acceptable etc. 

### Q4: v2 Motion Tuning Commitment

- Phase γ (optional v2 motion tuning via variance clipping + spatial fallbacks) is conditional on v1 passing.
- If Phase β succeeds with v1, do you want to immediately push into v2, or release v1 and call v2 future work?
- **Recommendation:** release v1 first, scope v2 after shipping.

Answer: This is a highly technically wordded question. Can you simplify and explain pros and cons?

### Q5: Tier Reduction Aggressiveness

- Phase δ designs high-end → mid → low-end → mobile with parameter tuning.
- For low-end/mobile, are we OK with EMA temporal (instead of oneOverN) to save memory, or should we keep oneOverN everywhere?
- **Recommendation:** EMA for mobile only; keep oneOverN for low-end if it fits.

Answer: Yeah Im ok with whatever you suggest here and im flexible for later. 

### Q6: Lab 11 Re-measurement Prerequisite

- Lab 11's noise ranking is suspect (measured under broken IGN advance).
- Can this wait for Phase ε (quiet-GPU), or does it block Phase β?
- **Recommendation:** can wait; Phase β will use bluenoise by default.

Answer: I go with your judgement. 

### Q7: Continuous Documentation vs Batch Finalize

- Document everything during Phase β/γ/δ, or wait until Phase η to prepare publication drafts?
- **Recommendation:** continuous notes during build, batch final edits at Phase η for consistency.

Answer: doccument everything. Dont worry about publication, but we should track what/when/why for ourselves and future agent contexts etc. 

---



## PART 4: Success Criteria for This Outline

This outline is ready for approval when:

1. ✅ It clearly reflects the audit: demo 12 and 16 FAIL, demo 14 is highest-quality base, demo 18 has potential but needs smearing fixed.
2. ✅ It reframes the work as "Make the Next Great SSGI on the Web" (clean build from first principles), not "pick a demo" or "fix demo X."
3. ✅ It explains why testing infrastructure is P0 (metrics gave false verdicts before; need convergence curves + aliasing measurement).
4. ✅ It proposes Phase β (clean-slate demo) as the core work, with FSR3 integration + diagnostics as the key research.
5. ✅ It includes Phase δ (fallback tiers: high-end, mid, low-end, mobile) as the product design.
6. ✅ It names the seven design decisions (Q1–Q7) that need your sign-off.
7. ⏳ **Pending:** Your review, corrections, and answers to Q1–Q7.

---



## Next Steps (Once Approved)

1. **You review this outline.** Flag any changes needed to the audit (section 1), architecture (section 2.1), design questions (2.2–2.3), or decisions (Q1–Q7).
2. **Answer Q1–Q7** with explicit preferences where needed.
3. **I finalize and write this to the plan file** (`/Users/dex/.claude/plans/velvety-scribbling-lovelace.md`) and **exit plan mode.**
4. **Execution spawns:** Phase α (testing infrastructure) begins immediately.

---



## Document Version

**Last updated:** 2026-08-02  
**Scope:** Clean-slate SSGI for the web (converges at rest, anti-aliased, performant via upscaler, tunable motion boil, hardware-tiered fallbacks)  
**Status:** Awaiting user review and Q1–Q7 sign-off before execution.