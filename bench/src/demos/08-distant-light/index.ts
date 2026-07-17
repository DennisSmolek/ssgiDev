import {
  DataTexture,
  HalfFloatType,
  LinearFilter,
  LinearMipmapLinearFilter,
  NoColorSpace,
  RGBAFormat,
  RenderTarget,
  RepeatWrapping,
  UnsignedByteType,
} from 'three/webgpu';
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
import { RawRenderPass } from '../../harness/raw-pass';
import { ensureRenderTarget, ensureTexture, getDevice } from '../../harness/three-internals';
import { buildParams } from '../../harness/params';
import type { ParamGroup } from '../../harness/params';
import gtDistantWgsl from './gt-distant.wgsl?raw';

const VIEW_MODES = ['distant', 'ao', 'combined', 'beauty'] as const;
type ViewMode = (typeof VIEW_MODES)[number];

// Distant-light sampling method (see gt-distant.wgsl header for lineage).
const METHODS = ['ottosson-perbin', 'salm-caps', 'flat-fallback'] as const;
type Method = (typeof METHODS)[number];
const METHOD_INDEX: Record<Method, number> = {
  'ottosson-perbin': 0,
  'salm-caps': 1,
  'flat-fallback': 2,
};

// Thickness heuristic.
const HEURISTICS = ['constant', 'linear-dist', 'ottosson-3clGWB', 'light-occluder-wcBGRz'] as const;
type Heuristic = (typeof HEURISTICS)[number];
const HEURISTIC_INDEX: Record<Heuristic, number> = {
  constant: 0,
  'linear-dist': 1,
  'ottosson-3clGWB': 2,
  'light-occluder-wcBGRz': 3,
};

// ------- equirect distant environment (demo 03's ambient source, re-baked with
// a directional sun so distant-light directionality is visible on Cornell). ----
const ENV_W = 128;
const ENV_H = 64;
const ENV_MIPS = Math.floor(Math.log2(Math.max(ENV_W, ENV_H))) + 1;
function makeEnv(sceneId: string): DataTexture {
  const data = new Uint8Array(ENV_W * ENV_H * 4);
  // sun direction (roughly up-and-to-the-side, deliberately off-camera-ish).
  const sun = [0.6, 0.7, 0.38];
  const sl = Math.hypot(sun[0], sun[1], sun[2]);
  sun[0] /= sl; sun[1] /= sl; sun[2] /= sl;
  const isCornell = sceneId === 'cornell';
  for (let y = 0; y < ENV_H; y++) {
    const phi = ((y + 0.5) / ENV_H) * Math.PI; // 0 top (y=+1) .. pi bottom (y=-1)
    const cy = Math.cos(phi);
    const sy = Math.sin(phi);
    for (let x = 0; x < ENV_W; x++) {
      const theta = ((x + 0.5) / ENV_W - 0.5) * 2 * Math.PI;
      const dx = sy * Math.cos(theta);
      const dz = sy * Math.sin(theta);
      const dy = cy;
      const up = Math.max(0, dy);
      // sky gradient (cool up, warm horizon), dimmer for cornell.
      const base = isCornell ? 0.55 : 1.0;
      let r = base * (0.30 * up + 0.42 * (1 - up));
      let g = base * (0.42 * up + 0.40 * (1 - up));
      let b = base * (0.72 * up + 0.36 * (1 - up));
      // directional sun disc
      const cd = dx * sun[0] + dy * sun[1] + dz * sun[2];
      const sunI = 4.5 * smoothstep(0.86, 0.995, cd) + 1.2 * smoothstep(0.4, 0.9, cd);
      r += sunI * 1.0; g += sunI * 0.86; b += sunI * 0.55;
      const i = (y * ENV_W + x) * 4;
      data[i] = Math.min(255, Math.round(r * 255));
      data[i + 1] = Math.min(255, Math.round(g * 255));
      data[i + 2] = Math.min(255, Math.round(b * 255));
      data[i + 3] = 255;
    }
  }
  const tex = new DataTexture(data, ENV_W, ENV_H, RGBAFormat, UnsignedByteType);
  tex.colorSpace = NoColorSpace;
  tex.wrapS = RepeatWrapping;
  tex.minFilter = LinearMipmapLinearFilter;
  tex.magFilter = LinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}
