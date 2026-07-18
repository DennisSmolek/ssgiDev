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
  vec4,
  velocity,
} from 'three/tsl';
import { RenderPipeline } from 'three/webgpu';
import type { DepthTexture, PerspectiveCamera, Texture } from 'three/webgpu';
import type { Demo, DemoDef, HarnessContext } from '../../harness/types';
import { RawRenderPass } from '../../harness/raw-pass';
import { HistoryTarget } from '../../harness/temporal';
import { Comparator } from '../../harness/compare';
import type { CompareMode } from '../../harness/compare';
import { ensureRenderTarget } from '../../harness/three-internals';
import { buildParams } from '../../harness/params';
import type { ParamGroup } from '../../harness/params';
import sourceWgsl from './sshgi-source.wgsl?raw';
import marchWgsl from './sshgi-march.wgsl?raw';
import accumWgsl from './sshgi-accum.wgsl?raw';
import gcopyWgsl from './sshgi-gcopy.wgsl?raw';
import composeWgsl from './sshgi-compose.wgsl?raw';

const VIEW_MODES = ['combined', 'gi', 'raw', 'ao', 'beauty', 'split'] as const;
type ViewMode = (typeof VIEW_MODES)[number];
// compose.wgsl viewMode codes (split is display-side, not a compose code).
const VIEW_CODE: Record<Exclude<ViewMode, 'split'>, number> = {
  combined: 0,
  gi: 1,
  raw: 2,
  ao: 3,
  beauty: 4,
};

const REPROJECT = ['static', 'velocity'] as const;
type Reproject = (typeof REPROJECT)[number];

const schema = {
  viewMode: { type: 'enum', value: 'combined' as ViewMode, options: VIEW_MODES, label: 'view' },
  slices: { type: 'number', value: 4, min: 1, max: 8, step: 1, label: 'slices (horizons)' },
  steps: { type: 'number', value: 32, min: 4, max: 64, step: 1, label: 'steps/horizon' },
  thickness: { type: 'number', value: 0.06, min: 0.005, max: 1, step: 0.005, label: 'thickness (world)' },
  bias: { type: 'number', value: 0.002, min: 0, max: 0.02, step: 0.001, label: 'horizon bias' },
  giStrength: { type: 'number', value: 1, min: 0, max: 5, step: 0.05, label: 'GI strength' },
  maxLuminance: { type: 'number', value: 8, min: 1, max: 30, step: 0.5, label: 'firefly clamp' },
  stepScale: { type: 'number', value: 0.15, min: 0.05, max: 0.5, step: 0.01, label: 'step growth' },
  thicknessFalloff: { type: 'number', value: 0.07, min: 0, max: 0.3, step: 0.005, label: 'thickness falloff' },
  multibounce: { type: 'boolean', value: true, label: 'multibounce' },
  feedback: { type: 'number', value: 0.5, min: 0, max: 0.95, step: 0.01, label: 'bounce feedback' },
  reproject: { type: 'enum', value: 'static' as Reproject, options: REPROJECT, label: 'accumulation' },
  bilateralScale: { type: 'number', value: 1, min: 0.5, max: 3, step: 0.1, label: 'bilateral footprint' },
  countCap: { type: 'number', value: 64, min: 4, max: 256, step: 1, label: 'accum cap' },
  depthThresh: { type: 'number', value: 0.1, min: 0.01, max: 0.5, step: 0.01, label: 'reproj depth rej' },
  normalThresh: { type: 'number', value: 0.9, min: 0, max: 0.99, step: 0.01, label: 'reproj normal rej' },
  aoStrength: { type: 'number', value: 0.5, min: 0, max: 1, step: 0.05, label: 'AO in combined' },
  giExposure: { type: 'number', value: 2, min: 0.25, max: 8, step: 0.05, label: 'GI display gain' },
  compareMode: { type: 'enum', value: 'split' as CompareMode, options: ['split', 'diff'], label: 'A/B mode' },
  diffAmp: { type: 'number', value: 8, min: 1, max: 50, step: 0.5, label: 'diff amp' },
} as const;

// Display / comparator-only params: they never reset temporal accumulation.
const NON_RESET_KEYS = new Set([
  'viewMode',
  'aoStrength',
  'giExposure',
  'compareMode',
  'diffAmp',
]);

// Uniform sizes (floats). See per-shader struct comments.
const SOURCE_FLOATS = 12;
const MARCH_FLOATS = 32;
const ACCUM_FLOATS = 28;
const GCOPY_FLOATS = 4;
const COMPOSE_FLOATS = 8;

