import { HalfFloatType, NoColorSpace, RenderTarget } from 'three/webgpu';
import {
  diffuseColor,
  float,
  mrt,
  normalView,
  output,
  pass,
  screenUV,
  texture,
  uniform,
  vec3,
  vec4,
} from 'three/tsl';
import { RenderPipeline } from 'three/webgpu';
import type { DepthTexture, PerspectiveCamera, Texture } from 'three/webgpu';
import type { Demo, DemoDef, HarnessContext } from '../../harness/types';
import { HALTON_JITTER, applyCameraJitter, clearCameraJitter } from '../../harness/temporal';
import { Comparator } from '../../harness/compare';
import type { CompareChannel, CompareMode } from '../../harness/compare';
import { ReferencePass } from '../../harness/reference-pass';
import type { ReferenceInputs, ReferenceParams } from '../../harness/reference-pass';
import { ensureRenderTarget } from '../../harness/three-internals';
import { buildParams } from '../../harness/params';
import type { ParamGroup } from '../../harness/params';

const VIEW_MODES = ['combined', 'ao', 'gi', 'beauty', 'split'] as const;
type ViewMode = (typeof VIEW_MODES)[number];

const schema = {
  viewMode: { type: 'enum', value: 'combined' as ViewMode, options: VIEW_MODES, label: 'view' },
  raysPerPixel: { type: 'number', value: 4, min: 1, max: 64, step: 1, label: 'rays/pixel' },
  stepsPerRay: { type: 'number', value: 32, min: 4, max: 96, step: 1, label: 'steps/ray' },
  radius: { type: 'number', value: 6, min: 0.5, max: 14, step: 0.1, label: 'radius (world)' },
  thickness: { type: 'number', value: 0.5, min: 0.05, max: 4, step: 0.05, label: 'thickness (world)' },
  bias: { type: 'number', value: 0.03, min: 0.005, max: 0.3, step: 0.005, label: 'normal bias' },
  accumulate: { type: 'boolean', value: true, label: 'accumulate' },
  jitterAA: { type: 'boolean', value: false, label: 'subpixel AA jitter' },
  maxAccumFrames: { type: 'number', value: 512, min: 1, max: 4096, step: 1, label: 'max frames' },
  maxLuminance: { type: 'number', value: 10, min: 1, max: 30, step: 0.5, label: 'firefly clamp' },
  giStrength: { type: 'number', value: 1, min: 0, max: 5, step: 0.05, label: 'GI strength' },
  giExposure: { type: 'number', value: 2, min: 0.25, max: 8, step: 0.05, label: 'GI display gain' },
  skyIntensity: { type: 'number', value: 0, min: 0, max: 2, step: 0.02, label: 'sky (miss)' },
  compareMode: { type: 'enum', value: 'split' as CompareMode, options: ['split', 'diff'], label: 'A/B mode' },
  compareChannel: { type: 'enum', value: 'alpha' as CompareChannel, options: ['alpha', 'rgb'], label: 'A/B channel' },
  diffAmp: { type: 'number', value: 8, min: 1, max: 50, step: 0.5, label: 'diff amp' },
} as const;

// Params whose change does NOT invalidate the accumulation (display / comparator
// only). Everything else resets the accumulator.
const NON_RESET_KEYS = new Set([
  'viewMode',
  'giExposure',
  'compareMode',
  'compareChannel',
  'diffAmp',
]);

function floatRT(): RenderTarget {
  const rt = new RenderTarget(1, 1, { type: HalfFloatType, depthBuffer: false });
  rt.texture.colorSpace = NoColorSpace;
  return rt;
}

class ReferenceDemo implements Demo {
  private beautyTex!: Texture;
  private albedoTex!: Texture;
  private normalTex!: Texture;
  private depthTex!: DepthTexture;

  private scenePass!: ReturnType<typeof pass>;
  private gbufferPipeline!: RenderPipeline;
  private displayPipeline!: RenderPipeline;

