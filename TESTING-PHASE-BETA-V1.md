# Phase β — v1 Ship Stack Testing Guide

**Demo to test:** `demo=19` in the URL (or select "v1 Ship Stack (oneOverN+spatial-denoise)" from the dropdown)  
**Scene:** Cornell box (default, good for still-camera testing)  
**What you're evaluating:** Does oneOverN temporal + spatial denoising converge cleanly and look production-ready?

---

## Quick Start

1. **Open the demo:** Go to `http://localhost:5182/?demo=19`
2. **Let it settle:** Don't move the camera. Wait ~10 seconds and watch the image.
3. **Look at the image quality:** Does the global illumination look clean, or is it boiling/flickering?
4. **Move the camera:** Rotate, pan, walk through the scene. Watch what happens to the GI.
5. **Tweak parameters** (details below) to understand the trade-offs.

---

## What to Look For (Go/No-Go Gates)

### GATE 1: Still-Camera Convergence ✓ WIN if:
**At rest, the image should stop flickering/boiling after ~5-10 seconds.**

- Sit still for 15 seconds. Watch the image become stable and smooth.
- **PASS:** The GI looks settled, clean. You'd be happy showing this to a user.
- **FAIL:** The image keeps flickering, looks noisy, never settles. (This would be like demo 12's perpetual boiling.)

**How to test:** Just wait with no camera movement. The frame counter in the tweakpane tells you how many frames have accumulated.

---

### GATE 2: Motion Ghosting (Persistent Smearing) ✓ WIN if:
**When you move the camera and stop, the GI should snap back cleanly. No slow-motion smears trailing behind objects.**

- Rotate the camera slowly. Stop suddenly.
- **PASS:** The GI updates immediately, no ghosting trails. Feels responsive.
- **FAIL:** After you stop, you see a "smear" or "shadow" of GI persisting in the wrong place, slowly fading. (This would be demo 18's shading ghosting.)

**How to test:** Slow orbit around the box for 3-4 seconds, then stop. Watch if GI snaps or creeps.

---

### GATE 3: Edge Anti-Aliasing ✓ WIN if:
**Sharp edges should look smooth, not jagged/pixelated.**

- Look at the box edges (silhouettes against the background).
- **PASS:** Edges are smooth, anti-aliased. The jitter AA is working.
- **FAIL:** Edges look jagged, pixelated, aliased. (This would indicate AA isn't helping.)

**How to test:** Zoom into a box edge. The edge should be smooth, not stair-stepped.

---

## Parameters to Understand & Test

These are the knobs you can tweak. **Suggested defaults are already set.** Adjust them to see how they affect quality:

### Core GI Producer (unchanged, but useful to know)
- **rc** (rotation count): `1` = fewer ray rotations per pixel. Controls how many angle "sweeps" happen per frame.
  - ↑ Higher = more samples but slower
  - ↓ Lower = faster but noisier  
  - *Test:* Try `0.5` → lots of noise. Try `2` → cleaner but slower.

- **sc** (step count): `32` = how many steps each ray marches. More steps = more detail in shadows.
  - ↑ Higher = more accurate AO/GI but slower  
  - ↓ Lower = faster but shallower occlusion  
  - *Test:* Try `16` → blurry shadows. Try `64` → sharp shadows.

- **noise**: `bluenoise` (golden) vs `white` (random) sampling pattern.
  - *Test:* Switch to `white` → looks more random/grainy. Switch to `bluenoise` → feels smoother.

### Temporal Accumulation (THIS IS v1)
- **accum mode**: Always `oneOverN` in this demo (fixed).
  - This is the core v1 choice: true converging temporal, not capped EMA.
  - Watch it decline over 10 seconds. This is THE TEST.

- **jitter AA**: Always `jitter` in this demo (fixed).
  - Sub-pixel camera jitter for smooth edges.

### Denoiser (spatial smoothing)
- **denoising**: ON/OFF toggle. Applies bilateral blur to hide noise while converging.
  - *Test:* Turn OFF → you see more boiling/noise but converges faster.
  - Turn ON → smoothed, quieter, but slightly blurred.

- **spatial fallback**: ON/OFF. Fades in a spatial blur during disocclusion (when new geometry appears).
  - *Test:* Turn OFF → you'll see flickering on disocclusion edges. Turn ON → smoother recovery.

- **nMin**: `4` = how many frames before spatial fallback fades out.
  - ↑ Higher = longer fallback fade (smoother but blurrier on motion)
  - ↓ Lower = faster convergence but noisier on motion
  - *Test:* Set to `1` → fast convergence, more noise. Set to `8` → longer smoothing.

- **denoisingRadius**: `2` = bilateral filter radius (how much to blur).
  - ↑ Higher = more blurring (quieter)
  - ↓ Lower = less blurring (noisier but sharper)
  - *Test:* Set to `0.5` → sharp but noisy. Set to `4` → soft but converges quietly.

### Display & Scene Tuning
- **giExposure**: `1` = how bright the GI appears. Useful for seeing detail.
  - *Test:* Crank to `2` → brighter, easier to spot noise. Back to `1` → normal exposure.

- **thickness**: `0.5` = occlusion thickness (how thick objects are for shadow). Scene-dependent.
  - ↑ Higher = longer shadows (objects block more)
  - ↓ Lower = shorter shadows
  - *Test:* Try `0.2` → thin, sharp shadows. Try `1.0` → thick, soft shadows.

- **distantLight**: `salm-caps` (on) vs `off`. Ambient lighting on unoccluded surfaces.

---

## Testing Checklist

**Before tweaking, run through this baseline test:**

- [ ] **Still camera (15 sec):** Does the image stop boiling and look clean? (GATE 1)
- [ ] **Slow camera rotation (3 sec, then stop):** Does GI snap back cleanly? (GATE 2)
- [ ] **Zoom into edge:** Does it look smooth/anti-aliased? (GATE 3)

**If all three pass:** v1 foundation is solid. Move on.

**If any gate fails:** Note which one, and come back here. We'll know what to fix.

---

## Parameter Exploration (Optional)

If you want to understand the trade-offs, try these experiments:

**Experiment A: Noise vs. Speed**
1. Set `rc=0.5, sc=16`: Fast but noisy.
2. Observe: Boiling/flickering. How long until it settles?
3. Now set `rc=2, sc=64`: Slow but clean.
4. Observe: Less boiling. Converges faster.
5. **Trade-off:** More samples = cleaner input, but slower compute.

**Experiment B: Denoiser Strength**
1. Turn `denoising=OFF`: Raw march output. You see all the noise.
2. Turn `spatial fallback=OFF`: No motion recovery smoothing.
3. Observe: Rough, noisy, but converges fully to the signal.
4. Now turn both back ON.
5. Observe: Smoother, quieter, but takes a bit longer to fully converge.
6. **Trade-off:** Denoising = quieter but assumes the current frame is somewhat accurate. It's a gamble that plays out over time.

**Experiment C: Motion Ghosting (shading)**
1. Rotate camera slowly for 3 seconds.
2. Stop suddenly.
3. Do you see GI "trailing" behind where you looked?
4. (This would be v2 territory — shading ghosting. For v1, it should be minimal.)

---

## What to Report Back

Once you've tested, let me know:

1. **GATE 1 (Still convergence):** PASS or FAIL? If FAIL, does it boil forever or just take a while?
2. **GATE 2 (Motion ghosting):** PASS or FAIL? If FAIL, describe the ghosting (slow smear, quick flicker, etc.).
3. **GATE 3 (Edge AA):** PASS or FAIL? Are edges jagged or smooth?
4. **Gut feeling:** Does this feel ship-ready, or does something feel off?
5. **Parameter notes:** Any settings you found make a big difference?

---

## Notes

- **Frame counter:** Top-left of the image shows frame #. Still camera should stabilize by frame 100-150.
- **GPU timing:** The tweakpane shows compute pass times. Use this to understand performance.
- **View mode:** Stick with `'combined'` (default). This is the beauty·AO + albedo·GI composite — what the user sees. (`'gi'` or `'ao'` alone are debug views.)

---

## If Something Breaks

If the demo crashes or looks completely wrong:
1. Check the browser console (F12) for error messages.
2. Try refreshing the page.
3. Try resetting to defaults by reloading `?demo=19` fresh.

If it still doesn't work, let me know what you see.

---

**TL;DR:** Watch it converge. Move the camera and watch for ghosts. Zoom and check edges. PASS all three gates = v1 is ready to push. FAIL any gate = we iterate.
