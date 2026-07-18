this is as reply in a LLM (Fable 5) conversation about this bench and potential gains found in the paper

Yes — several, and lab 09 actually ran your exact LSAO question to ground already. Here's the honest inventory, split by how "beyond" they really are.

Genuine improvements beyond the source material
Frame-count accumulation (demo 03, just landed). SSRT3 ships a fixed EMA that mathematically cannot converge its own 12-frame noise cycle. Our 1/N-with-disocclusion-reset accumulator converges it fully on stills (~4× less boil measured). This is a real algorithmic improvement over shipped SSRT3, kept behind a toggle so the faithful baseline stays comparable.
Per-frame jitter advance (demo 03). SSRT3's rand(uv) is frame-static, so its jitter noise survives temporal averaging forever — lab 10 caught this because the pure-temporal reference came out noisier than the denoised stacks. Advancing it per frame makes the jitter actually convergeable. Small change, but it fixes a self-defeating design in the original.
Sector remap enabled (demo 03). Therrien wrote the tangent-phantom cure and shipped it commented out; three's port inherited the omission. We ship it on.
The joint-bilateral upsample (lab 09 → harness-grade). The SSILVB paper recommends half-res + joint-bilateral upsampling, but no engine ships the upsample as a node — three has depth-aware blurs, not a guided upsample. Lab 09 built it and measured 4.1–6.3× chain speedup with near-zero error on flat surfaces and no edge halos. That's the single biggest practical win in the repo and it's an artifact nobody packages.
Paper-vs-shipped toggles (demo 03). Fallback-weight normalization (paper's per-subregion math vs SSRT3's dimmer shipped version) and cone→mip selection (SSRT3 has the formula but hardcodes mip 3) — both expose the paper-correct variant the shipped code dropped.
The LSAO answer specifically
Lab 09's Axis 2 tested the LSAO-adjacent idea directly: cooperative workgroup shared-memory depth tiles (24×24, preload + barrier). Honest negative result: at most ~13% faster, and only in a narrow small-radius/high-sample regime; a wash or slightly slower at production radii, because the exponentially-distributed far steps miss the tile and the GI gather still fetches light+normal globally per step.

The deeper finding (in research/lsao-timonen2013-notes.md) is why the real LSAO win doesn't transfer: LSAO's order-of-magnitude speedup comes from its O(1) largest-occluder line-sweep, which collapses each direction to a single occluder. A visibility bitmask needs full per-sector occupancy — you can't collapse to one occluder without giving up exactly the thin-occluder correctness that makes VBAO better than GTAO. So "LSAO for bitmasks" is an open research problem, not a caching tweak. If you ever want to attack it, the plausible shape is a line-sweep that maintains a running sector mask per sweep direction instead of a max horizon — nobody has published that, which cuts both ways.

