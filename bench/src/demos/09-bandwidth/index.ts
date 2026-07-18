import {
  HalfFloatType,
  FloatType,
  MathUtils,
  NoColorSpace,
  RedFormat,
  RGBAFormat,
  RenderPipeline,
  RenderTarget,
  StorageTexture,
  UnsignedByteType,
} from 'three/webgpu';
import {
  diffuseColor,
  float,
  max,
  mrt,
  normalView,
  output,
  pass,
  screenUV,
  texture,
  uniform,
  vec3,
  vec4,
  velocity,
} from 'three/tsl';
// `velocity` kept in the MRT for G-buffer parity with demo 03; demo 09 does no
// temporal reprojection so it is not consumed.
import type {
  AnyPixelFormat,
  DepthTexture,
  PerspectiveCamera,
  Texture,
  TextureDataType,
  WebGPURenderer,
} from 'three/webgpu';
import type { Demo, DemoDef, HarnessContext } from '../../harness/types';
import { RawComputePass } from '../../harness/raw-compute-pass';
import { RawRenderPass } from '../../harness/raw-pass';
import { ensureRenderTarget, ensureTexture } from '../../harness/three-internals';
import { buildParams } from '../../harness/params';
import type { ParamGroup } from '../../harness/params';
import { marchComputePlainWgsl, marchComputeSharedWgsl, marchFragmentWgsl } from './march-wgsl';
import downsampleWgsl from './ssrt09-downsample.wgsl?raw';
import upsampleWgsl from './ssrt09-upsample.wgsl?raw';

// Demo 09 — BANDWIDTH LAB. See README for the full write-up.
//
// Forks demo 03's SSRT march and adds three experiment axes:
//   1. Half-res march + joint bilateral upsample (Table 2 config f).
//   2. LSAO-style workgroup shared-memory depth caching (compute-only).
//   3. Fragment vs compute dispatch of the SAME march.
// (Axis 4, interleaved/checkerboard, is logged as skipped — see README.)

const VIEW_MODES = ['combined', 'ao', 'gi', 'beauty'] as const;
type ViewMode = (typeof VIEW_MODES)[number];

const DISPATCH_MODES = ['compute', 'shared', 'fragment'] as const;
type DispatchMode = (typeof DISPATCH_MODES)[number];

const MARCH_SCALES = ['1', '0.5', '0.25'] as const;
type MarchScale = (typeof MARCH_SCALES)[number];
function blockForScale(s: MarchScale): number {
  return s === '0.25' ? 4 : s === '0.5' ? 2 : 1;
}

// flags bits mirror march-wgsl.ts
const F_BITMASK = 1;
const F_JITTER = 2;
const F_LINEAR_THICKNESS = 4;
const F_NORMALAPPROX = 32;
const F_GI = 512;

function sceneDefaults(sceneId: string): { radius: number; thickness: number } {
  if (sceneId === 'sponza') return { radius: 8, thickness: 2 };
  if (sceneId === 'artifact-zoo') return { radius: 3, thickness: 0.3 };
  return { radius: 5, thickness: 0.5 };
}

const TEMPORAL_ROTATIONS = [60, 300, 180, 240, 120, 0];
const SPATIAL_OFFSETS = [0.0, 0.5, 0.25, 0.75];

// Activision GTAO analytic colored multibounce AO (composite-time, cheap).
/* eslint-disable @typescript-eslint/no-explicit-any */
function multiBounceAO(x: any, albedo: any): any {
  const a = albedo.mul(2.0404).sub(0.3324);
  const b = albedo.mul(-4.7951).add(0.6417);
  const c = albedo.mul(2.7552).add(0.6903);
  return max(vec3(x), x.mul(a).add(b).mul(x).add(c).mul(x));
}
/* eslint-enable @typescript-eslint/no-explicit-any */

const U_FLOATS = 52; // march Params
const DS_FLOATS = 8; // downsample
const UP_FLOATS = 10; // upsample

interface BenchApi {
  config(cfg: Partial<BenchConfig>): { fullW: number; fullH: number; marchW: number; marchH: number };
  march(n: number): Promise<number>;
  chain(n: number): Promise<number>;
  down(n: number): Promise<number>;
  up(n: number): Promise<number>;
}
interface BenchConfig {
  scale: MarchScale;
  mode: DispatchMode;
  rc: number;
  sc: number;
  radius: number;
  gi: boolean;
  bitmask: boolean;
}