  // The converged reference accumulation lives in the shared ReferencePass.
  // Demo 02 keeps its own 1-sample live buffer + comparator output (its split
  // view is live-vs-converged, unique to this demo).
  private refPass!: ReferencePass;
  private liveRT = floatRT();
  private compareRT = floatRT();
  private comparator!: Comparator;

  // Display uniforms.
  private uCount = uniform(1);
  private uGiExposure = uniform(2);

  private params!: ParamGroup<typeof schema>;
  private countBinding!: { refresh(): void };
  private readout = { samples: 0 };

  private frameCounter = 0;
  private device!: GPUDevice;
  private lastW = 1;
  private lastH = 1;
  // Sub-pixel projection jitter (TAA-style). index cycles the Halton sequence;
  // active tracks whether a view offset is currently set so we clear it exactly
  // once when jitter is turned off (not every frame).
  private jitterIndex = 0;
  private jitterActive = false;
  private cam!: PerspectiveCamera;

  // Split-view divider drag.
  private compareState = { splitX: 0.5 };
  private dragging = false;
  private pointerHandlers: Array<[keyof HTMLElementEventMap, EventListener]> = [];

  init(ctx: HarnessContext): void {
    const cam = ctx.scene.camera;
    this.cam = cam;
    this.device = ctx.device;

    this.scenePass = pass(ctx.scene.scene, cam);
    this.scenePass.setMRT(
      mrt({ output: output, albedo: diffuseColor, normal: normalView }),
    );
    this.beautyTex = this.scenePass.getTexture('output');
    this.albedoTex = this.scenePass.getTexture('albedo');
    this.normalTex = this.scenePass.getTexture('normal');
    this.depthTex = this.scenePass.renderTarget.depthTexture!;

    this.gbufferPipeline = new RenderPipeline(ctx.renderer, this.scenePass);
    this.displayPipeline = new RenderPipeline(ctx.renderer);

    // Shared reference marcher (accumulation) + A/B comparator (live vs accum).
    this.refPass = new ReferencePass(ctx.renderer, 'ref-marcher');
    this.comparator = new Comparator(ctx.renderer, 'ref-compare');

    this.resize(ctx);
    this.refPass.configure();
    this.comparator.configure(this.compareRT);

    const folder = ctx.pane.addFolder({ title: 'Demo 02 — Reference marcher' });
    this.params = buildParams(folder, schema);
    this.countBinding = folder.addBinding(this.readout, 'samples', { readonly: true, label: 'accum samples' });
    this.params.onChange((key) => {
      if (key === 'viewMode') this.updateOutputNode();
      if (!NON_RESET_KEYS.has(key as string)) this.refPass.reset();
    });

    const search = new URLSearchParams(window.location.search);
    const urlView = search.get('view');
    if (urlView && (VIEW_MODES as readonly string[]).includes(urlView)) {
      this.params.values.viewMode = urlView as ViewMode;
      this.params.refresh();
    }
    // ?jitter=0 / ?jitter=1 override for deterministic AA A/B captures.
    const urlJitter = search.get('jitter');
    if (urlJitter === '0' || urlJitter === '1') {
      this.params.values.jitterAA = urlJitter === '1';
      this.params.refresh();
    }

    this.installDividerDrag(ctx);
    this.updateOutputNode();

    // Fenced GPU bench hook (TESTING.md Track B). Shape: window.__bench02 =
    // { accumFrame, total }. This demo's entire per-frame SSGI GPU work is ONE
    // raw pass: the brute-force reference marcher (the composite is a TSL display
    // node; the G-buffer is shared harness cost measured by demo 00, not
    // re-counted here). So accumFrame and total both run that single march and
    // are intentionally equal —
    //   accumFrame = one progressive accumulation sample-frame of the marcher
    //     (the ms-per-reference-sample number).
    //   total = the demo's full per-frame SSGI work (== accumFrame here).
    // Implemented via renderSingle into liveRT (loadOp 'clear'), which writes
    // only liveRT and never the shared accumRT, so the interactive accumulation
    // is undisturbed. (A loop that also re-rendered the TSL G-buffer/display
    // would only add noise: those renders skip under three's per-frame
    // render-list caching — see the __bench01 comment.) Fences on
    // queue.onSubmittedWorkDone (matching demo 03's __ssrt3bench).
    (window as unknown as { __bench02?: Record<string, (n: number) => Promise<number>> }).__bench02 = {
      accumFrame: (n: number) => this.benchAccumFrame(n),
      total: (n: number) => this.benchAccumFrame(n),
    };
  }

