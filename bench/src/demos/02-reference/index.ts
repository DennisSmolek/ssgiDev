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
  uniform,
  vec3,
  vec4,
} from 'three/tsl';
import { RenderPipeline } from 'three/webgpu';
import type { DepthTexture, PerspectiveCamera, Texture } from 'three/webgpu';
import type { Demo, DemoDef, HarnessContext } from '../../harness/types';
import { RawRenderPass } from '../../harness/raw-pass';
import { HALTON_JITTER, applyCameraJitter, clearCameraJitter } from '../../harness/temporal';
import { Comparator } from '../../harness/compare';
import type { CompareChannel, CompareMode } from '../../harness/compare';
import { ensureRenderTarget } from '../../harness/three-internals';
import { buildParams } from '../../harness/params';
import type { ParamGroup } from '../../harness/params';
import marcherWgsl from './reference-marcher.wgsl?raw';

const VIEW_MODES = ['combined', 'ao', 'gi', 'beauty', 'split'] as const;
type ViewMode = (typeof VIEW_MODES)[number];

const schema = {
  viewMode: { type: 'enum', value: 'combined' as ViewMode, options: VIEW_MODES, label: 'view' },
  raysPerPixel: { type: 'number', value: 4, min: 1, max: 64, step: 1, label: 'rays/pixel' },
  stepsPerRay: { type: 'number', value: 32, min: 4, max: 96, step: 1, label: 'steps/ray' },
  radius: { type: 'number', value: 6, min: 0.5, max: 14, step: 0.1, label: 'radius (world)' },
  thickness: { type: 'number', value: 0.5, min: 0.05, max: 4, step: 0.05, label: 'thickness (world)' },
  bias: { type: 'number', value: 0.03, min: 0.005, max: 0.3, step: 0.005, label: 'normal bias' },
  accumulate: { type: 'boolean', value: true, label: 'accumulate' },
  jitterAA: { type: 'boolean', value: false, label: 'subpixel AA jitter' },
  maxAccumFrames: { type: 'number', value: 512, min: 1, max: 4096, step: 1, label: 'max frames' },
  maxLuminance: { type: 'number', value: 10, min: 1, max: 30, step: 0.5, label: 'firefly clamp' },
  giStrength: { type: 'number', value: 1, min: 0, max: 5, step: 0.05, label: 'GI strength' },
  giExposure: { type: 'number', value: 2, min: 0.25, max: 8, step: 0.05, label: 'GI display gain' },
  skyIntensity: { type: 'number', value: 0, min: 0, max: 2, step: 0.02, label: 'sky (miss)' },
  compareMode: { type: 'enum', value: 'split' as CompareMode, options: ['split', 'diff'], label: 'A/B mode' },
  compareChannel: { type: 'enum', value: 'alpha' as CompareChannel, options: ['alpha', 'rgb'], label: 'A/B channel' },
  diffAmp: { type: 'number', value: 8, min: 1, max: 50, step: 0.5, label: 'diff amp' },
} as const;

// Params whose change does NOT invalidate the accumulation (display / comparator
// only). Everything else resets the accumulator.
const NON_RESET_KEYS = new Set([
  'viewMode',
  'giExposure',
  'compareMode',
  'compareChannel',
  'diffAmp',
]);

// Marcher uniform: proj(16) + invProj(16) + [res.xy,near,far] + [rays,steps,count,seed]
// + [radius,thickness,bias,maxLum] + [giStrength,sky,pad,pad] = 48 floats (192 B).
const MARCHER_FLOATS = 48;

const ADDITIVE: GPUBlendState = {
  color: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
  alpha: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
};

function floatRT(): RenderTarget {
  const rt = new RenderTarget(1, 1, { type: HalfFloatType, depthBuffer: false });
  rt.texture.colorSpace = NoColorSpace;
  return rt;
}

class ReferenceDemo implements Demo {
  private beautyTex!: Texture;
  private albedoTex!: Texture;
  private normalTex!: Texture;
  private depthTex!: DepthTexture;

  private scenePass!: ReturnType<typeof pass>;
  private gbufferPipeline!: RenderPipeline;
  private displayPipeline!: RenderPipeline;

  // Accumulation (additive-blend sums), single-sample live, comparator output.
  private accumRT = floatRT();
  private liveRT = floatRT();
  private compareRT = floatRT();

  private marcher!: RawRenderPass;
  private comparator!: Comparator;
  private marcherData = new Float32Array(MARCHER_FLOATS);
  private marcherU32 = new Uint32Array(this.marcherData.buffer);

  // Display uniforms.
  private uCount = uniform(1);
  private uGiExposure = uniform(2);

