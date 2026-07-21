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
import { traa } from 'three/addons/tsl/display/TRAANode.js';
import { denoise } from 'three/addons/tsl/display/DenoiseNode.js';
import type { DepthTexture, PerspectiveCamera, Texture } from 'three/webgpu';
import type { Demo, DemoDef, HarnessContext } from '../../harness/types';
import { RawComputePass } from '../../harness/raw-compute-pass';
import { HALTON_JITTER, applyCameraJitter, clearCameraJitter } from '../../harness/temporal';
import { ensureTexture, ensureRenderTarget } from '../../harness/three-internals';
import { Comparator } from '../../harness/compare';
import type { CompareMode } from '../../harness/compare';
import { buildParams } from '../../harness/params';
import type { ParamGroup } from '../../harness/params';
// Producer + two stacks are REUSED verbatim from demo 03 (the experimental
// control: identical noisy input signal for every denoiser stack).
import mainWgsl from '../03-ssrt3/ssrt-main.wgsl?raw';
// Frozen fork, NOT demo 03's live file: that file's binding layout changed
// with the frame-count-accumulation rewrite (c77e960) and this lab wants the
// faithful SSRT3 EMA temporal regardless. See the fork's header.
import ssrtTemporalWgsl from './ssrt3-temporal-ema.wgsl?raw';
import ssrtDenoiseWgsl from '../03-ssrt3/ssrt-denoise.wgsl?raw';
import mathisWgsl from './denoise-mathis.wgsl?raw';
import xeSpatialWgsl from './denoise-xegtao-spatial.wgsl?raw';
import xeTemporalWgsl from './denoise-xegtao-temporal.wgsl?raw';
import accumulateWgsl from './accumulate.wgsl?raw';
import blitWgsl from './blit.wgsl?raw';

// Demo 10 — denoise lab. One FIXED noisy producer (demo 03's march at rc1/sc8,
// jitter on) feeds pluggable, A/B-comparable denoiser stacks. See README.

/* eslint-disable @typescript-eslint/no-explicit-any */
type Node = any;

const STACKS = ['none', 'ssrt3', 'mathis', 'xegtao', 'denoise-node'] as const;
type Stack = (typeof STACKS)[number];

const VIEW_MODES = ['combined', 'gi', 'ao', 'raw-gi', 'reference', 'split'] as const;
type ViewMode = (typeof VIEW_MODES)[number];

// Producer flags (mirror ssrt-main.wgsl): bitmask | jitter | gi. Deliberately
// noisy: rotationCount 1, stepCount 8, per-frame jitter — the experimental control.
const F_BITMASK = 1;
const F_JITTER = 2;
const F_GI = 512;
const PRODUCER_FLAGS = F_BITMASK | F_JITTER | F_GI;
const PROD_ROTATION = 1;
const PROD_STEP = 8;

// Producer per-frame temporal cycles (SSRT3) so successive frames sample
// different points and the temporal/accumulate stacks can converge.
const TEMPORAL_ROTATIONS = [60, 300, 180, 240, 120, 0];
const SPATIAL_OFFSETS = [0.0, 0.5, 0.25, 0.75];

function sceneDefaults(sceneId: string): { radius: number; thickness: number } {
  if (sceneId === 'sponza') return { radius: 8, thickness: 2 };
  if (sceneId === 'artifact-zoo') return { radius: 3, thickness: 0.3 };
  return { radius: 5, thickness: 0.5 }; // cornell
}

// --- procedural equirect ambient (producer fallback binding; fallback is OFF so
// it is never sampled, but the main-march binding layout requires it). Copied
// from demo 03 so the reused ssrt-main.wgsl binds cleanly. ---
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

// Uniform sizes (floats).
const U_FLOATS = 72; // producer (demo 03 layout)
const SSRT_T_FLOATS = 40;
const SSRT_D_FLOATS = 8;
const MATHIS_FLOATS = 24; // mat4(16) + res.xy + near + far + reset + cap + biScale + depthThresh
const XE_S_FLOATS = 8;
const XE_T_FLOATS = 8;
const ACC_FLOATS = 4;

