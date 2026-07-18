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
  RepeatWrapping,
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
import type { DepthTexture, PerspectiveCamera, Texture } from 'three/webgpu';
import type { Demo, DemoDef, HarnessContext } from '../../harness/types';
import { RawComputePass } from '../../harness/raw-compute-pass';
import { ensureTexture } from '../../harness/three-internals';
import { buildParams } from '../../harness/params';
import type { ParamGroup } from '../../harness/params';
import mainWgsl from './ssrt-main.wgsl?raw';
import temporalWgsl from './ssrt-temporal.wgsl?raw';
import denoiseWgsl from './ssrt-denoise.wgsl?raw';
import lightmaskWgsl from './ssrt-lightmask.wgsl?raw';
import pyramidWgsl from './ssrt-depth-pyramid.wgsl?raw';

// Demo 03 — SSRT3 complete WebGPU compute port. See README for lineage/stages.
// Built in stages a-g; a=GTAO, b=bitmask, c=GI, d=temporal+denoise.

const VIEW_MODES = ['combined', 'ao', 'gi', 'beauty', 'ao-raw', 'gi-raw'] as const;
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
const F_SECTOR_REMAP = 1024;

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

// Fallback ambient source (stage e): a procedural EQUIRECTANGULAR radiance
// texture, per scene. Cornell gets a neutral dim env (so the feature is testable
// there); sponza/zoo get a sky gradient. RGBA8 + mip chain so the compute pass
// can sample it directionally at a cone-derived LOD. (Decision logged in README:
// equirect not three's cube-uv PMREM — the atlas packing is impractical to
// sample from raw WGSL; this is option A "directional env" adapted.)
const ENV_W = 64;
const ENV_H = 32;
function makeEnv(sceneId: string): DataTexture {
  const data = new Uint8Array(ENV_W * ENV_H * 4);
  for (let y = 0; y < ENV_H; y++) {
    const vy = y / (ENV_H - 1); // 0 = top (sky), 1 = bottom (ground)
    for (let x = 0; x < ENV_W; x++) {
      let r: number, g: number, b: number;
      if (sceneId === 'cornell') {
        r = 0.10; g = 0.11; b = 0.14; // dim neutral, slightly cool
      } else {
        const t = 1 - vy; // 0 bottom, 1 top
        r = 0.30 * t + 0.45 * (1 - t);
        g = 0.42 * t + 0.40 * (1 - t);
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
  tex.wrapS = RepeatWrapping; // equirect longitude wraps
  tex.minFilter = LinearMipmapLinearFilter;
  tex.magFilter = LinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}
const ENV_MIPS = Math.floor(Math.log2(Math.max(ENV_W, ENV_H))) + 1;

// GTAO analytic multibounce AO (Activision GTAO / SSRT3 MultiBounceAO): turns a
// scalar visibility into a per-channel visibility that lifts AO in colored
// regions (colored multibounce). x = visibility (scalar node), albedo = vec3.
/* eslint-disable @typescript-eslint/no-explicit-any */
function multiBounceAO(x: any, albedo: any): any {
  const a = albedo.mul(2.0404).sub(0.3324);
  const b = albedo.mul(-4.7951).add(0.6417);
  const c = albedo.mul(2.7552).add(0.6903);
  return max(vec3(x), x.mul(a).add(b).mul(x).add(c).mul(x));
}
/* eslint-enable @typescript-eslint/no-explicit-any */

// Main uniform: 3 mat4 (48f) + 6 vec4 blocks (24f) = 72 floats = 288 bytes.
const U_FLOATS = 72;
// Temporal uniform: 2 mat4 (32f) + 2 vec4 (8f) = 40 floats.
const T_FLOATS = 40;
// Denoise uniform: 2 vec4 = 8 floats.
const D_FLOATS = 8;
// Lightmask uniform: 1 vec4 = 4 floats.
const L_FLOATS = 4;
// Pyramid uniform: 1 vec4 = 4 floats.
const P_FLOATS = 4;
// Depth-pyramid mip levels we fill + read (SSRT3 caps mipLevelOffset at 4).
const PYRAMID_LEVELS = 5;

class Ssrt3Demo implements Demo {
  private beautyTex!: Texture;
  private albedoTex!: Texture;
  private normalTex!: Texture;
  private velocityTex!: Texture;
  private depthTex!: DepthTexture;

  private scenePass!: ReturnType<typeof pass>;
  private gbufferPipeline!: RenderPipeline;
  private displayPipeline!: RenderPipeline;

  // GI+AO buffers (rgb=GI, a=AO), three StorageTextures (stay TSL texture()s).
  private giAoTex = this.makeStorage();   // (a-c) raw main-march output
  private histA = this.makeStorage();     // (d) temporal ping-pong
  private histB = this.makeStorage();
  private finalTex = this.makeStorage();  // (d) denoised final -> composite
  private lightTex = this.makeStorage();  // (f) beauty + prevGI feedback -> march light source
  private depthPyramid = this.makePyramid(); // (g) raw-depth mip pyramid

  private main!: RawComputePass;
  private temporal!: RawComputePass;
  private denoise!: RawComputePass;
  private lightmask!: RawComputePass;
  private pyramid!: RawComputePass;
  private envSampler!: GPUSampler;
  private envTex!: DataTexture;
  private mainData = new Float32Array(U_FLOATS);
  private mainU32 = new Uint32Array(this.mainData.buffer);
  private tData = new Float32Array(T_FLOATS);
  private tU32 = new Uint32Array(this.tData.buffer);
  private dData = new Float32Array(D_FLOATS);
  private dU32 = new Uint32Array(this.dData.buffer);
  private lData = new Float32Array(L_FLOATS);
  private pData = new Float32Array(P_FLOATS);
  private pU32 = new Uint32Array(this.pData.buffer);

  private invViewProj = new Matrix4();
  private prevInvViewProj = new Matrix4();
  private histPing = true; // true: write histA / read histB
  private resetTemporal = true;
  private device!: GPUDevice;
  private lastW = 1;
  private lastH = 1;

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

  // Depth pyramid (g): r32float StorageTexture with a full mip chain
  // (generateMipmaps => three allocates floor(log2(max))+1 levels), so the
  // downsample chain can write mips 0..4 via per-mip storage views and the march
  // reads them with textureLoad(coord, level). r32float keeps depth precision.
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

    this.envSampler = ctx.device.createSampler({
      magFilter: 'linear',
      minFilter: 'linear',
      mipmapFilter: 'linear',
      addressModeU: 'repeat', // equirect longitude wraps
      addressModeV: 'clamp-to-edge',
    });
    this.envTex = makeEnv(this.sceneId);
    ensureTexture(ctx.renderer, this.envTex); // build GPU texture + mip chain

    // Bindings: depth, view-normal, light, env, sampler, depth-pyramid, out, uniform.
    this.main = new RawComputePass(ctx.renderer, 'ssrt-main', mainWgsl, {
      bindings: [
        { kind: 'depth' },
        { kind: 'tex' },
        { kind: 'tex' },
        { kind: 'sampledTex' },
        { kind: 'sampler', filtering: true },
        { kind: 'tex' },
        { kind: 'storage', format: 'rgba16float' },
        { kind: 'uniform' },
      ],
    });

    // Temporal reprojection: current + history + velocity + depth -> resolved.
    this.temporal = new RawComputePass(ctx.renderer, 'ssrt-temporal', temporalWgsl, {
      bindings: [
        { kind: 'tex' },
        { kind: 'tex' },
        { kind: 'tex' },
        { kind: 'depth' },
        { kind: 'storage', format: 'rgba16float' },
        { kind: 'uniform' },
      ],
    });
    // Bilateral denoise: resolved + depth + normal -> final.
    this.denoise = new RawComputePass(ctx.renderer, 'ssrt-denoise', denoiseWgsl, {
      bindings: [
        { kind: 'tex' },
        { kind: 'depth' },
        { kind: 'tex' },
        { kind: 'storage', format: 'rgba16float' },
        { kind: 'uniform' },
      ],
    });

    // Multibounce light buffer (f): beauty + reproject(prev GI) * weight.
    this.lightmask = new RawComputePass(ctx.renderer, 'ssrt-lightmask', lightmaskWgsl, {
      bindings: [
        { kind: 'tex' },
        { kind: 'tex' },
        { kind: 'tex' },
        { kind: 'storage', format: 'rgba16float' },
        { kind: 'uniform' },
      ],
    });

    // Depth pyramid downsample (g): depth buffer -> pyramid mip k (box-min).
    this.pyramid = new RawComputePass(ctx.renderer, 'ssrt-pyramid', pyramidWgsl, {
      bindings: [{ kind: 'depth' }, { kind: 'storage', format: 'r32float' }, { kind: 'uniform' }],
    });

    this.resize(ctx);
    this.main.configure(this.mainData.byteLength);
    this.temporal.configure(this.tData.byteLength);
    this.denoise.configure(this.dData.byteLength);
    this.lightmask.configure(this.lData.byteLength);
    this.pyramid.configure(this.pData.byteLength);

    const folder = ctx.pane.addFolder({ title: 'Demo 03 — SSRT3 (WebGPU compute)' });
    const d = sceneDefaults(this.sceneId);
    this.params = buildParams(folder, schema);
    // Per-scene world-space defaults (thickness/radius are world units).
    this.params.values.radius = d.radius;
    this.params.values.thickness = d.thickness;
    this.params.refresh();
    this.params.onChange((key) => {
      // viewMode + multiBounceAO change the display graph; rebuild it.
      if (key === 'viewMode' || key === 'multiBounceAO') this.updateOutputNode();
    });

    // URL overrides for deterministic screenshots (?view=&bitmask=1&gi=1&fallback=1&mb=1&mbao=1&denoise=0&temporal=0)
    const q = new URLSearchParams(window.location.search);
    const urlView = q.get('view');
    if (urlView && (VIEW_MODES as readonly string[]).includes(urlView)) {
      this.params.values.viewMode = urlView as ViewMode;
    }
    const bool = (k: string, cur: boolean): boolean => {
      const s = q.get(k);
      return s === null ? cur : s === '1';
    };
    this.params.values.useBitmask = bool('bitmask', this.params.values.useBitmask);
    this.params.values.gatherGI = bool('gi', this.params.values.gatherGI);
    this.params.values.fallbackEnabled = bool('fallback', this.params.values.fallbackEnabled);
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

    this.updateOutputNode();

    // Expose the compute-only GPU benchmark for the timing harness (stage g).
    (window as unknown as { __ssrt3bench?: (n: number) => Promise<number> }).__ssrt3bench = (n: number) =>
      this.runComputeBench(n);
  }

  private updateOutputNode(): void {
    this.displayPipeline.outputNode = this.buildViewNode(this.params.values.viewMode);
    this.displayPipeline.needsUpdate = true;
  }

  private buildViewNode(mode: ViewMode) {
    const uv = screenUV;
    // Denoised final for the main views; raw main-march output for *-raw views.
    const finalGiao = texture(this.finalTex, uv);
    const rawGiao = texture(this.giAoTex, uv);
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
        const beauty = texture(this.beautyTex, uv).rgb;
        const albedo = texture(this.albedoTex, uv).rgb;
        // multiBounceAO (f): GTAO analytic colored-multibounce AO approximation
        // (Activision GTAO). Replaces scalar AO with a per-channel visibility that
        // brightens AO in colored regions. Applied at composite (SSRT.shader).
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
    if (v.screenSpaceSampling) f |= F_SCREENSPACE;
    if (v.mipOptimization) f |= F_MIPOPT;
    if (v.normalApproximation) f |= F_NORMALAPPROX;
    if (v.fallbackEnabled) f |= F_FALLBACK;
    if (v.fallbackNormalization) f |= F_FB_NORMALIZE;
    if (v.coneMip) f |= F_CONE_MIP;
    if (v.gatherGI) f |= F_GI;
    if (v.sectorRemap) f |= F_SECTOR_REMAP;
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
    // freezeNoise pins the SSRT3 temporal rotation/offset cycle (which otherwise
    // advances EVERY frame by design, as food for the temporal accumulator) so
    // static noise patterns can be inspected.
    const fc = v.freezeNoise ? 0 : this.frameCounter;
    d[64] = SPATIAL_OFFSETS[Math.floor(fc / 6) % 4];
    d[65] = TEMPORAL_ROTATIONS[fc % 6] / 360;
    u[66] = v.fallbackSampleCount;
    d[67] = v.fallbackPower;
    d[68] = v.fallbackIntensity;
    d[69] = v.multiBounceGI;
    u[70] = ENV_MIPS; // env mip count (fallback cone->mip); depth pyramid at stage g
    d[71] = 0;
  }

  frame(ctx: HarnessContext, _dt: number): void {
    const cam = ctx.scene.camera;
    this.frameCounter++;
    this.uGiExposure.value = this.params.values.giExposure;

    // 1. G-buffer.
    this.gbufferPipeline.render();

    const { width, height } = ctx.renderSize();
    const vals = this.params.values;

    // 2. Multibounce light buffer (f): beauty + reproject(prev denoised GI) *
    //    (multiBounceGI * mbDamping). finalTex still holds last frame's result
    //    here (denoise below overwrites it). weight 0 -> lightTex == beauty.
    this.lData[0] = width;
    this.lData[1] = height;
    this.lData[2] = vals.multiBounceGI * vals.mbDamping;
    this.lData[3] = 0;
    this.lightmask.execute([this.beautyTex, this.finalTex, this.velocityTex, this.lightTex, this.lData], width, height);

    // 3. Depth pyramid (g): downsample the depth buffer into mips 0..4 (box-min).
    //    Only when mipOptimization is on (otherwise the march reads mip 0 = the
    //    raw depth buffer directly and the pyramid is unused).
    if (vals.mipOptimization) {
      for (let mip = 0; mip < PYRAMID_LEVELS; mip++) {
        this.pData[0] = width;
        this.pData[1] = height;
        this.pU32[2] = mip;
        this.pData[3] = 0;
        const mw = Math.max(1, width >> mip);
        const mh = Math.max(1, height >> mip);
        this.pyramid.execute([this.depthTex, this.depthPyramid, this.pData], mw, mh, { storageMip: mip });
      }
    }

    // 4. Main SSRT compute march (samples the multibounce light buffer + pyramid).
    this.fillUniform(cam, width, height);
    this.main.execute(
      [this.depthTex, this.normalTex, this.lightTex, this.envTex, this.envSampler, this.depthPyramid, this.giAoTex, this.mainData],
      width,
      height,
    );

    // 3. Temporal reprojection (d): current + prev-resolved -> resolved (histCur).
    // invViewProj = matrixWorld * projInverse (world from WebGPU clip).
    this.invViewProj.multiplyMatrices(cam.matrixWorld, cam.projectionMatrixInverse);
    const histWrite = this.histPing ? this.histA : this.histB;
    const histRead = this.histPing ? this.histB : this.histA;
    const v = this.params.values;
    this.fillTemporal(cam, width, height, v);
    this.temporal.execute(
      [this.giAoTex, histRead, this.velocityTex, this.depthTex, histWrite, this.tData],
      width,
      height,
    );

    // 4. Bilateral denoise (d): resolved -> finalTex (display samples this).
    this.fillDenoise(cam, width, height, v);
    this.denoise.execute([histWrite, this.depthTex, this.normalTex, this.finalTex, this.dData], width, height);

    // 5. Display.
    this.displayPipeline.render();
    ctx.timing.sampleGPU(ctx.renderer);

    // Advance temporal state.
    this.prevInvViewProj.copy(this.invViewProj);
    this.histPing = !this.histPing;
    this.resetTemporal = false;
    this.lastW = width;
    this.lastH = height;
  }

  // Compute-only GPU benchmark (stage g): runs the SSRT compute chain n times
  // (reusing the current frame's filled uniforms) and fences on
  // queue.onSubmittedWorkDone() — a queue completion fence, NOT a custom
  // timestamp-query set — to measure per-iteration GPU compute time in isolation
  // from the vsync-limited display loop. Exposed on window.__ssrt3bench for the
  // timing harness. Returns average ms/iteration.
  async runComputeBench(n: number): Promise<number> {
    const w = this.lastW;
    const h = this.lastH;
    const mip = this.params.values.mipOptimization;
    await this.device.queue.onSubmittedWorkDone();
    const t0 = performance.now();
    for (let i = 0; i < n; i++) {
      this.lightmask.execute([this.beautyTex, this.finalTex, this.velocityTex, this.lightTex, this.lData], w, h);
      if (mip) {
        for (let m = 0; m < PYRAMID_LEVELS; m++) {
          this.pU32[2] = m;
          this.pyramid.execute([this.depthTex, this.depthPyramid, this.pData], Math.max(1, w >> m), Math.max(1, h >> m), { storageMip: m });
        }
      }
      this.main.execute(
        [this.depthTex, this.normalTex, this.lightTex, this.envTex, this.envSampler, this.depthPyramid, this.giAoTex, this.mainData],
        w, h,
      );
      this.temporal.execute([this.giAoTex, this.histB, this.velocityTex, this.depthTex, this.histA, this.tData], w, h);
      this.denoise.execute([this.histA, this.depthTex, this.normalTex, this.finalTex, this.dData], w, h);
    }
    await this.device.queue.onSubmittedWorkDone();
    return (performance.now() - t0) / n;
  }

  private fillTemporal(cam: PerspectiveCamera, width: number, height: number, v: ParamGroup<typeof schema>['values']): void {
    const d = this.tData;
    const u = this.tU32;
    d.set(this.invViewProj.elements, 0);
    d.set(this.prevInvViewProj.elements, 16);
    d[32] = width;
    d[33] = height;
    d[34] = cam.near;
    d[35] = cam.far;
    d[36] = v.temporalResponse;
    let flags = 0;
    if (v.temporalAccumulation) flags |= 1;
    if (this.resetTemporal || this.frameCounter < 2) flags |= 2;
    u[37] = flags;
    d[38] = 0;
    d[39] = 0;
  }

  private fillDenoise(cam: PerspectiveCamera, width: number, height: number, v: ParamGroup<typeof schema>['values']): void {
    const d = this.dData;
    const u = this.dU32;
    d[0] = width;
    d[1] = height;
    d[2] = cam.near;
    d[3] = cam.far;
    d[4] = v.denoisingRadius;
    u[5] = v.denoising ? 1 : 0;
    d[6] = 0;
    d[7] = 0;
  }

  resize(ctx: HarnessContext): void {
    const { width, height } = ctx.renderSize();
    this.scenePass.setSize(width, height);
    for (const t of [this.giAoTex, this.histA, this.histB, this.finalTex, this.lightTex]) {
      t.image = { width, height };
      t.dispose(); // drop the old GPU texture so ensureTexture reallocates at the new size
      ensureTexture(ctx.renderer, t);
    }
    // Depth pyramid (mip-capable r32float) sized to the render target.
    this.depthPyramid.image = { width, height };
    this.depthPyramid.dispose();
    ensureTexture(ctx.renderer, this.depthPyramid);
    this.resetTemporal = true; // history invalid at the new resolution
  }

  dispose(): void {
    this.giAoTex.dispose();
    this.histA.dispose();
    this.histB.dispose();
    this.finalTex.dispose();
    this.lightTex.dispose();
    this.depthPyramid.dispose();
    this.envTex.dispose();
  }
}

const schema = {
  viewMode: { type: 'enum', value: 'combined' as ViewMode, options: VIEW_MODES, label: 'view',
    hint: 'What to display. combined = beauty + GI + AO composite; ao = raw march output before temporal/denoise; gi = bounced light only.' },
  giExposure: { type: 'number', value: 1, min: 0.1, max: 8, step: 0.05, label: 'GI display gain',
    hint: 'Display-only multiplier on the gi view for inspecting dark bounce light. Does NOT affect the composite.' },
  rotationCount: { type: 'number', value: 2, min: 1, max: 4, step: 1, label: 'rotationCount', group: 'sampling',
    hint: 'Hemisphere SLICES per pixel (three.js calls this "slice count"). Each slice marches both directions. Biggest quality/cost knob after stepCount.' },
  stepCount: { type: 'number', value: 12, min: 1, max: 32, step: 1, label: 'stepCount', group: 'sampling',
    hint: 'March samples per direction per slice. Total samples = rotationCount x stepCount x 2.' },
  radius: { type: 'number', value: 5, min: 1, max: 25, step: 0.5, label: 'radius (world)', group: 'sampling',
    hint: 'World-space march radius. Larger = farther occlusion/bounce, but samples spread thinner (more noise, worse cache).' },
  expFactor: { type: 'number', value: 1, min: 1, max: 3, step: 0.05, label: 'expFactor', group: 'sampling',
    hint: 'Exponential step distribution. 1 = uniform; higher packs samples near the pixel (better contact detail, sparser far field).' },
  jitterSamples: { type: 'boolean', value: true, label: 'jitterSamples', group: 'sampling',
    hint: 'Randomize the first step offset per pixel (rand(uv), frame-static). Trades banding for noise.' },
  screenSpaceSampling: { type: 'boolean', value: false, label: 'screenSpaceSampling', group: 'sampling',
    hint: 'Fixed screen-space radius instead of world-space projected radius. SSRT3 debug/compat mode.' },
  mipOptimization: { type: 'boolean', value: true, label: 'mipOptimization (g)', group: 'sampling',
    hint: 'Read coarser depth-pyramid mips for far samples (SSRT3 bandwidth opt, stage g). Slight quality cost, big memory-traffic win.' },
  gatherGI: { type: 'boolean', value: true, label: 'gather GI (c)', group: 'GI',
    hint: 'Gather bounced radiance per newly-occluded sector (stage c). Forces bitmask mode ON (GI needs sector counts).' },
  giIntensity: { type: 'number', value: 10, min: 0, max: 100, step: 0.5, label: 'GIIntensity', group: 'GI',
    hint: 'GI gain applied at gather (SSRT3 GIIntensity). Not physical - SSRT3 ships 10.' },
  multiBounceGI: { type: 'number', value: 0, min: 0, max: 1, step: 0.01, label: 'multiBounceGI (f)', group: 'GI',
    hint: 'Feed last frame\'s GI back into the light buffer (stage f) for 2nd+ bounces. 0 = off. Can feedback-loop; see damping.' },
  mbDamping: { type: 'number', value: 0.5, min: 0, max: 1, step: 0.05, label: 'mb feedback damping (f)', group: 'GI',
    hint: 'Attenuates the multibounce feedback each frame to keep the loop stable.' },
  normalApproximation: { type: 'boolean', value: false, label: 'normalApproximation (g)', group: 'GI',
    hint: 'Reconstruct sample normals from positions instead of reading the normal buffer (SSRT3 bandwidth opt). Cheaper, softer.' },
  backfaceLighting: { type: 'number', value: 0, min: 0, max: 1, step: 0.01, label: 'backfaceLighting', group: 'GI',
    hint: 'How much light back-facing samples contribute (SSRT3 _BackfaceLighting). 0 = reject backfaces.' },
  maxLuminance: { type: 'number', value: 7, min: 1, max: 30, step: 0.5, label: 'firefly clamp', group: 'GI',
    hint: 'Clamp per-sample radiance luminance to kill fireflies (SSGINode hardcodes 7).' },
  useBitmask: { type: 'boolean', value: true, label: 'VBAO bitmask (b)', group: 'occlusion',
    hint: 'ON = 32-bit visibility-bitmask AO (stage b, the SSRT3/VBAO algorithm). OFF = classic GTAO horizon integration (stage a, validation path). GI forces this ON.' },
  sectorRemap: { type: 'boolean', value: true, label: 'sector remap (anti tangent-phantom)', group: 'occlusion',
    hint: 'Therrien\'s shipped-but-commented hemisphere narrowing: stops coplanar samples stamping phantom sectors at the tangent. OFF = SSRT3-faithful.' },
  freezeNoise: { type: 'boolean', value: false, label: 'freeze noise cycle (inspect)', group: 'occlusion',
    hint: 'Pin the per-frame noise cycle for inspecting static patterns. The cycle normally advances every frame as food for temporal accumulation.' },
  aoIntensity: { type: 'number', value: 1, min: 0, max: 4, step: 0.05, label: 'AOIntensity', group: 'occlusion',
    hint: 'Power curve on final AO (SSRT3 AOIntensity). >1 darkens.' },
  thickness: { type: 'number', value: 0.5, min: 0.01, max: 10, step: 0.01, label: 'thickness (world)', group: 'occlusion',
    hint: 'Assumed occluder thickness behind each depth sample. Too high = overdarkening halos; too low = light leaks through thin geometry.' },
  linearThickness: { type: 'boolean', value: false, label: 'linearThickness', group: 'occlusion',
    hint: 'Scale thickness with view distance (SSRT3 option) so far occluders stay proportionally thick.' },
  multiBounceAO: { type: 'boolean', value: false, label: 'multiBounceAO (f)', group: 'occlusion',
    hint: 'Jimenez multi-bounce AO approximation: brightens AO where albedo is bright (light bounces in creases).' },
  fallbackEnabled: { type: 'boolean', value: false, label: 'fallback (e)', group: 'fallback (probes)',
    hint: 'Paper 3.2 probe fallback: sectors still open after the march sample an ambient env probe - fills off-screen/behind-camera light. The piece three\'s port dropped.' },
  fallbackPower: { type: 'number', value: 1, min: 1, max: 4, step: 0.05, label: 'fallbackPower', group: 'fallback (probes)',
    hint: 'Gamma on the fallback ambient term (SSRT3 FallbackPower).' },
  fallbackIntensity: { type: 'number', value: 1, min: 0, max: 10, step: 0.1, label: 'fallbackIntensity', group: 'fallback (probes)',
    hint: 'Gain on the fallback ambient term.' },
  fallbackSampleCount: { type: 'number', value: 4, min: 2, max: 32, step: 1, label: 'fallbackSampleCount', group: 'fallback (probes)',
    hint: 'How many contiguous sector ranges the 32-bit mask splits into; one env ray each, weighted by that range\'s open fraction.' },
  fallbackNormalization: { type: 'boolean', value: true, label: 'FB norm (SSRT3 vs paper)', group: 'fallback (probes)',
    hint: 'ON = SSRT3-shipped weight (unoccluded/32, sums to <=1). OFF = paper per-subregion weight (brighter). See probes/ssrt3-fallback.md.' },
  coneMip: { type: 'boolean', value: false, label: 'cone->mip (vs mip3)', group: 'fallback (probes)',
    hint: 'Derive env blur mip from the sector cone angle instead of SSRT3\'s hardcoded mip 3.' },
  temporalAccumulation: { type: 'boolean', value: true, label: 'temporalAccumulation (d)', group: 'temporal & denoise',
    hint: 'Reprojected exponential history blend (stage d). Eats the per-frame noise cycle; without it the raw march boils.' },
  temporalResponse: { type: 'number', value: 0.35, min: 0, max: 1, step: 0.01, label: 'temporalResponse', group: 'temporal & denoise',
    hint: 'History blend rate: LOWER = longer memory = smoother/less boil but more ghosting in motion. 0.35 ~ 3-frame memory; try 0.05-0.1 for stills.' },
  denoising: { type: 'boolean', value: true, label: 'denoising (d)', group: 'temporal & denoise',
    hint: 'Depth/normal-aware bilateral spatial blur after temporal (stage d).' },
  denoisingRadius: { type: 'number', value: 0.5, min: 0, max: 1, step: 0.01, label: 'denoisingRadius', group: 'temporal & denoise',
    hint: 'Bilateral kernel radius. Higher = smoother but softens GI contact detail.' },
} as const;

export const ssrt3Demo: DemoDef = {
  id: '03-ssrt3',
  label: '03 — SSRT3 (WebGPU compute)',
  create: () => new Ssrt3Demo(),
};