class BandwidthDemo implements Demo {
  private beautyTex!: Texture;
  private albedoTex!: Texture;
  private normalTex!: Texture;
  private depthTex!: DepthTexture;

  private scenePass!: ReturnType<typeof pass>;
  private gbufferPipeline!: RenderPipeline;
  private displayPipeline!: RenderPipeline;

  // March-resolution G-buffer (produced by downsample).
  private marchDepth = this.makeStorage(FloatType, RedFormat); // r32float
  private marchNormal = this.makeStorage(HalfFloatType, RGBAFormat);
  private marchLight = this.makeStorage(HalfFloatType, RGBAFormat);
  // March output at march res (compute), and the full-res final the display reads.
  private marchOut = this.makeStorage(HalfFloatType, RGBAFormat);
  private giaoFull = this.makeStorage(HalfFloatType, RGBAFormat);
  // Fragment-variant march target (three RenderTarget, march res).
  private marchRT = this.makeRT();

  private downsample!: RawComputePass;
  private marchPlain!: RawComputePass;
  private marchShared!: RawComputePass;
  private marchFrag!: RawRenderPass;
  private upsample!: RawComputePass;

  private mainData = new Float32Array(U_FLOATS);
  private mainU32 = new Uint32Array(this.mainData.buffer);
  private dsData = new Float32Array(DS_FLOATS);
  private dsU32 = new Uint32Array(this.dsData.buffer);
  private upData = new Float32Array(UP_FLOATS);

  private device!: GPUDevice;
  private renderer!: WebGPURenderer;
  private cam!: PerspectiveCamera;
  private fullW = 1;
  private fullH = 1;
  private marchW = 1;
  private marchH = 1;

  private uGiExposure = uniform(1);
  private params!: ParamGroup<typeof schema>;
  private frameCounter = 0;
  private sceneId = 'cornell';

  private makeStorage(type: TextureDataType, format: AnyPixelFormat): StorageTexture {
    const t = new StorageTexture(1, 1);
    t.type = type;
    t.format = format;
    t.colorSpace = NoColorSpace;
    t.generateMipmaps = false;
    return t;
  }
  private makeRT(): RenderTarget {
    const rt = new RenderTarget(1, 1, { depthBuffer: false });
    rt.texture.type = HalfFloatType;
    rt.texture.format = RGBAFormat;
    rt.texture.colorSpace = NoColorSpace;
    rt.texture.generateMipmaps = false;
    return rt;
  }

