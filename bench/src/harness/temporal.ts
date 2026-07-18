import { RenderTarget } from 'three/webgpu';
import type { PerspectiveCamera, Texture, Vector2 } from 'three/webgpu';

// --- Sub-pixel projection jitter (TAA-style) -------------------------------
// Accumulation demos jitter only their hemisphere-sampling noise, so the
// G-buffer rasterizes identically every frame and converged output keeps
// aliased edges. Jittering the projection sub-pixel per frame (exactly what
// TRAANode does) makes a static-camera accumulation integrate the pixel
// footprint over time — strictly better reference quality (supersampling +
// a more correct pixel-footprint integral).
//
// Mirrors three's TRAANode convention: offsets are in PIXELS, centered in
// [-0.5, 0.5), applied via camera.setViewOffset(w, h, jx, jy, w, h). A
// fractional view offset is valid — setViewOffset marks the projection dirty
// and calls updateProjectionMatrix() internally, so no extra call is needed.

function halton(index: number, base: number): number {
  let fraction = 1;
  let result = 0;
  while (index > 0) {
    fraction /= base;
    result += fraction * (index % base);
    index = Math.floor(index / base);
  }
  return result;
}

// 16 centered Halton(2,3) offsets in [-0.5, 0.5) pixels. index+1 so entry 0 is
// a real offset, not (0,0) (matching TRAANode, which also starts at index 1).
export const HALTON_JITTER: ReadonlyArray<readonly [number, number]> = Array.from(
  { length: 16 },
  (_, i) => [halton(i + 1, 2) - 0.5, halton(i + 1, 3) - 0.5] as const,
);

// Apply a sub-pixel view offset to the camera. w/h MUST be the current render
// size. setViewOffset also sets camera.aspect = w/h (unchanged here) and calls
// updateProjectionMatrix() itself. Note: this jitters the projection matrix
// only — position/quaternion/fov/aspect are untouched, so an accumulation
// demo's cameraMoved() (which hashes only those) does NOT trip on jitter.
export function applyCameraJitter(
  camera: PerspectiveCamera,
  w: number,
  h: number,
  jx: number,
  jy: number,
): void {
  camera.setViewOffset(w, h, jx, jy, w, h);
}

// Remove any active view offset (restores the un-jittered projection).
export function clearCameraJitter(camera: PerspectiveCamera): void {
  camera.clearViewOffset();
}

// Temporal contract (skeleton). Interfaces only — no reprojection WGSL yet
// (that is M2/M3). The G-buffer already carries velocity (demo 00 MRT) so these
// inputs can be populated the moment reprojection lands. Every technique demo
// (03–09) will declare its temporal inputs/outputs against this contract rather
// than reimplementing history/jitter plumbing.

// Per-frame temporal inputs a technique consumes.
export interface TemporalInputs {
  // Screen-space motion vectors (velocity MRT channel). WebGPU top-left UV.
  motionVectors: Texture;
  // Subpixel camera jitter applied this frame, in NDC. Zero until M2 enables it.
  jitter: Vector2;
  // Ping-pong history owned by the harness, not the demo.
  history: HistoryTarget;
  // True on the first frame or after a resize/camera-cut: history is invalid,
  // consumers must fall back to the current-frame estimate.
  reset: boolean;
}

// What a temporal-aware pass promises to produce, for validation/documentation.
export interface TemporalOutputs {
  // The signal written into the current history slot this frame.
  resolved: Texture;
}

export interface TemporalContract {
  inputs: TemporalInputs;
  outputs: TemporalOutputs;
}

export interface HistoryTargetOptions {
  count?: number;
  // Passed straight to RenderTarget texture options (type/format/etc).
  textureOptions?: ConstructorParameters<typeof RenderTarget>[2];
}

// Owns a ping-pong pair of RenderTargets and the invalidation flag. A resize
// reallocates both and marks history invalid so consumers do not reproject
// against a stale-resolution buffer.
export class HistoryTarget {
  private a: RenderTarget;
  private b: RenderTarget;
  private width = 1;
  private height = 1;
  private _invalid = true;

  constructor(options: HistoryTargetOptions = {}) {
    const count = options.count ?? 1;
    this.a = new RenderTarget(1, 1, { count, ...options.textureOptions });
    this.b = new RenderTarget(1, 1, { count, ...options.textureOptions });
  }

  // The buffer being written this frame.
  get current(): RenderTarget {
    return this.a;
  }
  // Last frame's resolved buffer. Invalid when `wasInvalidated` is true.
  get history(): RenderTarget {
    return this.b;
  }
  get wasInvalidated(): boolean {
    return this._invalid;
  }

  setSize(width: number, height: number): void {
    if (width === this.width && height === this.height) return;
    this.width = width;
    this.height = height;
    this.a.setSize(width, height);
    this.b.setSize(width, height);
    this._invalid = true;
  }

  // Explicitly drop history (camera cut, scene switch).
  invalidate(): void {
    this._invalid = true;
  }

  // Call after writing `current`: swaps roles and clears the invalidation flag.
  advance(): void {
    const tmp = this.a;
    this.a = this.b;
    this.b = tmp;
    this._invalid = false;
  }

  dispose(): void {
    this.a.dispose();
    this.b.dispose();
  }
}
