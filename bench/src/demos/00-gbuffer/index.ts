import { HalfFloatType, NoColorSpace, RenderTarget } from 'three/webgpu';
import {
  clamp,
  diffuseColor,
  float,
  mrt,
  normalView,
  output,
  pass,
  perspectiveDepthToViewZ,
  screenUV,
  texture,
  uniform,
  vec3,
  vec4,
  velocity,
} from 'three/tsl';
import { RenderPipeline } from 'three/webgpu';
import type { DepthTexture, Texture } from 'three/webgpu';
import type { Demo, DemoDef, HarnessContext } from '../../harness/types';
import { RawFragmentPass } from '../../harness/raw-fragment-pass';
import { ensureRenderTarget } from '../../harness/three-internals';
import { buildParams } from '../../harness/params';
import type { ParamGroup } from '../../harness/params';
import depthVisWgsl from './depth-vis.wgsl?raw';

const VIEW_MODES = [
  'beauty',
  'albedo',
  'normal',
  'depthLinear',
  'velocity',
  'rawDepth',
] as const;
type ViewMode = (typeof VIEW_MODES)[number];

const schema = {
  viewMode: { type: 'enum', value: 'beauty' as ViewMode, options: VIEW_MODES, label: 'view' },
  vizNear: { type: 'number', value: 6, min: 0.1, max: 30, step: 0.1, label: 'depth viz near' },
  vizFar: { type: 'number', value: 15, min: 0.2, max: 50, step: 0.1, label: 'depth viz far' },
  velocityScale: { type: 'number', value: 40, min: 1, max: 400, step: 1, label: 'velocity scale' },
} as const;

// Uniform layout for depth-vis.wgsl: camNear, camFar, vizNear, vizFar.
const RAW_UNIFORM_FLOATS = 4;

class GBufferDemo implements Demo {
  // three-managed G-buffer textures.
  private beautyTex!: Texture;
  private albedoTex!: Texture;
  private normalTex!: Texture;
  private velocityTex!: Texture;
  private depthTex!: DepthTexture;

  private scenePass!: ReturnType<typeof pass>;
  private gbufferPipeline!: RenderPipeline;
  private displayPipeline!: RenderPipeline;

  // Raw-pass smoke test: reads depthTex, writes grayscale into rawVisRT.
  private rawVisRT!: RenderTarget;
  private rawPass!: RawFragmentPass;
  private rawUniform = new Float32Array(RAW_UNIFORM_FLOATS);

  // Display uniforms (updated per frame; changing them never recompiles).
  private uNear = uniform(0.1);
  private uFar = uniform(50);
  private uVizNear = uniform(6);
  private uVizFar = uniform(15);
  private uVelScale = uniform(40);

  private params!: ParamGroup<typeof schema>;

  init(ctx: HarnessContext): void {
    const cam = ctx.scene.camera;

    // --- G-buffer pass with MRT: beauty / albedo / view-normal / velocity ---
    this.scenePass = pass(ctx.scene.scene, cam);
    this.scenePass.setMRT(
      mrt({
        output: output,
        albedo: diffuseColor,
        normal: normalView, // view-space normals, [-1,1], WebGPU top-left UV
        velocity: velocity, // screen-space motion vectors
      }),
    );

    this.beautyTex = this.scenePass.getTexture('output');
    this.albedoTex = this.scenePass.getTexture('albedo');
    this.normalTex = this.scenePass.getTexture('normal');
    this.velocityTex = this.scenePass.getTexture('velocity');
    this.depthTex = this.scenePass.renderTarget.depthTexture!;

    // gbufferPipeline renders the scene into the MRT + depth targets. Its blit
    // to canvas is overwritten by displayPipeline each frame (documented in
    // README) — the point is the side effect of filling the G-buffer.
    this.gbufferPipeline = new RenderPipeline(ctx.renderer, this.scenePass);

    // Raw-pass output target (three-allocated, per the interop rule). rgba16float
    // (HalfFloat) + NoColorSpace avoids any srgb format ambiguity for the raw
    // pipeline's color attachment.
    this.rawVisRT = new RenderTarget(1, 1, { type: HalfFloatType, depthBuffer: false });
    this.rawVisRT.texture.colorSpace = NoColorSpace;

    this.rawPass = new RawFragmentPass(ctx.renderer, 'depth-vis', depthVisWgsl);

    this.displayPipeline = new RenderPipeline(ctx.renderer);

    // Size everything to the current render resolution, then build the raw
    // pipeline (format read from the now-allocated rawVisRT texture).
    this.resize(ctx);
    this.rawPass.configure(this.rawVisRT, this.rawUniform.byteLength);

    // --- Params folder ---
    const folder = ctx.pane.addFolder({ title: 'Demo 00 — G-buffer' });
    this.params = buildParams(folder, schema);
    this.params.onChange((key) => {
      if (key === 'viewMode') this.updateOutputNode();
    });

    // Optional deterministic initial view via ?view=<mode> (used for scripted
    // screenshots / URL routing).
    const urlView = new URLSearchParams(window.location.search).get('view');
    if (urlView && (VIEW_MODES as readonly string[]).includes(urlView)) {
      this.params.values.viewMode = urlView as ViewMode;
      this.params.refresh();
    }

    this.updateOutputNode();
  }

