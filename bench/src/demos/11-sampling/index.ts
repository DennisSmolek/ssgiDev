import {
  HalfFloatType,
  NearestFilter,
  NoColorSpace,
  RenderTarget,
  RGBAFormat,
  TextureLoader,
  UnsignedByteType,
} from 'three/webgpu';
import { mrt, normalView, output, pass, screenUV, texture, uniform, vec3, vec4, float } from 'three/tsl';
import { RenderPipeline } from 'three/webgpu';
import type { DepthTexture, PerspectiveCamera, Texture } from 'three/webgpu';
import type { Demo, DemoDef, HarnessContext } from '../../harness/types';
import { RawRenderPass } from '../../harness/raw-pass';
import { HALTON_JITTER, applyCameraJitter, clearCameraJitter } from '../../harness/temporal';
import { Comparator } from '../../harness/compare';
import type { CompareChannel, CompareMode } from '../../harness/compare';
import { ensureRenderTarget, ensureTexture, getDevice, getGPUTexture } from '../../harness/three-internals';
import { buildParams } from '../../harness/params';
import type { ParamGroup } from '../../harness/params';
import samplingWgsl from './sampling.wgsl?raw';
import bilateralWgsl from './bilateral.wgsl?raw';
import marcherWgsl from '../02-reference/reference-marcher.wgsl?raw';
import atlasUrl from './stbn-atlas.png?url';

const VIEW_MODES = ['ao', 'reference', 'combined', 'denoised', 'split'] as const;
type ViewMode = (typeof VIEW_MODES)[number];

const NOISE_MODES = ['white', 'ign', 'hilbert', 'blue', 'stbn'] as const;
type NoiseMode = (typeof NOISE_MODES)[number];
const NOISE_ID: Record<NoiseMode, number> = { white: 0, ign: 1, hilbert: 2, blue: 3, stbn: 4 };

const schema = {
  viewMode: { type: 'enum', value: 'ao' as ViewMode, options: VIEW_MODES, label: 'view' },
  noise: { type: 'enum', value: 'white' as NoiseMode, options: NOISE_MODES, label: 'noise' },
  temporalAdvance: { type: 'boolean', value: true, label: 'temporal advance' },
  slicesPerFrame: { type: 'number', value: 1, min: 1, max: 8, step: 1, label: 'slices/frame' },
  stepsPerSlice: { type: 'number', value: 32, min: 4, max: 64, step: 1, label: 'steps/slice' },
  marchWidthPx: { type: 'number', value: 512, min: 32, max: 1024, step: 16, label: 'march width (px)' },
  thickness: { type: 'number', value: 0.5, min: 0.05, max: 4, step: 0.05, label: 'thickness (world)' },
  bias: { type: 'number', value: 0.03, min: 0, max: 0.3, step: 0.005, label: 'normal bias' },
  falloff: { type: 'number', value: 0, min: 0, max: 4, step: 0.05, label: 'falloff' },
  acosApprox: { type: 'boolean', value: true, label: 'acos approx' },
  importanceSampling: { type: 'boolean', value: true, label: 'slice importance' },
  thicknessNormalize: { type: 'boolean', value: false, label: 'thickness: normalize' },
  accumulate: { type: 'boolean', value: true, label: 'accumulate' },
  jitterAA: { type: 'boolean', value: true, label: 'subpixel AA jitter' },
  maxAccumFrames: { type: 'number', value: 128, min: 1, max: 4096, step: 1, label: 'max frames' },
  // bilateral denoiser (fixed config applied to raw single-frame AO)
  denoiseRadius: { type: 'number', value: 3, min: 1, max: 8, step: 1, label: 'dn radius' },
  denoiseSpatial: { type: 'number', value: 2.5, min: 0.5, max: 6, step: 0.1, label: 'dn spatial' },
  denoiseDepth: { type: 'number', value: 0.2, min: 0.01, max: 2, step: 0.01, label: 'dn depth' },
  denoiseNormalPow: { type: 'number', value: 16, min: 1, max: 64, step: 1, label: 'dn normal pow' },
  // reference marcher (validation oracle)
  refRays: { type: 'number', value: 8, min: 1, max: 16, step: 1, label: 'ref rays/frame' },
  refSteps: { type: 'number', value: 32, min: 4, max: 64, step: 1, label: 'ref steps' },
  refRadius: { type: 'number', value: 6, min: 0.5, max: 14, step: 0.1, label: 'ref radius' },
  compareMode: { type: 'enum', value: 'diff' as CompareMode, options: ['split', 'diff'], label: 'A/B mode' },
  diffAmp: { type: 'number', value: 8, min: 1, max: 50, step: 0.5, label: 'diff amp' },
} as const;