function floatRT(): RenderTarget {
  const rt = new RenderTarget(1, 1, { type: HalfFloatType, depthBuffer: false });
  rt.texture.colorSpace = NoColorSpace;
  return rt;
}

function historyRT(): HistoryTarget {
  return new HistoryTarget({ textureOptions: { type: HalfFloatType, depthBuffer: false } });
}

class SSHGIDemo implements Demo {
  private beautyTex!: Texture;
  private albedoTex!: Texture;
  private normalTex!: Texture;
  private velocityTex!: Texture;
  private depthTex!: DepthTexture;

  private scenePass!: ReturnType<typeof pass>;
  private gbufferPipeline!: RenderPipeline;
  private displayPipeline!: RenderPipeline;

  // Stable intermediate targets.
  private sourceRT = floatRT();
  private rawRT = floatRT();
  private outRT = floatRT();
  private compareRT = floatRT();
  // Ping-pong history: accumGI (rgb, a=count) + gbuffer copy (linZ, normal).
  private histGI = historyRT();
  private histG = historyRT();

  private sourcePass!: RawRenderPass;
  private marchPass!: RawRenderPass;
  private accumPass!: RawRenderPass;
  private gcopyPass!: RawRenderPass;
  private composePass!: RawRenderPass;
  private comparator!: Comparator;

  private sourceData = new Float32Array(SOURCE_FLOATS);
  private sourceU32 = new Uint32Array(this.sourceData.buffer);
  private marchData = new Float32Array(MARCH_FLOATS);
  private marchU32 = new Uint32Array(this.marchData.buffer);
  private accumData = new Float32Array(ACCUM_FLOATS);
  private accumU32 = new Uint32Array(this.accumData.buffer);
  private gcopyData = new Float32Array(GCOPY_FLOATS);
  private composeData = new Float32Array(COMPOSE_FLOATS);
  private composeU32 = new Uint32Array(this.composeData.buffer);

  private params!: ParamGroup<typeof schema>;

  private frameSeed = 0;
  private resetRequested = true;
  private lastPose = new Float64Array(8);

  private compareState = { splitX: 0.5 };
  private dragging = false;
  private pointerHandlers: Array<[keyof HTMLElementEventMap, EventListener]> = [];

  init(ctx: HarnessContext): void {
    const cam = ctx.scene.camera;

    this.scenePass = pass(ctx.scene.scene, cam);
    this.scenePass.setMRT(
      mrt({ output: output, albedo: diffuseColor, normal: normalView, velocity: velocity }),
    );
    this.beautyTex = this.scenePass.getTexture('output');
    this.albedoTex = this.scenePass.getTexture('albedo');
    this.normalTex = this.scenePass.getTexture('normal');
    this.velocityTex = this.scenePass.getTexture('velocity');
    this.depthTex = this.scenePass.renderTarget.depthTexture!;

    this.gbufferPipeline = new RenderPipeline(ctx.renderer, this.scenePass);
    this.displayPipeline = new RenderPipeline(ctx.renderer);

    // Source: beauty + histGI + velocity + histG + depth + normal + uniform.
    this.sourcePass = new RawRenderPass(ctx.renderer, 'sshgi-source', sourceWgsl, {
      bindings: [
        { kind: 'tex' }, { kind: 'tex' }, { kind: 'tex' }, { kind: 'tex' },
        { kind: 'depth' }, { kind: 'tex' }, { kind: 'uniform' },
      ],
    });
    // March: depth + normal + source + uniform.
    this.marchPass = new RawRenderPass(ctx.renderer, 'sshgi-march', marchWgsl, {
      bindings: [{ kind: 'depth' }, { kind: 'tex' }, { kind: 'tex' }, { kind: 'uniform' }],
    });
    // Accum: depth + normal + albedo + raw + histGI + velocity + histG + uniform.
    this.accumPass = new RawRenderPass(ctx.renderer, 'sshgi-accum', accumWgsl, {
      bindings: [
        { kind: 'depth' }, { kind: 'tex' }, { kind: 'tex' }, { kind: 'tex' },
        { kind: 'tex' }, { kind: 'tex' }, { kind: 'tex' }, { kind: 'uniform' },
      ],
    });
    // Gcopy: depth + normal + uniform.
    this.gcopyPass = new RawRenderPass(ctx.renderer, 'sshgi-gcopy', gcopyWgsl, {
      bindings: [{ kind: 'depth' }, { kind: 'tex' }, { kind: 'uniform' }],
    });
    // Compose: histGI + raw + beauty + albedo + uniform.
    this.composePass = new RawRenderPass(ctx.renderer, 'sshgi-compose', composeWgsl, {
      bindings: [{ kind: 'tex' }, { kind: 'tex' }, { kind: 'tex' }, { kind: 'tex' }, { kind: 'uniform' }],
    });
    this.comparator = new Comparator(ctx.renderer, 'sshgi-compare');

    this.resize(ctx);
    this.sourcePass.configure(this.sourceRT, this.sourceData.byteLength);
    this.marchPass.configure(this.rawRT, this.marchData.byteLength);
    this.accumPass.configure(this.histGI.current, this.accumData.byteLength);
    this.gcopyPass.configure(this.histG.current, this.gcopyData.byteLength);
    this.composePass.configure(this.outRT, this.composeData.byteLength);
    this.comparator.configure(this.compareRT);

    const folder = ctx.pane.addFolder({ title: 'Demo 06 — SSHGI (Mathis)' });
    this.params = buildParams(folder, schema);
    this.params.onChange((key) => {
      if (key === 'viewMode') this.updateOutputNode();
      if (!NON_RESET_KEYS.has(key as string)) this.resetRequested = true;
    });

    const urlView = new URLSearchParams(window.location.search).get('view');
    if (urlView && (VIEW_MODES as readonly string[]).includes(urlView)) {
      this.params.values.viewMode = urlView as ViewMode;
      this.params.refresh();
    }

    this.installDividerDrag(ctx);
    this.updateOutputNode();
  }