  init(ctx: HarnessContext): void {
    this.sceneId = new URLSearchParams(window.location.search).get('scene') ?? 'cornell';
    this.device = ctx.device;
    const cam = ctx.scene.camera;

    this.scenePass = pass(ctx.scene.scene, cam);
    this.scenePass.setMRT(mrt({ output: output, albedo: diffuseColor, normal: normalView, velocity: velocity }));
    this.beautyTex = this.scenePass.getTexture('output');
    this.albedoTex = this.scenePass.getTexture('albedo');
    this.normalTex = this.scenePass.getTexture('normal');
    this.scenePass.getTexture('albedo').type = UnsignedByteType;
    this.depthTex = this.scenePass.renderTarget.depthTexture!;

    this.gbufferPipeline = new RenderPipeline(ctx.renderer, this.scenePass);
    this.displayPipeline = new RenderPipeline(ctx.renderer);

    // Downsample: full depth/normal/light -> march depth/normal/light.
    this.downsample = new RawComputePass(ctx.renderer, 'ssrt09-downsample', downsampleWgsl, {
      bindings: [
        { kind: 'depth' },
        { kind: 'tex' },
        { kind: 'tex' },
        { kind: 'storage', format: 'r32float' },
        { kind: 'storage', format: 'rgba16float' },
        { kind: 'storage', format: 'rgba16float' },
        { kind: 'uniform' },
      ],
    });
    // Compute march variants (plain + LSAO shared-memory). Bindings identical.
    const marchBindings = [
      { kind: 'tex' as const },
      { kind: 'tex' as const },
      { kind: 'tex' as const },
      { kind: 'storage' as const, format: 'rgba16float' as const },
      { kind: 'uniform' as const },
    ];
    this.marchPlain = new RawComputePass(ctx.renderer, 'ssrt09-march', marchComputePlainWgsl, { bindings: marchBindings });
    this.marchShared = new RawComputePass(ctx.renderer, 'ssrt09-march-shared', marchComputeSharedWgsl, { bindings: marchBindings });
    // Fragment march variant (same core, fullscreen triangle).
    this.marchFrag = new RawRenderPass(ctx.renderer, 'ssrt09-march-frag', marchFragmentWgsl, {
      bindings: [{ kind: 'tex' }, { kind: 'tex' }, { kind: 'tex' }, { kind: 'uniform' }],
    });
    // Joint bilateral upsample: low giao + low depth/normal + full depth/normal -> full giao.
    this.upsample = new RawComputePass(ctx.renderer, 'ssrt09-upsample', upsampleWgsl, {
      bindings: [
        { kind: 'tex' },
        { kind: 'tex' },
        { kind: 'tex' },
        { kind: 'depth' },
        { kind: 'tex' },
        { kind: 'storage', format: 'rgba16float' },
        { kind: 'uniform' },
      ],
    });

    this.resize(ctx);
    this.downsample.configure(this.dsData.byteLength);
    this.marchPlain.configure(this.mainData.byteLength);
    this.marchShared.configure(this.mainData.byteLength);
    this.marchFrag.configure(this.marchRT, this.mainData.byteLength);
    this.upsample.configure(this.upData.byteLength);

    const folder = ctx.pane.addFolder({ title: 'Demo 09 — bandwidth lab' });
    const d = sceneDefaults(this.sceneId);
    this.params = buildParams(folder, schema);
    this.params.values.radius = d.radius;
    this.params.values.thickness = d.thickness;
    this.params.refresh();
    this.params.onChange((key) => {
      if (key === 'viewMode' || key === 'multiBounceAO' || key === 'marchScale' || key === 'dispatchMode') {
        this.updateOutputNode();
      }
    });

    // URL overrides for deterministic capture / benchmarking.
    const q = new URLSearchParams(window.location.search);
    const setEnum = <T extends string>(k: string, opts: readonly T[], cur: T): T => {
      const s = q.get(k);
      return s !== null && (opts as readonly string[]).includes(s) ? (s as T) : cur;
    };
    const bool = (k: string, cur: boolean): boolean => {
      const s = q.get(k);
      return s === null ? cur : s === '1';
    };
    this.params.values.viewMode = setEnum('view', VIEW_MODES, this.params.values.viewMode);
    this.params.values.marchScale = setEnum('mscale', MARCH_SCALES, this.params.values.marchScale);
    this.params.values.dispatchMode = setEnum('mode', DISPATCH_MODES, this.params.values.dispatchMode);
    this.params.values.useBitmask = bool('bitmask', this.params.values.useBitmask);
    this.params.values.gatherGI = bool('gi', this.params.values.gatherGI);
    this.params.values.normalApproximation = bool('na', this.params.values.normalApproximation);
    if (q.get('rc') !== null) this.params.values.rotationCount = Number(q.get('rc'));
    if (q.get('sc') !== null) this.params.values.stepCount = Number(q.get('sc'));
    if (q.get('radius') !== null) this.params.values.radius = Number(q.get('radius'));
    if (q.get('thickness') !== null) this.params.values.thickness = Number(q.get('thickness'));
    this.params.refresh();

    this.applyScale();
    this.updateOutputNode();

    // Benchmark harness (M3 fence methodology: onSubmittedWorkDone around N iters).
    const api: BenchApi = {
      config: (cfg) => this.benchConfig(cfg),
      march: (n) => this.benchMarch(n),
      chain: (n) => this.benchChain(n),
      down: (n) => this.benchDown(n),
      up: (n) => this.benchUp(n),
    };
    (window as unknown as { __bench09?: BenchApi }).__bench09 = api;
  }

  // Full-res final buffer the display reads; source depends on scale + mode.
  private displaySource(): Texture {
    const block = blockForScale(this.params.values.marchScale);
    if (block > 1) return this.giaoFull;
    // Full-res march: display the march output directly.
    return this.params.values.dispatchMode === 'fragment' ? this.marchRT.texture : this.marchOut;
  }