const schema = {
  stack: { type: 'enum', value: 'ssrt3' as Stack, options: STACKS, label: 'denoiser stack' },
  viewMode: { type: 'enum', value: 'combined' as ViewMode, options: VIEW_MODES, label: 'view' },
  traa: { type: 'boolean', value: false, label: 'TRAA after (combined)' },
  // Forced OFF when TRAA is on: traa() drives its OWN Halton view-offset jitter,
  // so ours would double-jitter. See applyJitter() / updateOutputNode().
  jitterAA: { type: 'boolean', value: false, label: 'subpixel AA jitter (off under TRAA)' },
  giExposure: { type: 'number', value: 1, min: 0.1, max: 8, step: 0.05, label: 'GI display gain' },
  // --- SSRT3 stack ---
  temporalResponse: { type: 'number', value: 0.35, min: 0, max: 1, step: 0.01, label: 'ssrt temporalResponse' },
  denoisingRadius: { type: 'number', value: 0.5, min: 0, max: 1, step: 0.01, label: 'ssrt denoisingRadius' },
  ssrtTemporal: { type: 'boolean', value: true, label: 'ssrt temporal on' },
  ssrtDenoise: { type: 'boolean', value: true, label: 'ssrt bilateral on' },
  // --- Mathis stack ---
  mathisCap: { type: 'number', value: 64, min: 4, max: 256, step: 1, label: 'mathis accum cap' },
  mathisBilateral: { type: 'number', value: 1, min: 0.5, max: 3, step: 0.1, label: 'mathis bilateral' },
  mathisDepthThresh: { type: 'number', value: 0.1, min: 0.01, max: 0.5, step: 0.01, label: 'mathis reproj rej' },
  // --- XeGTAO stack ---
  xeRadius: { type: 'number', value: 1, min: 1, max: 3, step: 1, label: 'xe spatial step' },
  xeSharpness: { type: 'number', value: 40, min: 4, max: 120, step: 1, label: 'xe depth sharpness' },
  xeAlpha: { type: 'number', value: 0.1, min: 0.02, max: 1, step: 0.01, label: 'xe temporal alpha' },
  xeDepthThresh: { type: 'number', value: 0.1, min: 0.01, max: 0.5, step: 0.01, label: 'xe reproj rej' },
  // --- three DenoiseNode stack ---
  dnLumaPhi: { type: 'number', value: 5, min: 0.5, max: 20, step: 0.5, label: 'dn lumaPhi' },
  dnDepthPhi: { type: 'number', value: 5, min: 0.5, max: 20, step: 0.5, label: 'dn depthPhi' },
  dnNormalPhi: { type: 'number', value: 5, min: 0.5, max: 20, step: 0.5, label: 'dn normalPhi' },
  dnRadius: { type: 'number', value: 5, min: 1, max: 20, step: 0.5, label: 'dn radius' },
  // --- comparator (split view: active stack vs converged reference) ---
  compareMode: { type: 'enum', value: 'split' as CompareMode, options: ['split', 'diff'], label: 'A/B mode' },
  diffAmp: { type: 'number', value: 8, min: 1, max: 50, step: 0.5, label: 'diff amp' },
} as const;

const REBUILD_KEYS = new Set(['stack', 'viewMode', 'traa']);

class DenoiseLabDemo implements Demo {
  private beautyTex!: Texture;
  private albedoTex!: Texture;
  private normalTex!: Texture;
  private velocityTex!: Texture;
  private depthTex!: DepthTexture;

  private scenePass!: ReturnType<typeof pass>;
  private gbufferPipeline!: RenderPipeline;
  private displayPipeline!: RenderPipeline;

  // Producer output (rgb = GI, a = AO), stable.
  private giAoTex = this.makeStorage();
  // SSRT3 stack.
  private ssrtHistA = this.makeStorage();
  private ssrtHistB = this.makeStorage();
  private ssrtFinal = this.makeStorage(); // stable display source
  // Mathis stack.
  private mathisColorA = this.makeStorage();
  private mathisColorB = this.makeStorage();
  private mathisCountA = this.makeScalar();
  private mathisCountB = this.makeScalar();
  // XeGTAO stack.
  private xeSpatial = this.makeStorage();
  private xeHistA = this.makeStorage();
  private xeHistB = this.makeStorage();
  // Accumulate reference.
  private accA = this.makeStorage();
  private accB = this.makeStorage();
  // Stable bridges the display graph samples (ping-pong -> stable via blit).
  private stackOut = this.makeStorage();
  private refOut = this.makeStorage();
  // Producer fallback bindings (unused: fallback off).
  private depthPyramid = this.makePyramid();
  private envSampler!: GPUSampler;
  private envTex!: DataTexture;
  // Comparator target (RenderTarget the harness Comparator writes).
  private compareRT = this.makeRT();

