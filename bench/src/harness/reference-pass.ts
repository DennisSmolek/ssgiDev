import { HalfFloatType, NoColorSpace, RenderTarget } from 'three/webgpu';
import type { PerspectiveCamera, Texture, WebGPURenderer } from 'three/webgpu';
import { RawRenderPass } from './raw-pass';
import { ensureRenderTarget } from './three-internals';
import marcherWgsl from './reference-marcher.wgsl?raw';

// Shared ground-truth reference pass (promoted out of demo 02).
//
// Owns the ONE copy of the brute-force screen-space ray-march reference
// (reference-marcher.wgsl), its additive-blend accumulation RenderTarget, the
// running sample count, and the pose-reset logic (camera-move detection). Any
// demo can construct one and, while a reference/split/diff view is active, call
// update() once per frame to advance the temporal accumulation. The converged
// output is exposed as a plain three Texture (outputTexture) consumable both by
// TSL texture() nodes AND as a bindable input to raw passes (e.g. the A/B
// Comparator in compare.ts).
//
// Interop rule (harness convention): raw passes NEVER allocate inter-pass GPU
// textures — this class allocates its accumulation target as a three
// RenderTarget (via RenderTarget + ensureRenderTarget) and the RawRenderPass
// writes into it. Same HalfFloat / NoColorSpace layout demos already use.
//
// LAZY-RUN CONTRACT: this class does not decide when it runs; the host demo
// does. The marcher is EXPENSIVE (raysPerPixel * stepsPerRay * pixels per
// frame), so demos that use the reference only for comparison (04/05) must call
// update() ONLY while a reference/split/diff view is active and call reset()
// when such a view is (re)activated so accumulation restarts from a clean state
// on the current camera pose. Demo 02, whose primary output IS the reference,
// calls update() every frame. Accumulation converges over ~2-4s on a static
// camera and resets on any camera movement.

export interface ReferenceInputs {
  depth: Texture; // texture_depth_2d (DepthTexture)
  normal: Texture; // view-space normal, [-1,1]
  beauty: Texture; // HDR lit output (radiance gathered on hit)
}

export interface ReferenceParams {
  raysPerPixel: number;
  stepsPerRay: number;
  radius: number; // max march length (world/view units)
  thickness: number; // world-space slab depth
  bias: number; // normal-offset on ray origin
  maxLuminance: number; // firefly clamp on gathered radiance
  giStrength: number;
  skyIntensity: number; // radiance added on a miss (0 for closed Cornell)
  accumulate: boolean;
  maxAccumFrames: number;
}

// Marcher uniform layout (reference-marcher.wgsl Params): proj(16) + invProj(16)
// + [res.xy,near,far] + [rays,steps,count,seed] + [radius,thickness,bias,maxLum]
// + [giStrength,sky,pad,pad] = 48 floats (192 B).
const MARCHER_FLOATS = 48;

const ADDITIVE: GPUBlendState = {
  color: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
  alpha: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
};

function floatRT(): RenderTarget {
  const rt = new RenderTarget(1, 1, { type: HalfFloatType, depthBuffer: false });
  rt.texture.colorSpace = NoColorSpace;
  return rt;
}

export class ReferencePass {
  // rgb = GI radiance sum, a = AO sum. Divide by sampleCount to recover the mean.
  readonly accumRT: RenderTarget = floatRT();

  private readonly marcher: RawRenderPass;
  private readonly data = new Float32Array(MARCHER_FLOATS);
  private readonly u32 = new Uint32Array(this.data.buffer);
  private configured = false;

  // Accumulation state.
  private _sampleCount = 0;
  private resetRequested = true;
  // Float64: fovHash is ~40000, whose float32 quantization error (~0.004) would
  // otherwise exceed the move threshold and reset accumulation every frame.
  private lastPose = new Float64Array(8); // pos(3) + quat(4) + fovHash(1)

  constructor(
    private readonly renderer: WebGPURenderer,
    private readonly label = 'reference',
  ) {
    this.marcher = new RawRenderPass(renderer, label, marcherWgsl, {
      bindings: [{ kind: 'depth' }, { kind: 'tex' }, { kind: 'tex' }, { kind: 'uniform' }],
      blend: ADDITIVE,
    });
  }

  get sampleCount(): number {
    return this._sampleCount;
  }

  // The converged accumulation texture. Consumers must divide by sampleCount.
  get outputTexture(): Texture {
    return this.accumRT.texture;
  }

  // Allocate the accumulation target at (w,h). Call before configure() and on
  // every resize (three reallocates the GPU texture).
  setSize(width: number, height: number): void {
    this.accumRT.setSize(width, height);
    ensureRenderTarget(this.renderer, this.accumRT);
    // Any resize invalidates prior accumulation.
    this.resetRequested = true;
  }

