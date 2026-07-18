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

// Demo 07 — ambient-fallback lab. See README. The march / bitmask / GI gather
// are demo 03's, verbatim; the moving part is the PLUGGABLE §3.2 directional-
// ambient source (A equirect / B SH grid / C global SH), plus the two toggles
// (paper vs SSRT3 normalization; cone->mip vs mip 3) promoted to experiment axes.

const VIEW_MODES = ['combined', 'ao', 'gi', 'beauty', 'ao-raw', 'gi-raw'] as const;
type ViewMode = (typeof VIEW_MODES)[number];

const AMBIENT_SOURCES = ['A-equirect', 'B-sh-grid', 'C-global-sh'] as const;
type AmbientSource = (typeof AMBIENT_SOURCES)[number];

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

function sceneDefaults(sceneId: string): { radius: number; thickness: number } {
  if (sceneId === 'sponza') return { radius: 8, thickness: 2 };
  if (sceneId === 'artifact-zoo') return { radius: 3, thickness: 0.3 };
  return { radius: 5, thickness: 0.5 }; // cornell
}

const TEMPORAL_ROTATIONS = [60, 300, 180, 240, 120, 0];
const SPATIAL_OFFSETS = [0.0, 0.5, 0.25, 0.75];

// ---------------------------------------------------------------------------
// Ambient content model (shared by all three sources so A/B/C differ only by
// REPRESENTATION, not content). For Cornell it's an analytic ray-vs-box bake
// against the 6 walls (red left, green right, white back/floor/ceiling, bright
// ceiling-light disc, open front = dark) — genuinely positional. For other
// scenes it's a position-independent sky gradient (so B collapses to C there,
// which is the honest result and is noted in the README).
// ---------------------------------------------------------------------------
const H = 2.75; // cornell half-extent
const S = 5.5;  // cornell interior edge

type RGB = [number, number, number];

// Radiance seen from `pos` looking in unit `dir`, for the Cornell box.
function cornellRadiance(pos: RGB, dir: RGB): RGB {
  const [px, py, pz] = pos;
  const [dx, dy, dz] = dir;
  // nearest positive exit t against the interior box (x,z in [-H,H], y in [0,S]).
  let bestT = Infinity;
  let axis = 0;
  let pos_dir = true;
  const consider = (t: number, ax: number, positive: boolean) => {
    if (t > 1e-4 && t < bestT) { bestT = t; axis = ax; pos_dir = positive; }
  };
  if (Math.abs(dx) > 1e-6) consider((dx > 0 ? H - px : -H - px) / dx, 0, dx > 0);
  if (Math.abs(dy) > 1e-6) consider((dy > 0 ? S - py : 0 - py) / dy, 1, dy > 0);
  if (Math.abs(dz) > 1e-6) consider((dz > 0 ? H - pz : -H - pz) / dz, 2, dz > 0);
  if (!isFinite(bestT)) return [0, 0, 0];
  if (axis === 0) return pos_dir ? [0.06, 0.5, 0.06] : [0.75, 0.06, 0.06]; // green : red
  if (axis === 1) {
    if (pos_dir) {
      const hx = px + dx * bestT, hz = pz + dz * bestT;
      if (Math.abs(hx) < 1.15 && Math.abs(hz) < 1.15) return [3.6, 3.6, 3.5]; // ceiling light
      return [0.7, 0.7, 0.7]; // ceiling
    }
    return [0.55, 0.55, 0.55]; // floor
  }
  return pos_dir ? [0.01, 0.01, 0.015] : [0.7, 0.7, 0.7]; // open front : white back
}

function skyRadiance(dir: RGB): RGB {
  const t = Math.max(0, Math.min(1, dir[1] * 0.5 + 0.5)); // 0 down, 1 up
  return [0.30 + (0.45 - 0.30) * (1 - t), 0.42 + (0.40 - 0.42) * (1 - t), 0.72 + (0.34 - 0.72) * (1 - t)];
}

function radianceAt(sceneId: string, pos: RGB, dir: RGB): RGB {
  return sceneId === 'cornell' ? cornellRadiance(pos, dir) : skyRadiance(dir);
}