  private params!: ParamGroup<typeof schema>;
  private countBinding!: { refresh(): void };
  private readout = { samples: 0 };

  // Accumulation state.
  private sampleCount = 0;
  private frameCounter = 0;
  // Sub-pixel projection jitter (TAA-style). index cycles the Halton sequence;
  // active tracks whether a view offset is currently set so we clear it exactly
  // once when jitter is turned off (not every frame).
  private jitterIndex = 0;
  private jitterActive = false;
  private cam!: PerspectiveCamera;
  private resetRequested = true;
  // Float64: fovHash is ~40000, whose float32 quantization error (~0.004) would
  // otherwise exceed the move threshold and reset accumulation every frame.
  private lastPose = new Float64Array(8); // pos(3) + quat(4) + fovHash(1)

  // Split-view divider drag.
  private compareState = { splitX: 0.5, mode: 'split' as CompareMode, channel: 'alpha' as CompareChannel, amp: 8 };
  private dragging = false;
  private pointerHandlers: Array<[keyof HTMLElementEventMap, EventListener]> = [];

  init(ctx: HarnessContext): void {
    const cam = ctx.scene.camera;
    this.cam = cam;

    this.scenePass = pass(ctx.scene.scene, cam);
    this.scenePass.setMRT(
      mrt({ output: output, albedo: diffuseColor, normal: normalView }),
    );
    this.beautyTex = this.scenePass.getTexture('output');
    this.albedoTex = this.scenePass.getTexture('albedo');
    this.normalTex = this.scenePass.getTexture('normal');
    this.depthTex = this.scenePass.renderTarget.depthTexture!;

    this.gbufferPipeline = new RenderPipeline(ctx.renderer, this.scenePass);
    this.displayPipeline = new RenderPipeline(ctx.renderer);

    // Marcher: depth + view-normal + beauty + uniform, additive accumulation.
    this.marcher = new RawRenderPass(ctx.renderer, 'ref-marcher', marcherWgsl, {
      bindings: [{ kind: 'depth' }, { kind: 'tex' }, { kind: 'tex' }, { kind: 'uniform' }],
      blend: ADDITIVE,
    });
    this.comparator = new Comparator(ctx.renderer, 'ref-compare');

    this.resize(ctx);
    this.marcher.configure(this.accumRT, this.marcherData.byteLength);
    this.comparator.configure(this.compareRT);

    const folder = ctx.pane.addFolder({ title: 'Demo 02 — Reference marcher' });
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
      this.params.refresh();
    }
    // ?jitter=0 / ?jitter=1 override for deterministic AA A/B captures.
    const urlJitter = search.get('jitter');
    if (urlJitter === '0' || urlJitter === '1') {
      this.params.values.jitterAA = urlJitter === '1';
      this.params.refresh();
    }