  private updateOutputNode(): void {
    this.displayPipeline.outputNode = this.buildViewNode(this.params.values.viewMode);
    this.displayPipeline.needsUpdate = true;
  }

  private buildViewNode(mode: ViewMode) {
    const uv = screenUV;
    const giao = texture(this.displaySource(), uv);
    const ao = giao.a;
    const gi = giao.rgb.mul(this.uGiExposure);
    switch (mode) {
      case 'ao':
        return vec4(vec3(ao), float(1));
      case 'gi':
        return vec4(gi, float(1));
      case 'combined': {
        const beauty = texture(this.beautyTex, uv).rgb;
        const albedo = texture(this.albedoTex, uv).rgb;
        const aoTerm = this.params.values.multiBounceAO ? multiBounceAO(ao, albedo) : vec3(ao);
        return vec4(beauty.mul(aoTerm).add(albedo.mul(gi)), float(1));
      }
      case 'beauty':
        return vec4(texture(this.beautyTex, uv).rgb, float(1));
    }
  }

  private computeFlags(): number {
    const v = this.params.values;
    let f = 0;
    if (v.useBitmask) f |= F_BITMASK;
    if (v.jitterSamples) f |= F_JITTER;
    if (v.linearThickness) f |= F_LINEAR_THICKNESS;
    if (v.normalApproximation) f |= F_NORMALAPPROX;
    if (v.gatherGI) f |= F_GI;
    return f;
  }

  // Sizes the march-resolution buffers (+ fragment RT) to the current scale.
  private applyScale(): void {
    const block = blockForScale(this.params?.values.marchScale ?? '1');
    this.marchW = Math.max(1, Math.ceil(this.fullW / block));
    this.marchH = Math.max(1, Math.ceil(this.fullH / block));
    for (const t of [this.marchDepth, this.marchNormal, this.marchLight, this.marchOut]) {
      t.image = { width: this.marchW, height: this.marchH };
      t.dispose();
      ensureTexture(this.renderer, t);
    }
    this.marchRT.setSize(this.marchW, this.marchH);
    ensureRenderTarget(this.renderer, this.marchRT);
  }

  private fillMainUniform(cam: PerspectiveCamera): void {
    const d = this.mainData;
    const u = this.mainU32;
    d.set(cam.projectionMatrix.elements, 0);
    d.set(cam.projectionMatrixInverse.elements, 16);
    d[32] = this.marchW;
    d[33] = this.marchH;
    d[34] = cam.near;
    d[35] = cam.far;
    const v = this.params.values;
    d[36] = v.radius;
    d[37] = v.thickness;
    d[38] = v.expFactor;
    d[39] = (this.marchH / (Math.tan(cam.fov * MathUtils.DEG2RAD * 0.5) * 2)) * 0.5; // halfProjScale (march res)
    u[40] = v.rotationCount;
    u[41] = v.stepCount;
    u[42] = this.frameCounter >>> 0;
    u[43] = this.computeFlags();
    d[44] = v.aoIntensity;
    d[45] = v.giIntensity;
    d[46] = v.backfaceLighting;
    d[47] = v.maxLuminance;
    d[48] = SPATIAL_OFFSETS[Math.floor(this.frameCounter / 6) % 4];
    d[49] = TEMPORAL_ROTATIONS[this.frameCounter % 6] / 360;
    d[50] = 0;
    d[51] = 0;
  }

  private fillDownsampleUniform(): void {
    const block = blockForScale(this.params.values.marchScale);
    this.dsData[0] = this.fullW;
    this.dsData[1] = this.fullH;
    this.dsData[2] = this.marchW;
    this.dsData[3] = this.marchH;
    this.dsU32[4] = block;
    this.dsData[5] = 0;
    this.dsData[6] = 0;
    this.dsData[7] = 0;
  }

  private fillUpsampleUniform(cam: PerspectiveCamera): void {
    const d = this.upData;
    d[0] = this.fullW;
    d[1] = this.fullH;
    d[2] = this.marchW;
    d[3] = this.marchH;
    d[4] = cam.near;
    d[5] = cam.far;
    d[6] = this.params.values.upsampleNormalPhi;
    d[7] = this.params.values.upsampleDepthPhi;
    d[8] = 0;
    d[9] = 0;
  }