  // One reference sample-frame, fenced. Primes the G-buffer once (the marcher
  // reads it), then re-runs the single-sample march n times into liveRT.
  private async benchAccumFrame(n: number): Promise<number> {
    const params = this.refParams(this.params.values);
    const w = this.lastW;
    const h = this.lastH;
    this.gbufferPipeline.render();
    await this.device.queue.onSubmittedWorkDone();
    const t0 = performance.now();
    for (let i = 0; i < n; i++) {
      this.refPass.renderSingle(this.liveRT, this.cam, this.inputs(), params, w, h, this.frameCounter);
    }
    await this.device.queue.onSubmittedWorkDone();
    return (performance.now() - t0) / n;
  }

  private updateOutputNode(): void {
    this.displayPipeline.outputNode = this.buildViewNode(this.params.values.viewMode);
    this.displayPipeline.needsUpdate = true;
  }

  private buildViewNode(mode: ViewMode) {
    const uv = screenUV;
    const accum = texture(this.refPass.outputTexture, uv);
    const ao = accum.a.div(this.uCount);
    const gi = accum.rgb.div(this.uCount).mul(this.uGiExposure);
    switch (mode) {
      case 'ao':
        return vec4(vec3(ao), float(1));
      case 'gi':
        return vec4(gi, float(1));
      case 'combined': {
        // AO applied to lit beauty (ambient darkening) + albedo-modulated GI
        // bounce (PLAN trap: GI modulated by albedo at composite, PR #31839).
        const beauty = texture(this.beautyTex, uv).rgb;
        const albedo = texture(this.albedoTex, uv).rgb;
        return vec4(beauty.mul(ao).add(albedo.mul(gi)), float(1));
      }
      case 'beauty':
        return vec4(texture(this.beautyTex, uv).rgb, float(1));
      case 'split':
        return vec4(texture(this.compareRT.texture, uv).rgb, float(1));
    }
  }

  // Advance/apply the Halton jitter, or clear it once when disabled.
  private applyJitter(cam: PerspectiveCamera, w: number, h: number, enabled: boolean): void {
    if (enabled) {
      const [jx, jy] = HALTON_JITTER[this.jitterIndex];
      this.jitterIndex = (this.jitterIndex + 1) % HALTON_JITTER.length;
      applyCameraJitter(cam, w, h, jx, jy);
      this.jitterActive = true;
    } else if (this.jitterActive) {
      clearCameraJitter(cam);
      this.jitterActive = false;
    }
  }

  private inputs(): ReferenceInputs {
    return { depth: this.depthTex, normal: this.normalTex, beauty: this.beautyTex };
  }

  private refParams(v: ParamGroup<typeof schema>['values']): ReferenceParams {
    return {
      raysPerPixel: v.raysPerPixel,
      stepsPerRay: v.stepsPerRay,
      radius: v.radius,
      thickness: v.thickness,
      bias: v.bias,
      maxLuminance: v.maxLuminance,
      giStrength: v.giStrength,
      skyIntensity: v.skyIntensity,
      accumulate: v.accumulate,
      maxAccumFrames: v.maxAccumFrames,
    };
  }