function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

const schema = {
  viewMode: { type: 'enum', value: 'distant' as ViewMode, options: VIEW_MODES, label: 'view' },
  method: { type: 'enum', value: 'ottosson-perbin' as Method, options: METHODS, label: 'light method' },
  heuristic: { type: 'enum', value: 'constant' as Heuristic, options: HEURISTICS, label: 'thickness heuristic' },
  slicesPerFrame: { type: 'number', value: 2, min: 1, max: 8, step: 1, label: 'slices/frame' },
  stepsPerSlice: { type: 'number', value: 32, min: 4, max: 64, step: 1, label: 'steps/slice' },
  marchWidthPx: { type: 'number', value: 512, min: 32, max: 1024, step: 16, label: 'march width (px)' },
  thickness: { type: 'number', value: 0.5, min: 0.02, max: 4, step: 0.02, label: 'base thickness (world)' },
  linearThickK: { type: 'number', value: 0.15, min: 0, max: 2, step: 0.01, label: 'linear-dist slope' },
  occluderThicknessScale: { type: 'number', value: 1.0, min: 0, max: 3, step: 0.05, label: 'occluder thick scale' },
  occluderCosLimit: { type: 'number', value: 0.9, min: 0.5, max: 0.999, step: 0.005, label: 'occluder cos limit' },
  bitsPerSector: { type: 'number', value: 4, min: 1, max: 8, step: 1, label: 'caps: bits/sector' },
  bias: { type: 'number', value: 0.03, min: 0, max: 0.3, step: 0.005, label: 'normal bias' },
  distantIntensity: { type: 'number', value: 1.0, min: 0, max: 4, step: 0.05, label: 'distant intensity' },
  ambientIntensity: { type: 'number', value: 0.05, min: 0, max: 1, step: 0.01, label: 'ambient floor' },
  envLod: { type: 'number', value: 1.0, min: 0, max: ENV_MIPS - 1, step: 0.25, label: 'env LOD (cone blur)' },
  giExposure: { type: 'number', value: 1.5, min: 0.25, max: 8, step: 0.05, label: 'display gain' },
  giStrength: { type: 'number', value: 1, min: 0, max: 5, step: 0.05, label: 'GI strength' },
  acosApprox: { type: 'boolean', value: true, label: 'acos approx' },
  importanceSampling: { type: 'boolean', value: true, label: 'slice importance' },
  accumulate: { type: 'boolean', value: true, label: 'accumulate' },
  maxAccumFrames: { type: 'number', value: 512, min: 1, max: 4096, step: 1, label: 'max frames' },
} as const;

const NON_RESET_KEYS = new Set(['viewMode', 'giExposure', 'giStrength']);

// Uniform: proj(16)+invProj(16)+camToWorld(16)+[res,near,far](4)
//   +[slices,steps,seed,flags](4)+[thick,marchW,bias,heuristic](4)
//   +[method,occThickScale,occCosLimit,distIntensity](4)
//   +[ambient,linearK,bitsPerSector,envLod](4) = 68 floats.
const U_FLOATS = 68;

const ADDITIVE: GPUBlendState = {
  color: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
  alpha: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
};

function floatRT(): RenderTarget {
  const rt = new RenderTarget(1, 1, { type: HalfFloatType, depthBuffer: false });
  rt.texture.colorSpace = NoColorSpace;
  return rt;
}

class DistantLightDemo implements Demo {
  private beautyTex!: Texture;
  private albedoTex!: Texture;
  private normalTex!: Texture;
  private depthTex!: DepthTexture;

  private scenePass!: ReturnType<typeof pass>;
  private gbufferPipeline!: RenderPipeline;
  private displayPipeline!: RenderPipeline;

  private accRT = floatRT(); // rgb = distant GI, a = AO
  private pass!: RawRenderPass;
  private data = new Float32Array(U_FLOATS);
  private u32 = new Uint32Array(this.data.buffer);

  private envTex!: DataTexture;
  private envSampler!: GPUSampler;
  private sceneId = 'cornell';

