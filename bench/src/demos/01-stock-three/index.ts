import { UnsignedByteType } from 'three/webgpu';
import { RenderPipeline } from 'three/webgpu';
import type { PerspectiveCamera } from 'three/webgpu';
import {
  add,
  diffuseColor,
  metalness,
  mrt,
  normalView,
  output,
  packNormalToRGB,
  pass,
  roughness,
  sample,
  unpackRGBToNormal,
  vec3,
  vec4,
  velocity,
} from 'three/tsl';
import { ssgi } from 'three/addons/tsl/display/SSGINode.js';
import { ao as gtao } from 'three/addons/tsl/display/GTAONode.js';
import { ssr } from 'three/addons/tsl/display/SSRNode.js';
import { traa } from 'three/addons/tsl/display/TRAANode.js';
import { denoise } from 'three/addons/tsl/display/DenoiseNode.js';
import type { Demo, DemoDef, HarnessContext } from '../../harness/types';
import { buildParams } from '../../harness/params';
import type { ParamGroup } from '../../harness/params';

// Demo 01 — the stock three.js pipeline (the baseline every other demo beats).
// SSGINode (GI + AO) composited per three's own webgpu_postprocessing_ssgi example,
// GTAONode as a toggleable AO control, SSRNode added to the chain (our one change),
// and a post-AA/denoise selector (TRAA / DenoiseNode / none). See README.md.
//
// TSL node graphs are dynamically typed; the derived-node plumbing below is `any`
// on purpose (standard for TSL-heavy code). The stateful effect nodes keep their
// real class types so `.value` / `.getAONode()` / `.dispose()` stay checked.

/* eslint-disable @typescript-eslint/no-explicit-any */
type Node = any;

const AO_MODES = ['ssgi', 'gtao'] as const;
type AoMode = (typeof AO_MODES)[number];

const POST_MODES = ['traa', 'denoise', 'none'] as const;
type PostMode = (typeof POST_MODES)[number];

const VIEW_MODES = ['final', 'ao', 'gi'] as const;
type ViewMode = (typeof VIEW_MODES)[number];

const REQUIRED_FEATURE = 'rg11b10ufloat-renderable';

// Params. SSGINode uniforms mirror its source (node_modules SSGINode.js) 1:1;
// mode toggles above them drive graph rebuilds. GTAO + SSR params grouped after.
const schema = {
  // --- mode toggles (rebuild the node graph) ---
  aoMode: { type: 'enum', value: 'ssgi' as AoMode, options: AO_MODES, label: 'AO mode' },
  ssrEnabled: { type: 'boolean', value: false, label: 'SSR (added)' },
  post: { type: 'enum', value: 'traa' as PostMode, options: POST_MODES, label: 'post AA/denoise' },
  viewMode: { type: 'enum', value: 'final' as ViewMode, options: VIEW_MODES, label: 'debug view' },
  // --- SSGINode params (live uniforms, no rebuild) ---
  sliceCount: { type: 'number', value: 2, min: 1, max: 4, step: 1, label: 'ssgi sliceCount' },
  stepCount: { type: 'number', value: 8, min: 1, max: 32, step: 1, label: 'ssgi stepCount' },
  radius: { type: 'number', value: 12, min: 1, max: 25, step: 0.5, label: 'ssgi radius' },
  thickness: { type: 'number', value: 1, min: 0.01, max: 10, step: 0.01, label: 'ssgi thickness' },
  useLinearThickness: { type: 'boolean', value: false, label: 'ssgi linearThickness' },
  useScreenSpaceSampling: { type: 'boolean', value: true, label: 'ssgi ssSampling' },
  expFactor: { type: 'number', value: 2, min: 1, max: 3, step: 0.05, label: 'ssgi expFactor' },
  aoIntensity: { type: 'number', value: 1, min: 0, max: 4, step: 0.05, label: 'ssgi aoIntensity' },
  giIntensity: { type: 'number', value: 10, min: 0, max: 100, step: 0.5, label: 'ssgi giIntensity' },
  backfaceLighting: { type: 'number', value: 0, min: 0, max: 1, step: 0.01, label: 'ssgi backface' },
  // --- GTAO params (control mode) ---
  gtaoRadius: { type: 'number', value: 0.5, min: 0.05, max: 4, step: 0.05, label: 'gtao radius' },
  gtaoThickness: { type: 'number', value: 1, min: 0.01, max: 4, step: 0.01, label: 'gtao thickness' },
  gtaoScale: { type: 'number', value: 1, min: 0, max: 4, step: 0.05, label: 'gtao scale' },
  gtaoSamples: { type: 'number', value: 16, min: 4, max: 32, step: 1, label: 'gtao samples' },
  // --- SSR params ---
  ssrIntensity: { type: 'number', value: 1, min: 0, max: 3, step: 0.05, label: 'ssr intensity' },
  ssrMaxDistance: { type: 'number', value: 1, min: 0.1, max: 20, step: 0.1, label: 'ssr maxDist' },
  ssrThickness: { type: 'number', value: 0.1, min: 0.01, max: 2, step: 0.01, label: 'ssr thickness' },
} as const;