Restorations (beyond three's port, not beyond the paper)
Demo 03's probe fallback (§3.2), multibounce GI, and the mip/normal bandwidth optimizations are all things the paper/SSRT3 has but three's SSGINode dropped — worth remembering when comparing demo 01 vs 03, since demo 03 isn't just "the same algorithm done in compute."

Cross-pollination the labs validated (beyond any single paper)
Ottosson's thickness heuristic and Salm's spherical-caps distant light grafted onto the SSRT3-style march (lab 08), IGN replacing SSRT3's gradient noise under a denoiser (lab 11), and the measured verdict that dispatch mode doesn't matter (lab 09 Axis 3 — compute wins on capability, not speed, which also exonerates three's fragment-quad choice).

Still on the table for a real "improvements track"
Radiance cascades (deferred by plan), checkerboard rendering (lab 09 skipped it into demo 10's territory), persistent world-space GI caching (probe/irradiance cache — different family from LSAO's screen-space sweep), feeding our outputs through TRAA/FSR resolves, and the bitmask line-sweep research problem above. My recommendation stands: baseline testing first with the reference views we just built, then pick improvements by measured deficit rather than by paper appeal — lab 09 is a good cautionary tale that the appealing cache idea was worth ~0–13% while the boring resolution lever was worth 450%.

Yeah are there other ideas that could fit into this base framework as improvements? either with quality or speed? LSAO didnt work but the paper highlighted real issues that I think our compute and other systems could solve.

I also thought some of the buffers/data in the fsr3 setup like disocclusion buffers, caches, etc could be done early in the pipeline and consumed by things well before the upscale. but thats just theory
Plenty — and your FSR3 instinct is not just theory, it's exactly how modern pipelines are structured, and our bench is already accidentally half-way there. Let me lay out what fits, grouped by the issue it solves, grounded in what the labs measured.

Your FSR3 idea, made concrete: a shared "temporal guides" pre-pass
Right now the same temporal intelligence gets computed redundantly and privately: demo 03's temporal pass does a world-position disocclusion test internally, the bilateral denoiser re-derives edge validity from depth/normals, demo 10's stacks each do their own, and any future TRAA/FSR resolve would do it all again. FSR3's insight is that disocclusion masks, dilated motion vectors, and reactivity are frame properties, not effect properties — compute once, early, consume everywhere.

For us that's one cheap compute pass right after the G-buffer producing:

Disocclusion mask (graded, not binary) from depth reprojection — replaces demo 03's inline test, feeds the denoiser (widen kernel on disocclusion), and later the upscaler.
Dilated velocity (closest-depth 3×3 dilation, the standard TAA trick) — our current temporal pass reads raw velocity, which mis-reprojects at silhouettes; every consumer benefits.
History length N — we already built this buffer for frame-count accumulation! It just lives privately inside demo 03. Promote it to the shared bundle and it becomes the keystone below.
This slots naturally as a harness pass (like ReferencePass), A/B-able in demo 10. Low risk, unlocks everything else.

The biggest lever: adaptive effort steered by those guides
This is the real answer to LSAO's core complaint — that every pixel pays full march cost regardless of need. LSAO solved it with line sweeps (incompatible with bitmasks); compute + the guides buffer solves it differently: read N in the march and scale effort per pixel. A pixel with 16 frames of valid history and low variance drops to 1 rotation / few steps (its accumulator is doing the integration); a freshly disoccluded pixel gets full rc4/sc32. Since the march dominates frame cost and most pixels are converged most of the time, this is plausibly a 2–3× average saving that concentrates quality exactly where the eye sees change. Add SVGF-style variance moments in the temporal pass and the denoiser radius becomes per-pixel adaptive too (tight where converged — preserving the contact detail the bilateral currently blurs).

Bandwidth follow-ons lab 09 already de-risked
Integrate half-res + joint-bilateral into demo 03 proper. The lab verdict was "ship it" (4.1–6.3×, sub-0.5ms tax); it's still only in the lab.
Checkerboard marching — lab 09 skipped it because it lacked temporal machinery; demo 03 now has that machinery plus frame-count accumulation, which is exactly the fill mechanism checkerboard wants. Straight 2× march saving.
Min-max depth pyramid → hierarchical step skipping. We build box-min mips already; adding max gives empty-space skipping (coarse steps while the ray is provably far from geometry, refine near hits — Hi-Z style). This attacks LSAO's other real issue — wasted steps through empty space — with hierarchy instead of sweeps, and it is bitmask-compatible.
Mip the light/normal buffers for far samples. Lab 09 identified that caching only depth capped the win because light+normal fetches stay global and uncorrelated; SSRT3 mips only depth. Distance-based mip on the light buffer is the same trick applied where the bandwidth actually is (and it doubles as prefiltering — less firefly noise from far samples).
Quality ideas that fall out of data we already have
Bent normals + specular occlusion from the bitmask — the best value on this list. The 32-bit sector mask already encodes the open-visibility cone; its centroid is the bent normal and its popcount the cone angle, nearly free at march time. Feed that into the composite's env/specular term and you get directionally-correct ambient + specular occlusion — a visible realism jump over scalar AO, and something three's SSGINode doesn't attempt.
Two-sided depth for true thickness. The constant-thickness heuristic is behind a whole artifact family (lab 08's territory). A back-face depth prepass gives real occluder intervals — the bitmask then marks exactly the occupied sectors. Cost: one extra depth-only pass; quality: kills the halo/leak tradeoff rather than tuning it.
Reactive masking for the upscaler (your pipeline-ordering point again): pixels where multibounce feedback or fast GI change occurred get flagged so a downstream TRAA/FSR doesn't ghost them — generated by the GI pass, consumed at the end. Same "early producer, late consumer" architecture.
How I'd sequence it
Testing phase first, unchanged — we need the baseline numbers. Then: guides pre-pass → adaptive march effort → half-res integration as the speed track (each builds on the last), and bent normals/specular occlusion → two-sided thickness as the quality track. Checkerboard and Hi-Z skipping are solid third-tier options; radiance cascades stays the big-ticket deferred item. Every one of these slots into the existing harness as either a demo 03 stage-letter or a lab, and the reference views mean each lands with a measured quality delta, not an impression — which, after lab 09's cache lesson, is the discipline that keeps us from building appealing things worth 5%.