  private updateOutputNode(): void {
    this.displayPipeline.outputNode = this.buildViewNode(this.params.values.viewMode);
    // three's RenderPipeline only re-reads outputNode when needsUpdate is set
    // (RenderPipeline.js render(): `if (this.needsUpdate === true)`).
    this.displayPipeline.needsUpdate = true;
  }

  private buildViewNode(mode: ViewMode) {
    const uv = screenUV;
    switch (mode) {
      case 'beauty':
        return vec4(texture(this.beautyTex, uv).rgb, float(1));
      case 'albedo':
        return vec4(texture(this.albedoTex, uv).rgb, float(1));
      case 'normal': {
        // view-space normal -> [0,1] color. RH view space, WebGPU top-left UV.
        const n = texture(this.normalTex, uv).xyz;
        return vec4(n.mul(0.5).add(0.5), float(1));
      }
      case 'depthLinear': {
        const d = texture(this.depthTex, uv).x;
        const viewZ = perspectiveDepthToViewZ(d, this.uNear, this.uFar); // negative
        const dist = viewZ.negate();
        const g = clamp(dist.sub(this.uVizNear).div(this.uVizFar.sub(this.uVizNear)), 0, 1);
        const shade = float(1).sub(g);
        return vec4(vec3(shade), float(1));
      }
      case 'velocity': {
        // signed encode: 0.5 = no motion, R=+x, G=+y.
        const v = texture(this.velocityTex, uv).xy;
        const enc = v.mul(this.uVelScale).mul(0.5).add(0.5);
        return vec4(enc.x, enc.y, float(0.5), float(1));
      }
      case 'rawDepth':
        // Produced by the handwritten WGSL raw pass (already grayscale).
        return vec4(texture(this.rawVisRT.texture, uv).rgb, float(1));
    }
  }

  frame(ctx: HarnessContext, _dt: number): void {
    const cam = ctx.scene.camera;

    // 1. Render the G-buffer (fills MRT + depth). Order matters: this must run
    //    before the raw pass reads depth and before the display pass samples.
    this.gbufferPipeline.render();

    // 2. Raw WGSL pass: linearized-depth visualization into rawVisRT.
    this.rawUniform[0] = cam.near;
    this.rawUniform[1] = cam.far;
    this.rawUniform[2] = this.params.values.vizNear;
    this.rawUniform[3] = this.params.values.vizFar;
    const t0 = performance.now();
    this.rawPass.execute(this.depthTex, this.rawVisRT, this.rawUniform);
    ctx.timing.markCPU('raw', performance.now() - t0);

    // 3. Sync display uniforms and render the selected view to canvas.
    this.uNear.value = cam.near;
    this.uFar.value = cam.far;
    this.uVizNear.value = this.params.values.vizNear;
    this.uVizFar.value = this.params.values.vizFar;
    this.uVelScale.value = this.params.values.velocityScale;
    this.displayPipeline.render();

    ctx.timing.sampleGPU(ctx.renderer);
  }

  resize(ctx: HarnessContext): void {
    const { width, height } = ctx.renderSize();
    this.scenePass.setSize(width, height);
    this.rawVisRT.setSize(width, height);
    // Reallocate the raw output GPU texture at the new size so the next frame's
    // raw pass can write into it before three samples it.
    ensureRenderTarget(ctx.renderer, this.rawVisRT);
  }

  dispose(): void {
    this.rawVisRT.dispose();
    // RenderPipeline / PassNode hold GPU resources tied to the renderer; the App
    // recreates them per demo. Nulling references is sufficient for M0.
  }
}

export const gbufferDemo: DemoDef = {
  id: '00-gbuffer',
  label: '00 — G-buffer inspector',
  create: () => new GBufferDemo(),
};
