import {
  DepthTexture,
  FloatType,
  HalfFloatType,
  RenderTarget,
  RenderPipeline,
} from 'three/webgpu';
import { mrt, output, screenUV, texture, vec4, velocity } from 'three/tsl';
import { DebugView, Upscaler } from '@pmndrs/upscaler';
import type { UpscalePath } from '@pmndrs/upscaler';
import type { Demo, DemoDef, HarnessContext } from '../../harness/types';
import { buildParams } from '../../harness/params';
import type { ParamGroup } from '../../harness/params';

// Demo 16 — the FSR3 upscaler (@pmndrs/upscaler, linked build per
// GUIDES-HANDOFF.md) consumed as a whole pipeline: jittered scene render at
// reduced res -> temporal reconstruction at display res. This is the "just use
// FSR" integration demo — it exercises the exact frame shape the deep
// integrations (guides-fed demo 10 A/B, 14-svgf) will reuse:
//
//   beginFrame (camera jitter) -> G-buffer MRT (color+velocity, float depth)
//   -> endFrame -> dispatchGuides (early products live from here)
//   -> [guide-consuming effects would run here] -> dispatchUpscale -> present.
//
// Ratio 1 + temporal path is FSR "Native AA" — the first real anti-aliasing
// this bench has had (harness renders with antialias: false by design).
//
// NOTE: the harness render-scale slider is ignored by this demo — the
// upscaler's ratio param IS the render-scale control here (display res is
// always the canvas backing size).

const PATHS = ['temporal', 'spatial', 'bilinear'] as const;

const DEBUG_VIEWS = [
  'none',
  'motion',
  'disocclusion',
  'depth',
  'accumAge',
  'locks',
  'exposure',
  'shadingChange',
  'reactivity',
] as const;
type DebugViewName = (typeof DEBUG_VIEWS)[number];

const DEBUG_VIEW_MAP: Record<DebugViewName, DebugView> = {
  none: DebugView.None,
  motion: DebugView.MotionVectors,
  disocclusion: DebugView.Disocclusion,
  depth: DebugView.Depth,
  accumAge: DebugView.AccumulationAge,
  locks: DebugView.Locks,
  exposure: DebugView.Exposure,
  shadingChange: DebugView.ShadingChange,
  reactivity: DebugView.Reactivity,
};

const schema = {
  path: { type: 'enum', value: 'temporal' as (typeof PATHS)[number], options: PATHS, label: 'path' },
  ratio: {
    type: 'number',
    value: 2.0,
    min: 1.0,
    max: 3.0,
    step: 0.25,
    label: 'upscale ratio',
    hint: '1.0 + temporal = Native AA (render at display res, jitter for anti-aliasing only)',
  },
  debugView: {
    type: 'enum',
    value: 'none' as DebugViewName,
    options: DEBUG_VIEWS,
    label: 'debug view',
  },
  sharpness: { type: 'number', value: 0.8, min: 0, max: 1, step: 0.05, label: 'RCAS sharpness', group: 'settings' },
  rcasDenoise: {
    type: 'boolean',
    value: false,
    label: 'RCAS denoise',
    group: 'settings',
    hint: 'attenuate sharpening on lone luma outliers — for noisy sources (GI!)',
  },
  autoExposure: { type: 'boolean', value: true, label: 'auto exposure', group: 'settings' },
  lockThinFeatures: { type: 'boolean', value: true, label: 'thin-feature locks', group: 'settings' },
  detectShadingChanges: { type: 'boolean', value: true, label: 'shading-change detect', group: 'settings' },
  maxAccumulation: { type: 'number', value: 32, min: 4, max: 64, step: 1, label: 'max accumulation', group: 'settings' },
} as const;

class FsrDemo implements Demo {
  private upscaler!: Upscaler;
  private rt: RenderTarget | null = null;
  private displayPipeline!: RenderPipeline;
  private outputNode!: ReturnType<typeof texture>;
  private mrtNode = mrt({ output, velocity });
  private params!: ParamGroup<typeof schema>;
  private readonly info = { res: '', reconstruct: '' };