class StockThreeDemo implements Demo {
  private pipeline!: RenderPipeline;
  private scenePass!: ReturnType<typeof pass>;
  private camera!: PerspectiveCamera;

  // Persistent effect nodes (created once; their updateBefore only fires when the
  // node is referenced by the current outputNode, so an un-toggled effect costs
  // nothing). SSGI/GTAO/SSR keep their own render targets + temporal history.
  private giPass: ReturnType<typeof ssgi> | null = null;
  private gtaoPass: ReturnType<typeof gtao> | null = null;
  private ssrPass: ReturnType<typeof ssr> | null = null;

  // Post wrapper (TRAA/Denoise) — recreated on rebuild (it wraps a composite whose
  // identity changes with the mode); disposed before replacement to avoid leaks.
  private postNode: { dispose?(): void } | null = null;

  // Cached texture nodes derived from the scene pass MRT.
  private sceneColor!: Node;
  private sceneDiffuse!: Node;
  private sceneDepth!: Node;
  private sceneNormal!: Node;
  private sceneVelocity!: Node;
  private sceneMetalRough!: Node;

  private params!: ParamGroup<typeof schema>;
  private ssgiAvailable = true;

  init(ctx: HarnessContext): void {
    this.camera = ctx.scene.camera;
    this.ssgiAvailable = ctx.capabilities.features[REQUIRED_FEATURE] === true;

    // --- Scene pass with MRT (output / albedo / packed normal / velocity+MR). ---
    // We extend three's SSGI-example MRT (output/diffuse/normal/velocity) by
    // packing SSR's per-pixel metalness+roughness into velocity's unused .zw
    // channels (velocity is a 2-component motion vector in a RGBA16F target, and
    // TRAANode reads only .xy — verified in TRAANode.js:664). This keeps the pass
    // at FOUR color attachments = 24 bytes/sample; a fifth attachment overflows
    // Dawn's 32-byte maxColorAttachmentBytesPerSample on this adapter.
    this.scenePass = pass(ctx.scene.scene, this.camera);
    this.scenePass.setMRT(
      mrt({
        output: output,
        diffuseColor: diffuseColor, // albedo — GI is modulated by this at composite
        normal: packNormalToRGB(normalView), // view-space, [0,1]-packed
        // xy=motion, z=metal, w=rough (velocity is vec2 at runtime; cast for TSL types)
        velocity: vec4(velocity as unknown as Node, metalness, roughness),
      }),
    );

    // 8-bit is plenty for albedo + packed normal (matches three's examples; saves
    // bandwidth — the cost structure here is bandwidth, not ALU). Velocity stays
    // RGBA16F for motion precision and to carry metal/rough without banding.
    this.scenePass.getTexture('diffuseColor').type = UnsignedByteType;
    this.scenePass.getTexture('normal').type = UnsignedByteType;

    // --- Derived texture nodes ---
    this.sceneColor = this.scenePass.getTextureNode('output');
    this.sceneDiffuse = this.scenePass.getTextureNode('diffuseColor');
    this.sceneDepth = this.scenePass.getTextureNode('depth');
    this.sceneVelocity = this.scenePass.getTextureNode('velocity'); // TRAA reads .xy
    this.sceneMetalRough = this.scenePass.getTextureNode('velocity'); // .z/.w for SSR
    const packedNormal = this.scenePass.getTextureNode('normal');
    // Unpack view-space normals for SSGI/GTAO/SSR (they want [-1,1] normals).
    this.sceneNormal = sample((uv: Node) => unpackRGBToNormal(packedNormal.sample(uv)));

    // --- Persistent effect nodes ---
    if (this.ssgiAvailable) {
      this.giPass = ssgi(this.sceneColor, this.sceneDepth, this.sceneNormal, this.camera);
    }
    this.gtaoPass = gtao(this.sceneDepth, this.sceneNormal, this.camera);
    this.ssrPass = ssr(this.sceneColor, this.sceneDepth, this.sceneNormal, {
      metalnessNode: this.sceneMetalRough.z, // packed into velocity.z
      roughnessNode: this.sceneMetalRough.w, // packed into velocity.w
      camera: this.camera,
    });

    this.pipeline = new RenderPipeline(ctx.renderer);
    this.resize(ctx);

    // --- Params folder ---
    const folder = ctx.pane.addFolder({ title: 'Demo 01 — stock three' });
    if (!this.ssgiAvailable) {
      folder.addBlade({
        view: 'text',
        label: 'ERROR',
        parse: (v: string) => v,
        value: `missing ${REQUIRED_FEATURE} — SSGI disabled, using GTAO`,
      });
      console.error(
        `THREE.SSGINode requires the "${REQUIRED_FEATURE}" WebGPU feature, which this ` +
          `device lacks. Demo 01 falls back to the GTAO AO path; SSGI/GI is unavailable.`,
      );
    }
    this.params = buildParams(folder, schema);
    if (!this.ssgiAvailable) this.params.values.aoMode = 'gtao';

    this.params.onChange((key) => {
      // Uniform-only changes never rebuild; mode/view changes do.
      if (key === 'aoMode' || key === 'ssrEnabled' || key === 'post' || key === 'viewMode') {
        this.rebuild();
      } else {
        this.syncUniforms();
      }
    });

    // URL overrides for deterministic screenshots / benchmark configs:
    //   ?view=final|ao|gi  ?aoMode=ssgi|gtao  ?post=traa|denoise|none  ?ssr=1
    const q = new URLSearchParams(window.location.search);
    const urlView = q.get('view');
    if (urlView && (VIEW_MODES as readonly string[]).includes(urlView)) {
      this.params.values.viewMode = urlView as ViewMode;
    }
    const urlAo = q.get('aoMode');
    if (urlAo && (AO_MODES as readonly string[]).includes(urlAo) && this.ssgiAvailable) {
      this.params.values.aoMode = urlAo as AoMode;
    }
    const urlPost = q.get('post');
    if (urlPost && (POST_MODES as readonly string[]).includes(urlPost)) {
      this.params.values.post = urlPost as PostMode;
    }
    if (q.get('ssr') === '1') this.params.values.ssrEnabled = true;
    this.params.refresh();

    this.syncUniforms();
    this.rebuild();
  }

