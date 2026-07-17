import type { RenderTarget, Texture, WebGPURenderer } from 'three/webgpu';
import {
  ensureRenderTarget,
  ensureTexture,
  getDevice,
  getGPUTexture,
} from './three-internals';

// Compute sibling of RawRenderPass (harness/raw-pass.ts). Same declarative-
// binding philosophy, but dispatches an 8x8-workgroup WGSL compute kernel
// (entryPoint `main`) instead of a fullscreen triangle. Deliberately compute,
// not a fragment quad: M3's later bandwidth experiments (stage g / demo 09) need
// workgroup shared memory, which a fragment pass can't express.
//
// Conventions kept identical to RawRenderPass:
//   - textures read with textureLoad at integer coords (no sampler) unless the
//     binding is a 'sampledTex' (mip pyramid / PMREM env sampling need explicit-
//     LOD textureSampleLevel, so those get a companion 'sampler' binding);
//   - inter-pass outputs are three-allocated (interop rule): compute writes into
//     a three StorageTexture (STORAGE_BINDING | TEXTURE_BINDING) so the result is
//     still a plain TSL texture() node downstream;
//   - binding order in resources[] passed to execute() matches `bindings`.
//
// Storage-texture note (three@0.185.1): StorageTexture sets isStorageTexture, so
// WebGPUTextureUtils adds STORAGE_BINDING; format is derived from type/format
// (HalfFloatType + RGBAFormat -> rgba16float, which is a WebGPU
// storage-capable format with write access). The 'storage' binding must declare
// that same format so the pipeline layout matches.

export type RawComputeBinding =
  | { kind: 'depth' } // texture_depth_2d, aspect depth-only, textureLoad
  | { kind: 'tex'; sampleType?: GPUTextureSampleType } // textureLoad, default 'unfilterable-float'
  | { kind: 'sampledTex'; sampleType?: GPUTextureSampleType } // textureSampleLevel (needs a 'sampler')
  | { kind: 'sampler'; filtering?: boolean } // default non-filtering
  | { kind: 'storage'; format: GPUTextureFormat; access?: 'write-only' | 'read-write' }
  | { kind: 'uniform' };

// A resource supplied at execute() time, positionally matching a binding:
//   'depth' | 'tex' | 'sampledTex' | 'storage' -> a three Texture (or RT.texture)
//   'sampler'                                   -> a GPUSampler
//   'uniform'                                   -> a Float32Array
export type RawComputeResource = Texture | Float32Array | GPUSampler;

export interface RawComputePassOptions {
  bindings: RawComputeBinding[];
  workgroupSize?: [number, number]; // default [8, 8]
}

export class RawComputePass {
  private readonly device: GPUDevice;
  private readonly module: GPUShaderModule;
  private readonly bindings: RawComputeBinding[];
  private readonly wg: [number, number];
  private readonly bindGroupLayout: GPUBindGroupLayout;
  private uniformBuffer: GPUBuffer | null = null;
  private pipeline: GPUComputePipeline | null = null;

  constructor(
    private readonly renderer: WebGPURenderer,
    private readonly label: string,
    wgsl: string,
    options: RawComputePassOptions,
  ) {
    this.device = getDevice(renderer);
    this.bindings = options.bindings;
    this.wg = options.workgroupSize ?? [8, 8];
    this.module = this.device.createShaderModule({ label: `${label}:module`, code: wgsl });

    const entries: GPUBindGroupLayoutEntry[] = this.bindings.map((b, i) => {
      const visibility = GPUShaderStage.COMPUTE;
      if (b.kind === 'depth') {
        return { binding: i, visibility, texture: { sampleType: 'depth', viewDimension: '2d' } };
      }
      if (b.kind === 'tex') {
        return {
          binding: i,
          visibility,
          texture: { sampleType: b.sampleType ?? 'unfilterable-float', viewDimension: '2d' },
        };
      }
      if (b.kind === 'sampledTex') {
        return {
          binding: i,
          visibility,
          texture: { sampleType: b.sampleType ?? 'float', viewDimension: '2d' },
        };
      }
      if (b.kind === 'sampler') {
        return {
          binding: i,
          visibility,
          sampler: { type: b.filtering ? 'filtering' : 'non-filtering' },
        };
      }
      if (b.kind === 'storage') {
        return {
          binding: i,
          visibility,
          storageTexture: { access: b.access ?? 'write-only', format: b.format, viewDimension: '2d' },
        };
      }
      return { binding: i, visibility, buffer: { type: 'uniform' } };
    });

    this.bindGroupLayout = this.device.createBindGroupLayout({ label: `${label}:bgl`, entries });
  }

