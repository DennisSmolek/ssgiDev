# GUIDE.md — where to start: the demo tour, what to fiddle, and where every idea stands

Updated 2026-07-21 (post-Phase-O, commit 062e5ee). This replaces the old
build-phase smoke-test notes as the "sit down and look at it" document.
Deeper docs: `bench/DEMOS.md` (lineage + verdicts), `TESTING.md` (how numbers
are made), `NEXTGEN.md` (phases/rules), `bench/results/` (every recorded
table), `publication/` (the six writeups).

## Quick start

```
cd bench && pnpm dev        # http://localhost:5180
```

URL anatomy: `?demo=<id>&scene=<cornell|sponza|artifact-zoo>&view=<mode>&cam=px,py,pz,tx,ty,tz`
- Demo ids are full slugs (`03-ssrt3`, `12-distilled` — a bare `03` silently
  falls back to demo 00).
- Grid poses (TESTING.md): paste into `?cam=`:
  - C-wide `0,2.4,8.8,0,2.6,0` · C-graze `1.4,3.6,4.6,0.95,1.3,0.7` ·
    C-contact `3.0,1.6,3.6,0.3,0.5,0.1`
  - S-hall `11,1.8,-0.3,-10,2.6,-0.3` · S-column `2.0,1.6,0.0,3.4,1.4,-2.6`
- Sponza v2 lighting knobs: `?sun=px,py,pz,tx,ty,tz[,intensity]`,
  `?torch=<intensity>` (0=off). Scene pane has sliders + a torch-flicker
  toggle (**leave flicker off when judging stability** — it exists as a
  deliberate temporal stress test only).
- Every demo: `copy config` / `paste config` buttons (embed the JSON with any
  screenshot you keep); hover any control for its what/why tooltip.

## The 15-minute tour (in order, one thing to see each)

| open | fiddle | you should see |
|---|---|---|
| `?demo=03-ssrt3&view=gi` cornell C-wide | `accumMode`: `ssrt3-ema` ↔ `frame-count` | THE boil difference. EMA (as SSRT3 ships) never converges its own 12-frame noise cycle; frame-count locks solid on stills. Measured 1.06 vs 0.31. |
| same, `view=split` then `diff` | drag the divider; `diff amp` at 2 (not 8) | Live oracle comparison. Known baseline signal: ~0.1 AO offset on open surfaces, GI scale at unit gain — record, don't "fix". |
| same | `fallbackEnabled` on/off | §3.2 directional ambient: ceiling corners hold a lit floor instead of dying to black when the bounce runs dry. The thing three's port dropped. |
| `?demo=12-distilled` cornell C-wide | `marchScale` full ↔ half ↔ quarter | Our v0. Half is the default and the free lunch (lab 09's 4–6× chain, twice re-validated); quarter starts losing contact detail. |
| same | `view=bent` / `bent-ref` / `bent-diff` | P4: bitmask bent normals vs the oracle's cosine-weighted truth. The ~24–32° mid-grey in bent-diff is the documented estimator gap, not a bug. |
| same | `distant` → `salm-caps`, `thick` → `two-sided` | The lab-08 graduates. Distant light is default-OFF in the control only because the oracle models zero sky (toggling it on is legitimate for looks). |
| `?demo=13-optim` cornell C-wide | `variant` → `adaptive`; sit still, then move | **The flagship.** Watch gpu ms: converged pixels coast (~3× cheaper march), any motion snaps back to full cost. This is the temporal-guides payoff. |
| `?demo=10-denoise&stack=ssrt3-guides&view=guides` | orbit, stop, wait | Guides debug: R = disocclusion flares on motion, G = history rebuilding to white, B = dilated velocity. The FSR3-BRIEF contract, live. |
| `?demo=05-gt-vbgi` cornell | let it sit | The quality bar. Watch fps drop as it path-traces toward its 512-frame cap — that 160→40 you observed is its accumulation working as designed. |
| `?demo=06-sshgi-mathis` sponza S-hall | nothing — watch gpu ms | The measured 31 ms march that was dragging your parallel windows. Real cost, not a bench artifact. Its count-based *accumulation* idea graduated into everything. |
| `?demo=02-reference` any scene | `refRays`/`refSteps`; move camera | The oracle itself: unbiased, converges ~512 frames, resets on any pose change. Everything is judged against this. |
| `?demo=11-sampling` cornell | `noise` enum, `denoised` view | Salm's two claims, both held: Hilbert is prettier raw, IGN wins under a denoiser (IGN is demo 12's default for exactly that reason). |

