import {
  HalfFloatType,
  MathUtils,
  NoColorSpace,
  RGBAFormat,
  RenderPipeline,
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
import type { DepthTexture, PerspectiveCamera, Texture } from 'three/webgpu';
import type { Demo, DemoDef, HarnessContext } from '../../harness/types';
import { RawComputePass } from '../../harness/raw-compute-pass';
import { ensureTexture } from '../../harness/three-internals';
import { buildParams } from '../../harness/params';
import type { ParamGroup } from '../../harness/params';
import mainWgsl from './ssrt-main.wgsl?raw';

// Demo 03 — SSRT3 complete WebGPU compute port. See README for lineage/stages.
// Built in stages a-g; stage (a) = GTAO plumbing (this file grows per stage).

const VIEW_MODES = ['combined', 'ao', 'gi', 'beauty'] as const;
type ViewMode = (typeof VIEW_MODES)[number];

// flags bits mirror ssrt-main.wgsl.
const F_BITMASK = 1;
const F_JITTER = 2;
const F_LINEAR_THICKNESS = 4;
const F_SCREENSPACE = 8;
const F_MIPOPT = 16;
const F_NORMALAPPROX = 32;
const F_FALLBACK = 64;
const F_FB_NORMALIZE = 128;
const F_CONE_MIP = 256;
const F_GI = 512;

// Per-scene world-space defaults (thickness/radius are world units — PLAN trap:
// Cornell interior ~5.5u, Sponza longest edge ~29.8u).
function sceneDefaults(sceneId: string): { radius: number; thickness: number } {
  if (sceneId === 'sponza') return { radius: 8, thickness: 2 };
  if (sceneId === 'artifact-zoo') return { radius: 3, thickness: 0.3 };
  return { radius: 5, thickness: 0.5 }; // cornell
}

// SSRT3's per-frame temporal cycles (SSRT_HDRP.cs). Directions in degrees /360.
const TEMPORAL_ROTATIONS = [60, 300, 180, 240, 120, 0];
const SPATIAL_OFFSETS = [0.0, 0.5, 0.25, 0.75];

// Uniform: 3 mat4 (48f) + 6 vec4 blocks (24f) = 72 floats = 288 bytes.
const U_FLOATS = 72;

class Ssrt3Demo implements Demo {
  private beautyTex!: Texture;
  private albedoTex!: Texture;
  private normalTex!: Texture;
  private depthTex!: DepthTexture;

  private scenePass!: ReturnType<typeof pass>;
  private gbufferPipeline!: RenderPipeline;
  private displayPipeline!: RenderPipeline;

  // GI+AO output (rgb=GI, a=AO), three StorageTexture so it stays a TSL texture().
  private giAoTex = this.makeStorage();

  private main!: RawComputePass;
  private envSampler!: GPUSampler;
  private mainData = new Float32Array(U_FLOATS);
  private mainU32 = new Uint32Array(this.mainData.buffer);

  private uGiExposure = uniform(1);

  private params!: ParamGroup<typeof schema>;
  private frameCounter = 0;
  private sceneId = 'cornell';

  private makeStorage(): StorageTexture {
    const t = new StorageTexture(1, 1);
    t.type = HalfFloatType;
    t.format = RGBAFormat;
    t.colorSpace = NoColorSpace;
    t.generateMipmaps = false; // single mip: storage bindings require mipLevelCount 1
    return t;
  }

  init(ctx: HarnessContext): void {
    this.sceneId = new URLSearchParams(window.location.search).get('scene') ?? 'cornell';
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

    this.envSampler = ctx.device.createSampler({
      magFilter: 'linear',
      minFilter: 'linear',
      mipmapFilter: 'linear',
      addressModeU: 'clamp-to-edge',
      addressModeV: 'clamp-to-edge',
    });

    // Bindings: depth, view-normal, light(beauty), env(placeholder=beauty), sampler, out, uniform.
    this.main = new RawComputePass(ctx.renderer, 'ssrt-main', mainWgsl, {
      bindings: [
        { kind: 'depth' },
        { kind: 'tex' },
        { kind: 'tex' },
        { kind: 'sampledTex' },
        { kind: 'sampler', filtering: true },
        { kind: 'storage', format: 'rgba16float' },
        { kind: 'uniform' },
      ],
    });

    this.resize(ctx);
    this.main.configure(this.mainData.byteLength);

    const folder = ctx.pane.addFolder({ title: 'Demo 03 — SSRT3 (WebGPU compute)' });
    const d = sceneDefaults(this.sceneId);
    this.params = buildParams(folder, schema);
    // Per-scene world-space defaults (thickness/radius are world units).
    this.params.values.radius = d.radius;
    this.params.values.thickness = d.thickness;
    this.params.refresh();
    this.params.onChange((key) => {
      if (key === 'viewMode') this.updateOutputNode();
    });

    const urlView = new URLSearchParams(window.location.search).get('view');
    if (urlView && (VIEW_MODES as readonly string[]).includes(urlView)) {
      this.params.values.viewMode = urlView as ViewMode;
      this.params.refresh();
    }

    this.updateOutputNode();
  }

  private updateOutputNode(): void {
    this.displayPipeline.outputNode = this.buildViewNode(this.params.values.viewMode);
  }

  private buildViewNode(mode: ViewMode) {
    const uv = screenUV;
    const giao = texture(this.giAoTex, uv);
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
        return vec4(beauty.mul(ao).add(albedo.mul(gi)), float(1));
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
    if (v.screenSpaceSampling) f |= F_SCREENSPACE;
    if (v.mipOptimization) f |= F_MIPOPT;
    if (v.normalApproximation) f |= F_NORMALAPPROX;
    if (v.fallbackEnabled) f |= F_FALLBACK;
    if (v.fallbackNormalization) f |= F_FB_NORMALIZE;
    if (v.coneMip) f |= F_CONE_MIP;
    if (v.gatherGI) f |= F_GI;
    return f;
  }

  private fillUniform(cam: PerspectiveCamera, width: number, height: number): void {
    const d = this.mainData;
    const u = this.mainU32;
    d.set(cam.projectionMatrix.elements, 0);
    d.set(cam.projectionMatrixInverse.elements, 16);
    d.set(cam.matrixWorld.elements, 32); // view->world (camToWorld)
    d[48] = width;
    d[49] = height;
    d[50] = cam.near;
    d[51] = cam.far;
    const v = this.params.values;
    d[52] = v.radius;
    d[53] = v.thickness;
    d[54] = v.expFactor;
    d[55] = (height / (Math.tan(cam.fov * MathUtils.DEG2RAD * 0.5) * 2)) * 0.5; // halfProjScale
    u[56] = v.rotationCount;
    u[57] = v.stepCount;
    u[58] = this.frameCounter >>> 0;
    u[59] = this.computeFlags();
    d[60] = v.aoIntensity;
    d[61] = v.giIntensity;
    d[62] = v.backfaceLighting;
    d[63] = v.maxLuminance;
    d[64] = SPATIAL_OFFSETS[Math.floor(this.frameCounter / 6) % 4];
    d[65] = TEMPORAL_ROTATIONS[this.frameCounter % 6] / 360;
    u[66] = v.fallbackSampleCount;
    d[67] = v.fallbackPower;
    d[68] = v.fallbackIntensity;
    d[69] = v.multiBounceGI;
    u[70] = 1; // mipCount (stage g)
    d[71] = 0;
  }

  frame(ctx: HarnessContext, _dt: number): void {
    const cam = ctx.scene.camera;
    this.frameCounter++;
    this.uGiExposure.value = this.params.values.giExposure;

    // 1. G-buffer.
    this.gbufferPipeline.render();

    // 2. Main SSRT compute march.
    const { width, height } = ctx.renderSize();
    this.fillUniform(cam, width, height);
    this.main.execute(
      [this.depthTex, this.normalTex, this.beautyTex, this.beautyTex, this.envSampler, this.giAoTex, this.mainData],
      width,
      height,
    );

    // 3. Display.
    this.displayPipeline.render();
    ctx.timing.sampleGPU(ctx.renderer);
  }

  resize(ctx: HarnessContext): void {
    const { width, height } = ctx.renderSize();
    this.scenePass.setSize(width, height);
    this.giAoTex.image = { width, height };
    this.giAoTex.dispose();
    ensureTexture(ctx.renderer, this.giAoTex);
  }

  dispose(): void {
    this.giAoTex.dispose();
  }
}

const schema = {
  viewMode: { type: 'enum', value: 'ao' as ViewMode, options: VIEW_MODES, label: 'view' },
  giExposure: { type: 'number', value: 1, min: 0.1, max: 8, step: 0.05, label: 'GI display gain' },
  // --- Sampling (SSRT3) ---
  rotationCount: { type: 'number', value: 2, min: 1, max: 4, step: 1, label: 'rotationCount' },
  stepCount: { type: 'number', value: 12, min: 1, max: 32, step: 1, label: 'stepCount' },
  radius: { type: 'number', value: 5, min: 1, max: 25, step: 0.5, label: 'radius (world)' },
  expFactor: { type: 'number', value: 1, min: 1, max: 3, step: 0.05, label: 'expFactor' },
  jitterSamples: { type: 'boolean', value: true, label: 'jitterSamples' },
  screenSpaceSampling: { type: 'boolean', value: false, label: 'screenSpaceSampling' },
  mipOptimization: { type: 'boolean', value: false, label: 'mipOptimization (g)' },
  // --- GI ---
  gatherGI: { type: 'boolean', value: false, label: 'gather GI (c)' },
  giIntensity: { type: 'number', value: 10, min: 0, max: 100, step: 0.5, label: 'GIIntensity' },
  multiBounceGI: { type: 'number', value: 0, min: 0, max: 1, step: 0.01, label: 'multiBounceGI (f)' },
  normalApproximation: { type: 'boolean', value: false, label: 'normalApproximation (g)' },
  backfaceLighting: { type: 'number', value: 0, min: 0, max: 1, step: 0.01, label: 'backfaceLighting' },
  maxLuminance: { type: 'number', value: 7, min: 1, max: 30, step: 0.5, label: 'firefly clamp' },
  // --- Occlusion ---
  useBitmask: { type: 'boolean', value: false, label: 'VBAO bitmask (b)' },
  aoIntensity: { type: 'number', value: 1, min: 0, max: 4, step: 0.05, label: 'AOIntensity' },
  thickness: { type: 'number', value: 0.5, min: 0.01, max: 10, step: 0.01, label: 'thickness (world)' },
  linearThickness: { type: 'boolean', value: false, label: 'linearThickness' },
  multiBounceAO: { type: 'boolean', value: false, label: 'multiBounceAO (f)' },
  // --- Fallback (e) ---
  fallbackEnabled: { type: 'boolean', value: false, label: 'fallback (e)' },
  fallbackPower: { type: 'number', value: 1, min: 1, max: 4, step: 0.05, label: 'fallbackPower' },
  fallbackIntensity: { type: 'number', value: 1, min: 0, max: 10, step: 0.1, label: 'fallbackIntensity' },
  fallbackSampleCount: { type: 'number', value: 4, min: 2, max: 32, step: 1, label: 'fallbackSampleCount' },
  fallbackNormalization: { type: 'boolean', value: true, label: 'FB norm (SSRT3 vs paper)' },
  coneMip: { type: 'boolean', value: false, label: 'cone->mip (vs mip3)' },
  // --- Filters (d) ---
  temporalAccumulation: { type: 'boolean', value: true, label: 'temporalAccumulation (d)' },
  temporalResponse: { type: 'number', value: 0.35, min: 0, max: 1, step: 0.01, label: 'temporalResponse' },
  denoising: { type: 'boolean', value: true, label: 'denoising (d)' },
  denoisingRadius: { type: 'number', value: 0.5, min: 0, max: 1, step: 0.01, label: 'denoisingRadius' },
} as const;

export const ssrt3Demo: DemoDef = {
  id: '03-ssrt3',
  label: '03 — SSRT3 (WebGPU compute)',
  create: () => new Ssrt3Demo(),
};