  private main!: RawComputePass;
  private ssrtTemporal!: RawComputePass;
  private ssrtDenoise!: RawComputePass;
  private mathis!: RawComputePass;
  private xeSpatialPass!: RawComputePass;
  private xeTemporalPass!: RawComputePass;
  private accumulate!: RawComputePass;
  private blit!: RawComputePass;
  private comparator!: Comparator;

  private mainData = new Float32Array(U_FLOATS);
  private mainU32 = new Uint32Array(this.mainData.buffer);
  private stData = new Float32Array(SSRT_T_FLOATS);
  private stU32 = new Uint32Array(this.stData.buffer);
  private sdData = new Float32Array(SSRT_D_FLOATS);
  private sdU32 = new Uint32Array(this.sdData.buffer);
  private mData = new Float32Array(MATHIS_FLOATS);
  private mU32 = new Uint32Array(this.mData.buffer);
  private xsData = new Float32Array(XE_S_FLOATS);
  private xtData = new Float32Array(XE_T_FLOATS);
  private xtU32 = new Uint32Array(this.xtData.buffer);
  private accData = new Float32Array(ACC_FLOATS);
  private accU32 = new Uint32Array(this.accData.buffer);

  private invViewProj = new Matrix4();
  private prevInvViewProj = new Matrix4();
  private ping = true;
  private device!: GPUDevice;
  private frameCounter = 0;
  private accumCount = 0;
  private jitterIndex = 0;
  private jitterActive = false;
  private reset = true;
  private lastPose = new Float64Array(8);
  private lastW = 1;
  private lastH = 1;
  private sceneId = 'cornell';

  private uGiExposure = uniform(1);
  private denoiseNode: (Node & { index: Node; dispose?(): void }) | null = null;
  private traaNode: { dispose?(): void } | null = null;
  private camera!: PerspectiveCamera;

  // TSL texture nodes off the scene pass (for DenoiseNode / TRAA).
  private depthNode!: Node;
  private normalNode!: Node;
  private velocityNode!: Node;

  private params!: ParamGroup<typeof schema>;
  private compareState = { splitX: 0.5 };
  private dragging = false;
  private pointerHandlers: Array<[keyof HTMLElementEventMap, EventListener]> = [];