  // Runs downsample + active march + (upsample if half/quarter res). Shared by
  // frame() and the chain benchmark.
  private runPipeline(cam: PerspectiveCamera): void {
    const block = blockForScale(this.params.values.marchScale);
    const mode = this.params.values.dispatchMode;

    this.fillDownsampleUniform();
    this.downsample.execute(
      [this.depthTex, this.normalTex, this.beautyTex, this.marchDepth, this.marchNormal, this.marchLight, this.dsData],
      this.marchW,
      this.marchH,
    );

    this.fillMainUniform(cam);
    this.runActiveMarch(mode);

    if (block > 1) {
      this.fillUpsampleUniform(cam);
      const lowGiao = mode === 'fragment' ? this.marchRT.texture : this.marchOut;
      this.upsample.execute(
        [lowGiao, this.marchDepth, this.marchNormal, this.depthTex, this.normalTex, this.giaoFull, this.upData],
        this.fullW,
        this.fullH,
      );
    }
  }

  private runActiveMarch(mode: DispatchMode): void {
    if (mode === 'fragment') {
      this.marchFrag.execute(this.marchRT, [this.marchDepth, this.marchNormal, this.marchLight, this.mainData], {
        loadOp: 'clear',
      });
    } else {
      const marchPass = mode === 'shared' ? this.marchShared : this.marchPlain;
      marchPass.execute([this.marchDepth, this.marchNormal, this.marchLight, this.marchOut, this.mainData], this.marchW, this.marchH);
    }
  }

  frame(ctx: HarnessContext, _dt: number): void {
    const cam = ctx.scene.camera;
    this.frameCounter++;
    this.uGiExposure.value = this.params.values.giExposure;

    this.gbufferPipeline.render();
    this.runPipeline(cam);
    this.displayPipeline.render();
    ctx.timing.sampleGPU(ctx.renderer);
  }

  // --- benchmark harness ---------------------------------------------------
  private benchConfig(cfg: Partial<BenchConfig>): { fullW: number; fullH: number; marchW: number; marchH: number } {
    const v = this.params.values;
    if (cfg.scale) v.marchScale = cfg.scale;
    if (cfg.mode) v.dispatchMode = cfg.mode;
    if (cfg.rc !== undefined) v.rotationCount = cfg.rc;
    if (cfg.sc !== undefined) v.stepCount = cfg.sc;
    if (cfg.radius !== undefined) v.radius = cfg.radius;
    if (cfg.gi !== undefined) v.gatherGI = cfg.gi;
    if (cfg.bitmask !== undefined) v.useBitmask = cfg.bitmask;
    this.params.refresh();
    this.applyScale();
    this.updateOutputNode();
    return { fullW: this.fullW, fullH: this.fullH, marchW: this.marchW, marchH: this.marchH };
  }

  // Prime: ensure the march-res G-buffer is populated for the current config.
  private prime(cam: PerspectiveCamera): void {
    this.gbufferPipeline.render();
    this.fillDownsampleUniform();
    this.downsample.execute(
      [this.depthTex, this.normalTex, this.beautyTex, this.marchDepth, this.marchNormal, this.marchLight, this.dsData],
      this.marchW,
      this.marchH,
    );
    this.fillMainUniform(cam);
  }

  private async fence(fn: () => void, n: number): Promise<number> {
    await this.device.queue.onSubmittedWorkDone();
    const t0 = performance.now();
    for (let i = 0; i < n; i++) fn();
    await this.device.queue.onSubmittedWorkDone();
    return (performance.now() - t0) / n;
  }

