import {
  BackSide,
  DataTexture,
  FloatType,
  HalfFloatType,
  LinearFilter,
  LinearMipmapLinearFilter,
  MathUtils,
  Matrix3,
  Matrix4,
  MeshBasicNodeMaterial,
  NearestFilter,
  NoColorSpace,
  RedFormat,
  RGBAFormat,
  RenderPipeline,
  RenderTarget,
  RepeatWrapping,
  StorageTexture,
  TextureLoader,
  UnsignedByteType,
} from 'three/webgpu';
// Blue-noise atlas is demo 11's committed asset (read-only reuse — the
// generator is bench/scripts/gen-bluenoise.mjs; demo 11 stays frozen).
import atlasUrl from '../11-sampling/stbn-atlas.png?url';
import { HALTON_JITTER, applyCameraJitter, clearCameraJitter } from '../../harness/temporal';
import {
  acos,
  atan,
  clamp,
  diffuseColor,
  dot,
  exp2,
  float,
  length,
  max,
  mrt,
  normalize,
  normalView,
  output,
  pass,
  pow,
  reflect,
  saturate,
  screenCoordinate,
  screenUV,
  step,
  texture,
  uniform,
  vec2,
  vec3,
  vec4,
  velocity,
} from 'three/tsl';
import { fract } from 'three/tsl';
import type { Material, Scene } from 'three/webgpu';
import type { AnyPixelFormat, DepthTexture, PerspectiveCamera, Texture, TextureDataType, WebGPURenderer } from 'three/webgpu';
import type { Demo, DemoDef, HarnessContext } from '../../harness/types';
import { RawComputePass } from '../../harness/raw-compute-pass';
import { ensureTexture, ensureRenderTarget } from '../../harness/three-internals';
import { buildParams } from '../../harness/params';
import type { ParamGroup } from '../../harness/params';
// FORK: demo 18 copies demo 12's WGSL into 18-temporal/ rather than ?raw-
// importing 12-distilled (cross-demo ?raw = silent interface coupling — frozen-
// fork lesson, WORKLOG 2026-07-21). Demo 12 stays the frozen ship-track control.
import mainWgsl from './ssrt18-main.wgsl?raw';
import temporalWgsl from './ssrt18-temporal.wgsl?raw';
import copyDepthWgsl from './ssrt18-copydepth.wgsl?raw';
import denoiseWgsl from './ssrt18-denoise.wgsl?raw';
import lightmaskWgsl from './ssrt18-lightmask.wgsl?raw';
import pyramidWgsl from './ssrt18-depth-pyramid.wgsl?raw';
import downsampleWgsl from './ssrt18-downsample.wgsl?raw';
import upsampleWgsl from './ssrt18-upsample.wgsl?raw';

// Demo 19 — v1 SHIP STACK. Streamlined fork of demo 18 (temporal lab) with reference
// oracle, comparison views, and bent-normals removed. Focused on human browser testing
// of the core v1 accumulation+spatial-denoise stack with fixed oneOverN+jitter setup.

const VIEW_MODES = ['combined', 'ao', 'gi', 'beauty', 'ao-raw', 'gi-raw'] as const;
type ViewMode = (typeof VIEW_MODES)[number];

// Half-res march scale (lab 09 verdict — half is the ship-it default).
const MARCH_SCALES = ['full', 'half', 'quarter'] as const;
type MarchScale = (typeof MARCH_SCALES)[number];
function blockForScale(s: MarchScale): number {
  return s === 'quarter' ? 4 : s === 'half' ? 2 : 1;
}

// Noise source (lab 11 verdict — IGN with per-frame temporal advance).
const NOISE_MODES = ['ign', 'white', 'bluenoise'] as const;
type NoiseMode = (typeof NOISE_MODES)[number];

// Thickness heuristic (lab 08 verdict — Ottosson occluder-adaptive wins the zoo).
// P4 adds 'two-sided' (real back-face interval from a depth prepass).
const THICKNESS_HEURISTICS = ['constant', 'linear', 'ottosson', 'two-sided'] as const;
type ThicknessHeuristic = (typeof THICKNESS_HEURISTICS)[number];

// Distant light on the unoccluded bits (lab 08 verdict — salm-caps).
const DISTANT_MODES = ['off', 'ssrt-fallback', 'salm-caps'] as const;
type DistantMode = (typeof DISTANT_MODES)[number];

// flags bits mirror ssrt18-main.wgsl (F_LINEAR_THICKNESS/F_FALLBACK retired ->
// thicknessHeuristic / distantLightMode enums).
const F_BITMASK = 1;
const F_JITTER = 2;
const F_SCREENSPACE = 8;
const F_MIPOPT = 16;
const F_NORMALAPPROX = 32;
const F_FB_NORMALIZE = 128;
const F_CONE_MIP = 256;
const F_GI = 512;
const F_SECTOR_REMAP = 1024;

function sceneDefaults(sceneId: string): { radius: number; thickness: number } {
  if (sceneId === 'sponza') return { radius: 8, thickness: 2 };
  if (sceneId === 'artifact-zoo') return { radius: 3, thickness: 0.3 };
  return { radius: 5, thickness: 0.5 };
}

const TEMPORAL_ROTATIONS = [60, 300, 180, 240, 120, 0];
const SPATIAL_OFFSETS = [0.0, 0.5, 0.25, 0.75];

// Activision GTAO analytic colored multibounce AO (composite-time).
/* eslint-disable @typescript-eslint/no-explicit-any */
function multiBounceAO(x: any, albedo: any): any {
  const a = albedo.mul(2.0404).sub(0.3324);
  const b = albedo.mul(-4.7951).add(0.6417);
  const c = albedo.mul(2.7552).add(0.6903);
  return max(vec3(x), x.mul(a).add(b).mul(x).add(c).mul(x));
}
/* eslint-enable @typescript-eslint/no-explicit-any */

// Main uniform: 3 mat4 (48f) + demo03 blocks (24f) + demo12 block (8f) = 80 floats.
const U_FLOATS = 80;
const T_FLOATS = 44; // temporal (demo 18: +accumMode/aaMode/jitterDeltaUV)
const D_FLOATS = 8;  // denoise (demo 18: pad0 -> nMin, flags bit1 spatialFallback)
const L_FLOATS = 4;  // lightmask
const P_FLOATS = 4;  // pyramid
const DS_FLOATS = 8; // downsample
const UP_FLOATS = 10; // upsample
const PYRAMID_LEVELS = 5;

// Procedural equirectangular ambient source (forked from demo 03 — same bake).
const ENV_W = 64;
const ENV_H = 32;
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
const ENV_MIPS = Math.floor(Math.log2(Math.max(ENV_W, ENV_H))) + 1;

interface BenchApi {
  config(cfg: { scale?: MarchScale; rc?: number; sc?: number; radius?: number }): {
    fullW: number; fullH: number; marchW: number; marchH: number;
  };
  march(n: number): Promise<number>;
  chain(n: number): Promise<number>;
  total(n: number): Promise<number>;
}