Labs 07/08/09 are single-question rigs (ambient source A/B/C × fallback;
distant-light method × thickness heuristic on the zoo; resolution × dispatch
on the bandwidth thesis) — open them when you want those specific answers.
`?scene=artifact-zoo` under any technique demo is the artifact checklist.

## Concept status board (every improvement idea, one line each)

**Shipped as defaults (in demo 12, our v0):**
- Half-res march + joint-bilateral upsample — the biggest single lever
  (4.1–6.3× chain; carries demo 12's 1.7–2.8× totals). `publication/draft-upsample.md`.
- Frame-count (1/N) accumulation with disocclusion reset — stability 0.31 vs
  EMA 1.06; confirmed independently by lab 10 and Track C. `draft-accumulation.md`.
- IGN noise + per-frame jitter advance (lab 11) · Ottosson adaptive thickness
  (lab 08) · sector remap on · §3.2 fallback restored.

**Shipped as capabilities (default-on unless noted):**
- TemporalGuidesPass (harness) — shared dilated-velocity/disocclusion/history
  bundle; beat private per-effect logic 1.49 vs 2.06. Your FSR3 port's
  passes 1–2 can drop in behind the same contract (P7).
- Bent normals from the bitmask (+ oracle comparison view); Lagarde spec
  occlusion (default OFF in the control — oracle sees no sky).
- Two-sided depth thickness (toggle; equal MSE at default poses, built for
  the zoo's thin-fence/thick-plate cases).
- salm-caps distant light (toggle, default off in control only).

**Phase-O graduates (demo 13, recorded in demo13-all/phase3):**
- `adaptive` — guides-driven per-pixel effort: **3.17×/2.37× converged march,
  fresh pixels at baseline cost**, stability +0.17 recorded and tunable
  (effort floor). The LSAO problem solved in time instead of space.
  `draft-adaptive.md`.
- `trig` — exact identities, small free win (1.04–1.08×). Rider.
- `light-mips` — not a perf lever (0.98–0.99×) but a measured *stability*
  improvement (−0.05, prefiltering). Quality tool.

**Parked with recorded negatives (kept runnable in demo 13 — the receipts):**
- `deinterleave` (CACAO-style, the must-do) — image-correct, 0.76–0.92×: our
  half-res march already banks the cache coherence it recovers. Re-test if a
  full-res mode ever ships; compacted single-dispatch is the follow-up.
- `subgroups` — bit-exact sharing proven, ~1.0× perf; the feature-gated
  variant-pair pattern (baseline = fallback) is the lasting artifact.
- `checkerboard` (uncompacted dispatch: no ms win, stability cost) ·
  `hiz-skip` (conservative form ~0×; angular Hi-Z unbuilt) · `loop` /
  `precision-f16` (fetch-bound march shrugs at ALU).
- LSAO itself — both readings negative, both modern heirs tested; trail
  closed in `research/sources/papers/lsao-timonen2013-notes.md`. `draft-lsao.md`.

**Deferred by choice:** screen-space radiance caching (GI-1.0/Lumen family),
ReSTIR, radiance cascades, Blender-Cycles absolute ground truth.

**Open phase boundaries (yours):** Phase I — package demo 12/13's winning
config as a consumable three.js node (the one unbuilt piece every writeup
flags); publication venue; P7 — FSR3-port convergence (demo 10 is the live
acceptance rig).

## Re-running any number

Every table in `bench/results/*.md` names its runner. From `bench/`:
`node scripts/run-<name>.mjs` (headed Chrome opens; don't touch it while it
measures; never run two at once — GPU contention corrupts timings). `--quick`
= smoke only. Methodology lives in `scripts/lib/harness.mjs` and TESTING.md.