  private makeStorage(): StorageTexture {
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
    this.camera = ctx.scene.camera;

    this.scenePass = pass(ctx.scene.scene, this.camera);
    this.scenePass.setMRT(mrt({ output, albedo: diffuseColor, normal: normalView, velocity }));
    this.beautyTex = this.scenePass.getTexture('output');
    this.albedoTex = this.scenePass.getTexture('albedo');
    this.normalTex = this.scenePass.getTexture('normal');
    this.velocityTex = this.scenePass.getTexture('velocity');
    this.scenePass.getTexture('albedo').type = UnsignedByteType;
    this.depthTex = this.scenePass.renderTarget.depthTexture!;

    this.depthNode = this.scenePass.getTextureNode('depth');
    this.normalNode = this.scenePass.getTextureNode('normal');
    this.velocityNode = this.scenePass.getTextureNode('velocity');

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
    this.main = new RawComputePass(ctx.renderer, 'd10-main', mainWgsl, {
      bindings: [
        { kind: 'depth' }, { kind: 'tex' }, { kind: 'tex' }, { kind: 'sampledTex' },
        { kind: 'sampler', filtering: true }, { kind: 'tex' },
        { kind: 'storage', format: 'rgba16float' }, { kind: 'uniform' },
      ],
    });
    // SSRT3 stack (reused).
    this.ssrtTemporal = new RawComputePass(ctx.renderer, 'd10-ssrt-temporal', ssrtTemporalWgsl, {
      bindings: [
        { kind: 'tex' }, { kind: 'tex' }, { kind: 'tex' }, { kind: 'depth' },
        { kind: 'storage', format: 'rgba16float' }, { kind: 'uniform' },
      ],
    });
    this.ssrtDenoise = new RawComputePass(ctx.renderer, 'd10-ssrt-denoise', ssrtDenoiseWgsl, {
      bindings: [
        { kind: 'tex' }, { kind: 'depth' }, { kind: 'tex' },
        { kind: 'storage', format: 'rgba16float' }, { kind: 'uniform' },
      ],
    });
    // Mathis stack: raw, histColor, histCount, depth, normal, vel -> outColor, outCount.
    this.mathis = new RawComputePass(ctx.renderer, 'd10-mathis', mathisWgsl, {
      bindings: [
        { kind: 'tex' }, { kind: 'tex' }, { kind: 'tex' }, { kind: 'depth' },
        { kind: 'tex' }, { kind: 'tex' },
        { kind: 'storage', format: 'rgba16float' }, { kind: 'storage', format: 'r32float' },
        { kind: 'uniform' },
      ],
    });
    // XeGTAO stack.
    this.xeSpatialPass = new RawComputePass(ctx.renderer, 'd10-xe-spatial', xeSpatialWgsl, {
      bindings: [
        { kind: 'tex' }, { kind: 'depth' }, { kind: 'tex' },
        { kind: 'storage', format: 'rgba16float' }, { kind: 'uniform' },
      ],
    });
    this.xeTemporalPass = new RawComputePass(ctx.renderer, 'd10-xe-temporal', xeTemporalWgsl, {
      bindings: [
        { kind: 'tex' }, { kind: 'tex' }, { kind: 'tex' }, { kind: 'depth' },
        { kind: 'storage', format: 'rgba16float' }, { kind: 'uniform' },
      ],
    });
    // Accumulate reference.
    this.accumulate = new RawComputePass(ctx.renderer, 'd10-accum', accumulateWgsl, {
      bindings: [
        { kind: 'tex' }, { kind: 'tex' },
        { kind: 'storage', format: 'rgba16float' }, { kind: 'uniform' },
      ],
    });
    // Blit (ping-pong -> stable). No uniform.
    this.blit = new RawComputePass(ctx.renderer, 'd10-blit', blitWgsl, {
      bindings: [{ kind: 'tex' }, { kind: 'storage', format: 'rgba16float' }],
    });
    this.comparator = new Comparator(ctx.renderer, 'd10-compare');

    this.resize(ctx);
    this.main.configure(this.mainData.byteLength);
    this.ssrtTemporal.configure(this.stData.byteLength);
    this.ssrtDenoise.configure(this.sdData.byteLength);
    this.mathis.configure(this.mData.byteLength);
    this.xeSpatialPass.configure(this.xsData.byteLength);
    this.xeTemporalPass.configure(this.xtData.byteLength);
    this.accumulate.configure(this.accData.byteLength);
    this.blit.configure(0);
    this.comparator.configure(this.compareRT);

    const folder = ctx.pane.addFolder({ title: 'Demo 10 — Denoise lab' });
    this.params = buildParams(folder, schema);
    this.params.onChange((key) => {
      if (REBUILD_KEYS.has(key as string)) this.updateOutputNode();
      // Toggling jitter (or TRAA, which forces jitter off) changes what the
      // camera rasterizes with, so restart the converged accumulate reference.
      if (key === 'jitterAA' || key === 'traa') this.reset = true;
    });

    // URL overrides for deterministic captures.
    const q = new URLSearchParams(window.location.search);
    const urlStack = q.get('stack');
    if (urlStack && (STACKS as readonly string[]).includes(urlStack)) this.params.values.stack = urlStack as Stack;
    const urlView = q.get('view');
    if (urlView && (VIEW_MODES as readonly string[]).includes(urlView)) this.params.values.viewMode = urlView as ViewMode;
    if (q.get('traa') === '1') this.params.values.traa = true;
    const urlJitter = q.get('jitter'); // ?jitter=0/1 AA override
    if (urlJitter === '0' || urlJitter === '1') this.params.values.jitterAA = urlJitter === '1';
    this.params.refresh();

    this.updateOutputNode();
    this.installDividerDrag(ctx);

    (window as unknown as { __denoise10bench?: (n: number) => Promise<number> }).__denoise10bench = (n: number) =>
      this.runBench(n);
  }

