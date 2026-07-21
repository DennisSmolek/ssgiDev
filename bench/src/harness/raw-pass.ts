import type { RenderTarget, Texture, WebGPURenderer } from 'three/webgpu';
import {
  ensureRenderTarget,
  getDevice,
  getGPUTexture,
  getGPUTextureFormat,
} from './three-internals';

// Generalized sibling of RawFragmentPass (harness/raw-fragment-pass.ts, demo 00).
// RawFragmentPass hardcodes a single depth-texture + uniform bind group; the
// reference marcher (demo 02) needs several G-buffer textures plus a history
// texture, and the A/B comparator needs two arbitrary textures. Rather than
// bake another fixed layout, RawRenderPass takes a declarative binding list and
// a per-execute loadOp so the same class serves the marcher (additive-blend
// accumulation → loadOp 'load') and the comparator (loadOp 'clear').
//
// Conventions kept identical to RawFragmentPass:
//   - fullscreen WGSL exposing `@vertex fn vs` + `@fragment fn fs`
//   - writes into a three-allocated RenderTarget (interop rule: raw passes never
//     allocate inter-pass textures); pipeline format read from three's descriptor
//   - all textures read with textureLoad at integer coords (no samplers): every
//     raw pass runs at renderSize, the final TSL display upscales to canvas.
//
// Binding order in resources[] passed to execute() matches the `bindings` array.

export type RawBinding =
  | { kind: 'depth' } // texture_depth_2d, aspect depth-only
  | { kind: 'tex'; sampleType?: GPUTextureSampleType } // textureLoad, default 'unfilterable-float'
  | { kind: 'sampledTex'; sampleType?: GPUTextureSampleType } // textureSampleLevel (needs a 'sampler')
  | { kind: 'sampler'; filtering?: boolean } // default non-filtering
  | { kind: 'uniform' };

// A resource supplied at execute() time, positionally matching a binding:
//   'depth' | 'tex' | 'sampledTex' -> a three Texture
//   'sampler'                      -> a GPUSampler
//   'uniform'                      -> a Float32Array (written into the pass's uniform buffer)
export type RawResource = Texture | Float32Array | GPUSampler;

export interface RawRenderPassOptions {
  bindings: RawBinding[];
  // Optional blend state (e.g. additive accumulation). Omit for opaque overwrite.
  blend?: GPUBlendState;
  // Fragment entry point (default 'fs'). Lets one WGSL module expose a variant
  // entry (e.g. an MRT bent-normal variant) without touching the base 'fs'.
  fragmentEntryPoint?: string;
}

export interface RawExecuteOptions {
  loadOp?: GPULoadOp; // default 'clear'
  clearValue?: GPUColor; // default {0,0,0,1}
  // Additional color attachments (MRT), positionally after the primary target.
  // Same loadOp/clearValue/blend as the primary. Length must match the count
  // passed to configure()'s extraTargets. Omit for single-target passes.
  extraOutputs?: RenderTarget[];
}

export class RawRenderPass {
  private readonly device: GPUDevice;
  private readonly module: GPUShaderModule;
  private readonly bindings: RawBinding[];
  private readonly blend?: GPUBlendState;
  private readonly fragmentEntryPoint: string;
  private readonly bindGroupLayout: GPUBindGroupLayout;
  private uniformBuffer: GPUBuffer | null = null;
  private pipeline: GPURenderPipeline | null = null;
  private targetFormat: GPUTextureFormat | null = null;
  private extraTargetCount = 0;

  constructor(
    private readonly renderer: WebGPURenderer,
    private readonly label: string,
    wgsl: string,
    options: RawRenderPassOptions,
  ) {
    this.device = getDevice(renderer);
    this.bindings = options.bindings;
    this.blend = options.blend;
    this.fragmentEntryPoint = options.fragmentEntryPoint ?? 'fs';
    this.module = this.device.createShaderModule({ label: `${label}:module`, code: wgsl });

    const entries: GPUBindGroupLayoutEntry[] = this.bindings.map((b, i) => {
      if (b.kind === 'depth') {
        return {
          binding: i,
          visibility: GPUShaderStage.FRAGMENT,
          texture: { sampleType: 'depth', viewDimension: '2d' },
        };
      }
      if (b.kind === 'tex') {
        return {
          binding: i,
          visibility: GPUShaderStage.FRAGMENT,
          texture: { sampleType: b.sampleType ?? 'unfilterable-float', viewDimension: '2d' },
        };
      }
      if (b.kind === 'sampledTex') {
        return {
          binding: i,
          visibility: GPUShaderStage.FRAGMENT,
          texture: { sampleType: b.sampleType ?? 'float', viewDimension: '2d' },
        };
      }
      if (b.kind === 'sampler') {
        return {
          binding: i,
          visibility: GPUShaderStage.FRAGMENT,
          sampler: { type: b.filtering ? 'filtering' : 'non-filtering' },
        };
      }
      return {
        binding: i,
        visibility: GPUShaderStage.FRAGMENT,
        buffer: { type: 'uniform' },
      };
    });

    this.bindGroupLayout = this.device.createBindGroupLayout({
      label: `${label}:bgl`,
      entries,
    });
  }