// Params that never invalidate accumulation.
const NON_RESET_KEYS = new Set([
  'compareMode',
  'diffAmp',
  'denoiseRadius',
  'denoiseSpatial',
  'denoiseDepth',
  'denoiseNormalPow',
]);

const VBAO_FLOATS = 48;
const REF_FLOATS = 48;
const BILATERAL_FLOATS = 8;

const ATLAS_SIZE = 512;
const TILE_SIZE = 128;
const NUM_TILES = 16;

const ADDITIVE: GPUBlendState = {
  color: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
  alpha: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
};

function floatRT(): RenderTarget {
  const rt = new RenderTarget(1, 1, { type: HalfFloatType, depthBuffer: false });
  rt.texture.colorSpace = NoColorSpace;
  return rt;
}

function halfToFloat(h: number): number {
  const s = (h & 0x8000) >> 15;
  const e = (h & 0x7c00) >> 10;
  const f = h & 0x03ff;
  if (e === 0) return (s ? -1 : 1) * Math.pow(2, -14) * (f / 1024);
  if (e === 0x1f) return f ? NaN : (s ? -1 : 1) * Infinity;
  return (s ? -1 : 1) * Math.pow(2, e - 15) * (1 + f / 1024);
}

class SamplingLabDemo implements Demo {
  private beautyTex!: Texture;
  private normalTex!: Texture;
  private depthTex!: DepthTexture;
  private atlasTex!: Texture;

  private scenePass!: ReturnType<typeof pass>;
  private gbufferPipeline!: RenderPipeline;
  private displayPipeline!: RenderPipeline;

  private vbaoRT = floatRT();
  private refRT = floatRT();
  private denoiseRT = floatRT();
  private compareRT = floatRT();

  private vbao!: RawRenderPass;
  private marcher!: RawRenderPass;
  private bilateral!: RawRenderPass;
  private comparator!: Comparator;

  private vbaoData = new Float32Array(VBAO_FLOATS);
  private vbaoU32 = new Uint32Array(this.vbaoData.buffer);
  private refData = new Float32Array(REF_FLOATS);
  private refU32 = new Uint32Array(this.refData.buffer);
  private bilData = new Float32Array(BILATERAL_FLOATS);
  private bilI32 = new Int32Array(this.bilData.buffer);

  private uCount = uniform(1);
  private uRefCount = uniform(1);

  private params!: ParamGroup<typeof schema>;
  private countBinding!: { refresh(): void };
  private readout = { samples: 0 };

  private sampleCount = 0;
  private refCount = 0;
  private jitterIndex = 0;
  private jitterActive = false;
  private cam!: PerspectiveCamera;
  private resetRequested = true;
  private lastPose = new Float64Array(8);
  private device!: GPUDevice;

  private compareState = { splitX: 0.5 };