  private async benchMarch(n: number): Promise<number> {
    this.prime(this.cam);
    const mode = this.params.values.dispatchMode;
    return this.fence(() => this.runActiveMarch(mode), n);
  }
  private async benchDown(n: number): Promise<number> {
    this.gbufferPipeline.render();
    this.fillDownsampleUniform();
    return this.fence(
      () =>
        this.downsample.execute(
          [this.depthTex, this.normalTex, this.beautyTex, this.marchDepth, this.marchNormal, this.marchLight, this.dsData],
          this.marchW,
          this.marchH,
        ),
      n,
    );
  }
  private async benchUp(n: number): Promise<number> {
    this.prime(this.cam);
    this.runActiveMarch(this.params.values.dispatchMode);
    this.fillUpsampleUniform(this.cam);
    const lowGiao = this.params.values.dispatchMode === 'fragment' ? this.marchRT.texture : this.marchOut;
    return this.fence(
      () =>
        this.upsample.execute(
          [lowGiao, this.marchDepth, this.marchNormal, this.depthTex, this.normalTex, this.giaoFull, this.upData],
          this.fullW,
          this.fullH,
        ),
      n,
    );
  }
  private async benchChain(n: number): Promise<number> {
    this.gbufferPipeline.render();
    return this.fence(() => this.runPipeline(this.cam), n);
  }

  resize(ctx: HarnessContext): void {
    const { width, height } = ctx.renderSize();
    this.renderer = ctx.renderer;
    this.cam = ctx.scene.camera;
    this.fullW = width;
    this.fullH = height;
    this.scenePass.setSize(width, height);
    // Full-res final buffer.
    this.giaoFull.image = { width, height };
    this.giaoFull.dispose();
    ensureTexture(ctx.renderer, this.giaoFull);
    this.applyScale();
  }

  dispose(): void {
    for (const t of [this.marchDepth, this.marchNormal, this.marchLight, this.marchOut, this.giaoFull]) t.dispose();
    this.marchRT.dispose();
  }
}

const schema = {
  viewMode: { type: 'enum', value: 'combined' as ViewMode, options: VIEW_MODES, label: 'view' },
  giExposure: { type: 'number', value: 1, min: 0.1, max: 8, step: 0.05, label: 'GI display gain' },
  // --- experiment axes ---
  marchScale: { type: 'enum', value: '0.5' as MarchScale, options: MARCH_SCALES, label: 'march scale (axis 1)' },
  dispatchMode: { type: 'enum', value: 'compute' as DispatchMode, options: DISPATCH_MODES, label: 'dispatch (axis 2/3)' },
  upsampleNormalPhi: { type: 'number', value: 32, min: 1, max: 64, step: 1, label: 'upsample normalPhi' },
  upsampleDepthPhi: { type: 'number', value: 0.05, min: 0.005, max: 0.5, step: 0.005, label: 'upsample depthPhi' },
  // --- march (SSRT) ---
  rotationCount: { type: 'number', value: 2, min: 1, max: 4, step: 1, label: 'rotationCount' },
  stepCount: { type: 'number', value: 12, min: 1, max: 32, step: 1, label: 'stepCount' },
  radius: { type: 'number', value: 5, min: 1, max: 25, step: 0.5, label: 'radius (world)' },
  expFactor: { type: 'number', value: 1, min: 1, max: 3, step: 0.05, label: 'expFactor' },
  jitterSamples: { type: 'boolean', value: true, label: 'jitterSamples' },
  useBitmask: { type: 'boolean', value: true, label: 'VBAO bitmask' },
  gatherGI: { type: 'boolean', value: true, label: 'gather GI' },
  giIntensity: { type: 'number', value: 10, min: 0, max: 100, step: 0.5, label: 'GIIntensity' },
  normalApproximation: { type: 'boolean', value: false, label: 'normalApproximation' },
  backfaceLighting: { type: 'number', value: 0, min: 0, max: 1, step: 0.01, label: 'backfaceLighting' },
  maxLuminance: { type: 'number', value: 7, min: 1, max: 30, step: 0.5, label: 'firefly clamp' },
  aoIntensity: { type: 'number', value: 1, min: 0, max: 4, step: 0.05, label: 'AOIntensity' },
  thickness: { type: 'number', value: 0.5, min: 0.01, max: 10, step: 0.01, label: 'thickness (world)' },
  linearThickness: { type: 'boolean', value: false, label: 'linearThickness' },
  multiBounceAO: { type: 'boolean', value: false, label: 'multiBounceAO (composite)' },
} as const;

export const bandwidthDemo: DemoDef = {
  id: '09-bandwidth',
  label: '09 — bandwidth lab',
  create: () => new BandwidthDemo(),
};