  // Reads three's assigned format for the output target and builds the pipeline.
  // Forces the output RenderTarget's GPU texture to exist so the first execute()
  // can write before three has sampled it.
  configure(outputTarget: RenderTarget, uniformByteLength: number, extraTargets: RenderTarget[] = []): void {
    ensureRenderTarget(this.renderer, outputTarget);
    this.targetFormat = getGPUTextureFormat(this.renderer, outputTarget.texture);
    this.extraTargetCount = extraTargets.length;

    const targets: GPUColorTargetState[] = [{ format: this.targetFormat, blend: this.blend }];
    for (const t of extraTargets) {
      ensureRenderTarget(this.renderer, t);
      targets.push({ format: getGPUTextureFormat(this.renderer, t.texture), blend: this.blend });
    }

    const layout = this.device.createPipelineLayout({
      label: `${this.label}:layout`,
      bindGroupLayouts: [this.bindGroupLayout],
    });
    this.pipeline = this.device.createRenderPipeline({
      label: `${this.label}:pipeline`,
      layout,
      vertex: { module: this.module, entryPoint: 'vs' },
      fragment: {
        module: this.module,
        entryPoint: this.fragmentEntryPoint,
        targets,
      },
      primitive: { topology: 'triangle-list' },
    });

    if (uniformByteLength > 0) {
      const size = Math.max(16, Math.ceil(uniformByteLength / 16) * 16);
      this.uniformBuffer = this.device.createBuffer({
        label: `${this.label}:uniforms`,
        size,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });
    }
  }

  // Encodes + submits the pass. GPU command ordering on three's queue preserves
  // read-after-write relative to three's render() submissions, so calling this
  // between the G-buffer render and the display render is correctly ordered.
  execute(outputTarget: RenderTarget, resources: RawResource[], opts: RawExecuteOptions = {}): void {
    if (!this.pipeline) {
      throw new Error(`RawRenderPass(${this.label}): configure() must run before execute().`);
    }
    if (resources.length !== this.bindings.length) {
      throw new Error(
        `RawRenderPass(${this.label}): expected ${this.bindings.length} resources, got ${resources.length}.`,
      );
    }
    const extraOutputs = opts.extraOutputs ?? [];
    if (extraOutputs.length !== this.extraTargetCount) {
      throw new Error(
        `RawRenderPass(${this.label}): expected ${this.extraTargetCount} extra outputs, got ${extraOutputs.length}.`,
      );
    }

    const entries: GPUBindGroupEntry[] = this.bindings.map((b, i) => {
      const res = resources[i];
      if (b.kind === 'uniform') {
        if (!this.uniformBuffer) {
          throw new Error(`RawRenderPass(${this.label}): uniform binding but no buffer configured.`);
        }
        const data = res as Float32Array;
        this.device.queue.writeBuffer(
          this.uniformBuffer,
          0,
          data.buffer,
          data.byteOffset,
          data.byteLength,
        );
        return { binding: i, resource: { buffer: this.uniformBuffer } };
      }
      if (b.kind === 'sampler') {
        return { binding: i, resource: res as GPUSampler };
      }
      const gpu = getGPUTexture(this.renderer, res as Texture);
      const view = b.kind === 'depth' ? gpu.createView({ aspect: 'depth-only' }) : gpu.createView();
      return { binding: i, resource: view };
    });

    // Rebuilt every frame: the GPU textures are reallocated by three on resize.
    const bindGroup = this.device.createBindGroup({
      label: `${this.label}:bg`,
      layout: this.bindGroupLayout,
      entries,
    });

    const loadOp = opts.loadOp ?? 'clear';
    const clearValue = opts.clearValue ?? { r: 0, g: 0, b: 0, a: 1 };
    const colorAttachments: GPURenderPassColorAttachment[] = [
      {
        view: getGPUTexture(this.renderer, outputTarget.texture).createView(),
        loadOp,
        storeOp: 'store',
        clearValue,
      },
    ];
    for (const t of extraOutputs) {
      colorAttachments.push({
        view: getGPUTexture(this.renderer, t.texture).createView(),
        loadOp,
        storeOp: 'store',
        clearValue,
      });
    }
    const encoder = this.device.createCommandEncoder({ label: `${this.label}:encoder` });
    const pass = encoder.beginRenderPass({
      label: `${this.label}:renderpass`,
      colorAttachments,
    });
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.draw(3);
    pass.end();
    this.device.queue.submit([encoder.finish()]);
  }
}