  private updateOutputNode(): void {
    const uv = screenUV;
    const src = this.params.values.viewMode === 'split' ? this.compareRT.texture : this.outRT.texture;
    this.displayPipeline.outputNode = vec4(texture(src, uv).rgb, float(1));
    this.displayPipeline.needsUpdate = true;
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
    const { width, height } = ctx.renderSize();
    this.frameSeed = (this.frameSeed + 1) >>> 0;

    // 1. G-buffer.
    this.gbufferPipeline.render();

    // 2. Reset accumulation on camera move / GI-param change / first frame / resize.
    const reset =
      this.cameraMoved(cam) || this.resetRequested || this.histGI.wasInvalidated ? 1 : 0;
    this.resetRequested = false;

    const reprojectMode = v.reproject === 'velocity' ? 1 : 0;
    const feedback = v.multibounce ? v.feedback : 0;

    // 3. Source-radiance injection (beauty + damped multibounce feedback).
    this.fillSourceUniform(cam, width, height, feedback, reprojectMode, reset, v);
    this.sourcePass.execute(
      this.sourceRT,
      [this.beautyTex, this.histGI.history.texture, this.velocityTex, this.histG.history.texture,
        this.depthTex, this.normalTex, this.sourceData],
      { loadOp: 'clear' },
    );

    // 4. Bitmask horizon GI march.
    this.fillMarchUniform(cam, width, height, v);
    this.marchPass.execute(
      this.rawRT,
      [this.depthTex, this.normalTex, this.sourceRT.texture, this.marchData],
      { loadOp: 'clear' },
    );

    // 5. Temporal accumulation + adaptive bilateral.
    this.fillAccumUniform(cam, width, height, reprojectMode, reset, v);
    this.accumPass.execute(
      this.histGI.current,
      [this.depthTex, this.normalTex, this.albedoTex, this.rawRT.texture,
        this.histGI.history.texture, this.velocityTex, this.histG.history.texture, this.accumData],
      { loadOp: 'clear' },
    );

    // 6. G-buffer copy (for next-frame reprojection rejection).
    this.gcopyData[0] = width;
    this.gcopyData[1] = height;
    this.gcopyData[2] = cam.near;
    this.gcopyData[3] = cam.far;
    this.gcopyPass.execute(
      this.histG.current,
      [this.depthTex, this.normalTex, this.gcopyData],
      { loadOp: 'clear' },
    );

    // 7. Compose selected view into the stable outRT.
    this.fillComposeUniform(width, height, v);
    this.composePass.execute(
      this.outRT,
      [this.histGI.current.texture, this.rawRT.texture, this.beautyTex, this.albedoTex, this.composeData],
      { loadOp: 'clear' },
    );

    // 8. Split A/B: raw single-frame GI vs denoised accumulated GI.
    if (v.viewMode === 'split') {
      this.comparator.execute(
        this.compareRT,
        this.rawRT.texture,
        this.histGI.current.texture,
        width,
        height,
        {
          mode: v.compareMode,
          splitX: this.compareState.splitX,
          amp: v.diffAmp,
          scaleA: v.giExposure,
          scaleB: v.giExposure,
          channel: 'rgb',
        },
      );
    }

    // 9. Display + advance history.
    this.displayPipeline.render();
    this.histGI.advance();
    this.histG.advance();

    ctx.timing.sampleGPU(ctx.renderer);
  }

