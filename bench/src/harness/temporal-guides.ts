import {
  DataTexture,
  FloatType,
  HalfFloatType,
  NoColorSpace,
  RedFormat,
  RGFormat,
  StorageTexture,
  UnsignedByteType,
} from 'three/webgpu';
import type { PerspectiveCamera, Texture, WebGPURenderer } from 'three/webgpu';
import { RawComputePass } from './raw-compute-pass';
import { ensureTexture } from './three-internals';
import dilateWgsl from './temporal-guides-dilate.wgsl?raw';
import reprojWgsl from './temporal-guides.wgsl?raw';
import commitWgsl from './temporal-guides-commit.wgsl?raw';

// Shared TemporalGuidesPass — the bench-side implementation of the FSR3-BRIEF
// "temporal guides" bundle (FSR3-BRIEF.md, decomposition step 1). Produced once
// per frame, post-G-buffer, pre-effects; every temporal consumer (SSGI
// temporal, denoisers, TAA) can read ONE copy of these frame properties instead
// of re-deriving worse private versions.
//
// Outputs (contract formats; all texture-formats-tier1 storage formats, the
// same tier demo 03's r16float frame-counter already relies on — three requests
// every adapter feature so tier1 is live on this bench's Apple/Chrome adapter):
//   dilatedVelocity  rg16float  closest-depth 3x3 dilated velocity (NDC delta)
//   disocclusion     r16float   graded 0 (stable) .. 1 (fresh)
//   historyLength    r16float   per-pixel valid-history frame count N
//   reactive         r8unorm    app/effect fast-change mask (merge-in, default 0)
//
// Pipeline (3 dispatches; cross-pixel data deps forbid folding them):
//   1. dilate   depth+velocity            -> dilatedVelocity
//   2. reproject depth+dilatedVel+prevDepth+histPrev+reactiveIn
//                                          -> disocclusion, histCur, reactive
//   3. commit   depth+histCur             -> prevDepth, histPrev  (for next frame)
//
// The pass OWNS its prev-depth (and prev-history) copies and refreshes them in
// stage 3 only AFTER stage 2 consumed the old ones — the demo 03 copydepth
// pattern. No ping-pong is exposed: histCur/prevDepth are stable texture objects
// so a TSL texture() node or a raw-pass binding built once stays valid across
// frames (matches how ReferencePass exposes accumRT).
//
// LAZY-RUN CONTRACT (like ReferencePass): the class is cheap to construct and
// allocate, but update() is the per-frame cost — the host demo calls it ONLY
// while the guides are actually consumed (guides-fed stack active, or a guides
// debug view). Outputs are plain three Textures, so they feed both raw compute
// passes (RawComputePass bridges them to GPUTextures internally) and TSL
// texture() nodes with no special casing.

export interface GuideInputs {
  depth: Texture; // texture_depth_2d (scene DepthTexture)
  velocity: Texture; // three MRT velocity (NDC delta)
  // Optional app/effect reactive hints (r8unorm-ish, full render-res). When
  // omitted the pass seeds reactive from its 1x1 zero fallback (=> 0 everywhere).
  reactiveMask?: Texture;
}

export interface GuideParams {
  // Global reset: clear history + force fully-fresh disocclusion this frame.
  // The host passes the SAME reset signal its other temporal stacks use (camera
  // teleport / resize / first frames) so the A/B stays isolated to the guides.
  reset: boolean;
  // Disocclusion grading thresholds on relative eye-depth error (fraction of the
  // surface's own distance). relErr <= lo => 0 (stable); >= hi => 1 (fresh).
  disoccLo: number;
  disoccHi: number;
  // History resets to 0 where graded disocclusion exceeds this.
  disoccResetThreshold: number;
  historyCap: number; // N saturates here
  // true => nearest-to-camera == MIN device depth (standard [0,1] perspective).
  closestIsMin: boolean;
}

const DILATE_FLOATS = 4; // resX, resY, closestIsMin, pad
const REPROJ_FLOATS = 12; // res(2) + near,far + lo,hi,resetThresh,cap + flags + 3 pad
const COMMIT_FLOATS = 4; // resX, resY, pad, pad

export class TemporalGuidesPass {
  // Stable output textures (getters below). Single-mip storage; NoColorSpace.
  private readonly dilatedVelTex = makeStorage(HalfFloatType, RGFormat); // rg16float
  private readonly disoccTex = makeStorage(HalfFloatType, RedFormat); // r16float
  private readonly histCur = makeStorage(HalfFloatType, RedFormat); // r16float (this frame N)
  private readonly reactiveTex = makeStorage(UnsignedByteType, RedFormat); // r8unorm
  // Pass-owned previous-frame copies (written by stage 3).
  private readonly prevDepthTex = makeStorage(FloatType, RedFormat); // r32float
  private readonly histPrevTex = makeStorage(HalfFloatType, RedFormat); // r16float
  // 1x1 zero reactive fallback (bound when no app mask is supplied).
  private readonly zeroReactive: DataTexture;

  private readonly dilatePass: RawComputePass;
  private readonly reprojPass: RawComputePass;
  private readonly commitPass: RawComputePass;

  private readonly dilateData = new Float32Array(DILATE_FLOATS);
  private readonly reprojData = new Float32Array(REPROJ_FLOATS);
  private readonly reprojU32 = new Uint32Array(this.reprojData.buffer);
  private readonly commitData = new Float32Array(COMMIT_FLOATS);

  private width = 1;
  private height = 1;
  private configured = false;

