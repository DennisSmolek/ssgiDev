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
import { Upscaler } from '@pmndrs/upscaler';
import type { DepthTexture, PerspectiveCamera, Texture } from 'three/webgpu';
import type { Demo, DemoDef, HarnessContext } from '../../harness/types';
import { RawComputePass } from '../../harness/raw-compute-pass';
import { TemporalGuidesPass } from '../../harness/temporal-guides';
import { ensureTexture, ensureRenderTarget } from '../../harness/three-internals';
import { Comparator } from '../../harness/compare';
import type { CompareMode } from '../../harness/compare';
import { buildParams } from '../../harness/params';
import type { ParamGroup } from '../../harness/params';
// Producer + denoise are REUSED live from demo 03 (frozen; same pattern demo
// 10 uses) — the experimental control: identical noisy input signal, identical
// bilateral, for BOTH guide arms.
import mainWgsl from '../03-ssrt3/ssrt-main.wgsl?raw';
import ssrtDenoiseWgsl from '../03-ssrt3/ssrt-denoise.wgsl?raw';
// The M6 rig itself: ONE temporal shader fed by either guide source (see the
// file header for the exact substitution + the motionIsUVDelta convention flag).
import guidesAbTemporalWgsl from './guides-ab-temporal.wgsl?raw';
// Trivial utility passes, owned copies of the frozen demo 10 files (see their
// headers) so this lab has no dependency on a frozen demo's internals.
import accumulateWgsl from './accumulate.wgsl?raw';
import blitWgsl from './blit.wgsl?raw';

// Demo 17 — guides-source A/B lab. The FSR3 upscaler's M6 exit criterion: the
// SAME SSGI temporal stack (guides-ab-temporal.wgsl) fed by (A) the bench's
// private TemporalGuidesPass vs (B) the FSR3 upscaler's guides bundle
// (`upscaler.guides`, path: 'guides', dispatchGuides only — no color, no
// upscale). Cloned from demo 10's rig (producer, temporal, denoise, accumulate
// reference, Comparator, blit, param plumbing, reset logic); NOT cloned: TRAA,
// camera AA jitter, the mathis/xegtao/denoise-node stacks — none of those bear
// on which guide SOURCE feeds the temporal pass, which is the only question
// this lab asks. See README.md for the full write-up.

/* eslint-disable @typescript-eslint/no-explicit-any */
type Node = any;

const STACKS = ['none', 'private-guides', 'fsr-guides'] as const;
type Stack = (typeof STACKS)[number];

const VIEW_MODES = ['combined', 'gi', 'reference', 'split', 'guides'] as const;
type ViewMode = (typeof VIEW_MODES)[number];

// Producer flags (mirror ssrt-main.wgsl): bitmask | jitter | gi. Same
// deliberately-noisy control demo 10 uses: rotationCount 1, stepCount 8,
// internal hemisphere-sample jitter on (NOT camera projection jitter — this
// demo never offsets the camera, both arms must see an identical G-buffer).
const F_BITMASK = 1;
const F_JITTER = 2;
const F_GI = 512;
const PRODUCER_FLAGS = F_BITMASK | F_JITTER | F_GI;
const PROD_ROTATION = 1;
const PROD_STEP = 8;

// Producer per-frame temporal cycles (SSRT3) so successive frames sample
// different points and the temporal stacks can converge.
const TEMPORAL_ROTATIONS = [60, 300, 180, 240, 120, 0];
const SPATIAL_OFFSETS = [0.0, 0.5, 0.25, 0.75];

function sceneDefaults(sceneId: string): { radius: number; thickness: number } {
  if (sceneId === 'sponza') return { radius: 8, thickness: 2 };
  if (sceneId === 'artifact-zoo') return { radius: 3, thickness: 0.3 };
  return { radius: 5, thickness: 0.5 }; // cornell
}

// --- procedural equirect ambient (producer fallback binding; fallback is OFF so
// it is never sampled, but the main-march binding layout requires it). Copied
// from demo 03/10 so the reused ssrt-main.wgsl binds cleanly. ---
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
const T_FLOATS = 40; // guides-ab-temporal TParams
const D_FLOATS = 8; // ssrt-denoise DParams
const ACC_FLOATS = 4;

