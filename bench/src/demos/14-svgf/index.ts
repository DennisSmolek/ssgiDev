import {
  DataTexture,
  FloatType,
  HalfFloatType,
  LinearFilter,
  LinearMipmapLinearFilter,
  MathUtils,
  Matrix4,
  NoColorSpace,
  RedFormat,
  RGBAFormat,
  RenderPipeline,
  RenderTarget,
  RepeatWrapping,
  StorageTexture,
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
  velocity,
} from 'three/tsl';
import { MomentsPass } from '@pmndrs/upscaler';
import type { DepthTexture, PerspectiveCamera, Texture, WebGPURenderer } from 'three/webgpu';
import type { Demo, DemoDef, HarnessContext } from '../../harness/types';
import { RawComputePass } from '../../harness/raw-compute-pass';
import { TemporalGuidesPass } from '../../harness/temporal-guides';
import { HALTON_JITTER, applyCameraJitter } from '../../harness/temporal';
import { ensureTexture, ensureRenderTarget, getGPUTexture } from '../../harness/three-internals';
import { Comparator } from '../../harness/compare';
import type { CompareMode } from '../../harness/compare';
import { buildParams } from '../../harness/params';
import type { ParamGroup } from '../../harness/params';
// Producer + spatial bilateral REUSED verbatim from demo 03 (the experimental
// control: identical noisy input signal for every arm, per SVGF-SPEC §4).
import mainWgsl from '../03-ssrt3/ssrt-main.wgsl?raw';
import ssrtDenoiseWgsl from '../03-ssrt3/ssrt-denoise.wgsl?raw';
// `ssrt3-guides` arm cloned wholesale from demo 10 (the incumbent to beat,
// SVGF-SPEC §4 arm 4) — same guides-fed temporal + bilateral wiring.
import ssrtGuidesTemporalWgsl from '../10-denoise/ssrt3-guides-temporal.wgsl?raw';
import mathisWgsl from '../10-denoise/denoise-mathis.wgsl?raw';
import accumulateWgsl from '../10-denoise/accumulate.wgsl?raw';
import blitWgsl from '../10-denoise/blit.wgsl?raw';
// New WGSL for this demo (SVGF-SPEC §7 file plan).
import demodulateWgsl from './svgf-demodulate.wgsl?raw';
import temporalMomentsWgsl from './svgf-temporal-moments.wgsl?raw';
import varianceWgsl from './svgf-variance.wgsl?raw';
import atrousWgsl from './svgf-atrous.wgsl?raw';
import remodulateWgsl from './svgf-remodulate.wgsl?raw';
import noiseInjectWgsl from './svgf-noiseinject.wgsl?raw';

// Demo 14 — SVGF lab (SVGF-SPEC.md). One FIXED noisy producer (demo 03's march
// at rc1/sc8, jitter on — identical to demo 10's control) feeds five
// A/B-comparable denoiser arms. The only genuinely new pass is the à-trous
// body (svgf-atrous.wgsl); everything else wires TemporalGuidesPass and
// MomentsPass (both consumed as a linked build of @pmndrs/upscaler) plus
// verbatim-reused demo 03/10 passes. See README.

/* eslint-disable @typescript-eslint/no-explicit-any */
type Node = any;

const STACKS = ['bilateral', 'svgf-lite', 'svgf', 'ssrt3-guides', 'mathis'] as const;
type Stack = (typeof STACKS)[number];

const VIEW_MODES = ['combined', 'gi', 'raw-gi', 'variance', 'moments', 'reference', 'split', 'diff'] as const;
type ViewMode = (typeof VIEW_MODES)[number];

type MomentsSpace = 'linear' | 'ycocg';

// Producer flags (mirror ssrt-main.wgsl): bitmask | jitter | gi. Deliberately
// noisy: rotationCount 1, stepCount 8, per-frame jitter — the experimental
// control, byte-identical to demo 10's PRODUCER_FLAGS.
const F_BITMASK = 1;
const F_JITTER = 2;
const F_GI = 512;
const PRODUCER_FLAGS = F_BITMASK | F_JITTER | F_GI;
const PROD_ROTATION = 1;
const PROD_STEP = 8;

const TEMPORAL_ROTATIONS = [60, 300, 180, 240, 120, 0];
const SPATIAL_OFFSETS = [0.0, 0.5, 0.25, 0.75];

function sceneDefaults(sceneId: string): { radius: number; thickness: number } {
  if (sceneId === 'sponza') return { radius: 8, thickness: 2 };
  if (sceneId === 'artifact-zoo') return { radius: 3, thickness: 0.3 };
  return { radius: 5, thickness: 0.5 }; // cornell
}

