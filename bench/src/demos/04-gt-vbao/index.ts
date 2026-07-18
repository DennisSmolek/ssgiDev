import { HalfFloatType, NoColorSpace, RenderTarget } from 'three/webgpu';
import {
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
import { RawRenderPass } from '../../harness/raw-pass';
import { HALTON_JITTER, applyCameraJitter, clearCameraJitter } from '../../harness/temporal';
import { Comparator } from '../../harness/compare';
import type { CompareChannel, CompareMode } from '../../harness/compare';
import { ensureRenderTarget } from '../../harness/three-internals';
import { buildParams } from '../../harness/params';
import type { ParamGroup } from '../../harness/params';
import gtvbaoWgsl from './gt-vbao.wgsl?raw';
import marcherWgsl from '../02-reference/reference-marcher.wgsl?raw';

const VIEW_MODES = ['ao', 'reference', 'combined', 'beauty', 'split'] as const;
type ViewMode = (typeof VIEW_MODES)[number];

const schema = {
  viewMode: { type: 'enum', value: 'combined' as ViewMode, options: VIEW_MODES, label: 'view' },
  slicesPerFrame: { type: 'number', value: 2, min: 1, max: 8, step: 1, label: 'slices/frame' },
  stepsPerSlice: { type: 'number', value: 32, min: 4, max: 64, step: 1, label: 'steps/slice' },
  marchWidthPx: { type: 'number', value: 512, min: 32, max: 1024, step: 16, label: 'march width (px)' },
  thickness: { type: 'number', value: 0.5, min: 0.05, max: 4, step: 0.05, label: 'thickness (world)' },
  bias: { type: 'number', value: 0.03, min: 0, max: 0.3, step: 0.005, label: 'normal bias' },
  falloff: { type: 'number', value: 0, min: 0, max: 4, step: 0.05, label: 'falloff' },
  acosApprox: { type: 'boolean', value: true, label: 'acos approx' },
  importanceSampling: { type: 'boolean', value: true, label: 'slice importance' },
  thicknessNormalize: { type: 'boolean', value: false, label: 'thickness: normalize' },
  accumulate: { type: 'boolean', value: true, label: 'accumulate' },
  jitterAA: { type: 'boolean', value: false, label: 'subpixel AA jitter' },
  maxAccumFrames: { type: 'number', value: 512, min: 1, max: 4096, step: 1, label: 'max frames' },
  // reference marcher (validation oracle) params
  refRays: { type: 'number', value: 4, min: 1, max: 16, step: 1, label: 'ref rays/frame' },
  refSteps: { type: 'number', value: 32, min: 4, max: 64, step: 1, label: 'ref steps' },
  refRadius: { type: 'number', value: 6, min: 0.5, max: 14, step: 0.1, label: 'ref radius' },
  compareMode: { type: 'enum', value: 'split' as CompareMode, options: ['split', 'diff'], label: 'A/B mode' },
  diffAmp: { type: 'number', value: 8, min: 1, max: 50, step: 0.5, label: 'diff amp' },
} as const;

const NON_RESET_KEYS = new Set(['viewMode', 'compareMode', 'diffAmp']);

// GT-VBAO uniform: proj(16)+invProj(16)+[res,near,far](4)+[slices,steps,seed,flags](4)
// +[thickness,marchWidth,bias,falloff](4)+pad(4) = 48 floats (192 B).
const VBAO_FLOATS = 48;
// Reference marcher uniform (demo 02 layout): 48 floats.
const REF_FLOATS = 48;

const ADDITIVE: GPUBlendState = {
  color: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
  alpha: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
};

function floatRT(): RenderTarget {
  const rt = new RenderTarget(1, 1, { type: HalfFloatType, depthBuffer: false });
  rt.texture.colorSpace = NoColorSpace;
  return rt;
}

class GtVbaoDemo implements Demo {
  private beautyTex!: Texture;
  private normalTex!: Texture;
  private depthTex!: DepthTexture;

  private scenePass!: ReturnType<typeof pass>;
  private gbufferPipeline!: RenderPipeline;
  private displayPipeline!: RenderPipeline;

  private vbaoRT = floatRT(); // GT-VBAO accumulation (a = AO)
  private refRT = floatRT(); // reference AO accumulation (a = AO)
  private compareRT = floatRT();

  private vbao!: RawRenderPass;
  private marcher!: RawRenderPass;
  private comparator!: Comparator;
  private vbaoData = new Float32Array(VBAO_FLOATS);
  private vbaoU32 = new Uint32Array(this.vbaoData.buffer);
  private refData = new Float32Array(REF_FLOATS);
  private refU32 = new Uint32Array(this.refData.buffer);

  private uCount = uniform(1);

  private params!: ParamGroup<typeof schema>;
  private countBinding!: { refresh(): void };
  private readout = { samples: 0 };

  private sampleCount = 0;
  private frameCounter = 0;
  private jitterIndex = 0;
  private jitterActive = false;
  private cam!: PerspectiveCamera;
  private resetRequested = true;
  private lastPose = new Float64Array(8);

  private compareState = { splitX: 0.5, mode: 'split' as CompareMode, amp: 8 };
  private dragging = false;
  private pointerHandlers: Array<[keyof HTMLElementEventMap, EventListener]> = [];

  init(ctx: HarnessContext): void {
    const cam = ctx.scene.camera;
    this.cam = cam;

    this.scenePass = pass(ctx.scene.scene, cam);
    this.scenePass.setMRT(mrt({ output: output, normal: normalView }));
    this.beautyTex = this.scenePass.getTexture('output');
    this.normalTex = this.scenePass.getTexture('normal');
    this.depthTex = this.scenePass.renderTarget.depthTexture!;

    this.gbufferPipeline = new RenderPipeline(ctx.renderer, this.scenePass);
    this.displayPipeline = new RenderPipeline(ctx.renderer);

    this.vbao = new RawRenderPass(ctx.renderer, 'gt-vbao', gtvbaoWgsl, {
      bindings: [{ kind: 'depth' }, { kind: 'tex' }, { kind: 'uniform' }],
      blend: ADDITIVE,
    });
    // demo 02's reference marcher, wired as the validation oracle.
    this.marcher = new RawRenderPass(ctx.renderer, 'ref-marcher', marcherWgsl, {
      bindings: [{ kind: 'depth' }, { kind: 'tex' }, { kind: 'tex' }, { kind: 'uniform' }],
      blend: ADDITIVE,
    });
    this.comparator = new Comparator(ctx.renderer, 'vbao-compare');

    this.resize(ctx);
    this.vbao.configure(this.vbaoRT, this.vbaoData.byteLength);
    this.marcher.configure(this.refRT, this.refData.byteLength);
    this.comparator.configure(this.compareRT);

    const folder = ctx.pane.addFolder({ title: 'Demo 04 — GT-VBAO' });
    this.params = buildParams(folder, schema);
    this.countBinding = folder.addBinding(this.readout, 'samples', { readonly: true, label: 'accum samples' });
    this.params.onChange((key) => {
      if (key === 'viewMode') this.updateOutputNode();
      if (!NON_RESET_KEYS.has(key as string)) this.resetRequested = true;
    });

    const search = new URLSearchParams(window.location.search);
    const urlView = search.get('view');
    if (urlView && (VIEW_MODES as readonly string[]).includes(urlView)) {
      this.params.values.viewMode = urlView as ViewMode;
      this.params.refresh();
    }
    const urlCmp = search.get('cmp'); // 'split' | 'diff' for deterministic A/B captures
    if (urlCmp === 'split' || urlCmp === 'diff') {
      this.params.values.compareMode = urlCmp;
      this.compareState.mode = urlCmp;
      this.params.refresh();
    }
    const urlJitter = search.get('jitter'); // ?jitter=0/1 AA override
    if (urlJitter === '0' || urlJitter === '1') {
      this.params.values.jitterAA = urlJitter === '1';
      this.params.refresh();
    }

    this.installDividerDrag(ctx);
    this.updateOutputNode();
  }

  private updateOutputNode(): void {
    this.displayPipeline.outputNode = this.buildViewNode(this.params.values.viewMode);
    this.displayPipeline.needsUpdate = true;
  }

  private buildViewNode(mode: ViewMode) {
    const uv = screenUV;
    const gtAO = texture(this.vbaoRT.texture, uv).a.div(this.uCount);
    const refAO = texture(this.refRT.texture, uv).a.div(this.uCount);
    switch (mode) {
      case 'ao':
        return vec4(vec3(gtAO), float(1));
      case 'reference':
        return vec4(vec3(refAO), float(1));
      case 'combined': {
        const beauty = texture(this.beautyTex, uv).rgb;
        return vec4(beauty.mul(gtAO), float(1));
      }
      case 'beauty':
        return vec4(texture(this.beautyTex, uv).rgb, float(1));
      case 'split':
        return vec4(texture(this.compareRT.texture, uv).rgb, float(1));
    }
  }

  // Advance/apply Halton jitter, or clear it once when disabled. Jitters the
  // projection only; cameraMoved() hashes pose/fov/aspect so it never trips.
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

  frame(ctx: HarnessContext, _dt: number): void {
    const cam = ctx.scene.camera;
    const v = this.params.values;
    this.frameCounter++;
    const { width, height } = ctx.renderSize();

    // Jitter before the G-buffer rasterizes; the GT-VBAO + reference marchers
    // below read cam.projectionMatrix and share the same jittered projection.
    this.applyJitter(cam, width, height, v.jitterAA);

    this.gbufferPipeline.render();

    if (this.cameraMoved(cam) || this.resetRequested || !v.accumulate) {
      this.sampleCount = 0;
      this.resetRequested = false;
    }

    if (this.sampleCount < v.maxAccumFrames) {
      const loadOp: GPULoadOp = this.sampleCount === 0 ? 'clear' : 'load';
      const clearValue = { r: 0, g: 0, b: 0, a: 0 };
      this.fillVbaoUniform(cam, width, height, this.sampleCount, v);
      this.vbao.execute(this.vbaoRT, [this.depthTex, this.normalTex, this.vbaoData], { loadOp, clearValue });
      this.fillRefUniform(cam, width, height, this.sampleCount, v);
      this.marcher.execute(
        this.refRT,
        [this.depthTex, this.normalTex, this.beautyTex, this.refData],
        { loadOp, clearValue },
      );
      this.sampleCount++;
    }
    this.uCount.value = Math.max(1, this.sampleCount);

    if (v.viewMode === 'split') {
      const scale = 1 / Math.max(1, this.sampleCount);
      this.comparator.execute(this.compareRT, this.vbaoRT.texture, this.refRT.texture, width, height, {
        mode: v.compareMode,
        splitX: this.compareState.splitX,
        amp: v.diffAmp,
        scaleA: scale,
        scaleB: scale,
        channel: 'alpha' as CompareChannel,
      });
    }

    this.displayPipeline.render();

    this.readout.samples = this.sampleCount;
    this.countBinding.refresh();
    ctx.timing.sampleGPU(ctx.renderer);
  }

  private fillVbaoUniform(
    cam: PerspectiveCamera,
    width: number,
    height: number,
    seed: number,
    v: ParamGroup<typeof schema>['values'],
  ): void {
    const d = this.vbaoData;
    const u = this.vbaoU32;
    d.set(cam.projectionMatrix.elements, 0);
    d.set(cam.projectionMatrixInverse.elements, 16);
    d[32] = width;
    d[33] = height;
    d[34] = cam.near;
    d[35] = cam.far;
    u[36] = v.slicesPerFrame;
    u[37] = v.stepsPerSlice;
    u[38] = seed >>> 0;
    let flags = 0;
    if (v.acosApprox) flags |= 1;
    if (v.importanceSampling) flags |= 2;
    if (v.thicknessNormalize) flags |= 4;
    u[39] = flags >>> 0;
    d[40] = v.thickness;
    d[41] = v.marchWidthPx;
    d[42] = v.bias;
    d[43] = v.falloff;
    d[44] = 0;
    d[45] = 0;
    d[46] = 0;
    d[47] = 0;
  }

  // demo 02 reference-marcher.wgsl layout (see its Params struct).
  private fillRefUniform(
    cam: PerspectiveCamera,
    width: number,
    height: number,
    seed: number,
    v: ParamGroup<typeof schema>['values'],
  ): void {
    const d = this.refData;
    const u = this.refU32;
    d.set(cam.projectionMatrix.elements, 0);
    d.set(cam.projectionMatrixInverse.elements, 16);
    d[32] = width;
    d[33] = height;
    d[34] = cam.near;
    d[35] = cam.far;
    u[36] = v.refRays;
    u[37] = v.refSteps;
    u[38] = this.sampleCount;
    u[39] = seed >>> 0;
    d[40] = v.refRadius;
    d[41] = v.thickness; // same slab as GT-VBAO for a fair AO comparison
    d[42] = v.bias;
    d[43] = 10; // firefly clamp (GI unused for AO compare)
    d[44] = 1; // giStrength
    d[45] = 0; // skyIntensity (closed Cornell)
    d[46] = 0;
    d[47] = 0;
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
        ctx.controls.enabled = false;
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
    this.vbaoRT.setSize(width, height);
    this.refRT.setSize(width, height);
    this.compareRT.setSize(width, height);
    ensureRenderTarget(ctx.renderer, this.vbaoRT);
    ensureRenderTarget(ctx.renderer, this.refRT);
    ensureRenderTarget(ctx.renderer, this.compareRT);
    this.resetRequested = true;
  }

  dispose(): void {
    const el = document.querySelector('canvas');
    for (const [type, fn] of this.pointerHandlers) {
      if (type === 'pointerdown') el?.removeEventListener(type, fn);
      else window.removeEventListener(type, fn);
    }
    if (this.jitterActive && this.cam) clearCameraJitter(this.cam);
    this.vbaoRT.dispose();
    this.refRT.dispose();
    this.compareRT.dispose();
  }
}

export const gtVbaoDemo: DemoDef = {
  id: '04-gt-vbao',
  label: '04 — GT-VBAO',
  create: () => new GtVbaoDemo(),
};