class ShipStackDemo implements Demo {
  private beautyTex!: Texture;
  private albedoTex!: Texture;
  private normalTex!: Texture;
  private velocityTex!: Texture;
  private depthTex!: DepthTexture;

  private scenePass!: ReturnType<typeof pass>;
  private gbufferPipeline!: RenderPipeline;
  private displayPipeline!: RenderPipeline;

  // Full-res buffers.
  private lightTex = this.makeStorage(HalfFloatType, RGBAFormat);   // lightmask (beauty + prevGI)
  private giaoFull = this.makeStorage(HalfFloatType, RGBAFormat);   // upsample target (full res GI/AO)
  private histA = this.makeStorage(HalfFloatType, RGBAFormat);      // temporal ping-pong
  private histB = this.makeStorage(HalfFloatType, RGBAFormat);
  private finalTex = this.makeStorage(HalfFloatType, RGBAFormat);   // denoised final -> composite
  private prevDepthTex = this.makeStorage(FloatType, RedFormat);    // r32float prev depth
  // r32float frame counter (demo 12 used r16float — fine under a 256 cap, but
  // oneOverN ages are uncapped and half-float integer increments stall at 2048).
  private countA = this.makeStorage(FloatType, RedFormat);
  private countB = this.makeStorage(FloatType, RedFormat);
  // AA accumulation of the raw G-buffer beauty/albedo (see ssrt18-temporal.wgsl
  // header): ping-pong pairs + the stable-identity copies the display samples.
  private beautyAccA = this.makeStorage(HalfFloatType, RGBAFormat);
  private beautyAccB = this.makeStorage(HalfFloatType, RGBAFormat);
  private albedoAccA = this.makeStorage(HalfFloatType, RGBAFormat);
  private albedoAccB = this.makeStorage(HalfFloatType, RGBAFormat);
  private beautyFinal = this.makeStorage(HalfFloatType, RGBAFormat);
  private albedoFinal = this.makeStorage(HalfFloatType, RGBAFormat);

  // March-resolution buffers (lab 09 downsample outputs + march output).
  private marchDepth = this.makeStorage(FloatType, RedFormat);      // r32float
  private marchNormal = this.makeStorage(HalfFloatType, RGBAFormat);
  private marchLight = this.makeStorage(HalfFloatType, RGBAFormat);
  private marchOut = this.makeStorage(HalfFloatType, RGBAFormat);   // main march output
  private depthPyramid = this.makePyramid();                       // mip pyramid built from marchDepth

  // P4 two-sided thickness: a back-face depth prepass at MARCH resolution.
  private backPass!: ReturnType<typeof pass>;
  private backPipeline!: RenderPipeline;
  private backMat!: MeshBasicNodeMaterial;   // BackSide override -> renders far (back) faces' depth
  private backDepthTex!: DepthTexture;
  private sceneRef!: Scene;

  private main!: RawComputePass;
  private temporal!: RawComputePass;
  private copyDepth!: RawComputePass;
  private denoise!: RawComputePass;
  private lightmask!: RawComputePass;
  private pyramid!: RawComputePass;
  private downsample!: RawComputePass;
  private upsample!: RawComputePass;
  private envSampler!: GPUSampler;
  private envTex!: DataTexture;
  // Blue-noise atlas (noiseMode 'bluenoise'). Starts as a 1x1 placeholder so
  // init stays synchronous and the binding is always valid; the loaded PNG
  // swaps in via the per-frame execute() resource array. 'ign' never reads it.
  private atlasTex!: Texture;

  private mainData = new Float32Array(U_FLOATS);
  private mainU32 = new Uint32Array(this.mainData.buffer);
  private tData = new Float32Array(T_FLOATS);
  private tU32 = new Uint32Array(this.tData.buffer);
  private dData = new Float32Array(D_FLOATS);
  private dU32 = new Uint32Array(this.dData.buffer);
  private lData = new Float32Array(L_FLOATS);
  private pData = new Float32Array(P_FLOATS);
  private pU32 = new Uint32Array(this.pData.buffer);
  private cData = new Float32Array(4);
  private dsData = new Float32Array(DS_FLOATS);
  private dsU32 = new Uint32Array(this.dsData.buffer);
  private upData = new Float32Array(UP_FLOATS);

  private invViewProj = new Matrix4();
  private prevInvViewProj = new Matrix4();
  private histPing = true;
  private resetTemporal = true;
  private device!: GPUDevice;

  private fullW = 1;
  private fullH = 1;
  private marchW = 1;
  private marchH = 1;

  private uGiExposure = uniform(1);
  private uInvProj = uniform(new Matrix4());
  private params!: ParamGroup<typeof schema>;
  private frameCounter = 0;
  private sceneId = 'cornell';
  // AA jitter bookkeeping: current index into the 16-entry Halton cycle and the
  // previous frame's applied offset (pixels) — fillTemporal derives the
  // jitter-only velocity component (jitterDeltaUV) from cur - prev.
  private jitterIndex = 0;
  private prevJitterPx: [number, number] = [0, 0];
  private curJitterPx: [number, number] = [0, 0];