// --- procedural equirect ambient (producer fallback binding; fallback is OFF
// so it is never sampled, but the main-march binding layout requires it).
// Copied from demo 03/10 so the reused ssrt-main.wgsl binds cleanly. ---
const ENV_W = 64;
const ENV_H = 32;
const ENV_MIPS = Math.floor(Math.log2(Math.max(ENV_W, ENV_H))) + 1;
function makeEnv(sceneId: string): DataTexture {
  const data = new Uint8Array(ENV_W * ENV_H * 4);
  for (let y = 0; y < ENV_H; y++) {
    const vy = y / (ENV_H - 1);
    for (let x = 0; x < ENV_W; x++) {
      let r: number, g: number, b: number;
      if (sceneId === 'cornell') {
        r = 0.1; g = 0.11; b = 0.14;
      } else {
        const t = 1 - vy;
        r = 0.3 * t + 0.45 * (1 - t);
        g = 0.42 * t + 0.4 * (1 - t);
        b = 0.72 * t + 0.34 * (1 - t);
      }
      const i = (y * ENV_W + x) * 4;
      data[i] = Math.round(r * 255);
      data[i + 1] = Math.round(g * 255);
      data[i + 2] = Math.round(b * 255);
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

// r16float half-float decode (for the variance-readback sanity check —
// SVGF-SPEC §6 risk guard: Var = E[x^2] - E[x]^2 must hold up numerically).
function halfToFloat(h: number): number {
  const sign = h & 0x8000 ? -1 : 1;
  const exponent = (h >> 10) & 0x1f;
  const fraction = h & 0x3ff;
  if (exponent === 0) return sign * fraction * Math.pow(2, -24);
  if (exponent === 0x1f) return fraction ? NaN : sign * Infinity;
  return sign * (1 + fraction / 1024) * Math.pow(2, exponent - 15);
}

// Uniform sizes (floats).
const U_FLOATS = 72; // producer (demo 03 layout)
const BIL_FLOATS = 8; // ssrt-denoise DParams
const GT_FLOATS = 40; // ssrt3-guides-temporal TParams (layout parity w/ demo 10)
const MATHIS_FLOATS = 24;
const ACC_FLOATS = 4;
const NOISE_FLOATS = 8;
const DEMOD_FLOATS = 4;
const TM_FLOATS = 8;
const VAR_FLOATS = 4;
const ATROUS_FLOATS = 8;
const REMOD_FLOATS = 4;

const schema = {
  stack: { type: 'enum', value: 'svgf' as Stack, options: STACKS, label: 'denoiser arm' },
  viewMode: { type: 'enum', value: 'combined' as ViewMode, options: VIEW_MODES, label: 'view' },
  giExposure: { type: 'number', value: 1, min: 0.1, max: 8, step: 0.05, label: 'GI display gain' },
  varianceAmp: { type: 'number', value: 20, min: 1, max: 200, step: 1, label: 'variance/moments view gain', group: 'svgf' },
  // --- svgf / svgf-lite pipeline ---
  atrousIterations: { type: 'number', value: 4, min: 1, max: 8, step: 1, label: 'atrousIterations K (svgf only)', group: 'svgf' },
  sigmaLum: { type: 'number', value: 4, min: 0.1, max: 20, step: 0.1, label: 'sigmaLum', group: 'svgf' },
  sigmaDepth: { type: 'number', value: 0.05, min: 0.005, max: 0.5, step: 0.005, label: 'sigmaDepth', group: 'svgf' },
  sigmaNormal: { type: 'number', value: 32, min: 1, max: 128, step: 1, label: 'sigmaNormal', group: 'svgf' },
  alphaMin: { type: 'number', value: 0.05, min: 0.01, max: 1, step: 0.01, label: 'alphaMin', group: 'svgf' },
  nMinForTemporalVar: { type: 'number', value: 4, min: 1, max: 32, step: 1, label: 'nMinForTemporalVar', group: 'svgf' },
  varianceBoostFromReactive: {
    type: 'number', value: 0, min: 0, max: 4, step: 0.1, group: 'svgf',
    label: 'varianceBoostFromReactive',
    hint: 'wired via guides.reactiveTexture; inert today since nothing writes into it (see README)',
  },
  momentsSpace: { type: 'enum', value: 'ycocg' as MomentsSpace, options: ['linear', 'ycocg'], label: 'momentsSpace', group: 'svgf' },
  atrousFeedback: {
    type: 'boolean', value: true, group: 'svgf',
    label: 'atrousFeedback (§8.2)',
    hint: 'true = feed à-trous iteration-0 output back as next-frame history (paper convention); false = feed the raw temporal-moments result',
  },
  demodEpsilon: { type: 'number', value: 0.05, min: 0.001, max: 0.5, step: 0.001, label: 'demodEpsilon', group: 'svgf' },
  historyRejectThresh: { type: 'number', value: 0.5, min: 0.05, max: 1, step: 0.01, label: 'historyRejectThresh', group: 'svgf' },
  // --- noiseinject mode (SVGF-SPEC §5 pre-validator) ---
  noiseInject: { type: 'boolean', value: false, group: 'noiseinject', label: 'noiseinject enabled' },
  noiseSigma: { type: 'number', value: 0.15, min: 0, max: 2, step: 0.01, group: 'noiseinject', label: 'noiseSigma' },
  fireflyRate: { type: 'number', value: 0, min: 0, max: 0.05, step: 0.001, group: 'noiseinject', label: 'fireflyRate' },
  // --- shared guides (svgf/svgf-lite/ssrt3-guides) ---
  guidesDisoccLo: { type: 'number', value: 0.02, min: 0, max: 0.5, step: 0.005, group: 'guides', label: 'guides disocc lo' },
  guidesDisoccHi: { type: 'number', value: 0.1, min: 0.01, max: 1, step: 0.005, group: 'guides', label: 'guides disocc hi' },
  guidesResetThresh: { type: 'number', value: 0.5, min: 0.05, max: 1, step: 0.01, group: 'guides', label: 'guides N-reset disocc' },
  guidesHistoryCap: { type: 'number', value: 64, min: 4, max: 256, step: 1, group: 'guides', label: 'guides history cap' },
  // --- bilateral stage (bilateral arm + ssrt3-guides arm share this) ---
  denoisingRadius: { type: 'number', value: 0.5, min: 0, max: 1, step: 0.01, group: 'bilateral', label: 'bilateral denoisingRadius' },
  temporalResponse: { type: 'number', value: 0.35, min: 0, max: 1, step: 0.01, group: 'bilateral', label: 'ssrt3-guides temporalResponse' },
  // --- mathis arm ---
  mathisCap: { type: 'number', value: 64, min: 4, max: 256, step: 1, group: 'mathis', label: 'mathis accum cap' },
  mathisBilateral: { type: 'number', value: 1, min: 0.5, max: 3, step: 0.1, group: 'mathis', label: 'mathis bilateral' },
  mathisDepthThresh: { type: 'number', value: 0.1, min: 0.01, max: 0.5, step: 0.01, group: 'mathis', label: 'mathis reproj rej' },
  // --- comparator (split/diff view: active arm vs converged reference) ---
  diffAmp: { type: 'number', value: 8, min: 1, max: 50, step: 0.5, label: 'diff amp' },
} as const;

const REBUILD_KEYS = new Set(['stack', 'viewMode', 'noiseInject']);
const RESET_KEYS = new Set(['stack', 'noiseInject', 'momentsSpace']);

class SvgfLabDemo implements Demo {
  private beautyTex!: Texture;
  private albedoTex!: Texture;
  private normalTex!: Texture;
  private velocityTex!: Texture;
  private depthTex!: DepthTexture;

  private scenePass!: ReturnType<typeof pass>;
  private gbufferPipeline!: RenderPipeline;
  private displayPipeline!: RenderPipeline;

  // Producer output (rgb = GI, a = AO), stable.
  private giAoTex = this.makeRgba();
  // noiseinject output (stable) — the alternate "raw" input when enabled.
  private noisyTex = this.makeRgba();
  // Converged reference (accumulate.wgsl running mean of the live producer —
  // the SAME oracle every arm scores against, and the noiseinject source).
  private refA = this.makeRgba();
  private refB = this.makeRgba();
  private refOut = this.makeRgba();

  // bilateral arm.
  private bilateralFinal = this.makeRgba();
  // ssrt3-guides arm.
  private guidesHistA = this.makeRgba();
  private guidesHistB = this.makeRgba();
  private guidesFinal = this.makeRgba();
  // mathis arm.
  private mathisColorA = this.makeRgba();
  private mathisColorB = this.makeRgba();
  private mathisCountA = this.makeScalar();
  private mathisCountB = this.makeScalar();
  private mathisFinal = this.makeRgba();
  // svgf / svgf-lite pipeline.
  private irrAoTex = this.makeRgba(); // demodulated (irr, ao), this frame
  private tmColorA = this.makeRgba();
  private tmColorB = this.makeRgba();
  private tmMomentsA = this.makeRgba(); // .rg = E[x], E[x^2]
  private tmMomentsB = this.makeRgba();
  private feedbackColorA = this.makeRgba(); // à-trous iteration-0 history feedback
  private feedbackColorB = this.makeRgba();
  private varianceTex = this.makeHalfScalar(); // r16float, this frame's Var
  private atrousColorA = this.makeRgba();
  private atrousColorB = this.makeRgba();
  private atrousVarA = this.makeHalfScalar();
  private atrousVarB = this.makeHalfScalar();
  private svgfFinal = this.makeRgba();

  // Producer fallback bindings (unused: fallback off).
  private depthPyramid = this.makePyramid();
  private envSampler!: GPUSampler;
  private envTex!: DataTexture;
  // Comparator target.
  private compareRT = this.makeRT();

  private main!: RawComputePass;
  private accumulate!: RawComputePass;
  private noiseInjectPass!: RawComputePass;
  private bilateralPass!: RawComputePass; // ssrt-denoise.wgsl, shared by bilateral + ssrt3-guides arms
  private guidesTemporalPass!: RawComputePass;
  private guides!: TemporalGuidesPass;
  private mathisPass!: RawComputePass;
  private demodulatePass!: RawComputePass;
  private temporalMomentsPass!: RawComputePass;
  private variancePass!: RawComputePass;
  private atrousPass!: RawComputePass;
  private remodulatePass!: RawComputePass;
  private blit!: RawComputePass;
  private comparator!: Comparator;
  private momentsPass!: MomentsPass;

  private mainData = new Float32Array(U_FLOATS);
  private mainU32 = new Uint32Array(this.mainData.buffer);
  private bdData = new Float32Array(BIL_FLOATS);
  private bdU32 = new Uint32Array(this.bdData.buffer);
  private gtData = new Float32Array(GT_FLOATS);
  private gtU32 = new Uint32Array(this.gtData.buffer);
  private mData = new Float32Array(MATHIS_FLOATS);
  private mU32 = new Uint32Array(this.mData.buffer);
  private accData = new Float32Array(ACC_FLOATS);
  private accU32 = new Uint32Array(this.accData.buffer);
  private noiseData = new Float32Array(NOISE_FLOATS);
  private noiseU32 = new Uint32Array(this.noiseData.buffer);
  private demodData = new Float32Array(DEMOD_FLOATS);
  private tmData = new Float32Array(TM_FLOATS);
  private tmU32 = new Uint32Array(this.tmData.buffer);
  private varData = new Float32Array(VAR_FLOATS);
  private atrousData = new Float32Array(ATROUS_FLOATS);
  private remodData = new Float32Array(REMOD_FLOATS);

  private invViewProj = new Matrix4();
  private prevInvViewProj = new Matrix4();
  private ping = true;
  private device!: GPUDevice;
  private renderer!: WebGPURenderer;
  private frameCounter = 0;
  private accumCount = 0;
  private jitterIndex = 0;
  private reset = true;
  private lastPose = new Float64Array(8);
  private lastW = 1;
  private lastH = 1;
  private sceneId = 'cornell';

  private uGiExposure = uniform(1);
  private uVarianceAmp = uniform(20);
  private camera!: PerspectiveCamera;

  private params!: ParamGroup<typeof schema>;
  private compareState = { splitX: 0.5 };
  private dragging = false;
  private pointerHandlers: Array<[keyof HTMLElementEventMap, EventListener]> = [];
  private momentsSpace: MomentsSpace = 'ycocg';

  private makeRgba(): StorageTexture {
    const t = new StorageTexture(1, 1);
    t.type = HalfFloatType;
    t.format = RGBAFormat;
    t.colorSpace = NoColorSpace;
    t.generateMipmaps = false;
    return t;
  }
  private makeScalar(): StorageTexture {
    const t = new StorageTexture(1, 1);
    t.type = FloatType;
    t.format = RedFormat;
    t.colorSpace = NoColorSpace;
    t.generateMipmaps = false;
    return t;
  }
  // r16float — texture-formats-tier1 storage format (temporal-guides.ts's
  // disocclusion/historyLength textures already rely on this same tier).
  private makeHalfScalar(): StorageTexture {
    const t = new StorageTexture(1, 1);
    t.type = HalfFloatType;
    t.format = RedFormat;
    t.colorSpace = NoColorSpace;
    t.generateMipmaps = false;
    return t;
  }
  private makePyramid(): StorageTexture {
    const t = new StorageTexture(1, 1);
    t.type = FloatType;
    t.format = RedFormat;
    t.colorSpace = NoColorSpace;
    t.generateMipmaps = true;
    return t;
  }
  private makeRT(): RenderTarget {
    const rt = new RenderTarget(1, 1, { type: HalfFloatType, depthBuffer: false });
    rt.texture.colorSpace = NoColorSpace;
    return rt;
  }

  init(ctx: HarnessContext): void {
    this.sceneId = new URLSearchParams(window.location.search).get('scene') ?? 'cornell';
    this.device = ctx.device;
    this.renderer = ctx.renderer;
    this.camera = ctx.scene.camera;

    this.scenePass = pass(ctx.scene.scene, this.camera);
    this.scenePass.setMRT(mrt({ output, albedo: diffuseColor, normal: normalView, velocity }));
    this.beautyTex = this.scenePass.getTexture('output');
    this.albedoTex = this.scenePass.getTexture('albedo');
    this.normalTex = this.scenePass.getTexture('normal');
    this.velocityTex = this.scenePass.getTexture('velocity');
    this.scenePass.getTexture('albedo').type = UnsignedByteType;
    this.depthTex = this.scenePass.renderTarget.depthTexture!;

    this.gbufferPipeline = new RenderPipeline(ctx.renderer, this.scenePass);
    this.displayPipeline = new RenderPipeline(ctx.renderer);

    this.envSampler = ctx.device.createSampler({
      magFilter: 'linear', minFilter: 'linear', mipmapFilter: 'linear',
      addressModeU: 'repeat', addressModeV: 'clamp-to-edge',
    });
    this.envTex = makeEnv(this.sceneId);
    ensureTexture(ctx.renderer, this.envTex);

    // --- Producer (reused ssrt-main.wgsl): depth, normal, light(=beauty; no
    // multibounce), env, sampler, depth-pyramid(unused), out, uniform. ---
    this.main = new RawComputePass(ctx.renderer, 'd14-main', mainWgsl, {
      bindings: [
        { kind: 'depth' }, { kind: 'tex' }, { kind: 'tex' }, { kind: 'sampledTex' },
        { kind: 'sampler', filtering: true }, { kind: 'tex' },
        { kind: 'storage', format: 'rgba16float' }, { kind: 'uniform' },
      ],
    });
    // Converged reference (oracle + noiseinject source).
    this.accumulate = new RawComputePass(ctx.renderer, 'd14-accum', accumulateWgsl, {
      bindings: [
        { kind: 'tex' }, { kind: 'tex' },
        { kind: 'storage', format: 'rgba16float' }, { kind: 'uniform' },
      ],
    });
    this.blit = new RawComputePass(ctx.renderer, 'd14-blit', blitWgsl, {
      bindings: [{ kind: 'tex' }, { kind: 'storage', format: 'rgba16float' }],
    });
    // noiseinject (SVGF-SPEC §5 pre-validator).
    this.noiseInjectPass = new RawComputePass(ctx.renderer, 'd14-noiseinject', noiseInjectWgsl, {
      bindings: [
        { kind: 'tex' }, { kind: 'storage', format: 'rgba16float' }, { kind: 'uniform' },
      ],
    });
    // bilateral (demo 03 ssrt-denoise.wgsl live import) — shared by the
    // `bilateral` arm (spatial-only) and the `ssrt3-guides` arm's spatial stage.
    this.bilateralPass = new RawComputePass(ctx.renderer, 'd14-bilateral', ssrtDenoiseWgsl, {
      bindings: [
        { kind: 'tex' }, { kind: 'depth' }, { kind: 'tex' },
        { kind: 'storage', format: 'rgba16float' }, { kind: 'uniform' },
      ],
    });
    // ssrt3-guides arm: shared TemporalGuidesPass + demo 10's guides-fed
    // temporal fork, cloned wholesale (SVGF-SPEC scope: "the incumbent to beat").
    this.guides = new TemporalGuidesPass(ctx.renderer, 'd14-guides');
    this.guidesTemporalPass = new RawComputePass(ctx.renderer, 'd14-ssrt-guides-temporal', ssrtGuidesTemporalWgsl, {
      bindings: [
        { kind: 'tex' }, { kind: 'tex' }, { kind: 'tex' }, { kind: 'tex' },
        { kind: 'storage', format: 'rgba16float' }, { kind: 'uniform' },
      ],
    });
    // mathis arm (cloned from demo 10).
    this.mathisPass = new RawComputePass(ctx.renderer, 'd14-mathis', mathisWgsl, {
      bindings: [
        { kind: 'tex' }, { kind: 'tex' }, { kind: 'tex' }, { kind: 'depth' },
        { kind: 'tex' }, { kind: 'tex' },
        { kind: 'storage', format: 'rgba16float' }, { kind: 'storage', format: 'r32float' },
        { kind: 'uniform' },
      ],
    });
    // svgf / svgf-lite pipeline.
    this.demodulatePass = new RawComputePass(ctx.renderer, 'd14-demodulate', demodulateWgsl, {
      bindings: [
        { kind: 'tex' }, { kind: 'tex' },
        { kind: 'storage', format: 'rgba16float' }, { kind: 'uniform' },
      ],
    });
    this.temporalMomentsPass = new RawComputePass(ctx.renderer, 'd14-temporal-moments', temporalMomentsWgsl, {
      bindings: [
        { kind: 'tex' }, { kind: 'tex' }, { kind: 'tex' }, { kind: 'tex' }, { kind: 'tex' }, { kind: 'tex' },
        { kind: 'storage', format: 'rgba16float' }, { kind: 'storage', format: 'rgba16float' },
        { kind: 'uniform' },
      ],
    });
    this.variancePass = new RawComputePass(ctx.renderer, 'd14-variance', varianceWgsl, {
      bindings: [
        { kind: 'tex' }, { kind: 'tex' }, { kind: 'tex' }, { kind: 'tex' },
        { kind: 'storage', format: 'r16float' }, { kind: 'uniform' },
      ],
    });
    this.atrousPass = new RawComputePass(ctx.renderer, 'd14-atrous', atrousWgsl, {
      bindings: [
        { kind: 'tex' }, { kind: 'tex' }, { kind: 'depth' }, { kind: 'tex' },
        { kind: 'storage', format: 'rgba16float' }, { kind: 'storage', format: 'r16float' },
        { kind: 'uniform' },
      ],
    });
    this.remodulatePass = new RawComputePass(ctx.renderer, 'd14-remodulate', remodulateWgsl, {
      bindings: [
        { kind: 'tex' }, { kind: 'tex' },
        { kind: 'storage', format: 'rgba16float' }, { kind: 'uniform' },
      ],
    });
    this.momentsPass = new MomentsPass({ renderer: ctx.renderer });
    this.comparator = new Comparator(ctx.renderer, 'd14-compare');

    this.resize(ctx);
    this.main.configure(this.mainData.byteLength);
    this.accumulate.configure(this.accData.byteLength);
    this.blit.configure(0);
    this.noiseInjectPass.configure(this.noiseData.byteLength);
    this.bilateralPass.configure(this.bdData.byteLength);
    this.guides.configure();
    this.guidesTemporalPass.configure(this.gtData.byteLength);
    this.mathisPass.configure(this.mData.byteLength);
    this.demodulatePass.configure(this.demodData.byteLength);
    this.temporalMomentsPass.configure(this.tmData.byteLength);
    this.variancePass.configure(this.varData.byteLength);
    this.atrousPass.configure(this.atrousData.byteLength);
    this.remodulatePass.configure(this.remodData.byteLength);
    this.comparator.configure(this.compareRT);

    const folder = ctx.pane.addFolder({ title: 'Demo 14 — SVGF lab' });
    this.params = buildParams(folder, schema);
    this.params.onChange((key) => {
      if (REBUILD_KEYS.has(key as string)) this.updateOutputNode();
      if (RESET_KEYS.has(key as string)) this.reset = true;
      if (key === 'momentsSpace') this.reconfigureMoments();
    });

    // URL overrides for deterministic captures.
    const q = new URLSearchParams(window.location.search);
    const urlStack = q.get('stack');
    if (urlStack && (STACKS as readonly string[]).includes(urlStack)) this.params.values.stack = urlStack as Stack;
    const urlView = q.get('view');
    if (urlView && (VIEW_MODES as readonly string[]).includes(urlView)) this.params.values.viewMode = urlView as ViewMode;
    const urlNoiseInject = q.get('noiseinject');
    if (urlNoiseInject === '0' || urlNoiseInject === '1') this.params.values.noiseInject = urlNoiseInject === '1';
    this.params.refresh();

    this.momentsSpace = this.params.values.momentsSpace;
    this.updateOutputNode();
    this.installDividerDrag(ctx);

    (window as unknown as { __svgf14bench?: (n: number) => Promise<number> }).__svgf14bench = (n: number) =>
      this.runBench(n);
    (window as unknown as { __svgf14VarianceStats?: () => Promise<{ min: number; max: number; mean: number; count: number }> })
      .__svgf14VarianceStats = () => this.readVarianceStats();
  }

  private reconfigureMoments(): void {
    this.momentsSpace = this.params.values.momentsSpace;
    this.momentsPass.configure({ width: this.lastW, height: this.lastH, space: this.momentsSpace });
  }

  // The active arm's denoised GI/AO as a TSL vec4 node.
  private activeGiAoNode(stack: Stack): Node {
    const uv = screenUV;
    switch (stack) {
      case 'bilateral':
        return texture(this.bilateralFinal, uv);
      case 'svgf-lite':
      case 'svgf':
        return texture(this.svgfFinal, uv);
      case 'ssrt3-guides':
        return texture(this.guidesFinal, uv);
      case 'mathis':
        return texture(this.mathisFinal, uv);
    }
  }

  private updateOutputNode(): void {
    const v = this.params.values;
    const uv = screenUV;
    this.displayPipeline.needsUpdate = true;

    if (v.viewMode === 'split' || v.viewMode === 'diff') {
      this.displayPipeline.outputNode = vec4(texture(this.compareRT.texture, uv).rgb, float(1));
      return;
    }
    if (v.viewMode === 'reference') {
      this.displayPipeline.outputNode = vec4(texture(this.refOut, uv).rgb.mul(this.uGiExposure), float(1));
      return;
    }
    if (v.viewMode === 'raw-gi') {
      const rawSrc = v.noiseInject ? this.noisyTex : this.giAoTex;
      this.displayPipeline.outputNode = vec4(texture(rawSrc, uv).rgb.mul(this.uGiExposure), float(1));
      return;
    }
    if (v.viewMode === 'variance') {
      const sig = texture(this.varianceTex, uv).r.max(0).sqrt().mul(this.uVarianceAmp).clamp(0, 1);
      this.displayPipeline.outputNode = vec4(vec3(sig), float(1));
      return;
    }
    if (v.viewMode === 'moments') {
      // R = mean irradiance luminance (E[x]), G = sqrt(Var) amplified,
      // B = historyLength/cap — a moments-pipeline debug view (demo 10's
      // `guides` view convention: pack three diagnostics into RGB).
      const tmMomentsCur = this.ping ? this.tmMomentsA : this.tmMomentsB;
      const meanE = texture(tmMomentsCur, uv).r.clamp(0, 1);
      const sig = texture(this.varianceTex, uv).r.max(0).sqrt().mul(this.uVarianceAmp).clamp(0, 1);
      const histN = texture(this.guides.historyLengthTexture, uv).r.div(64).clamp(0, 1);
      this.displayPipeline.outputNode = vec4(meanE, sig, histN, float(1));
      return;
    }

    const giao = this.activeGiAoNode(v.stack);
    const ao = giao.a;
    const gi = giao.rgb.mul(this.uGiExposure);
    if (v.viewMode === 'gi') {
      this.displayPipeline.outputNode = vec4(gi, float(1));
      return;
    }
    // combined: beauty * AO + albedo * GI (demo-03/10 composite convention).
    const beauty = texture(this.beautyTex, uv).rgb;
    const albedo = texture(this.albedoTex, uv).rgb;
    this.displayPipeline.outputNode = vec4(beauty.mul(vec3(ao)).add(albedo.mul(gi)), float(1));
  }

  private applyJitter(w: number, h: number): void {
    const [jx, jy] = HALTON_JITTER[this.jitterIndex];
    this.jitterIndex = (this.jitterIndex + 1) % HALTON_JITTER.length;
    applyCameraJitter(this.camera, w, h, jx, jy);
  }

  private cameraMoved(): boolean {
    const EPS = 2e-4;
    const p = this.camera.position;
    const q = this.camera.quaternion;
    const fovHash = this.camera.fov * 1000 + this.camera.aspect;
    const changed =
      Math.abs(this.lastPose[0] - p.x) > EPS || Math.abs(this.lastPose[1] - p.y) > EPS ||
      Math.abs(this.lastPose[2] - p.z) > EPS || Math.abs(this.lastPose[3] - q.x) > EPS ||
      Math.abs(this.lastPose[4] - q.y) > EPS || Math.abs(this.lastPose[5] - q.z) > EPS ||
      Math.abs(this.lastPose[6] - q.w) > EPS || Math.abs(this.lastPose[7] - fovHash) > EPS;
    this.lastPose.set([p.x, p.y, p.z, q.x, q.y, q.z, q.w, fovHash]);
    return changed;
  }

  frame(ctx: HarnessContext, _dt: number): void {
    const cam = this.camera;
    this.frameCounter++;
    this.uGiExposure.value = this.params.values.giExposure;
    this.uVarianceAmp.value = this.params.values.varianceAmp;
    const { width, height } = ctx.renderSize();
    const v = this.params.values;

    // 0. Sub-pixel jitter before the G-buffer rasterizes (producer FIXED-on,
    // per PRODUCER_FLAGS — matches demo 10's control).
    this.applyJitter(width, height);

    // 1. G-buffer.
    this.gbufferPipeline.render();

    // 2. Producer (fixed noisy) -> giAoTex.
    this.fillProducerUniform(cam, width, height);
    this.main.execute(
      [this.depthTex, this.normalTex, this.beautyTex, this.envTex, this.envSampler, this.depthPyramid, this.giAoTex, this.mainData],
      width, height,
    );

    // 3. Reset detection.
    const moved = this.cameraMoved();
    const reset = moved || this.reset || this.frameCounter < 2 ? 1 : 0;

    // 4. Converged reference (always — oracle + noiseinject source + split/diff).
    this.invViewProj.multiplyMatrices(cam.matrixWorld, cam.projectionMatrixInverse);
    if (reset) this.accumCount = 0;
    const accRead = this.ping ? this.refB : this.refA;
    const accWrite = this.ping ? this.refA : this.refB;
    this.accData[0] = width; this.accData[1] = height;
    this.accData[2] = this.accumCount;
    this.accU32[3] = reset;
    this.accumulate.execute([this.giAoTex, accRead, accWrite, this.accData], width, height);
    this.blit.execute([accWrite, this.refOut], width, height);

    // 5. noiseinject: synthesize a variance-scaled-noise input from the
    // (exact-ground-truth) reference — SVGF-SPEC §5 pre-validator.
    if (v.noiseInject) {
      this.noiseData[0] = width; this.noiseData[1] = height;
      this.noiseData[2] = v.noiseSigma; this.noiseData[3] = v.fireflyRate;
      this.noiseU32[4] = this.frameCounter >>> 0;
      this.noiseU32[5] = 1;
      this.noiseInjectPass.execute([this.refOut, this.noisyTex, this.noiseData], width, height);
    }
    const rawInput = v.noiseInject ? this.noisyTex : this.giAoTex;

    // 6. Guides (lazy, like ReferencePass): needed by svgf/svgf-lite AND
    // ssrt3-guides, plus the variance/moments debug views.
    const needSvgfPipeline = v.stack === 'svgf' || v.stack === 'svgf-lite' || v.viewMode === 'variance' || v.viewMode === 'moments';
    const needGuides = needSvgfPipeline || v.stack === 'ssrt3-guides';
    if (needGuides) {
      this.guides.update(
        cam,
        { depth: this.depthTex, velocity: this.velocityTex },
        {
          reset: reset !== 0,
          disoccLo: v.guidesDisoccLo,
          disoccHi: v.guidesDisoccHi,
          disoccResetThreshold: v.guidesResetThresh,
          historyCap: v.guidesHistoryCap,
          closestIsMin: true,
        },
      );
    }

    // 7. Active arm.
    this.runStack(v.stack, needSvgfPipeline, cam, rawInput, width, height, reset);

    // 8. Split/diff: active arm output vs converged reference.
    if (v.viewMode === 'split' || v.viewMode === 'diff') {
      const aTex = this.activeArmFinalTexture(v.stack);
      this.comparator.execute(this.compareRT, aTex, this.refOut, width, height, {
        mode: v.viewMode as CompareMode, splitX: this.compareState.splitX, amp: v.diffAmp,
        scaleA: v.giExposure, scaleB: v.giExposure, channel: 'rgb',
      });
    }

    // 9. Display.
    this.displayPipeline.render();
    ctx.timing.sampleGPU(ctx.renderer);

    // 10. Advance state.
    this.prevInvViewProj.copy(this.invViewProj);
    this.ping = !this.ping;
    if (!reset) this.accumCount = Math.min(4096, this.accumCount + 1);
    this.reset = false;
    this.lastW = width;
    this.lastH = height;
  }

  private activeArmFinalTexture(stack: Stack): Texture {
    switch (stack) {
      case 'bilateral': return this.bilateralFinal;
      case 'svgf-lite':
      case 'svgf': return this.svgfFinal;
      case 'ssrt3-guides': return this.guidesFinal;
      case 'mathis': return this.mathisFinal;
    }
  }

  private runStack(
    stack: Stack,
    needSvgfPipeline: boolean,
    cam: PerspectiveCamera,
    rawInput: Texture,
    width: number,
    height: number,
    reset: number,
  ): void {
    const v = this.params.values;

    if (stack === 'bilateral') {
      this.bdData[0] = width; this.bdData[1] = height; this.bdData[2] = cam.near; this.bdData[3] = cam.far;
      this.bdData[4] = v.denoisingRadius; this.bdU32[5] = 1; this.bdData[6] = 0; this.bdData[7] = 0;
      this.bilateralPass.execute([rawInput, this.depthTex, this.normalTex, this.bilateralFinal, this.bdData], width, height);
    } else if (stack === 'ssrt3-guides') {
      const histRead = this.ping ? this.guidesHistB : this.guidesHistA;
      const histWrite = this.ping ? this.guidesHistA : this.guidesHistB;
      this.gtData.set(this.invViewProj.elements, 0);
      this.gtData.set(this.prevInvViewProj.elements, 16);
      this.gtData[32] = width; this.gtData[33] = height; this.gtData[34] = cam.near; this.gtData[35] = cam.far;
      this.gtData[36] = v.temporalResponse;
      let tflags = 1; // enabled
      if (reset) tflags |= 2;
      this.gtU32[37] = tflags; this.gtData[38] = 0; this.gtData[39] = 0;
      this.guidesTemporalPass.execute(
        [rawInput, histRead, this.guides.dilatedVelocityTexture, this.guides.disocclusionTexture, histWrite, this.gtData],
        width, height,
      );
      this.bdData[0] = width; this.bdData[1] = height; this.bdData[2] = cam.near; this.bdData[3] = cam.far;
      this.bdData[4] = v.denoisingRadius; this.bdU32[5] = 1; this.bdData[6] = 0; this.bdData[7] = 0;
      this.bilateralPass.execute([histWrite, this.depthTex, this.normalTex, this.guidesFinal, this.bdData], width, height);
    } else if (stack === 'mathis') {
      const colorRead = this.ping ? this.mathisColorB : this.mathisColorA;
      const colorWrite = this.ping ? this.mathisColorA : this.mathisColorB;
      const countRead = this.ping ? this.mathisCountB : this.mathisCountA;
      const countWrite = this.ping ? this.mathisCountA : this.mathisCountB;
      this.mData.set(cam.projectionMatrixInverse.elements, 0);
      this.mData[16] = width; this.mData[17] = height; this.mData[18] = cam.near; this.mData[19] = cam.far;
      this.mU32[20] = reset; this.mU32[21] = v.mathisCap;
      this.mData[22] = v.mathisBilateral; this.mData[23] = v.mathisDepthThresh;
      this.mathisPass.execute(
        [rawInput, colorRead, countRead, this.depthTex, this.normalTex, this.velocityTex, colorWrite, countWrite, this.mData],
        width, height,
      );
      this.blit.execute([colorWrite, this.mathisFinal], width, height);
    }

    // svgf / svgf-lite share the same front-end pipeline (demodulate ->
    // temporal-moments -> variance -> à-trous -> remodulate); svgf-lite just
    // forces K=1 (SVGF-SPEC §3 fallback: single-pass bilateral + √Var term).
    if (needSvgfPipeline) this.runSvgfPipeline(stack, width, height, reset);
  }

  private runSvgfPipeline(stack: Stack, width: number, height: number, reset: number): void {
    const v = this.params.values;
    const rawInput = v.noiseInject ? this.noisyTex : this.giAoTex;

    // 1. Demodulate.
    this.demodData[0] = width; this.demodData[1] = height;
    this.demodData[2] = v.demodEpsilon; this.demodData[3] = 0;
    this.demodulatePass.execute([rawInput, this.albedoTex, this.irrAoTex, this.demodData], width, height);

    // 2. Temporal + moments. History colour source depends on atrousFeedback
    // (SVGF-SPEC §8.2): the paper convention feeds back last frame's à-trous
    // iteration-0 output instead of the raw (pre-filter) temporal result.
    const tmColorRead = this.ping ? this.tmColorB : this.tmColorA;
    const tmColorWrite = this.ping ? this.tmColorA : this.tmColorB;
    const tmMomentsRead = this.ping ? this.tmMomentsB : this.tmMomentsA;
    const tmMomentsWrite = this.ping ? this.tmMomentsA : this.tmMomentsB;
    const feedbackColorRead = this.ping ? this.feedbackColorB : this.feedbackColorA;
    const feedbackColorWrite = this.ping ? this.feedbackColorA : this.feedbackColorB;
    const histColorSource = v.atrousFeedback ? feedbackColorRead : tmColorRead;

    this.tmData[0] = width; this.tmData[1] = height;
    this.tmData[2] = v.alphaMin; this.tmData[3] = v.historyRejectThresh;
    let tmFlags = 1; // enabled
    if (reset) tmFlags |= 2;
    if (v.momentsSpace === 'ycocg') tmFlags |= 4;
    this.tmU32[4] = tmFlags; this.tmData[5] = 0; this.tmData[6] = 0; this.tmData[7] = 0;
    this.temporalMomentsPass.execute(
      [
        this.irrAoTex, histColorSource, tmMomentsRead,
        this.guides.dilatedVelocityTexture, this.guides.disocclusionTexture, this.guides.historyLengthTexture,
        tmColorWrite, tmMomentsWrite, this.tmData,
      ],
      width, height,
    );

    // 3. Spatial-moments fallback primitive (FSR3 MomentsPass, addendum §B),
    // driven on the demodulated irradiance (current frame, pre-temporal).
    this.momentsPass.dispatch({ source: this.irrAoTex });

    // 4. Variance estimate.
    this.varData[0] = width; this.varData[1] = height;
    this.varData[2] = v.nMinForTemporalVar; this.varData[3] = v.varianceBoostFromReactive;
    this.variancePass.execute(
      [tmMomentsWrite, this.guides.historyLengthTexture, this.momentsPass.coarseMoments, this.guides.reactiveTexture, this.varianceTex, this.varData],
      width, height,
    );

    // 5. à-trous ×K (svgf) or ×1 (svgf-lite).
    const K = stack === 'svgf-lite' ? 1 : Math.max(1, Math.round(v.atrousIterations));
    let srcColor: Texture = tmColorWrite;
    let srcVar: Texture = this.varianceTex;
    let dstColor: Texture = this.atrousColorA;
    let dstVar: Texture = this.atrousVarA;
    for (let i = 0; i < K; i++) {
      dstColor = i % 2 === 0 ? this.atrousColorA : this.atrousColorB;
      dstVar = i % 2 === 0 ? this.atrousVarA : this.atrousVarB;
      this.atrousData[0] = width; this.atrousData[1] = height;
      this.atrousData[2] = this.camera.near; this.atrousData[3] = this.camera.far;
      this.atrousData[4] = 2 ** i; // stride 1,2,4,8,...
      this.atrousData[5] = v.sigmaLum; this.atrousData[6] = v.sigmaDepth; this.atrousData[7] = v.sigmaNormal;
      this.atrousPass.execute([srcColor, srcVar, this.depthTex, this.normalTex, dstColor, dstVar, this.atrousData], width, height);
      if (i === 0) {
        // Capture iteration-0 output for next frame's history feedback,
        // regardless of the current atrousFeedback setting (so toggling it
        // doesn't leave stale data behind).
        this.blit.execute([dstColor, feedbackColorWrite], width, height);
      }
      srcColor = dstColor;
      srcVar = dstVar;
    }

    // 6. Remodulate.
    this.remodData[0] = width; this.remodData[1] = height; this.remodData[2] = 0; this.remodData[3] = 0;
    this.remodulatePass.execute([dstColor, this.albedoTex, this.svgfFinal, this.remodData], width, height);
  }

  private fillProducerUniform(cam: PerspectiveCamera, width: number, height: number): void {
    const d = this.mainData;
    const u = this.mainU32;
    d.set(cam.projectionMatrix.elements, 0);
    d.set(cam.projectionMatrixInverse.elements, 16);
    d.set(cam.matrixWorld.elements, 32);
    d[48] = width; d[49] = height; d[50] = cam.near; d[51] = cam.far;
    const def = sceneDefaults(this.sceneId);
    d[52] = def.radius; d[53] = def.thickness; d[54] = 1; // expFactor
    d[55] = (height / (Math.tan(cam.fov * MathUtils.DEG2RAD * 0.5) * 2)) * 0.5; // halfProjScale
    u[56] = PROD_ROTATION; u[57] = PROD_STEP; u[58] = this.frameCounter >>> 0; u[59] = PRODUCER_FLAGS;
    d[60] = 1; d[61] = 10; d[62] = 0; d[63] = 7; // aoIntensity, giIntensity, backfaceLighting, maxLuminance
    d[64] = SPATIAL_OFFSETS[Math.floor(this.frameCounter / 6) % 4];
    d[65] = TEMPORAL_ROTATIONS[this.frameCounter % 6] / 360;
    u[66] = 4; d[67] = 1; // fallbackSampleCount, fallbackPower (unused, fallback off)
    d[68] = 1; d[69] = 0; u[70] = ENV_MIPS; d[71] = 0;
  }

  // Compute-only GPU cost of the ACTIVE arm (producer + guides-if-needed +
  // arm), fenced on queue.onSubmittedWorkDone(). Exposed for headless timing;
  // NOT run for recorded numbers in this build (GPU busy — see WORKLOG).
  async runBench(n: number): Promise<number> {
    const w = this.lastW, h = this.lastH;
    const cam = this.camera;
    const v = this.params.values;
    const needSvgfPipeline = v.stack === 'svgf' || v.stack === 'svgf-lite';
    const needGuides = needSvgfPipeline || v.stack === 'ssrt3-guides';
    await this.device.queue.onSubmittedWorkDone();
    const t0 = performance.now();
    for (let i = 0; i < n; i++) {
      this.main.execute(
        [this.depthTex, this.normalTex, this.beautyTex, this.envTex, this.envSampler, this.depthPyramid, this.giAoTex, this.mainData],
        w, h,
      );
      if (needGuides) {
        this.guides.update(
          cam,
          { depth: this.depthTex, velocity: this.velocityTex },
          {
            reset: false,
            disoccLo: v.guidesDisoccLo,
            disoccHi: v.guidesDisoccHi,
            disoccResetThreshold: v.guidesResetThresh,
            historyCap: v.guidesHistoryCap,
            closestIsMin: true,
          },
        );
      }
      this.runStack(v.stack, needSvgfPipeline, cam, this.giAoTex, w, h, 0);
    }
    await this.device.queue.onSubmittedWorkDone();
    return (performance.now() - t0) / n;
  }

  // Numeric sanity check (SVGF-SPEC §6 risk guard): reads back the variance
  // texture and reports min/max/mean. Var must be >= 0 nearly everywhere; with
  // noiseinject on and a known sigma, mean Var should sit near
  // noiseSigma^2 * meanLuminance (the injected-noise model in
  // svgf-noiseinject.wgsl) once temporal accumulation has converged.
  async readVarianceStats(): Promise<{ min: number; max: number; mean: number; count: number }> {
    const w = this.lastW, h = this.lastH;
    if (w <= 0 || h <= 0) return { min: 0, max: 0, mean: 0, count: 0 };

    const gpuTex = getGPUTexture(this.renderer, this.varianceTex);
    const bytesPerPixel = 2; // r16float
    const unpaddedBytesPerRow = w * bytesPerPixel;
    const paddedBytesPerRow = Math.ceil(unpaddedBytesPerRow / 256) * 256;
    const buffer = this.device.createBuffer({
      label: 'd14-variance-readback',
      size: paddedBytesPerRow * h,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    const encoder = this.device.createCommandEncoder({ label: 'd14-variance-readback' });
    encoder.copyTextureToBuffer(
      { texture: gpuTex },
      { buffer, bytesPerRow: paddedBytesPerRow, rowsPerImage: h },
      { width: w, height: h, depthOrArrayLayers: 1 },
    );
    this.device.queue.submit([encoder.finish()]);

    await buffer.mapAsync(GPUMapMode.READ);
    const view = new Uint16Array(buffer.getMappedRange().slice(0));
    buffer.unmap();
    buffer.destroy();

    let min = Infinity, max = -Infinity, sum = 0, count = 0;
    const rowStrideHalfwords = paddedBytesPerRow / 2;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const val = halfToFloat(view[y * rowStrideHalfwords + x]);
        if (Number.isFinite(val)) {
          if (val < min) min = val;
          if (val > max) max = val;
          sum += val;
          count++;
        }
      }
    }
    return { min, max, mean: count > 0 ? sum / count : 0, count };
  }

  private installDividerDrag(ctx: HarnessContext): void {
    const el = ctx.renderer.domElement;
    const near = (clientX: number): boolean => Math.abs(clientX / el.clientWidth - this.compareState.splitX) < 0.04;
    const down = (e: PointerEvent): void => {
      if (this.params.values.viewMode !== 'split') return;
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
      if (this.dragging) { this.dragging = false; ctx.controls.enabled = true; }
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
    const storages: StorageTexture[] = [
      this.giAoTex, this.noisyTex, this.refA, this.refB, this.refOut,
      this.bilateralFinal,
      this.guidesHistA, this.guidesHistB, this.guidesFinal,
      this.mathisColorA, this.mathisColorB, this.mathisFinal, this.mathisCountA, this.mathisCountB,
      this.irrAoTex, this.tmColorA, this.tmColorB, this.tmMomentsA, this.tmMomentsB,
      this.feedbackColorA, this.feedbackColorB, this.varianceTex,
      this.atrousColorA, this.atrousColorB, this.atrousVarA, this.atrousVarB,
      this.svgfFinal, this.depthPyramid,
    ];
    for (const t of storages) {
      t.image = { width, height };
      t.dispose();
      ensureTexture(ctx.renderer, t);
    }
    this.guides.setSize(width, height);
    this.momentsPass.configure({ width, height, space: this.momentsSpace });
    this.compareRT.setSize(width, height);
    ensureRenderTarget(ctx.renderer, this.compareRT);
    this.reset = true;
  }

  dispose(): void {
    const el = document.querySelector('canvas');
    for (const [type, fn] of this.pointerHandlers) {
      if (type === 'pointerdown') el?.removeEventListener(type, fn);
      else window.removeEventListener(type, fn);
    }
    this.camera.clearViewOffset();
    const all = [
      this.giAoTex, this.noisyTex, this.refA, this.refB, this.refOut,
      this.bilateralFinal,
      this.guidesHistA, this.guidesHistB, this.guidesFinal,
      this.mathisColorA, this.mathisColorB, this.mathisFinal, this.mathisCountA, this.mathisCountB,
      this.irrAoTex, this.tmColorA, this.tmColorB, this.tmMomentsA, this.tmMomentsB,
      this.feedbackColorA, this.feedbackColorB, this.varianceTex,
      this.atrousColorA, this.atrousColorB, this.atrousVarA, this.atrousVarB,
      this.svgfFinal, this.depthPyramid, this.envTex,
    ];
    for (const t of all) t.dispose();
    this.guides.dispose();
    this.momentsPass.dispose();
    this.compareRT.dispose();
  }
}

export const svgfLabDemo: DemoDef = {
  id: '14-svgf',
  label: '14 — SVGF lab',
  create: () => new SvgfLabDemo(),
};