  // Builds the DenoiseNode (needs scene depth/normal TSL nodes) lazily.
  private ensureDenoiseNode(): Node {
    if (!this.denoiseNode) {
      this.denoiseNode = denoise(texture(this.giAoTex, screenUV), this.depthNode, this.normalNode, this.camera);
    }
    return this.denoiseNode;
  }

  // The active stack's denoised GI/AO as a TSL vec4 node.
  private activeGiAoNode(stack: Stack): Node {
    const uv = screenUV;
    switch (stack) {
      case 'ssrt3':
        return texture(this.ssrtFinal, uv);
      case 'denoise-node':
        return this.ensureDenoiseNode();
      // none / mathis / xegtao all resolve through the stable stackOut bridge.
      default:
        return texture(this.stackOut, uv);
    }
  }

  private updateOutputNode(): void {
    const v = this.params.values;
    const uv = screenUV;
    this.displayPipeline.needsUpdate = true;

    // Dispose a previous TRAA wrapper and clear any camera view-offset it set.
    if (this.traaNode?.dispose) this.traaNode.dispose();
    this.traaNode = null;
    this.camera.clearViewOffset();

    if (v.viewMode === 'split') {
      this.displayPipeline.outputNode = vec4(texture(this.compareRT.texture, uv).rgb, float(1));
      return;
    }
    if (v.viewMode === 'reference') {
      this.displayPipeline.outputNode = vec4(texture(this.refOut, uv).rgb.mul(this.uGiExposure), float(1));
      return;
    }
    if (v.viewMode === 'raw-gi') {
      this.displayPipeline.outputNode = vec4(texture(this.giAoTex, uv).rgb.mul(this.uGiExposure), float(1));
      return;
    }

    const giao = this.activeGiAoNode(v.stack);
    const ao = giao.a;
    const gi = giao.rgb.mul(this.uGiExposure);
    if (v.viewMode === 'ao') {
      this.displayPipeline.outputNode = vec4(vec3(ao), float(1));
      return;
    }
    if (v.viewMode === 'gi') {
      this.displayPipeline.outputNode = vec4(gi, float(1));
      return;
    }
    // combined: beauty * AO + albedo * GI (demo-03 composite).
    const beauty = texture(this.beautyTex, uv).rgb;
    const albedo = texture(this.albedoTex, uv).rgb;
    const composite = vec4(beauty.mul(vec3(ao)).add(albedo.mul(gi)), float(1));
    if (v.traa) {
      // traa() wraps its beauty input with convertToTexture (-> RTTNode), so we
      // pass the composite directly (same as demo 01).
      // FIDELITY NOTE (README): the raw producer is NOT camera-jittered, so TRAA
      // acts as a temporal stabilizer of each stack's output rather than a full
      // jittered-AA resolve — which is exactly the "how does this feed a TAA
      // consumer" question the lab measures.
      const t = traa(composite, this.depthNode, this.velocityNode, this.camera);
      this.traaNode = t as unknown as { dispose?(): void };
      this.displayPipeline.outputNode = t;
    } else {
      this.displayPipeline.outputNode = composite;
    }
  }