  private makeStorage(type: TextureDataType, format: AnyPixelFormat): StorageTexture {
    const t = new StorageTexture(1, 1);
    t.type = type;
    t.format = format;
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

  init(ctx: HarnessContext): void {
    this.sceneId = new URLSearchParams(window.location.search).get('scene') ?? 'cornell';
    this.device = ctx.device;
    this.sceneRef = ctx.scene.scene;
    const cam = ctx.scene.camera;

    this.scenePass = pass(ctx.scene.scene, cam);
    this.scenePass.setMRT(mrt({ output: output, albedo: diffuseColor, normal: normalView, velocity: velocity }));
    this.beautyTex = this.scenePass.getTexture('output');
    this.albedoTex = this.scenePass.getTexture('albedo');
    this.normalTex = this.scenePass.getTexture('normal');
    this.velocityTex = this.scenePass.getTexture('velocity');
    this.scenePass.getTexture('albedo').type = UnsignedByteType;
    this.depthTex = this.scenePass.renderTarget.depthTexture!;

    this.gbufferPipeline = new RenderPipeline(ctx.renderer, this.scenePass);
    this.displayPipeline = new RenderPipeline(ctx.renderer);

    // P4 two-sided thickness: a depth-only pass rendered with a BackSide override
    // material so only back faces write depth (front-face culling). With the
    // default depth test this captures the nearest back face -> the far side of
    // the front object = its real thickness. Rendered at MARCH resolution (the
    // march reads it at march-res coords; no downsample pass needed). The pass
    // still carries a color target but we only consume its depthTexture.
    this.backMat = new MeshBasicNodeMaterial();
    this.backMat.side = BackSide;
    this.backPass = pass(ctx.scene.scene, cam);
    this.backPipeline = new RenderPipeline(ctx.renderer, this.backPass);

    this.envSampler = ctx.device.createSampler({
      magFilter: 'linear', minFilter: 'linear', mipmapFilter: 'linear',
      addressModeU: 'repeat', addressModeV: 'clamp-to-edge',
    });
    this.envTex = makeEnv(this.sceneId);

    // Blue-noise atlas: placeholder now, PNG swap-in when loaded (demo 11's
    // committed asset; nearest/no-mips/no-flip exactly as its lab binds it).
    const ph = new DataTexture(new Uint8Array([128, 128, 0, 255]), 1, 1, RGBAFormat, UnsignedByteType);
    ph.colorSpace = NoColorSpace;
    ph.needsUpdate = true;
    this.atlasTex = ph;
    ensureTexture(ctx.renderer, ph);
    new TextureLoader().load(atlasUrl, (tex) => {
      tex.colorSpace = NoColorSpace;
      tex.format = RGBAFormat;
      tex.type = UnsignedByteType;
      tex.magFilter = NearestFilter;
      tex.minFilter = NearestFilter;
      tex.generateMipmaps = false;
      tex.flipY = false;
      tex.needsUpdate = true;
      ensureTexture(ctx.renderer, tex);
      this.atlasTex = tex;
    });
    ensureTexture(ctx.renderer, this.envTex);

    // Lightmask (full res): beauty + reproject(prev denoised GI) -> light source.
    this.lightmask = new RawComputePass(ctx.renderer, 'ssrt18-lightmask', lightmaskWgsl, {
      bindings: [{ kind: 'tex' }, { kind: 'tex' }, { kind: 'tex' }, { kind: 'storage', format: 'rgba16float' }, { kind: 'uniform' }],
    });
    // Downsample (full -> march res): depth/normal/light G-buffer (lab 09).
    this.downsample = new RawComputePass(ctx.renderer, 'ssrt18-downsample', downsampleWgsl, {
      bindings: [
        { kind: 'depth' }, { kind: 'tex' }, { kind: 'tex' },
        { kind: 'storage', format: 'r32float' }, { kind: 'storage', format: 'rgba16float' }, { kind: 'storage', format: 'rgba16float' },
        { kind: 'uniform' },
      ],
    });
    // Depth pyramid (march res): built from march-res depth (box-min).
    this.pyramid = new RawComputePass(ctx.renderer, 'ssrt18-pyramid', pyramidWgsl, {
      bindings: [{ kind: 'tex' }, { kind: 'storage', format: 'r32float' }, { kind: 'uniform' }],
    });
    // Main march (march res): march-res depth/normal/light + env + pyramid +
    // back-face depth (P4 two-sided) -> giao. The backDepth binding is ALWAYS
    // present (no pipeline permutation); it is only read when the two-sided feature
    // is on.
    this.main = new RawComputePass(ctx.renderer, 'ssrt18-main', mainWgsl, {
      bindings: [
        { kind: 'tex' }, { kind: 'tex' }, { kind: 'tex' }, { kind: 'sampledTex' }, { kind: 'sampler', filtering: true },
        { kind: 'tex' }, { kind: 'depth' },
        { kind: 'storage', format: 'rgba16float' }, { kind: 'storage', format: 'rgba16float' }, { kind: 'uniform' },
        { kind: 'tex' }, // noise atlas (bluenoise mode)
      ],
    });
    // Joint bilateral upsample (march -> full res, lab 09).
    this.upsample = new RawComputePass(ctx.renderer, 'ssrt18-upsample', upsampleWgsl, {
      bindings: [
        { kind: 'tex' }, { kind: 'tex' }, { kind: 'tex' }, { kind: 'depth' }, { kind: 'tex' },
        { kind: 'storage', format: 'rgba16float' }, { kind: 'uniform' },
      ],
    });
    // Temporal reprojection (full res). r32float age counter,
    // beauty/albedo AA accumulation pairs (4 storage outputs = the WebGPU
    // default per-stage limit — do not add a fifth).
    this.temporal = new RawComputePass(ctx.renderer, 'ssrt18-temporal', temporalWgsl, {
      bindings: [
        { kind: 'tex' }, { kind: 'tex' }, { kind: 'tex' }, { kind: 'depth' }, { kind: 'tex' }, { kind: 'tex' },
        { kind: 'tex' }, { kind: 'tex' }, { kind: 'tex' }, { kind: 'tex' },
        { kind: 'storage', format: 'rgba16float' }, { kind: 'storage', format: 'r32float' },
        { kind: 'storage', format: 'rgba16float' }, { kind: 'storage', format: 'rgba16float' },
        { kind: 'uniform' },
      ],
    });
    // Prev-depth refresh (full res).
    this.copyDepth = new RawComputePass(ctx.renderer, 'ssrt18-copydepth', copyDepthWgsl, {
      bindings: [{ kind: 'depth' }, { kind: 'storage', format: 'r32float' }, { kind: 'uniform' }],
    });
    // Bilateral denoise (full res). Age counter (spatial fallback fade) +
    // beauty/albedo stable-identity copy-through.
    this.denoise = new RawComputePass(ctx.renderer, 'ssrt18-denoise', denoiseWgsl, {
      bindings: [
        { kind: 'tex' }, { kind: 'depth' }, { kind: 'tex' }, { kind: 'tex' }, { kind: 'tex' }, { kind: 'tex' },
        { kind: 'storage', format: 'rgba16float' }, { kind: 'storage', format: 'rgba16float' },
        { kind: 'storage', format: 'rgba16float' }, { kind: 'uniform' },
      ],
    });

    this.resize(ctx);
    this.lightmask.configure(this.lData.byteLength);
    this.downsample.configure(this.dsData.byteLength);
    this.pyramid.configure(this.pData.byteLength);
    this.main.configure(this.mainData.byteLength);
    this.upsample.configure(this.upData.byteLength);
    this.temporal.configure(this.tData.byteLength);
    this.copyDepth.configure(this.cData.byteLength);
    this.denoise.configure(this.dData.byteLength);

    const folder = ctx.pane.addFolder({ title: 'Demo 19 — v1 ship stack' });
    const d = sceneDefaults(this.sceneId);
    this.params = buildParams(folder, schema);
    this.params.values.radius = d.radius;
    this.params.values.thickness = d.thickness;
    this.params.refresh();
    this.params.onChange((key) => {
      if (key === 'viewMode' || key === 'multiBounceAO' || key === 'marchScale') this.updateOutputNode();
      if (key === 'marchScale') this.applyScale();
      // Accumulation semantics changed -> stale history/age is meaningless.
      if (key === 'temporalAccumulation') this.resetTemporal = true;
    });

    // URL overrides (mirror demo 03 + mscale/noise/thick/distant).
    const q = new URLSearchParams(window.location.search);
    const urlView = q.get('view');
    if (urlView && (VIEW_MODES as readonly string[]).includes(urlView)) this.params.values.viewMode = urlView as ViewMode;
    const bool = (k: string, cur: boolean): boolean => { const s = q.get(k); return s === null ? cur : s === '1'; };
    const setEnum = <T extends string>(k: string, opts: readonly T[], cur: T): T => {
      const s = q.get(k); return s !== null && (opts as readonly string[]).includes(s) ? (s as T) : cur;
    };
    this.params.values.marchScale = setEnum('mscale', MARCH_SCALES, this.params.values.marchScale);
    this.params.values.noiseMode = setEnum('noise', NOISE_MODES, this.params.values.noiseMode);
    this.params.values.thicknessHeuristic = setEnum('thick', THICKNESS_HEURISTICS, this.params.values.thicknessHeuristic);
    this.params.values.distantLight = setEnum('distant', DISTANT_MODES, this.params.values.distantLight);
    this.params.values.spatialFallback = bool('sf', this.params.values.spatialFallback);
    if (q.get('nmin') !== null) this.params.values.nMin = Number(q.get('nmin'));
    this.params.values.useBitmask = bool('bitmask', this.params.values.useBitmask);
    this.params.values.gatherGI = bool('gi', this.params.values.gatherGI);
    this.params.values.temporalAccumulation = bool('temporal', this.params.values.temporalAccumulation);
    this.params.values.denoising = bool('denoise', this.params.values.denoising);
    this.params.values.multiBounceAO = bool('mbao', this.params.values.multiBounceAO);
    this.params.values.mipOptimization = bool('mip', this.params.values.mipOptimization);
    this.params.values.normalApproximation = bool('na', this.params.values.normalApproximation);
    if (q.get('mb') !== null) this.params.values.multiBounceGI = Number(q.get('mb'));
    if (q.get('sc') !== null) this.params.values.stepCount = Number(q.get('sc'));
    if (q.get('rc') !== null) this.params.values.rotationCount = Number(q.get('rc'));
    if (q.get('radius') !== null) this.params.values.radius = Number(q.get('radius'));
    if (q.get('thickness') !== null) this.params.values.thickness = Number(q.get('thickness'));
    this.params.refresh();

    this.applyScale();
    this.updateOutputNode();

    const api: BenchApi = {
      config: (cfg) => this.benchConfig(cfg),
      march: (n) => this.benchMarch(n),
      chain: (n) => this.benchChain(n),
      total: (n) => this.benchTotal(n),
    };
    (window as unknown as { __bench19?: BenchApi }).__bench19 = api;
  }

  // Current full-res GI/AO fed to temporal: upsample target when sub-full-res,
  // else the march output directly (which is full res at marchScale=full).
  private currentGiao(): Texture {
    return blockForScale(this.params.values.marchScale) > 1 ? this.giaoFull : this.marchOut;
  }

  // Static (non-animated) IGN dither, ±0.5 LSB at 8-bit, added to the final
  // rgb before the canvas quantizes. Smooth HDR gradients band at 8 bits no matter
  // how clean the GI is — sub-LSB dither breaks the bands. Static by design: an
  // animated dither would re-introduce exactly the FLOOR-live crawl the human tests
  // are hunting.
  private withDisplayDither(node: ReturnType<typeof vec4>) {
    const c = screenCoordinate;
    const ign = fract(
      float(52.9829189).mul(fract(c.x.mul(0.06711056).add(c.y.mul(0.00583715)))),
    );
    return vec4(node.rgb.add(ign.sub(0.5).mul(1 / 255)), node.a);
  }

  private updateOutputNode(): void {
    this.displayPipeline.outputNode = this.withDisplayDither(
      this.buildViewNode(this.params.values.viewMode),
    );
    this.displayPipeline.needsUpdate = true;
  }

  private buildViewNode(mode: ViewMode) {
    const uv = screenUV;
    const finalGiao = texture(this.finalTex, uv);
    const rawGiao = texture(this.currentGiao(), uv);
    const ao = finalGiao.a;
    const gi = finalGiao.rgb.mul(this.uGiExposure);
    switch (mode) {
      case 'ao':
        return vec4(vec3(ao), float(1));
      case 'gi':
        return vec4(gi, float(1));
      case 'ao-raw':
        return vec4(vec3(rawGiao.a), float(1));
      case 'gi-raw':
        return vec4(rawGiao.rgb.mul(this.uGiExposure), float(1));
      case 'combined': {
        // Composite from the ACCUMULATED beauty/albedo (stable copies
        // written by ssrt18-denoise) — under camera jitter the raw G-buffer
        // shimmers at every edge; the accumulated pair is what anti-aliases.
        const beauty = texture(this.beautyFinal, uv).rgb;
        const albedo = texture(this.albedoFinal, uv).rgb;
        const aoTerm = this.params.values.multiBounceAO ? multiBounceAO(ao, albedo) : vec3(ao);
        const base = beauty.mul(aoTerm).add(albedo.mul(gi));
        return vec4(base, float(1));
      }
      case 'beauty':
        return vec4(texture(this.beautyFinal, uv).rgb, float(1));
    }
  }

  private computeFlags(): number {
    const v = this.params.values;
    let f = 0;
    if (v.useBitmask) f |= F_BITMASK;
    if (v.jitterSamples) f |= F_JITTER;
    if (v.screenSpaceSampling) f |= F_SCREENSPACE;
    if (v.mipOptimization) f |= F_MIPOPT;
    if (v.normalApproximation) f |= F_NORMALAPPROX;
    if (v.fallbackNormalization) f |= F_FB_NORMALIZE;
    if (v.coneMip) f |= F_CONE_MIP;
    if (v.gatherGI) f |= F_GI;
    if (v.sectorRemap) f |= F_SECTOR_REMAP;
    return f;
  }

  private fillMainUniform(cam: PerspectiveCamera): void {
    const d = this.mainData;
    const u = this.mainU32;
    d.set(cam.projectionMatrix.elements, 0);
    d.set(cam.projectionMatrixInverse.elements, 16);
    d.set(cam.matrixWorld.elements, 32);
    d[48] = this.marchW;
    d[49] = this.marchH;
    d[50] = cam.near;
    d[51] = cam.far;
    const v = this.params.values;
    d[52] = v.radius;
    d[53] = v.thickness;
    d[54] = v.expFactor;
    d[55] = (this.marchH / (Math.tan(cam.fov * MathUtils.DEG2RAD * 0.5) * 2)) * 0.5;
    const fc = v.freezeNoise ? 0 : this.frameCounter;
    u[56] = v.rotationCount;
    u[57] = v.stepCount;
    u[58] = fc >>> 0;
    u[59] = this.computeFlags();
    d[60] = v.aoIntensity;
    d[61] = v.giIntensity;
    d[62] = v.backfaceLighting;
    d[63] = v.maxLuminance;
    d[64] = SPATIAL_OFFSETS[Math.floor(fc / 6) % 4];
    d[65] = TEMPORAL_ROTATIONS[fc % 6] / 360;
    u[66] = v.fallbackSampleCount;
    d[67] = v.fallbackPower;
    d[68] = v.fallbackIntensity;
    d[69] = v.multiBounceGI;
    u[70] = ENV_MIPS;
    d[71] = 0;
    // demo 12 block.
    u[72] = v.noiseMode === 'bluenoise' ? 2 : v.noiseMode === 'white' ? 1 : 0;
    u[73] = v.thicknessHeuristic === 'two-sided' ? 3 : v.thicknessHeuristic === 'ottosson' ? 2 : v.thicknessHeuristic === 'linear' ? 1 : 0;
    u[74] = v.distantLight === 'salm-caps' ? 2 : v.distantLight === 'ssrt-fallback' ? 1 : 0;
    u[75] = v.capsBits;
    d[76] = v.occluderThicknessScale;
    d[77] = v.occluderCosLimit;
    d[78] = v.distantIntensity;
    d[79] = v.linearThickK;
  }

  private fillDownsample(): void {
    const block = blockForScale(this.params.values.marchScale);
    this.dsData[0] = this.fullW;
    this.dsData[1] = this.fullH;
    this.dsData[2] = this.marchW;
    this.dsData[3] = this.marchH;
    this.dsU32[4] = block;
    this.dsData[5] = 0; this.dsData[6] = 0; this.dsData[7] = 0;
  }

  private fillUpsample(cam: PerspectiveCamera): void {
    const d = this.upData;
    d[0] = this.fullW; d[1] = this.fullH;
    d[2] = this.marchW; d[3] = this.marchH;
    d[4] = cam.near; d[5] = cam.far;
    d[6] = this.params.values.upsampleNormalPhi;
    d[7] = this.params.values.upsampleDepthPhi;
    d[8] = 0; d[9] = 0;
  }

  // P4: render the back-face depth prepass into backPass.depthTexture (march
  // res). scene.overrideMaterial forces the BackSide depth-only material for
  // this render only; restored immediately so the main G-buffer pass is
  // untouched. (three's WebGPURenderer honors scene.overrideMaterial.)
  private renderBackDepth(): void {
    const prev = (this.sceneRef as unknown as { overrideMaterial: Material | null }).overrideMaterial;
    (this.sceneRef as unknown as { overrideMaterial: Material | null }).overrideMaterial = this.backMat;
    this.backPipeline.render();
    (this.sceneRef as unknown as { overrideMaterial: Material | null }).overrideMaterial = prev;
  }

  // The compute chain (downsample -> pyramid -> march -> upsample), shared by
  // frame() and the chain/total benchmarks. Assumes the light buffer is current.
  private runChain(cam: PerspectiveCamera): void {
    const block = blockForScale(this.params.values.marchScale);
    const v = this.params.values;

    this.fillDownsample();
    this.downsample.execute(
      [this.depthTex, this.normalTex, this.lightTex, this.marchDepth, this.marchNormal, this.marchLight, this.dsData],
      this.marchW, this.marchH,
    );

    if (v.mipOptimization) {
      for (let mip = 0; mip < PYRAMID_LEVELS; mip++) {
        this.pData[0] = this.marchW;
        this.pData[1] = this.marchH;
        this.pU32[2] = mip;
        this.pData[3] = 0;
        const mw = Math.max(1, this.marchW >> mip);
        const mh = Math.max(1, this.marchH >> mip);
        this.pyramid.execute([this.marchDepth, this.depthPyramid, this.pData], mw, mh, { storageMip: mip });
      }
    }

    // P4 two-sided: render the back-face depth prepass (march res) only when the
    // two-sided heuristic is active. Otherwise bind the (always-allocated) full-
    // res scene depth as a harmless placeholder — the shader never reads it
    // unless thicknessHeuristic==3, so no permutation and near-zero cost when off.
    let backTex: DepthTexture = this.depthTex;
    if (v.thicknessHeuristic === 'two-sided') {
      this.renderBackDepth();
      backTex = this.backDepthTex;
    }

    this.fillMainUniform(cam);
    this.main.execute(
      [this.marchDepth, this.marchNormal, this.marchLight, this.envTex, this.envSampler, this.depthPyramid, backTex, this.marchOut, this.marchOut, this.mainData, this.atlasTex],
      this.marchW, this.marchH,
    );

    if (block > 1) {
      this.fillUpsample(cam);
      this.upsample.execute(
        [this.marchOut, this.marchDepth, this.marchNormal, this.depthTex, this.normalTex, this.giaoFull, this.upData],
        this.fullW, this.fullH,
      );
    }
  }

  frame(ctx: HarnessContext, _dt: number): void {
    const cam = ctx.scene.camera;
    this.frameCounter++;
    const { width, height } = ctx.renderSize();
    const v = this.params.values;

    // 0. AA sub-pixel camera jitter (Halton(2,3), 16-frame cycle) — applied
    // BEFORE the G-buffer render and before any matrix-derived uniforms are
    // captured, so every consumer sees a consistent (jittered) projection.
    // fillTemporal() hands the temporal pass the cur-prev jitter delta so it
    // can recover TRUE per-pixel motion from the (jitter-contaminated)
    // velocity buffer — see ssrt18-temporal.wgsl header for why this matters.
    this.prevJitterPx = this.curJitterPx;
    if (v.aaMode !== 'off') {
      const [jx, jy] = HALTON_JITTER[this.jitterIndex];
      this.jitterIndex = (this.jitterIndex + 1) % HALTON_JITTER.length;
      applyCameraJitter(cam, width, height, jx, jy);
      this.curJitterPx = [jx, jy];
    } else {
      clearCameraJitter(cam);
      this.curJitterPx = [0, 0];
    }

    this.uGiExposure.value = this.params.values.giExposure;
    this.uInvProj.value.copy(cam.projectionMatrixInverse);

    // 1. G-buffer.
    this.gbufferPipeline.render();

    // 2. Lightmask (full res): beauty + reproject(prev denoised GI).
    this.lData[0] = width; this.lData[1] = height;
    this.lData[2] = v.multiBounceGI * v.mbDamping; this.lData[3] = 0;
    this.lightmask.execute([this.beautyTex, this.finalTex, this.velocityTex, this.lightTex, this.lData], width, height);

    // 3. Compute chain (downsample -> pyramid -> march -> upsample).
    this.runChain(cam);

    // 4. Temporal reprojection (full res) + beauty/albedo AA accumulation.
    this.invViewProj.multiplyMatrices(cam.matrixWorld, cam.projectionMatrixInverse);
    const histWrite = this.histPing ? this.histA : this.histB;
    const histRead = this.histPing ? this.histB : this.histA;
    const countWrite = this.histPing ? this.countA : this.countB;
    const countRead = this.histPing ? this.countB : this.countA;
    const beautyWrite = this.histPing ? this.beautyAccA : this.beautyAccB;
    const beautyRead = this.histPing ? this.beautyAccB : this.beautyAccA;
    const albedoWrite = this.histPing ? this.albedoAccA : this.albedoAccB;
    const albedoRead = this.histPing ? this.albedoAccB : this.albedoAccA;
    this.fillTemporal(cam, width, height, v);
    this.temporal.execute(
      [this.currentGiao(), histRead, this.velocityTex, this.depthTex, this.prevDepthTex, countRead,
        this.beautyTex, beautyRead, this.albedoTex, albedoRead,
        histWrite, countWrite, beautyWrite, albedoWrite, this.tData],
      width, height,
    );

    // 4b. Prev-depth refresh.
    this.cData[0] = width; this.cData[1] = height;
    this.copyDepth.execute([this.depthTex, this.prevDepthTex, this.cData], width, height);

    // 5. Bilateral denoise (+ spatial-fallback fade + beauty/albedo stable
    // copy) -> finalTex / beautyFinal / albedoFinal (display samples these).
    this.fillDenoise(cam, width, height, v);
    this.denoise.execute(
      [histWrite, this.depthTex, this.normalTex, countWrite, beautyWrite, albedoWrite,
        this.finalTex, this.beautyFinal, this.albedoFinal, this.dData],
      width, height,
    );

    // 6. Display.
    this.displayPipeline.render();
    ctx.timing.sampleGPU(ctx.renderer);

    this.prevInvViewProj.copy(this.invViewProj);
    this.histPing = !this.histPing;
    this.resetTemporal = false;
  }

  private fillTemporal(cam: PerspectiveCamera, width: number, height: number, v: ParamGroup<typeof schema>['values']): void {
    const d = this.tData;
    const u = this.tU32;
    d.set(this.invViewProj.elements, 0);
    d.set(this.prevInvViewProj.elements, 16);
    d[32] = width; d[33] = height; d[34] = cam.near; d[35] = cam.far;
    let flags = 0;
    if (v.temporalAccumulation) flags |= 1;
    if (this.resetTemporal || this.frameCounter < 2) flags |= 2;
    u[36] = flags;
    u[37] = 1; // v1: always oneOverN
    u[38] = v.aaMode === 'jitterClamp' ? 2 : v.aaMode === 'jitter' ? 1 : 0;
    d[39] = v.accumFrameCap;
    // Jitter-only velocity component in UV. setViewOffset(w, h, jx, jy, w, h)
    // shifts a fixed world point's uv by (-jx/w, -jy/h) (frustum window moves
    // right/down -> the point lands left/up), so the uvCur - uvPrev term the
    // jitter alone contributes is -(jCur - jPrev)/size.
    d[40] = -(this.curJitterPx[0] - this.prevJitterPx[0]) / width;
    d[41] = -(this.curJitterPx[1] - this.prevJitterPx[1]) / height;
    d[42] = 0; d[43] = 0;
  }

  private fillDenoise(cam: PerspectiveCamera, width: number, height: number, v: ParamGroup<typeof schema>['values']): void {
    const d = this.dData;
    const u = this.dU32;
    d[0] = width; d[1] = height; d[2] = cam.near; d[3] = cam.far;
    d[4] = v.denoisingRadius;
    u[5] = (v.denoising ? 1 : 0) | (v.spatialFallback ? 2 : 0);
    d[6] = v.nMin; d[7] = 0;
  }

  // --- benchmark harness (M3 fence: onSubmittedWorkDone around N iters) ------
  private benchConfig(cfg: { scale?: MarchScale; rc?: number; sc?: number; radius?: number }): {
    fullW: number; fullH: number; marchW: number; marchH: number;
  } {
    const v = this.params.values;
    if (cfg.scale) v.marchScale = cfg.scale;
    if (cfg.rc !== undefined) v.rotationCount = cfg.rc;
    if (cfg.sc !== undefined) v.stepCount = cfg.sc;
    if (cfg.radius !== undefined) v.radius = cfg.radius;
    this.params.refresh();
    this.applyScale();
    this.updateOutputNode();
    return { fullW: this.fullW, fullH: this.fullH, marchW: this.marchW, marchH: this.marchH };
  }

  private async fence(fn: () => void, n: number): Promise<number> {
    await this.device.queue.onSubmittedWorkDone();
    const t0 = performance.now();
    for (let i = 0; i < n; i++) fn();
    await this.device.queue.onSubmittedWorkDone();
    return (performance.now() - t0) / n;
  }

  // Prime the light + march-res G-buffer so a march-only fence is measurable.
  private prime(cam: PerspectiveCamera, width: number, height: number): void {
    this.gbufferPipeline.render();
    this.lData[0] = width; this.lData[1] = height;
    this.lData[2] = this.params.values.multiBounceGI * this.params.values.mbDamping; this.lData[3] = 0;
    this.lightmask.execute([this.beautyTex, this.finalTex, this.velocityTex, this.lightTex, this.lData], width, height);
    this.fillDownsample();
    this.downsample.execute(
      [this.depthTex, this.normalTex, this.lightTex, this.marchDepth, this.marchNormal, this.marchLight, this.dsData],
      this.marchW, this.marchH,
    );
    this.fillMainUniform(cam);
  }

  private async benchMarch(n: number): Promise<number> {
    const cam = this.currentCam();
    this.prime(cam, this.fullW, this.fullH);
    return this.fence(() => {
      this.main.execute(
        [this.marchDepth, this.marchNormal, this.marchLight, this.envTex, this.envSampler, this.depthPyramid, this.depthTex, this.marchOut, this.marchOut, this.mainData, this.atlasTex],
        this.marchW, this.marchH,
      );
    }, n);
  }

  private async benchChain(n: number): Promise<number> {
    const cam = this.currentCam();
    this.gbufferPipeline.render();
    this.lData[0] = this.fullW; this.lData[1] = this.fullH;
    this.lData[2] = 0; this.lData[3] = 0;
    this.lightmask.execute([this.beautyTex, this.finalTex, this.velocityTex, this.lightTex, this.lData], this.fullW, this.fullH);
    return this.fence(() => this.runChain(cam), n);
  }

  private async benchTotal(n: number): Promise<number> {
    const cam = this.currentCam();
    this.gbufferPipeline.render();
    const w = this.fullW, h = this.fullH;
    const v = this.params.values;
    this.invViewProj.multiplyMatrices(cam.matrixWorld, cam.projectionMatrixInverse);
    return this.fence(() => {
      this.lData[0] = w; this.lData[1] = h;
      this.lData[2] = v.multiBounceGI * v.mbDamping; this.lData[3] = 0;
      this.lightmask.execute([this.beautyTex, this.finalTex, this.velocityTex, this.lightTex, this.lData], w, h);
      this.runChain(cam);
      this.fillTemporal(cam, w, h, v);
      this.temporal.execute(
        [this.currentGiao(), this.histB, this.velocityTex, this.depthTex, this.prevDepthTex, this.countB,
          this.beautyTex, this.beautyAccB, this.albedoTex, this.albedoAccB,
          this.histA, this.countA, this.beautyAccA, this.albedoAccA, this.tData],
        w, h,
      );
      this.cData[0] = w; this.cData[1] = h;
      this.copyDepth.execute([this.depthTex, this.prevDepthTex, this.cData], w, h);
      this.fillDenoise(cam, w, h, v);
      this.denoise.execute(
        [this.histA, this.depthTex, this.normalTex, this.countA, this.beautyAccA, this.albedoAccA,
          this.finalTex, this.beautyFinal, this.albedoFinal, this.dData],
        w, h,
      );
    }, n);
  }

  private currentCam(): PerspectiveCamera {
    return this.sceneCam;
  }
  private sceneCam!: PerspectiveCamera;

  // Sizes the march-resolution buffers (+ pyramid) to the current scale.
  private applyScale(): void {
    const block = blockForScale(this.params?.values.marchScale ?? 'half');
    this.marchW = Math.max(1, Math.ceil(this.fullW / block));
    this.marchH = Math.max(1, Math.ceil(this.fullH / block));
    for (const t of [this.marchDepth, this.marchNormal, this.marchLight, this.marchOut]) {
      t.image = { width: this.marchW, height: this.marchH };
      t.dispose();
      ensureTexture(this.rendererRef, t);
    }
    this.depthPyramid.image = { width: this.marchW, height: this.marchH };
    this.depthPyramid.dispose();
    ensureTexture(this.rendererRef, this.depthPyramid);
    // P4 two-sided: back-face depth pass renders at MARCH resolution.
    if (this.backPass) {
      this.backPass.setSize(this.marchW, this.marchH);
      this.backDepthTex = this.backPass.renderTarget.depthTexture!;
    }
  }
  private rendererRef!: WebGPURenderer;

  resize(ctx: HarnessContext): void {
    const { width, height } = ctx.renderSize();
    this.rendererRef = ctx.renderer;
    this.sceneCam = ctx.scene.camera;
    this.fullW = width;
    this.fullH = height;
    this.scenePass.setSize(width, height);
    for (const t of [this.lightTex, this.giaoFull, this.histA, this.histB, this.finalTex, this.prevDepthTex, this.countA, this.countB,
      this.beautyAccA, this.beautyAccB, this.albedoAccA, this.albedoAccB, this.beautyFinal, this.albedoFinal]) {
      t.image = { width, height };
      t.dispose();
      ensureTexture(ctx.renderer, t);
    }
    this.applyScale();
    this.resetTemporal = true;
  }

  dispose(): void {
    for (const t of [this.lightTex, this.giaoFull, this.histA, this.histB, this.finalTex, this.prevDepthTex, this.countA, this.countB,
      this.beautyAccA, this.beautyAccB, this.albedoAccA, this.albedoAccB, this.beautyFinal, this.albedoFinal,
      this.marchDepth, this.marchNormal, this.marchLight, this.marchOut, this.depthPyramid]) t.dispose();
    this.envTex.dispose();
    this.backMat.dispose();
    // The camera is shared harness state — never leave a jitter offset behind.
    if (this.sceneCam) clearCameraJitter(this.sceneCam);
  }
}

const schema = {
  viewMode: { type: 'enum', value: 'combined' as ViewMode, options: VIEW_MODES, label: 'view',
    hint: 'combined = beauty·AO + albedo·GI composite; ao/gi = denoised outputs; *-raw = upsampled march output before temporal/denoise.' },
  giExposure: { type: 'number', value: 1, min: 0.1, max: 8, step: 0.05, label: 'GI display gain',
    hint: 'Display-only multiplier on the gi view. Does NOT affect the composite.' },
  // --- core v1 march parameters ---
  marchScale: { type: 'enum', value: 'half' as MarchScale, options: MARCH_SCALES, label: 'march scale', group: 'core',
    hint: 'lab 09 verdict: march at half res + joint-bilateral upsample (3.8–5.4× on the dominant term). full = demo-03-equal control; quarter = aggressive.' },
  rotationCount: { type: 'number', value: 2, min: 1, max: 4, step: 1, label: 'rotationCount', group: 'core',
    hint: 'Hemisphere slices per pixel. Biggest quality/cost knob after stepCount.' },
  stepCount: { type: 'number', value: 12, min: 1, max: 32, step: 1, label: 'stepCount', group: 'core',
    hint: 'March samples per direction per slice. Total = rotationCount × stepCount × 2.' },
  radius: { type: 'number', value: 5, min: 1, max: 25, step: 0.5, label: 'radius (world)', group: 'core',
    hint: 'World-space march radius.' },
  noiseMode: { type: 'enum', value: 'bluenoise' as NoiseMode, options: NOISE_MODES, label: 'noise', group: 'core',
    hint: 'v1 default: bluenoise (STBN atlas — the cleanest temporal sequence for deep 1/N accumulation). ign/white kept as controls.' },
  // --- thickness & distant light ---
  thicknessHeuristic: { type: 'enum', value: 'ottosson' as ThicknessHeuristic, options: THICKNESS_HEURISTICS, label: 'thickness heuristic', group: 'scene',
    hint: 'lab 08 verdict: Ottosson occluder-adaptive thickness removes thin-fence halo + thick-plate leak. constant/linear kept as toggles.' },
  thickness: { type: 'number', value: 0.5, min: 0.01, max: 10, step: 0.01, label: 'thickness (world)', group: 'scene',
    hint: 'Base occluder thickness (world units). With ottosson this is the floor the occluder-size estimate builds on.' },
  occluderThicknessScale: { type: 'number', value: 0.5, min: 0, max: 4, step: 0.05, label: 'occluder thick scale', group: 'scene',
    hint: 'Ottosson: how fast thickness grows with occluder size (distance from occluder start).' },
  occluderCosLimit: { type: 'number', value: 0.1, min: 0.01, max: 1, step: 0.01, label: 'occluder cos limit', group: 'scene',
    hint: 'Ottosson: reset the occluder-start tracker when the surface turns screen-parallel.' },
  distantLight: { type: 'enum', value: 'off' as DistantMode, options: DISTANT_MODES, label: 'distant light', group: 'scene',
    hint: 'Distant-light sampling on the unoccluded bits. off = closed-scene control. salm-caps = lab 08 verdict. ssrt-fallback = SSRT3 §3.2 probe.' },
  distantIntensity: { type: 'number', value: 1, min: 0, max: 10, step: 0.1, label: 'distant intensity', group: 'scene',
    hint: 'salm-caps env gain (pre-gamma).' },
  capsBits: { type: 'number', value: 4, min: 1, max: 8, step: 1, label: 'salm caps bits/sector', group: 'scene',
    hint: 'salm-caps: bits per spherical cap (1/2/4/8 -> 32/16/8/4 caps). lab 08 default 4 (8 caps).' },
  fallbackSampleCount: { type: 'number', value: 4, min: 2, max: 32, step: 1, label: 'ssrt-fallback ranges', group: 'scene',
    hint: 'ssrt-fallback: contiguous sector ranges, one env ray each.' },
  fallbackPower: { type: 'number', value: 1, min: 1, max: 4, step: 0.05, label: 'distant power', group: 'scene',
    hint: 'Gamma on the distant-light term.' },
  fallbackIntensity: { type: 'number', value: 1, min: 0, max: 10, step: 0.1, label: 'distant final gain', group: 'scene',
    hint: 'Gain on the distant-light term (both modes).' },
  fallbackNormalization: { type: 'boolean', value: true, label: 'FB norm', group: 'scene',
    hint: 'ssrt-fallback weighting: ON = SSRT3-shipped (unoccluded/32). OFF = paper per-subregion.' },
  coneMip: { type: 'boolean', value: false, label: 'cone->mip', group: 'scene',
    hint: 'Derive env blur mip from the sector cone angle instead of hardcoded mip 3.' },
  // --- temporal & denoise (v1 STACK) ---
  temporalAccumulation: { type: 'boolean', value: true, label: 'temporalAccumulation', group: 'temporal',
    hint: 'Reprojected history blend. Eats the per-frame noise cycle.' },
  accumFrameCap: { type: 'number', value: 64, min: 4, max: 1024, step: 1, label: 'accumFrameCap', group: 'temporal',
    hint: 'Max effective history length (unused in v1 oneOverN mode, kept for compatibility).' },
  aaMode: { type: 'enum', value: 'jitter' as const, options: ['jitter'] as const, label: 'AA', group: 'temporal',
    hint: 'v1 fixed to jitter: Halton(2,3) sub-pixel view-offset jitter, velocity unjittered per pixel for true motion history.' },
  spatialFallback: { type: 'boolean', value: true, label: 'spatial fallback', group: 'temporal',
    hint: 'While per-pixel age N < nMin, blend in a depth/normal-weighted bilateral blur, faded out as N -> nMin. Hides the raw-noise boil during re-accumulation.' },
  nMin: { type: 'number', value: 8, min: 1, max: 64, step: 1, label: 'fallback nMin', group: 'temporal',
    hint: 'spatial fallback: age at which the fallback blur has fully faded out (t = clamp(N/nMin, 0, 1)).' },
  denoising: { type: 'boolean', value: false, label: 'denoising (always-on)', group: 'temporal',
    hint: 'Always-on bilateral blur. Default OFF so accumulation is measured bare — spatial fallback covers the ramp instead.' },
  denoisingRadius: { type: 'number', value: 0.5, min: 0, max: 1, step: 0.01, label: 'denoisingRadius', group: 'temporal',
    hint: 'Bilateral kernel radius (always-on denoise AND spatial fallback share it).' },
  // --- sampling & occlusion ---
  expFactor: { type: 'number', value: 1, min: 1, max: 3, step: 0.05, label: 'expFactor', group: 'sampling',
    hint: 'Exponential step distribution. 1 = uniform; higher packs samples near the pixel.' },
  jitterSamples: { type: 'boolean', value: true, label: 'jitterSamples', group: 'sampling',
    hint: 'Randomize the first step offset per pixel (IGN channel z, temporally advanced).' },
  screenSpaceSampling: { type: 'boolean', value: false, label: 'screenSpaceSampling', group: 'sampling',
    hint: 'Fixed screen-space radius instead of world-space projected radius.' },
  mipOptimization: { type: 'boolean', value: true, label: 'mipOptimization', group: 'sampling',
    hint: 'Read coarser depth-pyramid mips for far samples. Pyramid built from march-res depth.' },
  upsampleNormalPhi: { type: 'number', value: 32, min: 1, max: 64, step: 1, label: 'upsample normalPhi', group: 'sampling',
    hint: 'Joint-bilateral upsample normal-dot exponent (higher = stricter edges).' },
  upsampleDepthPhi: { type: 'number', value: 0.05, min: 0.005, max: 0.5, step: 0.005, label: 'upsample depthPhi', group: 'sampling',
    hint: 'Joint-bilateral upsample relative-depth tolerance (lower = tighter).' },
  // --- GI & AO ---
  gatherGI: { type: 'boolean', value: true, label: 'gather GI', group: 'occlusion',
    hint: 'Gather bounced radiance per newly-occluded sector. Forces bitmask ON.' },
  useBitmask: { type: 'boolean', value: true, label: 'VBAO bitmask', group: 'occlusion',
    hint: 'ON = 32-bit visibility-bitmask AO (VBAO). OFF = classic GTAO horizon (validation). GI forces this ON.' },
  sectorRemap: { type: 'boolean', value: true, label: 'sector remap', group: 'occlusion',
    hint: 'Therrien hemisphere narrowing: stops coplanar samples stamping phantom sectors at the tangent.' },
  giIntensity: { type: 'number', value: 10, min: 0, max: 100, step: 0.5, label: 'GI intensity', group: 'occlusion',
    hint: 'GI gain applied at gather.' },
  aoIntensity: { type: 'number', value: 1, min: 0, max: 4, step: 0.05, label: 'AO intensity', group: 'occlusion',
    hint: 'Power curve on final AO. >1 darkens.' },
  multiBounceGI: { type: 'number', value: 0, min: 0, max: 1, step: 0.01, label: 'multiBounceGI', group: 'occlusion',
    hint: 'Feed last frame\'s GI back into the light buffer for 2nd+ bounces.' },
  mbDamping: { type: 'number', value: 0.5, min: 0, max: 1, step: 0.05, label: 'mb feedback damping', group: 'occlusion',
    hint: 'Attenuates the multibounce feedback each frame.' },
  multiBounceAO: { type: 'boolean', value: false, label: 'multiBounceAO (composite)', group: 'occlusion',
    hint: 'Jimenez multi-bounce AO: brightens AO where albedo is bright.' },
  backfaceLighting: { type: 'number', value: 0, min: 0, max: 1, step: 0.01, label: 'backfaceLighting', group: 'occlusion',
    hint: 'How much light back-facing samples contribute. 0 = reject backfaces.' },
  maxLuminance: { type: 'number', value: 7, min: 1, max: 30, step: 0.5, label: 'firefly clamp', group: 'occlusion',
    hint: 'Clamp per-sample radiance luminance to kill fireflies.' },
  normalApproximation: { type: 'boolean', value: false, label: 'normalApproximation', group: 'occlusion',
    hint: 'Reconstruct sample normals from positions instead of reading the normal buffer.' },
  linearThickK: { type: 'number', value: 0.05, min: 0, max: 1, step: 0.01, label: 'linear thick slope', group: 'occlusion',
    hint: 'linear-over-distance heuristic: thickness grows this fast with march distance.' },
  freezeNoise: { type: 'boolean', value: false, label: 'freeze noise cycle', group: 'occlusion',
    hint: 'Pin the per-frame noise cycle for inspecting static patterns.' },
} as const;

export const shipStackDemo: DemoDef = {
  id: '19-ship',
  label: 'v1 Ship Stack (oneOverN+spatial-denoise)',
  create: () => new ShipStackDemo(),
};
