The following is a chat with an agent first about the base SSGI paper and the threejs node, then a conversation of SSGI/vs DDGI methods. It has some interesting comments on things the threejs version lacks but dont get hung up on the DDGI conversation. It's just for reference

What the paper is
"Screen Space Indirect Lighting with Visibility Bitmask" (Therrien, Levesque, Gilet, 2022). It's a one-idea paper, and the idea is small enough to describe in a paragraph. It's since become the basis of the SSGI/AO in a bunch of engines.
The setup you already know
You want ambient occlusion and a diffuse light bounce, but you only have a G-buffer: depth, normals, and a lit color buffer. No scene geometry, no BVH. So you fake it by asking, per pixel: how much of my hemisphere is blocked, and what color is the stuff that's blocking it?
Two existing families:
Ray-march it (SSR-style / SSRTGI). Shoot a few rays per pixel, march the depth buffer, accumulate on hit. Correct-ish, but most rays hit nothing or leave the screen, so you get 1 sample of signal per ray at best. Very noisy → heavy denoise → mush.
Horizon-based (HBAO → GTAO → HBIL). Pick a random azimuthal direction, cut a vertical slice through the hemisphere, walk N depth samples left and N right. Track the maximum elevation angle found on each side. Those two angles θ₁, θ₂ define a cone of visible sky, and you integrate that analytically — closed form, no noise. Way cheaper per unit of quality.
The bug in horizon-based
Keeping only a max angle per side implicitly says: everything below the horizon is solid. The depth buffer is treated as a heightfield with infinite thickness extending away from camera.
So a fence post, a railing, a chair leg — anything thin — casts an occlusion shadow as if it were a wall extending to infinity. That's the halos and over-darkening in Figures 4 and 11. Falloff heuristics paper over it and break at large radius.
The idea
Replace float theta1, theta2 with u32 mask.
Chop the hemisphere slice into N uniform angular sectors (they use 32 — fits one u32, and it's where banding stops being visible). Each bit = is this sector occluded.
Now each depth sample doesn't push a horizon, it stamps a range of bits:

θ_front = elevation angle to the sample (same angle GTAO would use)
θ_back = elevation angle to that sample pushed back by a constant thickness t

That pair covers an angular wedge. Convert to sector indices a and b, build a run of bits, OR it in:
wgsl// paper's alg 1, lines 18-19, in WGSL-ish
let a = u32(floor((min_t + PI*0.5) / PI * f32(Nb)));
let b = u32(ceil((max_t - min_t) / PI * f32(Nb)));
let sample_mask = ((1u << b) - 1u) << a;   // contiguous run of b bits at offset a
That's the whole trick. O(1) regardless of sector count — no loop over sectors, just a shift and a mask. ~15 extra ALU per sample.
What falls out of it
AO is just a popcount:
wgslao += 1.0 - f32(countOneBits(slice_mask)) / f32(Nb);
GI is where it gets nice. Before OR-ing the new sample in, ask how many sectors this sample newly covers that weren't already covered:
wgsllet novel = countOneBits(sample_mask & ~slice_mask);
gi += (f32(novel) / f32(Nb)) * radiance_j * dot(n_p, l_j) * dot(n_j, -l_j);
slice_mask |= sample_mask;
sample_mask & ~slice_mask is the "is this sample actually visible from me, and by how much" test — free, one instruction. If a closer object already claimed those sectors, the new sample contributes nothing. Partial overlap gives partial contribution, which is exactly what horizon methods can't express.
And because the mask has gaps in it, light can travel between two occluders — through the fence, behind the pole. That's the headline result.
Ambient (§3.2): instead of sampling your probe/skybox along the normal (ignores directionality) or along a bent normal (one cone only), split the hemisphere into K subregions, sample the ambient source once per subregion, weight each by the unoccluded bit count in that subregion. Multiple directions, per-direction occlusion, smooth. Bent normal can't do a surface enclosed by thin geometry; this can.
The catch
t is a constant you tune. You still have one depth layer, so real thickness is unknowable.

t → ∞ = you've reinvented GTAO
t too small = light leaks at depth discontinuities (Fig 6, middle)
They ship a small constant (~0.2 world units) and optionally scale it linearly with distance, arguing over-occlusion around thin objects is way more objectionable than a leak behind a thick one — big objects fully occlude anyway, so a leak "looks plausible."

Finding a real per-pixel thickness heuristic is explicitly left as future work. Also: standard screen-space caveat — light that leaves the screen stops contributing.
Why you'd care as a WebGPU dev

Cost: 0.01–0.02 ms over GTAO at 1080p on a 2080. It's free. The paper's whole pitch is that it's a drop-in patch to an existing horizon-based shader — they literally swapped θ₁, θ₂ out of Unity's GTAO.
32 sectors, not 128 — 128 needs vec4<u32> and costs 5–10% because the compiler can't pack instructions as well.
Full GI pass: ~1–2.6 ms full-res, ~1 ms half-res + bilateral upsample.
Bottleneck is bandwidth, not ALU — you're fetching depth + normal + HDR light buffer at uncorrelated locations, trashing cache. That's what to optimize, not the bit math.
WGSL has countOneBits() natively. This maps to WebGPU cleanly.
Practical gotchas from §4.3: jitter samples along the ray or you get banding; distribute steps exponentially (near stuff matters more); multi-bounce = feed last frame's indirect back into the light buffer, and watch for the energy feedback loop.

The mental shift, if you want one sentence: horizon-based methods store a scalar summary of "where does the geometry stop"; this stores a bitset of "which directions are still open." Same samples, same cost, strictly more information.Right I think that its the basis for SSRT3 https://github.com/cdrinmatane/SSRT3 which is the basis for the threejs SSGI although the threejs version has some serious lacking featuresThought processThought processLet me look at both before I speculate.Searched the web, loaded toolsSearched the web, loaded toolsYour lineage is exactly right, and it's confirmable from the source. SSGINode's docstring cites three things: SSRT3, the ssaovb-code post, and the SSILVB slides — all cdrinmatane, i.e. Olivier Therrien at CDRIN, the paper's first author. So it's paper → SSRT3 (Unity HDRP reference impl) → three.js SSGINode (TSL/WebGPU).
One disambiguation first: there are two unrelated "three.js SSGI" things. 0beqz's realism-effects SSGI is the SSR-style ray march — the noisy approach the paper argues against. The core three/addons/tsl/display/SSGINode.js is the bitmask one. I'll assume you mean the latter.
The core is faithful
The bit math ported cleanly. From SSGINode.js:
jsconst angleHorizonBitfield = /* run of bits */;
let currentOccludedBitfield = angleHorizonBitfield.shiftLeft( startHorizonInt );
currentOccludedBitfield = currentOccludedBitfield.bitAnd( globalOccludedBitfield.bitNot() );  // b_j & ~b_i
globalOccludedBitfield.assign( globalOccludedBitfield.bitOr( currentOccludedBitfield ) );      // b_i |= b_j
const numOccludedZones = countOneBits( currentOccludedBitfield );
That's algorithm 1, lines 19/23/24, verbatim. MAX_RAY = 32. GTAO's temporal rotation table is there. AO and GI go out via MRT (R8 + RGB 10-11-11). The port even fixes an upstream bug — there's a comment noting "SSRT3 has a bug where stepRadius is divided by STEP_COUNT twice; fix here."
What's actually missing
Comparing the exposed surface against SSRT3's property list:
1. No off-screen fallback. This is the big one.
SSRT3 has Fallback → Adaptive Probe Volumes or reflection probes, plus fallbackPower, fallbackIntensity, fallbackSampleCount, reflectSky. SSGINode has zero ambient source. Nothing. Grep the file — no probe, no fallback, no ambient.
This means §3.2 of the paper is entirely unimplemented. The whole "divide the hemisphere into K subregions, sample the ambient source per subregion, weight each by the unoccluded bits in that region" idea — arguably the paper's second contribution, the thing that beats bent normals — isn't there. What you get is only the on-screen bounce. Light leaves the screen, it's gone. SSRT3's README calls the fallback out as what "ensures that the illumination is stable no matter where the camera is looking," and that stability is exactly what you're missing when you pan the camera and the GI breathes.
2. No multi-bounce.
SSRT3 has both Multibounce GI (inject last frame's indirect back into the light buffer) and Multibounce AO (GTAO's analytic approximation). Neither exists in SSGINode — there's no history feedback of the GI target at all. Paper Figure 13's second bounce isn't reachable.
3. The bandwidth optimizations are gone.
The paper is explicit that this algorithm is bandwidth-bound, not ALU-bound — you're fetching depth + normal + HDR beauty at uncorrelated locations. SSRT3 ships two mitigations that didn't make the port:

Mip optimization — sample lower mips at distance
Normal Approximation — infer the sample normal from its position instead of reading the normal buffer every step

SSGINode calls sampleNormal(sampleUV) inside the inner loop unconditionally. That's the expensive fetch, per step, every time.
4. No resolution scale.
setSize() just takes renderer.getDrawingBufferSize(). The paper's Table 2 shows half-res + bilateral upsample is ~4x faster (1.07 ms vs 2.93 ms) and that's a common way to ship this. You'd have to wrap the node yourself.
5. Denoising is BYO.
useTemporalFiltering is just a bool that swaps the rotation/offset jitter — it doesn't denoise. You must wire up TRAANode yourself, or DenoiseNode if you set it false. SSRT3 ships its own accumulation + diffuse denoiser with temporalResponse and denoisingRadius. Not wrong, just more assembly required, and the defaults won't look like the SSRT3 videos out of the box.
Minor: maxLuminance = 7 is a hardcoded firefly clamp. _halfProjScale uses camera.fov, so perspective only. Needs the rg11b10ufloat-renderable feature or it errors.
The interesting thread
Worth reading issue #29668 — Therrien himself shows up in it. Two things came out of that discussion:

GT-VBAO (Mirko Salm, shadertoy): cosine-weighted sector integration instead of the paper's uniform weighting. Therrien's own words: "a great improvement over VBAO and makes it more physically correct." Salm says GI on top of it should be possible, just hadn't done it.
A unidirectional variant — halves your depth samples by marching one direction per pixel instead of both sides, letting the denoiser eat the difference. Salm's caveat: you lose about as much as you gain if your scene is mostly camera-facing surfaces.

So if you're going to extend the three.js node, the two highest-leverage additions are probably directional ambient fallback (paper §3.2 — biggest visual win, and it's just a per-subregion popcount against a probe/env sample) and multibounce (cheap — it's a feedback loop on a render target you already have).
Sources:

cdrinmatane/SSRT3
SSGINode.js source
three.js issue #29668 — Add SSILVB GI and AO
SSGINode docs
Thought processThought processShort answer: no, it's free, and no, storing it would make things worse. Both answers come from the same fact — you're nowhere near ALU-bound.
The 15 ALU is noise
The paper's Table 1, RTX 2080 @ 1080p:
radiussamplesGTAObitmaskdelta0.880.49 ms0.51 ms+4%1120.75 ms0.77 ms+2.7%1160.95 ms0.97 ms+2.1%2161.12 ms1.13 ms+0.9%3161.12 ms1.13 ms+0.9%
Look at the last two rows: radius 2 and radius 3 are the same time. The memory system is fully saturated — you can widen the radius for free because nothing is waiting on math anymore. The paper spells it out: "Increasing the radius masks this overhead as the execution becomes bandwidth-limited."
The overhead only shows up at all in the tiny-radius case, where the samples are close enough together to hit cache and the shader briefly becomes ALU-bound.
Why it's free
Per sample, the bit math is:
shift, shift, and, not, or, popcount    →  ~6 int ops, 1 cycle each, full rate
countOneBits compiles to a single hardware instruction (POPC on NVIDIA). It is not a loop over 32 bits — that's the entire O(1) claim in the paper.
Per sample, the memory work is three texture fetches (depth, normal, beauty) at uncorrelated screen locations. An L2 miss to VRAM is ~200–400 cycles. So ~15 ALU ops sit entirely inside the shadow of one fetch — and when you're bandwidth-bound rather than latency-bound, the ALUs are literally idle waiting on the memory system. Adding math to idle ALUs costs zero.
Worth noting where the real ALU does go: SSGINode ships a GTAOFastAcos() polynomial approximation, because the transcendental is expensive and the bit ops aren't. If you were going to micro-optimize the math, that's the target, not the bitmask.
Why a buffer is backwards
Look at the lifetime of the thing:
jsLoop( { end: ROTATION_COUNT }, ( { i } ) => {
    globalOccludedBitfield.assign( 0 );        // reset every slice
    color.addAssign( horizonSampling( true,  ... ) );
    color.addAssign( horizonSampling( false, ... ) );
    ao.addAssign( float( countOneBits( globalOccludedBitfield ) ).div( float( MAX_RAY ) ) );
} );
It's a uint local. It's born at the top of a slice, consumed by the inner step loop, popcounted once, and reset. It never leaves the register file and it never outlives a few hundred cycles. There's no reuse to exploit — nothing reads it later, nothing reads it next frame.
Writing it out would mean 4 bytes/pixel/slice round-tripped to VRAM. At 1080p × 3 slices that's ~25 MB of traffic per frame, added to your actual bottleneck, in order to save ~15 cycles of work on units that are already sitting idle. Strictly slower, probably badly.
And the register-residency isn't incidental — it's load-bearing. It's the reason 32 sectors is the magic number. The paper found 128 sectors costs 5–10% not because the math is 4x, but because it needs four uints, forcing vector instructions, "which limits the amount of instruction packing that the compiler could do." That's a register-pressure and ILP story. One u32 = one register = free. The moment the mask spills out of a register, the whole design stops paying off. A buffer is the maximal version of that spill.
What would actually help
Every lever is on the memory side:

Shared-memory caching of depth samples. This is the paper's own future-work note: "Using a caching method similar to LSAO could potentially improve this." Neighboring pixels marching along the same slice direction read heavily overlapping depth samples — that redundancy is real and worth attacking. This is the good version of your instinct: don't cache the mask, cache the inputs.
Depth mip pyramid — SSRT3's Mip optimization. Lower mips at distance, better cache hit rate. Missing from three.js.
Normal approximation — SSRT3's option to infer the sample normal from its position. Eliminates one of three fetches per sample outright. Also missing from three.js.

One structural catch if you want to try #1: SSGINode renders via _quadMesh.render( renderer ) — it's a fullscreen fragment pass, so there's no workgroup shared memory available to it at all. LSAO-style caching would require porting it to a compute dispatch. That's a genuinely interesting piece of work and, unlike the buffer idea, it's aimed at the thing that's actually slow.

In the slides for SSILVB they say directional occlusion with something like reflection probes gives richer ambient light. Is that like a stepping stone to using DDGI? I have test benches for that too that use probes, or would you use probes in SSGI as well?


Thought process
Thought process
No — DDGI is not a variant of SSGI. They're different enough that "which is better" doesn't quite have an answer, and I think one picture will do more than a paragraph:



That coral wall is the whole story. SSGI has literally no data about it — it isn't in the G-buffer, so it does not exist. The probes next to it sampled it hours ago (or last frame) and will happily tell any pixel that asks.

Same integral, different data structure
Here's the thing that I think is causing the confusion: both are computing the same hemisphere integral. Same rendering equation, same "gather incoming radiance over the hemisphere." That's why they feel like variants.

They're not variants, because they answer different questions to get there:

SSGI asks: "For this pixel, which other pixels can it see, and how bright are those?" A gather from the framebuffer.
DDGI asks: "For this point in space, what does the world look like in every direction?" Answered by shooting real rays into real geometry from probe positions, caching the result, and interpolating.
SSGI / VBAO	DDGI
lives in	screen space, view-dependent	world space, view-independent
light source	lit pixels in the beauty buffer	ray hits on actual geometry
needs	depth + normal + color	a BVH, plus shading at hit points
resolution	per-pixel	per-probe, interpolated
cost scales with	pixels (constant vs. scene complexity)	probes × rays, + BVH build/refit
dies on	anything off-screen	anything below probe spacing
That last row is the point. They fail in exactly opposite ways. SSGI's blindness to off-screen light is not a bug you can fix — it's definitional. DDGI's inability to resolve contact-scale detail is not a bug you can fix — you'd need absurd probe density. Neither limitation is an implementation quality issue.

That's why the hybrid isn't a compromise between two half-solutions. It's two systems whose blind spots happen to tile perfectly.

"Would DDGI be better than the hybrid?"
The framing hides the answer: the hybrid is DDGI, plus something. You're not choosing between them. You're choosing whether to add a screen-space layer on top of DDGI. So it can't be worse, modulo tuning.

But the sharper version of your question is real: why not just DDGI alone and skip the screen-space pass?

Because "DDGI alone" isn't a thing anyone ships. DDGI cannot do contact shadows — objects float, everything feels ungrounded, small-scale bleeding vanishes. So in practice it's always DDGI + some AO pass. And once you've accepted you're paying for a screen-space AO pass anyway…

Look at the paper's Table 1 again. Upgrading horizon AO → visibility bitmask costs +0.01–0.02 ms. You were already paying 0.5–1.1 ms for the AO. For that rounding error you get:

better AO (no thin-surface halos)
a free near-field GI bounce
per-sector directional occlusion to modulate your DDGI lookup
The screen-space layer is nearly free relative to the AO you'd have run regardless. That's what makes the hybrid the obvious call rather than a nice-to-have.

Where DDGI genuinely wins
Not just "far field." Two things it does structurally better:

Multi-bounce is principled. Probe rays hit a surface, and shading that hit point samples the surrounding probes — so probes feed each other and converge toward infinite bounces over frames. Compare SSGI's version, which is a frame-delayed feedback hack that the paper itself warns about: "light intensity needs to be properly balanced when using multi-bounce, or it can cause a feedback loop resulting in lighting accumulation over time." DDGI's convergence is the real thing; SSGI's is a trick with a stability caveat.

Temporal stability. Probes accumulate with hysteresis over many frames and are view-independent, so camera motion doesn't perturb them. SSGI needs TAA, ghosts, and pops at screen edges. This is why the fallback matters so much for stability, not just correctness — SSRT3's README frames it exactly that way: it "ensures that the illumination is stable no matter where the camera is looking."

The cost shapes are different too
This is worth internalizing separately. The VBAO paper's opening pitch:

"Screen space approximations... reduce the dimensionality of the problem and make the execution cost constant regardless of the scene's geometric complexity."

SSGI is ~1–2 ms whether your scene has 10k triangles or 10M. DDGI's cost is probes × rays per probe, plus BVH maintenance for anything dynamic. Those are completely different budget curves — which is another sign they're not competing implementations of one thing. You'd never trade one off against the other on a perf slider; they're separate line items.

So: DDGI is your radiance producer and your stability floor. VBAO is your detail layer and your router. Neither is a version of the other.

right but with a DDGI setup would you even run the SSGI logic? or is that a misconception? Its often pitted SSGI vs DDGI


Thought process
Thought process
Not a misconception — the pitting is real, it's just answering a different question than the one you're now asking.

Why they get pitted
"SSGI vs DDGI" is usually shorthand for "which GI solution do I pick for my project?" And that is a genuine either/or, because both are being proposed as the indirect diffuse answer:

Pick SSGI-only → you accept that light vanishes when it leaves the screen.
Pick DDGI-only → you accept mush below probe spacing, and you bolt on AO.
Engine UIs reinforce it. HDRP has SSGI as an override and APV as a lighting system; they look like two checkboxes that both claim "indirect diffuse." SSRT3's README literally tells you to set Indirect Diffuse Lighting Multiplier → 0 and let it own the whole budget. So the framing isn't invented — it's how the tools present themselves.

The framing I'd push instead: the real axis is near-field vs far-field, and you need an answer for both. "SSGI vs DDGI" is comparing one answer to the first question against one answer to the second.

But here's what actually changes your calculus
You have a GPU BVH. That voids the VBAO paper's entire premise.

Re-read its justification: screen space is attractive because we don't have the scene, so we reconstruct it from depth, and that reconstruction is lossy (the heightfield assumption), so here's a bitmask to make the lossy reconstruction less lossy. The bitmask is an elaborate workaround for not having geometry. If you can trace a real ray, you don't need to guess thickness with a tunable constant — you know it.

So the honest question for you isn't "SSGI vs DDGI." It's: should my near field be screen-space at all, or should it be short BVH rays? That's the direction Lumen went with its hardware RT path, and it's where the field converges when rays are cheap: short world rays for near field, irradiance cache for far field. No screen-space gather anywhere.

Why I'd still run it on WebGPU specifically
Because your rays aren't cheap. WebGPU doesn't expose ray tracing hardware in anything broadly shipping, so three-mesh-bvh's GPU path is software traversal in a shader — a stack loop in WGSL, no RT cores. That's a different cost class from a PS5 or a 4090 doing hardware traversal.

Which inverts the usual advice:

Your DDGI probe rays are already the expensive thing in your frame. They're worth it because they amortize — a probe's rays serve many pixels, over many frames, with hysteresis.
A per-pixel near-field ray does not amortize. It serves one pixel, one frame.
VBAO is a fixed ~1–2 ms bandwidth-bound pass, constant regardless of scene complexity.
So on WebGPU the hybrid is more correct than it'd be on a console, not less. Spend scarce software-traced rays where they amortize (probes); take the near field from the pass that doesn't care how many triangles you have.

And the question partly dissolves
You're running a screen-space pass for AO regardless — DDGI can't do contact shadows, and RTAO through a software BVH is not where you want your budget. So the pass is already in your frame. VBAO is that pass. The GI bounce and the directional ambient ride along for the +0.01–0.02 ms in the paper's table.

"Would you even run SSGI" turns out to be "would you run the AO pass you were already running, with a better inner loop."

When I'd actually skip it
Being fair to the DDGI-only camp — it's a legitimate ship, and the costs of the hybrid aren't only in milliseconds:

SSGI drags in a TAA dependency, ghosting, disocclusion artifacts, and screen-edge popping. DDGI alone is rock stable. If stability matters more than contact detail, that's a real trade.
Two systems means a double-counting seam and two interacting tuning surfaces. That's ongoing engineering cost, not a one-time integration.
If your scene is large-scale and architectural — few small props, not much contact-scale geometry — crank probe density, use a cheap AO, and you may not be able to tell. The near-field color bleed is subtler than people think. Most of what reads as "grounded" is the occlusion, not the bounce.
That last point is worth sitting with: if you strip VBAO down to just its AO and directional ambient and never wire up the GI bounce, you'd keep most of the perceptual win. The bounce is the part that's easiest to talk about and the hardest to see.