const schema = {
  stack: { type: 'enum', value: 'private-guides' as Stack, options: STACKS, label: 'guide source' },
  viewMode: { type: 'enum', value: 'combined' as ViewMode, options: VIEW_MODES, label: 'view' },
  giExposure: { type: 'number', value: 1, min: 0.1, max: 8, step: 0.05, label: 'GI display gain' },
  // --- shared temporal + bilateral (both guide arms; 'none' ignores) ---
  temporalResponse: { type: 'number', value: 0.35, min: 0, max: 1, step: 0.01, label: 'temporalResponse' },
  denoisingRadius: { type: 'number', value: 0.5, min: 0, max: 1, step: 0.01, label: 'denoisingRadius' },
  temporalOn: { type: 'boolean', value: true, label: 'temporal on' },
  denoiseOn: { type: 'boolean', value: true, label: 'bilateral on' },
  // --- side A: private TemporalGuidesPass tunables ---
  guidesDisoccLo: { type: 'number', value: 0.02, min: 0, max: 0.5, step: 0.005, label: 'disocc lo', group: 'private guides' },
  guidesDisoccHi: { type: 'number', value: 0.1, min: 0.01, max: 1, step: 0.005, label: 'disocc hi', group: 'private guides' },
  guidesResetThresh: { type: 'number', value: 0.5, min: 0.05, max: 1, step: 0.01, label: 'N-reset disocc', group: 'private guides' },
  guidesHistoryCap: { type: 'number', value: 64, min: 4, max: 256, step: 1, label: 'history cap', group: 'private guides' },
  // --- guides debug view ---
  guidesVelScale: { type: 'number', value: 20, min: 1, max: 200, step: 1, label: '|vel| gain', group: 'guides view' },
  // --- comparator (split view: active arm vs converged reference) ---
  compareMode: { type: 'enum', value: 'split' as CompareMode, options: ['split', 'diff'], label: 'A/B mode' },
  diffAmp: { type: 'number', value: 8, min: 1, max: 50, step: 0.5, label: 'diff amp' },
} as const;

const REBUILD_KEYS = new Set(['stack', 'viewMode']);

class GuidesAbLabDemo implements Demo {
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
  // Side A (private guides) — dedicated history so switching arms stays clean.
  private privateHistA = this.makeStorage();
  private privateHistB = this.makeStorage();
  private privateFinal = this.makeStorage(); // stable display source
  // Side B (FSR guides) — dedicated history.
  private fsrHistA = this.makeStorage();
  private fsrHistB = this.makeStorage();
  private fsrFinal = this.makeStorage(); // stable display source
  // 'none' passthrough (control: raw producer, no denoise).
  private noneOut = this.makeStorage();
  // Accumulate reference (converged pseudo-truth of the SAME producer).
  private accA = this.makeStorage();
  private accB = this.makeStorage();
  private refOut = this.makeStorage();
  // Producer fallback bindings (unused: fallback off).
  private depthPyramid = this.makePyramid();
  private envSampler!: GPUSampler;
  private envTex!: DataTexture;
  // Comparator target (RenderTarget the harness Comparator writes).
  private compareRT = this.makeRT();

  private main!: RawComputePass;
  private guidesTemporal!: RawComputePass; // ONE pass, reused for both arms
  private guides!: TemporalGuidesPass; // side A
  private upscaler!: Upscaler; // side B
  private ssrtDenoise!: RawComputePass;
  private accumulate!: RawComputePass;
  private blit!: RawComputePass;
  private comparator!: Comparator;

  private mainData = new Float32Array(U_FLOATS);
  private mainU32 = new Uint32Array(this.mainData.buffer);
  private tData = new Float32Array(T_FLOATS);
  private tU32 = new Uint32Array(this.tData.buffer);
  private dData = new Float32Array(D_FLOATS);
  private dU32 = new Uint32Array(this.dData.buffer);
  private accData = new Float32Array(ACC_FLOATS);
  private accU32 = new Uint32Array(this.accData.buffer);

  private invViewProj = new Matrix4();
  private prevInvViewProj = new Matrix4();
  private ping = true;
  private frameCounter = 0;
  private accumCount = 0;
  private reset = true;
  private lastPose = new Float64Array(8);
  private sceneId = 'cornell';