  // Builds the compute pipeline and (optionally) the uniform buffer. No output
  // format to read (unlike RawRenderPass): storage formats are declared in the
  // bindings. Call ensureTexture/ensureRenderTarget on outputs before the first
  // execute() so their GPUTextures exist.
  configure(uniformByteLength: number): void {
    const layout = this.device.createPipelineLayout({
      label: `${this.label}:layout`,
      bindGroupLayouts: [this.bindGroupLayout],
    });
    this.pipeline = this.device.createComputePipeline({
      label: `${this.label}:pipeline`,
      layout,
      compute: { module: this.module, entryPoint: 'main' },
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

  // Ensures a three RenderTarget or StorageTexture output is GPU-allocated.
  ensureOutput(target: RenderTarget | Texture): void {
    if ((target as RenderTarget).isRenderTarget) {
      ensureRenderTarget(this.renderer, target as RenderTarget);
    } else {
      ensureTexture(this.renderer, target as Texture);
    }
  }

  // Encodes + submits the dispatch. Command ordering on three's queue preserves
  // read-after-write relative to three's render() submissions, exactly like the
  // RawRenderPass pattern (demo 00 README).
  // opts.storageMip: base mip level for 'storage' bindings' views (default 0) —
  // lets one pass write successive mip levels of a mip-capable StorageTexture
  // (the depth-pyramid downsample chain, demo 03 stage g). The source is read
  // from a DIFFERENT texture (the depth buffer), so no same-texture read/write.
  execute(
    resources: RawComputeResource[],
    dispatchWidth: number,
    dispatchHeight: number,
    opts: { storageMip?: number } = {},
  ): void {
    if (!this.pipeline) {
      throw new Error(`RawComputePass(${this.label}): configure() must run before execute().`);
    }
    if (resources.length !== this.bindings.length) {
      throw new Error(
        `RawComputePass(${this.label}): expected ${this.bindings.length} resources, got ${resources.length}.`,
      );
    }

    const entries: GPUBindGroupEntry[] = this.bindings.map((b, i) => {
      const res = resources[i];
      if (b.kind === 'uniform') {
        if (!this.uniformBuffer) {
          throw new Error(`RawComputePass(${this.label}): uniform binding but no buffer configured.`);
        }
        const data = res as Float32Array;
        this.device.queue.writeBuffer(this.uniformBuffer, 0, data.buffer, data.byteOffset, data.byteLength);
        return { binding: i, resource: { buffer: this.uniformBuffer } };
      }
      if (b.kind === 'sampler') {
        return { binding: i, resource: res as GPUSampler };
      }
      const gpu = getGPUTexture(this.renderer, res as Texture);
      if (b.kind === 'depth') {
        return { binding: i, resource: gpu.createView({ aspect: 'depth-only' }) };
      }
      if (b.kind === 'storage') {
        // Storage bindings must view a single mip level (WebGPU rule).
        return {
          binding: i,
          resource: gpu.createView({ baseMipLevel: opts.storageMip ?? 0, mipLevelCount: 1 }),
        };
      }
      return { binding: i, resource: gpu.createView() };
    });

    const bindGroup = this.device.createBindGroup({
      label: `${this.label}:bg`,
      layout: this.bindGroupLayout,
      entries,
    });

    const encoder = this.device.createCommandEncoder({ label: `${this.label}:encoder` });
    const pass = encoder.beginComputePass({ label: `${this.label}:computepass` });
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(
      Math.ceil(dispatchWidth / this.wg[0]),
      Math.ceil(dispatchHeight / this.wg[1]),
      1,
    );
    pass.end();
    this.device.queue.submit([encoder.finish()]);
  }
}