  // Advance/apply Halton jitter, or clear it once when disabled. GUARD: forced
  // off when TRAA is on — traa() registers its own onBeforeRenderPipeline
  // view-offset jitter, so ours would double up. When off, this clears our
  // offset once; updateOutputNode() also clears on rebuild, which is harmless
  // (next frame's enabled path re-applies).
  private applyJitter(w: number, h: number, enabled: boolean): void {
    if (enabled) {
      const [jx, jy] = HALTON_JITTER[this.jitterIndex];
      this.jitterIndex = (this.jitterIndex + 1) % HALTON_JITTER.length;
      applyCameraJitter(this.camera, w, h, jx, jy);
      this.jitterActive = true;
    } else if (this.jitterActive) {
      clearCameraJitter(this.camera);
      this.jitterActive = false;
    }
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
    const { width, height } = ctx.renderSize();
    const v = this.params.values;

    // 0. Sub-pixel jitter before the G-buffer rasterizes (producer + accumulate
    // reference read the jittered projection). OFF under TRAA (it self-jitters).
    this.applyJitter(width, height, v.jitterAA && !v.traa);

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

    // 4. Accumulate converged reference (always; CPU-driven count).
    this.invViewProj.multiplyMatrices(cam.matrixWorld, cam.projectionMatrixInverse);
    if (reset) this.accumCount = 0;
    const accRead = this.ping ? this.accB : this.accA;
    const accWrite = this.ping ? this.accA : this.accB;
    this.accData[0] = width; this.accData[1] = height;
    this.accData[2] = this.accumCount;
    this.accU32[3] = reset;
    this.accumulate.execute([this.giAoTex, accRead, accWrite, this.accData], width, height);
    this.blit.execute([accWrite, this.refOut], width, height);

    // 5. Active denoiser stack.
    this.runStack(v.stack, cam, width, height, reset);

    // 6. Split A/B: active stack output vs converged reference.
    if (v.viewMode === 'split') {
      const aTex = v.stack === 'ssrt3' ? this.ssrtFinal
        : v.stack === 'denoise-node' ? this.giAoTex // node not a texture; show raw vs ref (documented)
          : this.stackOut;
      this.comparator.execute(this.compareRT, aTex, this.refOut, width, height, {
        mode: v.compareMode, splitX: this.compareState.splitX, amp: v.diffAmp,
        scaleA: v.giExposure, scaleB: v.giExposure, channel: 'rgb',
      });
    }

    // 7. DenoiseNode needs its frame index bumped for spatiotemporal rotation.
    if (v.stack === 'denoise-node' && this.denoiseNode) {
      this.denoiseNode.index.value = this.frameCounter;
    }

    // 8. Display.
    this.displayPipeline.render();
    ctx.timing.sampleGPU(ctx.renderer);

    // 9. Advance state.
    this.prevInvViewProj.copy(this.invViewProj);
    this.ping = !this.ping;
    if (!reset) this.accumCount = Math.min(4096, this.accumCount + 1);
    this.reset = false;
    this.lastW = width;
    this.lastH = height;
  }

  private runStack(stack: Stack, cam: PerspectiveCamera, width: number, height: number, reset: number): void {
    const v = this.params.values;
    if (stack === 'none') {
      this.blit.execute([this.giAoTex, this.stackOut], width, height);
      return;
    }
    if (stack === 'ssrt3') {
      const histRead = this.ping ? this.ssrtHistB : this.ssrtHistA;
      const histWrite = this.ping ? this.ssrtHistA : this.ssrtHistB;
      // temporal
      this.stData.set(this.invViewProj.elements, 0);
      this.stData.set(this.prevInvViewProj.elements, 16);
      this.stData[32] = width; this.stData[33] = height; this.stData[34] = cam.near; this.stData[35] = cam.far;
      this.stData[36] = v.temporalResponse;
      let tflags = 0;
      if (v.ssrtTemporal) tflags |= 1;
      if (reset) tflags |= 2;
      this.stU32[37] = tflags; this.stData[38] = 0; this.stData[39] = 0;
      this.ssrtTemporal.execute([this.giAoTex, histRead, this.velocityTex, this.depthTex, histWrite, this.stData], width, height);
      // bilateral -> ssrtFinal (stable)
      this.sdData[0] = width; this.sdData[1] = height; this.sdData[2] = cam.near; this.sdData[3] = cam.far;
      this.sdData[4] = v.denoisingRadius; this.sdU32[5] = v.ssrtDenoise ? 1 : 0; this.sdData[6] = 0; this.sdData[7] = 0;
      this.ssrtDenoise.execute([histWrite, this.depthTex, this.normalTex, this.ssrtFinal, this.sdData], width, height);
      return;
    }
    if (stack === 'mathis') {
      const colorRead = this.ping ? this.mathisColorB : this.mathisColorA;
      const colorWrite = this.ping ? this.mathisColorA : this.mathisColorB;
      const countRead = this.ping ? this.mathisCountB : this.mathisCountA;
      const countWrite = this.ping ? this.mathisCountA : this.mathisCountB;
      this.mData.set(cam.projectionMatrixInverse.elements, 0);
      this.mData[16] = width; this.mData[17] = height; this.mData[18] = cam.near; this.mData[19] = cam.far;
      this.mU32[20] = reset; this.mU32[21] = v.mathisCap;
      this.mData[22] = v.mathisBilateral; this.mData[23] = v.mathisDepthThresh;
      this.mathis.execute(
        [this.giAoTex, colorRead, countRead, this.depthTex, this.normalTex, this.velocityTex, colorWrite, countWrite, this.mData],
        width, height,
      );
      this.blit.execute([colorWrite, this.stackOut], width, height);
      return;
    }
    if (stack === 'xegtao') {
      const histRead = this.ping ? this.xeHistB : this.xeHistA;
      const histWrite = this.ping ? this.xeHistA : this.xeHistB;
      this.xsData[0] = width; this.xsData[1] = height; this.xsData[2] = cam.near; this.xsData[3] = cam.far;
      this.xsData[4] = v.xeRadius; this.xsData[5] = v.xeSharpness; this.xsData[6] = 0; this.xsData[7] = 0;
      this.xeSpatialPass.execute([this.giAoTex, this.depthTex, this.normalTex, this.xeSpatial, this.xsData], width, height);
      this.xtData[0] = width; this.xtData[1] = height; this.xtData[2] = cam.near; this.xtData[3] = cam.far;
      this.xtData[4] = v.xeAlpha; this.xtData[5] = v.xeDepthThresh; this.xtU32[6] = reset; this.xtData[7] = 0;
      this.xeTemporalPass.execute([this.xeSpatial, histRead, this.velocityTex, this.depthTex, histWrite, this.xtData], width, height);
      this.blit.execute([histWrite, this.stackOut], width, height);
      return;
    }
    // denoise-node: no compute (TSL node in the display graph).
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
    // Live DenoiseNode uniforms (cheap; only referenced when that stack is active).
    if (this.denoiseNode) {
      const v = this.params.values;
      this.denoiseNode.lumaPhi.value = v.dnLumaPhi;
      this.denoiseNode.depthPhi.value = v.dnDepthPhi;
      this.denoiseNode.normalPhi.value = v.dnNormalPhi;
      this.denoiseNode.radius.value = v.dnRadius;
    }
  }

