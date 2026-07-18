import { TimestampQuery } from 'three/webgpu';
import type { WebGPURenderer } from 'three/webgpu';

class Rolling {
  private buf: number[] = [];
  constructor(private readonly size = 60) {}
  push(v: number): void {
    this.buf.push(v);
    if (this.buf.length > this.size) this.buf.shift();
  }
  get avg(): number {
    if (this.buf.length === 0) return 0;
    let s = 0;
    for (const v of this.buf) s += v;
    return s / this.buf.length;
  }
}

// Rolling CPU + GPU timings. GPU timing degrades gracefully to 0 (reported as
// "n/a" in the readout) when timestamp-query is unavailable.
export class Timing {
  private cpu = new Rolling();
  private gpu = new Rolling();
  private interval = new Rolling();
  private named = new Map<string, Rolling>();
  private frameT0 = 0;
  private lastFrameStart = 0;
  private gpuInFlight = false;

  // Live object the stats panel binds readonly monitors to.
  readonly readout: Record<string, number | boolean> = {
    fps: 0,
    cpuMs: 0,
    gpuMs: 0,
    rawMs: 0,
    gpuAvailable: false,
  };

  constructor(private readonly hasTimestamp: boolean) {
    this.readout.gpuAvailable = hasTimestamp;
  }

  frameStart(): void {
    const now = performance.now();
    // FPS = wall-clock interval between frame starts (the rAF/vsync cadence),
    // NOT 1000/cpu-work-time, which reports impossible throughput numbers.
    // Intervals > 500 ms (tab hidden, debugger pause) are dropped, not averaged.
    if (this.lastFrameStart > 0) {
      const delta = now - this.lastFrameStart;
      if (delta < 500) {
        this.interval.push(delta);
        this.readout.fps = this.interval.avg > 0 ? Math.round(1000 / this.interval.avg) : 0;
      }
    }
    this.lastFrameStart = now;
    this.frameT0 = now;
  }

  frameEnd(): void {
    const ms = performance.now() - this.frameT0;
    this.cpu.push(ms);
    this.readout.cpuMs = round2(this.cpu.avg);
  }

  // Named CPU sub-timer (e.g. the raw pass, which three's timestamp pool does
  // not cover because it is submitted outside renderer.render()).
  markCPU(name: string, ms: number): void {
    let r = this.named.get(name);
    if (!r) {
      r = new Rolling();
      this.named.set(name, r);
    }
    r.push(ms);
    (this.readout as Record<string, number>)[`${name}Ms`] = round2(r.avg);
  }

  // Resolves three's aggregate render-pass GPU time for the frame. Fire-and-
  // forget; skips if a resolve is still pending to avoid overlapping awaits.
  sampleGPU(renderer: WebGPURenderer): void {
    if (!this.hasTimestamp || this.gpuInFlight) return;
    this.gpuInFlight = true;
    void renderer
      .resolveTimestampsAsync(TimestampQuery.RENDER)
      .then(() => {
        const ms = renderer.info.render.timestamp;
        if (typeof ms === 'number' && ms > 0) {
          this.gpu.push(ms);
          this.readout.gpuMs = round2(this.gpu.avg);
        }
      })
      .catch(() => {})
      .finally(() => {
        this.gpuInFlight = false;
      });
  }
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}