  init(ctx: HarnessContext): void | Promise<void> {
    const cam = ctx.scene.camera;
    this.cam = cam;
    this.device = getDevice(ctx.renderer);

    this.scenePass = pass(ctx.scene.scene, cam);
    this.scenePass.setMRT(mrt({ output: output, normal: normalView }));
    this.beautyTex = this.scenePass.getTexture('output');
    this.normalTex = this.scenePass.getTexture('normal');
    this.depthTex = this.scenePass.renderTarget.depthTexture!;

    this.gbufferPipeline = new RenderPipeline(ctx.renderer, this.scenePass);
    this.displayPipeline = new RenderPipeline(ctx.renderer);

    this.vbao = new RawRenderPass(ctx.renderer, 'lab-vbao', samplingWgsl, {
      bindings: [{ kind: 'depth' }, { kind: 'tex' }, { kind: 'tex' }, { kind: 'uniform' }],
      blend: ADDITIVE,
    });
    this.marcher = new RawRenderPass(ctx.renderer, 'lab-ref', marcherWgsl, {
      bindings: [{ kind: 'depth' }, { kind: 'tex' }, { kind: 'tex' }, { kind: 'uniform' }],
      blend: ADDITIVE,
    });
    this.bilateral = new RawRenderPass(ctx.renderer, 'lab-bilateral', bilateralWgsl, {
      bindings: [{ kind: 'tex' }, { kind: 'depth' }, { kind: 'tex' }, { kind: 'uniform' }],
    });
    this.comparator = new Comparator(ctx.renderer, 'lab-compare');

    this.resize(ctx);
    this.vbao.configure(this.vbaoRT, this.vbaoData.byteLength);
    this.marcher.configure(this.refRT, this.refData.byteLength);
    this.bilateral.configure(this.denoiseRT, this.bilData.byteLength);
    this.comparator.configure(this.compareRT);

    const folder = ctx.pane.addFolder({ title: 'Demo 11 — sampling lab' });
    this.params = buildParams(folder, schema);
    this.countBinding = folder.addBinding(this.readout, 'samples', { readonly: true, label: 'accum samples' });
    this.params.onChange((key) => {
      if (key === 'viewMode') this.updateOutputNode();
      if (!NON_RESET_KEYS.has(key as string)) this.resetRequested = true;
    });

    const search = new URLSearchParams(window.location.search);
    const setEnum = <T extends string>(k: keyof typeof schema, v: string | null, opts: readonly T[]) => {
      if (v && (opts as readonly string[]).includes(v)) {
        (this.params.values as Record<string, unknown>)[k as string] = v;
        this.params.refresh();
      }
    };
    setEnum('viewMode', search.get('view'), VIEW_MODES);
    setEnum('noise', search.get('noise'), NOISE_MODES);
    setEnum('compareMode', search.get('cmp'), ['split', 'diff'] as const);
    const accum = search.get('accum');
    if (accum) {
      const n = Number(accum);
      if (n >= 1 && n <= 4096) {
        this.params.values.maxAccumFrames = n;
        this.params.refresh();
      }
    }
    const temporal = search.get('temporal');
    if (temporal === '0' || temporal === '1') {
      this.params.values.temporalAdvance = temporal === '1';
      this.params.refresh();
    }
    const urlJitter = search.get('jitter'); // ?jitter=0/1 AA override
    if (urlJitter === '0' || urlJitter === '1') {
      this.params.values.jitterAA = urlJitter === '1';
      this.params.refresh();
    }

    this.updateOutputNode();

    // Async: load the committed blue-noise atlas and force-upload it so the raw
    // pass can bind it. Returned promise is awaited by the harness (app.init).
    return this.loadAtlas(ctx);
  }

  private loadAtlas(ctx: HarnessContext): Promise<void> {
    return new Promise((resolve, reject) => {
      new TextureLoader().load(
        atlasUrl,
        (tex) => {
          tex.colorSpace = NoColorSpace;
          tex.format = RGBAFormat;
          tex.type = UnsignedByteType;
          tex.magFilter = NearestFilter;
          tex.minFilter = NearestFilter;
          tex.generateMipmaps = false;
          tex.flipY = false;
          tex.needsUpdate = true;
          this.atlasTex = tex;
          ensureTexture(ctx.renderer, tex);
          // expose the measurement hook once the atlas exists.
          (window as unknown as Record<string, unknown>).__lab11 = {
            measure: (opts?: { frames?: number[]; refFrames?: number }) => this.measure(ctx, opts),
          };
          resolve();
        },
        undefined,
        reject,
      );
    });
  }