// three's SphericalHarmonics3.getBasisAt basis (src/math/SphericalHarmonics3.js).
// Projecting with THIS basis makes the WGSL shIrradiance() (a port of three's
// getShIrradianceAt) evaluate the coefficients consistently.
function shBasis(x: number, y: number, z: number): number[] {
  return [
    0.282095,
    0.488603 * y,
    0.488603 * z,
    0.488603 * x,
    1.092548 * x * y,
    1.092548 * y * z,
    0.315392 * (3 * z * z - 1),
    1.092548 * x * z,
    0.546274 * (x * x - y * y),
  ];
}

// Monte-Carlo project the radiance model at `pos` onto 9 L2 SH coefficients
// (Fibonacci sphere quadrature, 4*PI/N weight). Returns 27 floats (9 * rgb).
function projectSH(sceneId: string, pos: RGB, samples = 4096): Float32Array {
  const c = new Float32Array(27);
  const ga = Math.PI * (3 - Math.sqrt(5));
  for (let k = 0; k < samples; k++) {
    const zc = 1 - (2 * k + 1) / samples;
    const r = Math.sqrt(Math.max(0, 1 - zc * zc));
    const phi = k * ga;
    const dir: RGB = [r * Math.cos(phi), zc, r * Math.sin(phi)];
    const L = radianceAt(sceneId, pos, dir);
    const b = shBasis(dir[0], dir[1], dir[2]);
    for (let i = 0; i < 9; i++) {
      c[i * 3] += L[0] * b[i];
      c[i * 3 + 1] += L[1] * b[i];
      c[i * 3 + 2] += L[2] * b[i];
    }
  }
  const w = (4 * Math.PI) / samples;
  for (let i = 0; i < 27; i++) c[i] *= w;
  return c;
}