  frame(ctx: HarnessContext, _dt: number): void {
    const cam = ctx.scene.camera;
    const v = this.params.values;
    this.frameCounter++;
    const { width, height } = ctx.renderSize();

    // 0. Sub-pixel jitter BEFORE the G-buffer rasterizes, so the scene and the
    // marcher (which reads cam.projectionMatrix) share the jittered projection.
    // The pass's cameraMoved() hashes only pose/fov/aspect, so this never resets
    // accumulation.
    this.applyJitter(cam, width, height, v.jitterAA);

    // 1. G-buffer.
    this.gbufferPipeline.render();

    // 2. Reference accumulation (owns its own pose-reset + sample count).
    const params = this.refParams(v);
    this.refPass.update(cam, this.inputs(), params, width, height);
    this.uCount.value = Math.max(1, this.refPass.sampleCount);
    this.uGiExposure.value = v.giExposure;

    // 3. Split view: 1-sample live pass + comparator (live vs converged accum).
    if (v.viewMode === 'split') {
      this.refPass.renderSingle(this.liveRT, cam, this.inputs(), params, width, height, this.frameCounter);
      this.comparator.execute(this.compareRT, this.liveRT.texture, this.refPass.outputTexture, width, height, {
        mode: v.compareMode,
        splitX: this.compareState.splitX,
        amp: v.diffAmp,
        scaleA: 1, // live is a single sample
        scaleB: 1 / Math.max(1, this.refPass.sampleCount), // accumulated sums -> mean
        channel: v.compareChannel,
      });
    }

    // 4. Display.
    this.displayPipeline.render();

    this.readout.samples = this.refPass.sampleCount;
    this.countBinding.refresh();
    ctx.timing.sampleGPU(ctx.renderer);
    this.lastW = width;
    this.lastH = height;
  }

  private installDividerDrag(ctx: HarnessContext): void {
    const el = ctx.renderer.domElement;
    const near = (clientX: number): boolean => {
      const frac = clientX / el.clientWidth;
      return Math.abs(frac - this.compareState.splitX) < 0.04;
    };
    const down = (e: PointerEvent): void => {
      if (this.params.values.viewMode !== 'split' || this.params.values.compareMode !== 'split') return;
      if (near(e.clientX)) {
        this.dragging = true;
        ctx.controls.enabled = false; // don't orbit (which would reset accumulation)
        this.compareState.splitX = e.clientX / el.clientWidth;
      }
    };
    const move = (e: PointerEvent): void => {
      if (!this.dragging) return;
      this.compareState.splitX = Math.min(1, Math.max(0, e.clientX / el.clientWidth));
    };
    const up = (): void => {
      if (this.dragging) {
        this.dragging = false;
        ctx.controls.enabled = true;
      }
    };
    el.addEventListener('pointerdown', down as EventListener);
    window.addEventListener('pointermove', move as EventListener);
    window.addEventListener('pointerup', up as EventListener);
    this.pointerHandlers = [
      ['pointerdown', down as EventListener],
      ['pointermove', move as EventListener],
      ['pointerup', up as EventListener],
    ];
  }

  resize(ctx: HarnessContext): void {
    const { width, height } = ctx.renderSize();
    this.scenePass.setSize(width, height);
    this.refPass.setSize(width, height);
    this.liveRT.setSize(width, height);
    this.compareRT.setSize(width, height);
    ensureRenderTarget(ctx.renderer, this.liveRT);
    ensureRenderTarget(ctx.renderer, this.compareRT);
  }

  dispose(): void {
    const el = document.querySelector('canvas');
    for (const [type, fn] of this.pointerHandlers) {
      if (type === 'pointerdown') el?.removeEventListener(type, fn);
      else window.removeEventListener(type, fn);
    }
    // Camera is shared across demos — never leave a jittered projection behind.
    if (this.jitterActive && this.cam) clearCameraJitter(this.cam);
    this.refPass.dispose();
    this.liveRT.dispose();
    this.compareRT.dispose();
  }
}

export const referenceDemo: DemoDef = {
  id: '02-reference',
  label: '02 — Reference marcher',
  create: () => new ReferenceDemo(),
};