  private updateOutputNode(): void {
    this.displayPipeline.outputNode = this.buildViewNode(this.params.values.viewMode);
    this.displayPipeline.needsUpdate = true;
  }

  private buildViewNode(mode: ViewMode) {
    const uv = screenUV;
    const gtAO = texture(this.vbaoRT.texture, uv).a.div(this.uCount);
    switch (mode) {
      case 'ao':
        return vec4(vec3(gtAO), float(1));
      case 'reference':
        return vec4(vec3(texture(this.refRT.texture, uv).a.div(this.uRefCount)), float(1));
      case 'combined':
        return vec4(texture(this.beautyTex, uv).rgb.mul(gtAO), float(1));
      case 'denoised':
        return vec4(vec3(texture(this.denoiseRT.texture, uv).a), float(1));
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
    if (!this.atlasTex) return; // still loading
    const cam = ctx.scene.camera;
    const v = this.params.values;
    const denoiseView = v.viewMode === 'denoised';
    // In denoised view we want a single fresh raw frame each frame (no accum),
    // so the bilateral input is a genuine 1-sample noisy AO.
    const accumulate = v.accumulate && !denoiseView;
    const maxFrames = denoiseView ? 1 : v.maxAccumFrames;

    const { width, height } = ctx.renderSize();

    // Jitter before the G-buffer; the VBAO + reference marchers read
    // cam.projectionMatrix and share the same jittered projection.
    this.applyJitter(cam, width, height, v.jitterAA);

    this.gbufferPipeline.render();

    if (this.cameraMoved(cam) || this.resetRequested || !accumulate) {
      this.sampleCount = 0;
      this.refCount = 0;
      this.resetRequested = false;
    }

    if (this.sampleCount < maxFrames) {
      const first = this.sampleCount === 0;
      const loadOp: GPULoadOp = first ? 'clear' : 'load';
      const clearValue = { r: 0, g: 0, b: 0, a: 0 };
      this.fillVbaoUniform(cam, width, height, this.sampleCount, v);
      this.vbao.execute(this.vbaoRT, [this.depthTex, this.normalTex, this.atlasTex, this.vbaoData], {
        loadOp,
        clearValue,
      });
      this.sampleCount++;

      // Reference oracle only needed for reference/split views; keep it cheap.
      if (v.viewMode === 'reference' || v.viewMode === 'split') {
        this.fillRefUniform(cam, width, height, this.refCount, v);
        this.marcher.execute(
          this.refRT,
          [this.depthTex, this.normalTex, this.beautyTex, this.refData],
          { loadOp: this.refCount === 0 ? 'clear' : 'load', clearValue },
        );
        this.refCount++;
      }
    }
    this.uCount.value = Math.max(1, this.sampleCount);
    this.uRefCount.value = Math.max(1, this.refCount);

    if (denoiseView) {
      this.fillBilateralUniform(cam, width, height, v);
      this.bilateral.execute(this.denoiseRT, [this.vbaoRT.texture, this.depthTex, this.normalTex, this.bilData], {
        loadOp: 'clear',
      });
    }

    if (v.viewMode === 'split') {
      const sa = 1 / Math.max(1, this.sampleCount);
      const sb = 1 / Math.max(1, this.refCount);
      this.comparator.execute(this.compareRT, this.vbaoRT.texture, this.refRT.texture, width, height, {
        mode: v.compareMode,
        splitX: this.compareState.splitX,
        amp: v.diffAmp,
        scaleA: sa,
        scaleB: sb,
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
    sampleIndex: number,
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
    u[38] = (v.temporalAdvance ? sampleIndex : 0) >>> 0;
    let flags = 0;
    if (v.acosApprox) flags |= 1;
    if (v.importanceSampling) flags |= 2;
    if (v.thicknessNormalize) flags |= 4;
    u[39] = flags >>> 0;
    d[40] = v.thickness;
    d[41] = v.marchWidthPx;
    d[42] = v.bias;
    d[43] = v.falloff;
    u[44] = NOISE_ID[v.noise] >>> 0;
    d[45] = ATLAS_SIZE;
    d[46] = TILE_SIZE;
    u[47] = NUM_TILES >>> 0;
  }

  private fillRefUniform(
    cam: PerspectiveCamera,
    width: number,
    height: number,
    sampleIndex: number,
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
    u[38] = sampleIndex;
    u[39] = sampleIndex >>> 0;
    d[40] = v.refRadius;
    d[41] = v.thickness;
    d[42] = v.bias;
    d[43] = 10;
    d[44] = 1;
    d[45] = 0;
    d[46] = 0;
    d[47] = 0;
  }

  private fillBilateralUniform(
    _cam: PerspectiveCamera,
    width: number,
    height: number,
    v: ParamGroup<typeof schema>['values'],
  ): void {
    const d = this.bilData;
    const i = this.bilI32;
    d[0] = width;
    d[1] = height;
    d[2] = _cam.near;
    d[3] = _cam.far;
    i[4] = Math.round(v.denoiseRadius);
    d[5] = v.denoiseSpatial;
    d[6] = v.denoiseDepth;
    d[7] = v.denoiseNormalPow;
  }

  // --- quantitative convergence measurement (readback MSE) --------------------
  // Runs offline (called from window.__lab11.measure). Converges the reference
  // marcher, then for each noise accumulates to each frame count and reports MSE
  // of AO vs the converged reference. Deterministic; camera must be still.
  private async measure(
    ctx: HarnessContext,
    opts?: { frames?: number[]; truthFrames?: number },
  ): Promise<string> {
    const frames = opts?.frames ?? [8, 32, 128];
    const truthFrames = opts?.truthFrames ?? 512;
    const v = this.params.values;
    const { width, height } = ctx.renderSize();

    this.gbufferPipeline.render();
    await this.device.queue.onSubmittedWorkDone();

    // Converge a GT-VBAO SELF-reference (white noise, many frames) into refRT.
    // All noises converge to this same GT-VBAO limit; measuring each noise's
    // approach to it isolates noise-driven variance (sampling efficiency) from
    // the estimator's own screen-space bias — the correct comparison for a noise
    // study. (The brute-force ray-march marcher is a different estimator with a
    // different bias; it is kept for the visual A/B split view only.)
    for (let f = 0; f < truthFrames; f++) {
      this.fillVbaoUniformNoise(ctx.scene.camera, width, height, f, v, 'white');
      this.vbao.execute(this.refRT, [this.depthTex, this.normalTex, this.atlasTex, this.vbaoData], {
        loadOp: f === 0 ? 'clear' : 'load',
        clearValue: { r: 0, g: 0, b: 0, a: 0 },
      });
    }
    const refAO = await this.readAlpha(ctx, this.refRT, width, height, 1 / truthFrames);

    const results: Record<string, Record<number, number>> = {};
    const shimmer: Record<string, number> = {};
    for (const noise of NOISE_MODES) {
      results[noise] = {};
      const perFrame: Record<number, number> = results[noise];
      // accumulate frames, snapshot MSE vs converged reference at each count.
      let count = 0;
      for (const target of [...frames].sort((a, b) => a - b)) {
        while (count < target) {
          this.fillVbaoUniformNoise(ctx.scene.camera, width, height, count, v, noise);
          this.vbao.execute(this.vbaoRT, [this.depthTex, this.normalTex, this.atlasTex, this.vbaoData], {
            loadOp: count === 0 ? 'clear' : 'load',
            clearValue: { r: 0, g: 0, b: 0, a: 0 },
          });
          count++;
        }
        const ao = await this.readAlpha(ctx, this.vbaoRT, width, height, 1 / count);
        perFrame[target] = this.mse(ao, refAO);
      }
      // shimmer proxy: frame-to-frame change with temporal advance on (two
      // consecutive single-frame AOs). Lower => steadier under motion.
      this.fillVbaoUniformNoise(ctx.scene.camera, width, height, 0, v, noise);
      this.vbao.execute(this.vbaoRT, [this.depthTex, this.normalTex, this.atlasTex, this.vbaoData], {
        loadOp: 'clear',
        clearValue: { r: 0, g: 0, b: 0, a: 0 },
      });
      const f0 = await this.readAlpha(ctx, this.vbaoRT, width, height, 1);
      this.fillVbaoUniformNoise(ctx.scene.camera, width, height, 1, v, noise);
      this.vbao.execute(this.vbaoRT, [this.depthTex, this.normalTex, this.atlasTex, this.vbaoData], {
        loadOp: 'clear',
        clearValue: { r: 0, g: 0, b: 0, a: 0 },
      });
      const f1 = await this.readAlpha(ctx, this.vbaoRT, width, height, 1);
      shimmer[noise] = this.meanAbsDiff(f0, f1);
    }
    this.resetRequested = true; // measurement trampled the live buffers
    const json = JSON.stringify({ truthFrames, frames, mse: results, shimmer }, null, 2);
    // eslint-disable-next-line no-console
    console.log('LAB11_MSE ' + json);
    return json;
  }

  private fillVbaoUniformNoise(
    cam: PerspectiveCamera,
    width: number,
    height: number,
    sampleIndex: number,
    v: ParamGroup<typeof schema>['values'],
    noise: NoiseMode,
  ): void {
    this.fillVbaoUniform(cam, width, height, sampleIndex, v);
    this.vbaoU32[38] = sampleIndex >>> 0; // force temporal advance during measure
    this.vbaoU32[44] = NOISE_ID[noise] >>> 0;
  }

  private async readAlpha(
    ctx: HarnessContext,
    rt: RenderTarget,
    width: number,
    height: number,
    scale: number,
  ): Promise<Float32Array> {
    const gpu = getGPUTexture(ctx.renderer, rt.texture);
    const bytesPerTexel = 8; // rgba16float
    const unpadded = width * bytesPerTexel;
    const padded = Math.ceil(unpadded / 256) * 256;
    const buffer = this.device.createBuffer({
      size: padded * height,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    const encoder = this.device.createCommandEncoder();
    encoder.copyTextureToBuffer(
      { texture: gpu },
      { buffer, bytesPerRow: padded, rowsPerImage: height },
      { width, height, depthOrArrayLayers: 1 },
    );
    this.device.queue.submit([encoder.finish()]);
    await buffer.mapAsync(GPUMapMode.READ);
    const view = new DataView(buffer.getMappedRange());
    const out = new Float32Array(width * height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const off = y * padded + x * bytesPerTexel + 6; // alpha half
        out[y * width + x] = halfToFloat(view.getUint16(off, true)) * scale;
      }
    }
    buffer.unmap();
    buffer.destroy();
    return out;
  }

  private mse(a: Float32Array, b: Float32Array): number {
    let s = 0;
    for (let i = 0; i < a.length; i++) {
      const d = a[i] - b[i];
      s += d * d;
    }
    return s / a.length;
  }

  private meanAbsDiff(a: Float32Array, b: Float32Array): number {
    let s = 0;
    for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]);
    return s / a.length;
  }

  resize(ctx: HarnessContext): void {
    const { width, height } = ctx.renderSize();
    this.scenePass.setSize(width, height);
    for (const rt of [this.vbaoRT, this.refRT, this.denoiseRT, this.compareRT]) {
      rt.setSize(width, height);
      ensureRenderTarget(ctx.renderer, rt);
    }
    this.resetRequested = true;
  }

  dispose(): void {
    if (this.jitterActive && this.cam) clearCameraJitter(this.cam);
    for (const rt of [this.vbaoRT, this.refRT, this.denoiseRT, this.compareRT]) rt.dispose();
    delete (window as unknown as Record<string, unknown>).__lab11;
  }
}

export const samplingLabDemo: DemoDef = {
  id: '11-sampling',
  label: '11 — sampling lab',
  create: () => new SamplingLabDemo(),
};