  private uCount = uniform(1);
  private uGiExposure = uniform(1.5);
  private uGiStrength = uniform(1);

  private params!: ParamGroup<typeof schema>;
  private countBinding!: { refresh(): void };
  private readout = { samples: 0 };

  private sampleCount = 0;
  private resetRequested = true;
  private lastPose = new Float64Array(8);

  init(ctx: HarnessContext): void {
    const cam = ctx.scene.camera;
    this.sceneId = new URLSearchParams(window.location.search).get('scene') ?? 'cornell';

    this.scenePass = pass(ctx.scene.scene, cam);
    this.scenePass.setMRT(mrt({ output: output, albedo: diffuseColor, normal: normalView }));
    this.beautyTex = this.scenePass.getTexture('output');
    this.albedoTex = this.scenePass.getTexture('albedo');
    this.normalTex = this.scenePass.getTexture('normal');
    this.depthTex = this.scenePass.renderTarget.depthTexture!;

    this.gbufferPipeline = new RenderPipeline(ctx.renderer, this.scenePass);
    this.displayPipeline = new RenderPipeline(ctx.renderer);

    this.pass = new RawRenderPass(ctx.renderer, 'gt-distant', gtDistantWgsl, {
      bindings: [
        { kind: 'depth' },
        { kind: 'tex' },
        { kind: 'sampledTex' },
        { kind: 'sampler', filtering: true },
        { kind: 'uniform' },
      ],
      blend: ADDITIVE,
    });

    this.envSampler = getDevice(ctx.renderer).createSampler({
      magFilter: 'linear',
      minFilter: 'linear',
      mipmapFilter: 'linear',
      addressModeU: 'repeat',
      addressModeV: 'clamp-to-edge',
    });
    this.envTex = makeEnv(this.sceneId);
    ensureTexture(ctx.renderer, this.envTex);

    this.resize(ctx);
    this.pass.configure(this.accRT, this.data.byteLength);

    const folder = ctx.pane.addFolder({ title: 'Demo 08 — Distant Light + Thickness' });
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
    }
    const urlMethod = search.get('method');
    if (urlMethod && (METHODS as readonly string[]).includes(urlMethod)) {
      this.params.values.method = urlMethod as Method;
    }
    const urlHeur = search.get('heuristic');
    if (urlHeur && (HEURISTICS as readonly string[]).includes(urlHeur)) {
      this.params.values.heuristic = urlHeur as Heuristic;
    }
    const urlThick = search.get('thickness');
    if (urlThick) this.params.values.thickness = parseFloat(urlThick);
    this.params.refresh();