  private uGiExposure = uniform(1);
  // guides debug view: history normaliser (side A only) + |dilatedVelocity| gain.
  private uGuidesCap = uniform(64);
  private uGuidesVelScale = uniform(20);
  private camera!: PerspectiveCamera;

  // Side B debug-view TSL nodes: re-pointed every frame (upscaler.guides.*
  // reallocates its StorageTextures on every configure()/resize — GUIDES-HANDOFF
  // "re-read the getters every frame" contract).
  private fsrDisoccNode: Node | null = null;
  private fsrMotionNode: Node | null = null;

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

    // --- Producer (reused ssrt-main.wgsl, live from demo 03). ---
    this.main = new RawComputePass(ctx.renderer, 'd17-main', mainWgsl, {
      bindings: [
        { kind: 'depth' }, { kind: 'tex' }, { kind: 'tex' }, { kind: 'sampledTex' },
        { kind: 'sampler', filtering: true }, { kind: 'tex' },
        { kind: 'storage', format: 'rgba16float' }, { kind: 'uniform' },
      ],
    });
    // Side A: the bench's private guides producer.
    this.guides = new TemporalGuidesPass(ctx.renderer, 'd17-guides');
    // Side B: the FSR3 upscaler in guides-only mode (no color, no upscale —
    // dispatchGuides() is the whole frame). Configured in resize() at RENDER
    // resolution (displayWidth/Height = render size, ratio 1) so both arms
    // consume the identical G-buffer.
    this.upscaler = new Upscaler({ renderer: ctx.renderer });
    this.upscaler.init();
    // ONE temporal pass, reused for both arms (different textures + the
    // motionIsUVDelta flag bit per dispatch — see the WGSL header).
    this.guidesTemporal = new RawComputePass(ctx.renderer, 'd17-guides-temporal', guidesAbTemporalWgsl, {
      bindings: [
        { kind: 'tex' }, { kind: 'tex' }, { kind: 'tex' }, { kind: 'tex' },
        { kind: 'storage', format: 'rgba16float' }, { kind: 'uniform' },
      ],
    });
    this.ssrtDenoise = new RawComputePass(ctx.renderer, 'd17-denoise', ssrtDenoiseWgsl, {
      bindings: [
        { kind: 'tex' }, { kind: 'depth' }, { kind: 'tex' },
        { kind: 'storage', format: 'rgba16float' }, { kind: 'uniform' },
      ],
    });
    // Accumulate reference (converged mean of the SAME producer both arms see).
    this.accumulate = new RawComputePass(ctx.renderer, 'd17-accum', accumulateWgsl, {
      bindings: [
        { kind: 'tex' }, { kind: 'tex' },
        { kind: 'storage', format: 'rgba16float' }, { kind: 'uniform' },
      ],
    });
    // Blit (ping-pong -> stable, and the 'none' passthrough). No uniform.
    this.blit = new RawComputePass(ctx.renderer, 'd17-blit', blitWgsl, {
      bindings: [{ kind: 'tex' }, { kind: 'storage', format: 'rgba16float' }],
    });
    this.comparator = new Comparator(ctx.renderer, 'd17-compare');

    this.resize(ctx); // allocates storages + configures the upscaler
    this.main.configure(this.mainData.byteLength);
    this.guides.configure();
    this.guidesTemporal.configure(this.tData.byteLength);
    this.ssrtDenoise.configure(this.dData.byteLength);
    this.accumulate.configure(this.accData.byteLength);
    this.blit.configure(0);
    this.comparator.configure(this.compareRT);

    const folder = ctx.pane.addFolder({ title: 'Demo 17 — Guides A/B (M6)' });
    this.params = buildParams(folder, schema);
    this.params.onChange((key) => {
      if (REBUILD_KEYS.has(key as string)) this.updateOutputNode();
      // Switching arms: clear temporal history so the newly-active arm starts
      // from a clean state instead of another arm's frames.
      if (key === 'stack') this.reset = true;
    });

