import type { RenderTarget, Texture, WebGPURenderer } from 'three/webgpu';
import {
  ensureRenderTarget,
  getDevice,
  getGPUTexture,
  getGPUTextureFormat,
} from './three-internals';

// A handwritten WGSL fullscreen pass that reads a three-managed depth texture
// and writes into a three-allocated RenderTarget, submitted on three's own
// GPUDevice. This is the template for all future raw passes (PLAN.md interop
// rule: raw passes never allocate their own inter-pass textures).
//
// Fixed bind group layout (@group(0)):
//   @binding(0) texture_depth_2d   -- the depth texture to read (aspect depth-only)
//   @binding(1) uniform buffer      -- caller-supplied params
//
// The WGSL module must expose `@vertex fn vs(...)` and `@fragment fn fs(...)`.
// The color attachment format is read from three's texture descriptor at
// configure() time so the pipeline format matches exactly (no srgb guessing).
export class RawFragmentPass {
  private readonly device: GPUDevice;
  private readonly module: GPUShaderModule;
  private readonly bindGroupLayout: GPUBindGroupLayout;
  private uniformBuffer: GPUBuffer | null = null;
  private pipeline: GPURenderPipeline | null = null;
  private targetFormat: GPUTextureFormat | null = null;

  constructor(
    private readonly renderer: WebGPURenderer,
    private readonly label: string,
    wgsl: string,
  ) {
    this.device = getDevice(renderer);
    this.module = this.device.createShaderModule({ label: `${label}:module`, code: wgsl });
    this.bindGroupLayout = this.device.createBindGroupLayout({
      label: `${label}:bgl`,
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.FRAGMENT,
          texture: { sampleType: 'depth', viewDimension: '2d' },
        },
        {
          binding: 1,
          visibility: GPUShaderStage.FRAGMENT,
          buffer: { type: 'uniform' },
        },
      ],
    });
  }

  // Reads three's assigned GPU format for the output target and builds the
  // pipeline. Also forces the output RenderTarget's GPU texture to exist so the
  // first execute() can write into it before three has sampled it.
  configure(outputTarget: RenderTarget, uniformByteLength: number): void {
    ensureRenderTarget(this.renderer, outputTarget);
    this.targetFormat = getGPUTextureFormat(this.renderer, outputTarget.texture);

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
        entryPoint: 'fs',
        targets: [{ format: this.targetFormat }],
      },
      primitive: { topology: 'triangle-list' },
    });

    const size = Math.max(16, Math.ceil(uniformByteLength / 16) * 16);
    this.uniformBuffer = this.device.createBuffer({
      label: `${this.label}:uniforms`,
      size,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
  }

  // Encodes and submits the pass for this frame. GPU command ordering is
  // preserved relative to three's render()/render() submissions on the same
  // queue, so calling this between the G-buffer render and the display render
  // gives correct read-after-write ordering.
  execute(depthTexture: Texture, outputTarget: RenderTarget, uniformData: Float32Array): void {
    if (!this.pipeline || !this.uniformBuffer) {
      throw new Error(`RawFragmentPass(${this.label}): configure() must run before execute().`);
    }

    this.device.queue.writeBuffer(
      this.uniformBuffer,
      0,
      uniformData.buffer,
      uniformData.byteOffset,
      uniformData.byteLength,
    );

    const depthGPU = getGPUTexture(this.renderer, depthTexture);
    const outputGPU = getGPUTexture(this.renderer, outputTarget.texture);

    // Rebuilt every frame: the depth/output GPUTextures are reallocated by three
    // on resize, so caching by identity would go stale.
    const bindGroup = this.device.createBindGroup({
      label: `${this.label}:bg`,
      layout: this.bindGroupLayout,
      entries: [
        { binding: 0, resource: depthGPU.createView({ aspect: 'depth-only' }) },
        { binding: 1, resource: { buffer: this.uniformBuffer } },
      ],
    });

    const encoder = this.device.createCommandEncoder({ label: `${this.label}:encoder` });
    const pass = encoder.beginRenderPass({
      label: `${this.label}:renderpass`,
      colorAttachments: [
        {
          view: outputGPU.createView(),
          loadOp: 'clear',
          storeOp: 'store',
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
        },
      ],
    });
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.draw(3);
    pass.end();
    this.device.queue.submit([encoder.finish()]);
  }
}