  private syncUniforms(): void {
    const v = this.params.values;
    if (this.giPass) {
      this.giPass.sliceCount.value = v.sliceCount;
      this.giPass.stepCount.value = v.stepCount;
      this.giPass.radius.value = v.radius;
      this.giPass.thickness.value = v.thickness;
      this.giPass.useLinearThickness.value = v.useLinearThickness;
      this.giPass.useScreenSpaceSampling.value = v.useScreenSpaceSampling;
      this.giPass.expFactor.value = v.expFactor;
      this.giPass.aoIntensity.value = v.aoIntensity;
      this.giPass.giIntensity.value = v.giIntensity;
      this.giPass.backfaceLighting.value = v.backfaceLighting;
      // Temporal jitter only helps if TRAA follows (SSGINode docs).
      this.giPass.useTemporalFiltering = v.post === 'traa';
    }
    if (this.gtaoPass) {
      this.gtaoPass.radius.value = v.gtaoRadius;
      this.gtaoPass.thickness.value = v.gtaoThickness;
      this.gtaoPass.scale.value = v.gtaoScale;
      this.gtaoPass.samples.value = v.gtaoSamples;
    }
    if (this.ssrPass) {
      this.ssrPass.intensity.value = v.ssrIntensity;
      this.ssrPass.maxDistance.value = v.ssrMaxDistance;
      this.ssrPass.thickness.value = v.ssrThickness;
    }
  }