// Equirect radiance texture (Source A), baked from the model at the scene's
// reference position. Matches sampleEnv()'s UV: u=atan2(z,x)/2PI+0.5, v=acos(y)/PI.
const ENV_W = 128;
const ENV_H = 64;
function makeEnv(sceneId: string, refPos: RGB): DataTexture {
  const data = new Uint8Array(ENV_W * ENV_H * 4);
  for (let ty = 0; ty < ENV_H; ty++) {
    const v = (ty + 0.5) / ENV_H;
    const lat = v * Math.PI;
    const dy = Math.cos(lat);
    const rr = Math.sin(lat);
    for (let tx = 0; tx < ENV_W; tx++) {
      const u = (tx + 0.5) / ENV_W;
      const lon = (u - 0.5) * 2 * Math.PI;
      const dir: RGB = [rr * Math.cos(lon), dy, rr * Math.sin(lon)];
      const L = radianceAt(sceneId, refPos, dir);
      const i = (ty * ENV_W + tx) * 4;
      data[i] = Math.round(Math.min(1, L[0]) * 255);
      data[i + 1] = Math.round(Math.min(1, L[1]) * 255);
      data[i + 2] = Math.round(Math.min(1, L[2]) * 255);
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

// SH probe grid (Source B): 3x3x3 positional bake.
const GX = 3, GY = 3, GZ = 3;
interface AmbientData {
  env: DataTexture;
  globalSH: Float32Array;   // 27 floats
  gridSH: Float32Array;     // GX*GY*GZ*27 floats
  gridMin: RGB;
  gridMax: RGB;
}
function buildAmbient(sceneId: string): AmbientData {
  let gridMin: RGB, gridMax: RGB, refPos: RGB;
  if (sceneId === 'cornell') {
    gridMin = [-H + 0.5, 0.5, -H + 0.5];
    gridMax = [H - 0.5, S - 0.5, H - 0.5];
    refPos = [0, H, 0];
  } else if (sceneId === 'sponza') {
    gridMin = [-15, 0.5, -9]; gridMax = [15, 12, 9]; refPos = [0, 5, 0];
  } else {
    gridMin = [-3, 0.2, -3]; gridMax = [3, 3, 3]; refPos = [0, 1, 0];
  }
  const env = makeEnv(sceneId, refPos);
  const globalSH = projectSH(sceneId, refPos);
  const gridSH = new Float32Array(GX * GY * GZ * 27);
  for (let iz = 0; iz < GZ; iz++) {
    for (let iy = 0; iy < GY; iy++) {
      for (let ix = 0; ix < GX; ix++) {
        const px = gridMin[0] + (gridMax[0] - gridMin[0]) * (ix / (GX - 1));
        const py = gridMin[1] + (gridMax[1] - gridMin[1]) * (iy / (GY - 1));
        const pz = gridMin[2] + (gridMax[2] - gridMin[2]) * (iz / (GZ - 1));
        const probe = projectSH(sceneId, [px, py, pz], 2048);
        const base = (ix + iy * GX + iz * GX * GY) * 27;
        gridSH.set(probe, base);
      }
    }
  }
  return { env, globalSH, gridSH, gridMin, gridMax };
}

function multiBounceAO(x: any, albedo: any): any {
  const a = albedo.mul(2.0404).sub(0.3324);
  const b = albedo.mul(-4.7951).add(0.6417);
  const c = albedo.mul(2.7552).add(0.6903);
  return max(vec3(x), x.mul(a).add(b).mul(x).add(c).mul(x));
}

// Main uniform: base 72 floats (demo 03) + ambient block. Layout in fillUniform.
//   72 ambientSource(u32) + 3 pad; 76 gridMin(vec4); 80 gridMax; 84 gridInvRange;
//   88 gridDims; 92 globalSH(9*vec4=36); 128 gridSH(243*vec4=972). Total 1100.
const U_FLOATS = 1100;
const OFF_GLOBAL_SH = 92;
const OFF_GRID_SH = 128;
const T_FLOATS = 40;
const D_FLOATS = 8;
const L_FLOATS = 4;
const P_FLOATS = 4;
const PYRAMID_LEVELS = 5;

class Demo07AmbientLab implements Demo {
  private beautyTex!: Texture;
  private albedoTex!: Texture;
  private normalTex!: Texture;
  private velocityTex!: Texture;
  private depthTex!: DepthTexture;

  private scenePass!: ReturnType<typeof pass>;
  private gbufferPipeline!: RenderPipeline;
  private displayPipeline!: RenderPipeline;

  private giAoTex = this.makeStorage();
  private histA = this.makeStorage();
  private histB = this.makeStorage();
  private finalTex = this.makeStorage();
  private lightTex = this.makeStorage();
  private depthPyramid = this.makePyramid();

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
  private histPing = true;
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
      addressModeU: 'repeat',
      addressModeV: 'clamp-to-edge',
    });

    // Bake all three ambient sources (equirect + global SH + SH grid).
    const amb = buildAmbient(this.sceneId);
    this.envTex = amb.env;
    ensureTexture(ctx.renderer, this.envTex);
    // Fill the static ambient portion of the uniform once.
    this.mainData.set(shTo444(amb.globalSH), OFF_GLOBAL_SH);
    this.mainData.set(shTo444(amb.gridSH), OFF_GRID_SH);
    const invRange: RGB = [
      1 / Math.max(1e-4, amb.gridMax[0] - amb.gridMin[0]),
      1 / Math.max(1e-4, amb.gridMax[1] - amb.gridMin[1]),
      1 / Math.max(1e-4, amb.gridMax[2] - amb.gridMin[2]),
    ];
    this.mainData[76] = amb.gridMin[0]; this.mainData[77] = amb.gridMin[1]; this.mainData[78] = amb.gridMin[2];
    this.mainData[80] = amb.gridMax[0]; this.mainData[81] = amb.gridMax[1]; this.mainData[82] = amb.gridMax[2];
    this.mainData[84] = invRange[0]; this.mainData[85] = invRange[1]; this.mainData[86] = invRange[2];
    this.mainData[88] = GX; this.mainData[89] = GY; this.mainData[90] = GZ;

    this.main = new RawComputePass(ctx.renderer, 'a07-main', mainWgsl, {
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
    this.temporal = new RawComputePass(ctx.renderer, 'a07-temporal', temporalWgsl, {
      bindings: [
        { kind: 'tex' }, { kind: 'tex' }, { kind: 'tex' }, { kind: 'depth' },
        { kind: 'storage', format: 'rgba16float' }, { kind: 'uniform' },
      ],
    });
    this.denoise = new RawComputePass(ctx.renderer, 'a07-denoise', denoiseWgsl, {
      bindings: [
        { kind: 'tex' }, { kind: 'depth' }, { kind: 'tex' },
        { kind: 'storage', format: 'rgba16float' }, { kind: 'uniform' },
      ],
    });
    this.lightmask = new RawComputePass(ctx.renderer, 'a07-lightmask', lightmaskWgsl, {
      bindings: [
        { kind: 'tex' }, { kind: 'tex' }, { kind: 'tex' },
        { kind: 'storage', format: 'rgba16float' }, { kind: 'uniform' },
      ],
    });
    this.pyramid = new RawComputePass(ctx.renderer, 'a07-pyramid', pyramidWgsl, {
      bindings: [{ kind: 'depth' }, { kind: 'storage', format: 'r32float' }, { kind: 'uniform' }],
    });

    this.resize(ctx);
    this.main.configure(this.mainData.byteLength);
    this.temporal.configure(this.tData.byteLength);
    this.denoise.configure(this.dData.byteLength);
    this.lightmask.configure(this.lData.byteLength);
    this.pyramid.configure(this.pData.byteLength);

    const folder = ctx.pane.addFolder({ title: 'Demo 07 — Ambient-fallback lab' });
    const d = sceneDefaults(this.sceneId);
    this.params = buildParams(folder, schema);
    this.params.values.radius = d.radius;
    this.params.values.thickness = d.thickness;
    this.params.refresh();
    this.params.onChange((key) => {
      if (key === 'viewMode' || key === 'multiBounceAO') this.updateOutputNode();
    });

    // URL overrides for deterministic captures.
    const q = new URLSearchParams(window.location.search);
    const urlView = q.get('view');
    if (urlView && (VIEW_MODES as readonly string[]).includes(urlView)) {
      this.params.values.viewMode = urlView as ViewMode;
    }
    const src = q.get('src');
    if (src === 'A') this.params.values.ambientSource = 'A-equirect';
    else if (src === 'B') this.params.values.ambientSource = 'B-sh-grid';
    else if (src === 'C') this.params.values.ambientSource = 'C-global-sh';
    const bool = (k: string, cur: boolean): boolean => {
      const s = q.get(k);
      return s === null ? cur : s === '1';
    };
    this.params.values.useBitmask = bool('bitmask', this.params.values.useBitmask);
    this.params.values.gatherGI = bool('gi', this.params.values.gatherGI);
    this.params.values.fallbackEnabled = bool('fallback', this.params.values.fallbackEnabled);
    this.params.values.fallbackNormalization = bool('norm', this.params.values.fallbackNormalization);
    this.params.values.coneMip = bool('conemip', this.params.values.coneMip);
    this.params.values.temporalAccumulation = bool('temporal', this.params.values.temporalAccumulation);
    this.params.values.denoising = bool('denoise', this.params.values.denoising);
    this.params.values.multiBounceAO = bool('mbao', this.params.values.multiBounceAO);
    if (q.get('giExposure') !== null) this.params.values.giExposure = Number(q.get('giExposure'));
    if (q.get('fbsc') !== null) this.params.values.fallbackSampleCount = Number(q.get('fbsc'));
    if (q.get('fbi') !== null) this.params.values.fallbackIntensity = Number(q.get('fbi'));
    if (q.get('sc') !== null) this.params.values.stepCount = Number(q.get('sc'));
    if (q.get('rc') !== null) this.params.values.rotationCount = Number(q.get('rc'));
    if (q.get('radius') !== null) this.params.values.radius = Number(q.get('radius'));
    if (q.get('thickness') !== null) this.params.values.thickness = Number(q.get('thickness'));
    this.params.refresh();

    this.updateOutputNode();

    (window as unknown as { __a07bench?: (n: number) => Promise<number> }).__a07bench = (n: number) =>
      this.runComputeBench(n);
  }

  private updateOutputNode(): void {
    this.displayPipeline.outputNode = this.buildViewNode(this.params.values.viewMode);
    this.displayPipeline.needsUpdate = true;
  }

  private buildViewNode(mode: ViewMode) {
    const uv = screenUV;
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
        const aoTerm = this.params.values.multiBounceAO ? multiBounceAO(ao, albedo) : vec3(ao);
        // GI+fallback are stored together in giAoTex.rgb; modulate by albedo at
        // composite (PR #31839 requirement — same as demo 03).
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
    return f;
  }

  private ambientSourceIndex(): number {
    const s = this.params.values.ambientSource;
    if (s === 'B-sh-grid') return 1;
    if (s === 'C-global-sh') return 2;
    return 0;
  }

  private fillUniform(cam: PerspectiveCamera, width: number, height: number): void {
    const d = this.mainData;
    const u = this.mainU32;
    d.set(cam.projectionMatrix.elements, 0);
    d.set(cam.projectionMatrixInverse.elements, 16);
    d.set(cam.matrixWorld.elements, 32);
    d[48] = width;
    d[49] = height;
    d[50] = cam.near;
    d[51] = cam.far;
    const v = this.params.values;
    d[52] = v.radius;
    d[53] = v.thickness;
    d[54] = v.expFactor;
    d[55] = (height / (Math.tan(cam.fov * MathUtils.DEG2RAD * 0.5) * 2)) * 0.5;
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
    u[70] = ENV_MIPS;
    d[71] = 0;
    u[72] = this.ambientSourceIndex();
    // 76..90 grid bounds + dims are static (set in init); globalSH/gridSH too.
  }

  frame(ctx: HarnessContext, _dt: number): void {
    const cam = ctx.scene.camera;
    this.frameCounter++;
    this.uGiExposure.value = this.params.values.giExposure;

    this.gbufferPipeline.render();

    const { width, height } = ctx.renderSize();
    const vals = this.params.values;

    this.lData[0] = width;
    this.lData[1] = height;
    this.lData[2] = vals.multiBounceGI * vals.mbDamping;
    this.lData[3] = 0;
    this.lightmask.execute([this.beautyTex, this.finalTex, this.velocityTex, this.lightTex, this.lData], width, height);

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

    this.fillUniform(cam, width, height);
    this.main.execute(
      [this.depthTex, this.normalTex, this.lightTex, this.envTex, this.envSampler, this.depthPyramid, this.giAoTex, this.mainData],
      width,
      height,
    );

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

    this.fillDenoise(cam, width, height, v);
    this.denoise.execute([histWrite, this.depthTex, this.normalTex, this.finalTex, this.dData], width, height);

    this.displayPipeline.render();
    ctx.timing.sampleGPU(ctx.renderer);

    this.prevInvViewProj.copy(this.invViewProj);
    this.histPing = !this.histPing;
    this.resetTemporal = false;
    this.lastW = width;
    this.lastH = height;
  }

  // Compute-only GPU benchmark (fence over N iterations) — per-source cost.
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
      t.dispose();
      ensureTexture(ctx.renderer, t);
    }
    this.depthPyramid.image = { width, height };
    this.depthPyramid.dispose();
    ensureTexture(ctx.renderer, this.depthPyramid);
    this.resetTemporal = true;
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

// Expand a packed 9*rgb (or N*9*rgb) SH array into vec4-strided floats (rgb,0)
// to match the WGSL uniform array<vec4> layout.
function shTo444(src: Float32Array): Float32Array {
  const coeffs = src.length / 3;
  const out = new Float32Array(coeffs * 4);
  for (let i = 0; i < coeffs; i++) {
    out[i * 4] = src[i * 3];
    out[i * 4 + 1] = src[i * 3 + 1];
    out[i * 4 + 2] = src[i * 3 + 2];
    out[i * 4 + 3] = 0;
  }
  return out;
}

const schema = {
  viewMode: { type: 'enum', value: 'combined' as ViewMode, options: VIEW_MODES, label: 'view' },
  giExposure: { type: 'number', value: 1, min: 0.1, max: 8, step: 0.05, label: 'GI display gain' },
  // --- Ambient source (the lab axis) ---
  ambientSource: { type: 'enum', value: 'A-equirect' as AmbientSource, options: AMBIENT_SOURCES, label: 'ambient source' },
  fallbackEnabled: { type: 'boolean', value: true, label: 'fallback (§3.2)' },
  fallbackIntensity: { type: 'number', value: 1, min: 0, max: 10, step: 0.1, label: 'fallbackIntensity' },
  fallbackPower: { type: 'number', value: 1, min: 1, max: 4, step: 0.05, label: 'fallbackPower' },
  fallbackSampleCount: { type: 'number', value: 4, min: 2, max: 32, step: 1, label: 'fallbackSampleCount' },
  fallbackNormalization: { type: 'boolean', value: true, label: 'FB norm: SSRT3(on)/paper(off)' },
  coneMip: { type: 'boolean', value: false, label: 'cone->mip (vs mip3)' },
  // --- Sampling ---
  rotationCount: { type: 'number', value: 2, min: 1, max: 4, step: 1, label: 'rotationCount' },
  stepCount: { type: 'number', value: 12, min: 1, max: 32, step: 1, label: 'stepCount' },
  radius: { type: 'number', value: 5, min: 1, max: 25, step: 0.5, label: 'radius (world)' },
  expFactor: { type: 'number', value: 1, min: 1, max: 3, step: 0.05, label: 'expFactor' },
  jitterSamples: { type: 'boolean', value: true, label: 'jitterSamples' },
  screenSpaceSampling: { type: 'boolean', value: false, label: 'screenSpaceSampling' },
  mipOptimization: { type: 'boolean', value: false, label: 'mipOptimization' },
  // --- GI (on so the bitmask + on-screen bounce coexist with the fallback) ---
  gatherGI: { type: 'boolean', value: true, label: 'gather GI' },
  giIntensity: { type: 'number', value: 10, min: 0, max: 100, step: 0.5, label: 'GIIntensity' },
  multiBounceGI: { type: 'number', value: 0, min: 0, max: 1, step: 0.01, label: 'multiBounceGI' },
  mbDamping: { type: 'number', value: 0.5, min: 0, max: 1, step: 0.05, label: 'mb feedback damping' },
  normalApproximation: { type: 'boolean', value: false, label: 'normalApproximation' },
  backfaceLighting: { type: 'number', value: 0, min: 0, max: 1, step: 0.01, label: 'backfaceLighting' },
  maxLuminance: { type: 'number', value: 7, min: 1, max: 30, step: 0.5, label: 'firefly clamp' },
  // --- Occlusion ---
  useBitmask: { type: 'boolean', value: true, label: 'VBAO bitmask' },
  aoIntensity: { type: 'number', value: 1, min: 0, max: 4, step: 0.05, label: 'AOIntensity' },
  thickness: { type: 'number', value: 0.5, min: 0.01, max: 10, step: 0.01, label: 'thickness (world)' },
  linearThickness: { type: 'boolean', value: false, label: 'linearThickness' },
  multiBounceAO: { type: 'boolean', value: false, label: 'multiBounceAO' },
  // --- Filters ---
  temporalAccumulation: { type: 'boolean', value: true, label: 'temporalAccumulation' },
  temporalResponse: { type: 'number', value: 0.35, min: 0, max: 1, step: 0.01, label: 'temporalResponse' },
  denoising: { type: 'boolean', value: true, label: 'denoising' },
  denoisingRadius: { type: 'number', value: 0.5, min: 0, max: 1, step: 0.01, label: 'denoisingRadius' },
} as const;

export const ambientLabDemo: DemoDef = {
  id: '07-ambient-lab',
  label: '07 — Ambient-fallback lab',
  create: () => new Demo07AmbientLab(),
};