  // Compute-only GPU cost of the ACTIVE stack (producer + stack), fenced on
  // queue.onSubmittedWorkDone() over n iterations. Exposed on window for headless
  // timing (the vsync rAF loop hides sub-frame compute cost). Returns ms/iter.
  async runBench(n: number): Promise<number> {
    const w = this.lastW, h = this.lastH;
    const cam = this.camera;
    const v = this.params.values;
    await this.device.queue.onSubmittedWorkDone();
    const t0 = performance.now();
    for (let i = 0; i < n; i++) {
      this.main.execute(
        [this.depthTex, this.normalTex, this.beautyTex, this.envTex, this.envSampler, this.depthPyramid, this.giAoTex, this.mainData],
        w, h,
      );
      this.runStack(v.stack, cam, w, h, 0);
    }
    await this.device.queue.onSubmittedWorkDone();
    return (performance.now() - t0) / n;
  }

  private installDividerDrag(ctx: HarnessContext): void {
    const el = ctx.renderer.domElement;
    const near = (clientX: number): boolean => Math.abs(clientX / el.clientWidth - this.compareState.splitX) < 0.04;
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
    const storages = [
      this.giAoTex, this.ssrtHistA, this.ssrtHistB, this.ssrtFinal,
      this.mathisColorA, this.mathisColorB, this.xeSpatial, this.xeHistA, this.xeHistB,
      this.accA, this.accB, this.stackOut, this.refOut,
      this.mathisCountA, this.mathisCountB, this.depthPyramid,
    ];
    for (const t of storages) {
      t.image = { width, height };
      t.dispose();
      ensureTexture(ctx.renderer, t);
    }
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
    if (this.traaNode?.dispose) this.traaNode.dispose();
    this.denoiseNode?.dispose?.();
    const all = [
      this.giAoTex, this.ssrtHistA, this.ssrtHistB, this.ssrtFinal,
      this.mathisColorA, this.mathisColorB, this.mathisCountA, this.mathisCountB,
      this.xeSpatial, this.xeHistA, this.xeHistB, this.accA, this.accB,
      this.stackOut, this.refOut, this.depthPyramid, this.envTex,
    ];
    for (const t of all) t.dispose();
    this.compareRT.dispose();
  }
}

export const denoiseLabDemo: DemoDef = {
  id: '10-denoise',
  label: '10 — Denoise lab',
  create: () => new DenoiseLabDemo(),
};
