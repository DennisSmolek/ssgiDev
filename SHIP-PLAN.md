# SSGI Ship Plan — v1 + v2 (Best Possible)

**Status:** APPROVED FOR EXECUTION  
**Date:** 2026-08-03  
**Goal:** Build native-quality SSGI for the web. v1 converges and ships. v2 pushes for best motion quality. Keep going until v2 works or hits genuine blocker.

---

## The Product

### v1 (Stable, Ship-Ready)
- **Stack:** VBAO base + oneOverN converging temporal + FSR3 upscaler + SVGF denoising
- **Still camera:** converges clean (fixes demo 12's perpetual boiling)
- **Motion:** acceptable temporal grain, ZERO persistent slow-motion ghosting (high-speed ghosting OK, minor ghosting under fast disocclusion OK)
- **Edges:** anti-aliased (no jagging like demo 14)
- **Performance:** upscaler-driven (lower-res render via FSR3)

### v2 (Best Possible)
- **Same v1 stack + motion tuning experiments:**
  - Variance clipping (A1): motion-robust accumulation floor
  - Jitter-aware disocclusion (A2): principled depth-weighted disocclusion test
  - Spatial fallback tuning: graceful young-history handling
- **Goal:** reduce motion temporal grain while keeping zero persistent ghosting
- **Commitment:** keep iterating until v2 is solid OR demonstrably too hard after sustained effort. Only stop if blocked.

### Hardware Tiers
- **High-end:** Full v1/v2 stack (VBAO + oneOverN + SVGF + FSR3 upscale)
- **Mid-tier:** VBAO + oneOverN + FSR3, SVGF optional
- **Low-end:** VBAO + oneOverN, FSR3 upscale off or reduced-res, spatial fallback
- **Mobile:** Basic VBAO + EMA temporal (save memory), no upscale, spatial denoise

---

## Code Isolation (Critical)

**Ship code is NOT bound to experimental demos.**
- Ship code lives in dedicated folder (`/ship` or similar at project root), NOT under `/demos`
- Any shared code (VBAO, TemporalGuidesPass, etc.) is **copied/duplicated** into ship folder
- **No shared code with experimental demos.** Future demo changes cannot break ship output.
- If duplication becomes untenable, migrate to separate repo (but start isolated in this repo).

---

## Measurement Infrastructure (Phase α, ~2–3 days) — BLOCKING

This is P0. Cannot validate anything without it.

1. **Convergence curves (per-frame churn over time)**
   - Per-second churn over 12s window, track churnEarly/churnLate, slope
   - Pass gate: churnLate ≤ floor + ε, monotonic decline
   - Output: curves + pass/fail verdict

2. **Ghosting detection (critical failure mode)**
   - Frame-to-frame reprojection mismatch + luminance anomaly
   - Approach: set up deliberate fail cases (human + machine agree it's a fail), then make them pass (human + machine agree it passes)
   - Output: ghosting score (low = no artifacts, high = stale GI drifting/smearing)

3. **Aliasing measurement (edge-sharpness scalar)**
   - Frequency-domain or Laplacian-gradient-magnitude for edge quality
   - Output: edge-sharpness scalar (high = smooth edges, low = jagged)

4. **Temporal-churn heatmap (where boiling concentrates)**
   - Per-pixel false-color (red=high churn, blue=low)
   - Output: heatmap PNG per run

---

## Phased Execution

### Phase β: v1 Build (4–5 days)
**Integrate VBAO + oneOverN + FSR3 + SVGF cleanly.**

1. Build clean demo from scratch (no "fix demo 18" patches, no "promote demo 14" half-measures).
2. Measure using Phase α infrastructure:
   - Still camera: convergence curves (should be clean, no perpetual floor)
   - Motion: ghosting scores (should be zero persistent slow-motion ghosting)
   - Edges: aliasing/edge-sharpness (should be smooth)
3. Human eyes (you):
   - Still: converges clean? (beats demo 12's forever boiling?)
   - Motion: ghosting OK? (no slow smears?)
   - Edges: smooth? (no jagging like demo 14?)
4. **Verdict:** ship-ready, or iterate?

### Phase γ: v2 Motion Tuning (ongoing, until done or blocked)
**Push for best motion quality. Keep going until v2 ships or demonstrably can't be solved.**

1. Motion experiments (from EXPERIMENTS.md Track A):
   - Variance clipping (A1)
   - Jitter-aware disocclusion (A2)
   - Spatial fallback tuning
2. Measure continuously:
   - Still camera must NOT regress (convergence stays clean)
   - Motion ghosting must stay zero persistent
   - Acceptable: reduce temporal grain
3. Iterate, measure, refine.
4. **Stop condition:** v2 is solid and ships, OR after weeks of effort it's clear we're hitting a wall (then v1 is final product).

### Phase δ: Fallback Tiers (2–3 days)
**Tune high-end / mid / low-end / mobile. Measure cost + quality per tier.**

### Phase ε: Quiet-GPU Re-record (1 day runtime)
**Final baseline measurements on idle GPU.**

### Phase ζ: Ship Isolation
**Isolate ship track (folder + duplication, or separate repo if needed).**

### Phase η: Release
**Ship v1 (or v1+v2 if v2 landed). Update publication drafts. Document findings.**

---

## Measurement Priorities

**What we measure (Phase α + ongoing):**
1. **Still-camera convergence** (churn curves) — must be clean, not perpetually boiling
2. **Ghosting detection** (critical failure) — must catch persistent slow-motion smearing
3. **Aliasing/edge-sharpness** — must be smooth, not jagged
4. **Motion grain** (acceptable, don't optimize for)

**What we DON'T measure (no time here):**
- Perceptual gating (elaTCSF, stelaCSF) — defer
- Stress scenes (Track E) — defer
- Neural denoising — defer

---

## Key Decisions (All Approved)

| Decision | Answer |
|----------|--------|
| **Code isolation** | Duplicate into ship folder, not bound to demos. Separate repo if needed later. |
| **Ghosting tolerance** | Zero persistent slow-motion ghosting. High-speed/disocclusion minor ghosting acceptable. |
| **v2 Commitment** | Keep pushing until v2 ships OR demonstrably too hard. Only stop if blocked. |
| **Tier strategy** | High-end first, detune for lower tiers. EMA for mobile only (save memory). |
| **Lab 11 re-test** | Waits for Phase ε (quiet-GPU). Use bluenoise in Phase β by default. |
| **Documentation** | Continuous throughout build (not just publication-ready). Track what/when/why for context. |

---

## Success Criteria

✅ Phase α (testing) is built and validates metrics vs eyes on a deliberate fail/pass case  
✅ Phase β (v1) converges clean at rest, zero persistent ghosting, anti-aliased  
✅ Phase γ (v2) either ships motion improvements OR after weeks of effort is proven to be a blocker  
✅ Phase δ/ε (tiers + re-record) establishes final performance baselines  
✅ Phase ζ/η (isolate + release) ships the product  

---

## Timeline Estimate

- Phase α: 2–3 days
- Phase β: 4–5 days
- Phase γ: 2–6 weeks (until done or blocked)
- Phase δ/ε: 3–4 days
- Phase ζ/η: 1–2 days

**Total:** ~4–8 weeks depending on how far Phase γ pushes.

---

## Start: Phase α (Testing Infrastructure)

**Next step:** Build convergence curves + ghosting detection + aliasing metrics + heatmap viz.

This blocks everything. Let's go.
