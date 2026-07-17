import { RenderTarget } from 'three/webgpu';
import type { Texture, Vector2 } from 'three/webgpu';

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