  constructor(
    private readonly renderer: WebGPURenderer,
    private readonly label = 'temporal-guides',
  ) {
    this.dilatePass = new RawComputePass(renderer, `${label}-dilate`, dilateWgsl, {
      bindings: [
        { kind: 'depth' },
        { kind: 'tex' },
        { kind: 'storage', format: 'rg16float' },
        { kind: 'uniform' },
      ],
    });
    this.reprojPass = new RawComputePass(renderer, `${label}-reproject`, reprojWgsl, {
      bindings: [
        { kind: 'depth' }, // 0 current depth
        { kind: 'tex' }, // 1 dilated velocity
        { kind: 'tex' }, // 2 prev depth
        { kind: 'tex' }, // 3 prev history N
        { kind: 'tex' }, // 4 reactive-in (mask or 1x1 zero)
        { kind: 'storage', format: 'r16float' }, // 5 disocclusion out
        { kind: 'storage', format: 'r16float' }, // 6 history out
        { kind: 'storage', format: 'r8unorm' }, // 7 reactive out
        { kind: 'uniform' },
      ],
    });
    this.commitPass = new RawComputePass(renderer, `${label}-commit`, commitWgsl, {
      bindings: [
        { kind: 'depth' },
        { kind: 'tex' }, // histCur
        { kind: 'storage', format: 'r32float' }, // prevDepth out
        { kind: 'storage', format: 'r16float' }, // histPrev out
        { kind: 'uniform' },
      ],
    });

    const zero = new Uint8Array([0]);
    this.zeroReactive = new DataTexture(zero, 1, 1, RedFormat, UnsignedByteType);
    this.zeroReactive.colorSpace = NoColorSpace;
    this.zeroReactive.needsUpdate = true;
  }

  // ---- output getters (plain three Textures; valid for TSL + raw passes) ----
  get dilatedVelocityTexture(): Texture {
    return this.dilatedVelTex;
  }
  get disocclusionTexture(): Texture {
    return this.disoccTex;
  }
  get historyLengthTexture(): Texture {
    return this.histCur;
  }
  get reactiveTexture(): Texture {
    return this.reactiveTex;
  }

  // Allocate all owned textures at (w,h). Call before configure() and on every
  // resize (three reallocates the GPU texture on dispose()). A resize is a hard
  // discontinuity, so the next update() should be a reset (host's responsibility,
  // it already resets its own temporal state on resize).
  setSize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    for (const t of [
      this.dilatedVelTex,
      this.disoccTex,
      this.histCur,
      this.reactiveTex,
      this.prevDepthTex,
      this.histPrevTex,
    ]) {
      t.image = { width, height } as StorageTexture['image'];
      t.dispose();
      ensureTexture(this.renderer, t);
    }
    ensureTexture(this.renderer, this.zeroReactive);
  }

  // Build the three compute pipelines. Storage formats are fixed in the bindings
  // so no reconfigure on resize (RawComputePass convention). Must run after the
  // first setSize().
  configure(): void {
    if (this.configured) return;
    this.dilatePass.configure(this.dilateData.byteLength);
    this.reprojPass.configure(this.reprojData.byteLength);
    this.commitPass.configure(this.commitData.byteLength);
    this.configured = true;
  }

  // Produce the guides for this frame. `camera` supplies near/far for the depth
  // linearisation; `inputs` are this frame's G-buffer depth + velocity (+ an
  // optional reactive mask to merge). Ordered: dilate -> reproject -> commit, so
  // stage 2 reads last frame's prevDepth/histPrev before stage 3 overwrites them.
  update(camera: PerspectiveCamera, inputs: GuideInputs, params: GuideParams): void {
    if (!this.configured) {
      throw new Error(`TemporalGuidesPass(${this.label}): configure() must run before update().`);
    }
    const w = this.width;
    const h = this.height;

    // Stage 1 — dilate.
    this.dilateData[0] = w;
    this.dilateData[1] = h;
    this.dilateData[2] = params.closestIsMin ? 1 : 0;
    this.dilateData[3] = 0;
    this.dilatePass.execute([inputs.depth, inputs.velocity, this.dilatedVelTex, this.dilateData], w, h);

    // Stage 2 — reproject / grade / history / reactive.
    this.reprojData[0] = w;
    this.reprojData[1] = h;
    this.reprojData[2] = camera.near;
    this.reprojData[3] = camera.far;
    this.reprojData[4] = params.disoccLo;
    this.reprojData[5] = params.disoccHi;
    this.reprojData[6] = params.disoccResetThreshold;
    this.reprojData[7] = params.historyCap;
    this.reprojU32[8] = params.reset ? 1 : 0;
    this.reprojU32[9] = 0;
    this.reprojU32[10] = 0;
    this.reprojU32[11] = 0;
    const reactiveIn = inputs.reactiveMask ?? this.zeroReactive;
    this.reprojPass.execute(
      [
        inputs.depth,
        this.dilatedVelTex,
        this.prevDepthTex,
        this.histPrevTex,
        reactiveIn,
        this.disoccTex,
        this.histCur,
        this.reactiveTex,
        this.reprojData,
      ],
      w,
      h,
    );

    // Stage 3 — commit this frame's depth + history for next frame.
    this.commitData[0] = w;
    this.commitData[1] = h;
    this.commitPass.execute([inputs.depth, this.histCur, this.prevDepthTex, this.histPrevTex, this.commitData], w, h);
  }

  dispose(): void {
    for (const t of [
      this.dilatedVelTex,
      this.disoccTex,
      this.histCur,
      this.reactiveTex,
      this.prevDepthTex,
      this.histPrevTex,
      this.zeroReactive,
    ]) {
      t.dispose();
    }
  }
}

function makeStorage(type: number, format: number): StorageTexture {
  const t = new StorageTexture(1, 1);
  t.type = type as StorageTexture['type'];
  t.format = format as StorageTexture['format'];
  t.colorSpace = NoColorSpace;
  t.generateMipmaps = false; // storage bindings require mipLevelCount 1
  return t;
}