    this.installBench(ctx);
    this.updateOutputNode();
  }

  private updateOutputNode(): void {
    this.displayPipeline.outputNode = this.buildViewNode(this.params.values.viewMode);
  }

  private buildViewNode(mode: ViewMode) {
    const uv = screenUV;
    const acc = texture(this.accRT.texture, uv);
    const ao = acc.a.div(this.uCount);
    const gi = acc.rgb.div(this.uCount);
    const beauty = texture(this.beautyTex, uv).rgb;
    const albedo = texture(this.albedoTex, uv).rgb;
    switch (mode) {
      case 'distant':
        return vec4(gi.mul(this.uGiExposure), float(1));
      case 'ao':
        return vec4(vec3(ao), float(1));
      case 'combined':
        return vec4(beauty.mul(ao).add(albedo.mul(gi).mul(this.uGiStrength)), float(1));
      case 'beauty':
        return vec4(beauty, float(1));
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

    this.gbufferPipeline.render();

    if (this.cameraMoved(cam) || this.resetRequested || !v.accumulate) {
      this.sampleCount = 0;
      this.resetRequested = false;
    }

    const { width, height } = ctx.renderSize();
    if (this.sampleCount < v.maxAccumFrames) {
      const loadOp: GPULoadOp = this.sampleCount === 0 ? 'clear' : 'load';
      const clearValue = { r: 0, g: 0, b: 0, a: 0 };
      this.fillUniform(cam, width, height, this.sampleCount, v);
      this.pass.execute(this.accRT, [this.depthTex, this.normalTex, this.envTex, this.envSampler, this.data], {
        loadOp,
        clearValue,
      });
      this.sampleCount++;
    }
    this.uCount.value = Math.max(1, this.sampleCount);
    this.uGiExposure.value = v.giExposure;
    this.uGiStrength.value = v.giStrength;

    this.displayPipeline.render();

    this.readout.samples = this.sampleCount;
    this.countBinding.refresh();
    ctx.timing.sampleGPU(ctx.renderer);
  }

  private fillUniform(
    cam: PerspectiveCamera,
    width: number,
    height: number,
    seed: number,
    v: ParamGroup<typeof schema>['values'],
  ): void {
    const d = this.data;
    const u = this.u32;
    d.set(cam.projectionMatrix.elements, 0);
    d.set(cam.projectionMatrixInverse.elements, 16);
    d.set(cam.matrixWorld.elements, 32); // view->world (camToWorld)
    d[48] = width;
    d[49] = height;
    d[50] = cam.near;
    d[51] = cam.far;
    u[52] = v.slicesPerFrame;
    u[53] = v.stepsPerSlice;
    u[54] = seed >>> 0;
    let flags = 0;
    if (v.acosApprox) flags |= 1;
    if (v.importanceSampling) flags |= 2;
    u[55] = flags >>> 0;
    d[56] = v.thickness;
    d[57] = v.marchWidthPx;
    d[58] = v.bias;
    u[59] = HEURISTIC_INDEX[v.heuristic] >>> 0;
    u[60] = METHOD_INDEX[v.method] >>> 0;
    d[61] = v.occluderThicknessScale;
    d[62] = v.occluderCosLimit;
    d[63] = v.distantIntensity;
    d[64] = v.ambientIntensity;
    d[65] = v.linearThickK;
    u[66] = v.bitsPerSector >>> 0;
    d[67] = v.envLod;
  }

  // Fence-based cost meter (methodology from M3/demo 03 README): submit N passes
  // back-to-back and await queue.onSubmittedWorkDone(). Exposed on window so a
  // headless run can time each method/heuristic. Call:
  //   await window.__lab08bench({ iters, method, heuristic })
  private installBench(ctx: HarnessContext): void {
    const device = getDevice(ctx.renderer);
    (window as unknown as Record<string, unknown>).__lab08bench = async (opts?: {
      iters?: number;
      method?: Method;
      heuristic?: Heuristic;
    }): Promise<number> => {
      const iters = opts?.iters ?? 200;
      const cam = ctx.scene.camera;
      const { width, height } = ctx.renderSize();
      const v = { ...this.params.values };
      if (opts?.method) v.method = opts.method;
      if (opts?.heuristic) v.heuristic = opts.heuristic;
      this.gbufferPipeline.render();
      // warmup
      this.fillUniform(cam, width, height, 0, v);
      this.pass.execute(this.accRT, [this.depthTex, this.normalTex, this.envTex, this.envSampler, this.data], {
        loadOp: 'clear',
        clearValue: { r: 0, g: 0, b: 0, a: 0 },
      });
      await device.queue.onSubmittedWorkDone();
      const t0 = performance.now();
      for (let i = 0; i < iters; i++) {
        this.fillUniform(cam, width, height, i, v);
        this.pass.execute(this.accRT, [this.depthTex, this.normalTex, this.envTex, this.envSampler, this.data], {
          loadOp: 'load',
        });
      }
      await device.queue.onSubmittedWorkDone();
      const ms = (performance.now() - t0) / iters;
      this.resetRequested = true;
      return ms;
    };
  }

  resize(ctx: HarnessContext): void {
    const { width, height } = ctx.renderSize();
    this.scenePass.setSize(width, height);
    this.accRT.setSize(width, height);
    ensureRenderTarget(ctx.renderer, this.accRT);
    this.resetRequested = true;
  }

  dispose(): void {
    this.accRT.dispose();
    this.envTex.dispose();
    delete (window as unknown as Record<string, unknown>).__lab08bench;
  }
}

export const distantLightDemo: DemoDef = {
  id: '08-distant-light',
  label: '08 — Distant Light + Thickness',
  create: () => new DistantLightDemo(),
};