    // URL overrides for deterministic captures.
    const q = new URLSearchParams(window.location.search);
    const urlStack = q.get('stack');
    if (urlStack && (STACKS as readonly string[]).includes(urlStack)) this.params.values.stack = urlStack as Stack;
    const urlView = q.get('view');
    if (urlView && (VIEW_MODES as readonly string[]).includes(urlView)) this.params.values.viewMode = urlView as ViewMode;
    this.params.refresh();

    this.updateOutputNode();
    this.installDividerDrag(ctx);
  }

  // The active arm's denoised GI/AO as a TSL vec4 node (rgb = GI, a = AO).
  private activeGiAoNode(stack: Stack): Node {
    const uv = screenUV;
    switch (stack) {
      case 'private-guides':
        return texture(this.privateFinal, uv);
      case 'fsr-guides':
        return texture(this.fsrFinal, uv);
      default:
        return texture(this.noneOut, uv);
    }
  }

  // Build (once) the TSL nodes for the FSR side's guides debug view. Textures
  // are re-pointed every frame (see fsrDisoccNode/fsrMotionNode field docs).
  private ensureFsrGuidesNodes(): { disocc: Node; motion: Node } {
    if (!this.fsrDisoccNode) {
      this.fsrDisoccNode = texture(this.upscaler.guides.disocclusion, screenUV);
      this.fsrMotionNode = texture(this.upscaler.guides.dilatedMotion, screenUV);
    }
    return { disocc: this.fsrDisoccNode, motion: this.fsrMotionNode! };
  }

  private updateOutputNode(): void {
    const v = this.params.values;
    const uv = screenUV;
    this.displayPipeline.needsUpdate = true;

    if (v.viewMode === 'split') {
      this.displayPipeline.outputNode = vec4(texture(this.compareRT.texture, uv).rgb, float(1));
      return;
    }
    if (v.viewMode === 'reference') {
      this.displayPipeline.outputNode = vec4(texture(this.refOut, uv).rgb.mul(this.uGiExposure), float(1));
      return;
    }
    if (v.viewMode === 'guides') {
      // Eyeball the ACTIVE arm's guide products: R = graded disocclusion
      // (lights up on teleport), G = historyLength/cap (side A only — the
      // FSR guides path has no history-length product, it's a late/temporal
      // product that's null on 'guides'; G=0 for that arm), B = |dilatedVel| *
      // gain (bright under motion).
      if (v.stack === 'fsr-guides') {
        const nodes = this.ensureFsrGuidesNodes();
        const disocc = nodes.disocc.r;
        const velMag = nodes.motion.rg.length().mul(this.uGuidesVelScale).clamp(0, 1);
        this.displayPipeline.outputNode = vec4(disocc, float(0), velMag, float(1));
      } else {
        const disocc = texture(this.guides.disocclusionTexture, uv).r;
        const histN = texture(this.guides.historyLengthTexture, uv).r.div(this.uGuidesCap).clamp(0, 1);
        const velMag = texture(this.guides.dilatedVelocityTexture, uv).rg.length().mul(this.uGuidesVelScale).clamp(0, 1);
        this.displayPipeline.outputNode = vec4(disocc, histN, velMag, float(1));
      }
      return;
    }

    const giao = this.activeGiAoNode(v.stack);
    const ao = giao.a;
    const gi = giao.rgb.mul(this.uGiExposure);
    if (v.viewMode === 'gi') {
      this.displayPipeline.outputNode = vec4(gi, float(1));
      return;
    }
    // combined: beauty * AO + albedo * GI (demo-03/10 composite).
    const beauty = texture(this.beautyTex, uv).rgb;
    const albedo = texture(this.albedoTex, uv).rgb;
    this.displayPipeline.outputNode = vec4(beauty.mul(vec3(ao)).add(albedo.mul(gi)), float(1));
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

  frame(ctx: HarnessContext, dt: number): void {
    const cam = this.camera;
    this.frameCounter++;
    this.uGiExposure.value = this.params.values.giExposure;
    const { width, height } = ctx.renderSize();
    const v = this.params.values;

    // 1. G-buffer. No camera jitter anywhere in this demo — both guide arms
    // must see an identical G-buffer, so the A/B isolates the guide products.
    this.gbufferPipeline.render();

    // 2. Producer (fixed noisy) -> giAoTex, shared by both arms + the reference.
    this.fillProducerUniform(cam, width, height);
    this.main.execute(
      [this.depthTex, this.normalTex, this.beautyTex, this.envTex, this.envSampler, this.depthPyramid, this.giAoTex, this.mainData],
      width, height,
    );

    // 3. Reset detection — ONE signal shared by the reference and BOTH guide
    // producers (whichever one runs this frame), so the A/B stays isolated to
    // the guide products, not to which one saw a reset first.
    const moved = this.cameraMoved();
    const reset = moved || this.reset || this.frameCounter < 2 ? 1 : 0;

    // 4a. Side A — private TemporalGuidesPass. Lazy: only when active (like
    // ReferencePass — cheap to construct, update() is the per-frame cost).
    if (v.stack === 'private-guides') {
      this.uGuidesCap.value = v.guidesHistoryCap;
      this.uGuidesVelScale.value = v.guidesVelScale;
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

    // 4b. Side B — FSR3 upscaler guides-only path. Lazy, same gate. Guides
    // path: no color, no jitter, no output texture — dispatchGuides() is the
    // whole frame (GUIDES-HANDOFF.md). Same reset signal as side A.
    if (v.stack === 'fsr-guides') {
      this.upscaler.dispatchGuides(
        { depth: this.depthTex, velocity: this.velocityTex, deltaTime: dt, reset: reset !== 0 },
        cam,
      );
      // Re-point the debug-view nodes every frame (ping-pong/reallocation
      // contract) even when the guides view isn't showing — cheap, and keeps
      // the nodes valid the instant the user switches to it.
      if (this.fsrDisoccNode) {
        this.fsrDisoccNode.value = this.upscaler.guides.disocclusion;
        this.fsrMotionNode!.value = this.upscaler.guides.dilatedMotion;
      }
      this.uGuidesVelScale.value = v.guidesVelScale;
    }

    // 5. Accumulate converged reference (always; CPU-driven count; SAME
    // producer both arms see).
    this.invViewProj.multiplyMatrices(cam.matrixWorld, cam.projectionMatrixInverse);
    if (reset) this.accumCount = 0;
    const accRead = this.ping ? this.accB : this.accA;
    const accWrite = this.ping ? this.accA : this.accB;
    this.accData[0] = width; this.accData[1] = height;
    this.accData[2] = this.accumCount;
    this.accU32[3] = reset;
    this.accumulate.execute([this.giAoTex, accRead, accWrite, this.accData], width, height);
    this.blit.execute([accWrite, this.refOut], width, height);

    // 6. Active arm: guides-fed temporal + shared bilateral (or 'none' passthrough).
    this.runStack(v.stack, cam, width, height, reset);

    // 7. Split A/B: active arm output vs converged reference.
    if (v.viewMode === 'split') {
      const aTex = v.stack === 'private-guides' ? this.privateFinal
        : v.stack === 'fsr-guides' ? this.fsrFinal
          : this.noneOut;
      this.comparator.execute(this.compareRT, aTex, this.refOut, width, height, {
        mode: v.compareMode, splitX: this.compareState.splitX, amp: v.diffAmp,
        scaleA: v.giExposure, scaleB: v.giExposure, channel: 'rgb',
      });
    }

    // 8. Display.
    this.displayPipeline.render();
    ctx.timing.sampleGPU(ctx.renderer);

    // 9. Advance state.
    this.prevInvViewProj.copy(this.invViewProj);
    this.ping = !this.ping;
    if (!reset) this.accumCount = Math.min(4096, this.accumCount + 1);
    this.reset = false;
  }

  private runStack(stack: Stack, cam: PerspectiveCamera, width: number, height: number, reset: number): void {
    const v = this.params.values;
    if (stack === 'none') {
      this.blit.execute([this.giAoTex, this.noneOut], width, height);
      return;
    }
    const isFsr = stack === 'fsr-guides';
    const histRead = isFsr
      ? (this.ping ? this.fsrHistB : this.fsrHistA)
      : (this.ping ? this.privateHistB : this.privateHistA);
    const histWrite = isFsr
      ? (this.ping ? this.fsrHistA : this.fsrHistB)
      : (this.ping ? this.privateHistA : this.privateHistB);
    // Re-read the guide getters fresh THIS frame — the FSR side reallocates
    // its StorageTextures on resize; the private side is stable but re-reading
    // costs nothing and keeps both paths symmetric.
    const dilatedVelTex = isFsr ? this.upscaler.guides.dilatedMotion : this.guides.dilatedVelocityTexture;
    const disoccTex = isFsr ? this.upscaler.guides.disocclusion : this.guides.disocclusionTexture;

    this.tData.set(this.invViewProj.elements, 0);
    this.tData.set(this.prevInvViewProj.elements, 16);
    this.tData[32] = width; this.tData[33] = height; this.tData[34] = cam.near; this.tData[35] = cam.far;
    this.tData[36] = v.temporalResponse;
    let tflags = 0;
    if (v.temporalOn) tflags |= 1;
    if (reset) tflags |= 2;
    if (isFsr) tflags |= 4; // motionIsUVDelta — see guides-ab-temporal.wgsl header
    this.tU32[37] = tflags; this.tData[38] = 0; this.tData[39] = 0;
    this.guidesTemporal.execute(
      [this.giAoTex, histRead, dilatedVelTex, disoccTex, histWrite, this.tData],
      width, height,
    );

    const finalTex = isFsr ? this.fsrFinal : this.privateFinal;
    this.dData[0] = width; this.dData[1] = height; this.dData[2] = cam.near; this.dData[3] = cam.far;
    this.dData[4] = v.denoisingRadius; this.dU32[5] = v.denoiseOn ? 1 : 0; this.dData[6] = 0; this.dData[7] = 0;
    this.ssrtDenoise.execute([histWrite, this.depthTex, this.normalTex, finalTex, this.dData], width, height);
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
    // Guard: the harness's global resize handler can fire before init()
    // finishes constructing us (demo 16's pattern).
    if (!this.upscaler) return;
    const { width, height } = ctx.renderSize();
    this.scenePass.setSize(width, height);
    const storages = [
      this.giAoTex, this.privateHistA, this.privateHistB, this.privateFinal,
      this.fsrHistA, this.fsrHistB, this.fsrFinal, this.noneOut,
      this.accA, this.accB, this.refOut, this.depthPyramid,
    ];
    for (const t of storages) {
      t.image = { width, height };
      t.dispose();
      ensureTexture(ctx.renderer, t);
    }
    this.guides.setSize(width, height);
    this.compareRT.setSize(width, height);
    ensureRenderTarget(ctx.renderer, this.compareRT);
    // Side B at RENDER resolution, ratio 1: both arms consume the identical
    // G-buffer. Reconfiguring drops the upscaler's own history/prev-depth
    // (Upscaler.configure() calls resetHistory() internally) — a resize is a
    // hard discontinuity for both arms anyway (this.reset = true below).
    // NOTE: configure() reallocates the upscaler's guide StorageTextures as
    // brand-new objects on every call (unlike TemporalGuidesPass, which keeps
    // the same JS Texture objects and reallocates only their GPU backing).
    // fsrDisoccNode/fsrMotionNode stay valid across this: they are built once
    // and never rebuilt, so the SAME node objects remain embedded in the
    // compiled display graph forever; frame() step 4b repoints their `.value`
    // to the fresh texture every frame the fsr arm is active, BEFORE that
    // frame's display render — no staleness window.
    this.upscaler.configure({ displayWidth: width, displayHeight: height, customUpscaleRatio: 1, path: 'guides' });
    this.reset = true;
  }

  dispose(): void {
    const el = document.querySelector('canvas');
    for (const [type, fn] of this.pointerHandlers) {
      if (type === 'pointerdown') el?.removeEventListener(type, fn);
      else window.removeEventListener(type, fn);
    }
    const all = [
      this.giAoTex, this.privateHistA, this.privateHistB, this.privateFinal,
      this.fsrHistA, this.fsrHistB, this.fsrFinal, this.noneOut,
      this.accA, this.accB, this.refOut, this.depthPyramid, this.envTex,
    ];
    for (const t of all) t.dispose();
    this.guides.dispose();
    this.upscaler.dispose();
    this.compareRT.dispose();
  }
}

export const guidesAbLabDemo: DemoDef = {
  id: '17-guides-ab',
  label: '17 — Guides A/B (M6)',
  create: () => new GuidesAbLabDemo(),
};
