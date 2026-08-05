# v1 Ship Stack Testing — Phase β

**Status:** Demo 19 is running and ready for human eyes.  
**Date Created:** 2026-08-04  
**Your Task:** Test the v1 stack in a browser. Report pass/fail on 3 gates.

---

## Quick Start

1. **Open browser:** `http://localhost:5182/?demo=19`
2. **Wait 15 seconds** (no camera movement). Watch the image converge.
3. **Move the camera.** Rotate, pan. Stop suddenly. Watch for ghosting.
4. **Report back** on the three gates below.

**Time to test:** ~5 minutes.

---

## The Three Go/No-Go Gates

### Gate 1: Still-Camera Convergence
**Sit still for 15 seconds. Does the image stop boiling and look clean?**

- Watch the global illumination (GI). It should get progressively smoother and cleaner over ~10 seconds.
- By frame 100-150, it should look settled and production-ready. No flickering.

**PASS:** Image is smooth and clean. Looks ready to ship.  
**FAIL:** Image keeps flickering/boiling. Never settles. Looks noisy forever.

---

### Gate 2: Motion Ghosting (No Persistent Smears)
**Rotate the camera slowly (3-4 sec), then stop. Does GI snap back cleanly?**

- Move the camera with a slow orbit around the box.
- Stop suddenly and hold position.
- Watch if GI updates immediately or if you see a slow-motion "smear" trailing behind where you looked.

**PASS:** GI snaps back immediately. Feels responsive. No slow ghosting trails.  
**FAIL:** After you stop, you see a ghosting effect (GI shadowing slowly fading in the wrong place). Looks stale.

---

### Gate 3: Edge Anti-Aliasing
**Zoom into a box edge. Do edges look smooth or jagged?**

- Look at the silhouette of the box against the background.
- Edges should be smooth and anti-aliased, not pixelated or stair-stepped.

**PASS:** Edges are smooth and clean. AA is working.  
**FAIL:** Edges look jagged, pixelated, aliased. Anti-aliasing isn't helping.

---

## What You're Looking At

Demo 19 is **oneOverN temporal + spatial denoising**:
- **oneOverN temporal:** True alpha = 1/N. Frame-by-frame, the GI converges toward the ground truth. This is the v1 foundation.
- **Spatial denoising:** A bilateral blur that smooths out high-frequency noise while converging. It fades out on disocclusion (when new geometry appears).
- **Jitter AA:** Halton sub-pixel camera jitter for smooth edges.

**What it's NOT:** No SVGF yet. No FSR3 upscaler yet. Just the core temporal pipeline.

---

## Parameters (Tunable, But Defaults Are Good)

If you want to experiment with trade-offs, try these:

| Param | Default | Range | Effect |
|-------|---------|-------|--------|
| **rc** (rotation count) | 1 | 0.5–4 | More rotations = cleaner but slower |
| **sc** (step count) | 32 | 2–64 | More steps = sharper shadows, slower |
| **noise** | bluenoise | ign/white/bluenoise | Golden ratio vs random vs spectral |
| **denoising** | ON | ON/OFF | Bilateral blur: ON = smoother, OFF = noisier but converges fully |
| **nMin** | 4 | 1–8 | How long to smooth disocclusion. Higher = smoother but blurrier. |
| **denoisingRadius** | 2 | 0.5–4 | Blur radius. Higher = quieter, lower = sharper. |
| **giExposure** | 1 | 0.1–5 | Display brightness. Crank up to see noise. |

**Suggested test:** Try `rc=0.5, sc=16` (fast, noisy), wait 15 sec. Then try `rc=2, sc=64` (slow, clean). See the difference.

---

## Report Back (When You're Done)

Just answer these:

1. **Gate 1 (Still convergence):** PASS or FAIL? Describe: Does it settle clean or boil forever?
2. **Gate 2 (Motion ghosting):** PASS or FAIL? Describe: Any slow smearing after you stop?
3. **Gate 3 (Edge AA):** PASS or FAIL? Describe: Edges smooth or jagged?
4. **Gut feeling:** Does v1 feel ship-ready? Any specific thing that feels off?
5. **Parameter notes:** Did any setting make a big difference? Any trade-offs you noticed?

---

## What Happens Next (Context)

- **All 3 gates PASS:** v1 foundation is solid. Move to Phase γ (v2 motion tuning). Add SVGF denoiser + variance clipping + better disocclusion tests.
- **Any gate FAIL:** We iterate. Identify what's wrong and fix it before moving to v2.

**The philosophy:** Your eyes are the arbiter. Metrics are useful, but human judgment decides if it ships.

---

## Troubleshooting

**Demo doesn't load?**
- Refresh the page.
- Check the browser console (F12) for error messages.
- Make sure dev server is running: `npm run dev` from the repo root.

**Image looks completely broken?**
- Reload `?demo=19` fresh.
- Try resetting camera with spacebar (standard three.js control).

**Questions about parameters?**
- See `TESTING-PHASE-BETA-V1.md` in the repo for deeper details.

---

## Key Files for Reference

- **Full testing guide:** `TESTING-PHASE-BETA-V1.md`
- **Demo source:** `bench/src/demos/19-ship/index.ts`
- **Automated metrics from Phase α:** `bench/results/phase-beta-v1-candidate.md`
- **Ship plan:** `SHIP-PLAN.md`

---

**Bottom line:** Test, report, iterate. No pressure to get it perfect first try. Human feedback is the whole point.