  private fillSourceUniform(
    cam: PerspectiveCamera, w: number, h: number,
    feedback: number, reprojectMode: number, reset: number,
    v: ParamGroup<typeof schema>['values'],
  ): void {
    const d = this.sourceData;
    const u = this.sourceU32;
    d[0] = w; d[1] = h; d[2] = cam.near; d[3] = cam.far;
    d[4] = feedback; u[5] = reprojectMode; u[6] = reset; u[7] = 0;
    d[8] = v.depthThresh; d[9] = v.normalThresh; d[10] = 0; d[11] = 0;
  }

  private fillMarchUniform(
    cam: PerspectiveCamera, w: number, h: number,
    v: ParamGroup<typeof schema>['values'],
  ): void {
    const d = this.marchData;
    const u = this.marchU32;
    d.set(cam.projectionMatrixInverse.elements, 0);
    d[16] = w; d[17] = h; d[18] = cam.near; d[19] = cam.far;
    u[20] = v.slices; u[21] = v.steps; u[22] = this.frameSeed; u[23] = 0;
    d[24] = v.thickness; d[25] = v.bias; d[26] = v.giStrength; d[27] = v.maxLuminance;
    d[28] = v.stepScale; d[29] = v.thicknessFalloff; d[30] = 0; d[31] = 0;
  }

  private fillAccumUniform(
    cam: PerspectiveCamera, w: number, h: number,
    reprojectMode: number, reset: number,
    v: ParamGroup<typeof schema>['values'],
  ): void {
    const d = this.accumData;
    const u = this.accumU32;
    d.set(cam.projectionMatrixInverse.elements, 0);
    d[16] = w; d[17] = h; d[18] = cam.near; d[19] = cam.far;
    u[20] = reprojectMode; u[21] = reset; u[22] = v.countCap; u[23] = 0;
    d[24] = v.depthThresh; d[25] = v.normalThresh; d[26] = v.bilateralScale; d[27] = 0;
  }

  private fillComposeUniform(
    w: number, h: number, v: ParamGroup<typeof schema>['values'],
  ): void {
    const d = this.composeData;
    const u = this.composeU32;
    const mode = v.viewMode === 'split' ? 'combined' : v.viewMode;
    d[0] = w; d[1] = h; u[2] = VIEW_CODE[mode]; d[3] = v.aoStrength;
    d[4] = v.giExposure; u[5] = mode === 'combined' ? 1 : 0; d[6] = 0; d[7] = 0;
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
    this.sourceRT.setSize(width, height);
    this.rawRT.setSize(width, height);
    this.outRT.setSize(width, height);
    this.compareRT.setSize(width, height);
    this.histGI.setSize(width, height);
    this.histG.setSize(width, height);
    for (const rt of [this.sourceRT, this.rawRT, this.outRT, this.compareRT]) {
      ensureRenderTarget(ctx.renderer, rt);
    }
    // Allocate BOTH ping-pong slots so the first frame's binds are valid.
    ensureRenderTarget(ctx.renderer, this.histGI.current);
    ensureRenderTarget(ctx.renderer, this.histGI.history);
    ensureRenderTarget(ctx.renderer, this.histG.current);
    ensureRenderTarget(ctx.renderer, this.histG.history);
    this.resetRequested = true;
  }

  dispose(): void {
    const el = document.querySelector('canvas');
    for (const [type, fn] of this.pointerHandlers) {
      if (type === 'pointerdown') el?.removeEventListener(type, fn);
      else window.removeEventListener(type, fn);
    }
    this.sourceRT.dispose();
    this.rawRT.dispose();
    this.outRT.dispose();
    this.compareRT.dispose();
    this.histGI.dispose();
    this.histG.dispose();
  }
}

export const sshgiDemo: DemoDef = {
  id: '06-sshgi-mathis',
  label: '06 — SSHGI (Mathis)',
  create: () => new SSHGIDemo(),
};