  init(ctx: HarnessContext): void {
    this.upscaler = new Upscaler({ renderer: ctx.renderer });
    this.upscaler.init();
    // Motion vectors must be jitter-free: the TSL velocity node reprojects with
    // the upscaler's unjittered projection matrix (cleared again in dispose —
    // the node is a module-level singleton shared by other demos' MRTs).
    velocity.setProjectionMatrix(this.upscaler.unjitteredProjectionMatrix);

    this.configure(ctx);

    // Present: sample the display-res output on a full-screen pass. The node is
    // built once; `.value` is re-pointed each frame (ping-pong safety).
    this.outputNode = texture(this.upscaler.outputTexture, screenUV);
    this.displayPipeline = new RenderPipeline(ctx.renderer);
    this.displayPipeline.outputNode = vec4(this.outputNode.rgb, 1);

    const folder = ctx.pane.addFolder({ title: 'Demo 16 — FSR upscaler' });
    this.params = buildParams(folder, schema);
    this.params.onChange((key) => {
      if (key === 'path' || key === 'ratio') this.configure(ctx);
      // Everything else is a live RuntimeSettings write — no reallocation.
    });
    folder.addBinding(this.info, 'res', { readonly: true, label: 'res' });
    folder.addBinding(this.info, 'reconstruct', { readonly: true, label: 'gpu (upscaler)' });
  }

  // (Re)configure the upscaler + reallocate the render-res MRT target. Display
  // res is the canvas backing size; render res falls out of the ratio.
  private configure(ctx: HarnessContext): void {
    const { width, height } = ctx.canvasSize();
    this.upscaler.configure({
      displayWidth: width,
      displayHeight: height,
      customUpscaleRatio: this.params?.values.ratio ?? schema.ratio.value,
      path: (this.params?.values.path ?? schema.path.value) as UpscalePath,
    });

    this.rt?.dispose();
    const depthTexture = new DepthTexture(this.upscaler.renderWidth, this.upscaler.renderHeight);
    depthTexture.type = FloatType;
    this.rt = new RenderTarget(this.upscaler.renderWidth, this.upscaler.renderHeight, {
      count: 2, // must match the MRT output count
      type: HalfFloatType,
      depthTexture,
    });
    // MRT routes node outputs to attachments BY TEXTURE NAME.
    this.rt.textures[0].name = 'output';
    this.rt.textures[1].name = 'velocity';

    this.info.res =
      `${this.upscaler.renderWidth}×${this.upscaler.renderHeight} → ` +
      `${width}×${height} (${this.upscaler.upscaleRatio.toFixed(2)}x)`;
  }

  frame(ctx: HarnessContext, dt: number): void {
    const cam = ctx.scene.camera;
    const rt = this.rt!;
    const p = this.params.values;

    // Live settings (plain field writes; never recompiles).
    const s = this.upscaler.settings;
    s.sharpness = p.sharpness;
    s.rcasDenoise = p.rcasDenoise;
    s.autoExposure = p.autoExposure;
    s.lockThinFeatures = p.lockThinFeatures;
    s.detectShadingChanges = p.detectShadingChanges;
    s.maxAccumulation = p.maxAccumulation;
    s.debugView = DEBUG_VIEW_MAP[p.debugView];

    const t0 = performance.now();

    // 1. Jittered G-buffer: color + velocity MRT, float depth, render res.
    this.upscaler.beginFrame(cam);
    ctx.renderer.setMRT(this.mrtNode);
    ctx.renderer.setRenderTarget(rt);
    ctx.renderer.render(ctx.scene.scene, cam);
    ctx.renderer.setRenderTarget(null);
    ctx.renderer.setMRT(null);
    this.upscaler.endFrame(cam);

    // 2+3. Split dispatch on the temporal path (the demo-10/14 frame shape:
    // guides first so effects could consume them before color exists). The
    // spatial/bilinear paths have no guides — single dispatch.
    if (p.path === 'temporal') {
      this.upscaler.dispatchGuides({ depth: rt.depthTexture!, velocity: rt.textures[1], deltaTime: dt }, cam);
      this.upscaler.dispatchUpscale({ color: rt.textures[0], deltaTime: dt }, cam);
    } else {
      this.upscaler.dispatch({ color: rt.textures[0], deltaTime: dt }, cam);
    }
    ctx.timing.markCPU('upscaler', performance.now() - t0);

    // 4. Present at display res (re-point first: output can be reallocated).
    this.outputNode.value = this.upscaler.outputTexture;
    this.displayPipeline.render();

    const rec = this.upscaler.gpuTimings.get('reconstruct');
    if (rec !== undefined) this.info.reconstruct = `${rec.toFixed(3)} ms`;
    ctx.timing.sampleGPU(ctx.renderer);
  }

  resize(ctx: HarnessContext): void {
    // Guard: resize fires from app before init() finishes constructing us.
    if (!this.upscaler) return;
    this.configure(ctx);
    this.upscaler.resetHistory(); // a resize is a hard history discontinuity
  }

  dispose(): void {
    velocity.setProjectionMatrix(null);
    this.rt?.dispose();
    this.upscaler?.dispose();
  }
}

export const fsrDemo: DemoDef = {
  id: '16-fsr',
  label: '16 — FSR upscaler (upscale + AA)',
  create: () => new FsrDemo(),
};