  // Build the marcher pipeline against the accumulation target's format. Must run
  // after the first setSize(); the format never changes so no reconfigure on
  // resize (mirrors demo 02 / RawRenderPass convention).
  configure(): void {
    if (this.configured) return;
    this.marcher.configure(this.accumRT, this.data.byteLength);
    this.configured = true;
  }

  // Force the next update() to restart accumulation. Call on (re)activation of a
  // reference view so a parked pass does not display stale samples.
  reset(): void {
    this.resetRequested = true;
  }

  // Detects camera movement. Threshold tolerates OrbitControls damping residual
  // jitter (too tight resets every frame; never converges). Hashes pose/fov/
  // aspect only — NOT the projection matrix — so sub-pixel TAA jitter applied by
  // the host demo does not trip a reset.
  private cameraMoved(cam: PerspectiveCamera): boolean {
    const EPS = 2e-4;
    const p = cam.position;
    const q = cam.quaternion;
    const fovHash = cam.fov * 1000 + cam.aspect;
    const changed =
      Math.abs(this.lastPose[0] - p.x) > EPS ||
      Math.abs(this.lastPose[1] - p.y) > EPS ||
      Math.abs(this.lastPose[2] - p.z) > EPS ||
      Math.abs(this.lastPose[3] - q.x) > EPS ||
      Math.abs(this.lastPose[4] - q.y) > EPS ||
      Math.abs(this.lastPose[5] - q.z) > EPS ||
      Math.abs(this.lastPose[6] - q.w) > EPS ||
      Math.abs(this.lastPose[7] - fovHash) > EPS;
    this.lastPose.set([p.x, p.y, p.z, q.x, q.y, q.z, q.w, fovHash]);
    return changed;
  }

  // Advance the temporal accumulation by one sample. Reads camera.projectionMatrix
  // (already jittered by the host demo, if any) each call. Resets on camera move,
  // an explicit reset(), or when accumulation is disabled.
  update(
    camera: PerspectiveCamera,
    inputs: ReferenceInputs,
    params: ReferenceParams,
    width: number,
    height: number,
  ): void {
    if (!this.configured) {
      throw new Error(`ReferencePass(${this.label}): configure() must run before update().`);
    }
    if (this.cameraMoved(camera) || this.resetRequested || !params.accumulate) {
      this._sampleCount = 0;
      this.resetRequested = false;
    }
    if (this._sampleCount < params.maxAccumFrames) {
      const loadOp: GPULoadOp = this._sampleCount === 0 ? 'clear' : 'load';
      this.fillUniform(camera, params, width, height, this._sampleCount);
      this.marcher.execute(
        this.accumRT,
        [inputs.depth, inputs.normal, inputs.beauty, this.data],
        { loadOp, clearValue: { r: 0, g: 0, b: 0, a: 0 } },
      );
      this._sampleCount++;
    }
  }

  // Run a single, non-accumulated sample into an arbitrary same-format target
  // (HalfFloat RenderTarget). Used by demo 02's live-vs-converged split view.
  // loadOp 'clear' over the additive blend == a plain single-sample write.
  renderSingle(
    target: RenderTarget,
    camera: PerspectiveCamera,
    inputs: ReferenceInputs,
    params: ReferenceParams,
    width: number,
    height: number,
    seed: number,
  ): void {
    if (!this.configured) {
      throw new Error(`ReferencePass(${this.label}): configure() must run before renderSingle().`);
    }
    this.fillUniform(camera, params, width, height, seed);
    this.marcher.execute(
      target,
      [inputs.depth, inputs.normal, inputs.beauty, this.data],
      { loadOp: 'clear', clearValue: { r: 0, g: 0, b: 0, a: 0 } },
    );
  }

  private fillUniform(
    cam: PerspectiveCamera,
    params: ReferenceParams,
    width: number,
    height: number,
    seed: number,
  ): void {
    const d = this.data;
    const u = this.u32;
    d.set(cam.projectionMatrix.elements, 0);
    d.set(cam.projectionMatrixInverse.elements, 16);
    d[32] = width;
    d[33] = height;
    d[34] = cam.near;
    d[35] = cam.far;
    u[36] = params.raysPerPixel;
    u[37] = params.stepsPerRay;
    u[38] = this._sampleCount;
    u[39] = seed >>> 0;
    d[40] = params.radius;
    d[41] = params.thickness;
    d[42] = params.bias;
    d[43] = params.maxLuminance;
    d[44] = params.giStrength;
    d[45] = params.skyIntensity;
    d[46] = 0;
    d[47] = 0;
  }

  dispose(): void {
    this.accumRT.dispose();
  }
}
