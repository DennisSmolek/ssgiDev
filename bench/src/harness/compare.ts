import type { RenderTarget, Texture, WebGPURenderer } from 'three/webgpu';
import { RawRenderPass } from './raw-pass';
import compareWgsl from './compare.wgsl?raw';

// A/B comparator harness feature (PLAN "split-screen A/B slider" + "pixel-diff").
// Wraps the generic compare.wgsl raw pass. Given two textures (three Texture or
// RenderTarget.texture, same resolution) it renders left|right split with a
// draggable divider, or an amplified abs-diff, into a three-allocated
// RenderTarget the caller owns. Kept generic so any later demo can A/B any two
// pipeline outputs; demo 02 uses it for 1-sample-live vs converged-accumulated.
//
// Design choice (logged): implemented as a raw WGSL pass (not a TSL node) so it
// reuses the proven RawRenderPass texture-load interop, rebinds whichever GPU
// textures it is handed per frame (ping-pong / resize safe), and needs no TSL
// recompile when the compared sources change. Divider position is a CPU-driven
// uniform; the owning demo wires pointer drag to it.

export type CompareMode = 'split' | 'diff';
export type CompareChannel = 'rgb' | 'alpha';

export interface CompareState {
  mode: CompareMode;
  splitX: number; // 0..1 fraction of width
  amp: number; // diff amplification
  scaleA: number;
  scaleB: number;
  channel: CompareChannel;
}

// resolution.xy, splitX, mode, amp, scaleA, scaleB, channel = 8 floats.
const FLOATS = 8;

export class Comparator {
  private readonly pass: RawRenderPass;
  private readonly data = new Float32Array(FLOATS);
  private readonly u32 = new Uint32Array(this.data.buffer);

  constructor(renderer: WebGPURenderer, label = 'compare') {
    this.pass = new RawRenderPass(renderer, label, compareWgsl, {
      bindings: [{ kind: 'tex' }, { kind: 'tex' }, { kind: 'uniform' }],
    });
  }

  configure(outputTarget: RenderTarget): void {
    this.pass.configure(outputTarget, this.data.byteLength);
  }

  execute(
    outputTarget: RenderTarget,
    texA: Texture,
    texB: Texture,
    width: number,
    height: number,
    state: CompareState,
  ): void {
    this.data[0] = width;
    this.data[1] = height;
    this.data[2] = state.splitX * width;
    this.u32[3] = state.mode === 'diff' ? 1 : 0;
    this.data[4] = state.amp;
    this.data[5] = state.scaleA;
    this.data[6] = state.scaleB;
    this.u32[7] = state.channel === 'alpha' ? 1 : 0;
    this.pass.execute(outputTarget, [texA, texB, this.data], { loadOp: 'clear' });
  }
}