  // Rebuilds the outputNode graph for the current mode/view selection.
  private rebuild(): void {
    const v = this.params.values;
    const useSSGI = v.aoMode === 'ssgi' && this.giPass !== null;

    let base: Node;
    let aoOnly: Node;
    let giOnly: Node;

    if (useSSGI && this.giPass) {
      const aoNode = this.giPass.getAONode();
      const giNode = this.giPass.getGINode();
      // three's canonical SSGI composite: direct light * AO + albedo * GI.
      base = vec4(
        add(this.sceneColor.rgb.mul(aoNode.r), this.sceneDiffuse.rgb.mul(giNode.rgb)),
        this.sceneColor.a,
      );
      aoOnly = vec4(vec3(aoNode.r), 1);
      giOnly = vec4(giNode.rgb, 1);
    } else if (this.gtaoPass) {
      const aoTex = this.gtaoPass.getTextureNode();
      base = this.sceneColor.mul(vec4(vec3(aoTex.r), 1));
      aoOnly = vec4(vec3(aoTex.r), 1);
      // No GI in GTAO mode — the GI debug slot shows the AO-modulated beauty.
      giOnly = base;
    } else {
      base = this.sceneColor;
      aoOnly = this.sceneColor;
      giOnly = this.sceneColor;
    }

    // --- SSR (our added stage): additive over the composite base ---
    let composite: Node = base;
    if (v.ssrEnabled && this.ssrPass) {
      composite = vec4(base.rgb.add(this.ssrPass.rgb), base.a);
    }

    // --- Post AA / denoise selector (wraps the final composite) ---
    if (this.postNode?.dispose) this.postNode.dispose();
    this.postNode = null;

    let finalNode: Node = composite;
    if (v.post === 'traa') {
      const t = traa(composite, this.sceneDepth, this.sceneVelocity, this.camera);
      this.postNode = t as unknown as { dispose?(): void };
      finalNode = t;
    } else if (v.post === 'denoise') {
      const d = denoise(composite, this.sceneDepth, this.sceneNormal, this.camera);
      this.postNode = d as unknown as { dispose?(): void };
      finalNode = d;
    }

    // --- Debug view selection ---
    this.pipeline.needsUpdate = true;
    switch (v.viewMode) {
      case 'final':
        this.pipeline.outputNode = finalNode;
        break;
      case 'ao':
        this.pipeline.outputNode = aoOnly;
        break;
      case 'gi':
        this.pipeline.outputNode = giOnly;
        break;
    }
  }

  frame(ctx: HarnessContext, _dt: number): void {
    this.pipeline.render();
    ctx.timing.sampleGPU(ctx.renderer);
  }

  resize(ctx: HarnessContext): void {
    const { width, height } = ctx.renderSize();
    this.scenePass.setSize(width, height);
    // Effect nodes size themselves from the drawing buffer in updateBefore
    // (renderer.getDrawingBufferSize), so no explicit setSize is needed here.
  }

  dispose(): void {
    if (this.postNode?.dispose) this.postNode.dispose();
    this.giPass?.dispose?.();
    this.gtaoPass?.dispose?.();
    this.ssrPass?.dispose?.();
  }
}

export const stockThreeDemo: DemoDef = {
  id: '01-stock-three',
  label: '01 — stock three (SSGI + SSR)',
  create: () => new StockThreeDemo(),
};