    this.installDividerDrag(ctx);
    this.updateOutputNode();
  }

  private updateOutputNode(): void {
    this.displayPipeline.outputNode = this.buildViewNode(this.params.values.viewMode);
    this.displayPipeline.needsUpdate = true;
  }

  private buildViewNode(mode: ViewMode) {
    const uv = screenUV;
    const accum = texture(this.accumRT.texture, uv);
    const ao = accum.a.div(this.uCount);
    const gi = accum.rgb.div(this.uCount).mul(this.uGiExposure);
    switch (mode) {
      case 'ao':
        return vec4(vec3(ao), float(1));
      case 'gi':
        return vec4(gi, float(1));
      case 'combined': {
        // AO applied to lit beauty (ambient darkening) + albedo-modulated GI
        // bounce (PLAN trap: GI modulated by albedo at composite, PR #31839).
        const beauty = texture(this.beautyTex, uv).rgb;
        const albedo = texture(this.albedoTex, uv).rgb;
        return vec4(beauty.mul(ao).add(albedo.mul(gi)), float(1));
      }
      case 'beauty':
        return vec4(texture(this.beautyTex, uv).rgb, float(1));
      case 'split':
        return vec4(texture(this.compareRT.texture, uv).rgb, float(1));
    }
  }

  // Advance/apply the Halton jitter, or clear it once when disabled.
  private applyJitter(cam: PerspectiveCamera, w: number, h: number, enabled: boolean): void {
    if (enabled) {
      const [jx, jy] = HALTON_JITTER[this.jitterIndex];
      this.jitterIndex = (this.jitterIndex + 1) % HALTON_JITTER.length;
      applyCameraJitter(cam, w, h, jx, jy);
      this.jitterActive = true;
    } else if (this.jitterActive) {
      clearCameraJitter(cam);
      this.jitterActive = false;
    }
  }

  private cameraMoved(cam: PerspectiveCamera): boolean {
    // Threshold must tolerate OrbitControls damping, which re-derives the camera
    // pose every frame with tiny residual jitter even when visually static; too
    // tight a threshold resets accumulation every frame (never converges).
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
    this.frameCounter++;
    const { width, height } = ctx.renderSize();

    // 0. Sub-pixel jitter BEFORE the G-buffer rasterizes, so the scene and the
    // marcher (which reads cam.projectionMatrix below) share the jittered
    // projection. cameraMoved() hashes only pose/fov/aspect, so this never
    // resets accumulation.
    this.applyJitter(cam, width, height, v.jitterAA);

    // 1. G-buffer.
    this.gbufferPipeline.render();

    // 2. Reset accumulation on camera move / param change / non-accumulate.
    if (this.cameraMoved(cam) || this.resetRequested || !v.accumulate) {
      this.sampleCount = 0;
      this.resetRequested = false;
    }

    // 3. Marcher into the accumulation buffer (additive) unless frozen at max.
    if (this.sampleCount < v.maxAccumFrames) {
      const loadOp: GPULoadOp = this.sampleCount === 0 ? 'clear' : 'load';
      this.fillMarcherUniform(cam, width, height, this.sampleCount, v);
      this.marcher.execute(
        this.accumRT,
        [this.depthTex, this.normalTex, this.beautyTex, this.marcherData],
        { loadOp, clearValue: { r: 0, g: 0, b: 0, a: 0 } },
      );
      this.sampleCount++;
    }
    this.uCount.value = Math.max(1, this.sampleCount);
    this.uGiExposure.value = v.giExposure;

    // 4. Split view: 1-sample live pass + comparator.
    if (v.viewMode === 'split') {
      this.fillMarcherUniform(cam, width, height, this.frameCounter, v);
      this.marcher.execute(
        this.liveRT,
        [this.depthTex, this.normalTex, this.beautyTex, this.marcherData],
        { loadOp: 'clear', clearValue: { r: 0, g: 0, b: 0, a: 0 } },
      );
      this.comparator.execute(this.compareRT, this.liveRT.texture, this.accumRT.texture, width, height, {
        mode: v.compareMode,
        splitX: this.compareState.splitX,
        amp: v.diffAmp,
        scaleA: 1, // live is a single sample
        scaleB: 1 / Math.max(1, this.sampleCount), // accumulated sums -> mean
        channel: v.compareChannel,
      });
    }

    // 5. Display.
    this.displayPipeline.render();

    this.readout.samples = this.sampleCount;
    this.countBinding.refresh();
    ctx.timing.sampleGPU(ctx.renderer);
  }

  private fillMarcherUniform(
    cam: PerspectiveCamera,
    width: number,
    height: number,
    seed: number,
    v: ParamGroup<typeof schema>['values'],
  ): void {
    const d = this.marcherData;
    const u = this.marcherU32;
    d.set(cam.projectionMatrix.elements, 0);
    d.set(cam.projectionMatrixInverse.elements, 16);
    d[32] = width;
    d[33] = height;
    d[34] = cam.near;
    d[35] = cam.far;
    u[36] = v.raysPerPixel;
    u[37] = v.stepsPerRay;
    u[38] = this.sampleCount;
    u[39] = seed >>> 0;
    d[40] = v.radius;
    d[41] = v.thickness;
    d[42] = v.bias;
    d[43] = v.maxLuminance;
    d[44] = v.giStrength;
    d[45] = v.skyIntensity;
    d[46] = 0;
    d[47] = 0;
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
        ctx.controls.enabled = false; // don't orbit (which would reset accumulation)
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
    this.accumRT.setSize(width, height);
    this.liveRT.setSize(width, height);
    this.compareRT.setSize(width, height);
    ensureRenderTarget(ctx.renderer, this.accumRT);
    ensureRenderTarget(ctx.renderer, this.liveRT);
    ensureRenderTarget(ctx.renderer, this.compareRT);
    this.resetRequested = true;
  }

  dispose(): void {
    const el = document.querySelector('canvas');
    for (const [type, fn] of this.pointerHandlers) {
      if (type === 'pointerdown') el?.removeEventListener(type, fn);
      else window.removeEventListener(type, fn);
    }
    // Camera is shared across demos — never leave a jittered projection behind.
    if (this.jitterActive && this.cam) clearCameraJitter(this.cam);
    this.accumRT.dispose();
    this.liveRT.dispose();
    this.compareRT.dispose();
  }
}

export const referenceDemo: DemoDef = {
  id: '02-reference',
  label: '02 — Reference marcher',
  create: () => new ReferenceDemo(),
};
